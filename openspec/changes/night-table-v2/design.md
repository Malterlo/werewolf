# Design

## Context

See `proposal.md` for the motivation and release scope. The current server is a single Node process with an in-memory `Map` of live rooms, a static browser client, and a shared WebSocket protocol. The repository now has a partial SQLite persistence layer: snapshots, hashed reconnect tokens, ordered events, migrations for event sequence numbers, restore filtering, and graceful shutdown are present, but finished-game history, admin/authentication, GM transfer, analytics, simulator support, and the v2 player polish are not.

The design must preserve the existing privacy boundary: the server sends personalized player or GM views, while operator views are metadata-only for live games. The deployment remains one modest homeserver container with a SQLite volume, no build step for the game client, and no horizontal scaling.

## Goals / Non-Goals

**Goals:**

- Keep the in-memory room object authoritative for realtime game behavior while making accepted changes durable and recoverable.
- Separate live-room serialization, operator metadata serialization, and finished-game history serialization so live roles and night picks cannot cross the admin boundary.
- Add v2 behavior without breaking v1 WebSocket clients where practical; introduce new intents and messages with explicit error codes.
- Make persistence, GM takeover, OAuth authorization, analytics, and simulator behavior testable through focused module and protocol tests.
- Preserve anonymous player access and the existing host-operated game model.
- Deploy admin pages and authentication from the backend origin, while the game client remains deployable from GitHub Pages.

**Non-Goals:**

- No Postgres service, multi-process coordination, horizontal scaling, player accounts, matchmaking, voice/video, chat, or automated rule resolution.
- No exposure of live role assignments or night picks to operators. Operators may see live player names, room metadata, health, security events, and audit data.
- No replacement of the GM's decisions about protection, ties, inspector results, kills, or round outcomes.
- No attempt to make simulator randomness reproduce the server's cryptographic role assignment; only simulator choices are seed-repeatable.

## Decisions

### 1. Keep one authoritative in-memory room model with SQLite write-behind

Accepted intents continue to mutate the in-memory room and then produce a personalized broadcast. The persistence boundary writes the event and the current snapshot in one SQLite transaction before the next accepted intent for that room is processed. A failed write is logged and counted; the next successful write stores the current authoritative snapshot and the next event sequence.

SQLite remains the store because the target is one process, one host, offline-friendly operation, and a 256 MB container. Postgres would add a service and operational dependency without solving a requirement in this release. A database-read-per-intent model is rejected because it adds latency and would make the existing room model harder to reason about.

The database is split conceptually into:

- live room snapshots and hashed reconnect credentials;
- append-only events with per-game sequence numbers;
- finished game, player, and event records;
- operator users, sessions, security events, audit records, runtime overrides, and GM-key hashes.

Migrations run transactionally on boot. Snapshot versions are checked before restore. Unknown or invalid snapshots are logged and left available for inspection rather than deleted.

### 2. Use separate views for players, GM, operators, and history

`viewFor` remains the only path to player and GM WebSocket snapshots. A separate operator view is built from room metadata and explicitly selects code, theme, phase, round, player names, alive/connected state, configured role counts, event count, and age. It never serializes the room snapshot, role fields, picks, reconnect tokens, or GM keys.

Finished-game routes are separate again and are available only when the game has ended and the request has an authorized admin session. This permits role and event replay after the social game is over without weakening the live-game boundary. Leak tests call every admin route during each live phase and search responses for role identifiers, picks, and credentials.

### 3. Keep admin same-origin with the backend

The backend serves `/admin`, `/auth/*`, and `/admin/api/*`. The game client can remain on GitHub Pages and connects to the backend WebSocket endpoint. Serving admin from the backend avoids cross-site session-cookie problems and keeps admin assets out of the public game site.

Google OIDC uses state, nonce, PKCE, exact redirect URI validation, and a short-lived flow cookie. Successful identity is then checked separately against the email allowlist or stored admin role. Sessions use random IDs stored only as hashes, secure HTTP-only cookies, strict SameSite policy after callback, idle and absolute expiry, and server-side logout revocation.

Admin mutations require JSON and a custom mutation header, use POST/PATCH/DELETE, and append audit rows. GET routes do not mutate state. Runtime configuration reports secret presence rather than values.

### 4. Use hashed, rotating GM recovery keys with atomic claims

A room receives a two-word, hyphen-joined key from a curated non-homophone list. Only its hash is persisted. Claim validation and key rotation occur as one database-protected operation so concurrent valid claims have one winner. The successful claimant enters a nickname; the old GM becomes an observer and the prior key is invalidated.

