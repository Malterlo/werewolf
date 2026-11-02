# Night Table (werewolf / mafia party game)

In-person game. Voting happens out loud. Phones = role cards + host control panel.

## Run server (homeserver)
```bash
cd server
podman build -t nighttable .
podman run -d --name nighttable -p 127.0.0.1:8080:8080 \
  -e ALLOWED_ORIGIN=https://<user>.github.io -e HOST_KEY='<passphrase>' \
  --memory=256m --restart unless-stopped nighttable
sudo tailscale funnel --bg 8080
```
Local dev: `npm install && npm start` (ws://localhost:8080). Smoke test: `npm test`.
`MIN_PLAYERS=2` lets you test with fewer phones. Without `HOST_KEY`, anyone can create rooms (dev only).

## Run client
Static. Open `web/index.html` via any static server, or push `web/` to GitHub Pages.
Server URL: edit `WS_URL` in index.html, or add `?server=wss://host` to the page URL.

## Art
Optional. Drop `web/art/<theme>/<role>.webp` (500x700). Roles: killer, townsfolk, inspector, protector, hunter, jester. Emoji shows until art exists.

See SPEC.md for rules and permissions.

## Not built yet
SQLite persistence (restart = rooms lost), role art, Khmer native review, public board, more roles/games.
