import crypto from 'node:crypto';
import {
  ADMIN_EMAILS, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, MIN_PLAYERS,
  SESSION_SECRET,
} from '../config.js';
import {
  createAdminSession, deleteAdminSession, findAdminSession,
  getFinishedGame, getHistoryAnalytics, listFinishedGames, listSecurityEvents,
  metrics, purgeFinishedGame, recordSecurityEvent, upsertUser,
} from '../persistence/database.js';

const GOOGLE_ISSUER = 'https://accounts.google.com';
const FLOW_COOKIE = 'google_oauth_flow';
const SESSION_COOKIE = 'nighttable_admin';
const cookie = (value, options) => `${value}; Path=${options.path || '/'}; HttpOnly; SameSite=${options.sameSite || 'Strict'}${options.secure ? '; Secure' : ''}${options.maxAge == null ? '' : `; Max-Age=${options.maxAge}`}`;
const parseCookies = (header = '') => Object.fromEntries(header.split(';').map((part) => {
  const index = part.indexOf('=');
  return index < 0 ? [] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
}).filter((part) => part.length));
const hash = (value) => crypto.createHmac('sha256', SESSION_SECRET || 'disabled').update(value).digest('hex');
const base64url = (value) => Buffer.from(value).toString('base64url');
const json = (value) => JSON.stringify(value);
const redirect = (res, location) => res.redirect(302, location);

async function googleDiscovery() {
  const response = await fetch('https://accounts.google.com/.well-known/openid-configuration');
  if (!response.ok) throw new Error('google discovery unavailable');
  return response.json();
}

async function verifyGoogleIdToken(idToken, expectedNonce, discovery) {
  const [encodedHeader, encodedPayload, encodedSignature] = idToken.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error('invalid identity token');
  const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString());
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('invalid identity algorithm');
  const keysResponse = await fetch(discovery.jwks_uri);
  if (!keysResponse.ok) throw new Error('google keys unavailable');
  const key = (await keysResponse.json()).keys.find((candidate) => candidate.kid === header.kid);
  if (!key) throw new Error('unknown identity key');
  const valid = crypto.verify(
    'RSA-SHA256', Buffer.from(`${encodedHeader}.${encodedPayload}`),
    crypto.createPublicKey({ key, format: 'jwk' }), Buffer.from(encodedSignature, 'base64url'),
  );
  const now = Math.floor(Date.now() / 1000);
  if (!valid || payload.iss !== GOOGLE_ISSUER || payload.aud !== GOOGLE_CLIENT_ID
    || payload.exp <= now || payload.nonce !== expectedNonce || payload.email_verified !== true
    || typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
    throw new Error('invalid identity claims');
  }
  return payload;
}

function sessionUser(req) {
  if (!SESSION_SECRET) return null;
  const sessionId = parseCookies(req.headers.cookie || '')[SESSION_COOKIE];
  return sessionId ? findAdminSession(hash(sessionId)) : null;
}

function requireOperator(req, res, next) {
  const session = sessionUser(req);
  if (!session) {
    if (req.originalUrl === '/admin' || req.originalUrl === '/admin/') return redirect(res, '/auth/google');
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!ADMIN_EMAILS.has(session.email.toLowerCase()) && session.role !== 'admin') {
    recordSecurityEvent('admin_authorization_failed', { email: session.email });
    return res.status(403).json({ error: 'forbidden' });
  }
  req.operator = session;
  next();
}

