import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { log } from '../logger.js';

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

const metrics = () => ({ persistenceFailures });

export { db, hashToken, loadRooms, metrics, removeRoom, saveRoom };
