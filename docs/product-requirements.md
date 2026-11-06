# Night Table: Product Requirements Document

Version 2.0 draft | 5 November 2026 | Status: draft for review

> OpenSpec is the implementation source of truth for v2. This document captures
> product intent and acceptance targets; see
> [`openspec/changes/night-table-v2/`](../openspec/changes/night-table-v2/) for
> the active proposal, design, capability specs, and task tracker.

Companion app for the in-person hidden-role games Werewolf and Mafia. Frontend on GitHub Pages, backend on a self-hosted homeserver.

## 1. Summary

Night Table is a mobile-first web app that lets a group play Werewolf or Mafia in a room or over a video call. Discussion, accusation and voting stay out loud. Phones carry each player's secret role and let night-role holders pick targets privately. One person acts as game master (GM) and runs the game from their own phone.

Version 1 is built and playable: lobby, deal, night turns, day, win suggestion, reveal, undo, reconnect, English and Khmer. Rooms live only in server memory.

Version 2, the subject of this document, adds four things:

1. **Persistence.** Games and events stored in SQLite so a server restart no longer ends live games.
2. **Operator tooling.** An admin dashboard behind Google sign-in: live rooms, server health, security log, audit log.
3. **History and analytics.** Finished games stored, replayable, and summarized in charts.
4. **Hardening and polish.** A bot simulator and load testing, backups, GM key handover for dead phones, discussion timer, art, Khmer review.

The product remains a host-operated aid, not an automated referee. Every v2 feature must preserve that and the privacy boundary described in section 12.

## 2. Background and problem

Hidden-role games need a narrator who knows every role. Physical cards work in person but fail on video calls, and the narrator cannot privately collect night choices without leaking who is awake. Existing party-game apps tend to either automate everything (removing the social game) or require accounts and installs (killing spontaneous play).

Problems v1 solves:

- Secret roles delivered to phones, hidden until the holder presses and holds the card.
- Night turns coordinated without anyone speaking, so silence never reveals a death or a missing role.
- A GM checklist and log so the narrator tracks state instead of memorizing it.

Problems v1 leaves open (addressed in v2):

- A server restart or redeploy kills every active game.
- The operator is blind: no view of rooms, load, abuse attempts, or how games actually go.
- No record of finished games, so no replay and no balance data.
- Several rough edges: no role art, Khmer text unreviewed, no timer, dead players have nothing to do.

## 3. Goals, non-goals and success metrics

### 3.1 Goals

| ID | Goal |
| --- | --- |
| G1 | A game in progress survives a backend restart with no player action beyond reconnecting. |
| G2 | The operator can see live room metadata, server health and security events without touching the server shell. |
| G3 | Finished games are stored and can be replayed and aggregated into balance statistics. |
| G4 | No new feature weakens secrecy. Admin tooling never sees a living game's roles or night picks. |
| G5 | Players need no account, install or login. Joining stays room code plus name. |
| G6 | The whole system runs on one modest homeserver container budget (256 MB app, SQLite file) and is documented well enough to rebuild from the repo. |
| G7 | A bot simulator plays complete games over the real WebSocket protocol, so sample data and load tests exercise the real code path. Simulated games are always tagged as simulated. |
| G8 | A game survives a dead GM phone: another phone takes over with a short, speakable GM key. |

### 3.2 Non-goals

- Voice or video. Players use their own call or sit together.
- In-app discussion chat.
- Automated rules resolution. The GM narrates and confirms every kill and every round end; the app only warns about protection.
- Player accounts, friends lists, matchmaking, public lobbies.
- Native apps. The product is a web page.
- Horizontal scaling. One Node process is the design.
- Monetization.

### 3.3 Success metrics (proposed targets)

| Metric | Target | Measured by |
| --- | --- | --- |
| Restart recovery | 100% of rooms in a test restart restored; players rejoin within 10 s | Automated restart test |
| Secret leakage | 0 role or pick fields in any admin response while a game is live | Automated leak test over every admin route |
| Concurrent load | 50 rooms with 20 sockets each, p95 snapshot delivery under 500 ms | Load test script |
| Time to start | Room created and 4 players dealt in under 2 minutes by a first-time group | Observation / playtest |
| Admin auth | Non-allowlisted Google account never reaches admin data | Automated auth test |
| Data completeness | Every finished game has a winner, per-player role and team, and an ordered event log | Query check after 10 test games |

## 4. Users and personas

| Persona | Description | Needs |
| --- | --- | --- |
| **GM (host)** | Runs the game, knows all roles, sits on a phone the whole session. Knows the server passphrase. | Fast setup, clear night checklist, safe undo, never leaking state on a shared screen. |
| **Player** | Joins with a code and a name on any phone. Often new to the game. | Zero-friction join, a card that is easy to peek at and hard to expose, clear instructions for their night action. |
| **Dead player** | Eliminated but still in the room. | A clear out screen that leaks nothing until the reveal. |
| **Operator** | The developer running the server. | Visibility into rooms, load, abuse, and history. Safe controls. |
| **Self-hoster** | Someone cloning the repo to run their own instance. | Works without OAuth or a database setup beyond a volume; `HOST_KEY` remains a fallback. |

## 5. Scope and releases

| Release | Contents | Status |
| --- | --- | --- |
| v1 | Lobby, deal, night/day flow, kill/lynch/revive/reassign/kick, win suggestion, sequenced reveal, undo, reconnect, themes, EN/KM, smoke test | Built |
| v2.0 | SQLite persistence and restore, security event log, metrics buffer, `adminViewFor`, Google OAuth admin login, admin API and dashboard (rooms, health, security, audit), GM key handover | This PRD, must |
| v2.1 | Bot simulator, game history API, replay timeline, analytics charts | This PRD, must |
| v2.2 | Ops: load test (reuses the simulator), backups, runtime config, writeup | This PRD, should |
| v2.3 | Discussion timer, role art, Khmer review, name filter | This PRD, nice |
| Later | Extra roles (witch, cupid), public TV board, spectator view, host accounts and presets, inspector auto-result | Backlog |

