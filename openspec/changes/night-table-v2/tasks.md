# Tasks

This is the implementation tracker for the active `night-table-v2` change.
Completed v1 behavior is documented in [`docs/game-spec.md`](../../../docs/game-spec.md);
these tasks cover the remaining v2 scope from the proposal and capability specs.

## 1. Durable game state

- [x] 1.1 Complete the SQLite schema for versioned live snapshots, seat records, hashed reconnect credentials, and append-only events; verify migration and schema tests pass.
- [ ] 1.2 Persist every accepted state-changing intent atomically with its snapshot and event; verify event ordering and persistence-failure metrics.
- [x] 1.3 Restore supported, non-expired rooms on startup and mark seats disconnected; verify unsupported snapshots are skipped and logged.
- [ ] 1.4 Implement player and GM reconnect after restart without exposing roles, picks, or bearer tokens; verify restart recovery within 10 seconds.
- [x] 1.5 Represent undo as a compensating event and preserve prior events; verify the event history remains append-only.
- [ ] 1.6 Store completed games separately and remove their live snapshots after normal end; verify live and historical secrecy boundaries.

## 2. GM control and operator console

- [ ] 2.1 Add one-time hashed two-word GM recovery keys with retry limits and invalidation; verify takeover and old-key rejection.
- [ ] 2.2 Add GM transfer and dealt-game abort flows without revealing roles; verify authorization and reconnect behavior.
- [ ] 2.3 Add Google operator authentication with state, nonce, PKCE, issuer, audience, expiry, and verified-email validation; verify invalid callbacks create generic errors and security events.
- [ ] 2.4 Add secrecy-safe admin views and APIs for live rooms, health, security events, and audit data; verify no live roles, picks, credentials, or full snapshots are returned.

## 3. History and simulation

- [ ] 3.1 Record complete finished-game history, winner, timing, players, roles, teams, rounds, and source; verify aborted and simulated games are classified correctly.
- [ ] 3.2 Add authorized replay and analytics with reverted-event handling and eligibility filters; verify live rooms are never exposed through history routes.
- [ ] 3.3 Build a seeded WebSocket simulator that uses normal room intents; verify complete runs are reproducible and tagged `sim`.
- [ ] 3.4 Add simulator protocol and secrecy checks; verify invalid state transitions fail the run.

## 4. Operations and deployment

- [ ] 4.1 Add target-load tests for 50 rooms and 20 connections per room; verify memory stays below 200 MB and p95 snapshot latency stays below 300 ms.
- [ ] 4.2 Add nightly seven-copy backup, restore-drill, and persistent-volume documentation; verify a retained backup restores an in-progress room.
- [ ] 4.3 Harden production configuration with explicit origins, TLS guidance, security headers, and startup warnings; verify disallowed origins are rejected.
- [ ] 4.4 Implement graceful shutdown and deployment rollback guidance; verify committed state flushes and shutdown completes within 10 seconds.
- [ ] 4.5 Document reproducible self-hosting, accepted single-homeserver risk, and recovery procedures; verify the steps work from a clean checkout.

## 5. Player experience

- [ ] 5.1 Add a synchronized GM discussion timer that does not mutate game state; verify start, stop, expiry, banner, and haptic behavior.
- [ ] 5.2 Add localized generic name filtering errors; verify rejected terms are not echoed.
- [ ] 5.3 Add safe role-art loading from `art/<theme>/<role>.webp` with emoji fallback; verify both themes and missing assets.
- [ ] 5.4 Review newly added player-facing Khmer strings; verify English coverage and review markers.

## Workflow follow-up

- Archive the change after all implementation and verification tasks are complete.
- Sync the resulting capability specs into `openspec/specs/` through the OpenSpec workflow.
