# Spec Delta

## Purpose

This v2.2 Should capability keeps the single-process self-hosted service recoverable and within its documented resource budget through deployment safeguards, backups, and operational checks.

## ADDED Requirements

### Requirement: Operate within documented capacity
The service SHALL support 50 concurrent rooms with up to 20 player connections per room in one Node process, remain below 200 MB application memory at that load, and run within a 256 MB container limit.

#### Scenario: Service is exercised at target capacity
- **WHEN** the service is tested with 50 rooms and 20 player connections per room
- **THEN** application memory remains below 200 MB and the service operates within the 256 MB container limit

### Requirement: Meet game-state latency targets
At target capacity, the system SHALL deliver state snapshots with p95 intent-to-snapshot latency below 300 ms.

#### Scenario: Latency is measured at target capacity
- **WHEN** intents are sent under the documented target load
- **THEN** the measured p95 intent-to-snapshot latency is below 300 ms

### Requirement: Recover games within the service recovery target
The service SHALL restore every valid room in a restart test and allow its players to reconnect within ten seconds; a planned redeploy SHALL interrupt play for less than 15 seconds.

#### Scenario: Server restarts during a live game
- **WHEN** the server restarts with valid persisted rooms
- **THEN** all valid rooms are restored and their players can reconnect within ten seconds

#### Scenario: Planned redeploy occurs
- **WHEN** the service is replaced using the documented graceful deployment procedure
- **THEN** play is interrupted for less than 15 seconds

### Requirement: Back up and restore the database
The deployment SHALL make a nightly database backup to a second disk, retain seven daily copies, and document a quarterly restore drill.

#### Scenario: Scheduled backup runs
- **WHEN** the nightly backup completes
- **THEN** a restorable database copy exists on the second disk and the retention set contains no more than seven daily copies

#### Scenario: Restore drill is performed
- **WHEN** the quarterly restore procedure is followed
- **THEN** the operator can verify recovery from a retained backup

### Requirement: Harden production network access
Production deployments SHALL configure an explicit allowed-origin list. The service SHALL use TLS for public access, apply the documented HTTP security headers, enforce the configured origin list, and warn at startup when the list is empty.

#### Scenario: Production starts without allowed origins
- **WHEN** the service starts without an allowed-origin list
- **THEN** startup logs a warning that production is not safely configured

#### Scenario: Request comes from a disallowed origin
- **WHEN** a browser request or WebSocket connection uses an origin outside the configured allowlist
- **THEN** the service does not grant the cross-origin connection

### Requirement: Shut down without losing committed state
On termination, the service SHALL stop accepting new connections, flush pending writes, close active connections with a reconnect hint, and exit within ten seconds.

#### Scenario: Service receives a termination signal
- **WHEN** the process receives SIGTERM
- **THEN** it performs the documented graceful shutdown and exits within ten seconds

### Requirement: Document reproducible self-hosting
The project SHALL document the required runtime configuration, persistent data volume, backup and restore procedure, deployment steps, and accepted single-homeserver failure risk.

#### Scenario: Operator follows deployment documentation
- **WHEN** a self-hoster follows the repository instructions on a supported homeserver
- **THEN** they can configure and run the service with persistent storage and perform a documented restore
