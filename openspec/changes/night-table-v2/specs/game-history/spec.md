# Spec Delta

## Purpose

This v2.1 Must capability preserves completed games for authorized review and summarizes outcomes without mixing aborted games or unlabeled simulated play into live results.

## ADDED Requirements

### Requirement: Store complete finished-game records
When a game ends normally, the system SHALL store its winner, start and end times, player count, rounds, end reason, GM nickname, each player's seat, name, role and team, and the ordered event history.

#### Scenario: Game ends
- **WHEN** the GM ends a game
- **THEN** the finished record contains the winner, every player's role and team, and the ordered game events

### Requirement: Keep role records private until game end
The system SHALL write per-player role records only when a game ends and SHALL expose historical roles only through authorized finished-game history.

#### Scenario: Game is still live
- **WHEN** a game has not ended
- **THEN** no per-player role record is available through history

#### Scenario: Game has ended
- **WHEN** an authorized operator requests the finished game
- **THEN** its role assignments may be returned for review and replay

### Requirement: Replay a finished game timeline
The system SHALL provide a finished-game replay containing the role reveal and an ordered timeline of phases, picks, kills, lynches, hunter shots, and undos, with undone events visibly marked as reverted.

#### Scenario: Operator opens replay
- **WHEN** an authorized operator opens a finished game's replay
- **THEN** the replay shows the role table and ordered events with round markers and reverted-event status

### Requirement: Calculate game volume and length metrics
Games played SHALL count records with an end time; average duration SHALL be the mean end time minus start time; average rounds SHALL be the mean round count across eligible completed games.

#### Scenario: Operator requests volume and length statistics
- **WHEN** an authorized operator requests these statistics
- **THEN** the count and means use the stated completed-game fields and eligibility rules

### Requirement: Calculate team win rates
Team win rate SHALL be the share of eligible games won by each of the evil, good, and jester teams, reported by player-count bucket.

#### Scenario: Operator requests team win rates
- **WHEN** an authorized operator requests team win rates
- **THEN** each team's share is grouped by the game's player-count bucket

### Requirement: Calculate role outcomes
For each role, role win rate SHALL report the share of games in which its team won; role survival SHALL report the share of players assigned that role who are alive at game end; mean death round SHALL report the average round of death.

#### Scenario: Operator requests role outcomes
- **WHEN** an authorized operator requests role statistics
- **THEN** each role's win rate, survival share, and mean death round use the stored finished-game records

### Requirement: Calculate activity and abuse metrics
First-night death rate SHALL be the share of games whose first death was a night kill; peak concurrency SHALL be the maximum simultaneous live rooms per hour from health samples; abuse rate SHALL count security events per day by type.

#### Scenario: Operator requests activity statistics
- **WHEN** an authorized operator requests activity statistics
- **THEN** the results use the stated death, room-sample, and security-event definitions

### Requirement: Visualize analytics
The analytics view SHALL provide charts for team win rate by player-count bucket, games and abuse events over time, role survival and mean death round, game length distribution, and sampled live rooms and message rate.

#### Scenario: Operator opens analytics charts
- **WHEN** an authorized operator opens the analytics view
- **THEN** each listed metric is available in its corresponding chart

### Requirement: Exclude ineligible games from analytics
Analytics SHALL exclude games below the configured minimum player count, games aborted by the GM, and games ended by administrative room closure, while retaining those records for separate counts.

#### Scenario: Ineligible game is included in stored history
- **WHEN** analytics are calculated for a game below the minimum player count or ended by abort or admin close
- **THEN** the game is excluded from balance and duration aggregates and remains available in separately identified counts

### Requirement: Retain and purge finished records safely
Finished games and their events SHALL be retained until an authorized operator purges them; retained game records SHALL not contain player IP addresses or email addresses.

#### Scenario: Operator purges a finished game
- **WHEN** an authorized operator confirms a purge
- **THEN** the selected finished-game record and its associated player and event records are removed
