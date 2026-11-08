// ---------- config ----------
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
const qs = new URLSearchParams(location.search);
const paramServer = qs.get('server');
if (paramServer) store.set('nt_server', paramServer);

function resolveWsUrl() {
  if (paramServer) return paramServer;
  const saved = store.get('nt_server');
  if (saved) return saved;
  const host = location.host;
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (location.hostname.endsWith('.trycloudflare.com')) {
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + host;
  }
  if (isLocal) {
    return 'ws://localhost:8080';
  }
  return 'wss://flame-experience-hits-elsewhere.trycloudflare.com';
}

const WS_URL = resolveWsUrl();
const HTTP_URL = qs.get('http') || WS_URL.replace(/^ws/, 'http').replace(/\/$/, '');
const KEY = 'nighttable';

// ---------- i18n (Khmer strings are a first draft: have a native speaker review) ----------
let lang = store.get('nt_lang') || ((navigator.language || '').startsWith('km') ? 'km' : 'en');
const L = {
  en: {
    name: 'Your name', code: 'Room code', join: 'Join game', host: 'Host a game',
    admin: 'Admin sign in', advanced: 'Advanced options',
    claim: 'Recover GM control', gmkey: 'GM recovery key', nickname: 'GM nickname', claimgm: 'Recover control',
    makegm: 'Make GM', abort: 'Abort game', q_abort: 'Abort this game? Roles will not be saved.',
    create: 'Create room as host', enter: 'Enter your name and the 4-letter code', rejoin: 'Rejoining…', startover: 'Start over',
    room: 'Room', rules: 'Rules', gotit: 'Got it', waitdeal: 'Waiting for the host to deal cards.', inroom: 'In the room',
    players: 'Players', events: 'Events', you: 'you', out: 'out', offline: 'offline', none: 'Nothing has happened yet.',
    hold: 'Hold the card to look. Let go to hide it.', dead: 'You are out', deadsub: 'Stay quiet. Roles are shown at the end.',
    waitnight: 'Waiting for the host to start the night.', night_n: 'Night {n}', day_n: 'Day {n}',
    eyes: 'Eyes closed. Camera off. Mic muted.', choose: 'Choose your target', tapclear: 'Tap again to clear. Wait for the host to close your turn.',
    mates: 'Your pack', sound: 'Sound', lobby: 'Lobby', dealt: 'Cards dealt', over: 'Game over', alive: 'alive',
    sharecode: 'Share this code. Players join on their own phones.', noone: 'No one yet.', remove: 'Remove', roles: 'Roles',
    fill: '{n} {r} fill the rest.', deal: 'Deal cards', need4: 'Need 4 players', undo: 'Undo',
    seen: '{a}/{b} players have looked at their card.', startnight: 'Start night {n}', startday: 'Start day', redeal: 'Re-deal',
    say: 'Say: “{t}”', saynight: 'Then wake each role below, one at a time.', sayday: 'Announce who fell, then let them vote out loud.',
    hunterout: '{r} is out. Let them name a target, then use Shot on that player.', done: 'Done', endgame: 'End game',
    s_good: 'Good side has won.', s_evil: '{r} have won.', s_jester: '{r} was lynched.',
    nightpanel: 'Night turns', wake: 'Wake', closeturn: 'Close turn', wakeline: '“{r}, open your eyes.”', deadholder: '(out)', nopick: 'no pick yet',
    majority: 'Majority: {n}', split: 'Split. You decide.', killhim: 'Kill {n}',
    kill: 'Kill (night)', lynch: 'Lynch', shot: 'Shot (by {r})', revive: 'Bring back', removeroom: 'Remove from room', close: 'Close',
    changerole: 'Change role', confirm: 'Confirm', cancel: 'Cancel', leave: 'Leave room', q_leave: 'Leave this room?',
    leave_hint: 'You will leave and return to the home screen.', leave_gm_hint: 'Leaving in the lobby closes the room for all players.',
    q_kill: 'Kill {n}?', q_lynch: 'Lynch {n}?', q_shot: 'Shoot {n}?',
    flip: 'Flip next card', revealall: 'Reveal all', progress: '{a}/{b} revealed', next: 'Next: {n}', killerslast: 'The {r} are revealed last.',
    w_good: 'The good side wins.', w_evil: 'The {r} win.', w_jester: 'The {r} wins.', w_draw: 'Nobody wins.',
    d_night: '{n} was killed in the night.', d_lynch: '{n} was lynched.', d_shot: '{n} was shot.', revived: '{n} is back in the game.',
    p_night: 'Night {n}. {t}', p_day: 'Day {n}. {t}', reconnecting: 'Reconnecting…', removed: 'The host removed you', closed: 'Room closed',
    r_title: 'How this game works', r_sub: 'Everyone talks and votes out loud. The host keeps score in the app.', r_goals: 'Goals',
    r_each: 'Each round', r_night: 'Night. Close your eyes. Open them only when the host calls your role.',
    r_day: 'Day. The host announces who fell. Discuss, then vote out loud.', r_roles: 'Roles in this game',
    t_evil: 'Killers', t_good: 'Good side', t_neutral: 'Neutral', g_evil: 'Kill until the killers match or outnumber everyone else.',
    g_good: 'Find and eliminate every killer.', g_neutral: 'Get yourself lynched by the group.',
    server_settings: 'Server connection', save: 'Save', reset: 'Reset', copy_invite: 'Copy invite link',
    link_copied: 'Invite link copied!', enter_server: 'Enter a valid WebSocket URL',
  },
  km: {
    name: 'ឈ្មោះរបស់អ្នក', code: 'លេខកូដបន្ទប់', join: 'ចូលហ្គេម', host: 'បង្កើតហ្គេម',
    admin: 'ចូលជាអ្នកគ្រប់គ្រង', advanced: 'ជម្រើសកម្រិតខ្ពស់',
    create: 'បង្កើតបន្ទប់', enter: 'បញ្ចូលឈ្មោះ និងលេខកូដ ៤ តួអក្សរ', rejoin: 'កំពុងចូលឡើងវិញ…', startover: 'ចាប់ផ្តើមឡើងវិញ',
    room: 'បន្ទប់', rules: 'ច្បាប់', gotit: 'យល់ហើយ', waitdeal: 'កំពុងរង់ចាំអ្នកដឹកនាំចែកបៀ។', inroom: 'នៅក្នុងបន្ទប់',
    players: 'អ្នកលេង', events: 'ព្រឹត្តិការណ៍', you: 'អ្នក', out: 'ចេញ', offline: 'ក្រៅបណ្តាញ', none: 'មិនទាន់មានអ្វីកើតឡើងទេ។',
    hold: 'ចុចសង្កត់បៀដើម្បីមើល។ លែងដើម្បីលាក់។', dead: 'អ្នកត្រូវបានចេញ', deadsub: 'សូមស្ងាត់ស្ងៀម។ តួនាទីនឹងបង្ហាញនៅចុងបញ្ចប់។',
    waitnight: 'កំពុងរង់ចាំអ្នកដឹកនាំចាប់ផ្តើមយប់។', night_n: 'យប់ទី {n}', day_n: 'ថ្ងៃទី {n}',
    eyes: 'បិទភ្នែក។ បិទកាមេរ៉ា។ បិទមីក្រូហ្វូន។', choose: 'ជ្រើសរើសគោលដៅរបស់អ្នក', tapclear: 'ចុចម្តងទៀតដើម្បីលុប។ រង់ចាំអ្នកដឹកនាំបិទវេនរបស់អ្នក។',
    mates: 'ក្រុមរបស់អ្នក', sound: 'សំឡេង', lobby: 'បន្ទប់រង់ចាំ', dealt: 'បានចែកបៀហើយ', over: 'ហ្គេមចប់', alive: 'នៅរស់',
    sharecode: 'ចែករំលែកលេខកូដនេះ។ អ្នកលេងចូលតាមទូរស័ព្ទរបស់ខ្លួន។', noone: 'មិនទាន់មាននរណាទេ។', remove: 'ដកចេញ', roles: 'តួនាទី',
    fill: '{r} {n} នាក់ ជាអ្នកដែលនៅសល់។', deal: 'ចែកបៀ', need4: 'ត្រូវការអ្នកលេង ៤ នាក់', undo: 'ត្រឡប់វិញ',
    seen: 'អ្នកលេង {a}/{b} នាក់បានមើលបៀរួចហើយ។', startnight: 'ចាប់ផ្តើមយប់ទី {n}', startday: 'ចាប់ផ្តើមថ្ងៃ', redeal: 'ចែកបៀម្តងទៀត',
    say: 'និយាយថា៖ «{t}»', saynight: 'បន្ទាប់មកដាស់តួនាទីខាងក្រោមម្តងមួយៗ។', sayday: 'ប្រកាសអ្នកដែលស្លាប់ រួចឲ្យពួកគេបោះឆ្នោតដោយសំឡេង។',
    hunterout: '{r} ត្រូវចេញ។ ឲ្យគាត់ជ្រើសគោលដៅ រួចប្រើ «បាញ់» លើអ្នកនោះ។', done: 'រួចរាល់', endgame: 'បញ្ចប់ហ្គេម',
    s_good: 'ភាគីល្អបានឈ្នះ។', s_evil: '{r} បានឈ្នះ។', s_jester: '{r} ត្រូវបានប្រហារ។',
    nightpanel: 'វេនពេលយប់', wake: 'ដាស់', closeturn: 'បិទវេន', wakeline: '«{r} សូមបើកភ្នែក។»', deadholder: '(ចេញ)', nopick: 'មិនទាន់ជ្រើស',
    majority: 'សំឡេងភាគច្រើន៖ {n}', split: 'បែកគ្នា។ អ្នកសម្រេច។', killhim: 'សម្លាប់ {n}',
    kill: 'សម្លាប់ (យប់)', lynch: 'ប្រហារ', shot: 'បាញ់ (ដោយ {r})', revive: 'នាំត្រឡប់មកវិញ', removeroom: 'ដកចេញពីបន្ទប់', close: 'បិទ',
    changerole: 'ប្តូរតួនាទី', confirm: 'បញ្ជាក់', cancel: 'បោះបង់', leave: 'ចាកចេញពីបន្ទប់', q_leave: 'ចាកចេញពីបន្ទប់?',
    leave_hint: 'អ្នកនឹងចាកចេញ ហើយត្រឡប់ទៅទំព័រដើម។', leave_gm_hint: 'ការចាកចេញក្នុងបន្ទប់រង់ចាំ នឹងបិទបន្ទប់សម្រាប់អ្នកលេងទាំងអស់។',
    q_kill: 'សម្លាប់ {n} មែនទេ?', q_lynch: 'ប្រហារ {n} មែនទេ?', q_shot: 'បាញ់ {n} មែនទេ?',
    flip: 'បើកបៀបន្ទាប់', revealall: 'បើកទាំងអស់', progress: 'បានបើក {a}/{b}', next: 'បន្ទាប់៖ {n}', killerslast: '{r} នឹងត្រូវបើកចុងក្រោយ។',
    w_good: 'ភាគីល្អឈ្នះ។', w_evil: '{r} ឈ្នះ។', w_jester: '{r} ឈ្នះ។', w_draw: 'គ្មានអ្នកឈ្នះទេ។',
    d_night: '{n} ត្រូវបានសម្លាប់នៅពេលយប់។', d_lynch: '{n} ត្រូវបានប្រហារ។', d_shot: '{n} ត្រូវបានបាញ់។', revived: '{n} ត្រឡប់មកក្នុងហ្គេមវិញ។',
    p_night: 'យប់ទី {n}។ {t}', p_day: 'ថ្ងៃទី {n}។ {t}', reconnecting: 'កំពុងភ្ជាប់ឡើងវិញ…', removed: 'អ្នកដឹកនាំបានដកអ្នកចេញ', closed: 'បន្ទប់ត្រូវបានបិទ',
    r_title: 'របៀបលេង', r_sub: 'គ្រប់គ្នានិយាយ និងបោះឆ្នោតដោយសំឡេង។ អ្នកដឹកនាំកត់ត្រានៅក្នុងកម្មវិធី។', r_goals: 'គោលដៅ',
    r_each: 'ក្នុងមួយជុំ', r_night: 'យប់។ បិទភ្នែក។ បើកភ្នែកតែពេលអ្នកដឹកនាំហៅតួនាទីរបស់អ្នក។',
    r_day: 'ថ្ងៃ។ អ្នកដឹកនាំប្រកាសអ្នកដែលស្លាប់។ ពិភាក្សា រួចបោះឆ្នោតដោយសំឡេង។', r_roles: 'តួនាទីក្នុងហ្គេមនេះ',
    t_evil: 'ឃាតក', t_good: 'ភាគីល្អ', t_neutral: 'អព្យាក្រឹត', g_evil: 'សម្លាប់រហូតដល់ឃាតកស្មើ ឬច្រើនជាងអ្នកផ្សេង។',
    g_good: 'រក និងកម្ចាត់ឃាតកទាំងអស់។', g_neutral: 'ធ្វើឲ្យក្រុមប្រហារអ្នក។',
    server_settings: 'ការតភ្ជាប់ម៉ាស៊ីនបម្រើ', save: 'រក្សាទុក', reset: 'កំណត់ឡើងវិញ', copy_invite: 'ចម្លងតំណអញ្ជើញ',
    link_copied: 'បានចម្លងតំណអញ្ជើញ!', enter_server: 'សូមបញ្ចូល URL WebSocket ត្រឹមត្រូវ',
  },
};
const t = (k, v = {}) => String(L[lang][k] ?? L.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
const tx = (o) => o[lang] || o.en;

// ---------- themes (display only; server never sends names or art) ----------
const R = (en, km, e, ben, bkm) => ({ n: { en, km }, e, b: { en: ben, km: bkm } });
const THEMES = {
  werewolf: { name: 'Werewolf', sym: '🌙',
    tag: { en: 'The village sleeps. Someone does not.', km: 'ភូមិកំពុងគេង។ មានម្នាក់មិនគេងទេ។' },
    night: { en: 'Night falls. Everyone closes their eyes.', km: 'យប់មកដល់។ គ្រប់គ្នាបិទភ្នែក។' },
    day: { en: 'Dawn. The village wakes and argues.', km: 'ព្រឹកមកដល់។ ភូមិភ្ញាក់ឡើង ហើយជជែកគ្នា។' },
    roles: {
      killer: R('Werewolf', 'ចចក', '🐺', 'Each night the wolves choose someone to eliminate. Blend in by day.', 'រាល់យប់ ចចកជ្រើសរើសម្នាក់ដើម្បីសម្លាប់។ ក្លែងខ្លួនជាអ្នកភូមិនៅពេលថ្ងៃ។'),
      townsfolk: R('Villager', 'អ្នកភូមិ', '🧑‍🌾', 'No power but your voice. Find the wolves and vote them out.', 'គ្មានអំណាចក្រៅពីសំឡេងរបស់អ្នក។ រកចចក ហើយបោះឆ្នោតបណ្តេញវា។'),
      inspector: R('Seer', 'គ្រូទាយ', '🔮', 'Each night you pick one player. The host tells you privately if they are a wolf.', 'រាល់យប់ អ្នកជ្រើសអ្នកលេងម្នាក់។ អ្នកដឹកនាំប្រាប់អ្នកជាឯកជនថាគាត់ជាចចកឬអត់។'),
      protector: R('Doctor', 'គ្រូពេទ្យ', '🩺', 'Each night, protect one player from the wolves.', 'រាល់យប់ ការពារអ្នកលេងម្នាក់ពីចចក។'),
      hunter: R('Hunter', 'ព្រានព្រៃ', '🏹', 'If you die, take one player down with you.', 'ប្រសិនបើអ្នកស្លាប់ អ្នកអាចបាញ់អ្នកលេងម្នាក់ឲ្យស្លាប់តាម។'),
      jester: R('Jester', 'តួកំប្លែង', '🃏', 'You win only if the village lynches you.', 'អ្នកឈ្នះលុះត្រាតែភូមិប្រហារអ្នក។'),
    } },
  mafia: { name: 'Mafia', sym: '♠',
    tag: { en: 'The city sleeps. The family does not.', km: 'ទីក្រុងកំពុងគេង។ គ្រួសារមិនគេងទេ។' },
    night: { en: 'Night falls on the city. Everyone closes their eyes.', km: 'យប់ធ្លាក់លើទីក្រុង។ គ្រប់គ្នាបិទភ្នែក។' },
    day: { en: 'Morning. The city looks for the Mafia.', km: 'ព្រឹក។ ទីក្រុងស្វែងរកម៉ាហ្វៀ។' },
    roles: {
      killer: R('Mafioso', 'ម៉ាហ្វៀ', '🕴️', 'Each night the Mafia picks a target. Act innocent by day.', 'រាល់យប់ ម៉ាហ្វៀជ្រើសគោលដៅ។ ធ្វើជាអ្នកស្លូតត្រង់នៅពេលថ្ងៃ។'),
      townsfolk: R('Citizen', 'ប្រជាពលរដ្ឋ', '🧍', 'No power but your voice. Find the Mafia and vote them out.', 'គ្មានអំណាចក្រៅពីសំឡេងរបស់អ្នក។ រកម៉ាហ្វៀ ហើយបោះឆ្នោតបណ្តេញ។'),
      inspector: R('Detective', 'អ្នកស៊ើបអង្កេត', '🕵️', 'Each night you pick one player. The host tells you privately if they are Mafia.', 'រាល់យប់ អ្នកជ្រើសអ្នកលេងម្នាក់។ អ្នកដឹកនាំប្រាប់អ្នកជាឯកជនថាគាត់ជាម៉ាហ្វៀឬអត់។'),
      protector: R('Bodyguard', 'អង្គរក្ស', '🛡️', 'Each night, protect one player from the Mafia.', 'រាល់យប់ ការពារអ្នកលេងម្នាក់ពីម៉ាហ្វៀ។'),
      hunter: R('Avenger', 'អ្នកសងសឹក', '🔫', 'If you die, take one player down with you.', 'ប្រសិនបើអ្នកស្លាប់ អ្នកអាចបាញ់អ្នកលេងម្នាក់ឲ្យស្លាប់តាម។'),
      jester: R('Fool', 'តួកំប្លែង', '🎭', 'You win only if the city lynches you.', 'អ្នកឈ្នះលុះត្រាតែទីក្រុងប្រហារអ្នក។'),
    } },
};
const TEAM = { killer: 'evil', jester: 'neutral' };
const teamOf = (r) => TEAM[r] || 'good';

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let S = null, pref = 'werewolf';
const theme = () => THEMES[(S && S.theme) || pref];
const rname = (r) => tx(theme().roles[r].n);
const remoji = (r) => theme().roles[r].e;
const nameOf = (id) => (S.players.find((p) => p.id === id) || {}).name || '?';
const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };
function flash(msg) {
  const d = document.createElement('div'); d.textContent = msg; $('#toast').append(d);
  setTimeout(() => d.remove(), 3600);
}
const getSession = () => { try { return JSON.parse(store.get(KEY)); } catch { return null; } };
const setSession = (s) => store.set(KEY, s ? JSON.stringify(s) : null);

