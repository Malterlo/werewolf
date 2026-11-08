# Night Table: Game and Architecture Report

**Repository:** `Malterlo/werewolf`  
**Report date:** 8 November 2026  
**Current release direction:** v2 self-hosted testing deployment with GitHub Pages and a Cloudflare Quick Tunnel

## Executive summary

Night Table is a mobile-first web companion for in-person or video-call
Werewolf/Mafia games. It deliberately keeps discussion, accusations, and
voting outside the application. The application manages the parts that benefit
from private digital state:

- assigning and privately displaying roles;
- coordinating silent night turns;
- recording GM decisions and the game timeline;
- reconnecting players and the GM;
- preserving live games in SQLite;
- storing finished games for replay and aggregate analysis.

The system has two independently deployed surfaces:

1. A static frontend published through GitHub Pages.
2. A Node.js backend running as a single self-hosted container.
3. An optional Cloudflare Quick Tunnel for temporary public HTTPS/WSS testing.

The backend is authoritative. Browsers send intents, not state mutations, and
receive complete personalized snapshots. The same room state is projected
differently for the GM, each player, operators, and finished-game history.

The current codebase contains the v1 game loop plus most of the v2 persistence,
operator, history, simulation, and deployment foundations. The principal
remaining verification gaps are restart reconnect testing, simulator failure
checks, target-load testing, backup/restore drills, reproducible self-hosting
documentation, and several player-experience improvements.

## Product model

### What the product is

Night Table is a host-operated aid, not an automated referee. A GM creates a
room, configures the roles, deals the cards, opens night turns, records deaths
and lynches, confirms the suggested winner, and reveals the cards at the end.
Players need only a room code and a display name; they do not create accounts
or install an application.

The product supports two display themes:

- **Werewolf:** the abstract `killer` role is displayed as Werewolf.
- **Mafia:** the same engine role is displayed as Mafioso.

Theme names, descriptions, icons, and colors are client-side presentation
data. The server operates on stable abstract role IDs, which keeps rules
independent from presentation.

### What the product is not

The current architecture intentionally excludes:

- voice, video, chat, or in-app discussion;
- player accounts, matchmaking, friends, or public lobbies;
- automated resolution of protection, ties, inspector results, or social votes;
- horizontal scaling or multi-process room coordination;
- extra roles such as witch or cupid;
- a public spectator/TV board.

## Game rules and flow

### Actors and secrecy

| Actor | Receives | Must not receive |
|---|---|---|
| GM | Full room state, roles, picks, controls, event context | Nothing within their authorized room |
| Player | Their role while alive, their own turn, permitted targets | Other roles or private picks |
| Killer | Their own role, living killer teammates, teammate picks | Good-team private picks |
| Dead player | Alive/out status and non-secret room information | Roles until the reveal |
| Operator | Room metadata, health, security, audit, finished history | Live roles, picks, tokens, or full snapshots |

The key privacy rule is that the server does not broadcast one universal room
object. `viewFor` creates a GM projection or a player projection, and
`adminViewFor`-style metadata responses are kept separate from live game
serialization. Role data is also withheld from live persistence event payloads
until the game is finished.

### Standard game sequence

1. **Lobby:** the GM selects a theme and role counts. Players join with a room
   code and name.
2. **Deal:** the server validates the role composition, cryptographically
   shuffles the deck, and assigns roles. Players acknowledge that they have
   seen their card.
3. **Night:** the GM opens each night role in order. Eligible living players
   choose targets privately. Killers can see the living killer team and picks.
4. **Resolution:** the GM decides what happens. The app records kills, lynches,
   revives, reassignments, and hunter shots; it does not automatically resolve
   protection or tie decisions.
5. **Day:** the group discusses and votes aloud. The GM records the lynch.
6. **Win check:** the app suggests good, evil, or jester victory. The GM
   confirms or chooses a draw/other outcome.
7. **Reveal:** cards are revealed one at a time, dead players first, living
   players next, and killers last. The winner is visible after the final reveal.

### Roles

The shared role catalog in [`shared/roles.js`](../shared/roles.js) defines the
engine's stable roles:

| Role | Team | Night action | Rule |
|---|---|---:|---|
| `killer` | Evil | Yes | Living killers choose together; a strict majority produces a leader pick |
| `protector` | Good | Yes | Chooses a player; the GM decides whether protection prevents a kill |
| `inspector` | Good | Yes | Chooses another player; the GM communicates the result privately |
| `hunter` | Good | No | May shoot after death when the GM enables the action |
| `jester` | Neutral | No | Wins when lynched |
| `townsfolk` | Good | No | No special app action |

The role validator requires at least one killer, prevents killers from making
up half or more of the player count, rejects unknown roles, and fills unused
slots with townsfolk.

## System architecture

### Deployment topology

```text
Player/GM browser
        |
        | HTTPS static assets
        v
GitHub Pages
  malterlo.github.io/werewolf
        |
        | WebSocket (wss://) + optional HTTP admin requests
        v
Cloudflare Quick Tunnel
  temporary *.trycloudflare.com URL
        |
        v
Self-hosted Node.js container
        |
        +--> In-memory room Map (authoritative realtime state)
        |
        +--> SQLite database on persistent /data volume
        |
        +--> Google OpenID Connect (operator sign-in only)
```

The game frontend normally connects to the configured backend WebSocket URL.
For local development, the browser uses `ws://localhost:8080`. The published
frontend currently defaults to the active Cloudflare Quick Tunnel URL. It also
accepts `server` and `http` query parameters and home-screen server settings
for testing against another backend.

The Quick Tunnel is temporary. Its URL changes when `cloudflared` restarts,
and Create room or Join game cannot connect while the tunnel is stopped. A
Cloudflare `530` response means the tunnel or its local origin is unavailable;
the GitHub Pages UI may still load because the static frontend is independent
of the backend.

The backend is designed as one Node process. SQLite and the in-memory room map
are intentionally not treated as a distributed data layer. This keeps the
deployment small and predictable, but means the accepted operating model is
one homeserver and one active backend process.

### Repository structure

```text
/
├── backend/
│   ├── config.js                 Environment configuration and limits
│   ├── logger.js                 Structured logging
│   ├── server.js                 HTTP, WebSocket, room intents, lifecycle
│   ├── domain/
│   │   └── game.js               Pure-ish game state transitions and rules
│   ├── http/
│   │   ├── routes.js              Health, OAuth, admin, history routes
│   │   └── views.js               Personalized player/GM projections
│   ├── persistence/
│   │   └── database.js            SQLite schema, snapshots, events, history
│   └── services/
│       └── room-service.js        Room creation, restore, deletion
├── frontend/
│   ├── index.html                 Browser shell and favicon
│   ├── app.js                     Client state, rendering, protocol client
│   └── styles.css                 Mobile-first theatrical UI
├── shared/
│   └── roles.js                   Role catalog and composition validation
├── docs/                          Product, game, operations, architecture docs
├── openspec/                      v2 proposal, design, capabilities, tasks
├── Containerfile                  Backend image definition
├── package.json                   Runtime scripts and dependencies
├── test.js                        HTTP and integration smoke tests
└── sim.js                         WebSocket protocol simulator
```

### Backend layers

#### Runtime and transport: `backend/server.js`

The server creates an Express HTTP application and a WebSocket server sharing
one listener. It:

- creates and restores rooms;
- accepts WebSocket intents;
- authorizes GM-only operations;
- attaches and replaces GM/player sockets;
- broadcasts personalized state;
- applies message-size and per-socket rate limits;
- enforces the configured origin allowlist;
- performs room expiry;
- handles graceful `SIGTERM`/`SIGINT` shutdown.

The server's `handle` function is the protocol boundary. It validates message
shape, resolves the room and seat, applies the appropriate domain transition,
records event details, and broadcasts a new snapshot.

#### Domain model: `backend/domain/game.js`

A room is a plain object containing:

- room code, theme, source, phase, round, winner;
- configured roles and dealt state;
- player records in a `Map`;
- night turn state, picks, and closed-role markers;
- reveal order and reveal progress;
- display log and undo history;
- activity timestamp;
- runtime sockets.

The domain module owns role dealing, cryptographic shuffle, alive-player
selection, killer vote tallying, win suggestions, death effects, reveal
ordering, and the 30-entry undo stack.

Undo does not erase persisted history. It restores the prior in-memory
projection and emits a compensating event, preserving an append-only audit
timeline.

#### Projection layer: `backend/http/views.js`

`viewFor(room, who)` is the privacy boundary for WebSocket state.