Room-level failed GM-key claims lock all claims for five minutes after three wrong keys, independent of IP. A separate per-IP limiter applies the same five-minute claim window. Every failed attempt becomes a security event. Lobby `pass_gm` is a distinct direct swap because no roles have been dealt; in-progress `gm_claim` preserves phase, picks, and undo state.

### 5. Create finished-game records only at the end

A deal records only role counts in live events. Player-role rows are withheld until normal game completion. At end, the system writes the finished game metadata, player role/team rows, and ordered event history. Aborts return the room to the lobby and are stored with an aborted reason but do not write role assignments or enter balance analytics.

The replay reads finished events and marks compensating undo events without deleting their originals. Analytics apply the documented eligibility rules and default to live games; simulated records are included only by explicit operator choice and are visibly labeled.

### 6. Make the simulator a real protocol client

`sim.js` runs outside the server and uses independent WebSocket connections for the GM and each bot. It uses a seeded local random source for bot choices, pacing, player counts, and target selection, while the server continues to use cryptographic randomness for roles and room credentials. Simulator room creation requires `SIM_KEY`, and the source tag is assigned by the server so a normal player cannot mark a room simulated.

The simulator treats any protocol error, missing winner, invalid event sequence, or cross-seat role observation as a failed run. It reports completion count, failures, durations, and p95 snapshot latency. Its load mode reuses the same protocol path and respects the per-socket message budget.

### 7. Prefer polling first for the operator dashboard

The dashboard initially polls live panels every two seconds. An SSE health stream can be added without changing the data contract if polling proves insufficient. This keeps the first implementation small and avoids making a second realtime protocol for admin data. Destructive actions require browser confirmation and server authorization regardless of the dashboard refresh mechanism.

### 8. Roll out in migrations and reversible deployment phases

The release sequence follows the PRD phases: reconcile modules and protocol first; add persistence and restore; add security metrics and GM transfer; add OAuth and admin metadata; add finished history and simulator; then add operational and v2.3 polish. The backend is deployed before a frontend that sends new intents. Old clients continue to receive ordinary snapshots and unknown new server fields are ignored.

Before replacement, take a database backup and use graceful shutdown. Rollback uses the previous image against the same volume only when the migration is compatible with the previous version; otherwise restore the pre-migration backup. A restart test is part of every deployment verification.

## Risks / Trade-offs

- **[Live roles exist in snapshots and backups]** -> Treat the data volume and backups as GM-secret material, use strict volume permissions, and document the accepted risk.
- **[SQLite write failure can leave a recent action absent from durable history]** -> Keep the authoritative room live, count and alert on failures, repair the snapshot on the next successful write, and test restart behavior after an injected failure.
- **[A single process and homeserver remain a point of failure]** -> Keep the accepted constraint, provide nightly backups and a restore drill, and document the laptop fallback for demonstrations.
- **[Admin routes can accidentally expose live secrets]** -> Keep operator serialization separate from player serialization and require an automated leak test over every admin route and live phase.
- **[Google setup can block local development]** -> Keep OAuth limited to admin, support the documented local redirect URI, and leave player flows anonymous; an admin-key fallback is documented as an alternative but is not the selected design.
- **[Seeded simulator results can be mistaken for balance evidence]** -> Label source in storage and charts, default analytics to live games, and report simulated and live counts separately.
- **[The v2 scope is large]** -> Apply the PRD cut line: defer v2.3 polish first, while retaining persistence, security, history, and simulator acceptance tests.

## Migration Plan

1. Run the existing smoke suite and capture the current database schema and deployment image.
2. Apply additive SQLite migrations and verify snapshot/event compatibility on a copy of the live volume.
3. Deploy persistence and restore support; restart a test room and verify reconnect within the target window.
4. Deploy admin/auth and GM-transfer behavior; run authorization, lockout, takeover, and live-admin leak tests.
5. Deploy history, replay, and simulator; run seeded protocol games and confirm source tagging and analytics exclusion rules.
6. Add backups, runtime configuration, load testing, and the operational writeup.
7. Add the timer, art, name filter, and Khmer review only if the Must and Should acceptance gates pass.
8. Back up before each production replacement, check `/health`, restore an in-progress test room, and retain the prior image for rollback.

## Open Questions

- The native Khmer reviewer and review date remain external coordination items; the implementation can ship English plus flagged Khmer strings first as specified.