// ---------- sound: per-player toggle, default off ----------
let snd = store.get('nt_snd') === '1', ac = null, amb = null;
const audio = () => { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); return ac; };
function ambient(on) {
  if (on && !amb) {
    const c = audio(), len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
    const g = c.createGain(); g.gain.value = 0.05;
    src.connect(f); f.connect(g); g.connect(c.destination); src.start(); amb = src;
  } else if (!on && amb) { amb.stop(); amb = null; }
}
function sting() {
  if (!snd) return;
  const c = audio(), o = c.createOscillator(), g = c.createGain();
  o.frequency.value = 70; g.gain.setValueAtTime(0.2, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 1.2);
  o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 1.2);
}

// ---------- connection ----------
let ws, online = false, retry = 0, lastLog = null;
let tab = 'players', sel = null, holding = false, pending = false, acked = false, holdTimer, doIt = null;
const animated = new Set(); let newly = [];

function connect(first) {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => { online = true; retry = 0; const ses = getSession();
    ws.send(JSON.stringify(first || (ses && { type: 'resume', code: ses.code, token: ses.token }) || { type: 'noop' })); render(); };
  ws.onmessage = (e) => onMsg(JSON.parse(e.data));
  ws.onclose = (e) => {
    online = false;
    if ([4002, 4003, 4004].includes(e.code)) {
      if (e.code !== 4003) setSession(null);
      S = null; if (e.code === 4004) flash(t('removed')); if (e.code === 4002) flash(t('closed')); return render();
    }
    if (getSession()) setTimeout(() => connect(), Math.min(1000 * 2 ** retry++, 8000));
    render();
  };
}
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); else connect(o); }

