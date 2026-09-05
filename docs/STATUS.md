# ORACLE v0.2.0 — Batch 2 release status

Recorded September 5, 2026.

Source: [GreenShoeGarage/Oracle](https://github.com/GreenShoeGarage/Oracle). Release commit: `537c17443947694664499d91007c289bdfc2ac6d`. Application `0.2.0`; database schema `2`; event-pack format `1`.

Batch 2 is deployed at [oracle.greenshoegarage.com](https://oracle.greenshoegarage.com). Local verification, GitHub CI, the full remote staging journey, Railway production deployment, and exact-commit production smoke all passed.

## Shipped capabilities

- Batch 1 accounts, private event membership, roles, invitations, lifecycle controls, and activity logs remain supported.
- Fantasy, Cyberpunk, and Wasteland themes with validated colors, fonts, icons, textures, terminology, and optional sound cues.
- Four-step guided setup, a blank template, and three themed starter briefings with organizer preparation notes.
- Optional Briefing instrument; player and organizer material; organizer workspace, player preview/reading view, and fullscreen prop display.
- Dark/outdoor settings, reduced motion, collapsible navigation, and explicit unsaved/saving/confirmed status.
- Bounded declarative rules and strict format-1 organizer/player event packs. Imports create new owned Drafts without transferring memberships, account information, invitations, history, or lifecycle state.
- Additive schema-2 migration that preserves Batch 1 records. Event creation without setup remains compatible.

The twelve planned gameplay instruments, character creation, QR exchange, offline synchronization, and complete starter adventures remain later batches. A prop preview retains the signed-in account's permissions; use a player account on unattended devices.

## Verified release evidence

| Check | Result |
| --- | --- |
| Local `npm run verify` | 43 tests: 42 passed, 0 failed, 1 TCP-only skip; syntax, version, assets, and whitespace checks passed |
| [Main CI 33996969465](https://github.com/GreenShoeGarage/Oracle/actions/runs/33996969465) | Passed on the recorded release commit |
| [Staging CI 33996970033](https://github.com/GreenShoeGarage/Oracle/actions/runs/33996970033) | Verification and deployed staging workflow passed on the same commit |
| GitHub PostgreSQL 18 suite | 43 tests: 42 passed, 0 failed, 1 PGlite-only snapshot skip; real TCP password/session race passed |
| Recovery and runtime gates | Real `pg_dump`/`pg_restore` with content/identity checks, startup/readiness/shutdown, and built production Docker image with secure sessions passed |
| [Remote staging journey, job 101389165649](https://github.com/GreenShoeGarage/Oracle/actions/runs/33996970033/job/101389165649) | Complete two-account workflow passed; test events archived and sessions logged out |
| Local Chromium QA | 11 scenario groups passed at desktop and 375-pixel widths |
| [Production CI 33997027349](https://github.com/GreenShoeGarage/Oracle/actions/runs/33997027349) | Exact-commit public smoke passed at the canonical production domain; Railway deployment succeeded |

The deployed staging journey checked exact commit/version/schema, assets, secure cookies and Origin protection, registration, cross-event isolation, invitation redemption, player read access and rejected edits, server-filtered player/prop material, all three themes preserving rules/content IDs, organizer export/import into a fresh Draft, player exports without secrets, stale-save conflicts, persistence after sign-in, and immediate revocation across detail/pack/preview routes. This closes the interrupted Batch 1 authenticated staging acceptance check.

Local Chromium QA exercised the actual setup wizards, validation with retained inputs, audience filtering in the DOM, prop flags, organizer return, theme preservation, file download and UI reimport, and simulated 503 save recovery with discard protection. Outdoor/collapsed settings and refresh passed without horizontal overflow or unexpected console errors. Local rehearsals also verified the automated staging check's cleanup and the production smoke's read-only behavior (11 GET requests, zero created users/events). The documented pack example passes shared validation.

Local database tests used PGlite; PostgreSQL TCP, recovery client tools, and Docker results came from GitHub CI. Browser QA used local Chromium, not a human event or representative physical phones.

## Deployment record

| Target | Project ID | Deployment ID | State |
| --- | --- | --- | --- |
| [Staging](https://oracle-production-488d.up.railway.app) | `4e75d5ec-f8e9-492d-ae75-e0d44428d24a` | `e8b1aef5-0b88-4069-bac3-a138b831ce1d` | Success at release commit; full workflow passed |
| [Production](https://oracle.greenshoegarage.com) | `d1989864-9a40-4176-a9d3-203a06c4bd72` | `d8e09f12-373d-4201-911f-8bd7365a3e12` | Success at release commit; public smoke passed |

Each Railway project has its own default environment named `production`, PostgreSQL 18 service, credentials, and persistent volume. Staging uses `APP_ENV=staging`. Production's canonical `APP_ORIGIN` is `https://oracle.greenshoegarage.com`.

`main` is for integration, `staging` deploys the test application, and `production` advances only to the commit already checked by CI and staging. Railway Wait for CI is not enabled. The successful [production smoke job 101389239199](https://github.com/GreenShoeGarage/Oracle/actions/runs/33997027349/job/101389239199) confirmed the exact promoted commit, application v0.2.0, and schema 2 at the canonical domain using only public GET checks. Duplicate verification and staging jobs were skipped on this release-branch push as intended. No production test accounts or events were created. See [DEPLOYMENT.md](DEPLOYMENT.md).

## Remaining limits

- Scheduled production backups are not configured. Railway's effective HOBBY limits report `maxBackupsCount: 0`; no external runner is configured. CI recovery tests do not back up live data, and an organizer event pack does not restore accounts or event history.
- Schema 2 is not compatible with the schema-1-only v0.1.0 rollback image. Preserve the migrated database and roll forward with a tested schema-2-compatible fix; do not drop setup data or bypass readiness.
- Unsaved setup drafts live in page memory until explicitly saved. Server actions require connectivity.
- Representative physical-device testing and a human field pilot remain future roadmap gates.
