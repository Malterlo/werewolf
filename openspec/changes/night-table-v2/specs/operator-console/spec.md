# Spec Delta

## Purpose

This v2.0 Must capability gives authorized operators safe service visibility and controls without exposing secrets from a live game.

## ADDED Requirements

### Requirement: Authenticate operators with Google sign-in
The system SHALL authenticate admin sessions through Google OpenID Connect, validate state, nonce, PKCE, issuer, audience, expiry, and verified email, and keep flow data in a 10-minute HTTP-only SameSite=Lax cookie.

#### Scenario: Valid sign-in completes
- **WHEN** a user completes the Google callback with valid flow state and identity claims
- **THEN** the system creates an operator session and redirects to the admin page

#### Scenario: Invalid callback is received
- **WHEN** the callback has expired state, invalid claims, or an unverified email
- **THEN** the system denies sign-in, shows a generic retryable error, and records a security event without echoing provider details

### Requirement: Restrict admin data to authorized operators
The system SHALL authorize admin API access only for users whose verified email is allowlisted or whose stored role is admin.

#### Scenario: Authorized operator requests admin data
- **WHEN** an authorized user makes an admin API request with a valid session
- **THEN** the request is permitted

#### Scenario: Signed-in user is not authorized
- **WHEN** a signed-in user without admin authorization requests admin data
- **THEN** the API returns 403 and records the authorization failure as a security event

### Requirement: Protect admin sessions
Admin sessions SHALL use hashed random identifiers and secure HTTP-only SameSite=Strict cookies, expire after eight hours absolute or 30 minutes idle, and be revoked server-side on logout.

#### Scenario: Session expires or is revoked
- **WHEN** an operator logs out or the session exceeds either lifetime
- **THEN** the session can no longer authorize an admin request

### Requirement: Expose live-room metadata without live secrets
The admin room views SHALL show room code, theme, phase, round, player names and alive/connected state, configured role counts, event count, and room age, but SHALL NOT expose live roles, night picks, or credentials.

#### Scenario: Operator inspects a live room
- **WHEN** an authorized operator requests live-room metadata
- **THEN** the response contains the allowed metadata and no role assignment, night pick, reconnect token, or full room snapshot

### Requirement: Provide operator health and security visibility
The admin console SHALL show uptime, memory, room and socket counts, message rate, rate-limit hits, errors, database write latency, filterable security events, current locks, finished-game history, masked runtime configuration, and audit records.

#### Scenario: Operator opens a dashboard panel
- **WHEN** an authorized operator loads an admin panel
- **THEN** the panel displays its permitted current data and never returns secret configuration values

### Requirement: Restrict history views to finished games
Admin history and replay routes SHALL return game details and events only after the game has ended.

#### Scenario: Live game is requested by ID
- **WHEN** an operator requests history for a game that is still in progress
- **THEN** the history route returns 404

### Requirement: Manage runtime configuration without exposing secrets
For the v2.2 Should scope, authorized operators SHALL be able to view and update supported runtime overrides; configuration reads SHALL reveal whether a secret is set but SHALL never return its value.

#### Scenario: Operator reads configuration
- **WHEN** an authorized operator requests runtime configuration
- **THEN** non-secret settings are shown and secret values are masked as set or unset

### Requirement: Rotate the host key safely
Host-key rotation SHALL return the new value only in the successful response, SHALL never log it, and SHALL affect new room creation only.

#### Scenario: Operator rotates the host key
- **WHEN** an authorized operator confirms host-key rotation
- **THEN** the new key is returned once, existing rooms remain unaffected, and the audit record contains no key value

### Requirement: Audit admin mutations
Every admin mutation SHALL use a state-changing HTTP method, require the admin mutation guard, and append an audit record; GET requests SHALL have no side effects.

#### Scenario: Operator changes admin-managed state
- **WHEN** an authorized operator submits a valid guarded mutation
- **THEN** the change is applied and its actor, action, target, and time are recorded

#### Scenario: Mutation lacks its guard
- **WHEN** a mutation omits the required guard or JSON request format
- **THEN** the system rejects it without applying the change

### Requirement: Confirm destructive dashboard actions
The dashboard SHALL require confirmation before closing a room, rotating the host key, or unlocking an IP.

#### Scenario: Operator starts a destructive action
- **WHEN** an operator selects one of these actions
- **THEN** the dashboard asks for confirmation before submitting the mutation

### Requirement: Retain security and audit records
The system SHALL retain security events for 90 days and admin audit records for one year.

#### Scenario: Retention period passes
- **WHEN** a security event or audit record exceeds its retention period
- **THEN** it is deleted and no longer presented as retained history

### Requirement: Close a live room safely
The system SHALL notify connected room clients that an operator closed the room before deleting its snapshot and reconnect tokens, and SHALL audit the closure.

#### Scenario: Operator closes a room
- **WHEN** an authorized operator confirms room closure
- **THEN** clients receive a closed notification, room state and tokens are removed, and the action is recorded in the audit log

### Requirement: Limit admin list responses
Admin list routes SHALL support cursor pagination and SHALL cap each page at 100 records.

#### Scenario: Requested page exceeds the limit
- **WHEN** an operator requests more than 100 records
- **THEN** the response contains no more than 100 records