function onMsg(m) {
  if (m.type === 'joined') setSession({ code: m.code, token: m.token, role: m.role });
  else if (m.type === 'gm_key') flash(`Save this GM recovery key: ${m.key}`);
  else if (m.type === 'error') {
    flash(m.msg); if (m.badKey) store.set('nt_key', null);
    if (m.fatal) { setSession(null); S = null; render(); }
  } else if (m.type === 'state') {
    const s = m.s;
    if (S && S.you === 'player') {
      const log = s.log, prev = lastLog;
      if (log.length && (!prev || log[log.length - 1].t !== prev.t)) announce(log[log.length - 1]);
      if (s.turn && !S.turn) buzz([50, 30, 50]);
      if (s.reveal && S.reveal && s.reveal.shown > S.reveal.shown) {
        const fresh = s.players.filter((p) => p.role && !(S.players.find((q) => q.id === p.id) || {}).role);
        if (fresh.some((p) => p.role === 'killer')) { buzz([90, 50, 90]); sting(); } else buzz(30);
      }
    }
    lastLog = s.log.length ? s.log[s.log.length - 1] : null;
    if (s.me && s.me.role !== (S && S.me && S.me.role)) acked = false;
    S = s; render();
  }
}

function logText(e) {
  if (e.type === 'death') return t(e.cause === 'lynch' ? 'd_lynch' : e.cause === 'shot' ? 'd_shot' : 'd_night', { n: e.name });
  if (e.type === 'revive') return t('revived', { n: e.name });
  if (e.type === 'phase') return t(e.phase === 'night' ? 'p_night' : 'p_day', { n: e.round, t: tx(theme()[e.phase]) });
}
function announce(e) {
  const x = logText(e); if (!x) return;
  if (e.type === 'phase' && e.phase === 'night') return buzz(30); // night stays quiet
  flash(x); buzz(e.type === 'death' ? [60, 40, 60] : 30); if (e.type === 'death') sting();
}

