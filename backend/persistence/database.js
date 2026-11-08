import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { log } from '../logger.js';
import { ROLES } from '../../shared/roles.js';

const filename = process.env.DB_PATH || './nighttable.db';
const SNAPSHOT_VERSION = 1;
const EMPTY_ROOM_IDLE_MS = 15 * 60e3;
let persistenceFailures = 0;
if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
const db = new DatabaseSync(filename);

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS games (
    code TEXT PRIMARY KEY,
    snapshot TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_code TEXT NOT NULL,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_players (
    game_code TEXT NOT NULL,
    player_id TEXT NOT NULL,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    role TEXT,
    PRIMARY KEY (game_code, player_id)
  );
  CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    sub TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'operator',
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_sessions (
    session_hash TEXT PRIMARY KEY,
    user_sub TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS finished_games (
    code TEXT PRIMARY KEY,
    winner TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    rounds INTEGER NOT NULL,
    end_reason TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'live',
    player_count INTEGER NOT NULL,
    gm_name TEXT
  );
  CREATE TABLE IF NOT EXISTS finished_players (
    game_code TEXT NOT NULL,
    player_id TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    team TEXT NOT NULL,
    alive INTEGER NOT NULL,
    death_round INTEGER,
    PRIMARY KEY (game_code, player_id)
  );
  CREATE TABLE IF NOT EXISTS finished_events (
    game_code TEXT NOT NULL,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (game_code, seq)
  );
`);

const eventColumns = new Set(db.prepare('PRAGMA table_info(events)').all().map(({ name }) => name));
if (!eventColumns.has('seq')) {
  db.exec('ALTER TABLE events ADD COLUMN seq INTEGER');
  db.exec('BEGIN IMMEDIATE');
  try {
    const games = db.prepare('SELECT DISTINCT game_code FROM events').all();
    const events = db.prepare('SELECT id FROM events WHERE game_code = ? ORDER BY id');
    const update = db.prepare('UPDATE events SET seq = ? WHERE id = ?');
    for (const { game_code } of games) {
      events.all(game_code).forEach(({ id }, index) => update.run(index + 1, id));
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS events_game_seq ON events(game_code, seq)');

const hashToken = (value) => crypto.createHash('sha256').update(value).digest('hex');
const withoutRuntimeState = (room) => ({
  ...room,
  snapshotVersion: SNAPSHOT_VERSION,
  gmToken: undefined,
  gmTokenHash: room.gmTokenHash || hashToken(room.gmToken),
  players: [...room.players.values()].map((player) => ({
    ...player,
    token: undefined,
    tokenHash: player.tokenHash || hashToken(player.token),
  })),
  sockets: undefined,
  gmWs: undefined,
  history: [],
});

function saveRoom(room, event = 'snapshot', details = {}) {
  const now = Date.now();
  const snapshot = withoutRuntimeState(room);
  const serialized = JSON.stringify(snapshot);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO games (code, snapshot, version, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET snapshot = excluded.snapshot, version = excluded.version,
        updated_at = excluded.updated_at
    `).run(room.code, serialized, SNAPSHOT_VERSION, now);
    db.prepare('DELETE FROM game_players WHERE game_code = ?').run(room.code);
    const playerStmt = db.prepare(`
      INSERT INTO game_players (game_code, player_id, name, token_hash, role)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const player of room.players.values()) {
      const role = room.phase === 'over' ? player.role : null;
      playerStmt.run(room.code, player.id, player.name, player.tokenHash || hashToken(player.token), role);
    }
    const sequence = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM events WHERE game_code = ?')
      .get(room.code).next;
    db.prepare('INSERT INTO events (game_code, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(room.code, sequence, event, JSON.stringify({
        ...details,
        phase: room.phase,
        round: room.round,
      }), now);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    persistenceFailures++;
    throw error;
  }
}

function loadRooms() {
  const now = Date.now();
  return db.prepare('SELECT snapshot, version, updated_at FROM games ORDER BY updated_at').all()
    .flatMap(({ snapshot, version, updated_at }) => {
      try {
        const saved = JSON.parse(snapshot);
        const last = Number(saved.last || updated_at);
        if (version !== SNAPSHOT_VERSION || (saved.snapshotVersion && saved.snapshotVersion !== SNAPSHOT_VERSION)) {
          log('warn', 'skipping unsupported room snapshot', { code: saved.code, version });
          return [];
        }
        // A restored room has no live sockets, so the empty-room limit applies.
        if (now - last > EMPTY_ROOM_IDLE_MS) {
          log('info', 'skipping expired room snapshot', { code: saved.code });
          return [];
        }
        return [saved];
      } catch {
        log('warn', 'skipping invalid room snapshot');
        return [];
      }
    });
}

function removeRoom(code) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM events WHERE game_code = ?').run(code);
    db.prepare('DELETE FROM game_players WHERE game_code = ?').run(code);
    db.prepare('DELETE FROM games WHERE code = ?').run(code);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function archiveFinishedRoom(room, endReason = 'completed', { includePlayers = true, cleanupLive = true } = {}) {
  const endedAt = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    const events = db.prepare(
      'SELECT seq, type, payload, created_at FROM events WHERE game_code = ? ORDER BY seq',
    ).all(room.code);
    db.prepare(`
      INSERT INTO finished_games
        (code, winner, started_at, ended_at, rounds, end_reason, source, player_count, gm_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET winner = excluded.winner, ended_at = excluded.ended_at,
        rounds = excluded.rounds, end_reason = excluded.end_reason, player_count = excluded.player_count,
        gm_name = excluded.gm_name
    `).run(
      room.code, room.winner || 'draw', room.startedAt || endedAt, endedAt, room.round,
      endReason, room.source || 'live', room.players.size, room.gmName || null,
    );
    db.prepare('DELETE FROM finished_players WHERE game_code = ?').run(room.code);
    if (includePlayers) {
      const playerStmt = db.prepare(`
        INSERT INTO finished_players
          (game_code, player_id, name, role, team, alive, death_round)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const player of room.players.values()) {
        playerStmt.run(
          room.code, player.id, player.name, player.role, ROLES[player.role]?.team || 'good',
          player.alive ? 1 : 0, player.deathRound ?? null,
        );
      }
    }
    db.prepare('DELETE FROM finished_events WHERE game_code = ?').run(room.code);
    const eventStmt = db.prepare(`
      INSERT INTO finished_events (game_code, seq, type, payload, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const event of events) eventStmt.run(room.code, event.seq, event.type, event.payload, event.created_at);
    if (cleanupLive) {
      db.prepare('DELETE FROM events WHERE game_code = ?').run(room.code);
      db.prepare('DELETE FROM game_players WHERE game_code = ?').run(room.code);
      db.prepare('DELETE FROM games WHERE code = ?').run(room.code);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    persistenceFailures++;
    throw error;
  }
}

function listFinishedGames() {
  return db.prepare(`
    SELECT code, winner, started_at, ended_at, rounds, end_reason, source, player_count, gm_name
    FROM finished_games
    ORDER BY ended_at DESC
  `).all();
}

function getFinishedGame(code) {
  const game = db.prepare(`
    SELECT code, winner, started_at, ended_at, rounds, end_reason, source, player_count, gm_name
    FROM finished_games WHERE code = ?
  `).get(code);
  if (!game) return null;
  const players = db.prepare(`
    SELECT player_id, name, role, team, alive, death_round
    FROM finished_players WHERE game_code = ? ORDER BY rowid
  `).all(code);
  const events = db.prepare(`
    SELECT seq, type, payload, created_at
    FROM finished_events WHERE game_code = ? ORDER BY seq
  `).all(code).map((event) => ({ ...event, payload: JSON.parse(event.payload) }));
  const reverted = new Set(
    events.filter((event) => event.type === 'undo' && event.payload.compensates_change)
      .map((event) => event.seq - 1),
  );
  return {
    ...game,
    players,
    events: events.map((event) => ({ ...event, reverted: reverted.has(event.seq) })),
  };
}

function purgeFinishedGame(code) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM finished_events WHERE game_code = ?').run(code);
    db.prepare('DELETE FROM finished_players WHERE game_code = ?').run(code);
    const result = db.prepare('DELETE FROM finished_games WHERE code = ?').run(code);
    db.exec('COMMIT');
    return result.changes > 0;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function getHistoryAnalytics(minPlayers, includeSimulated = false) {
  const games = db.prepare(`
    SELECT code, winner, started_at, ended_at, rounds, player_count
    FROM finished_games
    WHERE end_reason = 'completed' AND player_count >= ?
      AND (? OR source = 'live')
  `).all(minPlayers, includeSimulated ? 1 : 0);
  const players = games.flatMap((game) => db.prepare(`
    SELECT role, team, alive, death_round FROM finished_players WHERE game_code = ?
  `).all(game.code).map((player) => ({ ...player, winner: game.winner, player_count: game.player_count })));
  const average = (values) => values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const roles = [...new Set(players.map((player) => player.role))].sort().map((role) => {
    const assigned = players.filter((player) => player.role === role);
    return {
      includes_simulated: includeSimulated,
      role,
      win_rate: average(assigned.map((player) => player.team === player.winner ? 1 : 0)),
      survival_rate: average(assigned.map((player) => player.alive)),
      mean_death_round: average(assigned.filter((player) => player.death_round != null)
        .map((player) => player.death_round)),
    };
  });
  return {
    games_played: games.length,
    average_duration_ms: average(games.map((game) => game.ended_at - game.started_at)),
    average_rounds: average(games.map((game) => game.rounds)),
    roles,
  };
}

function recordSecurityEvent(type, payload = {}) {
  db.prepare('INSERT INTO security_events (type, payload, created_at) VALUES (?, ?, ?)')
    .run(type, JSON.stringify(payload), Date.now());
}

function upsertUser(sub, email, role = 'operator') {
  db.prepare(`
    INSERT INTO users (sub, email, role, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(sub) DO UPDATE SET email = excluded.email, updated_at = excluded.updated_at
  `).run(sub, email, role, Date.now());
}

function createAdminSession(sessionHash, userSub, expiresAt) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO admin_sessions (session_hash, user_sub, created_at, last_seen_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionHash, userSub, now, now, expiresAt);
}

function findAdminSession(sessionHash) {
  const session = db.prepare(`
    SELECT s.session_hash, s.user_sub, s.created_at, s.last_seen_at, s.expires_at,
      u.email, u.role
    FROM admin_sessions s JOIN users u ON u.sub = s.user_sub
    WHERE s.session_hash = ?
  `).get(sessionHash);
  if (!session) return null;
  const now = Date.now();
  if (session.expires_at <= now || session.last_seen_at + 30 * 60e3 <= now) {
    db.prepare('DELETE FROM admin_sessions WHERE session_hash = ?').run(sessionHash);
    return null;
  }
  db.prepare('UPDATE admin_sessions SET last_seen_at = ? WHERE session_hash = ?').run(now, sessionHash);
  return session;
}

function deleteAdminSession(sessionHash) {
  db.prepare('DELETE FROM admin_sessions WHERE session_hash = ?').run(sessionHash);
}

function listSecurityEvents(limit = 100) {
  return db.prepare(`
    SELECT id, type, payload, created_at
    FROM security_events ORDER BY id DESC LIMIT ?
  `).all(Math.max(1, Math.min(500, Number(limit) || 100)))
    .map((event) => ({ ...event, payload: JSON.parse(event.payload) }));
}

const metrics = () => ({
  persistenceFailures,
  uptime: process.uptime(),
  memory: process.memoryUsage(),
});

export {
  archiveFinishedRoom, db, getFinishedGame, hashToken, listFinishedGames, loadRooms,
  createAdminSession, deleteAdminSession, findAdminSession, getHistoryAnalytics, listSecurityEvents,
  metrics, purgeFinishedGame, recordSecurityEvent, removeRoom, saveRoom, upsertUser,
};
