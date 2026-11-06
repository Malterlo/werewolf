# Night Table: v1 game specification

Hidden-role party game (Werewolf / Mafia). Played in person or on a video call, same app. Talking and voting happen out loud. Phones carry secrets and record results. Backend is self-hosted (Node, ws, rootless podman). Frontend is a static page on GitHub Pages.

## Roles and permissions

| Actor | Can do | Never sees |
|---|---|---|
| **GM** (narrator, no role) | Everything that changes state: config, deal, phases, open/close night turns, kill, lynch, revive, reassign, kick, end, reveal, undo | n/a (sees all roles) |
| **Player** | `join`, `ack` (seen my card), `night_target` (only own night role, only while that turn is open, only if alive) | Other players' roles, other roles' picks |
| **Wolf** | Same as player, plus sees living teammates and their picks live | Non-wolf picks |
| **Dead player** | Nothing. Sees a "you are out" screen | Roles until the end-of-game reveal |
| **Host (room creator)** | Must know the server passphrase (`HOST_KEY`) | n/a |

- Joining needs room code + name. Joining is blocked once cards are dealt.
- Duplicate names rejected. Names trimmed, control characters stripped, 16 chars max.
- One GM per room. GM reconnects with a stored token. No GM handover.
- The server never sends a secret to a client that must not see it. `viewFor` is the only exit for game state.

## Game flow

1. **Lobby.** GM picks theme, role counts. Players join.
2. **Deal.** Server shuffles with `crypto.randomInt`. Players hold the card to look. Each phone acks once.
3. **Night.** Player phones go full black with an eyes-closed cue (eyes closed, camera off, mic muted).
   - GM sees a checklist of **every** role in play, even if its holders are dead (so silence never reveals a death).
   - GM taps **Wake** for a role. Living holders' phones show a target picker and buzz. GM taps **Close turn** when done.
   - Wolves see teammates' picks live and can change picks until the turn closes. Majority of living wolves wins. No majority → GM decides. GM gets a "Kill X" shortcut on majority.
   - Other night roles (protector, inspector) also tap a target. GM reads results out of band (private DM on a call, whisper in person). Not sent through the app.
   - GM records deaths manually. App does not resolve protect vs kill.
4. **Day.** Players talk and vote out loud. GM records the lynch. Ties: GM decides, no app rule.
5. **Win check.** Wolves win when wolves ≥ everyone else alive (1 wolf vs 1 villager = wolves win). Good wins when no wolves remain. Jester wins if lynched. App suggests, GM confirms.
6. **Reveal.** GM taps to flip cards one at a time: dead first, then living, **wolves last**. Winner banner appears only after the last card.

Every kill and lynch needs a confirm dialog. Undo reverts the last 30 changes (kick clears history).

## UI and UX

- Dark, moody, theatrical. Mobile-first. Fraunces display, Khmer fallbacks Noto.
- Hold-to-reveal card. Role name and art enter the DOM only while held. Hides on release, tab switch, or after 10 s.
- English + Khmer toggle on every screen, remembered per device. **Khmer strings are a draft and need native review.**
- Haptics: buzz on deaths, phase change, turn open, reveals. Night phase changes stay quiet.
- Ambient sound: per-player toggle, default off (a call mic would pick it up). Plays on living players' phones at night only, identical for everyone.
- Rules sheet is generated from roles actually in play.
- Reduced-motion respected. Tap targets ≥ 44 px.

## Server

- Rooms in memory, `Map` keyed by code. One process. Caps: 50 rooms, 20 players, 2 KB messages, 20 msgs / 5 s per socket.
- Origin allowlist (`ALLOWED_ORIGIN`). Passphrase (`HOST_KEY`) compared in constant time. 5 wrong tries locks that IP for 10 min.
- Rooms expire after 2 h idle, 15 min if empty.
- Wire protocol: client sends intent only (`{type, id}`), server replies with a full personalized snapshot.

## V1 boundary and follow-up

The v1 baseline does not define extra roles such as witch or cupid, a public TV
board, or load testing. Persistence, role art, name filtering, and Khmer review
are tracked as v2 work in
[`openspec/changes/night-table-v2/`](../openspec/changes/night-table-v2/).