// ---------- views ----------
function render() {
  if (holding) { pending = true; return; }
  document.documentElement.dataset.theme = (S && S.theme) || pref;
  document.documentElement.lang = lang;
  const nightPlayer = !!(S && S.you === 'player' && S.phase === 'night' && S.me && S.me.alive);
  document.body.classList.toggle('nightmode', nightPlayer);
  ambient(snd && nightPlayer);
  newly = [];
  let h = !S ? home() : S.you === 'gm' ? gmView() : playerView();
  if (!online && getSession()) h += `<div class="off">${esc(t('reconnecting'))}</div>`;
  $('#app').innerHTML = h;
  newly.forEach((id) => animated.add(id));
}

const langBtn = () => `<button class="btn lang" data-act="lang" aria-label="Language">${lang === 'en' ? 'ខ្មែរ' : 'EN'}</button>`;

function home() {
  const ses = getSession();
  if (ses) return `<div class="stack" style="padding-top:20vh"><h2>${esc(t('rejoin'))}</h2><p class="dim">${esc(t('room'))} ${esc(ses.code)}</p>
    <button class="btn danger" data-act="forget">${esc(t('leave'))}</button></div>`;
  return `<div class="stack" style="padding-top:6vh"><div class="row"><div class="grow"></div>${langBtn()}</div>
    <div><h1>Night Table</h1><p class="dim">${esc(tx(THEMES[pref].tag))}</p></div>
    <div class="stack">
      <input id="jname" placeholder="${esc(t('name'))}" maxlength="16" autocomplete="off">
      <input id="jcode" placeholder="${esc(t('code'))}" value="${esc(qs.get('code') || '')}" maxlength="4" autocapitalize="characters" autocomplete="off">
      <button class="btn primary" data-act="join">${esc(t('join'))}</button>
    </div>
    <hr style="border:0;border-top:1px solid var(--line);width:100%">
    <div class="stack"><h3>${esc(t('host'))}</h3>
      <select id="theme" aria-label="Theme">${Object.entries(THEMES).map(([k, x]) => `<option value="${k}" ${k === pref ? 'selected' : ''}>${x.name}</option>`).join('')}</select>
      <button class="btn" data-act="create">${esc(t('create'))}</button>
    </div>
    <details class="advanced-options">
      <summary>${esc(t('advanced'))}</summary>
      <div class="stack">
        <a class="btn admin-link" href="${esc(`${HTTP_URL}/auth/google`)}">${esc(t('admin'))}</a>
        <h3>${esc(t('server_settings'))}</h3>
        <input id="srv-url" placeholder="wss://... or ws://..." value="${esc(WS_URL)}" autocomplete="off">
        <div class="row" style="gap:8px">
          <button class="btn grow" data-act="set_server">${esc(t('save'))}</button>
          <button class="btn danger grow" data-act="reset_server">${esc(t('reset'))}</button>
        </div>
        <h3>${esc(t('claim'))}</h3>
        <input id="gcode" placeholder="${esc(t('code'))}" maxlength="4" autocapitalize="characters">
        <input id="gkey" placeholder="${esc(t('gmkey'))}" autocomplete="off">
        <input id="gnick" placeholder="${esc(t('nickname'))}" maxlength="16" autocomplete="off">
        <button class="btn" data-act="claim">${esc(t('claimgm'))}</button>
      </div>
    </details></div>`;
}

