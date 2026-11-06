# Spec Delta

## Purpose

This v2.0 Must capability preserves active Night Table games and reconnectable seats across server restarts without weakening the secrecy rules players rely on.

## ADDED Requirements

### Requirement: Persist accepted room changes
The system SHALL persist each accepted live-room state change as an ordered event and an updated room snapshot in one atomic database transaction before processing the next intent for that room.

#### Scenario: State change is saved
- **WHEN** the server accepts a state-changing game intent
- **THEN** it appends the corresponding event and updates that room's snapshot atomically

#### Scenario: Persistence write fails
- **WHEN** the database write for a state change fails
- **THEN** the server logs the failure, increments a persistence-failure metric, and continues the live broadcast

#### Scenario: Persistence resumes after a failed write
- **WHEN** a later state change is successfully persisted after an earlier write failure
- **THEN** the saved snapshot reflects the current authoritative room state and the event history remains ordered

### Requirement: Restore live rooms after restart
The system SHALL restore non-expired snapshots with supported versions and mark every restored seat disconnected until its holder reconnects.

#### Scenario: Supported snapshot is restored
- **WHEN** the server starts with a valid, non-expired snapshot
- **THEN** the room state is restored and each seat is shown as disconnected until rejoined

#### Scenario: Unsupported snapshot version
- **WHEN** startup encounters a snapshot with an unknown version
- **THEN** the server skips and logs that snapshot without deleting it

### Requirement: Reconnect to a restored seat
The system SHALL allow a player or GM to resume the same seat after restart using its valid reconnect token.

#### Scenario: Player resumes after restart
- **WHEN** a player presents the valid token for a restored room
- **THEN** the server restores that player's seat and sends the current personalized state with a resynced notice

#### Scenario: Invalid token is presented
- **WHEN** a client presents a token that does not match a stored seat credential
- **THEN** the server rejects the resume without granting access to room state

### Requirement: Protect stored reconnect credentials
The system SHALL store only hashes of player and GM reconnect tokens, never usable token values.

#### Scenario: Database credentials are inspected
- **WHEN** stored token records are read from the database
- **THEN** they do not contain bearer tokens that can be used to resume a seat

### Requirement: Preserve room expiry across persistence
Persisted rooms SHALL expire after two hours without activity or after 15 minutes with no connected clients, using the persisted last-activity time after restart.

#### Scenario: Restored room has expired
- **WHEN** a snapshot exceeds either applicable idle limit
- **THEN** the server does not restore the room

### Requirement: Keep event history append-only
The system SHALL retain accepted game events in sequence and represent undo as a compensating event rather than deleting prior events.

#### Scenario: A state change is undone
- **WHEN** the GM undoes a recorded state change
- **THEN** the system appends an undo event and preserves the original event in the history

### Requirement: Keep live secrets out of event and HTTP views
Before a game ends, durable event records SHALL identify players by seat and SHALL NOT expose role assignments; full-state snapshots containing roles SHALL NOT be returned by HTTP routes.

#### Scenario: Live game data is queried over HTTP
- **WHEN** an HTTP route reads live-room information
- **THEN** it returns no role assignment, night pick, reconnect token, or full room snapshot

#### Scenario: Live state is recorded
- **WHEN** a game event is stored before the game ends
- **THEN** it contains no per-player role assignment

#### Scenario: Deal composition is recorded
- **WHEN** the game is dealt
- **THEN** the deal event records role counts only and does not map roles to player seats