The GM projection includes roles, all player status, night holders and picks,
role counts, win suggestions, and controls. A player projection includes only
the player's own role and permitted turn data. Killer projections include
living killer teammates and their picks, while other private picks remain
hidden. Revealed cards are added only when their reveal sequence permits them.

The frontend receives full snapshots rather than incremental patches. This
reduces client synchronization complexity and makes reconnecting a seat
straightforward: the next snapshot is authoritative for that client.

#### Persistence layer: `backend/persistence/database.js`

SQLite is configured for WAL mode and stores:

- `games`: versioned live room snapshots;
- `game_players`: seat records and hashed reconnect credentials;
- `events`: ordered append-only live events;
- `finished_games`: completed-game metadata;
- `finished_players`: roles, teams, outcome, and death round after completion;
- `finished_events`: completed-game event history;
- `security_events`: authentication and abuse/security records;
- `users`: operator identities;
- `admin_sessions`: hashed server-side operator sessions.

Accepted state changes write the updated snapshot and event in one
`BEGIN IMMEDIATE` transaction. Persistence failures are logged and counted,
while the realtime broadcast continues. A later successful write captures the
current authoritative room state.

Room snapshots remove runtime sockets and bearer tokens. Player and GM
reconnect credentials are persisted as SHA-256 hashes. Restore rejects unknown
snapshot versions and skips expired or invalid records without deleting them.

#### HTTP and operator layer: `backend/http/routes.js`

The backend provides:

- `GET /health` for liveness checks;
- `/auth/google` and callback/logout endpoints for operator authentication;
- `/admin` for the operator dashboard;
- `/admin/api/*` for live metadata, metrics, security events, and history;
- `/history` and `/history/:code` for authorized finished-game access;
- `/history/analytics` for aggregate role and outcome statistics.

Google sign-in uses state, nonce, PKCE, issuer, audience, expiry, and verified
email validation. Operator sessions use random IDs in HTTP-only cookies while
only session hashes are stored. Allowlisted email addresses or stored admin
roles authorize access to operator data.

Live admin endpoints intentionally return metadata such as room code, theme,
phase, round, player count, online count, and last activity. They do not return
live roles, picks, reconnect tokens, or full room snapshots.

### Frontend architecture

The frontend is a static, dependency-free browser application:

- `index.html` supplies the shell, theme metadata, fonts, stylesheet, favicon,
  application mount point, and dialogs.
- `app.js` owns the WebSocket connection, local storage sessions, language
  preference, sound preference, rendering, intent dispatch, dialogs, and
  hold-to-reveal behavior.
- `styles.css` provides the responsive mobile-first UI, dark theatrical
  palette, role card treatment, night mode, reduced-motion behavior, and
  accessible focus states.
- `favicon.svg` provides the Night Table moon-and-wolf browser mark.

The client uses local storage for reconnect session information and language/
sound preferences, and can persist a manually selected backend URL. It does
not contain authoritative game rules or role assignments. Every action is sent
as an intent and the server response replaces the relevant client state.

The role card follows a secrecy-oriented lifecycle: the role is revealed only
while the player holds the card, is hidden on release or tab changes, and has a
time limit. Night mode dims the player view and shows target controls only when
the server says that player's role is awake.

## WebSocket protocol

### Connection lifecycle

1. Browser opens a WebSocket connection.
2. GM sends `create`, or a player sends `join`.
3. Server replies with `joined`, including the room code, seat token, and role
   (`gm` or `player`).
4. Server sends `state` snapshots after accepted changes.
5. A disconnected client sends `resume` with its room code and token.
6. The server returns `joined` with `resynced: true`, then sends the
   personalized current state.

GM recovery uses `claim_gm` with a room code, one-time two-word key, and
nickname. The successful claim rotates the GM session token and recovery key.

### Intent categories

**Session and lobby**

- `create`
- `join`
- `resume`
- `claim_gm`
- `leave`

**Player**

- `ack`
- `night_target`

**GM**

- `config`
- `deal`
- `set_phase`
- `open_turn`
- `close_turn`
- `kill`
- `lynch`
- `revive`
- `reassign`
- `kick`
- `end`
- `reveal_next`
- `reveal_all`
- `undo`
- `hunter_done`
- `abort`
- `pass_gm`

The server never accepts a client-supplied snapshot as authority. IDs and
parameters are validated against the current room, phase, role, alive state,
and permissions before the mutation is applied.