function playerList() {
  const over = S.phase === 'over';
  return `<ul class="list">${S.players.map((p) => {
    const pop = over && p.role && !animated.has(p.id); if (pop) newly.push(p.id);
    return `<li class="${p.alive ? '' : 'dead'}"><span class="grow">${esc(p.name)}${S.me && p.id === S.me.id ? ` <span class="dim">(${esc(t('you'))})</span>` : ''}</span>
      ${p.role ? `<span class="chip ${pop ? 'pop' : ''}">${remoji(p.role)} ${esc(rname(p.role))}</span>` : ''}${p.alive ? '' : `<span class="chip">${esc(t('out'))}</span>`}</li>`;
  }).join('')}</ul>`;
}
function logList() {
  const items = S.log.map(logText).filter(Boolean).reverse();
  return items.length ? `<ul class="list">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="dim">${esc(t('none'))}</p>`;
}
function winnerBanner() {
  if (!S.winner) return '';
  const k = rname('killer'), j = rname('jester');
  const w = { good: t('w_good'), evil: t('w_evil', { r: k }), jester: t('w_jester', { r: j }), draw: t('w_draw') }[S.winner];
  return `<div class="banner"><h2>${esc(w)}</h2></div>`;
}

function playerHead() {
  return `<div class="row" style="flex-wrap:wrap;gap:8px"><div class="grow"><h3>${esc(S.me.name)}</h3><span class="dim">${esc(t('room'))} ${esc(S.code)}</span></div>
    <div class="row" style="gap:6px">
      <button class="btn" style="min-height:38px;padding:0 10px" data-act="snd" aria-pressed="${snd}" aria-label="${esc(t('sound'))}">${snd ? '🔊' : '🔇'}</button>
      <button class="btn" style="min-height:38px;padding:0 10px" data-act="rules" ${S.inPlay.length ? '' : 'disabled'}>${esc(t('rules'))}</button>
      <button class="btn danger" style="min-height:38px;padding:0 10px" data-act="leave">${esc(t('leave'))}</button>
      ${langBtn()}
    </div></div>`;
}

function nightView() {
  const k = S.turn;
  if (!k) return `<div class="night-wrap"><div style="text-align:center"><p style="font-size:2rem;margin:0">🌙</p><p>${esc(t('eyes'))}</p><p class="faint">${esc(t('night_n', { n: S.round }))}</p></div></div>`;
  return `<div class="night-wrap"><div class="stack" style="width:100%"><p style="text-align:center">${esc(t('choose'))}</p>
    ${k.targets.map((x) => { const who = k.mates.filter((m) => m.pick === x.id).map((m) => m.name);
      return `<button class="pick ${k.pick === x.id ? 'on' : ''}" data-night="${x.id}">${esc(x.name)}${who.length ? ` <small>· ${esc(who.join(', '))}</small>` : ''}</button>`; }).join('')}
    <p class="faint" style="text-align:center">${esc(t('tapclear'))}</p>
    ${k.mates.length ? `<p class="faint" style="text-align:center">${esc(t('mates'))}: ${esc(k.mates.map((m) => m.name).join(', '))}</p>` : ''}</div></div>`;
}

function playerView() {
  const me = S.me, T = theme();
  if (S.phase === 'night' && me.alive) return nightView();
  const head = playerHead();
  if (S.phase === 'over') return `<div class="stack">${head}${winnerBanner()}
    <p class="dim" style="text-align:center">${esc(t('progress', { a: S.reveal.shown, b: S.reveal.total }))}</p>${playerList()}</div>`;
  if (!me.role && me.alive) return `<div class="stack">${head}<div class="stage"><div class="card"><div class="back"><span>${T.sym}</span></div></div></div>
    <p class="hint">${esc(t('waitdeal'))}</p><h3>${esc(t('inroom'))}</h3>${playerList()}</div>`;
  const tc = { evil: 'var(--evil)', neutral: 'var(--neutral)', good: 'var(--good)' }[teamOf(me.role)];
  const phase = S.phase === 'reveal' ? t('waitnight') : S.phase === 'night' ? '' : `${t('day_n', { n: S.round })}. ${tx(T.day)}`;
  return `<div class="stack">${head}
    <div class="stage">${me.alive ? `<div class="card" data-card style="--tc:${tc}"><div class="inner"><div class="back"><span>${T.sym}</span></div><div class="face"></div></div></div>`
      : `<div style="text-align:center"><span class="dead-stamp">${esc(t('dead'))}</span><p class="dim">${esc(t('deadsub'))}</p></div>`}</div>
    ${me.alive ? `<p class="hint">${esc(t('hold'))}</p>` : ''}
    <p class="dim" style="text-align:center">${esc(phase)}</p>
    <div class="tabs"><button class="btn ${tab === 'players' ? 'on' : ''}" data-tab="players">${esc(t('players'))}</button>
      <button class="btn ${tab === 'log' ? 'on' : ''}" data-tab="log">${esc(t('events'))}</button></div>
    ${tab === 'players' ? playerList() : logList()}</div>`;
}

