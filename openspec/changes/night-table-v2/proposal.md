# Proposal

## Why

Night Table v1 is playable, but live games are lost on restart and the operator has little visibility into service health, abuse, or completed games. This change defines the v2 capabilities needed to preserve games, improve safe operation, and learn from finished play while retaining anonymous player access and the game's secrecy boundary.

## What Changes

- **v2.0 — Must:** persist and restore live games; add security events, metrics, privacy-safe admin views and Google sign-in; support GM key handover.
- **v2.1 — Must:** store finished games for replay and analytics, and add a WebSocket bot simulator; distinguish simulated results from live play.
- **v2.2 — Should:** reuse the simulator for load testing and add backups, runtime configuration, deployment safeguards, and an operational writeup.
- **v2.3 — Nice to have:** add the shared discussion timer, role art, Khmer review, and name filtering.
- Preserve the v1 model: anonymous players, spoken discussion/voting, and a GM who makes game decisions. Do not add accounts, automated rule resolution, or horizontal scaling.

## Capabilities

### New Capabilities
- `durable-game-state`: Persist and recover live game state, reconnect sessions, and ordered events across server restarts.
- `gm-control-transfer`: Transfer or pass GM control safely, and abort a dealt game without revealing roles.
- `operator-console`: Authenticate operators and provide safe, secrecy-preserving administration, security, health, audit, and configuration views.
- `game-history`: Store completed games and provide finished-game replay and analytics.
- `game-simulation`: Run tagged simulated games through the real WebSocket protocol for repeatable validation and load testing.
- `game-operations`: Define backup, restore, deployment, resource, and operational-readiness behavior for the self-hosted service.
- `player-experience`: Add the v2.3 timer and player-facing polish, including role art, name filtering, and reviewed Khmer strings.

### Modified Capabilities

None. The project has no existing OpenSpec capability specs; v1 behavior remains the baseline and these are new v2 capabilities.

## Impact

- Current implementation: `index.js`, `db.js`, `data.js`, `index.html`, and `test.js`; `db.js` already provides partial SQLite snapshots, events, and restart restore that must be reconciled with the fuller PRD data and privacy requirements.
- New server areas described by the PRD: admin/auth, metrics, GM-key handling, simulator, migrations, and history APIs.
- Deployment and verification: `package.json`, `Containerfile`, README, CI, database volume/backup procedures, and persistence/security/load tests.
- Admin live-room requirements are interpreted as allowing player names, as stated in the dashboard and response requirements; live roles, picks, and credentials remain excluded.
