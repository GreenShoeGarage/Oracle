# ORACLE

**LARP Field Kit** · v0.1.0 · Green Shoe Garage

ORACLE is a modular web application for Live Action Roleplaying events. This first development batch provides accounts, private event workspaces, invitations, membership roles, and event lifecycle management. The longer roadmap adds themed instruments, characters, QR exchanges, and live event tools.

This is the Batch 1 foundation. Source repository: https://github.com/GreenShoeGarage/Oracle. The production deployment and PostgreSQL TCP/restore CI gate are being completed for this release. See [docs/STATUS.md](docs/STATUS.md) for the exact verification status.

## What works in this release

- Create an account, sign in, sign out, and change your password.
- Create an event with a name, briefing, location, and optional start time.
- Return to persisted events and see only events you belong to.
- Invite players, staff, or organizers using revocable, expiring codes.
- Change member roles as the owner, remove members, and leave events you do not own.
- Move an event through draft, rehearsal, live, paused, ended, and archived states.
- Review an organizer-only activity log.
- Use the responsive account and event interface on a phone, tablet, or desktop.

Staff have event-reading access in Batch 1; operational staff tools arrive later. Characters, QR scanning, all twelve instruments, theme selection, and offline synchronization are later roadmap batches. No placeholder buttons are presented for them.

## Stack and project layout

Node.js 22 (22.9 or newer) or 24, a small native HTTP server, PostgreSQL, and plain HTML/CSS/JavaScript. The only production package is `pg`. There is no front-end compilation step and no third-party behavioral analytics.

| Path | Purpose |
| --- | --- |
| `src/app.js` | Authenticated API, authorization, static asset delivery |
| `src/security.js` | Password hashing, tokens, cookies, rate limits |
| `src/db.js` | Database pool, transactions, checked migrations |
| `src/server.js` | Startup, readiness, graceful shutdown |
| `public/` | Browser interface and brand assets |
| `migrations/` | Ordered, immutable PostgreSQL migrations |
| `scripts/` | Checks, migration, smoke, and recovery tools |
| `test/` | Database-backed authorization and persistence tests |
| `.github/workflows/ci.yml` | Checks against PostgreSQL 18 and Docker image build |
| `Dockerfile` | Non-root Railway production image |
| `docs/` | Roadmap, architecture, deployment, and current status |

## Run locally

Prerequisites: Node.js 22.9+ or 24, npm, and a PostgreSQL database. Docker Compose is optional for starting a local database.

```bash
npm ci
cp .env.example .env
```

Set a local database password and start the supplied PostgreSQL 18 service:

```bash
export LOCAL_DB_PASSWORD='replace-with-a-local-only-password'
docker compose up -d postgres
```

Set `DATABASE_URL` in `.env` to your database. Percent-encode special characters in URL usernames and passwords. Do not commit `.env`. The sample credentials are local examples and must be replaced.

```bash
npm run migrate
npm run dev
```

Open `http://localhost:3000`. Create your own account and first event. No default administrator password or seeded user is created. Event creators automatically become that event's owner; signing up does not give administrative access to other events.

## Use ORACLE

1. Select **Create event**, supply its name, and optionally add a briefing, location, and start time. The event begins in Draft.
2. Open **Invite people**. Choose Player, Staff, or Organizer. Staff and Organizer codes admit one person; Player codes can admit a group.
3. Copy the code while it is displayed. ORACLE stores its hash and cannot redisplay the original. You decide how to deliver it to players; the app sends no email invitations.
4. A player creates an account, selects **Join an event**, and enters the code. Hyphens and spaces are accepted.
5. Open **People** to review membership. Only the event owner can change roles. Owners cannot be removed or demoted in this release.
6. Start rehearsal when ready. Go live, pause/resume, end, then archive. Ending and archiving require confirmation. Ending closes enrollment; archiving freezes the briefing and lifecycle.
7. **Invitation codes** lists expiry, usage, and revocation controls. **Activity log** records membership and event changes.

Changes require connectivity in v0.1.0. A successful message means the server confirmed the change. Use **Refresh** to fetch an event changed on another device. Editing stale event data returns a conflict rather than overwriting a newer change.

## Permissions