function nightPanel() {
  const steps = S.night.steps.map((st) => {
    const open = S.night.open === st.role, tl = st.tally;
    const holders = st.holders.map((h) => `<li class="${h.alive ? '' : 'dead'}"><span class="grow">${esc(h.name)}${h.alive ? '' : ' ' + esc(t('deadholder'))}</span>
      <span class="dim">${h.alive ? (h.pick ? '→ ' + esc(nameOf(h.pick)) : esc(t('nopick'))) : ''}</span></li>`).join('');
    const sum = tl ? (tl.leader ? t('majority', { n: nameOf(tl.leader) }) : tl.split ? t('split') : '') : '';
    return `<div class="banner" ${open ? 'style="border-color:var(--accent)"' : ''}><div class="row"><b class="grow">${remoji(st.role)} ${esc(rname(st.role))}</b>
      <button class="btn ${open ? '' : 'primary'}" data-turn="${open ? 'close' : 'open:' + st.role}">${esc(open ? t('closeturn') : t('wake'))}</button></div>
      <p class="dim">${esc(t('wakeline', { r: rname(st.role) }))}</p><ul class="list">${holders}</ul>
      ${sum ? `<p><b>${esc(sum)}</b></p>` : ''}
      ${tl && tl.leader ? `<button class="btn danger" style="width:100%" data-ask="kill" data-id="${tl.leader}">${esc(t('killhim', { n: nameOf(tl.leader) }))}</button>` : ''}</div>`;
  }).join('');
  return `<h3>${esc(t('nightpanel'))}</h3>${steps}`;
}

function gmView() {
  const T = theme(), n = S.players.length, nAlive = S.players.filter((p) => p.alive).length;
  const label = S.phase === 'lobby' ? t('lobby') : S.phase === 'over' ? t('over') : S.phase === 'reveal' ? t('dealt')
    : t(S.phase === 'night' ? 'night_n' : 'day_n', { n: S.round });
  const head = `<div class="row" style="flex-wrap:wrap;gap:8px"><div class="grow"><span class="code" style="font-size:1.8rem">${esc(S.code)}</span>
    <div class="dim">${esc(label)} · ${nAlive}/${n} ${esc(t('alive'))}</div></div>
    <div class="row" style="gap:6px">
      <button class="btn" style="min-height:38px;padding:0 10px" data-act="undo" ${S.canUndo ? '' : 'disabled'}>${esc(t('undo'))}</button>
      <button class="btn danger" style="min-height:38px;padding:0 10px" data-act="leave">${esc(t('leave'))}</button>
      ${langBtn()}
    </div></div>`;

  if (S.phase === 'lobby') {
    const sum = Object.values(S.roles).reduce((a, b) => a + b, 0);
    const steppers = S.catalog.filter((r) => r !== 'townsfolk').map((r) => `<div class="step"><span class="grow">${remoji(r)} ${esc(rname(r))}</span>
      <button class="btn" data-role="${r}" data-d="-1" aria-label="-">−</button><b>${S.roles[r] || 0}</b><button class="btn" data-role="${r}" data-d="1" aria-label="+">+</button></div>`).join('');
    return `<div class="stack">${head}<p class="dim">${esc(t('sharecode'))}</p>
      <div class="row" style="gap:8px">
        <button class="btn primary grow" data-act="share_link">📋 ${esc(t('copy_invite'))}</button>
      </div>
      <select id="theme" aria-label="Theme">${Object.entries(THEMES).map(([k, x]) => `<option value="${k}" ${k === S.theme ? 'selected' : ''}>${x.name}</option>`).join('')}</select>
      <h3>${esc(t('players'))} (${n})</h3>
      ${n ? `<ul class="list">${S.players.map((p) => `<li><span class="grow">${esc(p.name)}</span>${p.online ? '' : `<span class="chip">${esc(t('offline'))}</span>`}
        ${p.online ? `<button class="btn" style="min-height:44px" data-pass="${p.id}">${esc(t('makegm'))}</button>` : ''}
        <button class="btn" style="min-height:44px" data-kick="${p.id}">${esc(t('remove'))}</button></li>`).join('')}</ul>` : `<p class="dim">${esc(t('noone'))}</p>`}
      <h3>${esc(t('roles'))}</h3>${steppers}
      <p class="dim">${esc(t('fill', { n: Math.max(0, n - sum), r: rname('townsfolk') }))}</p></div>
      <div class="bar"><div><button class="btn primary" data-act="deal" ${n < 4 ? 'disabled' : ''}>${esc(n < 4 ? t('need4') : t('deal'))}</button></div></div>`;
  }

  const tiles = S.players.map((p) => `<button class="tile ${p.alive ? '' : 'dead'}" data-team="${p.team}" data-pick="${p.id}">
    <b>${esc(p.name)}</b><span class="dim">${remoji(p.role)} ${esc(rname(p.role))}${p.alive ? '' : ' · ' + esc(t('out'))}</span></button>`).join('');

  if (S.phase === 'over') {
    const done = S.reveal.shown >= S.reveal.total;
    return `<div class="stack">${head}${winnerBanner()}
      <div class="banner"><b>${esc(t('progress', { a: S.reveal.shown, b: S.reveal.total }))}</b>
        ${S.nextReveal ? `<p class="dim">${esc(t('next', { n: S.nextReveal }))}</p>` : ''}<p class="dim">${esc(t('killerslast', { r: rname('killer') }))}</p></div>
      <div class="grid">${tiles}</div></div>
      <div class="bar"><div>${done ? `<button class="btn primary" data-act="forget">${esc(t('startover'))}</button>`
        : `<button class="btn primary" data-act="reveal_next">${esc(t('flip'))}</button><button class="btn" data-act="reveal_all">${esc(t('revealall'))}</button>`}</div></div>`;
  }

  const k = rname('killer');
  const suggest = S.suggest ? `<div class="banner"><b>${esc(S.suggest === 'good' ? t('s_good') : S.suggest === 'evil' ? t('s_evil', { r: k }) : t('s_jester', { r: rname('jester') }))}</b>
    <div class="row" style="margin-top:8px"><button class="btn primary grow" data-end="${S.suggest}">${esc(t('endgame'))}</button></div></div>` : '';
  const hunter = S.hunterPending ? `<div class="banner"><b>${esc(t('hunterout', { r: rname('hunter') }))}</b>
    <div class="row" style="margin-top:8px"><button class="btn grow" data-act="hunter_done">${esc(t('done'))}</button></div></div>` : '';
  const next = `<div class="bar"><div>
    ${S.phase !== 'night' ? `<button class="btn primary" data-phase="night">${esc(t('startnight', { n: S.round + 1 }))}</button>` : `<button class="btn primary" data-phase="day">${esc(t('startday'))}</button>`}
    ${S.phase === 'reveal' ? `<button class="btn" data-act="deal">${esc(t('redeal'))}</button>` : ''}</div></div>`;
  const script = S.phase === 'night' ? `<p class="dim">${esc(t('say', { t: tx(T.night) }))} ${esc(t('saynight'))}</p>`
    : S.phase === 'day' ? `<p class="dim">${esc(t('say', { t: tx(T.day) }))} ${esc(t('sayday'))}</p>` : '';
  return `<div class="stack">${head}${suggest}${hunter}
    ${S.phase === 'reveal' ? `<p class="dim">${esc(t('seen', { a: S.players.filter((p) => p.seen).length, b: n }))}</p>` : ''}${script}
    ${S.phase === 'night' ? nightPanel() : ''}
    <div class="grid">${tiles}</div>
    <details style="margin-top:6px"><summary class="dim">${esc(t('endgame'))}</summary><div class="stack" style="margin-top:10px">
      <button class="btn" data-end="good">${esc(t('w_good'))}</button><button class="btn" data-end="evil">${esc(t('w_evil', { r: k }))}</button>
      <button class="btn" data-end="draw">${esc(t('w_draw'))}</button>      </div></details>
      ${S.phase === 'reveal' ? `<button class="btn danger" data-act="abort">${esc(t('abort'))}</button>` : ''}
      </div>${next}${sel ? sheet() : ''}`;
}

