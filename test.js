// Smoke test: passphrase, secrecy, night targets, hidden deaths, undo, sequenced reveal.
import assert from 'node:assert/strict';
import WebSocket from 'ws';
process.env.PORT = '8099'; process.env.HOST_KEY = 'hunter2';
const { server } = await import('./index.js');

function client() {
  const ws = new WebSocket('ws://localhost:8099'); const c = { ws, state: null, msgs: [] };
  ws.on('message', (d) => { const m = JSON.parse(d); c.msgs.push(m); if (m.type === 'state') c.state = m.s; if (m.type === 'joined') c.token = m.token; });
  c.open = new Promise((r) => ws.on('open', r));
  c.send = (o) => ws.send(JSON.stringify(o));
  return c;
}
const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));

// passphrase gate
const bad = client(); await bad.open; bad.send({ type: 'create', key: 'nope' }); await wait();
assert.equal(bad.msgs.at(-1).badKey, true); assert.equal(bad.state, null);

const gm = client(); await gm.open; gm.send({ type: 'create', theme: 'mafia', key: 'hunter2' }); await wait();
const code = gm.state.code;
const ps = [];
for (const n of ['Ann', 'Bo', 'Cy', 'Di', 'Ed', 'Fay']) { const p = client(); await p.open; p.send({ type: 'join', code, name: n }); ps.push(p); await wait(30); }
await wait();

ps[0].send({ type: 'deal' }); await wait();
assert.equal(gm.state.phase, 'lobby');                       // players cannot deal
gm.send({ type: 'deal' }); await wait();
assert.equal(gm.state.phase, 'reveal');
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
gm.send({ type: 'kill', id: victim.id }); await wait();

// end + sequenced reveal, killers last, winner only at the end
gm.send({ type: 'end', winner: 'good' }); await wait();
assert.equal(ps[0].state.winner, null);
const total = gm.state.reveal.total; const order = [];
for (let i = 0; i < total; i++) {
  gm.send({ type: 'reveal_next' }); await wait(40);
  const seen = ps[0].state.players.filter((x) => x.role);
  order.push(seen.length);
  assert.equal(ps[0].state.winner, i === total - 1 ? 'good' : null);
}
assert.deepEqual(order, Array.from({ length: total }, (_, i) => i + 1));
const lastKillerIdx = gm.state.players.findIndex((x) => x.role === 'killer');
assert.ok(lastKillerIdx >= 0);

const again = client(); await again.open; again.send({ type: 'resume', code, token: ps[1].token }); await wait();
assert.equal(again.state.me.id, ps[1].state.me.id);

for (const c of [gm, bad, late, again, ...ps]) c.ws.close();
console.log('all checks passed'); server.close(); process.exit(0);
