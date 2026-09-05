# ORACLE deployment and recovery

GitHub source control and Railway application/PostgreSQL hosting. Recorded September 5, 2026. Configure each service before its first source-backed deployment.

## Current infrastructure

Source: [GreenShoeGarage/Oracle](https://github.com/GreenShoeGarage/Oracle). Runtime release commit: `b159c88a3f98c9a6d14e488449ac089c4b7001c4` (v0.1.0, schema version 1).

Production deployment `83b762b8-47dc-47b8-80aa-8ad2e04eee45` succeeded from the `production` branch at that exact commit.

| Target | Railway project | Project ID | Application URL | Status |
| --- | --- | --- | --- | --- |
| Staging | ORACLE Staging | `4e75d5ec-f8e9-492d-ae75-e0d44428d24a` | [Staging app](https://oracle-production-488d.up.railway.app) | Deployed; public readiness and asset checks passed; authenticated walkthrough incomplete |
| Production | ORACLE | `d1989864-9a40-4176-a9d3-203a06c4bd72` | [Production app](https://oracle.greenshoegarage.com) | v0.1.0 live; HTTPS readiness and session API verified |

Each project uses its own default Railway environment named `production`. These are separate environments in separate projects: staging has `APP_ENV=staging`, while production has `APP_ENV=production`. The environment IDs are `ae381b6c-578f-4e25-a71c-094124ca2105` for staging and `c31cbf3b-caa0-4c09-ae75-741daa6bcd85` for production.

Each has a separate PostgreSQL 18 service and persistent volume, using Railway's PostgreSQL template with `/var/lib/postgresql/data` mounted as required by that image. Application `DATABASE_URL` references resolve to the Postgres service in the same project and environment. Credentials and event data are isolated.

The canonical production origin is `https://oracle.greenshoegarage.com`, explicitly set in `APP_ORIGIN`. The generated [Railway production domain](https://oracle-production-77f2.up.railway.app) also serves health checks, but cookie-authenticated mutations require the canonical origin. Use the custom domain for normal application access.

## Repository and release branches

The owner-created repository is public and contains the source at its root. Its existing license and Git attributes have been preserved. Keep secrets out of Git.

Use `main` for integration and `staging` for the staging application. The supplied workflow runs for pushes to both branches and for pull requests. Railway production follows the dedicated `production` release branch, currently at runtime commit `b159c88a3f98c9a6d14e488449ac089c4b7001c4`. Advance that branch only after checking CI and staging for the exact candidate commit. This is a manual promotion procedure: Railway's Wait for CI was unavailable through the connector and `checkSuites` remains false. No automatic branch protection is claimed.

The initial release passed CI and deployed public health/session checks. The additional two-account walkthrough against remote staging was interrupted before a complete result, so it remains an open acceptance check. The equivalent authorization and persistence tests passed in CI; these results are recorded separately.

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

## Release gate

1. Run `npm ci` and `npm run verify` on the release commit.
2. Pass the GitHub job against PostgreSQL 18, including the concurrent credential/session test, backup/restore rehearsal, and checks of the running production Docker image.
3. Deploy staging with its isolated database. Check logs, exact version, and `/health/ready`.
4. Use two disposable accounts and events to verify sign-in, ownership, invitation redemption, role enforcement, persistence after refresh, and removal of access.
5. Take a database backup before schema changes and verify recovery prerequisites.
6. Advance the `production` branch to that checked source commit. Verify deployment success, readiness, public assets, and authenticated access at the canonical production origin.
7. Record the release commit, app version, migration version, deployment ID, and known limitations.

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

Retain the last known good image and compatible configuration. An application rollback does not reverse database changes. This release expects schema version 1; an older application must not be pointed at a newer unsupported schema simply by disabling readiness checks.

Prefer additive migrations in future batches. Before release, verify that the intended rollback image can safely use the migrated schema. If it cannot, write an explicit recovery plan and verify it on staging first.

For database recovery: pause writes, take a current checkpoint where possible, restore into an isolated target, inspect data and schema, verify the compatible application, switch the intended application connection, and verify authenticated journeys. A restore may discard changes since the chosen backup; it is an explicit incident decision, never an automatic companion to application rollback.

Official references: [Environments](https://docs.railway.com/environments), [PostgreSQL](https://docs.railway.com/databases/postgresql), [Backups](https://docs.railway.com/volumes/backups), [Deployment actions](https://docs.railway.com/deployments/deployment-actions).