function sheet() {
  const p = S.players.find((x) => x.id === sel);
  if (!p) { sel = null; return ''; }
  const opts = S.catalog.map((r) => `<option value="${r}" ${r === p.role ? 'selected' : ''}>${esc(rname(r))}</option>`).join('');
  return `<div class="sheet-bg" data-sheetbg><div class="sheet">
    <h3>${esc(p.name)} <span class="dim">${remoji(p.role)} ${esc(rname(p.role))}</span></h3>
    ${p.alive ? `<button class="btn danger" data-ask="kill" data-id="${p.id}">${esc(t('kill'))}</button><button class="btn danger" data-ask="lynch" data-id="${p.id}">${esc(t('lynch'))}</button>
      <button class="btn" data-ask="shot" data-id="${p.id}">${esc(t('shot', { r: rname('hunter') }))}</button>` : `<button class="btn primary" data-do="revive">${esc(t('revive'))}</button>`}
    <select id="reassign" aria-label="${esc(t('changerole'))}">${opts}</select>
    <button class="btn" data-do="kick">${esc(t('removeroom'))}</button>
    <button class="btn" data-act="closesheet">${esc(t('close'))}</button></div></div>`;
}

function rulesHTML() {
  const teams = [...new Set(S.inPlay.map(teamOf))];
  const col = { evil: 'var(--evil)', good: 'var(--good)', neutral: 'var(--neutral)' };
  return `<h2>${esc(t('r_title'))}</h2><p class="dim">${esc(t('r_sub'))}</p>
    <h3 style="margin-top:14px">${esc(t('r_goals'))}</h3>${teams.map((x) => `<p><b style="color:${col[x]}">${esc(t('t_' + x))}</b> ${esc(t('g_' + x))}</p>`).join('')}
    <h3 style="margin-top:14px">${esc(t('r_each'))}</h3><p>${esc(t('r_night'))}</p><p>${esc(t('r_day'))}</p>
    <h3 style="margin-top:14px">${esc(t('r_roles'))}</h3>
    ${S.inPlay.map((r) => { const x = theme().roles[r]; return `<p><b>${x.e} ${esc(tx(x.n))}</b><br><span class="dim">${esc(tx(x.b))}</span></p>`; }).join('')}
    <button class="btn primary" style="width:100%;margin-top:12px" data-act="closeRules">${esc(t('gotit'))}</button>`;
}

function ask(kind, id) {
  const p = S.players.find((x) => x.id === id); if (!p) return;
  sel = null;
  $('#confirm').innerHTML = `<h3>${esc(t('q_' + kind, { n: p.name }))}</h3>
    <div class="row" style="margin-top:16px"><button class="btn grow" data-act="cancel">${esc(t('cancel'))}</button><button class="btn danger grow" data-act="doit">${esc(t('confirm'))}</button></div>`;
  doIt = () => send(kind === 'lynch' ? { type: 'lynch', id } : { type: 'kill', id, cause: kind === 'shot' ? 'shot' : 'night' });
  $('#confirm').showModal(); render();
}