### Broadcast behavior

After an accepted state-changing intent, the server:

1. updates the in-memory room;
2. persists a snapshot and event transaction;
3. archives the room if the final reveal is complete;
4. sends a GM projection to the GM socket;
5. sends a separate player projection to each connected seat.

This design makes the privacy decision at the server boundary rather than
trying to redact a shared client object.

## Data and persistence lifecycle

### Live room

Live rooms are authoritative in memory for low-latency interaction. SQLite
contains a recovery snapshot and an event stream. Snapshot versioning allows
future schema changes to reject unsupported snapshots safely.

When the server restarts, supported non-expired rooms are restored with empty
socket maps. Every seat is therefore offline until its holder resumes. The
room's stored last-activity time is used for expiry decisions.

### Finished room

After the final reveal, the room is copied into the finished tables. Finished
records contain game metadata, player roles and teams, and the complete ordered
event history. Live snapshot, live seat, and live event rows are then removed.

Finished history is the only place where role assignments are intentionally
available to authorized operators. Replay marks events compensated by undo
events rather than deleting the original event.

### Credential handling

GM and player reconnect tokens are random bearer values issued to the browser.
Only hashes are persisted. GM recovery keys are also hashed, rate-limited, and
rotated after successful use. No HTTP history or live-admin route should
contain these credentials.

## Security and privacy controls

### Browser and transport controls

- explicit `ALLOWED_ORIGIN` configuration;
- WebSocket origin verification;
- 2 KB maximum WebSocket payload;
- approximately 20 messages per socket per five seconds;
- security headers including `nosniff`, frame denial, and no-referrer;
- no-store caching for admin/history responses;
- HTTP-only, SameSite operator cookies;
- TLS guidance for public deployments.

### Authorization controls

- GM-only intent allowlist;
- room and seat ownership checks;
- alive/phase/turn checks for night actions;
- operator authentication before admin and history routes;
- email allowlist or authorized stored operator role;
- separate live metadata and finished-history access paths;
- confirmation dialogs for destructive GM actions in the client.

### Secrecy boundaries

The most important security invariant is not merely authentication. It is
field-level projection:

- live player views cannot contain other roles;
- non-killer players cannot see killer picks;
- dead players do not receive roles before reveal;
- live persistence events do not map role assignments to seats;
- operators cannot retrieve full live snapshots;
- finished roles are available only after completion through authorized
  history routes.

## Operations and deployment

### Backend container

The [Containerfile](../Containerfile) builds a Node 22 Bookworm slim image,
installs production dependencies with `npm ci`, runs as the non-root `node`
user, exposes port `8080`, and stores SQLite under `/data`. It includes a
health check against `/health` and declares `SIGTERM` as the shutdown signal.

Typical testing deployment:

```bash
podman build -t nighttable-backend -f Containerfile .
podman run --rm -p 8080:8080 \
  -e ALLOWED_ORIGIN=http://localhost:3000 \
  -v nighttable-data:/data:U \
  nighttable-backend
```

The frontend can be served locally with:

```bash
python3 -m http.server 3000
```

The published frontend is deployed by
`.github/workflows/pages.yml` to
`https://malterlo.github.io/werewolf/`. The backend must be reachable over
`wss://` for a public GitHub Pages client.

### Free remote testing with Cloudflare Quick Tunnel

When a stable domain is not available, expose the backend with:

```bash
cloudflared tunnel --url http://localhost:8080
```

Use the printed temporary hostname in the frontend:

```text
https://malterlo.github.io/werewolf/?server=wss://example-name.trycloudflare.com
```

Set the backend origin allowlist to the published frontend:

```bash
ALLOWED_ORIGIN=https://malterlo.github.io
```

Verify the tunnel before testing the browser:

```bash
curl https://example-name.trycloudflare.com/health
```

The expected response is `{"ok":true}`. If it returns `530`, restart
`cloudflared` and use the newly printed URL. A purchased domain is not
required for temporary testing. Some mobile browsers may show a local-network
access prompt when a hostname resolves through a private/Tailscale address;
using a genuinely public tunnel or reverse proxy avoids that behavior.

### Required production configuration

At minimum, configure:

- `ALLOWED_ORIGIN` with exact frontend origins;
- persistent `/data` storage;
- TLS at the public reverse proxy or tunnel;
- `SIM_KEY` only when simulator rooms are required;
- Google OAuth variables only when the operator console is required:
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
  `SESSION_SECRET`, and `ADMIN_EMAILS`.

