# Spec Delta

## Purpose

This v2.3 Nice-to-have capability adds player-facing refinements without shifting discussion, voting, or game-rule decisions from people to the app.

## ADDED Requirements

### Requirement: Share a discussion countdown
For v2.3, the system SHALL let the GM start and stop a countdown that is visible to all room clients; expiry SHALL show a banner and buzz without changing game state.

#### Scenario: GM starts a timer
- **WHEN** the GM starts a discussion countdown
- **THEN** connected room clients display the same remaining time

#### Scenario: Timer expires
- **WHEN** the countdown reaches zero
- **THEN** clients show an expiry banner and buzz, and the game phase and player state remain unchanged

#### Scenario: GM stops the timer early
- **WHEN** the GM stops a running countdown before it expires
- **THEN** connected clients stop displaying the countdown and no expiry banner or buzz occurs

### Requirement: Filter player names
For v2.3, the system SHALL reject names that fail its profanity filter with a generic, localized error that does not identify the matched term.

#### Scenario: Filtered name is submitted
- **WHEN** a player joins with a name rejected by the profanity filter
- **THEN** the join is denied with the generic translated name error

### Requirement: Display optional role art safely
For v2.3, the client SHALL load role art from `art/<theme>/<role>.webp` when available and otherwise display the role's emoji fallback.

#### Scenario: Role art is available
- **WHEN** a role card is shown and its 500-by-700 theme image is available
- **THEN** the client displays that image

#### Scenario: Role art is missing
- **WHEN** a role card is shown and its image is absent or fails to load
- **THEN** the client displays the emoji fallback without breaking the card

### Requirement: Provide language coverage for new player-facing text
New player-facing v2 strings SHALL be available in English and identified for Khmer review; the admin dashboard may remain English-only.

#### Scenario: Player uses either supported language
- **WHEN** a player views a v2 screen in English or Khmer
- **THEN** its player-facing text is available in that language or is explicitly identified as awaiting Khmer review

#### Scenario: Operator views admin dashboard
- **WHEN** an operator opens the admin dashboard
- **THEN** its text is available in English