## 6. Game rules and functional requirements

Status column: **Built** exists in v1, **New** is added by this PRD.

### 6.1 Roles and teams

| Role ID | Team | Night action | Behavior |
| --- | --- | --- | --- |
| `killer` | Evil | Yes | Living killers pick a target together. A strict majority of living killers sets the leader pick; with no majority the GM decides. Shown as Werewolf or Mafioso by theme. |
| `protector` | Good | Yes | Picks a player. The app records the pick and warns the GM if a kill targets that player; the GM decides the outcome. |
| `inspector` | Good | Yes | Picks another player. GM privately tells the result. App sends no result. |
| `hunter` | Good | No | On death the GM may let them choose a target and records the shot. |
| `jester` | Neutral | No | Wins if lynched. |
| `townsfolk` | Good | No | No app action. |

Themes (Werewolf, Mafia) change names, descriptions, icons and colors in the browser only. Server mechanics are theme-independent.

### 6.2 Win conditions

- **Evil wins** when living killers are at least as many as all other living players (1 killer vs 1 other = evil wins).
- **Good wins** when no killers remain alive.
- **Jester wins** immediately if lynched.
- The app suggests an outcome from alive roles. The GM confirms. The GM may end the game with any winner.

### 6.3 Room and lobby

| ID | Requirement | Status |
| --- | --- | --- |
| FR-LOB-1 | Creating a room requires the server passphrase when `HOST_KEY` is set. Creator becomes the GM and enters a nickname, stored with the game. | Built |
| FR-LOB-2 | Room code is 4 characters, generated with Node crypto, unique among live rooms. | Built |
| FR-LOB-3 | Players join with code plus name. Joining is blocked once cards are dealt. | Built |
| FR-LOB-4 | Names are trimmed, control characters stripped, maximum 16 characters. Duplicates rejected. | Built |
| FR-LOB-5 | Maximum 20 players per room and 50 rooms per process. | Built |
| FR-LOB-6 | The GM can pick the theme, set role counts, and remove (kick) players in the lobby. | Built |
| FR-LOB-7 | One GM per room. Control can move to another phone with the GM key (FR-LOB-10 to FR-LOB-12). | Built |
| FR-LOB-8 | Names pass a profanity filter. Filtered names are rejected with a generic error. | New (v2.3) |
| FR-LOB-9 | The room view shows connected and disconnected state per player to the GM. | Built |
| FR-LOB-10 | On room creation the server generates a GM key: two plain words joined by a hyphen (for example amber-fox) drawn from a curated list of about 1,000 short, common, non-homophone words. It is shown to the GM once, with a prompt to screenshot it. Only a hash is stored. | New |
| FR-LOB-11 | Take over as GM: any phone enters room code plus GM key. On success the GM token moves to the new phone, the old phone shows a GM changed screen and becomes an observer, everyone sees GM changed in the log, a new key is issued to the new GM and the old key stops working. Works for a dead phone and for a planned handover. An open night turn, its picks, the phase and the undo history carry over, so the new GM resumes exactly where the old one stopped. The new GM enters a nickname. Logged as gm\_transferred with both nicknames. | New |
| FR-LOB-12 | Failed key attempts: 3 wrong keys lock claims on that room for 5 minutes, regardless of IP. A per-IP lockout also applies. Every failure writes a security event. | New |
| FR-LOB-13 | Concurrent claims: the first valid claim wins. The key rotates on success, so a second claim with the old key fails with bad\_gm\_key. | New |
| FR-LOB-14 | Pass GM (lobby only, including the lobby after a game): the GM picks a connected player and taps Make GM. That player becomes GM and enters a nickname; the old GM becomes a normal player with their nickname. Direct swap, no key needed because no roles are dealt. A new GM key is issued, the key rotates, and the player count is unchanged. Logged as gm\_passed. | New |
| FR-LOB-15 | Abort game: after the deal the GM can abort with a confirm dialog. The game is stored with end\_reason aborted, no roles are revealed and no game\_players rows are written, analytics exclude it, and the room returns to the lobby with the same players. A GM who wants to play must abort or finish, then Pass GM, then redeal; the GM cannot become a player mid-game because they have seen every role. | New |

### 6.4 Deal

| ID | Requirement | Status |
| --- | --- | --- |
| FR-DEAL-1 | Deal requires at least `MIN_PLAYERS` (default 4). | Built |
| FR-DEAL-2 | Default composition: one killer per roughly four players, minimum one; at six or more players add one inspector and one protector; remaining cards are townsfolk. | Built |
| FR-DEAL-3 | Validation: at least one killer, killers strictly fewer than half of all players, total roles not above player count. Invalid setups are rejected with a specific error. | Built |
| FR-DEAL-4 | The deck is shuffled with `crypto.randomInt`. | Built |
| FR-DEAL-5 | Each player sees only their own role. The GM sees all. | Built |
| FR-DEAL-6 | A player acknowledges that they looked at their card. The GM sees who has not yet acknowledged. | Built |
| FR-DEAL-7 | The deal event records seed-free composition (counts per role) in the event log. Per-player assignments are stored only in memory and the snapshot until game end. | New |

### 6.5 Night

