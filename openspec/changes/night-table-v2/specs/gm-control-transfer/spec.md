# Spec Delta

## Purpose

This v2.0 Must capability lets a group recover or deliberately transfer GM control without losing game state or exposing roles through handover.

## ADDED Requirements

### Requirement: Issue a one-time GM recovery key
On room creation, the system SHALL generate a speakable two-word GM key, show it to the GM once, and store only its hash.

#### Scenario: Room is created
- **WHEN** a new room is created
- **THEN** the GM receives a key made from two curated short common, non-homophone words joined by a hyphen, drawn from a list of about 1,000, and is prompted to save it

#### Scenario: Key is stored
- **WHEN** the recovery key is persisted
- **THEN** only a hash of the key is stored

### Requirement: Claim GM control with the recovery key
The system SHALL let a phone claim GM control using the room code and current GM key, replacing the previous GM token and issuing a new key.

#### Scenario: Valid key claims the room
- **WHEN** a phone submits the current valid key for a room
- **THEN** the claimant enters a nickname, becomes the GM, the former GM becomes an observer, a new key is issued, and the room log records both GM nicknames

#### Scenario: In-progress game is claimed
- **WHEN** GM control is transferred during an open game
- **THEN** the phase, open turn, picks, and undo history remain unchanged for the new GM

### Requirement: Invalidate old keys after a claim
A successful GM claim SHALL rotate the recovery key so the previous key cannot claim the room again.

#### Scenario: Old key is reused
- **WHEN** a client claims with the key that was valid before the last successful transfer
- **THEN** the claim is rejected

### Requirement: Limit failed GM claims
The system SHALL record every failed key attempt, lock claims for that room for five minutes after three wrong keys regardless of source IP, and enforce a per-IP lockout.

#### Scenario: Room claim threshold is reached
- **WHEN** three wrong keys are submitted for one room
- **THEN** further claims on that room are rejected for five minutes and each failure is recorded as a security event

#### Scenario: Claiming IP is locked
- **WHEN** a source IP is under GM-claim lockout
- **THEN** claims from that IP are rejected and recorded

### Requirement: Resolve concurrent GM claims safely
The system SHALL allow only the first successful claim with a current key to transfer GM control.

#### Scenario: Two claims race
- **WHEN** two claims concurrently submit the same valid key
- **THEN** at most one succeeds and the old key is invalid for all subsequent claims

### Requirement: Pass GM control in the lobby
The system SHALL let the current GM directly pass control to a connected player while the room is in the lobby, including the post-game lobby.

#### Scenario: GM passes control
- **WHEN** the GM selects a connected player and confirms the pass
- **THEN** that player becomes GM, the former GM becomes a normal player, the player count is unchanged, and a new GM key is issued

### Requirement: Abort a dealt game without revealing roles
The system SHALL let the GM abort a dealt game, record it as aborted, return the same players to the lobby, and omit role assignments from completed-player records and analytics.

#### Scenario: GM confirms abort
- **WHEN** the GM confirms abort after cards have been dealt
- **THEN** the game is stored with an aborted end reason, no player-role records are written, no roles are revealed, and the room returns to the lobby with its players

#### Scenario: GM wants to play as a player
- **WHEN** the GM wants to join as a player after dealing
- **THEN** the GM must abort or finish the game and pass GM control before the next deal
