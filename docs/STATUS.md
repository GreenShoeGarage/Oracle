# ORACLE v0.2.0 — Batch 2 release status

Recorded September 5, 2026.

Source repository: [GreenShoeGarage/Oracle](https://github.com/GreenShoeGarage/Oracle). Candidate application version: `0.2.0`; target schema version: `2`. Candidate verification and production promotion are in progress. The last verified production release is `b159c88a3f98c9a6d14e488449ac089c4b7001c4` (application `0.1.0`, schema `1`).

## Batch 2 implemented

- Fantasy, Cyberpunk, and Wasteland themes with validated colors, font/icon/texture choices, terminology, and optional sound cues.
- Four-step guided event setup and editing: World, Event, Material & rules, Review.
- Blank event and three themed starter briefings, each with a starting scene and organizer notes. Complete adventures remain a later batch.
- Optional Briefing instrument, audience-marked authored entries, organizer workspace, player reading/preview, and prop display.
- Dark/outdoor settings, device/reduced motion, collapsible navigation, and explicit unsaved/saving/confirmed status. Drafts remain in page memory until the organizer saves.
- Bounded declarative rules definitions; no scripts or automatic challenge execution.
- Strict format-1 organizer/player packs. Imports create a new owned Draft, preserve nested rule/content IDs, and do not transfer identities, memberships, invitations, history, or lifecycle state.
- Additive schema-2 migration preserving Batch 1 records, plus targeted migration and authorization regression tests.
- GitHub `staging-smoke` waits for the exact candidate commit, version, and schema before the two-account deployed workflow. On the release branch, `production-smoke` waits for that same checked commit at the canonical production origin and performs only public GET requests.

All twelve planned gameplay instruments, characters, QR exchange, offline synchronization, and complete starter adventures remain unimplemented. A prop preview retains the signed-in account's permissions; unattended devices should use a player account.

## Batch 2 verification

Local verification completed:

- The final `npm run verify` passed 42 of 43 tests, with zero failures and one deliberate skip for the test that requires independent PostgreSQL TCP connections. This includes the near-limit event-pack export regression. Syntax, version alignment, asset presence, and Git whitespace checks also passed.
- Real Chromium browser QA passed 11 scenario groups against the local application. Covered registration, all three themed setup wizards, bounded-rule validation with retained inputs, player/prop private-content exclusion from the DOM, prop flags, return to organizer controls, and theme switches preserving rules and content IDs.
- Browser QA also exercised actual export downloads and UI import into a fresh Draft; a simulated 503 save retained the draft, protected cancellation, and saved successfully on retry. Desktop and 375-pixel viewport checks covered outdoor settings, collapsed navigation, and refresh without horizontal overflow or unexpected console errors.
- The complete staging-check script passed a local API rehearsal using production cookie settings and an expected-commit fixture. SQL cleanup checks found zero active test sessions and zero unarchived test events. This rehearses the checker; it is not a remote staging result.
- The production read-only smoke path passed its local rehearsal: 11 GET requests, zero created users, and zero created events.
- The documented JSON event-pack example passes the shared server/browser validator.

Pending release evidence: GitHub PostgreSQL/Docker/recovery checks, the full exact-commit remote staging journey, and production deployment verification. Actual deployed results must be recorded after these complete.

The migration retains existing data but changes the expected schema to 2. After applying it, the schema-1-only v0.1.0 app cannot serve as a rollback image. Use a tested schema-2-compatible roll-forward fix; do not drop setup data or bypass readiness.

## Batch 1 baseline

Account registration/login/logout, password changes, hashed server-side sessions, database-backed rate limiting, exact-origin write protection, private event membership, owner/organizer/staff/player roles, expiring/revocable invitations, single-use privileged invitations, lifecycle transitions, optimistic edit conflicts, activity logs, responsive browser interface, versioned checksum-checked migrations, health/readiness endpoints, production Dockerfile, GitHub CI, and deployment/recovery documentation.

Two independent source reviews found and led to fixes for: password-change/login ordering; privileged invitation reuse; shutdown exit-code verification; production-image execution in CI; and content/identity-sequence checks after recovery.

## Previously completed Batch 1 verification

- Local `npm run verify`: 23 tests total; 22 passed, 0 failed, 1 deliberately skipped because it requires independent PostgreSQL connections. The local integration database was PGlite (PostgreSQL compiled to WebAssembly).
- GitHub CI passed for the release commit on [main, run 33994950816](https://github.com/GreenShoeGarage/Oracle/actions/runs/33994950816) and [staging, run 33995002387](https://github.com/GreenShoeGarage/Oracle/actions/runs/33995002387).
- CI used a real PostgreSQL 18 TCP service. Its suite passed 22 of 23 tests, including the concurrent password-change/login test; the PGlite-only snapshot test was skipped because CI separately exercises a full logical backup and restore.
- Covered event isolation, role restrictions, invitation authorization/revocation/limits, lifecycle validation, session expiry/logout/password changes, SQL-shaped inputs, transactional rollback, and migration repeatability/checksum protection.
- The real `pg_dump`/`pg_restore` rehearsal passed with restored content digests, identity-sequence checks, and migration after restore.
- Startup, database readiness, session API, public assets, and clean shutdown checks passed.
- CI built and ran the production Docker image, confirming production configuration, secure session creation, and graceful shutdown.
- Syntax, version alignment, and static entrypoint assets checked. The production dependency audit reported zero vulnerabilities at the time of the check.
- Staging's public health/readiness, session API, and asset smoke checks passed.
- Production HTTPS health/readiness returned HTTP 200 with version `0.1.0` and schema version `1`; the session API returned HTTP 200 with the production environment. These checks passed on the canonical custom domain and generated Railway domain.
- Railway production deployment `83b762b8-47dc-47b8-80aa-8ad2e04eee45` succeeded at the recorded runtime commit from the `production` branch.
- The additional two-account remote staging walkthrough was interrupted before a complete result. It is not recorded as passed; equivalent authorization and persistence journeys passed in CI. No production test accounts or events were created.

The local environment has no Docker daemon or PostgreSQL server tools. The Docker and PostgreSQL TCP results above were obtained in GitHub CI.

## Infrastructure state

| Target | Railway project | Project ID | State |
| --- | --- | --- | --- |
| Staging | ORACLE Staging | `4e75d5ec-f8e9-492d-ae75-e0d44428d24a` | Application deployed; public checks passed |
| Production | ORACLE | `d1989864-9a40-4176-a9d3-203a06c4bd72` | v0.1.0 live; HTTPS readiness and session API verified |

Production is available at [oracle.greenshoegarage.com](https://oracle.greenshoegarage.com), the canonical `APP_ORIGIN`. Staging is available at [oracle-production-488d.up.railway.app](https://oracle-production-488d.up.railway.app). Each Railway project has its own default environment named `production`, PostgreSQL 18 service, credentials, and persistent volume. `APP_ENV=staging` distinguishes the test application; its data is separate from production.

Railway staging follows `staging`; production is configured to follow the dedicated `production` release branch at the checked runtime commit. `main` is for integration. Future production branch advances require manual verification of the exact commit's CI and staging results. Railway Wait for CI is not enabled (`checkSuites: false`). See [DEPLOYMENT.md](DEPLOYMENT.md) for the release procedure and current configuration.

## Outstanding operational requirements

- Pass the new automated two-account staging gate for the Batch 2 candidate. This will close the interrupted Batch 1 remote walkthrough requirement when an actual successful result is recorded.
- Configure and verify scheduled production backups. Railway's effective HOBBY plan limits report `maxBackupsCount: 0`; no scheduled backup or external backup runner is configured. The CI recovery rehearsal does not back up live data.
- Local Chromium visual/workflow QA has passed at desktop and 375-pixel widths. Representative physical-device testing and a human field pilot remain pending.

Batch 1 remains the last verified production deployment. Batch 2 is implemented and undergoing release verification. Production promotion and scheduled backups remain explicitly open until their respective results are recorded.