| ID | Requirement | Status |
| --- | --- | --- |
| FR-NIGHT-1 | On night start every player phone goes black with an eyes-closed cue. | Built |
| FR-NIGHT-2 | The GM checklist lists every role in play, including roles whose holders are all dead, so the GM's pacing never reveals a death. | Built |
| FR-NIGHT-3 | The GM opens one role turn at a time with Wake. Living holders see a target picker and the phone buzzes. The GM closes the turn manually. | Built |
| FR-NIGHT-4 | Only a living player holding the open role may submit a night target. Other submissions are rejected. | Built |
| FR-NIGHT-5 | Picks can be changed until the turn closes. | Built |
| FR-NIGHT-6 | While the killer turn is open, living killers see living teammates and their live picks. No other role's picks are shared with any player. | Built |
| FR-NIGHT-7 | On a strict majority among living killers the GM sees a Kill X shortcut. With no majority the GM chooses. | Built |
| FR-NIGHT-8 | Protector and inspector picks are visible to the GM. Results are communicated out of band. | Built |
| FR-NIGHT-9 | The GM records deaths manually. Every kill needs a confirm dialog. | Built |
| FR-NIGHT-10 | Night phase changes do not buzz non-GM phones, to avoid audible tells. | Built |
| FR-NIGHT-11 | Protection hint: when the GM records a kill and the living protector's pick this night is the same player, the GM sees a Protected prompt with Cancel kill or Kill anyway. Nothing applies automatically. Inspector results stay out of band. | New |
| FR-NIGHT-12 | The protector may protect themselves and the same player on consecutive nights. The app enforces no restriction; the GM can deny a pick verbally. | New |

### 6.6 Day

| ID | Requirement | Status |
| --- | --- | --- |
| FR-DAY-1 | Discussion and voting happen out loud. The app collects no votes. | Built |
| FR-DAY-2 | The GM records the lynch with a confirm dialog. Ties and special cases are the GM's decision. | Built |
| FR-DAY-3 | A hunter's death offers the GM a shot flow: choose target, record, log. A cancelled kill is not a death, so no shot. | Built |
| FR-DAY-4 | The GM can start a shared countdown timer visible on all phones. Expiry buzzes and shows a banner but changes no state. | New (v2.3) |
| FR-DAY-5 | Cut from v2. Dead players keep the existing out screen until the end reveal. | Cut |

### 6.7 End, reveal and undo

| ID | Requirement | Status |
| --- | --- | --- |
| FR-END-1 | The GM ends the game and picks the winner. The app pre-suggests one. | Built |
| FR-END-2 | Reveal is sequenced: dead first, then living, killers last. The GM taps to flip each card; a reveal-all option exists. The winner banner appears only after the last card. | Built |
| FR-END-3 | On end the server writes the finished game to the database (section 10). | New |
| FR-UNDO-1 | Undo reverts the last 30 state changes. Kicking a player clears undo history. | Built |
| FR-UNDO-2 | Undo also appends a compensating event to the event log; it never deletes events. | New |
| FR-END-4 | Play again: after the reveal the GM taps Play again. The room returns to the lobby with the same code, players, seats, theme and role counts. Roles reshuffle on the next deal, undo history and round counter reset, and the next deal creates a new game record. | New |

### 6.8 Sessions and reconnect

| ID | Requirement | Status |
| --- | --- | --- |
| FR-SES-1 | Each player and the GM receive a random reconnect token on join. Tokens are bearer credentials kept in the browser. | Built |
| FR-SES-2 | A disconnected client rejoins its seat with its token, including after a server restart once persistence is live. | New |
| FR-SES-3 | Rooms expire after 2 hours idle, or 15 minutes with no connected clients. Persisted snapshots follow the same expiry. | Built / New |
| FR-SES-4 | Stored tokens are hashed. A database leak does not yield usable tokens. | New |

### 6.9 Rules sheet

The in-app rules sheet is generated from the roles actually in play and shown in the active language. Built.

## 7. Experience requirements

### 7.1 Screens

| Actor | Screens |
| --- | --- |
| Anyone | Landing (create or join), join form, language toggle, sound toggle, rules sheet |
| Player | Lobby wait, deal (hold-to-reveal card), night black screen, night picker, day, out screen, end reveal |
| GM | Lobby setup (theme, counts, players), deal status, night checklist, day controls (kill, lynch, revive, reassign, hunter shot), undo, end and reveal |

### 7.2 Hold-to-reveal card

- Role name and art enter the DOM only while the card is held.
- Content is removed on release, on tab visibility change, and after 10 seconds.
- Role art loads from `art/<theme>/<role>.webp` (500 by 700); emoji fallback when absent.

### 7.3 Look and feel

- Dark, moody, theatrical palettes for Werewolf and Mafia.
- Display type Fraunces, with Noto fallbacks for Khmer.
- Tap targets at least 44 px. Reduced-motion preference respected.

### 7.4 Language

- English and Khmer on every screen, remembered per device.
- Khmer strings are a draft; native review is a tracked task (v2.3).
- New strings added by v2 (timer, spectator, admin) ship in English first and are flagged for Khmer review. The admin dashboard is English only.

### 7.5 Haptics and sound

- Buzz on deaths, phase change to day, turn open, reveals. Not on night phase change.
- Ambient sound is off by default, per-player toggle, plays on living players' phones during night only, identical for everyone so it leaks nothing.

### 7.6 Error and empty states

- Every rejected action (bad code, duplicate name, full room, dealt room, rate limit, wrong passphrase) shows a specific, translated message.
- Lost connection shows a reconnecting banner and retries with backoff. Token reuse restores the seat.
- Restored-after-restart rooms show a brief resynced notice.

## 8. System architecture

### 8.1 Components

| Component | Tech | Responsibility |
| --- | --- | --- |
| Game client | One static `index.html`, no build step | Player and GM UI, translations, themes, WebSocket client |
| Game server | Node 22, Express, `ws` | Room lifecycle, rules, permissions, personalized snapshots, health endpoint |
| Admin client | Static `admin.html` served by the game server | Operator dashboard |
| Auth module | `openid-client` | Google OIDC login, sessions, allowlist check |
| Store | SQLite file on a container volume | Event log, finished games, snapshots, users, sessions, audit, security events |
| Edge | Tailscale Funnel | Public TLS endpoint `wss://` and `https://` for the container |
| Static host | GitHub Pages | Serves the game client only |
| Bot simulator | Node script, run from a laptop or the server | Bots create rooms and play complete games over WebSocket for sample data and load tests |

