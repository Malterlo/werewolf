import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { ROLES, defaultRoles, validateRoles } from './data.js';

const PORT = +process.env.PORT || 8080;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || ''; // e.g. https://user.github.io ('' = allow all, dev only)
const HOST_KEY = process.env.HOST_KEY || '';              // passphrase required to create rooms
const MIN_PLAYERS = +process.env.MIN_PLAYERS || 4;
const MAX_ROOMS = 50, MAX_PLAYERS = 20;
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const THEMES = new Set(['werewolf', 'mafia']);
if (!HOST_KEY) console.warn('HOST_KEY not set: anyone can create rooms (dev only)');

const rooms = new Map();
const rnd = (n) => crypto.randomInt(n);
const token = () => crypto.randomBytes(16).toString('hex');
const newCode = () => Array.from({ length: 4 }, () => ALPHA[rnd(ALPHA.length)]).join('');

// ---------- host passphrase + brute-force limit ----------
const fails = new Map(); // ip -> {n, until}
const limited = (ip) => { const f = fails.get(ip); return !!f && f.n >= 5 && Date.now() < f.until; };
const noteFail = (ip) => { const f = fails.get(ip) || { n: 0, until: 0 }; f.n++; f.until = Date.now() + 10 * 60e3; fails.set(ip, f); };
function keyOk(k) {
  const a = Buffer.from(String(k || '')), b = Buffer.from(HOST_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- rooms ----------
const freshNight = () => ({ open: null, picks: {}, closed: {} });
function createRoom(theme) {
  if (rooms.size >= MAX_ROOMS) return null;
  let code;
  do code = newCode(); while (rooms.has(code));
  const room = {
    code, gmToken: token(), theme: THEMES.has(theme) ? theme : 'werewolf',
    phase: 'lobby', round: 0, winner: null, jesterWin: false, hunterPending: false,
    roles: null, dealt: false, night: freshNight(), revealOrder: [], revealCount: 0,
    players: new Map(), sockets: new Map(), gmWs: null,
    log: [], history: [], last: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

// ---------- undo ----------
const snap = (r) => structuredClone({
  phase: r.phase, round: r.round, winner: r.winner, jesterWin: r.jesterWin, hunterPending: r.hunterPending,
  night: r.night, revealOrder: r.revealOrder, revealCount: r.revealCount, log: r.log,
  players: [...r.players.values()],
});
function pushHistory(r) { r.history.push(snap(r)); if (r.history.length > 30) r.history.shift(); }
function undo(r) {
  const s = r.history.pop();
  if (!s) return;
  const { players, ...rest } = s;
  Object.assign(r, rest);
  for (const sp of players) { const p = r.players.get(sp.id); if (p) Object.assign(p, sp); }
}

// ---------- game logic ----------
const alive = (r) => [...r.players.values()].filter((p) => p.alive);

function winCheck(r) {
  if (!r.dealt) return null;
  if (r.jesterWin) return 'jester';
  const a = alive(r);
  const evil = a.filter((p) => ROLES[p.role].team === 'evil').length;
  if (evil === 0) return 'good';
  if (evil >= a.length - evil) return 'evil';
  return null;
}

// Killer picks this night. Majority = more than half of living killers.
function tally(r) {
  const killers = alive(r).filter((p) => p.role === 'killer');
  const counts = {};
  for (const k of killers) { const t = r.night.picks[k.id]; if (t) counts[t] = (counts[t] || 0) + 1; }
  const max = Math.max(0, ...Object.values(counts));
  const top = Object.keys(counts).filter((id) => counts[id] === max);
  const need = Math.floor(killers.length / 2) + 1;
  const leader = top.length === 1 && max >= need ? top[0] : null;
  return { counts, leader, split: Object.keys(counts).length > 0 && !leader };
}

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function deal(r) {
  const n = r.players.size;
  if (n < MIN_PLAYERS) return `need at least ${MIN_PLAYERS} players`;
  const roles = r.roles || defaultRoles(n);
  const err = validateRoles(roles, n);
  if (err) return err;
  const deck = [];
  for (const [id, c] of Object.entries(roles)) for (let i = 0; i < c; i++) deck.push(id);
  while (deck.length < n) deck.push('townsfolk');
  shuffle(deck);
  for (const p of r.players.values()) { p.role = deck.pop(); p.alive = true; p.seen = false; p.cause = null; p.diedAt = 0; }
  Object.assign(r, { dealt: true, phase: 'reveal', round: 0, winner: null, jesterWin: false, hunterPending: false,
    night: freshNight(), revealOrder: [], revealCount: 0, log: [], history: [] });
}

function killPlayer(r, p, cause) {
  if (!p.alive) return;
  p.alive = false; p.cause = cause; p.diedAt = Date.now();
  if (p.role === 'hunter') r.hunterPending = true;
  if (cause === 'lynch' && p.role === 'jester') r.jesterWin = true;
  // roles are never put in the log: they stay hidden until the end-of-game reveal
  r.log.push({ t: Date.now(), type: 'death', id: p.id, name: p.name, cause, round: r.round });
}

// reveal order: dead first, then living, killers always last
function buildRevealOrder(r) {
  const rank = (p) => (p.role === 'killer' ? 2 : p.alive ? 1 : 0);
  return [...r.players.values()].map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || (a.p.diedAt || 0) - (b.p.diedAt || 0) || a.i - b.i)
    .map((x) => x.p.id);
}

// ---------- views (the only thing that leaves the server) ----------
function viewFor(r, who) {
  const list = [...r.players.values()];
  const shown = new Set(r.revealOrder.slice(0, r.revealCount));
  const done = r.phase === 'over' && r.revealCount >= r.revealOrder.length;
  const base = {
    code: r.code, theme: r.theme, phase: r.phase, round: r.round, log: r.log.slice(-40),
    inPlay: r.dealt ? [...new Set(list.map((p) => p.role))].sort() : [],
    reveal: r.phase === 'over' ? { shown: r.revealCount, total: r.revealOrder.length } : null,
  };
  if (who.role === 'gm') {
    const steps = !r.dealt ? [] : Object.keys(ROLES).filter((id) => ROLES[id].night && list.some((p) => p.role === id))
      .sort((a, b) => ROLES[a].order - ROLES[b].order).map((id) => ({
        role: id, closed: !!r.night.closed[id],
        holders: list.filter((p) => p.role === id).map((p) => ({ id: p.id, name: p.name, alive: p.alive, pick: r.night.picks[p.id] || null })),
        tally: id === 'killer' ? tally(r) : null,
      }));
    return {
      ...base, you: 'gm', winner: r.winner, roles: r.roles || defaultRoles(Math.max(list.length, MIN_PLAYERS)),
      hunterPending: r.hunterPending, suggest: winCheck(r), canUndo: r.history.length > 0, catalog: Object.keys(ROLES),
      night: { open: r.night.open, steps },
      nextReveal: r.phase === 'over' && !done ? r.players.get(r.revealOrder[r.revealCount])?.name : null,
      players: list.map((p) => ({ id: p.id, name: p.name, alive: p.alive, role: p.role, seen: p.seen,
        team: p.role ? ROLES[p.role].team : null, online: r.sockets.has(p.id) })),
    };
  }
  const me = r.players.get(who.id);
  const acting = r.phase === 'night' && r.night.open && me.alive && me.role === r.night.open;
  const isKiller = me.role === 'killer';
  return {
    ...base, you: 'player', winner: done ? r.winner : null,
    me: { id: me.id, name: me.name, role: me.alive ? me.role : null, alive: me.alive, seen: me.seen },
    turn: acting ? {
      role: me.role, pick: r.night.picks[me.id] || null,
      mates: isKiller ? list.filter((p) => p.role === 'killer' && p.alive && p.id !== me.id)
        .map((p) => ({ id: p.id, name: p.name, pick: r.night.picks[p.id] || null })) : [],
      targets: list.filter((p) => p.alive && !(me.role === 'inspector' && p.id === me.id) && !(isKiller && p.role === 'killer'))
        .map((p) => ({ id: p.id, name: p.name })),
    } : null,
    players: list.map((p) => ({ id: p.id, name: p.name, alive: p.alive, role: shown.has(p.id) ? p.role : null })),
  };
}

const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
function broadcast(r) {
  if (r.gmWs) send(r.gmWs, { type: 'state', s: viewFor(r, { role: 'gm' }) });
  for (const [id, ws] of r.sockets) send(ws, { type: 'state', s: viewFor(r, { role: 'player', id }) });
}

// ---------- message handling ----------
const GM_ONLY = new Set(['config', 'deal', 'set_phase', 'open_turn', 'close_turn', 'kill', 'lynch', 'revive',
  'reassign', 'kick', 'end', 'reveal_next', 'reveal_all', 'undo', 'hunter_done']);

function attach(ws, r, who) {
  ws.ctx = { r, who }; r.last = Date.now();
  if (who.role === 'gm') { r.gmWs?.close(4003); r.gmWs = ws; }
  else { r.sockets.get(who.id)?.close(4003); r.sockets.set(who.id, ws); }
  send(ws, { type: 'joined', code: r.code, token: who.role === 'gm' ? r.gmToken : r.players.get(who.id).token, role: who.role });
  broadcast(r);
}

function handle(ws, m) {
  const err = (msg, extra) => send(ws, { type: 'error', msg, ...extra });
  if (m.type === 'create') {
    if (ws.ctx) return;
    if (HOST_KEY) {
      if (limited(ws.ip)) return err('too many tries, wait 10 minutes');
      if (!keyOk(m.key)) { noteFail(ws.ip); return err('wrong passphrase', { badKey: true }); }
      fails.delete(ws.ip);
    }
    const r = createRoom(m.theme);
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
    r.players.set(p.id, p);
    return attach(ws, r, { role: 'player', id: p.id });
  }
  if (m.type === 'resume') {
    if (ws.ctx) return;
    const r = rooms.get(String(m.code || '').toUpperCase());
    if (!r) return err('room gone', { fatal: true });
    if (m.token === r.gmToken) return attach(ws, r, { role: 'gm' });
    const p = [...r.players.values()].find((x) => x.token === m.token);
    return p ? attach(ws, r, { role: 'player', id: p.id }) : err('session expired', { fatal: true });
  }

  const { r, who } = ws.ctx || {};
  if (!r) return;
  r.last = Date.now();

  if (who.role === 'player') {
    const p = r.players.get(who.id);
    if (!p) return;
    if (m.type === 'ack' && p.role && !p.seen) { p.seen = true; broadcast(r); }
    else if (m.type === 'night_target') {
      const t = r.players.get(m.id);
      if (r.phase !== 'night' || !t || !p.alive || !t.alive || !ROLES[p.role]?.night || r.night.open !== p.role) return;
      if (p.role === 'inspector' && t.id === p.id) return;
      if (p.role === 'killer' && t.role === 'killer') return;
      if (r.night.picks[p.id] === t.id) delete r.night.picks[p.id]; else r.night.picks[p.id] = t.id; // tap again to clear
      broadcast(r);
    }
    return; // players can do nothing else
  }
  if (!GM_ONLY.has(m.type)) return;

  const target = r.players.get(m.id);
  const fail = (msg) => err(msg);
  const live = r.phase === 'night' || r.phase === 'day' || r.phase === 'reveal';

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
      const e = deal(r); if (e) return fail(e);
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
    case 'undo': undo(r); break;
  }
  broadcast(r);
}

// ---------- server ----------
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({
  server, maxPayload: 2048,
  verifyClient: ({ origin }) => !ALLOWED_ORIGIN || ALLOWED_ORIGIN.split(',').map((s) => s.trim().toLowerCase()).includes(String(origin || '').toLowerCase()),
});

wss.on('connection', (ws, req) => {
  ws.ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  let budget = 20, refill = Date.now(); // ~20 msgs per 5s
  ws.on('message', (raw) => {
    const now = Date.now();
    if (now - refill > 5000) { budget = 20; refill = now; }
    if (--budget < 0) return;
    try { handle(ws, JSON.parse(raw)); }
    catch (e) { console.error('handler error', e.message); }
  });
  ws.on('close', () => {
    const { r, who } = ws.ctx || {};
    if (!r) return;
    if (who.role === 'gm') { if (r.gmWs === ws) r.gmWs = null; }
    else if (r.sockets.get(who.id) === ws) r.sockets.delete(who.id);
    broadcast(r);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [ip, f] of fails) if (now > f.until) fails.delete(ip);
  for (const [code, r] of rooms) {
    const empty = !r.gmWs && r.sockets.size === 0;
    if (now - r.last > 2 * 3600e3 || (empty && now - r.last > 15 * 60e3)) {
      r.gmWs?.close(4002); r.sockets.forEach((s) => s.close(4002)); rooms.delete(code);
    }
  }
}, 60e3).unref();

server.listen(PORT, () => console.log(`night table server on :${PORT}`));
export { server, wss };
