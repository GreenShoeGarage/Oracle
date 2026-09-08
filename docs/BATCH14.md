# ORACLE Batch 14 — Personal character arcs

Target: v1.4.0 · SQL schema 12

Batch 14 adds optional private character journeys without turning roleplay into a score or organizer performance dashboard.

## Player experience

- Open **My character arc** from the event field tools.
- Choose one published arc for an approved character assigned to the signed-in account.
- Read a starting question, three flexible turning-point prompts, and a closing reflection.
- Mark a prompt complete, skip it, or undo either choice.
- Replace or end an arc at any time. Earlier arcs remain in that player's private history.
- Save a reflection explicitly on the current device. Reflection text is never uploaded by the arc API.
- Save the current arc and last-confirmed progress for offline reading with a read-back check and preparation timestamp.
- Print a compact prompt sheet.

There are no XP awards, streaks, overdue indicators, leaderboards, or organizer completion scores.

## Organizer experience

Organizers can install the three built-in arcs for the event's theme or author custom templates. The built-in packs are:

- Fantasy: **Learning to Trust**, **Finding a Place**, **The Weight of Responsibility**.
- Cyberpunk: **Trust in a Hostile Network**, **Autonomy**, **Redemption Protocol**.
- Wasteland: **Choosing Hope**, **Belonging After the Fall**, **Learning to Lead**.

The organizer arc library exposes templates only. Normal organizer reads do not expose player selections, prompt progress, replacement/end history, or device-local reflections.

## Storage and privacy contract

Authored templates are stored separately from player state. Player state is bound to `event_id + character_id + user_id`, and only an approved character currently assigned to that account can be used to read or mutate it. A new active selection marks the previous active state `replaced` rather than rewriting it.

Device-local reflections and prepared arc snapshots use a separate IndexedDB database. Stored records are scoped by account/event/character, and records belonging to another known account are cleared when the arc workspace opens under a different signed-in account.

Offline snapshots are historical reference material only. They display the saved timestamp and never authorize progress changes. Progress, selection, replacement, and ending require a connected authenticated request with fresh character ownership checks. Optimistic version checks reject stale progress writes.

## Release gates

`test/arcs.test.js` covers the built-in starter shape, organizer/player projection boundary, complete/skip/undo, stale writes, replacement history, ending, and cross-player isolation. The normal ORACLE verification, staging, migration, remote journey, and production promotion gates still apply. This document does not claim production deployment or human/device pilot acceptance.