// ---------- events ----------
document.addEventListener('click', (e) => {
  const x = e.target.closest('[data-act],[data-tab],[data-role],[data-kick],[data-pass],[data-pick],[data-phase],[data-do],[data-end],[data-ask],[data-turn],[data-night],[data-sheetbg]');
  if (!x) return;
  const d = x.dataset;
  if (d.sheetbg !== undefined && e.target !== x) return; // clicks inside the sheet don't close it
  if (d.sheetbg !== undefined) { sel = null; return render(); }
  if (d.tab) { tab = d.tab; return render(); }
  if (d.pick) { sel = d.pick; return render(); }
  if (d.night) return send({ type: 'night_target', id: d.night });
  if (d.turn) return d.turn === 'close' ? send({ type: 'close_turn' }) : send({ type: 'open_turn', role: d.turn.split(':')[1] });
  if (d.phase) return send({ type: 'set_phase', phase: d.phase });
  if (d.end) return send({ type: 'end', winner: d.end });
  if (d.kick) return send({ type: 'kick', id: d.kick });
  if (d.pass) return send({ type: 'pass_gm', id: d.pass });
  if (d.ask) return ask(d.ask, d.id || sel);
  if (d.role) { const roles = { ...S.roles }; roles[d.role] = Math.max(0, (roles[d.role] || 0) + +d.d); return send({ type: 'config', roles }); }
  if (d.do) {
    const id = sel; sel = null;
    send({ type: d.do, id }); return render();
  }
  switch (d.act) {
    case 'join': { const name = $('#jname').value.trim(), code = $('#jcode').value.trim().toUpperCase();
      if (!name || code.length !== 4) return flash(t('enter')); return send({ type: 'join', code, name }); }
    case 'create': return send({ type: 'create', theme: pref });
    case 'claim': {
      const code = $('#gcode').value.trim().toUpperCase(), key = $('#gkey').value.trim(), nickname = $('#gnick').value.trim();
      if (!code || !key || !nickname) return flash(t('enter'));
      return send({ type: 'claim_gm', code, key, nickname });
    }
    case 'abort': {
      $('#confirm').innerHTML = `<h3>${esc(t('q_abort'))}</h3>
        <div class="row" style="margin-top:16px"><button class="btn grow" data-act="cancel">${esc(t('cancel'))}</button>
        <button class="btn danger grow" data-act="doit">${esc(t('confirm'))}</button></div>`;
      doIt = () => send({ type: 'abort' }); return $('#confirm').showModal();
    }
    case 'forget': setSession(null); if (ws) ws.close(); S = null; return render();
    case 'leave': {
      $('#confirm').innerHTML = `<h3>${esc(t('q_leave'))}</h3>
        <p class="dim">${esc(S && S.you === 'gm' ? t('leave_gm_hint') : t('leave_hint'))}</p>
        <div class="row" style="margin-top:16px"><button class="btn grow" data-act="cancel">${esc(t('cancel'))}</button>
        <button class="btn danger grow" data-act="doit">${esc(t('leave'))}</button></div>`;
      doIt = () => {
        try { send({ type: 'leave' }); } catch {}
        setSession(null);
        if (ws) ws.close();
        S = null;
        render();
      };
      return $('#confirm').showModal();
    }
    case 'lang': lang = lang === 'en' ? 'km' : 'en'; store.set('nt_lang', lang); return render();
    case 'set_server': {
      const val = ($('#srv-url')?.value || '').trim();
      if (!val) return flash(t('enter_server'));
      store.set('nt_server', val);
      const u = new URL(location.href);
      u.searchParams.set('server', val);
      location.href = u.toString();
      return;
    }
    case 'reset_server': {
      store.set('nt_server', null);
      const u = new URL(location.href);
      u.searchParams.delete('server');
      location.href = u.toString();
      return;
    }
    case 'share_link': {
      const inviteUrl = new URL(location.href);
      inviteUrl.searchParams.set('code', S.code);
      if (WS_URL) inviteUrl.searchParams.set('server', WS_URL);
      const urlStr = inviteUrl.toString();
      if (navigator.share) {
        navigator.share({ title: `Night Table - Room ${S.code}`, text: `Join Night Table room ${S.code}`, url: urlStr }).catch(() => {});
      } else if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(urlStr).then(() => flash(t('link_copied')));
      } else {
        flash(urlStr);
      }
      return;
    }
    case 'snd': snd = !snd; store.set('nt_snd', snd ? '1' : '0'); if (snd) audio(); return render();
    case 'deal': return send({ type: 'deal' });
    case 'undo': return send({ type: 'undo' });
    case 'hunter_done': return send({ type: 'hunter_done' });
    case 'reveal_next': return send({ type: 'reveal_next' });
    case 'reveal_all': return send({ type: 'reveal_all' });
    case 'closesheet': sel = null; return render();
    case 'cancel': doIt = null; return $('#confirm').close();
    case 'doit': { const f = doIt; doIt = null; $('#confirm').close(); return f && f(); }
    case 'rules': $('#rules').innerHTML = rulesHTML(); return $('#rules').showModal();
    case 'closeRules': return $('#rules').close();
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'theme') { pref = e.target.value; if (S && S.you === 'gm') send({ type: 'config', theme: pref }); else document.documentElement.dataset.theme = pref; }
  if (e.target.id === 'reassign') { send({ type: 'reassign', id: sel, role: e.target.value }); sel = null; }
});
for (const id of ['#rules', '#confirm']) $(id).addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

// hold-to-reveal: role text and art are only put in the DOM while the finger is down
function reveal(card) {
  const r = S.me.role, x = theme().roles[r];
  card.querySelector('.face').innerHTML = `<div class="art">${x.e}<img src="art/${S.theme}/${r}.webp" alt="" onerror="this.remove()"></div>
    <div class="txt"><h2>${esc(tx(x.n))}</h2><p>${esc(tx(x.b))}</p></div>`;
  card.classList.add('up'); holding = true; buzz(20);
  clearTimeout(holdTimer); holdTimer = setTimeout(() => hide(card), 10000);
}
function hide(card) {
  if (!holding) return;
  holding = false; clearTimeout(holdTimer); card.classList.remove('up');
  if (!acked) { acked = true; send({ type: 'ack' }); }
  setTimeout(() => { const f = card.querySelector('.face'); if (f && !holding) f.innerHTML = ''; if (pending) { pending = false; render(); } }, 300);
}
document.addEventListener('pointerdown', (e) => { const c = e.target.closest('[data-card]'); if (c && S && S.me && S.me.role) { e.preventDefault(); reveal(c); } });
['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => document.addEventListener(ev, () => { const c = $('[data-card]'); if (c) hide(c); }, true));
document.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-card]')) e.preventDefault(); });
document.addEventListener('visibilitychange', () => { const c = $('[data-card]'); if (document.hidden && c) hide(c); });

// ---------- boot ----------
render();
if (getSession()) connect();