### 8.2 Topology

- Player and GM browsers load the game client from GitHub Pages and open a `wss://` connection to the homeserver through Tailscale Funnel.
- The container (published on host port 8088, listening on 8080) runs the game server and serves `/admin`, `/auth/*` and `/admin/api/*` from the same origin.
- The operator opens the admin page directly on the Funnel host. Admin never loads from GitHub Pages. This keeps the session cookie first-party, avoids cross-site cookie blocking, and keeps the admin entry point off the public repo site.
- SQLite lives at `/data/nighttable.db` on a named volume.

### 8.3 Process model

- One Node process. The in-memory room `Map` is authoritative for live games.
- The database is write-behind: every state change appends an event and updates the room snapshot. The database is read only on boot and for history and admin queries.
- Database writes use `better-sqlite3` (or `node:sqlite`) in WAL mode. Writes are small and synchronous; if write latency exceeds a threshold the server logs a warning but never blocks the broadcast.

### 8.4 Proposed module layout

| File | Responsibility |
| --- | --- |
| `index.js` | Entry, wiring, graceful shutdown |
| `rooms.js` | Room state, transitions, undo, expiry |
| `ws.js` | WebSocket intents, rate limit, `viewFor` |
| `http.js` | Express app, health, static admin, security headers |
| `db.js` | SQLite open, migrations, prepared statements |
| `auth.js` | OAuth routes, sessions, middleware |
| `admin.js` | Admin API routes and `adminViewFor` |
| `metrics.js` | Ring buffers, counters |
| `data.js` | Role catalog, deal defaults, validation (exists) |
| gmkey.js, wordlist.js | GM key generation, hashing, claim and lockout; the curated word list |
| sim.js | Bot simulator, a separate script never loaded by the server |

## 9. Realtime protocol

### 9.1 Principles

- Clients send intent only, as JSON `{type, ...fields}`. The server validates, mutates state, then broadcasts a full personalized snapshot to each connected client.
- Clients never mutate authoritative state locally.
- Messages are capped at 2 KB and 20 per 5 seconds per socket. Over-limit sockets get an error and, on repeat, are closed.
- Snapshot is built only by `viewFor(room, seat)`. No other code path serializes game state to a player socket.

### 9.2 Client intents

Intent names marked existing come from the v1 spec. Others are illustrative and must be reconciled with `index.js` during Phase 0.

| Intent | Sender | Purpose | Status |
| --- | --- | --- | --- |
| `create` | Host | Create room (with passphrase if required) | Built |
| `join` | Player | Join with code and name | Built |
| `rejoin` | Any | Resume seat with token | Built |
| `ack` | Player | Confirm card seen | Built |
| `night_target` | Player | Pick target for own open role | Built |
| GM config / deal / phase / wake / close / kill / lynch / revive / reassign / kick / undo / end / reveal | GM | State-changing controls | Built |
| `timer_start`, `timer_stop` | GM | Shared countdown | New (v2.3) |
| `leave` | Any | Leave room | Built |
| gm\_claim | Any phone | Take over as GM with room code plus GM key | New |
| pass\_gm, abort, play\_again | GM | Hand GM to a player in the lobby, abort a dealt game, return to the lobby after a reveal | New |

### 9.3 Server messages

| Message | Content |
| --- | --- |
| `state` | Full personalized snapshot (below) |
| `error` | `{code, message key}`; client translates by key |
| `closed` | Room closed by admin or expiry, with reason key |
| `resynced` | Sent once after server restart restore |

### 9.4 Snapshot contents

| Field group | Player | Dead player | GM |
| --- | --- | --- | --- |
| Room code, theme, phase, round, language-neutral log | Yes | Yes | Yes |
| Player list with name, alive, connected | Yes | Yes | Yes |
| Own role and team | Yes (alive) | No, until reveal | n/a |
| Others' roles | No | No | Yes, all |
| Night turn state | Own role only, while open | No | All roles, checklist |
| Killer teammates and live picks | Living killers, killer turn open | No | Yes |
| Other roles' picks | No | No | Yes |
| Timer | Yes | Yes | Yes |
| End reveal | After flip sequence | After flip sequence | Yes |

### 9.5 Error codes

`bad_code`, `room_full`, `room_dealt`, `name_taken`, `name_invalid`, `bad_passphrase`, `locked_out`, `rate_limited`, `not_gm`, `not_your_turn`, `invalid_setup`, `too_few_players`, `server_busy`, `payload_too_large`. GM key claims add bad\_gm\_key and gm\_claim\_locked. Every code has an English and Khmer string.

## 10. Data model (SQLite)

All timestamps are UTC ISO strings or epoch milliseconds, stated per column. Migrations are versioned in `db.js` and run on boot inside a transaction.

### 10.1 Tables

| Table | Columns | Notes |
| --- | --- | --- |
| `users` | `id` pk, `google_sub` unique, `email`, `name`, `role` (admin), `created_at`, `last_login` | Key on `sub`, never on email |
| `sessions` | `id_hash` pk, `user_id` fk, `created_at`, `expires_at`, `ip`, `user_agent` | Store SHA-256 of the cookie value |
| `games` | `id` pk, `code`, `theme`, `started_at`, `ended_at`, `winner`, `player_count`, `rounds`, `end_reason`, source (live or sim), gm\_name | Row created at deal, completed at end |
| `game_players` | `game_id` fk, `seat`, `name`, `role`, `team`, `died_round`, `died_cause` | **Inserted only when the game ends** |
| `events` | `game_id` fk, `seq`, `at`, `type`, `data_json` | Primary key `(game_id, seq)`. Append only |
| `room_snapshots` | `code` pk, `version`, `state_json`, `updated_at` | One row per live room, deleted on end or expiry |
| `tokens` | `token_hash` pk, `code`, `seat`, `kind` (gm or player), `created_at` | Hashed reconnect tokens |
| `security_events` | `id` pk, `at`, `type`, `ip`, `detail_json` | Failed passphrase, lockout, bad origin, oversize, rate limit, auth failure |
| `audit_log` | `id` pk, `at`, `user_id`, `action`, `target`, `ip`, `detail_json` | Every admin mutation |
| `config` | `key` pk, `value_json`, `updated_by`, `updated_at` | Runtime overrides |
| gm\_keys | code pk, key\_hash, issued\_at, failed\_count, locked\_until | One row per live room; hash replaced on every successful claim; deleted with the room |

