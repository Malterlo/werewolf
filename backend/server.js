import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { WebSocketServer } from 'ws';
import { defaultRoles, validateRoles } from '../shared/roles.js';
import { log, requestId } from './logger.js';
import { hashToken, metrics, removeRoom, saveRoom } from './persistence/database.js';
import {
  ALLOWED_ORIGIN, HOST_KEY, MAX_PLAYERS, MIN_PLAYERS, PORT, THEMES, token,
} from './config.js';
import {
  ROLES, buildRevealOrder, deal, freshNight, killPlayer, pushHistory, undo,
} from './domain/game.js';
import { registerRoutes } from './http/routes.js';
import { viewFor } from './http/views.js';
import { createRoom, restoreRooms } from './services/room-service.js';

const rooms = new Map();

// ---------- host passphrase + brute-force limit ----------
const fails = new Map(); // ip -> {n, until}
const limited = (ip) => { const f = fails.get(ip); return !!f && f.n >= 5 && Date.now() < f.until; };
const noteFail = (ip) => { const f = fails.get(ip) || { n: 0, until: 0 }; f.n++; f.until = Date.now() + 10 * 60e3; fails.set(ip, f); };
function keyOk(k) {
  if (!HOST_KEY) return true;
  const a = Buffer.from(String(k || '')), b = Buffer.from(HOST_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- rooms ----------
// ---------- views (the only thing that leaves the server) ----------
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
function broadcast(r, event = 'snapshot', details = {}) {
  try {
    saveRoom(r, event, details);
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
  'reassign', 'kick', 'end', 'reveal_next', 'reveal_all', 'undo', 'hunter_done']);

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

function handle(ws, m) {
  const err = (msg, extra) => send(ws, { type: 'error', msg, ...extra });
  if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.type !== 'string') {
    return err('invalid message');
  }
  if (m.type === 'create') {
    if (ws.ctx) return;
    if (HOST_KEY) {
      if (limited(ws.ip)) return err('too many tries, wait 10 minutes');
      if (!keyOk(m.key)) { noteFail(ws.ip); return err('wrong passphrase', { badKey: true }); }
      fails.delete(ws.ip);
    }
    const r = createRoom(rooms, m.theme);
    return r ? attach(ws, r, { role: 'gm' }) : err('server full');
  }
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
  next();
});
app.use(morgan((tokens, req, res) => [
  tokens.method(req, res),
  tokens.url(req, res),
  tokens.status(req, res),
  `${tokens['response-time'](req, res)} ms`,
  `request_id=${req.id}`,
].join(' ')));
registerRoutes(app);
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
