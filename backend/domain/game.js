import crypto from 'node:crypto';
import { ROLES, defaultRoles, validateRoles } from '../../shared/roles.js';

const freshNight = () => ({ open: null, picks: {}, closed: {} });

function createRoom(code, theme, gmToken) {
  return {
    code, gmToken, theme: theme || 'werewolf',
    phase: 'lobby', round: 0, winner: null, jesterWin: false, hunterPending: false,
    roles: null, dealt: false, night: freshNight(), revealOrder: [], revealCount: 0,
    players: new Map(), sockets: new Map(), gmWs: null,
    log: [], history: [], last: Date.now(),
  };
}

function restoreRoom(saved) {
  return {
    ...saved,
    gmToken: null,
    gmTokenHash: saved.gmTokenHash,
    players: new Map((saved.players || []).map((player) => [
      player.id,
      { ...player, token: null, tokenHash: player.tokenHash },
    ])),
    sockets: new Map(),
    gmWs: null,
    history: [],
  };
}

const snap = (r) => structuredClone({
  phase: r.phase, round: r.round, winner: r.winner, jesterWin: r.jesterWin, hunterPending: r.hunterPending,
  night: r.night, revealOrder: r.revealOrder, revealCount: r.revealCount, log: r.log,
  players: [...r.players.values()],
});
function pushHistory(r) { r.history.push(snap(r)); if (r.history.length > 30) r.history.shift(); }
function undo(r) {
  const s = r.history.pop();
  if (!s) return false;
  const { players, ...rest } = s;
  Object.assign(r, rest);
  for (const sp of players) { const p = r.players.get(sp.id); if (p) Object.assign(p, sp); }
  return true;
}

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

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function deal(r, minPlayers) {
  const n = r.players.size;
  if (n < minPlayers) return `need at least ${minPlayers} players`;
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
  r.log.push({ t: Date.now(), type: 'death', id: p.id, name: p.name, cause, round: r.round });
}

function buildRevealOrder(r) {
  const rank = (p) => (p.role === 'killer' ? 2 : p.alive ? 1 : 0);
  return [...r.players.values()].map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || (a.p.diedAt || 0) - (b.p.diedAt || 0) || a.i - b.i)
    .map((x) => x.p.id);
}

export {
  ROLES, alive, buildRevealOrder, createRoom, deal, freshNight, killPlayer,
  pushHistory, restoreRoom, tally, undo, winCheck,
};
