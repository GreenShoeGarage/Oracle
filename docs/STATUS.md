# ORACLE v0.4.0 — Batch 4 release status

Recorded September 5, 2026.

Source: [GreenShoeGarage/Oracle](https://github.com/GreenShoeGarage/Oracle). Candidate application `0.4.0`; database schema `5`; briefing-pack format `1`; adventure format `1`. Batch 4 is implemented and undergoing release verification. Production's last verified release remains `12a34458de3bdbe0968e7d2b174ba441e7952d09` (v0.3.0, schema 4).

## Batch 4 implemented

- RELIC examinations, DEAD DROP protected messages/recordings, CIPHERBOX answers/hints/attempts, and WAYFINDER scene availability/reservations.
- Three complete 30-minute adventures for 2–6 players, each with two approved unassigned characters, printed props, a linked clue chain, and complete success/manual-fallback endings.
- Private per-character journal snapshots, bounded conditions/flags, request idempotency, server-checked approval/membership, and once-only outcomes.
- Organizer authoring forms, private solutions, safe prop labels, focused prop view, read-only character preview, and audited release/solve/reset-attempt overrides.
- Isolated rehearsal copies with fresh characters/codes and no copied progress; reset restricted to dedicated copies in Rehearsal. Sources are capped at 100 character profiles.
- Static app caching and account-scoped read-only copies of already-revealed journal text/audio. No API cache, offline authorization, queued action, or local event server.
- Additive migration 005, retaining earlier account/event/character data and provisioning behavior.

The existing themes, accounts, roles, invitations, character approval, QR identity, inventory, and administration remain supported. Briefing-pack format 1 excludes adventure definitions/progress and character records. Eight gameplay instruments remain planned. Batch 5 introduces selected player-to-player information exchange.

## Candidate verification

| Local check | Recorded result |
| --- | --- |
| Full `npm run verify` | 106 tests: 105 passed, zero failures, one deliberate TCP-only skip; syntax/assets passed |
| Adventure regression suite | 11 tests passed, including permissions, progression, alternatives, replay, capacity, and rehearsal behavior |
| Offline/prop contract suite | 16 tests passed, including projection, storage invalidation, bounds, and static-only caching |
| Full staging-check rehearsal | All three themes passed against local HTTP/PGlite: 145 reads, 196 writes |
| DOM/API smoke | Eleven flows passed with zero uncaught JavaScript errors using real app modules, JSDOM, and PGlite-backed HTTP |

The DOM checks include normal-player Characters/Adventure entry, a dirty-form guard for prop links, and clearing private DOM/IndexedDB after a server refresh reports revoked membership. Real PostgreSQL/Docker/recovery CI, the exact-commit remote staging journey, and production deployment/smoke still require recorded results. Local HTTP/JSDOM tests are not authenticated real-browser, mobile-camera, or human field testing.

Review identified and corrected event-status interpretation, unapproved-character projections, future scene starts, stale reservations, disabled factory actors, rehearsal limits, and inherited/accessor node-type validation. Source fixes are covered by relevant tests; current deployment evidence must still be obtained before promotion.

## Last verified deployment

| Target | Project ID | Batch 3 deployment ID | Baseline |
| --- | --- | --- | --- |
| [Staging](https://oracle-production-488d.up.railway.app) | `4e75d5ec-f8e9-492d-ae75-e0d44428d24a` | `bf6cf9aa-1097-4f89-80d7-734eb68ba13a` | v0.3.0; full two-player journey passed |
| [Production](https://oracle.greenshoegarage.com) | `d1989864-9a40-4176-a9d3-203a06c4bd72` | `39a3f289-7a8a-4dc1-be21-54cb425332a9` | v0.3.0; exact-commit smoke passed |

The two Railway projects have separate PostgreSQL 18 services, credentials, volumes, and default environments named `production`. `APP_ENV=staging` distinguishes the test app. Production's canonical origin is `https://oracle.greenshoegarage.com`. Release branches and exact-commit gates remain unchanged; see [DEPLOYMENT.md](DEPLOYMENT.md).

The last checked operator state was a reserved account awaiting its owner's secure registration. Its setup code is delivered separately; no personal address or secret is stored in the repository. Provisioning stays idempotent: an existing selected account keeps its UUID/password; an absent reserved account cannot be claimed through email knowledge alone. Batch 4 does not fabricate or replace this user.

## Remaining limits

- Scheduled production backups remain unconfigured. Railway HOBBY effective limits report `maxBackupsCount: 0`; no external runner is configured. Disposable CI restore tests and briefing packs do not back up live event data.
- Schema 5 cannot use the older schema-4 v0.3.0 binary as a rollback image. Preserve data and roll forward with a tested schema-5-compatible fix.
- Saved readings can reflect stale permissions while disconnected. They are read-only, account-scoped, and cleared on logout/account changes or known revocation; reconnect for current access and actions.
- Authenticated real-browser/mobile and physical-camera testing, load measurement, and a human field pilot remain unverified.