| Action | Owner | Organizer | Staff | Player |
| --- | --- | --- | --- | --- |
| Read own event and roster | Yes | Yes | Yes | Yes |
| Edit event / change lifecycle | Yes | Yes | No | No |
| Invite players or staff | Yes | Yes | No | No |
| Invite organizers | Yes | No | No | No |
| Change membership roles | Yes | No | No | No |
| Remove players or staff | Yes | Yes | Self only | Self only |
| Remove an organizer | Yes | Self only | No | No |
| Review invitation list/activity | Yes | Yes | No | No |
| Remove or demote the owner | No | No | No | No |

Event access is enforced on every server request. A remembered event URL or an old session does not preserve access after membership removal. Accounts keep their email private; the event roster contains display names and roles. Reusable Player codes grant no higher role. Privileged codes are single-use, and role changes revoke any outstanding invitations issued by the changed member.

## Environment settings

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL connection string; use Railway private references |
| `APP_ORIGIN` | Exact browser origin, without trailing slash, such as `https://your-domain.example` |
| `NODE_ENV` | `production` for deployed environments; enables HTTPS-only secure cookies |
| `PORT` | Railway-supplied listening port; local default 3000 |
| `APP_ENV` | `development`, `staging`, or `production`; staging is visibly labeled |
| `REGISTRATION_ENABLED` | Set `false` to close account registration; existing sign-in still works |
| `DATABASE_SSL` | `require` for verified external TLS, or `disable` for the intended private network connection |

When `APP_ORIGIN` is omitted, Railway's generated `RAILWAY_PUBLIC_DOMAIN` may supply the HTTPS origin. Set it explicitly for a custom domain. Use one canonical app origin; redirect aliases to it. Cookie-authenticated writes from other origins are rejected.

Sessions use random opaque tokens stored as SHA-256 hashes, with a seven-day server expiry. Passwords use salted scrypt. Password changes invalidate other sessions. Rate limiting is database-backed. There is no email password-reset workflow in this batch; protect your credentials and follow an operator-verified account recovery procedure if needed.

## Verification

```bash
npm run verify
```

Without `TEST_DATABASE_URL`, the suite uses PGlite (PostgreSQL compiled to WebAssembly). This validates SQL, API permissions, persistence, and request behavior locally. PGlite is single-connection and is not used in production; its results do not establish PostgreSQL multi-connection lock behavior.

For the production database path, use a dedicated disposable database whose name begins with `oracle_test`:

```bash
export TEST_DATABASE_URL='postgresql://oracle:local-password@localhost:5432/oracle_test'
npm run verify
```

The suite resets that database's `public` schema. Never point it at an event database. The GitHub workflow provisions PostgreSQL 18 for this gate, rehearses `pg_dump`/`pg_restore` into a new database, checks startup and shutdown, and builds the production Docker image.

For a deployed service:

```bash
SMOKE_ORIGIN='https://your-oracle-host.example' npm run smoke
```

The smoke command checks readiness, session API, and public assets without creating users or changing event data. A disposable staging event should additionally be exercised with two accounts before a production release.

## Railway deployment and recovery

Follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). It describes source attachment, separate staging and production databases, current Railway settings, CI gates, environment variables, backups, and rollback. Configure the database and migration/readiness settings before attaching a source so the first app deploy has its prerequisites.

## Troubleshooting

- **Startup reports CONFIG_OR_SCHEMA_ERROR:** Check required environment values and run `npm run migrate` using the same database as the application.
- **Ready endpoint returns 503:** PostgreSQL or the expected schema is unavailable. Inspect operational logs and database state; do not bypass readiness.
- **Sign-in does not persist after deployment:** Use HTTPS and make `APP_ORIGIN` match the address in the browser. Production cookies require HTTPS.
- **Write request is rejected:** Use the canonical origin. An alternate hostname or incorrect `APP_ORIGIN` fails the Origin check.
- **Invitation fails:** Check its expiry, remaining uses, revocation, issuer role, and whether the event has ended. Staff/Organizer codes work once.
- **Edit conflict:** Refresh the event, review the latest details, and reapply your change.
- **Too many attempts:** Authentication and join requests are rate limited. Wait for the stated interval.
- **An organizer cannot promote someone:** Only the owner can change roles or invite another organizer.

App logs include request identifiers and error categories. Do not add passwords, session tokens, invitation codes, database URLs, or private briefings to logs.
