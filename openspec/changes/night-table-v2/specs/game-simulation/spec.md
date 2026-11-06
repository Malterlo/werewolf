# Spec Delta

## Purpose

This v2.1 Must capability exercises Night Table through its real WebSocket protocol with automated players; its v2.2 Should load mode provides repeatable capacity results.

## ADDED Requirements

### Requirement: Play simulated games through the live protocol
The simulator SHALL create rooms, join bot players, deal roles, execute valid night turns and day outcomes, and finish games using the same WebSocket protocol as human clients.

#### Scenario: Simulator plays a complete game
- **WHEN** the simulator is run against an available server
- **THEN** each simulated game is created and completed through normal protocol intents rather than direct database insertion

### Requirement: Mark simulated games at creation
The system SHALL require `SIM_KEY` to create a simulated room and SHALL persist every game with a source of either live or sim.

#### Scenario: Simulator creates a room without its key
- **WHEN** simulated-room creation is attempted without a valid `SIM_KEY`
- **THEN** the server rejects the request and does not create a simulated game

#### Scenario: Simulated game is stored
- **WHEN** a simulator-created game is completed
- **THEN** its stored source is `sim` and it is distinguishable from live games

### Requirement: Label simulated analytics
Analytics SHALL default to live games and SHALL visibly label results when simulated games are included.

#### Scenario: Operator includes simulated games
- **WHEN** simulated data is enabled in an analytics view
- **THEN** the view visibly identifies that the results include simulated games

### Requirement: Support repeatable simulation runs
The simulator SHALL support choosing game count, player-count range, parallel rooms, seed, server URL, and pacing; simulator-generated choices SHALL be repeatable for the same seed and options, while server-side role shuffling remains cryptographically random.

#### Scenario: Seeded run is repeated
- **WHEN** the simulator is run twice with the same seed and options
- **THEN** it makes the same seeded simulator choices while role assignments may differ because the server shuffles them cryptographically

### Requirement: Detect protocol and secrecy failures
The simulator SHALL exit unsuccessfully if a game has a protocol error, an invalid event sequence, no winner, or a bot receives another seat's role.

#### Scenario: Bot receives another role
- **WHEN** a simulated client observes a role not assigned to its seat
- **THEN** the run reports a secrecy violation and exits unsuccessfully

#### Scenario: Simulation completes correctly
- **WHEN** all simulated games finish without protocol or secrecy failures
- **THEN** the run reports completed games, durations, failures, and p95 snapshot latency

### Requirement: Exercise target load
For the v2.2 Should priority, the simulator SHALL support a load run of 50 concurrent rooms with up to 20 player connections per room while respecting the server's per-socket message limit.

#### Scenario: Maximum documented load is run
- **WHEN** the load mode runs 50 rooms with 20 player connections each
- **THEN** the simulator records completion, failures, latency, and resource results without exceeding the per-socket message limit