function registerRoutes(app, { getRooms = () => [] } = {}) {
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/auth/google', async (_req, res) => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !SESSION_SECRET) return res.status(503).send('Google sign-in is not configured');
    const state = crypto.randomBytes(24).toString('base64url');
    const nonce = crypto.randomBytes(24).toString('base64url');
    const verifier = crypto.randomBytes(32).toString('base64url');
    res.setHeader('Set-Cookie', cookie(`${FLOW_COOKIE}=${encodeURIComponent(json({ state, nonce, verifier }))}`, {
      path: '/auth', sameSite: 'Lax', secure: GOOGLE_REDIRECT_URI.startsWith('https:'), maxAge: 600,
    }));
    try {
      const discovery = await googleDiscovery();
      const url = new URL(discovery.authorization_endpoint);
      url.search = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID, redirect_uri: GOOGLE_REDIRECT_URI, response_type: 'code',
        scope: 'openid email profile', state, nonce, code_challenge: base64url(crypto.createHash('sha256').update(verifier).digest()),
        code_challenge_method: 'S256',
      });
      return redirect(res, url.toString());
    } catch {
      return res.status(503).send('Google sign-in is temporarily unavailable');
    }
  });
  app.get('/auth/google/callback', async (req, res) => {
    const cookies = parseCookies(req.headers.cookie || '');
    try {
      const flow = JSON.parse(cookies[FLOW_COOKIE] || '{}');
      if (!req.query.code || !req.query.state || req.query.state !== flow.state) throw new Error('invalid oauth state');
      const discovery = await googleDiscovery();
      const tokenResponse = await fetch(discovery.token_endpoint, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: req.query.code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: GOOGLE_REDIRECT_URI, grant_type: 'authorization_code', code_verifier: flow.verifier,
        }),
      });
      if (!tokenResponse.ok) throw new Error('token exchange failed');
      const tokens = await tokenResponse.json();
      const claims = await verifyGoogleIdToken(tokens.id_token, flow.nonce, discovery);
      upsertUser(claims.sub, claims.email.toLowerCase());
      const sessionId = crypto.randomBytes(32).toString('base64url');
      createAdminSession(hash(sessionId), claims.sub, Date.now() + 8 * 60 * 60e3);
      res.setHeader('Set-Cookie', [
        cookie(`${SESSION_COOKIE}=${encodeURIComponent(sessionId)}`, {
          path: '/', sameSite: 'Lax', secure: GOOGLE_REDIRECT_URI.startsWith('https:'), maxAge: 8 * 60 * 60,
        }),
        cookie(`${FLOW_COOKIE}=`, { path: '/auth', sameSite: 'Lax', maxAge: 0 }),
      ]);
      return redirect(res, '/admin');
    } catch (error) {
      recordSecurityEvent('google_auth_failed', { reason: error.message.startsWith('invalid') ? 'invalid_request' : 'provider_failure' });
      res.setHeader('Set-Cookie', cookie(`${FLOW_COOKIE}=`, { path: '/auth', sameSite: 'Lax', maxAge: 0 }));
      return res.status(400).send('Sign-in could not be completed. <a href="/auth/google">Try again</a>.');
    }
  });
  app.post('/auth/logout', (req, res) => {
    const sessionId = parseCookies(req.headers.cookie || '')[SESSION_COOKIE];
    if (sessionId) deleteAdminSession(hash(sessionId));
    res.setHeader('Set-Cookie', cookie(`${SESSION_COOKIE}=`, { path: '/', maxAge: 0 }));
    return res.status(204).end();
  });
  app.use('/admin', requireOperator);
  app.get('/admin', (req, res) => res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Night Table · Control room</title><style>
:root{color-scheme:dark;--bg:#0b0f18;--panel:#151c2d;--line:#293653;--text:#f3f0e7;--muted:#9ba8c4;--gold:#d9bd7a;--red:#cf6258}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% 0,#202c48,transparent 42%),var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1180px;margin:auto;padding:32px 22px 60px}.top{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:28px}
h1,h2{font-family:Georgia,serif;font-weight:600;letter-spacing:.01em}h1{font-size:clamp(2rem,5vw,3.8rem);margin:0 0 6px}h2{font-size:1.25rem;margin:0 0 16px}.muted{color:var(--muted)}
.eyebrow{color:var(--gold);text-transform:uppercase;letter-spacing:.16em;font-size:.72rem;font-weight:700}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:18px}
.card{background:linear-gradient(145deg,#19233a,#111827);border:1px solid var(--line);border-radius:16px;padding:20px;box-shadow:0 16px 40px #0003}.metric{font-size:2rem;font-weight:700;color:var(--gold)}
.wide{grid-column:span 2}.list{display:grid;gap:10px}.row{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}.row:last-child{border:0}
.pill{border:1px solid var(--line);border-radius:999px;padding:3px 9px;color:var(--muted);font-size:.8rem}.empty{color:var(--muted);padding:10px 0}
button{border:1px solid var(--line);border-radius:9px;background:#1b2740;color:var(--text);padding:10px 14px;cursor:pointer}button:hover{border-color:var(--gold);color:var(--gold)}
@media(max-width:760px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}.top{display:block}.top button{margin-top:16px}}
</style></head><body><main>
<header class="top"><div><div class="eyebrow">Night Table · operator console</div><h1>Control room</h1>
<div class="muted">A quiet view of the rooms, service, and recorded games.</div></div>
<div><span class="pill">${req.operator.email}</span> <button id="logout">Sign out</button></div></header>
<section class="grid"><article class="card"><div class="muted">Live rooms</div><div id="room-count" class="metric">—</div></article>
<article class="card"><div class="muted">Persistence failures</div><div id="failures" class="metric">—</div></article>
<article class="card"><div class="muted">Finished games</div><div id="finished-count" class="metric">—</div></article>
<article class="card wide"><h2>Live rooms</h2><div id="rooms" class="list"><div class="empty">Loading room metadata…</div></div></article>
<article class="card"><h2>Service</h2><div id="service" class="muted">Loading metrics…</div></article>
<article class="card wide"><h2>Security events</h2><div id="security" class="list"><div class="empty">Loading security events…</div></div></article>
<article class="card wide"><h2>Finished games</h2><div id="history" class="list"><div class="empty">Loading history…</div></div></article></section>
</main><script>
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const get=path=>fetch('/admin/api/'+path).then(r=>{if(!r.ok)throw Error('request failed');return r.json()});
const row=(a,b)=>'<div class="row"><span>'+esc(a)+'</span><span class="pill">'+esc(b)+'</span></div>';
Promise.all([get('rooms'),get('metrics'),get('security-events?limit=8'),get('history')]).then(([rooms,metrics,security,history])=>{
 document.querySelector('#room-count').textContent=rooms.rooms.length;document.querySelector('#failures').textContent=metrics.persistenceFailures;
 document.querySelector('#finished-count').textContent=history.games.length;
 document.querySelector('#rooms').innerHTML=rooms.rooms.length?rooms.rooms.map(r=>row(r.code,r.phase+' · '+r.player_count+' players')).join(''):'<div class="empty">No live rooms.</div>';
 document.querySelector('#service').innerHTML=row('Memory',Math.round(metrics.memory.rss/1024/1024)+' MB')+row('Uptime',Math.round(metrics.uptime)+' seconds');
 document.querySelector('#security').innerHTML=security.events.length?security.events.map(e=>row(e.type,new Date(e.created_at).toLocaleString())).join(''):'<div class="empty">No recent security events.</div>';
 document.querySelector('#history').innerHTML=history.games.length?history.games.slice(0,8).map(g=>row(g.code,g.winner+' · '+g.player_count+' players')).join(''):'<div class="empty">No finished games.</div>';
}).catch(()=>{document.querySelector('#service').textContent='Dashboard data could not be loaded.'});
document.querySelector('#logout').onclick=()=>fetch('/auth/logout',{method:'POST'}).then(()=>location.href='/');
</script></body></html>`));
  app.get('/admin/api/me', (req, res) => res.json({ email: req.operator.email }));
  app.get('/admin/api/history', (_req, res) => res.json({ games: listFinishedGames() }));
  app.use('/history', requireOperator);
  app.get('/history', (_req, res) => res.json({ games: listFinishedGames() }));
  app.get('/history/analytics', (req, res) => res.json(getHistoryAnalytics(
    MIN_PLAYERS, req.query.include_simulated === 'true',
  )));
  app.get('/history/:code', (req, res) => {
    const game = getFinishedGame(String(req.params.code || '').toUpperCase());
    return game ? res.json(game) : res.status(404).json({ error: 'game not found' });
  });
  app.delete('/history/:code', (req, res) => {
    const removed = purgeFinishedGame(String(req.params.code || '').toUpperCase());
    return removed ? res.status(204).end() : res.status(404).json({ error: 'game not found' });
  });
  app.get('/admin/rooms', (_req, res) => res.json({
    rooms: [...getRooms()].map((room) => ({
      code: room.code,
      theme: room.theme,
      phase: room.phase,
      round: room.round,
      player_count: room.players.size,
      online_count: room.sockets.size + (room.gmWs ? 1 : 0),
      last_activity: room.last,
    })),
  }));
  const roomsResponse = (_req, res) => res.json({
    rooms: [...getRooms()].map((room) => ({
      code: room.code,
      theme: room.theme,
      phase: room.phase,
      round: room.round,
      player_count: room.players.size,
      online_count: room.sockets.size + (room.gmWs ? 1 : 0),
      last_activity: room.last,
    })),
  });
  const metricsResponse = (_req, res) => res.json(metrics());
  const securityEventsResponse = (req, res) => res.json({
    events: listSecurityEvents(req.query.limit),
  });
  app.get('/admin/api/rooms', roomsResponse);
  app.get('/admin/metrics', metricsResponse);
  app.get('/admin/api/metrics', metricsResponse);
  app.get('/admin/security-events', securityEventsResponse);
  app.get('/admin/api/security-events', securityEventsResponse);
}

export { registerRoutes };
