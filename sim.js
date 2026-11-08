import WebSocket from 'ws';

const args = new Map(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), values[index + 1] || true]);
  return pairs;
}, []));
const server = String(args.get('server') || 'ws://localhost:8080');
const simKey = String(args.get('sim-key') || process.env.SIM_KEY || '');
const games = Number(args.get('games') || 1);
const parallel = Math.max(1, Number(args.get('parallel') || 1));
const players = String(args.get('players') || '4').split('-').map(Number);
const pace = Math.max(250, Number(args.get('pace') || 300));
let seed = Number(args.get('seed') || 1) >>> 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const random = (max) => {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed % max;
};
function connect() {
  const ws = new WebSocket(server);
  const client = { ws, messages: [], states: [] };
  client.open = new Promise((resolve, reject) => {
    ws.once('open', resolve); ws.once('error', reject);
  });
  client.waitState = async () => {
    while (!client.states.length) await sleep(2);
    return client.states.shift();
  };
  ws.on('message', (raw) => {
    const message = JSON.parse(raw);
    client.messages.push(message);
    if (message.type === 'state') client.states.push(message.s);
  });
  client.send = async (message) => { ws.send(JSON.stringify(message)); await sleep(pace); };
  return client;
}
async function stateAfter(client, message) {
  await client.send(message);
  return client.waitState();
}
async function playGame(playerCount) {
  const started = Date.now();
  const gm = connect(); await gm.open;
  let state = await stateAfter(gm, { type: 'create', sim_key: simKey });
  if (gm.messages.some((message) => message.type === 'error')) throw new Error('simulator create failed');
  const bots = [];
  for (let i = 0; i < playerCount; i++) {
    const bot = connect(); await bot.open;
    await stateAfter(bot, { type: 'join', code: state.code, name: `Bot-${i + 1}` });
    bots.push(bot);
  }
  state = await stateAfter(gm, { type: 'deal' });
  for (const bot of bots) await stateAfter(bot, { type: 'ack' });
  state = await stateAfter(gm, { type: 'set_phase', phase: 'night' });
  for (let round = 0; round < 20 && state.phase !== 'over'; round++) {
    for (const step of state.night.steps) {
      state = await stateAfter(gm, { type: 'open_turn', role: step.role });
      for (const holder of step.holders.filter((item) => item.alive)) {
        const bot = bots.find((candidate) => candidate.states.at(-1)?.me?.id === holder.id);
        if (!bot) continue;
        const botState = bot.states.at(-1) || await bot.waitState();
        if (botState.me.role !== step.role) throw new Error('role secrecy violation');
        const targets = botState.turn?.targets || [];
        if (targets.length) await stateAfter(bot, { type: 'night_target', id: targets[random(targets.length)].id });
      }
      state = await stateAfter(gm, { type: 'close_turn' });
    }
    const killer = state.night.steps.find((step) => step.role === 'killer');
    const victim = killer?.tally?.leader || state.players.find((player) => player.alive && player.role !== 'killer')?.id;
    if (victim) state = await stateAfter(gm, { type: 'kill', id: victim });
    if (state.suggest) break;
    state = await stateAfter(gm, { type: 'set_phase', phase: 'day' });
    const lynch = state.players.find((player) => player.alive && player.role !== 'killer');
    if (lynch) state = await stateAfter(gm, { type: 'lynch', id: lynch.id });
    if (state.suggest) break;
    state = await stateAfter(gm, { type: 'set_phase', phase: 'night' });
  }
  if (!state.suggest) state = await stateAfter(gm, { type: 'end', winner: 'draw' });
  state = await stateAfter(gm, { type: 'reveal_all' });
  for (const client of [gm, ...bots]) client.ws.close();
  return { duration: Date.now() - started, winner: state.winner || 'draw' };
}

const results = [];
try {
  for (let i = 0; i < games; i += parallel) {
    const batch = [];
    for (let j = i; j < Math.min(i + parallel, games); j++) {
      const count = players.length === 1 ? players[0] : players[0] + random(players[1] - players[0] + 1);
      batch.push(playGame(count));
    }
    results.push(...await Promise.all(batch));
  }
  console.log(JSON.stringify({ games: results.length, completed: results.length, results }));
} catch (error) {
  console.error(`simulation failed: ${error.message}`);
  process.exitCode = 1;
}
