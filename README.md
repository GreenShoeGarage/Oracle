# ORACLE

**LARP Field Kit** · v0.3.0 · Green Shoe Garage

ORACLE is a modular web application for Live Action Roleplaying events. Organizers build a themed event, prepare player briefings and private notes, invite participants, and manage the event through rehearsal and play. Players create or receive characters, carry private sheets and inventory, and scan approved public character badges. A prop display presents selected briefing material on a shared screen.

[Open ORACLE](https://oracle.greenshoegarage.com) · [Source repository](https://github.com/GreenShoeGarage/Oracle) · [Staging app](https://oracle-production-488d.up.railway.app)

Batch 3 (v0.3.0, database schema 4) is live. GitHub checks, the complete remote two-player workflow, Railway deployment, and exact-commit production smoke passed. See [docs/STATUS.md](docs/STATUS.md) for release evidence. Scheduled database backups remain outstanding because the Railway workspace reports zero managed-backup capacity.

## What works in this release

- Accounts, private event membership, expiring invitation codes, roles, lifecycle controls, and activity logs.
- Guided character creation with portraits, pronouns, biographies, event factions, attributes, skills, starting equipment, and private objectives.
- Organizer approval/change requests, prewritten character assignment, per-player limits, and controlled public identity fields.
- Initial inventory created once on approval, with later additions and quantity changes managed by organizers.
- Printable QR badges, camera/photo/manual-code lookup, badge rotation, and retirement.
- Cross-event character copies with a fresh identity, destination rules, and reset gameplay data.
- Project administration for an operator-provisioned superuser: all-event access, account search, disable/enable, session revocation, and project audit history.
- A four-step event builder: **World → Event → Material & rules → Review**.
- Fantasy, Cyberpunk, and Wasteland themes with colors, fonts, icons, textures, terminology, and optional sound cues.
- A blank event and three starter briefings: **The Lantern Council**, **The Missing Signal**, and **The Last Water Stop**. These provide a starting scene and organizer preparation notes; complete adventures arrive later.
- Authored material with player or organizer visibility, plus a separate flag for inclusion in prop display.
- Organizer workspace, player preview, player reading view, and fullscreen prop display.
- Bounded rules definitions for attributes, expertise, resources, and named outcomes.
- Versioned JSON event packs: private organizer backups and player material with organizer-only content removed.
- Dark and outdoor reading settings, reduced motion, collapsible navigation, and clear manual-save status.

**Briefing** is the available optional instrument. All twelve planned gameplay instruments remain unavailable. Badge scanning identifies an approved character; selected information exchanges arrive in Batch 5. Automated challenges, trading, shared resource balances, and offline synchronization remain later batches. Event rules supply character attributes and available skills; they do not execute scripts or automatically resolve challenges.

## Stack and project layout

Node.js 22 (22.9 or newer) or 24, a small native HTTP server, PostgreSQL, and plain HTML/CSS/JavaScript. The only server production package is `pg`. QR generation and decoding use locally vendored browser libraries with their licenses in `public/vendor/`; no QR service or CDN is used. There is no front-end compilation step and no third-party behavioral analytics.

| Path | Purpose |
| --- | --- |
| `src/app.js` | Authenticated API, authorization, static asset delivery |
| `src/security.js` | Password hashing, tokens, cookies, rate limits |
| `src/characters.js`, `public/characters-model.js` | Event character API, validation, and public/private projections |
| `src/admin.js`, `public/admin-ui.js` | Operator provisioning and project administration |
| `public/characters-ui.js`, `public/qr.js` | Character workflow, portraits, printable badges, and local scanning |
| `src/db.js` | Database pool, transactions, checked migrations |
| `src/server.js` | Startup, readiness, graceful shutdown |
| `public/app.js` | Account, membership, and event interface |
| `public/builder.js`, `public/themes.css` | Guided setup, audience views, and theme presentation |
| `public/kit.js` | Shared browser/server theme, setup, and event-pack validation |
| `migrations/` | Ordered, immutable PostgreSQL migrations |
| `scripts/` | Checks, migration, smoke, and recovery tools |
| `test/` | Database-backed authorization and persistence tests |
| `.github/workflows/ci.yml` | PostgreSQL 18, recovery, Docker, exact-commit staging workflow, and read-only production checks |
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

Open `http://localhost:3000`. Create your own account and first event. No default administrator password or seeded user is created. Event creators become that event's owner. Ordinary registration cannot grant project administration; optional operator provisioning is documented below.

## Build and run an event

1. Create an account, then choose **Create event**.
2. In **World**, select a theme and starter template. Optional theme audio plays only when someone taps its cue button.
3. In **Event**, enter the name, public briefing, location, and optional start time. These details are visible to every event member, including prop viewers.
4. In **Material & rules**, add briefing entries, choose who can read each one, and mark player entries to include in prop display. Expand **Edit rules profile** to define starting ranges and named expertise/outcomes. Disable Briefing if you do not want its entries displayed; authored records remain saved.
5. In **Review**, inspect the player material and select **Create event**. The new event starts in Draft. Later, use **Edit field kit** and **Save field kit** to update it.
6. Switch to **Player preview** or **Prop display** to inspect the appropriate material. **Change theme** preserves the event's rules, authored records, membership, and progress.
7. Open **Invite people**. Player codes can admit a group; Staff and Organizer codes admit one person. Copy the code while displayed—ORACLE stores its hash and cannot redisplay it. You deliver the code; ORACLE sends no email invitations.
8. Players create an account, choose **Join an event**, and enter the invitation code. Spaces and hyphens are accepted. They can read permitted material and download the player pack.
9. Use **People** to manage members. Start rehearsal, go live, pause/resume, end, and archive as appropriate. Ending closes enrollment; archiving freezes event edits. Ending and archiving require confirmation.

**Saving:** The setup form saves when you select **Create event** or **Save field kit** on the Review step. It shows unsaved, saving, or confirmed status. Unsaved form work lives in the current browser page, not a durable offline draft. Canceling with edits asks before discarding them. A failed request keeps the open draft available to retry. Changes need connectivity; refresh to see another organizer's edits. A stale save returns a conflict instead of overwriting a newer event version.

**Reading settings:** Select Dark or Outdoor, follow the device's motion preference or reduce motion, and collapse navigation for more reading space. These preferences persist in this browser. Event content is stored on the server; there is no telemetry or behavioral analytics.

**Shared prop devices:** Player and prop previews exclude organizer-only entries, but previewing does not lower a signed-in organizer's account permissions. Use a separate player account on an unattended device. Prop display is a reading view, not a locked kiosk or a new authorization role. Fullscreen depends on browser support.

## Create and use characters

1. Join or open an event and select **Characters**. Organizers can expand **Character settings & factions** to enable player creation, require approval, choose 1–10 active characters per player, set public fields, and create event factions. Defaults allow player creation, require approval, and permit one active character per player.
2. Select **Create character** and follow **Identity → Abilities → Kit & goals → Review**. Add an optional portrait, pronouns, biography, and faction; choose attributes and skills allowed by this event; then add private objectives and proposed starting equipment. JPEG, PNG, and WebP uploads up to 8 MB are resized locally for storage.
3. Use **Save draft** or **Save character** to persist the sheet. Open it and choose **Submit for approval**. If approval is disabled, choose **Activate character**. Saving an edited approved character returns it to Draft, so its public badge stays unavailable until it is approved or activated again.
4. An organizer opens a submitted sheet and chooses **Approve character** or **Request changes**. A change request includes private feedback. The first approval creates the starting inventory once. Reapproval does not duplicate or refill items; organizers use the separate Inventory controls for later changes.
5. To prepare a prewritten character, an organizer chooses **Unassigned · prewritten character** under Assign to. Use **Assign character** later to give its complete private sheet to a current event member. Assignment obeys the destination player's active-character limit and removes the former assignee's private access immediately.
6. Open an approved character and choose **Public badge & QR** to inspect the permitted identity, copy its link, or print a badge. **Scan a badge** accepts a camera scan, a QR photo, the printed code, or a badge link from this ORACLE site. Readers must sign in and belong to the same event. A badge grants no editing, inventory, or organizer privileges.

Character name is always shared after approval. The organizer may also allow portrait, pronouns, biography, faction, and skills. Private objectives, attributes, equipment, inventory, review notes, and account details are excluded from public cards. The complete sheet is visible to its assigned player, event managers, and project superusers.

Camera access starts only after **Start camera** and the browser's permission prompt. It stops after a successful scan, Stop camera, closing the scanner, or hiding/leaving the page. Camera frames and QR photos are decoded locally; only the extracted badge identifier is sent for an authorized lookup. If camera access is denied, enter the code or choose a QR image instead. Portraits are different: the resized portrait is saved with the character.

**Copy to another event** creates a new Draft assigned to you. Name, portrait, pronouns, and biography carry over; only skills present in the destination rules remain. Attributes use destination defaults. Faction, private objectives, starting equipment, inventory, approval, and event progress are reset, with new character and badge identifiers. The destination's creation policy, membership, and character limit apply.

Retiring a character makes it read-only and invalidates its badge. Replacing a badge code invalidates the previous printed QR/link immediately. Archived event data remains readable under its normal permissions, while edits are blocked.

## Project administration

An operator-provisioned project superuser can open **Project administration** to search accounts, disable or re-enable access, sign out sessions, and review project activity. **All events** provides event management across the project. Disabling an account revokes its sessions and prevents sign-in while retaining its data; re-enabling preserves its password. The interface cannot disable superusers, change passwords, or grant new superuser roles.

Provisioning uses protected deployment settings, never an email address embedded in the repository. An already-existing account selected by the operator is promoted during `npm run migrate` without replacing its identity or password. If that reserved account does not exist, first registration requires an operator-held setup secret as well as normal account details. Knowing the reserved email alone cannot claim the role. See [deployment provisioning instructions](docs/DEPLOYMENT.md#project-superuser-provisioning).

## Export, reuse, and customize

**Export organizer backup** downloads event setup and all authored material, including private organizer notes. Keep that file private. **Export player material** removes organizer-only entries on the server. A player pack still contains public event details, the theme, and rules definitions; put secrets only in entries marked **Organizer only**.

From the event list, choose **Import an event pack**, select the JSON file, inspect its validation preview, and select **Create from pack**. Import always creates a new Draft owned by the importing account. It keeps the pack's theme, rules, and content identifiers but creates a new event identity and fresh owner membership. Existing events remain intact. Memberships, account information, invitation codes, activity history, and live event state are never exported or imported.

An organizer pack is a reusable content backup, **not a database backup**. Format 1 contains event setup and briefing material; it does not include characters, factions, character settings, inventories, participants, or event history. Use the separate character-copy workflow to reuse a character identity. A player pack can also seed a new event, but cannot recover omitted private material.

Custom themes can be supplied inside a validated event pack. They may contain approved color, font, texture, icon, terminology, and sound choices; arbitrary CSS, markup, scripts, formulas, and external asset URLs are rejected. There is no custom theme editor in this release. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#event-pack-format) for the exact format and a valid example.

## Permissions

| Action | Owner | Organizer | Staff | Player |
| --- | --- | --- | --- | --- |
| Read player material and own event roster | Yes | Yes | Yes | Yes |
| Read organizer-only material | Yes | Yes | No | No |
| Edit event, theme, setup / change lifecycle | Yes | Yes | No | No |
| Export organizer backup | Yes | Yes | No | No |
| Export player material / view prop material | Yes | Yes | Yes | Yes |
| Invite players or staff | Yes | Yes | No | No |
| Invite organizers | Yes | No | No | No |
| Change membership roles | Yes | No | No | No |
| Remove players or staff | Yes | Yes | Self only | Self only |
| Remove an organizer | Yes | Self only | No | No |
| Review invitation list/activity | Yes | Yes | No | No |
| Remove or demote the owner | No | No | No | No |

The table describes event membership roles. A project superuser has an explicit server-checked project role with access across events and management authority. Ordinary membership and badge possession cannot grant that role. Event access is enforced on every server request. A remembered event URL or an old session does not preserve access after membership removal. Accounts keep their email private; the event roster contains display names and roles. Reusable Player codes grant no higher role. Privileged codes are single-use, and role changes revoke any outstanding invitations issued by the changed member.

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
| `BOOTSTRAP_SUPERUSER_EMAIL` | Optional operator-selected reserved account; protected deployment configuration only |
| `BOOTSTRAP_SUPERUSER_SETUP_TOKEN` | Optional 32–512-character operator secret, required only to claim a reserved account that does not already exist |

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

The suite resets that database's `public` schema. Never point it at an event database. The GitHub workflow provisions PostgreSQL 18 for this gate, rehearses `pg_dump`/`pg_restore` into a new database with content and identity-sequence comparisons, checks startup and shutdown, and builds and runs the production Docker image with secure session settings.

For a deployed service:

```bash
SMOKE_ORIGIN='https://your-oracle-host.example' npm run smoke
```

The smoke command checks the expected application/schema versions, session API, and public assets without creating users or changing event data.

For the configured disposable staging environment:

```bash
EXPECTED_COMMIT='<full-40-character-release-commit>' node scripts/staging-check.js
```

This script waits for the expected deployment commit, app version, and schema. It then creates disposable staging accounts/events to exercise event isolation, invitation redemption, role restrictions, player/prop secret filtering, all three theme switches, pack round trips, stale saves, fresh-session persistence, and immediate access removal. Batch 3 extends the journey through two approved characters, faction/field settings, badge privacy and rotation, inventory initialization/reapproval, prewritten assignment, malformed-write rejection, and cross-event copies. Cleanup archives test events and logs out test sessions. Mutations are restricted to the allowlisted staging origin. The `staging-smoke` GitHub job runs this after `verify` and uses `GITHUB_SHA` as the required deployed commit. After promotion, `production-smoke` waits for that same commit at the canonical production domain and runs public GET checks without creating users or events.

## Railway deployment and recovery

Follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Staging and production use separate Railway projects, PostgreSQL databases, and volumes. The `main` branch is for integration, `staging` deploys the test environment, and Railway production follows the dedicated `production` release branch. Future promotions require a successful CI run and the staging checks described in the release guide. Scheduled backups are not configured: the workspace currently reports zero managed-backup capacity. The passed CI restore rehearsal verifies recovery tooling, but does not back up live event data.

## Troubleshooting

- **Startup reports CONFIG_OR_SCHEMA_ERROR:** Check required environment values and run `npm run migrate` using the same database as the application.
- **Ready endpoint returns 503:** PostgreSQL or the expected schema is unavailable. Inspect operational logs and database state; do not bypass readiness.
- **Sign-in does not persist after deployment:** Use HTTPS and make `APP_ORIGIN` match the address in the browser. Production cookies require HTTPS.
- **Write request is rejected:** Use the canonical origin. An alternate hostname or incorrect `APP_ORIGIN` fails the Origin check.
- **Invitation fails:** Check its expiry, remaining uses, revocation, issuer role, and whether the event has ended. Staff/Organizer codes work once.
- **Edit conflict:** Preserve any unsaved text you need, refresh the event, review the latest details, and reapply your change.
- **Pack import is rejected:** Use event-pack format version 1. Review the validation message for unsupported fields, invalid rules, theme contrast, duplicate identifiers, or oversized content.
- **A badge is unavailable:** Sign in to the correct event. Only approved characters resolve; an edit, retirement, removed membership, or replaced code may invalidate an old badge.
- **A character cannot be created or assigned:** Check that player creation is enabled and the current event member has room under the active-character limit.
- **Inventory did not refill after reapproval:** This is expected. Starting equipment initializes once; an organizer must change current inventory separately.
- **Material is missing:** Check that Briefing is enabled, the entry is visible to players, and—if viewing a prop—it is marked for prop display. Refresh after saving.
- **Theme changed but outdoor colors stayed light:** Outdoor is a local readability override. Choose Dark under Reading settings to see the theme palette.
- **Too many attempts:** Authentication and join requests are rate limited. Wait for the stated interval.
- **An organizer cannot promote someone:** Only the owner can change roles or invite another organizer.

App logs include request identifiers and error categories. Do not add passwords, session tokens, invitation codes, database URLs, or private briefings to logs.
