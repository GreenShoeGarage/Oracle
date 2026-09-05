# ORACLE deployment and recovery

Target: GitHub source control and Railway application/PostgreSQL hosting. Configure each real service before its first source-backed deployment. Never deploy a placeholder image to satisfy a setup step.

## Current infrastructure

- Railway project: ORACLE
- Project ID: `d1989864-9a40-4176-a9d3-203a06c4bd72`
- Production environment ID: `c31cbf3b-caa0-4c09-ae75-741daa6bcd85`
- Current state: Empty project; no application, database, domain, or staging deployment is live.
- GitHub repository: https://github.com/GreenShoeGarage/Oracle (created by the owner; source upload and verification in progress).

No failed application deployment was started. Exploratory staged infrastructure was discarded before deployment because it did not meet the requested configuration.

## Repository and release branches

Create a private repository named `ORACLE` in the selected GitHub account or organization and grant both the connected GitHub application and Railway access to it. Upload this repository's contents at the repository root. Keep secrets out of Git.

Use `staging` for staging and `main` for production. The supplied workflow runs for pushes to both and for pull requests. Set the required `verify` status check on protected release branches if the account supports branch protection. Enable Railway's Wait for CI where the integration offers it. If the feature cannot be enabled, disable automatic production deployment and explicitly deploy only the checked commit.

Do not assume that a successful push proves deployment success. Inspect the workflow for the exact commit, then the Railway deployment result and readiness endpoint.

## Configure Railway before source attachment

Create a separate staging environment, with its own PostgreSQL instance, credentials, persistent volume, app instance, and domain. Verify that staging's `DATABASE_URL` resolves to its staging database; it must not reference production data. Use the platform PostgreSQL template and confirm that its database data directory is actually on a mounted persistent volume.

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
| `DATABASE_URL` | Reference the database in this environment |
| `APP_ORIGIN` | Exact HTTPS origin for this app instance |
| `REGISTRATION_ENABLED` | `true` initially; configurable by operator |

The application binds `0.0.0.0` and honors Railway's `PORT`. Pre-deploy migrations have database access and do not depend on a mounted application filesystem. All migration files and the Node runtime are present in the final image. Configure a deployment/pre-deploy deadline using the platform controls available to your account; the SQL driver also bounds individual statements.

Railway's current documentation does not permit new services to opt into `railway.json` or `railway.toml`. This project therefore uses a Dockerfile and explicit service configuration. A future `.railway/railway.ts` must be applied through Railway's CLI; merely committing it does not configure a deployment. See the official [Infrastructure as Code documentation](https://docs.railway.com/infrastructure-as-code).

Attach the confirmed repository and correct environment branch only after database readiness, variables, migration command, and health checks are configured. If the connection workflow attaches and deploys immediately, use a source-less configured application service first and connect the source as the last step.

## Release gate

1. Run `npm ci` and `npm run verify` on the release commit.
2. Pass the GitHub job against PostgreSQL 18, including the backup/restore rehearsal and production Docker build.
3. Deploy staging with its isolated database. Check logs, exact version, and `/health/ready`.
4. Use two disposable accounts and events to verify sign-in, ownership, invitation redemption, role enforcement, persistence after refresh, and removal of access.
5. Take a database backup before schema changes and verify recovery prerequisites.
6. Promote that checked source state to production. Verify deployment success, readiness, public assets, and authenticated access.
7. Record the release commit, app version, migration version, deployment ID, and known limitations.

Railway's deployment health check gates traffic switching; it is not continuous uptime monitoring. See [Health checks](https://docs.railway.com/deployments/healthchecks), [Pre-deploy commands](https://docs.railway.com/deployments/pre-deploy-command), and [GitHub autodeploys](https://docs.railway.com/deployments/github-autodeploys).

## Backups

Enable and verify the database's available scheduled volume backups. Availability and retention depend on the actual account and service; do not assume a schedule exists because it appears in documentation. If scheduling is unavailable, use a scheduled external backup runner with protected credentials and durable storage. Scheduled backups remain an outstanding deployment gate until configured and verified.

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
