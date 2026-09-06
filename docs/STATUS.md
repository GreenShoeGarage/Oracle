# ORACLE v0.4.0 — Batch 4 release status

Recorded September 6, 2026.

Source: [GreenShoeGarage/Oracle](https://github.com/GreenShoeGarage/Oracle). Release commit: `f3d77a5df4c3f130fc5a658c9d2d4e9753b1d7c1`. Application `0.4.0`; database schema `5`; briefing-pack format `1`; adventure format `1`.

Batch 4 is deployed at [oracle.greenshoegarage.com](https://oracle.greenshoegarage.com). Main/staging CI, the complete remote three-theme two-character workflow, Railway production, and exact-commit public smoke passed. The existing reserved operator account is confirmed enabled; its identity and password were preserved.

## Batch 4 implemented

- RELIC examinations, DEAD DROP protected messages/recordings, CIPHERBOX answers/hints/attempts, and WAYFINDER scene availability/reservations.
- Three complete 30-minute adventures for 2–6 players, each with two approved unassigned characters, printed props, a linked clue chain, and complete success/manual-fallback endings.
- Private per-character journal snapshots, bounded conditions/flags, request idempotency, server-checked approval/membership, and once-only outcomes.
- Organizer authoring forms, private solutions, safe prop labels, focused prop view, read-only character preview, and audited release/solve/reset-attempt overrides.
- Isolated rehearsal copies with fresh characters/codes and no copied progress; reset restricted to dedicated copies in Rehearsal. Sources are capped at 100 character profiles.
- Static app caching and account-scoped read-only copies of already-revealed journal text/audio. No API cache, offline authorization, queued action, or local event server.
- Additive migration 005, retaining earlier account/event/character data and provisioning behavior.

The existing themes, accounts, roles, invitations, character approval, QR identity, inventory, and administration remain supported. Briefing-pack format 1 excludes adventure definitions/progress and character records. Eight gameplay instruments remain planned. Batch 5 introduces selected player-to-player information exchange.

## Release verification

| Check | Recorded result |
| --- | --- |
| Local `npm run verify` | 106 tests: 105 passed, zero failures, one deliberate TCP-only skip; syntax/assets passed |
| Adventure regression suite | 11 tests passed, including permissions, progression, alternatives, replay, capacity, and rehearsal behavior |
| Offline/prop contract suite | 16 tests passed, including projection, storage invalidation, bounds, and static-only caching |
| Full staging-check rehearsal | All three themes passed against local HTTP/PGlite: 145 reads, 196 writes |
| DOM/API smoke | Eleven flows passed with zero uncaught JavaScript errors using real app modules, JSDOM, and PGlite-backed HTTP |
| [Main CI 34000116757](https://github.com/GreenShoeGarage/Oracle/actions/runs/34000116757) | Passed at the exact release commit |
| [Staging CI 34000116740](https://github.com/GreenShoeGarage/Oracle/actions/runs/34000116740) | Verification and complete deployed adventure workflow passed |
| PostgreSQL 18 suite | 106 tests: 105 passed, one PGlite-only snapshot skip; TCP credential race and scene capacity passed |
| Recovery/runtime gates | Real dump/restore of populated adventure, character, and administration tables plus both audit identity sequences, startup, and running production Docker checks passed |
| Public staging Chrome | Sign-in page at v0.4.0, 1,363 × 936 desktop viewport; no horizontal overflow or app console errors |
| [Production CI 34000309961](https://github.com/GreenShoeGarage/Oracle/actions/runs/34000309961) | Exact release commit, v0.4.0/schema 5, and 25 public GET checks passed; no accounts, events, or mutations created |

The DOM checks include normal-player Characters/Adventure entry, a dirty-form guard for prop links, and clearing private DOM/IndexedDB after a server refresh reports revoked membership. The full remote staging journey passed all three complete adventures for two characters, including success/failure routes and cleanup. Its request counts were not printed; 145 reads/196 writes above describe only the local rehearsal. The CI PGlite-only snapshot skip is replaced by a real PostgreSQL dump/restore gate. Local HTTP/JSDOM tests are not authenticated real-browser, mobile-camera, or human field testing.

Review identified and corrected event-status interpretation, unapproved-character projections, future scene starts, stale reservations, disabled factory actors, rehearsal limits, and inherited/accessor node-type validation. The checked release passed the corresponding CI and remote staging gates before production promotion.

## Deployment record

| Target | Project ID | Deployment ID | Result |
| --- | --- | --- | --- |
| [Staging](https://oracle-production-488d.up.railway.app) | `4e75d5ec-f8e9-492d-ae75-e0d44428d24a` | `f364f026-ca07-42b7-a5ad-668164e448ed` | v0.4.0/schema 5 success; all-theme workflow passed |
| [Production](https://oracle.greenshoegarage.com) | `d1989864-9a40-4176-a9d3-203a06c4bd72` | `d785c33e-2dd4-4038-93f1-2e74180034cb` | v0.4.0/schema 5 success; exact-commit production smoke passed |

The two Railway projects have separate PostgreSQL 18 services, credentials, volumes, and default environments named `production`. `APP_ENV=staging` distinguishes the test app. Production's canonical origin is `https://oracle.greenshoegarage.com`. Release branches and exact-commit gates remain unchanged; see [DEPLOYMENT.md](DEPLOYMENT.md).

Production deployment completed at 00:04:35 UTC on September 6. Migration logs confirmed schema 5; startup confirmed v0.4.0 in production. The [production smoke job 101397869951](https://github.com/GreenShoeGarage/Oracle/actions/runs/34000309961/job/101397869951) verified readiness at 00:04:37 UTC and completed public checks by 00:04:40 UTC.

The operator account has now been claimed. Deployment logs confirmed a matching existing user and `accountExists: true`, `enabled: true`; idempotent provisioning preserved that user's UUID and password. No account was fabricated or replaced by this release. No private email, user identifier, setup secret, or password is stored in these documents.

## Remaining limits

- Scheduled production backups remain unconfigured. Railway HOBBY effective limits report `maxBackupsCount: 0`; no external runner is configured. Disposable CI restore tests and briefing packs do not back up live event data.
- Schema 5 cannot use the older schema-4 v0.3.0 binary as a rollback image. Preserve data and roll forward with a tested schema-5-compatible fix.
- Saved readings can reflect stale permissions while disconnected. They are read-only, account-scoped, and cleared on logout/account changes or known revocation; reconnect for current access and actions.
- Authenticated real-browser/mobile, physical-camera and actual browser service-worker inspection, load measurement, and a human field pilot remain unverified. Public desktop inspection and automated DOM/storage tests do not substitute for these checks.
