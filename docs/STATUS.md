# ORACLE v0.1.0 — Batch 1 status

Recorded September 5, 2026.

Source repository: [GreenShoeGarage/Oracle](https://github.com/GreenShoeGarage/Oracle). Runtime release commit: `b159c88a3f98c9a6d14e488449ac089c4b7001c4`. Application version: `0.1.0`; schema version: `1`.

## Implemented

Account registration/login/logout, password changes, hashed server-side sessions, database-backed rate limiting, exact-origin write protection, private event membership, owner/organizer/staff/player roles, expiring/revocable invitations, single-use privileged invitations, lifecycle transitions, optimistic edit conflicts, activity logs, responsive browser interface, versioned checksum-checked migrations, health/readiness endpoints, production Dockerfile, GitHub CI, and deployment/recovery documentation.

Two independent source reviews found and led to fixes for: password-change/login ordering; privileged invitation reuse; shutdown exit-code verification; production-image execution in CI; and content/identity-sequence checks after recovery.

## Verification completed

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

- Complete the two-account authenticated walkthrough against remote staging, including persisted changes and removal of access. The interrupted attempt may have left disposable accounts and events in staging only.
- Configure and verify scheduled production backups. Railway's effective HOBBY plan limits report `maxBackupsCount: 0`; no scheduled backup or external backup runner is configured. The CI recovery rehearsal does not back up live data.
- Browser/device visual QA and a human field pilot have not been performed. These remain later roadmap activities.

Batch 1 is implemented and deployed, with source, CI, and public deployment checks complete. Full operational acceptance remains open for the remote authenticated staging walkthrough and scheduled backups. Batch 2 and later features have not been started.
