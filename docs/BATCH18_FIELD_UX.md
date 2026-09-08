# ORACLE v1.8.0 — Batch 18 Field Experience & UX Consolidation

Batch 18 deliberately adds no new gameplay subsystem and no database migration. SQL schema remains 15. The release makes the already-shipped connection, arc, project, and instrument capabilities feel like one field instrument.

## Player outcome

Field Home asks one question: **What can I do now?**

The primary path is intentionally small:

1. **Meet someone** — use a Connection Card.
2. **Follow your story** — use a Personal Character Arc.
3. **Help the group** — contribute to a Community Project.

Specialist instruments remain available under **Explore the world** rather than competing with the three field-facing actions.

## Recommendation rules

Field Home derives suggestions from current authorized event state and the signed-in player's approved assigned character.

- An offered, kept, or paused Connection Card is the first recommendation.
- If there is no current Personal Arc, choosing one becomes the next recommendation.
- An open Community Project becomes the next recommendation after the basic personal path is established.
- If no approved character is assigned, ORACLE sends the player back to character setup rather than inventing field guidance.
- The recommendation is deliberately advisory. Players can open any of the three primary paths at any time.

There are no streaks, scores, overdue indicators, engagement grades, or behavioral telemetry.

## Offline behavior

Field Home does not claim to know current shared state when the network is unavailable. It switches to a dated-reference posture and links only to the existing prepared/saved surfaces:

- prepared Connection Cards,
- prepared Personal Arc material and device-local reflections,
- saved Community Project snapshots.

Consent, authoritative arc progress, project submissions, staff decisions, evidence credit, donations, and consequences still require a connection. Reconnection reloads the Field Home from authoritative APIs.

## Mobile and accessibility

The Field Home uses safe-area insets, 44–48px minimum field actions, a fixed three-action bottom rail, one-column narrow-screen layouts, forced-colors support, and reduced-motion handling. The page intentionally keeps specialist tools collapsed so the primary path remains readable outdoors and on small screens.

## Integration

The v1.8 application enhancer replaces the earlier Batch 17 **What can I do now?** character action with **Field Home**. The original complete Starter Experience workspace remains available to organizers and players; Batch 18 does not remove or reinterpret Batch 17 content.

The v1.8 immutable offline shell includes the complete v1.3–v1.8 wrapper chain plus Field Home assets. Existing account/privacy boundaries and schema 15 remain unchanged.

## Verification

Dedicated tests cover:

- recommendation priority for a current Connection Card,
- use of the signed-in player's approved private character projection,
- offline fail-closed wording and prepared-material links,
- fixed three-action field navigation,
- safe-area, narrow-screen, forced-colors, reduced-motion, and minimum-touch-target CSS contracts.

The normal ORACLE release gate remains authoritative: application/regression suite, 100-authenticated-player PostgreSQL rehearsal, populated backup/restore, repeat migration/startup, exact production image, and production-session configuration.

Human/device field acceptance is still separate. Batch 18 should be evaluated with real newcomers, organizers, iPhone/Android devices, bright outdoor conditions, and weak/no connectivity before ORACLE is called field-proven.
