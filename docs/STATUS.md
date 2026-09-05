# ORACLE v0.1.0 — Batch 1 status

Recorded September 5, 2026.

## Implemented

Account registration/login/logout, password changes, hashed server-side sessions, database-backed rate limiting, exact-origin write protection, private event membership, owner/organizer/staff/player roles, expiring/revocable invitations, single-use privileged invitations, lifecycle transitions, optimistic edit conflicts, activity logs, responsive browser interface, versioned checksum-checked migrations, health/readiness endpoints, production Dockerfile, GitHub CI, and deployment/recovery documentation.

Two independent source reviews found and led to fixes for: password-change/login ordering; privileged invitation reuse; shutdown exit-code verification; production-image execution in CI; and content/identity-sequence checks after recovery.

## Verification completed locally

- `npm run verify`: 23 tests total; 22 passed, 0 failed, 1 deliberately skipped because it requires independent PostgreSQL connections.
- The local integration database was PGlite (PostgreSQL compiled to WebAssembly), not a TCP PostgreSQL service.
- Tested event isolation, role restrictions, invitation authorization/revocation/limits, lifecycle validation, session expiry/logout/password changes, SQL-shaped inputs, transactional rollback, migration repeatability/checksum protection, and restored database snapshot content.
- Syntax, version alignment, and static entrypoint assets checked.
- Production dependency audit: zero reported vulnerabilities at the time of the check.

## Outstanding release gates

- Upload this source to the owner-created https://github.com/GreenShoeGarage/Oracle repository.
- Run GitHub CI against PostgreSQL 18 TCP, including the concurrent password-change test.
- Execute real `pg_dump`/`pg_restore` recovery and identity-sequence verification.
- Build and execute the production Docker image with secure-cookie settings, startup/readiness checks, and clean shutdown.
- Configure isolated staging/production databases and environments, durable backups, domain/origin, and gated source deployment.
- Exercise an actual staging event with two accounts; verify deployed version and production readiness.
- Browser/device visual QA and a human field pilot have not been performed.

The environment has no Docker daemon or PostgreSQL server tools. The corresponding checks are supplied in GitHub CI rather than claimed as completed locally.

## Infrastructure state

Railway project ORACLE was created: `d1989864-9a40-4176-a9d3-203a06c4bd72`. Its production environment is `c31cbf3b-caa0-4c09-ae75-741daa6bcd85`. It is empty, with no application deployment or live database. Exploratory staged configuration was discarded before deployment because it did not satisfy the requested setup.

The owner has created https://github.com/GreenShoeGarage/Oracle. Source upload, GitHub CI, and deployment can now proceed using the connected GitHub and Railway tools.

Batch 1 is implemented locally but has not met its staging/deployment acceptance gate. Batch 2 and later features have not been started.
