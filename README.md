# Night Table (Werewolf / Mafia Party Game)

In-person hidden-role party game. Voting and discussions happen out loud. Phones act as secret role cards and night-action control panels.

- **Live Frontend**: [https://malterlo.github.io/werewolf/](https://malterlo.github.io/werewolf/)
- **Live Backend**: `wss://homeserver.tailb85a94.ts.net` (via Tailscale Funnel)

---

## 💻 Local Development Workflow

Running both the frontend and backend locally provides instant hot-reloading without rebuilding containers or pushing to GitHub.

### 1. Start Local Backend (with Hot-Reload)
```bash
npm install
npm run dev
```
- Starts on `ws://localhost:8080`.
- Nodemon automatically restarts on changes to the backend files.
- Run smoke tests anytime: `npm test`.
- Dev tips: Set `MIN_PLAYERS=2` to test games with fewer players.

### 2. Start Local Frontend
In a separate terminal tab:
```bash
python3 -m http.server 3000
```
Open **`http://localhost:3000`** in your browser.

- `index.html` automatically detects `localhost` and connects to `ws://localhost:8080`.
- **Testing Multi-player locally**: Open 1 normal browser window (as Host/GM) and 3–4 Incognito tabs (as Players) to simulate dealing, night turns, voting, and game flow.

### 3. Expose Backend with Cloudflare Quick Tunnel (Public Testing)

To test over the internet with real phones or remote players without configuring DNS, accounts, or port forwarding:

```bash
npm run tunnel
```
or with automatic backend reload on edits:
```bash
npm run dev:tunnel
```

The script automatically:
1. Verifies/starts the local backend on port 8080.
2. Creates an on-demand Cloudflare Quick Tunnel (`*.trycloudflare.com`).
3. Supports both HTTPS and WSS with full CORS/origin validation.
4. Outputs ready-to-use links:
   - **Direct Web App**: `https://<subdomain>.trycloudflare.com` (backend serves the frontend directly over HTTPS/WSS)
   - **GitHub Pages Link**: `https://malterlo.github.io/werewolf/?server=wss://<subdomain>.trycloudflare.com`
   - **Local Frontend Link**: `http://localhost:3000/?server=wss://<subdomain>.trycloudflare.com`
5. **One-Click Invite Sharing**: Hosts in the lobby can click **📋 Copy invite link** to share a link that automatically configures the room code and tunnel WSS server for joining players.

---

## 🚀 Production Hosting

### Backend (Podman on `ssh mong@server`)

1. Sync files to the server:
   ```bash
   scp -r Containerfile backend shared package.json package-lock.json mong@server:/home/mong/podman/werewolf/
   ```
2. Build and run the container:
   ```bash
   ssh mong@server
   cd /home/mong/podman/werewolf
   podman build -t nighttable .
   podman run -d --name nighttable \
     -p 8088:8080 \
     -e ALLOWED_ORIGIN='https://malterlo.github.io,http://localhost:3000,http://127.0.0.1:3000' \
     -v nighttable-data:/data:U \
     --memory=256m \
     --restart unless-stopped \
     nighttable
   ```
   *(Port `8088` is used on the host to avoid port 8080 conflicts with existing services).*

3. Expose publicly with Tailscale Funnel:
   ```bash
   tailscale funnel --bg 8088
   ```
   This gives a public, valid TLS endpoint at `wss://homeserver.tailb85a94.ts.net`.

### Frontend (GitHub Pages)

Pushing commits on the `main` branch automatically deploys to GitHub Pages:
```bash
git add .
git commit -m "Your update"
git push
```
The site updates automatically at [https://malterlo.github.io/werewolf/](https://malterlo.github.io/werewolf/).

## Project layout

```text
frontend/
  index.html          Static player and GM client
backend/
  server.js           Runtime entrypoint and WebSocket protocol
  config.js           Environment configuration and limits
  domain/game.js      Room state and game rules
  services/           Room lifecycle services
  persistence/        SQLite snapshots, events, and credentials
  http/routes.js      Express routes
shared/
  roles.js            Role catalog and validation shared by the server
```

The root `index.html` is only a GitHub Pages redirect to `frontend/index.html`.
The root JavaScript files are compatibility exports; new backend code belongs under `backend/`.

Completed games are copied to the `finished_games`, `finished_players`, and
`finished_events` tables after the final reveal. Their live snapshot and live
event rows are then removed, while the in-memory room remains available to
connected clients until they leave.

Authorized operators can inspect finished games at `GET /admin/api/history` and
`GET /history/:code`, view aggregate results at `GET /history/analytics`, and
purge a record with `DELETE /history/:code`. These routes require the Google
operator session and never expose live room snapshots.

GM recovery keys are shown once when a room is created and are stored only as
hashes. A disconnected GM can recover control with `claim_gm`; the current key
rotates after a successful claim. In the lobby, the current GM can pass control
to an online player, and a dealt game can be aborted without storing roles in
finished history.

Production deployments should set `ALLOWED_ORIGIN` to an explicit value. Put
the SQLite database on the persistent volume, stop the
old container with `SIGTERM` before replacing it, and keep the previous image
available for rollback. The server flushes each accepted intent before
broadcasting and gives graceful shutdown up to 9 seconds to close clients.

Set `SIM_KEY` only when running the simulator. Requests that include a
simulator key are rejected unless it matches `SIM_KEY`, and accepted rooms are
stored with `source = sim`; ordinary rooms remain `source = live`.

Google operator sign-in uses these environment variables:

```bash
GOOGLE_CLIENT_ID='...apps.googleusercontent.com'
GOOGLE_CLIENT_SECRET='...'
GOOGLE_REDIRECT_URI='https://your-host.example/auth/google/callback'
SESSION_SECRET='random-unused-for-logs'
ADMIN_EMAILS='you@example.com'
```

In Google Cloud Console, create an OAuth client of type **Web application**,
enable the Google Identity/OAuth APIs, add the exact redirect URI above (and
`http://localhost:8080/auth/google/callback` for local work), configure the
consent screen with `openid`, `email`, and `profile`, and add your account as a
test user if the app remains in Testing mode. Start sign-in at
`/auth/google`; the callback validates state, nonce, PKCE, issuer, audience,
expiry, and verified email before creating an eight-hour admin session.

The game homepage includes an **Admin sign in** button. If the frontend uses a
non-default backend, pass both URLs in the query string, for example:
`?server=wss://example.test&http=https://example.test`.

With a running server, execute a protocol-level simulation with:

```bash
SIM_KEY='<simulator-key>' \
  npm run sim -- --server ws://localhost:8080 --games 10 --players 4-8 \
  --parallel 2 --seed 7 --pace 10
```

---

## 🎨 Art & Assets
Optional role illustrations. Drop images into `art/<theme>/<role>.webp` (500x700).  
Roles: `killer`, `townsfolk`, `inspector`, `protector`, `hunter`, `jester`. Emoji placeholders show until custom art exists.

## Documentation

- [Documentation map](docs/README.md) — where to start for each kind of work.
- [v1 game specification](docs/game-spec.md) — rules, permissions, UX, and
  protocol baseline.
- [Product requirements](docs/product-requirements.md) — product intent and v2
  acceptance targets.
- [OpenSpec v2 change](openspec/changes/night-table-v2/) — proposal, design,
  capability specs, and the implementation task tracker.
