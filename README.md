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
node --watch index.js
```
- Starts on `ws://localhost:8080`.
- Automatically restarts on any change to `index.js` or `data.js`.
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
   scp Containerfile data.js index.js package.json package-lock.json mong@server:/home/mong/podman/werewolf/
   ```
2. Build and run the container:
   ```bash
   ssh mong@server
   cd /home/mong/podman/werewolf
   podman build -t nighttable .
   podman run -d --name nighttable \
     -p 8088:8080 \
     -e ALLOWED_ORIGIN='https://malterlo.github.io,http://localhost:8080,http://127.0.0.1:8080' \
     -e HOST_KEY='<optional-passphrase>' \
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

---

## 🎨 Art & Assets
Optional role illustrations. Drop images into `art/<theme>/<role>.webp` (500x700).  
Roles: `killer`, `townsfolk`, `inspector`, `protector`, `hunter`, `jester`. Emoji placeholders show until custom art exists.

See `SPEC.md` for full game rules, permissions, and network protocol specs.
