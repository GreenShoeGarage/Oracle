# ORACLE Batch 17 — Complete starter experiences

ORACLE v1.7.0 assembles the engagement systems delivered in Batches 13–16 into three ready-to-run starter experiences.

| Theme | Experience | Shared project |
| --- | --- | --- |
| Fantasy | **The Lantern Gathering** | Restore the Border Lantern |
| Cyberpunk | **The Neighborhood Relay** | Bring the Neighborhood Relay Online |
| Wasteland | **The Water Watch** | Restore the Water Watch |

Each bundle targets roughly **2–6 players** and **30–45 minutes**. Those are design targets, not claims of human field validation.

## Player flow

The combined workspace presents one restrained sequence:

1. **Meet someone** — choose a connection card and use its opening or lower-pressure alternative.
2. **Follow your story** — choose an optional personal arc and privately track its prompts.
3. **Help the group** — contribute to the community project through reviewed work, eligible verified evidence, or an available resource contribution.

The sequence is guidance, not a mandatory quest chain. Players may skip a card, decline an arc, or contribute quietly. ORACLE intentionally avoids streaks, rankings, overdue warnings, and engagement scoring.

## Organizer installation

An organizer opens the Starter Experience workspace and previews the exact bundle before installation. Installing version 1 records a `starter_experience_installs` row and installs authored definitions only:

- six themed connection-card templates;
- the three existing themed personal-arc templates;
- one themed community project with its existing Batch 16 contribution modes and bounded consequences;
- a frozen install snapshot containing titles, bundle version, assignment suggestions, and the unfinished ending.

The install is repeat-safe for the same event, starter key, and starter version. It does **not** overwrite customized content merely because the organizer opens the installer again.

## What installation never copies

The bundle record never contains or creates:

- connection assignments, responses, or mutual shared-history consent;
- personal arc selections, progress, or reflections;
- community-project submissions, reviews, donations, receipts, refunds, or effects;
- player inventory, journal discoveries, agreements, or SIGIL outcomes.

Those records remain in their existing account/character-bound systems.

## Running the experience

The workspace includes a printable organizer run sheet with the opening, expected player flow, assignment suggestions, project outcome, and an alternate unfinished ending. The organizer should introduce the situation, let the first conversations breathe, and point at the shared project only when players have something meaningful to offer.

The phone is reference material, not the center of play. A useful Batch 17 session is one where players can find an opening, understand a personal reason to care, contribute to something collective, and then leave the screen to roleplay.

## Ending behavior

A completed project uses the existing Batch 16 completion machinery. Content unlocks remain audience-bounded and any generated BROADSIDE remains a draft until an organizer publishes it through the existing review process.

An unfinished project has an authored alternate ending. It records an incomplete fictional situation, not a player-performance failure. ORACLE does not penalize players or automatically extend the session.

## Offline behavior

The v1.7 immutable public shell includes the Starter Experience workspace. Existing connection-card, arc, prepared-field, and project-snapshot offline rules remain unchanged. Shared authoritative mutations—assignments, arc progress, contributions, donations, approvals, consequences, and refunds—still require connectivity.

## Versioning and safety

SQL schema 15 adds only `starter_experience_installs`. Existing Batches 13–16 tables and contracts remain additive and authoritative. A future bundle revision must use a higher `starter_version`; it must not silently reinterpret the version-1 snapshot or overwrite organizer customizations.

Automated acceptance covers bundle composition, preview-before-install, organizer-only installation, repeat safety, and the invariant that authored installation creates no player state. Human/device field acceptance remains separate and should be recorded through the existing pilot process.