The backend should be stopped with `SIGTERM` before replacement so committed
state is flushed and clients receive a reconnectable shutdown signal. Keep the
previous container image available for rollback.

### Resource model

The intended v1/v2 limits are 50 rooms, 20 players per room, 2 KB messages,
and one Node process. The product requirements target a 256 MB container
budget. A formal 50-room/20-connection load test and p95 latency measurement
remain outstanding.

## Testing and verification

### Current validation

The repository's `npm test` command runs `node test.js`, which exercises
server startup and HTTP behavior, including health, unauthorized admin/history
access, OAuth configuration behavior, and security-related responses. The
backend container has also been built and smoke-tested against `/health`.
The frontend is deployed through GitHub Pages. Its game buttons require a
reachable WebSocket backend, so the default Quick Tunnel must be running for
remote Create room and Join game tests.

The simulator can run complete protocol-level games:

```bash
SIM_KEY='<simulator-key>' \
  npm run sim -- --server ws://localhost:8080 --games 10 \
  --players 4-8 --parallel 2 --seed 7 --pace 10
```

The simulator uses normal GM/player WebSocket intents and tags accepted rooms
as `sim`. Its local choices are seedable, while server role assignment remains
cryptographically random.

### Remaining verification work

The active tracker in
[`openspec/changes/night-table-v2/tasks.md`](../openspec/changes/night-table-v2/tasks.md)
identifies these outstanding areas:

1. Automated restart reconnect verification for GM and player seats.
2. Simulator tests for invalid transitions and secrecy failures.
3. Target load test for 50 rooms and 20 connections per room.
4. Seven-copy backup policy and restore drill.
5. Clean-checkout self-hosting and recovery documentation.
6. Discussion timer.
7. Localized generic name-filtering errors.
8. Safe role-art loading and fallback behavior.
9. Native review of Khmer strings.

The report should not be read as claiming those items are complete. They are
the acceptance work needed before calling the v2 scope production-ready.
The Quick Tunnel is a testing convenience and does not provide permanent
hostname stability or an uptime guarantee.

## Strengths and trade-offs

### Strengths

- Very small operational footprint.
- No player accounts or installation friction.
- Strong server-side secrecy projection model.
- Full snapshots make reconnect and client recovery simple.
- SQLite transactions preserve snapshot/event consistency.
- Finished history is separated from live secrecy.
- Real WebSocket simulator exercises the production protocol.
- Graceful shutdown and persistent volume support make testing practical.

### Trade-offs

- One process and one SQLite file limit horizontal scalability.
- In-memory authority means the database is a recovery boundary, not the
  realtime source for concurrent workers.
- Full personalized snapshots use more bandwidth than patches, though the
  room/player limits keep this manageable.
- The GM remains responsible for social and ambiguous rules decisions.
- Browser bearer tokens are convenient but must be protected by the device and
  transport; server-side hashing does not make a stolen live token harmless.
- Google OAuth is optional but adds deployment configuration for operators.

## Recommended next steps

### Before wider testing

1. Add the restart reconnect integration test and make it a required CI check.
2. Add simulator assertions for invalid state transitions, event ordering, and
   cross-seat secrecy.
3. Run the load test under the real container memory limit.
4. Document and rehearse SQLite backup, restore, and rollback procedures.
5. Verify the frontend's configured public WebSocket endpoint from a real
   GitHub Pages browser session.

### Before production use

1. Complete the operational acceptance targets in the product requirements.
2. Set an exact origin allowlist and enforce TLS.
3. Configure and test Google operator authentication if admin tooling is used.
4. Establish a backup retention policy and restore-drill schedule.
5. Review all Khmer strings with a native speaker.
6. Add monitoring around persistence failures, room expiry, reconnect rates,
   and rejected security events.
7. Archive the OpenSpec change and sync completed capabilities into
   `openspec/specs/`.

## Source documents

- [Product requirements](product-requirements.md)
- [v1 game specification](game-spec.md)
- [OpenSpec proposal](../openspec/changes/night-table-v2/proposal.md)
- [OpenSpec design](../openspec/changes/night-table-v2/design.md)
- [OpenSpec task tracker](../openspec/changes/night-table-v2/tasks.md)
- [Project README](../README.md)
