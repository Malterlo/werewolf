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
     -e HOST_KEY='<required-passphrase>' \
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
