import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { WebSocketServer } from 'ws';
import { defaultRoles, validateRoles } from '../shared/roles.js';
import { log, requestId } from './logger.js';
import {
  archiveFinishedRoom, hashToken, metrics, removeRoom, saveRoom,
  recordSecurityEvent,
} from './persistence/database.js';
import {
  ALLOWED_ORIGIN, GM_WORDS, MAX_PLAYERS, MIN_PLAYERS, PORT, SIM_KEY, THEMES, token,
} from './config.js';
import {
  ROLES, buildRevealOrder, deal, freshNight, killPlayer, pushHistory, undo,
} from './domain/game.js';
import { registerRoutes } from './http/routes.js';
import { viewFor } from './http/views.js';
import { createRoom, restoreRooms } from './services/room-service.js';

const rooms = new Map();
const gmClaimIps = new Map();
const gmKey = () => `${GM_WORDS[crypto.randomInt(GM_WORDS.length)]}-${GM_WORDS[crypto.randomInt(GM_WORDS.length)]}`;
const sameHash = (left, right) => {
  const a = Buffer.from(left || ''), b = Buffer.from(right || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const newGmKey = (r) => {
  const key = gmKey();
  r.gmKeyHash = hashToken(key);
  r.gmClaimFailures = 0;
  r.gmClaimLockedUntil = 0;
  return key;
};

// ---------- rooms ----------
// ---------- views (the only thing that leaves the server) ----------
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
function broadcast(r, event = 'snapshot', details = {}) {
  try {
    if (!r.archived) saveRoom(r, event, details);
    if (!r.archived && r.phase === 'over' && r.revealCount >= r.revealOrder.length) {
      archiveFinishedRoom(r);
      r.archived = true;
    }
  } catch (error) {
    log('error', 'room persistence failed', {
      code: r.code, event, error: error.message, persistence_failures: metrics().persistenceFailures,
    });
  }
  if (r.gmWs) send(r.gmWs, { type: 'state', s: viewFor(r, { role: 'gm' }) });
  for (const [id, ws] of r.sockets) send(ws, { type: 'state', s: viewFor(r, { role: 'player', id }) });
}

// ---------- message handling ----------
const GM_ONLY = new Set(['config', 'deal', 'set_phase', 'open_turn', 'close_turn', 'kill', 'lynch', 'revive',
  'reassign', 'kick', 'end', 'reveal_next', 'reveal_all', 'undo', 'hunter_done', 'abort', 'pass_gm']);

function attach(ws, r, who, resumed = false) {
  ws.ctx = { r, who }; r.last = Date.now();
  if (who.role === 'gm') { r.gmWs?.close(4003); r.gmWs = ws; }
  else { r.sockets.get(who.id)?.close(4003); r.sockets.set(who.id, ws); }
  send(ws, {
    type: 'joined',
    code: r.code,
    token: who.token || (who.role === 'gm' ? r.gmToken : r.players.get(who.id).token),
    role: who.role,
    resynced: resumed,
  });
  if (resumed) send(ws, { type: 'resynced', code: r.code });
  broadcast(r);
}

function claimGm(ws, m) {
  const r = rooms.get(String(m.code || '').toUpperCase());
  if (!r) return send(ws, { type: 'error', msg: 'room gone', fatal: true });
  const now = Date.now();
  const ip = ws.ip || 'unknown';
  const ipFailure = gmClaimIps.get(ip);
  if (ipFailure && now < ipFailure.until) {
    recordSecurityEvent('gm_claim_locked_ip', { code: r.code });
    return send(ws, { type: 'error', msg: 'claims locked, try again later' });
  }
  if (now < r.gmClaimLockedUntil) {
    recordSecurityEvent('gm_claim_locked_room', { code: r.code });
    return send(ws, { type: 'error', msg: 'claims locked, try again later' });
  }
  if (!sameHash(hashToken(String(m.key || '')), r.gmKeyHash)) {
    r.gmClaimFailures++;
    const windowUntil = ipFailure && now < ipFailure.windowUntil ? ipFailure.windowUntil : now + 5 * 60e3;
    const failures = ipFailure && now < ipFailure.windowUntil ? ipFailure.failures + 1 : 1;
    gmClaimIps.set(ip, {
      failures, windowUntil, until: failures >= 3 ? windowUntil : 0,
    });
    if (r.gmClaimFailures >= 3) r.gmClaimLockedUntil = windowUntil;
    recordSecurityEvent('gm_claim_failed', { code: r.code });
    return send(ws, { type: 'error', msg: 'bad GM key' });
  }
  const nickname = String(m.nickname || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);
  if (!nickname) return send(ws, { type: 'error', msg: 'enter a nickname' });
  r.gmWs?.close(4003, 'GM control transferred');
  r.gmToken = token();
  const rotatedKey = newGmKey(r);
  r.gmName = nickname;
  attach(ws, r, { role: 'gm', token: r.gmToken }, true);
  send(ws, { type: 'gm_key', key: rotatedKey });
  broadcast(r, 'gm_claimed', { nickname });
}

function handle(ws, m) {
  const err = (msg, extra) => send(ws, { type: 'error', msg, ...extra });
  if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.type !== 'string') {
    return err('invalid message');
  }
  if (m.type === 'create') {
    if (ws.ctx) return;
    const simulated = m.sim_key != null;
    if (simulated && (!SIM_KEY || !sameHash(hashToken(String(m.sim_key)), hashToken(SIM_KEY)))) {
      return err('invalid simulator key');
    }
    const r = createRoom(rooms, m.theme, simulated ? 'sim' : 'live');
    if (!r) return err('server full');
    const key = newGmKey(r);
    attach(ws, r, { role: 'gm' });
    send(ws, { type: 'gm_key', key });
    return;
  }
  if (m.type === 'claim_gm') return claimGm(ws, m);
  if (m.type === 'join') {
    if (ws.ctx) return;
    const r = rooms.get(String(m.code || '').toUpperCase());
    const name = String(m.name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);
    if (!r) return err('room not found');
    if (r.phase !== 'lobby') return err('game already started');
    if (!name) return err('enter a name');
    if (r.players.size >= MAX_PLAYERS) return err('room full');
    if ([...r.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase())) return err('name taken');
    const p = { id: crypto.randomBytes(4).toString('hex'), name, token: token(), role: null, alive: true, seen: false, cause: null, diedAt: 0 };
    p.tokenHash = hashToken(p.token);
    r.players.set(p.id, p);
    return attach(ws, r, { role: 'player', id: p.id });
  }
  if (m.type === 'resume') {
    if (ws.ctx) return;
    const r = rooms.get(String(m.code || '').toUpperCase());
    if (!r) return err('room gone', { fatal: true });
    if (r.gmToken ? m.token === r.gmToken : hashToken(String(m.token || '')) === r.gmTokenHash) {
      return attach(ws, r, { role: 'gm', token: String(m.token || '') }, true);
    }
    const p = [...r.players.values()].find((x) => x.token
      ? x.token === m.token
      : hashToken(String(m.token || '')) === x.tokenHash);
    return p
      ? attach(ws, r, { role: 'player', id: p.id, token: String(m.token || '') }, true)
      : err('session expired', { fatal: true });
  }

  const { r, who } = ws.ctx || {};
  if (!r) return;
  r.last = Date.now();

  if (m.type === 'leave') {
    if (who.role === 'gm') {
      r.gmWs = null;
      ws.ctx = null;
      if (r.phase === 'lobby' || r.phase === 'over') {
        r.sockets.forEach((s) => s.close(4002));
        rooms.delete(r.code); removeRoom(r.code);
      } else {
        broadcast(r);
      }
    } else if (who.role === 'player') {
      if (r.phase === 'lobby') {
        r.players.delete(who.id);
      }
      r.sockets.delete(who.id);
      ws.ctx = null;
      broadcast(r);
    }
    try { ws.close(); } catch {}
    return;
  }

  if (who.role === 'player') {
    const p = r.players.get(who.id);
    if (!p) return;
    if (m.type === 'ack' && p.role && !p.seen) {
      p.seen = true; broadcast(r, 'ack', { player_id: p.id });
    }
    else if (m.type === 'night_target') {
      const t = r.players.get(m.id);
      if (r.phase !== 'night' || !t || !p.alive || !t.alive || !ROLES[p.role]?.night || r.night.open !== p.role) return;
      if (p.role === 'inspector' && t.id === p.id) return;
      if (p.role === 'killer' && t.role === 'killer') return;
      if (r.night.picks[p.id] === t.id) delete r.night.picks[p.id]; else r.night.picks[p.id] = t.id; // tap again to clear
      broadcast(r, 'night_target', { player_id: p.id, target_id: t.id });
    }
    return; // players can do nothing else
  }
  if (!GM_ONLY.has(m.type)) return;

  const target = r.players.get(m.id);
  const fail = (msg) => err(msg);
  const live = r.phase === 'night' || r.phase === 'day' || r.phase === 'reveal';

  let undone = false;
  switch (m.type) {
    case 'config': {
      if (r.phase !== 'lobby') return fail('config locked after deal');
      if (THEMES.has(m.theme)) r.theme = m.theme;
      if (m.roles) {
        const e = validateRoles(m.roles, Math.max(r.players.size, MIN_PLAYERS));
        if (e) return fail(e);
        r.roles = m.roles;
      }
      break;
    }
    case 'deal': {
      if (r.phase !== 'lobby' && r.phase !== 'reveal') return fail('already playing');
      const e = deal(r, MIN_PLAYERS); if (e) return fail(e);
      break;
    }
    case 'set_phase': {
      if (!live || !['night', 'day'].includes(m.phase)) return fail('bad phase');
      pushHistory(r);
      if (m.phase === 'night') r.round++;
      r.phase = m.phase; r.hunterPending = false; r.night = freshNight();
      r.log.push({ t: Date.now(), type: 'phase', phase: m.phase, round: r.round });
      break;
    }
    case 'open_turn': {
      if (r.phase !== 'night' || !ROLES[m.role]?.night) return fail('cannot open turn');
      r.night.open = m.role; delete r.night.closed[m.role];
      break;
    }
    case 'close_turn': {
      if (r.phase !== 'night' || !r.night.open) return fail('no open turn');
      r.night.closed[r.night.open] = true; r.night.open = null;
      break;
    }
    case 'kill': case 'lynch': {
      if (!live || !target || !target.alive) return fail('invalid target');
      pushHistory(r);
      killPlayer(r, target, m.type === 'kill' ? (m.cause === 'shot' ? 'shot' : 'night') : 'lynch');
      break;
    }
    case 'revive': {
      if (!live || !target || target.alive) return fail('invalid target');
      pushHistory(r);
      target.alive = true; target.cause = null;
      r.log.push({ t: Date.now(), type: 'revive', id: target.id, name: target.name, round: r.round });
      break;
    }
    case 'reassign': {
      if (!live || !target || !ROLES[m.role]) return fail('invalid');
      pushHistory(r);
      target.role = m.role; target.seen = false;
      break;
    }
    case 'kick': {
      if (!target) return fail('invalid target');
      r.sockets.get(target.id)?.close(4004);
      r.sockets.delete(target.id); r.players.delete(target.id); r.history = [];
      break;
    }
    case 'hunter_done': r.hunterPending = false; break;
    case 'abort': {
      if (!r.dealt || r.phase === 'over') return fail('nothing to abort');
      archiveFinishedRoom(r, 'aborted', { includePlayers: false, cleanupLive: false });
      for (const player of r.players.values()) {
        player.role = null; player.alive = true; player.seen = false;
        player.cause = null; player.diedAt = 0; player.deathRound = undefined;
      }
      r.dealt = false; r.phase = 'lobby'; r.round = 0; r.winner = null;
      r.jesterWin = false; r.hunterPending = false; r.roles = null;
      r.night = freshNight(); r.revealOrder = []; r.revealCount = 0; r.history = [];
      break;
    }
    case 'pass_gm': {
      if (!['lobby', 'over'].includes(r.phase) || !target || !r.sockets.has(target.id)) {
        return fail('invalid GM pass');
      }
      const oldGm = r.gmWs;
      const oldName = r.gmName || 'GM';
      const newGmWs = r.sockets.get(target.id);
      const former = {
        id: crypto.randomBytes(4).toString('hex'), name: oldName, token: token(),
        tokenHash: null, role: null, alive: true, seen: false, cause: null, diedAt: 0,
      };
      former.tokenHash = hashToken(former.token);
      r.players.delete(target.id); r.sockets.delete(target.id);
      r.players.set(former.id, former);
      r.gmToken = token(); r.gmName = target.name;
      newGmWs.ctx = { r, who: { role: 'gm', token: r.gmToken } };
      r.gmWs = newGmWs;
      if (oldGm) {
        oldGm.ctx = { r, who: { role: 'player', id: former.id, token: former.token } };
        r.sockets.set(former.id, oldGm);
        send(oldGm, {
          type: 'joined', code: r.code, token: former.token, role: 'player', resynced: true,
        });
      }
      send(newGmWs, { type: 'joined', code: r.code, token: r.gmToken, role: 'gm', resynced: true });
      send(newGmWs, { type: 'gm_key', key: newGmKey(r) });
      break;
    }
    case 'end': {
      if (!r.dealt || r.phase === 'over') return fail('nothing to end');
      pushHistory(r);
      r.phase = 'over'; r.night.open = null;
      r.winner = ['good', 'evil', 'jester', 'draw'].includes(m.winner) ? m.winner : 'draw';
      r.revealOrder = buildRevealOrder(r); r.revealCount = 0;
      break;
    }
    case 'reveal_next': {
      if (r.phase !== 'over' || r.revealCount >= r.revealOrder.length) return;
      r.revealCount++;
      break;
    }
    case 'reveal_all': if (r.phase === 'over') r.revealCount = r.revealOrder.length; break;
    case 'undo': undone = undo(r); break;
  }
  const details = m.type === 'deal'
    ? { role_counts: Object.fromEntries(Object.entries(r.roles || defaultRoles(r.players.size))) }
    : m.type === 'kill' || m.type === 'lynch'
      ? { player_id: target?.id, cause: m.type === 'lynch' ? 'lynch' : (m.cause === 'shot' ? 'shot' : 'night') }
      : m.type === 'reassign' ? { player_id: target?.id }
        : m.type === 'undo' ? { compensates_change: undone } : {};
  broadcast(r, m.type, details);
}

// ---------- server ----------
const app = express();
const allowedOrigins = ALLOWED_ORIGIN
  ? ALLOWED_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
  : true;
app.use(cors({ origin: allowedOrigins }));
app.use((req, res, next) => {
  req.id = requestId();
  res.setHeader('x-request-id', req.id);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  if (req.path.startsWith('/admin') || req.path.startsWith('/history')) {
    res.setHeader('cache-control', 'no-store');
  }
  next();
});
app.use(morgan((tokens, req, res) => [
  tokens.method(req, res),
  tokens.url(req, res),
  tokens.status(req, res),
  `${tokens['response-time'](req, res)} ms`,
  `request_id=${req.id}`,
].join(' ')));
registerRoutes(app, { getRooms: () => rooms.values() });
restoreRooms(rooms);
const server = app.listen(PORT, () => log('info', `night table server on :${PORT}`));
const wss = new WebSocketServer({
  server, maxPayload: 2048,
  verifyClient: ({ origin }) => !ALLOWED_ORIGIN || allowedOrigins
    .map((value) => value.toLowerCase())
    .includes(String(origin || '').toLowerCase()),
});

wss.on('connection', (ws, req) => {
  ws.requestId = requestId();
  ws.ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  let budget = 20, refill = Date.now(); // ~20 msgs per 5s
  ws.on('message', (raw) => {
    const now = Date.now();
    if (now - refill > 5000) { budget = 20; refill = now; }
    if (--budget < 0) return;
    try { handle(ws, JSON.parse(raw)); }
    catch (e) { log('error', 'handler error', { request_id: ws.requestId, error: e.message }); }
  });
  ws.on('close', () => {
    const { r, who } = ws.ctx || {};
    if (!r) return;
    if (who.role === 'gm') { if (r.gmWs === ws) r.gmWs = null; }
    else if (r.sockets.get(who.id) === ws) r.sockets.delete(who.id);
    broadcast(r);
  });
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', `shutting down after ${signal}`);
  for (const r of rooms.values()) {
    r.gmWs?.close(1012, 'server restarting; reconnect shortly');
    for (const ws of r.sockets.values()) ws.close(1012, 'server restarting; reconnect shortly');
  }
  wss.close();
  const timer = setTimeout(() => process.exit(1), 9000);
  timer.unref();
  server.close(() => process.exit(0));
}
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });

setInterval(() => {
  const now = Date.now();
  for (const [ip, f] of fails) if (now > f.until) fails.delete(ip);
  for (const [code, r] of rooms) {
    const empty = !r.gmWs && r.sockets.size === 0;
    if (now - r.last > 2 * 3600e3 || (empty && now - r.last > 15 * 60e3)) {
      r.gmWs?.close(4002); r.sockets.forEach((s) => s.close(4002)); rooms.delete(code); removeRoom(code);
    }
  }
}, 60e3).unref();

export { server, wss };