### 10.2 Indexes

`events(game_id, seq)`, `games(ended_at)`, `games(winner)`, `game_players(game_id)`, `security_events(at)`, `security_events(type, at)`, `audit_log(at)`, `sessions(expires_at)`.

### 10.3 Event types

`room_created`, `player_joined`, `player_left`, `player_kicked`, `config_changed`, `dealt` (role counts only), `acked`, `phase_changed`, `turn_opened`, `turn_closed`, `night_pick` (actor seat, target seat), `kill`, `lynch`, `revive`, `reassign`, `hunter_shot`, `undo`, `timer_started`, `game_ended`, gm\_transferred, gm\_claim\_failed, kill\_prevented, gm\_passed, game\_aborted, play\_again.

### 10.4 Secrecy rules for stored data

- While a game is live, `events` references players by seat number and names only. Role identifiers appear in `night_pick` only as the acting role, and live events are never exposed by any admin route until `games.ended_at` is set.
- `game_players` rows (the role map) are written at game end, not before.
- `room_snapshots.state_json` contains full state, including roles, because the server must restore a live game. It is never returned by any HTTP route. File-level access to the volume is therefore equivalent to GM access; treat the volume as secret.

### 10.5 Retention

| Data | Retention |
| --- | --- |
| Finished games and events | Kept indefinitely (small), operator can purge. Stores winner, player nicknames and the GM nickname only; no emails and no player IPs in game rows |
| Security events | 90 days |
| Audit log | 1 year |
| Sessions | Deleted on expiry by a periodic sweep |
| Snapshots | Deleted on end, or after expiry rules in FR-SES-3 |

## 11. Persistence and recovery

### 11.1 Write path

1. Client intent arrives, server validates and mutates the in-memory room.
2. Server appends an event row and upserts the snapshot in one transaction.
3. Server broadcasts personalized snapshots.

If step 2 fails, the server logs the error, increments a metric and still broadcasts. The next successful write repairs the snapshot. Persistent write failure raises an alert in the admin health panel.

### 11.2 Boot restore

1. Open database, run migrations.
2. Load all non-expired snapshots, validate `version`, rebuild room objects.
3. Mark every seat disconnected. Start the idle and empty expiry timers from `updated_at`.
4. Players rejoin with their stored token; each receives a `resynced` message with the snapshot.

Snapshots with an unknown version are skipped, logged, and left for manual inspection.

### 11.3 Graceful shutdown

On SIGTERM the server stops accepting new connections, flushes pending writes, sends clients a `closed` or reconnect hint, closes the database and exits within 10 seconds.

### 11.4 Backups

- Nightly `sqlite3 /data/nighttable.db .backup` to a second disk, keeping 7 daily copies.
- Quarterly restore drill documented in the writeup.
- Backups contain live roles through snapshots; store them with the same care as the volume.

## 12. Security and privacy

### 12.1 Principles

1. The server never sends a secret to a client that must not see it.
2. `viewFor` is the only function that turns room state into a player or GM payload.
3. `adminViewFor` is a separate function returning metadata only and shares no code path with `viewFor`.
4. Authentication proves identity; a separate authorization check decides admin access.

### 12.2 Data classification

