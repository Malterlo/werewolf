// Smoke test: secrecy, night targets, hidden deaths, undo, sequenced reveal.
import assert from 'node:assert/strict';
import WebSocket from 'ws';
process.env.PORT = '8099';
process.env.SIM_KEY = 'sim-secret';
process.env.ALLOWED_ORIGIN = '';
process.env.DB_PATH = ':memory:';
const { db } = await import('./backend/persistence/database.js');
const { server } = await import('./backend/server.js');
const { restoreRooms } = await import('./backend/services/room-service.js');

function client() {
  const ws = new WebSocket('ws://localhost:8099'); const c = { ws, state: null, msgs: [] };
  ws.on('message', (d) => {
    const m = JSON.parse(d); c.msgs.push(m);
    if (m.type === 'state') c.state = m.s;
    if (m.type === 'joined') c.token = m.token;
    if (m.type === 'gm_key') c.gmKey = m.key;
  });
  c.open = new Promise((r) => ws.on('open', r));
  c.send = (o) => ws.send(JSON.stringify(o));
  return c;
}
const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));

const health = await fetch('http://localhost:8099/health');
assert.equal(health.status, 200);
assert.match(health.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
assert.equal(health.headers.get('x-frame-options'), 'DENY');
assert.deepEqual(await health.json(), { ok: true });
const unauthorizedHistory = await fetch('http://localhost:8099/history');
assert.equal(unauthorizedHistory.status, 401);
assert.equal((await fetch('http://localhost:8099/admin/rooms')).status, 401);
assert.equal((await fetch('http://localhost:8099/admin/api/me')).status, 401);
const adminRedirect = await fetch('http://localhost:8099/admin', { redirect: 'manual' });
assert.equal(adminRedirect.status, 302);
assert.equal(adminRedirect.headers.get('location'), '/auth/google');
const googleStart = await fetch('http://localhost:8099/auth/google', { redirect: 'manual' });
assert.ok([302, 503].includes(googleStart.status));

const simWithoutKey = client(); await simWithoutKey.open;
simWithoutKey.send({ type: 'create', sim_key: 'wrong' }); await wait();
assert.equal(simWithoutKey.msgs.at(-1).msg, 'invalid simulator key');
const simRoom = client(); await simRoom.open;
simRoom.send({ type: 'create', sim_key: 'sim-secret' }); await wait();
assert.equal(db.prepare("SELECT json_extract(snapshot, '$.source') AS source FROM games WHERE code = ?")
  .get(simRoom.state.code).source, 'sim');

const gm = client(); await gm.open; gm.send({ type: 'create', theme: 'mafia' }); await wait();
const code = gm.state.code;
assert.match(gm.gmKey, /^[a-z]+-[a-z]+$/);
assert.ok(!db.prepare('SELECT snapshot FROM games WHERE code = ?').get(code).snapshot.includes(gm.gmKey));
const ps = [];
for (const n of ['Ann', 'Bo', 'Cy', 'Di', 'Ed', 'Fay']) { const p = client(); await p.open; p.send({ type: 'join', code, name: n }); ps.push(p); await wait(30); }
await wait();

ps[0].send({ type: 'deal' }); await wait();
assert.equal(gm.state.phase, 'lobby');                       // players cannot deal
gm.send({ type: 'deal' }); await wait();
assert.equal(gm.state.phase, 'reveal');
const columns = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
assert.deepEqual([...columns('games')].sort(), ['code', 'snapshot', 'updated_at', 'version']);
assert.ok(columns('game_players').has('token_hash'));
assert.ok(columns('events').has('seq'));
assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'events_game_seq'").get());
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM game_players WHERE game_code = ? AND role IS NOT NULL').get(code).count, 0);
const liveEvents = db.prepare('SELECT seq, type, payload FROM events WHERE game_code = ? ORDER BY seq').all(code);
assert.ok(liveEvents.some((event) => event.type === 'deal'));
assert.deepEqual(liveEvents.map((event) => event.seq), liveEvents.map((_, index) => index + 1));
assert.ok(liveEvents.every((event) => !/(pick|token)/i.test(event.payload)));
const dealEvent = JSON.parse(liveEvents.find((event) => event.type === 'deal').payload);
assert.ok(dealEvent.role_counts.killer >= 1);
assert.equal(dealEvent.player_id, undefined);
const liveSnapshot = db.prepare('SELECT snapshot FROM games WHERE code = ?').get(code).snapshot;
assert.ok(!liveSnapshot.includes('"token"'));
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM game_players WHERE game_code = ? AND role IS NOT NULL').get(code).count, 0);
for (const p of ps) { assert.ok(p.state.me.role); assert.ok(p.state.players.every((x) => x.role === null)); }
const late = client(); await late.open; late.send({ type: 'join', code, name: 'Late' }); await wait();
assert.equal(late.msgs.at(-1).msg, 'game already started');   // join blocked after deal

ps.forEach((p) => p.send({ type: 'ack' })); await wait();
gm.send({ type: 'set_phase', phase: 'night' }); await wait();

// night: wolves wake, pick, see mates, only open role can act
const byRole = (r) => gm.state.players.filter((x) => x.role === r).map((x) => ps.find((p) => p.state.me.id === x.id));
const wolves = byRole('killer'); const good = gm.state.players.filter((x) => x.team === 'good');
assert.ok(gm.state.night.steps.some((s) => s.role === 'killer'));
wolves[0].send({ type: 'night_target', id: good[0].id }); await wait();
assert.equal(gm.state.night.steps[0].holders[0].pick, null);   // turn not open yet, ignored
gm.send({ type: 'open_turn', role: 'killer' }); await wait();
assert.ok(wolves[0].state.turn);                               // wolf now has a picker
assert.equal(good.length > 0 && ps.find((p) => p.state.me.id === good[0].id).state.turn, null);
wolves[0].send({ type: 'night_target', id: good[0].id }); await wait();
assert.equal(gm.state.night.steps.find((s) => s.role === 'killer').tally.leader, good[0].id);
wolves[0].send({ type: 'night_target', id: good[1].id }); await wait(); // change pick
assert.equal(gm.state.night.steps.find((s) => s.role === 'killer').tally.leader, good[1].id);
gm.send({ type: 'close_turn' }); await wait();
assert.equal(wolves[0].state.turn, null);

// death stays hidden, undo works
const victim = good[1];
gm.send({ type: 'kill', id: victim.id }); await wait();
const pv = ps.find((p) => p.state.me.id === victim.id);
assert.equal(pv.state.me.alive, false); assert.equal(pv.state.me.role, null);
assert.ok(!JSON.stringify(ps[0].state.log).includes('"role"'));
gm.send({ type: 'undo' }); await wait();
assert.equal(gm.state.players.find((x) => x.id === victim.id).alive, true);
const eventsAfterUndo = db.prepare('SELECT seq, type, payload FROM events WHERE game_code = ? ORDER BY seq').all(code);
assert.equal(eventsAfterUndo.at(-1).type, 'undo');
assert.equal(JSON.parse(eventsAfterUndo.at(-1).payload).compensates_change, true);
assert.equal(eventsAfterUndo.filter((event) => event.type === 'kill').length, 1);
gm.send({ type: 'kill', id: victim.id }); await wait();

// end + sequenced reveal, killers last, winner only at the end
gm.send({ type: 'end', winner: 'good' }); await wait();
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM game_players WHERE game_code = ? AND role IS NOT NULL').get(code).count, ps.length);
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM finished_games WHERE code = ?').get(code).count, 0);
assert.equal(ps[0].state.winner, null);
const total = gm.state.reveal.total; const order = [];
for (let i = 0; i < total; i++) {
  gm.send({ type: 'reveal_next' }); await wait(40);
  const seen = ps[0].state.players.filter((x) => x.role);
  order.push(seen.length);
  assert.equal(ps[0].state.winner, i === total - 1 ? 'good' : null);
}
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM games WHERE code = ?').get(code).count, 0);
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM game_players WHERE game_code = ?').get(code).count, 0);
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM finished_games WHERE code = ?').get(code).count, 1);
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM finished_players WHERE game_code = ?').get(code).count, ps.length);
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM finished_events WHERE game_code = ?').get(code).count > 0, true);
assert.equal((await fetch(`http://localhost:8099/history/${code}`)).status, 401);
assert.deepEqual(order, Array.from({ length: total }, (_, i) => i + 1));
const lastKillerIdx = gm.state.players.findIndex((x) => x.role === 'killer');
assert.ok(lastKillerIdx >= 0);

const again = client(); await again.open; again.send({ type: 'resume', code, token: ps[1].token }); await wait();
assert.equal(again.state.me.id, ps[1].state.me.id);
assert.equal(again.msgs.findLast((message) => message.type === 'joined').resynced, true);
assert.equal(again.msgs.some((message) => message.type === 'resynced'), true);
assert.equal(again.token, ps[1].token);

const restoredRooms = new Map();
restoreRooms(restoredRooms);
const restored = restoredRooms.get(code);
assert.equal(restored, undefined);

// leave test
const gm2 = client(); await gm2.open; gm2.send({ type: 'create' }); await wait();
const p1 = client(); await p1.open; p1.send({ type: 'join', code: gm2.state.code, name: 'P1' }); await wait();
const p2 = client(); await p2.open; p2.send({ type: 'join', code: gm2.state.code, name: 'P2' }); await wait();
assert.equal(gm2.state.players.length, 2);
const liveRestoredRooms = new Map();
restoreRooms(liveRestoredRooms);
const liveRestored = liveRestoredRooms.get(gm2.state.code);
assert.ok(liveRestored);
assert.equal(liveRestored.gmWs, null);
assert.equal(liveRestored.sockets.size, 0);
assert.ok([...liveRestored.players.values()].every((p) => !p.token && p.tokenHash));

const claimOwner = client(); await claimOwner.open;
claimOwner.send({ type: 'create' }); await wait();
const claimCode = claimOwner.state.code;
const oldGmKey = claimOwner.gmKey;
const claimant = client(); await claimant.open;
claimant.send({ type: 'claim_gm', code: claimCode, key: oldGmKey, nickname: 'New GM' }); await wait();
assert.equal(claimant.msgs.findLast((message) => message.type === 'joined').role, 'gm');
assert.ok(claimant.gmKey && claimant.gmKey !== oldGmKey);
const staleClaim = client(); await staleClaim.open;
staleClaim.send({ type: 'claim_gm', code: claimCode, key: oldGmKey, nickname: 'Stale' }); await wait();
assert.equal(staleClaim.msgs.at(-1).msg, 'bad GM key');
assert.ok(db.prepare("SELECT COUNT(*) AS count FROM security_events WHERE type = 'gm_claim_failed'").get().count >= 1);
const adminRooms = await fetch('http://localhost:8099/admin/rooms');
assert.equal(adminRooms.status, 401);
const securityEvents = await fetch('http://localhost:8099/admin/security-events?limit=10', {
});
assert.equal(securityEvents.status, 401);

const abortOwner = client(); await abortOwner.open;
abortOwner.send({ type: 'create' }); await wait();
const abortCode = abortOwner.state.code;
const abortPlayers = [];
for (const n of ['A', 'B', 'C', 'D']) {
  const p = client(); await p.open; p.send({ type: 'join', code: abortCode, name: n }); abortPlayers.push(p); await wait(25);
}
abortOwner.send({ type: 'deal' }); await wait();
assert.equal(abortOwner.state.phase, 'reveal');
abortOwner.send({ type: 'abort' }); await wait();
assert.equal(abortOwner.state.phase, 'lobby');
assert.ok(abortOwner.state.players.every((player) => player.role === null));
assert.equal(db.prepare('SELECT end_reason FROM finished_games WHERE code = ?').get(abortCode).end_reason, 'aborted');
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM finished_players WHERE game_code = ?').get(abortCode).count, 0);

const passOwner = client(); await passOwner.open;
passOwner.send({ type: 'create' }); await wait();
const passCode = passOwner.state.code;
const passPlayer = client(); await passPlayer.open;
passPlayer.send({ type: 'join', code: passCode, name: 'New Host' }); await wait();
passOwner.send({ type: 'pass_gm', id: passOwner.state.players[0].id }); await wait();
assert.equal(passPlayer.msgs.findLast((message) => message.type === 'joined').role, 'gm');
assert.equal(passOwner.msgs.findLast((message) => message.type === 'joined').role, 'player');
assert.equal(passPlayer.state.you, 'gm');
assert.equal(passOwner.state.you, 'player');
p2.send({ type: 'leave' }); await wait();
assert.equal(gm2.state.players.length, 1);
assert.equal(gm2.state.players[0].name, 'P1');
let closedCode = null; p1.ws.on('close', (c) => { closedCode = c; });
gm2.send({ type: 'leave' }); await wait();
assert.equal(closedCode, 4002);

for (const c of [gm, late, again, gm2, p1, p2, claimOwner, claimant, staleClaim, simWithoutKey, simRoom,
  abortOwner, ...abortPlayers, passOwner, passPlayer, ...ps]) { try { c.ws.close(); } catch {} }
console.log('all checks passed'); server.close(); process.exit(0);
