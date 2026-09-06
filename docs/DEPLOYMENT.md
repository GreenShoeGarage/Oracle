# ORACLE deployment and recovery

GitHub source control and Railway application/PostgreSQL hosting. Recorded September 6, 2026. Batch 6 (v0.6.0/schema 7) is an implemented release candidate; its exact-commit CI, staging deployment, and production promotion remain pending. Production remains verified Batch 5 (v0.5.0/schema 6).

## Current infrastructure

Source: [GreenShoeGarage/Oracle](https://github.com/GreenShoeGarage/Oracle). Last verified deployed commit: `72cce5d6858c6b59b34b7c8c80bc874bb088e099` (v0.5.0, schema version 6). Batch 6 candidate deployment IDs and CI results will be recorded only after the exact release passes its gates.

Staging deployment `82cc4760-efba-490a-a36d-d32e706c4218` succeeded at this commit, and [staging CI 34002025408](https://github.com/GreenShoeGarage/Oracle/actions/runs/34002025408) passed the complete remote workflow. Production deployment `0dcec31f-a368-4fb8-883b-5a4dcb9ad47f` succeeded on the same commit. [Production CI 34002163969](https://github.com/GreenShoeGarage/Oracle/actions/runs/34002163969) passed exact-commit v0.5.0/schema 6 readiness and all 31 public GET checks without creating data. Exact run links and evidence are in [STATUS.md](STATUS.md).

| Target | Railway project | Project ID | Application URL | Status |
| --- | --- | --- | --- | --- |
| Staging | ORACLE Staging | `4e75d5ec-f8e9-492d-ae75-e0d44428d24a` | [Staging app](https://oracle-production-488d.up.railway.app) | v0.5.0 deployed; exchanges and complete three-theme workflow passed |
| Production | ORACLE | `d1989864-9a40-4176-a9d3-203a06c4bd72` | [Production app](https://oracle.greenshoegarage.com) | v0.5.0 live; exact-commit production smoke passed |

Each project uses its own default Railway environment named `production`. These are separate environments in separate projects: staging has `APP_ENV=staging`, while production has `APP_ENV=production`. The environment IDs are `ae381b6c-578f-4e25-a71c-094124ca2105` for staging and `c31cbf3b-caa0-4c09-ae75-741daa6bcd85` for production.

Each has a separate PostgreSQL 18 service and persistent volume, using Railway's PostgreSQL template with `/var/lib/postgresql/data` mounted as required by that image. Application `DATABASE_URL` references resolve to the Postgres service in the same project and environment. Credentials and event data are isolated.

The canonical production origin is `https://oracle.greenshoegarage.com`, explicitly set in `APP_ORIGIN`. The generated [Railway production domain](https://oracle-production-77f2.up.railway.app) also serves health checks, but cookie-authenticated mutations require the canonical origin. Use the custom domain for normal application access.

## Repository and release branches

The owner-created repository is public and contains the source at its root. Its existing license and Git attributes have been preserved. Keep secrets out of Git.

Use `main` for integration and `staging` for the staging application. The workflow listens to `main`, `staging`, and `production` pushes and pull requests. Its `verify` job runs on integration/staging commits and pull requests. Batch 6 retains the adventure/character/superuser/QR/exchange gates and adds story audience/privacy, investigation provenance, reviewed publication/correction, account-bound collection/reacquisition, and story-aware rehearsal checks. Migration rehearsals begin with populated schema-6 exchanges and an existing enabled superuser. Recovery fixtures include every new story/TRACE table, hidden truths, draft-vs-publication state, collected rumor snapshots, activity, and private theories. On `staging`, a dependent `staging-smoke` job waits for the checked `GITHUB_SHA` to appear in readiness with the expected application and schema versions, then runs the authenticated two-account journey. Production promotion skips duplicate verification and runs `production-smoke`: up to five minutes waiting for that exact SHA, version, and schema at the canonical custom domain, followed by public GET checks. This relies on promoting the already-verified commit; the production job is not a replacement for CI and staging gates. Railway production follows the dedicated `production` release branch, currently at checked release commit `72cce5d6858c6b59b34b7c8c80bc874bb088e099`. Advance that branch only after checking CI and staging for the exact candidate commit. This is a manual promotion procedure: Railway's Wait for CI was unavailable through the connector and `checkSuites` remains false. No automatic branch protection is claimed.

The complete automated Batch 5 staging workflow passed on the recorded release commit: two players introduced characters, exchanged selected readings with mutual consent, exercised policy/offer changes and duplicate prevention, resumed persisted receipts/journals, and reset a rehearsal containing completed exchanges. All three prior adventure paths and existing event/character/QR workflows also passed, followed by cleanup. Main/staging CI passed 131 tests (130 passed, one PGlite-only snapshot skip), both TCP races, real populated-table dump/restore, startup, and the running production image. Production deployment and public-only checks also passed on the same commit; see [STATUS.md](STATUS.md).

The Batch 6 local HTTP staging rehearsal passed 252 reads and 287 writes, including every audience type, actual faction reapproval/removal, group removal, rumor QR sharing, private/shared investigations, publication correction/withdrawal, and discovery-gated rehearsal reset. The migration/foundation suite passed 35 tests with one existing TCP-only skip; the exact new recovery fixture passed local constraints and repeated migration. Full local verification passed 157 tests (155 passed, zero failures, two existing TCP-only skips). Ten full-app DOM/API checks passed with zero uncaught errors; fourteen story UI and ten TRACE UI focused checks also passed. The final audience-validation alignment then passed all eleven focused TRACE tests. The exact candidate's remote CI/staging/production gates remain pending. These local results do not replace the deployed gates.

Do not assume that a successful push proves deployment success. Inspect the workflow for the exact commit, then the Railway deployment result and readiness endpoint.

## Configure Railway before source attachment

The current deployment uses a separate staging project, with its own PostgreSQL instance, credentials, persistent volume, app instance, and domain. When recreating it, verify that staging's `DATABASE_URL` resolves to its staging database and that the PostgreSQL template's required data directory is on the mounted persistent volume.

For each application service, configure:

| Setting | Value |
| --- | --- |
| Build | Root `Dockerfile` |
| Start command | `npm start` |
| Pre-deploy command | `npm run migrate` |
| Healthcheck path | `/health/ready` |
| Healthcheck timeout | 300 seconds |
| Restart policy | On failure, maximum 3 retries |
| Application sleep | Disabled for live events |
| `NODE_ENV` | `production` |
| `APP_ENV` | `staging` or `production` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}`, referencing the database in this project/environment |
| `DATABASE_SSL` | `disable` for the intended Railway private network connection |
| `PORT` | `3000`, matching the generated domain's target port |
| `APP_ORIGIN` | Exact HTTPS origin for this app instance |
| `REGISTRATION_ENABLED` | `true` initially; configurable by operator |

The application binds `0.0.0.0` and honors Railway's `PORT`. Pre-deploy migrations have database access and do not depend on a mounted application filesystem. All migration files and the Node runtime are present in the final image. Configure a deployment/pre-deploy deadline using the platform controls available to your account; the SQL driver also bounds individual statements.

Railway's current documentation does not permit new services to opt into `railway.json` or `railway.toml`. This project therefore uses a Dockerfile and explicit service configuration. A future `.railway/railway.ts` must be applied through Railway's CLI; merely committing it does not configure a deployment. See the official [Infrastructure as Code documentation](https://docs.railway.com/infrastructure-as-code).

Attach the confirmed repository and correct environment branch only after database readiness, variables, migration command, and health checks are configured. If the connection workflow attaches and deploys immediately, use a source-less configured application service first and connect the source as the last step.

## Project superuser provisioning

Current production state (Batch 5): the reserved operator account is enabled. Migration and startup logs confirmed the matching existing account at this release; provisioning preserved its identity and password. No replacement user was created. The conditional instructions below remain the supported process for new installations or absent reserved accounts.

Provisioning is operator configuration for this installation, not a sign-up preference. Store these values only in protected Railway variables; do not put an operator's personal email or setup secret in the repository or an event pack.

1. Set `BOOTSTRAP_SUPERUSER_EMAIL` to the operator-selected account address. Use the same normalization as sign-in: trimmed, lowercase email.
2. If the account already exists, the configured pre-deploy `npm run migrate` promotes that same database user and enables it. Its UUID, password hash, and event data remain intact. Sign in with the existing password; no reset or replacement account is created.
3. If the account does not exist, migration reserves the address without creating a user. To claim it, configure a cryptographically random `BOOTSTRAP_SUPERUSER_SETUP_TOKEN` of 32–512 characters and provide it through the registration form's operator setup-code field. Registration must be open. Knowledge of the email alone cannot register the reserved superuser.
4. After a successful claim, remove the temporary setup-token variable. The unique existing account and ordinary password sign-in are sufficient. Keep the operator email setting only if deployment should continue to enforce that account's superuser/enabled state.
5. Verify the matching account can open Project administration and All events. The migration log reports matching/provisioning state. A read-only startup `superuser_status` record reports `accountExists` and `enabled`, allowing deployment verification even when pre-deploy logs are unavailable. Neither log prints the configured email, setup secret, or password. Do not infer provisioning succeeded from a set variable alone.

No account or privilege is inferred from an email in a browser request alone. Existing reserved accounts are provisioned by deployment; absent accounts require the separate operator-held secret. Public registration cannot select a role, and the admin interface has no role-grant or password-reset action. Leave both variables unset where project administration is not needed. Staging and production require their own operator configuration; do not reuse production secrets for disposable staging checks.

## Release gate

1. Run `npm ci` and `npm run verify` on the release candidate.
2. Pass GitHub's `verify` job against PostgreSQL 18, including prior-schema preservation, character/superuser authorization, QR encode/decode and camera teardown, concurrent credential/session tests, backup/restore of populated character, administration, adventure, exchange, story, and investigation records, and running production Docker image checks.
3. Deploy that candidate to the isolated staging database. The `staging-smoke` job waits up to five minutes for `/health/ready` to report the expected app version, schema, and exact `GITHUB_SHA` in `deploymentCommit`. A healthy older deployment does not satisfy this gate.
4. Pass the two-account staging journey: event isolation, invitation redemption, roles, player/prop secret filtering, all three theme changes without record loss, organizer pack import as a separate Draft, player export filtering, stale-version rejection, persistence after a fresh sign-in, and immediate access removal. Retain character approval/privacy/inventory and identity checks. Retain both players' paths through the three complete adventures, release words, hints, correct/exhausted puzzle paths, overrides, reservation limits, idempotent actions, persistence, pause/revocation, and rehearsal-copy/reset isolation. Retain empty-offer introductions, selected bilateral copies, titles-only before both confirmations, changed offers/policies, rejection/cancellation/expiry, same-request replay, canonical-origin deduplication, receipt/contact/journal persistence, and exchange-aware rehearsal reset. For Batch 6 also pass different private rumor accounts, hidden-truth filtering, confirmed rumor QR transfer, citation/link visibility, manager exclusion from private theories, all four audiences and current affiliation/group revocation, proposal review, separate draft/live publication, correction/withdrawal, and remapped/reset rehearsal story state. Cleanup archives disposable events and logs out sessions. This is HTTP workflow verification; it does not replace browser/device or human field testing.
5. Review the migration and recovery position before production schema changes. Migration 007 adds story/investigation storage and a receipt lookup index while preserving existing accounts, credentials, events, setup, characters, inventories, memberships, invitations, adventure histories, sharing policies, completed exchanges, copy provenance, receipts, and contacts. No live database backup or scheduled backup is currently available through the configured platform; record this unresolved limitation. Event-pack exports do not protect account or membership data. Prefer a verified protected database checkpoint when backup capability is available, and use the schema-7 roll-forward procedure below.
6. Advance the `production` branch to the exact checked source commit. Verify Railway deployment success, readiness, the deployment commit, public assets, and the session endpoint at the canonical production origin. The automated `production-smoke` job waits up to five minutes for the exact promoted commit and checks only public GET routes. It creates no production users or events.
7. Record the release commit, app version, migration version, deployment ID, successful CI/staging checks, and remaining operational limitations in [STATUS.md](STATUS.md).

To exercise the authenticated staging gate manually, set `EXPECTED_COMMIT` to the full 40-character candidate SHA and run `node scripts/staging-check.js`. It permits account/event mutations only at the hard-coded staging origin. Do not alter the allowlist to run disposable-account checks against production. The ordinary `SMOKE_ORIGIN='https://oracle.greenshoegarage.com' npm run smoke` is the public production check.

Railway's deployment health check gates traffic switching; it is not continuous uptime monitoring. See [Health checks](https://docs.railway.com/deployments/healthchecks), [Pre-deploy commands](https://docs.railway.com/deployments/pre-deploy-command), and [GitHub autodeploys](https://docs.railway.com/deployments/github-autodeploys).

## Backups

Scheduled production backups are **not configured**. Railway's returned effective limits for this HOBBY workspace report `maxBackupsCount: 0`. No paid plan change or external backup service has been configured. The PostgreSQL `pg_dump`/`pg_restore` rehearsal passed in GitHub CI on disposable test data; it verifies the recovery tooling and does not protect live production data.

Before relying on ORACLE for event data, enable and verify scheduled volume backups on a plan that supports them, or configure a scheduled external backup runner with protected credentials and durable storage. Verify retention and a real restore. Scheduled backups remain an outstanding Batch 1 operational requirement until configured and verified.

For a portable logical backup, use PostgreSQL client tools matching or newer than the server major version. Set `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, and `PGDATABASE` in the backup runner's protected environment. Keep backups outside the app container and out of Git.

```bash
umask 077
pg_dump --format=custom --no-owner --no-acl --file=oracle-backup.dump
pg_restore --list oracle-backup.dump
```

An archive listing checks readability; it is not a restoration test. Rehearse a full restore into a newly created, isolated database and compare the important records. Use `scripts/recovery-rehearsal.js` with fresh `oracle_test*` source/target databases to exercise the process automatically. The script refuses to overwrite an existing target database. For GitHub CI, it uses the PostgreSQL service container's matching client tools.

ORACLE's production Node image does not contain PostgreSQL client utilities. Run backup tooling from a dedicated runner/container that can reach the database, or use the platform backup controls. Never enable a public backup download route.

## Application rollback and database recovery

Migration 007 adds `story_groups`, `story_entries`, `story_readings`, `story_requests`, `story_activity`, `trace_records`, and `trace_requests`, plus an index supporting account/character receipt lookup. Story reading uniqueness includes the collecting account, character, entry, and publication version. Migrations 001–006 remain unchanged. Existing accounts, credentials, event setup, characters, inventories, adventure definitions, runs, journals, requests, attendance, invitations, audit history, policies, exchanges, provenance, receipts, and contacts are retained. Existing events receive no new story content or investigations during migration. Migration checksums and transactions remain enforced; no destructive down migration is provided.

**After schema 7 is applied, the schema-6 v0.5.0 application is not a compatible rollback image.** Earlier releases are also incompatible. Do not deploy an older binary against this database, bypass readiness, or drop story/investigation tables to force startup. Preserve data and roll forward with a tested schema-7-compatible fix. Subsequent app-only rollbacks require verified compatibility with the current schema and stored formats. A database restore remains a separate incident decision.

An application deploy also updates the versioned public service-worker cache. Network-first loading fetches current assets; offline devices keep their previously loaded shell until they reconnect. Verify `/sw.js` and every allowlisted public module/CSS asset on the exact release, as well as the database-backed API. No API, secret definition, or user credential should enter the static cache.

If incident recovery requires restoring a database: pause writes, take a current checkpoint where possible, restore a known verified backup into a separate target, inspect records and schema, verify a compatible application, switch the intended connection, and check authenticated workflows. A restore can discard changes since the backup and requires an explicit incident decision. No verified live production backup is currently recorded, so database restoration is not an available recovery promise for this deployment.

Official references: [Environments](https://docs.railway.com/environments), [PostgreSQL](https://docs.railway.com/databases/postgresql), [Backups](https://docs.railway.com/volumes/backups), [Deployment actions](https://docs.railway.com/deployments/deployment-actions).