| Data | Class | Who may see |
| --- | --- | --- |
| Role assignments, live picks | Secret | Seat owner for own role, GM for all, killer teammates for killer picks |
| Reconnect tokens, GM keys, session cookies | Credential | Holder only; stored hashed |
| `HOST_KEY`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` | Credential | Environment only, never logged or returned |
| Room metadata (phase, counts, names, age) | Internal | Admin |
| Finished game roles and events | Historical | Admin |
| Player names | Low sensitivity | Room members, admin |

### 12.3 Threats and mitigations

| Threat | Mitigation |
| --- | --- |
| Player reads another's role via crafted message | Server-side `viewFor`, permission checks per intent, tests |
| Player spoofs GM actions | GM-only intents checked against GM token |
| Admin endpoint leaks roles | `adminViewFor`, finished-only history, automated leak test across all admin routes |
| Brute force of `HOST_KEY` | Constant-time compare, 5 failures lock the IP for 10 minutes, security event logged |
| Brute force or abuse of `/auth/*` | Rate limit per IP, Google handles credentials |
| Any Google user gains admin | `ADMIN_EMAILS` allowlist or `users.role`, 403 otherwise |
| Session theft | HTTP-only, Secure, SameSite=Strict cookie, hashed IDs, 8 hour expiry, logout kills session |
| CSRF on admin mutations | SameSite=Strict, custom header required, JSON-only bodies |
| OAuth code interception or replay | PKCE, `state`, `nonce`, exact redirect URI match |
| Cross-origin abuse of WebSocket | `ALLOWED_ORIGIN` allowlist enforced in production |
| Memory exhaustion | 50 rooms, 20 players, 2 KB messages, bounded metric buffers, 256 MB container limit |
| Token leakage from database | Tokens and session IDs stored as hashes |
| Operator also plays in a game | Admin has no assignment data for live games; room composition counts only |
| Public Funnel exposure | Rate limits, allowlist, audit log, no unauthenticated admin data |
| A player guesses the GM key to take over and see all roles | Two-word key (about 1 million combinations), 3 failures lock claims on that room for 5 minutes regardless of IP, per-IP lockout, takeover visible to the whole room, key hashed and rotated after every claim |
| Simulated games mistaken for real play, or a player marking a room as simulated | Source column on every game, simulated rooms need SIM\_KEY, charts label simulated data, writeup reports counts per source |

### 12.4 HTTP hardening

- Headers: `Content-Security-Policy` for admin page, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security`.
- CORS: `Access-Control-Allow-Origin` only for listed origins on game endpoints; none on admin API.
- `ALLOWED_ORIGIN` must be set in production. Startup logs a warning when it is empty. The README example must include every origin actually used, including `http://localhost:3000` for local frontend testing.

### 12.5 Leak test (acceptance)

A test starts a game, deals, opens night turns, records picks and a kill, then calls every admin route with a valid admin session and asserts that no response body contains any role ID belonging to a seat, any night pick, or any reconnect token. The same assertions run on the admin live-room routes while a game is in each phase.

## 13. Admin dashboard

### 13.1 Purpose

Give the operator visibility and safe control of the running service without shell access, and surface history and balance data.

### 13.2 Panels

| Panel | Content | Source |
| --- | --- | --- |
| Live rooms | Code, phase, theme, players (names), connected count, round, age, last activity | `adminViewFor` over the room Map |
| Server health | Uptime, memory, room and socket counts, messages per second, rate-limit hits, error count, DB write latency | `metrics.js` |
| Security log | Failed passphrases, lockouts, bad origins, oversize payloads, auth failures; filter by type and time | `security_events` |
| Locks | Currently locked IPs with expiry and unlock action | In-memory lock map |
| Game history | Paged finished games with winner, length, players, theme | `games` |
| Game detail and replay | Role reveal, timeline of events | `game_players`, `events` |
| Analytics | Charts (section 15) | Aggregates |
| Config | Current limits and flags, secrets masked | `config` plus env |
| Audit log | Admin actions | `audit_log` |

### 13.3 Admin API

Base path `/admin/api`. Everything except login routes requires an authorized session. Mutations accept `POST`, `PATCH` or `DELETE` only and write an audit row. `GET` routes have no side effects. List routes take `limit` (capped at 100) and `cursor`.

| Group | Routes |
| --- | --- |
| Auth | `GET /auth/google`, `GET /auth/google/callback`, `POST /auth/logout`, `GET /auth/me` |
| Rooms | `GET /rooms`, `GET /rooms/:code` (metadata), `DELETE /rooms/:code`, `POST /rooms/:code/broadcast` (optional) |
| Health | `GET /health/summary`, `GET /health/metrics`, `GET /health/stream` (SSE) |
| Security | `GET /security/events`, `GET /security/locks`, `DELETE /security/locks/:ip`, `POST /security/blocks` (optional) |
| History | `GET /games`, `GET /games/:id`, `GET /games/:id/events` (finished games only) |
| Stats | `GET /stats/overview`, `GET /stats/winrate`, `GET /stats/activity`, `GET /stats/roles` |
| Config | `GET /config`, `PATCH /config`, `POST /config/rotate-host-key` |
| Audit | `GET /audit` |

### 13.4 Response rules

- Live room detail contains: code, theme, phase, round, player names with alive and connected flags, role counts as configured, event count. It contains no per-player role, no picks, no tokens.
- A game id for a game still in progress returns 404 from history routes.
- `GET /config` never returns secret values; it returns whether each secret is set.
- `rotate-host-key` returns the new key once, in the response body only, and logs that a rotation happened without the value. It affects new room creation only. It does not persist across restarts unless the operator also updates the environment; the response says so.
- Closing a room sends connected clients a `closed` message first, then removes the room, snapshot and tokens, and writes an audit row.

### 13.5 Dashboard UX

- Single page, English only, desktop first, usable on a phone.
- Live panels refresh every 2 seconds by polling, or via SSE if time allows.
- Destructive actions (close room, rotate key, unlock IP) require a confirm dialog.
- Unauthenticated visit redirects to Google sign-in. A signed-in but non-authorized user sees a plain no-access page.

## 14. Authentication (Google OAuth)

### 14.1 Scope

Admin sign-in only in v2. Players stay anonymous. `HOST_KEY` remains the gate for room creation. Host accounts are cut from this PRD.

Why OAuth for one admin: the author chose it to learn OIDC and to avoid a shared admin secret. A single `ADMIN_KEY` would be faster and is an acceptable fallback; the writeup states this tradeoff plainly.

### 14.2 Flow

1. `GET /auth/google` generates `state`, `nonce` and a PKCE verifier, stores them in a short-lived (10 minute) HTTP-only cookie with `SameSite=Lax`, and redirects to Google. Lax is required here because the callback arrives as a cross-site top-level navigation from Google.
2. `GET /auth/google/callback` checks `state`, exchanges the code with the verifier, verifies the ID token (`iss`, `aud`, `exp`, `nonce`, `email_verified`), then clears the flow cookie.
3. The server upserts the user by `sub`, checks authorization (14.3), creates a session, and sets the session cookie.
4. Redirect to `/admin`.

### 14.3 Authorization

A user is an admin if their email is in `ADMIN_EMAILS` or their `users.role` is `admin`. Anyone else can complete Google sign-in but all `/admin/api/*` calls return 403, and the failure is written to `security_events`.

### 14.4 Sessions

| Property | Value |
| --- | --- |
| Cookie | HTTP-only, `Secure`, `SameSite=Strict`, path `/admin` and `/auth` |
| ID | 32 random bytes, stored as SHA-256 |
| Lifetime | 8 hours absolute, 30 minutes idle |
| Logout | Deletes the session row, clears the cookie |
| Mutation guard | Required header such as `X-Admin: 1`, JSON content type |

### 14.5 Google Cloud setup

- One OAuth client of type web application.
- Authorized redirect URIs: the Funnel callback URL and `http://localhost:8080/auth/google/callback`.
- Consent screen in Testing mode with the operator added as a test user is sufficient.
- Scopes: `openid`, `email`, `profile` only.

### 14.6 Failure handling

Expired flow cookie, state mismatch, token verification failure, unverified email, Google outage: each shows a plain error page with a retry link and writes a security event. No error echoes provider messages or secrets.

## 15. Analytics and replay

### 15.1 Metric definitions

| Metric | Definition |
| --- | --- |
| Games played | Count of games with `ended_at` set |
| Average length | Mean of `ended_at - started_at` and mean `rounds` |
| Win rate by team | Share of games won by evil, good, jester, grouped by `player_count` bucket |
| Role win rate | Share of games in which a role's team won, per role |
| Role survival | Share of players of a role alive at game end; mean death round |
| First-night death rate | Share of games where the first death is a night kill |
| Peak concurrency | Max simultaneous live rooms per hour, from health samples |
| Abuse rate | Security events per day by type |

### 15.2 Charts

- Bar: win rate by team, by player-count bucket.
- Line: games per day, abuse events per day.
- Bar: role survival and mean death round.
- Histogram: game length.
- Time series: live rooms and messages per second from the metrics buffer.

Charts are drawn client-side from JSON endpoints using Chart.js loaded from a pinned CDN version or inline SVG.

### 15.3 Replay

For a finished game the replay view shows the role reveal table and a vertical timeline built from `events`: phase changes, picks, kills, lynches, hunter shots, undos, with round markers. Undone events remain visible and are marked as reverted.

### 15.4 Data quality

Analytics exclude games with fewer than `MIN_PLAYERS` players or aborted by the GM or ended by admin close. Those are stored with an `end_reason` and counted separately.

### 15.5 Bot simulator

`sim.js` plays complete games against a running server through the real WebSocket protocol, so every row it produces went through the same code as a live game. Rows are never inserted directly.

- **Bots.** One bot acts as GM, the rest as players. They create a room, join, deal, run each night turn with random valid picks, record kills and lynches, apply the win check and end the game.
- **Source tag.** Simulated rooms are created with `SIM_KEY` and stored with `source = 'sim'`; live rooms are `live`. A room cannot be marked simulated without the key. Charts default to live games, with a toggle that includes simulated games under a visible label.
- **Options.** `--games N`, `--players MIN-MAX`, `--parallel K`, `--seed S` for repeatable runs, `--server URL`, `--pace MS`.
- **Pacing.** Each bot has its own connection and stays under the 20 messages per 5 seconds limit, so the simulator never trips a lockout.
- **Load mode.** `--parallel 50 --players 20` runs 50 rooms of 20 bots at once for the load test in section 18.
- **Output.** Games finished, durations, failures and p95 snapshot latency. The exit code is non-zero on any protocol error or secrecy violation (a bot receiving another seat's role).
- **Not a replacement for playtests.** The writeup reports simulated and live game counts separately.

**Bot strategies.** The default is random valid play, which proves the pipeline but says nothing about balance. With `--smart`, bots follow simple heuristics: killers never target teammates, the protector avoids repeating its last pick, living players vote for a random other living player. Charts built from simulated games are labeled as pipeline demos, not balance evidence.

## 16. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Latency | Intent to snapshot delivery p95 under 300 ms at 50 rooms with 20 sockets each |
| Capacity | 50 rooms, 20 players per room, container limit 256 MB; memory under 200 MB at full load |
| Availability | Restart recovers live rooms; planned redeploy interrupts play for under 15 seconds |
| Durability | Event written before the next intent is processed in the same room; nightly backup |
| Compatibility | Current Safari, Chrome and Firefox on iOS and Android; no framework or build step required |
| Accessibility | Tap targets at least 44 px, reduced motion honored, sufficient contrast on both themes |
| Localization | All player-facing strings in English and Khmer; admin English only |
| Observability | Structured logs with request ID, health endpoint, metrics buffer, security log |
| Privacy | No analytics trackers, no third-party calls from the game client except fonts and pinned CDN scripts |
| Maintainability | Modules under 600 lines, tests for every role interaction and every permission rule |

## 17. Deployment and operations

### 17.1 Environments

| Env | Frontend | Backend |
| --- | --- | --- |
| Local | `python3 -m http.server 3000` | `npm run dev` on 8080 |
| Production | GitHub Pages from `main` | Podman container on the homeserver behind Tailscale Funnel |

### 17.2 Container

- Base image `node:22-slim` (switched from alpine to avoid native build problems with the SQLite driver). Production dependencies only, unprivileged `node` user.
- Volume `nighttable-data` mounted at `/data` with the `:U` flag so the unprivileged user owns it under rootless Podman.
- Memory limit 256 MB, restart policy `unless-stopped`.

```
podman run -d --name nighttable \
  -p 8088:8080 \
  -v nighttable-data:/data:U \
  -e DB_PATH=/data/nighttable.db \
  -e ALLOWED_ORIGIN='https://malterlo.github.io' \
  -e HOST_KEY='<passphrase>' \
  -e GOOGLE_CLIENT_ID='<id>' -e GOOGLE_CLIENT_SECRET='<secret>' \
  -e OAUTH_REDIRECT_URI='https://homeserver.tailb85a94.ts.net/auth/google/callback' \
  -e ADMIN_EMAILS='<operator email>' -e SESSION_SECRET='<random>' \
  --memory=256m --restart unless-stopped nighttable
```

Secrets should move to Podman secrets or an env file with mode 600 rather than the shell history.

### 17.3 Release procedure

1. Run `npm test` and the leak test locally.
2. Sync files and build the image on the server.
3. Take a database backup.
4. Stop and replace the container (graceful shutdown flushes writes), start the new one, check `/health`.
5. Verify an in-progress test room restored.
6. Roll back by running the previous image tag against the same volume; migrations must be forward-compatible for one version.

### 17.4 Frontend release

Pushing to `main` deploys GitHub Pages. The client reads the backend URL from the `server` query parameter, localhost detection, or the configured public endpoint. Breaking protocol changes must ship backend first and keep the old protocol accepted for one release.

## 18. Testing

| Layer | What | Tool |
| --- | --- | --- |
| Smoke | Existing WebSocket suite: health, passphrase, errors, join, deal, secrecy, night permissions, hidden deaths, undo, reveal, reconnect, departure | `npm test` (port 8099) |
| Rules unit tests | Deal validation, majority logic, win check, undo, role interactions | Node test runner |
| Persistence | Restart mid-game, restore, rejoin, event sequence gaps, snapshot version skip | Scripted |
| Security | Leak test over admin routes, permission matrix per actor, lockout, origin rejection, OAuth callback with bad state, non-allowlisted user | Scripted |
| Load | N rooms by 20 sockets, message storm, measure p95 and memory | `ws` script |
| Manual | Two-phone playtest, Khmer pass, reduced motion, iOS Safari tab switch hides card | Checklist |
| CI | Run all automated suites on every push | GitHub Actions |
| GM key | Claim success, wrong key, 3-strike room lockout, key rotation, old phone demoted, takeover logged, claim after a server restart | Scripted |
| Simulator | Seeded full games at random player counts; asserts every game ends with a winner, event sequences are gapless and no bot ever sees another seat's role | sim.js with --seed, run in CI |

## 19. Milestones and acceptance

| Phase | Deliverable | Acceptance |
| --- | --- | --- |
| 0 | Module split, CI, logger | Tests green, protocol reconciled |
| 1 | SQLite events and snapshots, restore | Restart mid-game, players rejoin |
| 2 | Security log, metrics, GM key handover, `adminViewFor` | Events in DB, leak unit test passes, GM key takeover works including after a restart |
| 3 | Google OAuth admin login | Allowlist enforced both ways |
| 4 | Admin API MVP and dashboard | Watch and close a live room, no role data on the wire |
| 5 | Bot simulator, history, replay, analytics | 100 simulator games plus live playtests populate charts, filterable by source |
| 6 | Timer, art, Khmer review, name filter | Per FR-DAY-4, FR-LOB-8 |
| 7 | Load test (simulator, 50 rooms), backups, runtime config | Numbers recorded, restore drill done |
| 8 | Writeup | Architecture, threat model, tradeoffs, results |

Cut line if time is short: drop phase 6 first, keep phase 5.

## 20. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Snapshot restore corrupts a game | Medium | High | Versioned snapshots, per-phase restart test |
| Admin route leaks live secrets | Low | Critical | Separate view function, automated leak test |
| Cross-site cookie breakage | Medium | Medium | Admin same-origin on the backend |
| Native SQLite driver build issues | Medium | Low | Slim image or `node:sqlite` |
| Funnel outage or homeserver down | Medium | High for play | Document; consider a second `server` URL fallback |
| Memory growth from buffers | Low | Medium | Fixed-size ring buffers, memory metric |
| Scope creep | High | High | Must/should/nice labels, cut line |
| Khmer text quality | High | Medium | Native review task before release |
| Single homeserver, no failover (Funnel, power or Podman failure) | Medium | High for play | Accepted. Demo fallback: run the backend on a laptop at localhost, which already works. Stated in the writeup. |
| Live roles stored in plaintext snapshots and backups | Low | Low | Accepted for a party game. Tight volume permissions, noted in the writeup. |

## 21. Open questions

1. Deadline and rubric: the author says neither constrains scope. Re-check before the final week; the cut line in section 19 applies.
2. Should admin be able to see player names of live rooms, or only counts?
3. Who reviews the Khmer strings and by when?

Decided since the first draft: solo project; SQLite; admin served from the backend; Google OAuth for admin; bot simulator; GM key handover with a two-word key; plaintext live roles in snapshots and a single homeserver accepted.

## Appendix A: Configuration

| Variable | Default | Purpose | Status |
| --- | --- | --- | --- |
| `PORT` | 8080 | HTTP and WebSocket port | Built |
| `HOST_KEY` | empty | Passphrase to create rooms | Built |
| `ALLOWED_ORIGIN` | empty | Origin allowlist, comma separated | Built |
| `MIN_PLAYERS` | 4 | Minimum players to deal | Built |
| `NODE_ENV` | unset | Log format | Built |
| `DB_PATH` | `/data/nighttable.db` | SQLite file | New |
| `GOOGLE_CLIENT_ID` | none | OAuth client | New |
| `GOOGLE_CLIENT_SECRET` | none | OAuth secret | New |
| `OAUTH_REDIRECT_URI` | none | Callback URL | New |
| `ADMIN_EMAILS` | none | Admin allowlist | New |
| `SESSION_SECRET` | none | Signs flow cookie | New |
| SIM\_KEY | none | Required to create a room marked as simulated; unset disables simulated rooms | New |

## Appendix B: Glossary

- **GM:** game master, narrator with no role, controls the game.
- **Killer / Evil team:** shown as Werewolf or Mafioso depending on theme.
- **Turn:** a night step in which one role is awake.
- **Snapshot (game):** the personalized state sent to a client.
- **Snapshot (storage):** the serialized room saved for restart recovery.
- **Funnel:** Tailscale feature that exposes the container publicly with TLS.

## Appendix C: Documentation issues to fix

1. The implementation uses `art/<theme>/<role>.webp`; keep this path consistent in
   product and frontend documentation.
2. The canonical local frontend origin is `http://localhost:3000`.
3. The code role ID `killer` is displayed as Werewolf or Mafioso by theme.
4. `HOST_KEY` may be empty for local development but is required for production.
