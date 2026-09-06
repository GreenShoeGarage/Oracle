# ORACLE architecture and data contracts

Application v0.5.0 candidate · Database schema 6 · Briefing-pack format 1 · Adventure format 1

**Identity and data ownership.** An account belongs to a person. Event membership grants a role within one event. Characters, inventories, and factions carry an event ID and authorize against current membership; future clues and encounters must follow the same contract. Copying content into another event creates new event-owned records. The client never decides ownership or privileges.

**Authorization.** Event reads join membership with the requested event ID. A database-backed project superuser may manage all events; this is an explicit global role rather than a forged event membership. Disabled accounts fail session authorization. Event mutations acquire the event and acting membership row locks before checking permission and writing. Invitation redemption locks the event, then its invitation, in a consistent order. Event/subresource IDs are always checked together. Owner mutation is excluded until an explicitly designed transfer workflow exists.

**Passwords and sessions.** Passwords use asynchronous scrypt with a 16-byte random salt, N=32768, r=8, p=1, and a 64-byte derived value. Sessions use 32-byte random tokens and store only token hashes. Login and password change lock the account row so credential changes and session invalidation have an explicit order. Browser writes require an exact Origin match. The deployed cookie is Secure, HttpOnly, SameSite=Lax, and host-only.

**Invitations.** Codes contain 80 bits of cryptographic randomness using a human-readable alphabet, are stored hashed, and expire within seven days. Privileged invites are single-use. The event owner and organizers may create player/staff invitations; only the owner may create an organizer invitation. Redemption checks the current issuer role. Removing/demoting an issuer revokes their outstanding invitations.

**Event lifecycle.** draft → rehearsal → live; rehearsal may return to draft; live and paused may alternate; either may end; ended may archive. Ended/archived events reject new enrollment. Archiving freezes event content. Data-access revocation remains possible to protect old event records. Event updates require the current integer version, preventing silent overwrites.

**Migrations.** SQL files are immutable once applied. The runner takes a PostgreSQL advisory lock, records file checksums, and applies each new migration transactionally. It refuses changed migration history and unsupported versions. Migration `002_event_setup.sql` adds a non-null JSONB `events.setup` column with a valid blank Fantasy setup and an object constraint. Existing event IDs, metadata, owners, lifecycle, version counters, memberships, invitation hashes, and audit records remain intact. A regression fixture created with Batch 1's schema verifies this preservation. Creating an event without `setup` remains supported and receives the same default.

Migration 003 adds default-false superuser/disabled flags and system audit history. Migration 004 adds event character settings, factions, characters, and independent inventory tables with event-scoped constraints. Earlier event setup, memberships, invitations, audit records, and credentials are retained. Migration 005 adds adventure definitions, per-character runs, journal snapshots, idempotency records, and scene attendance. Migration 006 adds sharing settings, exchange sessions, request hashes, copy provenance, receipts, and contacts without rewriting the populated schema-5 adventure tables. Startup and readiness require schema 6. Earlier applications, including v0.4.0 with schema 5, are **not valid rollback images after this upgrade**. Preserve the migrated data and roll forward with a schema-6-compatible fix. Do not remove schema checks or drop new data to make an older binary start. Database restoration is a separate operator-directed incident action described in [DEPLOYMENT.md](DEPLOYMENT.md).

**Themes, event packs and rules.** `public/kit.js` is the shared browser/server contract. Themes control presentation and terminology; setup contains the selected theme, enabled instruments, declarative rules, and authored material. A theme-only update replaces only `setup.theme`, preserving rules, content identifiers, event ownership, and progress. `templateId` records the starter used; it is not an instruction to reapply or execute a template. Available starters are Blank event, The Lantern Council, The Missing Signal, and The Last Water Stop. The latter three are briefing seeds, not complete adventures.

Themes accept six-digit hex colors, enumerated fonts (`serif`, `sans`, `mono`), textures (`none`, `grain`, `grid`, `dust`), icons (`sigil`, `chip`, `compass`), four terminology fields, and optional cues (`bell`, `pulse`, `click`). Text, muted text, and accent must each reach 4.5:1 contrast against both background and panel. Theme assets are built into the application. Arbitrary CSS, HTML, scripts, URLs, and formulas are rejected. Sound is synthesized locally after a user gesture; no remote sound asset or autoplay is used.

Rules define up to 12 attributes, 24 expertise entries, 12 resources, and 12 named outcomes. Attribute/resource minimum, maximum, and default values must be finite, between -1,000,000 and 1,000,000, and satisfy `min ≤ default ≤ max`. These are bounded definitions, not executable mechanics. Batch 3 character attributes and skills validate against these definitions. Batch 4 also evaluates bounded discovery conditions, puzzle answers, and flag outcomes. General scripting and later cooperative-challenge mechanics remain outside this contract.

**Offline contract.** All mutations, protected reveals, badge/prop lookups, and live authorization require connectivity. Unsaved forms remain in page memory. Batch 4 caches only public static assets through `public/sw.js` and explicitly projected, already-permitted journal readings through IndexedDB. No API response is stored by the service worker. `public/offline.js` excludes profiles, inventory, definition/answer data, credentials, and puzzle state. The standalone archive cannot make new discoveries or claim current authentication. It shows last-checked timestamps, supports deletion, and clears on logout/account switch or known revocation. Scope generations prevent a late request from restoring cleared data; blocked storage/purges fail closed. Offline devices cannot learn a remote revocation until reconnecting. No action queue or local event host is implemented. Exchange codes, pending offers, requests, and contacts stay out of offline storage. Completed readings and receipts enter the archive only through the ordinary authorized adventure journal projection.

**Operational boundaries.** `/health/live` reports the running process; `/health/ready` also verifies the database/schema. Neither reveals credentials or participant data. The server drains on SIGTERM and imposes request/header timeouts. Old sessions and rate-limit buckets are periodically removed. Staging and production require distinct databases, secrets and domains.


## Audience boundaries

Event authorization runs before a response is projected for its audience. Owners, organizers, and project superusers may receive organizer material. Staff and players receive only entries with `visibility: "player"`, including in event list, detail, join, pack, and preview responses. Prop projection also requires `prop: true`; marking an organizer entry for prop display cannot expose it. Preview responses omit account/membership details and declare `readOnly: true`.

Event metadata, theme terminology, and rules are shared with every event member. Private narrative belongs in content explicitly marked `organizer`. A disabled Briefing instrument hides its cards, but does not delete records or make player-visible content secret: permitted content remains in player exports. Instrument visibility is a display choice; audience permission is the access boundary.

Prop mode is a filtered reading interface, not a kiosk security boundary. Selecting a player/prop preview on an organizer account does not revoke that account's organizer permissions. Use a player account on unattended hardware. A future dedicated prop session will need its own restricted authorization design.

## Setup validation

Each object has an exact set of supported fields and a format version. Unknown/missing fields, duplicate IDs, invalid ranges, unsupported instruments, invalid calendar dates, unsupported future versions, prototype-bearing objects, accessors, and sparse lists are rejected before import or update. Nested IDs use a lowercase letter followed by lowercase letters, digits, or hyphens, with at most 48 characters. IDs are unique within each collection.

Setup is limited to 180,000 normalized UTF-8 JSON bytes. A complete event pack is limited to 200,000 bytes, reserving enough room for maximum-sized public event metadata. Raw create/update/import requests are capped at 256 KiB, while ordinary small API bodies retain smaller limits. Content is limited to 20 entries, with titles up to 120 characters and bodies up to 6,000 characters. The server independently validates every write; browser validation is for feedback.

`enabledInstruments` accepts the available `briefing`, `relic`, `dead-drop`, `cipherbox`, and `wayfinder` IDs, or an empty list. The remaining eight gameplay instruments stay unavailable. Disabling an instrument removes its live player card/action access; already-authorized journal snapshots remain readable.

## Event-pack format

The complete pack has these exact top-level keys:

| Field | Meaning |
| --- | --- |
| `format` | Exactly `oracle-event-pack` |
| `version` | Exactly `1`; independent of app/database versions |
| `audience` | `organizer` or `player` |
| `event` | Public name, description, location, and `startsAt` (ISO timestamp with timezone or null) |
| `setup` | Versioned theme, template ID, enabled instruments, rules, and authored material |

A valid minimal organizer pack:

```json
{
  "format": "oracle-event-pack",
  "version": 1,
  "audience": "organizer",
  "event": {
    "name": "An evening at the council",
    "description": "Meet at the hall at dusk.",
    "location": "Council hall",
    "startsAt": null
  },
  "setup": {
    "version": 1,
    "theme": {
      "id": "fantasy",
      "name": "Fantasy",
      "version": 1,
      "tokens": {
        "background": "#111810",
        "panel": "#1d281b",
        "text": "#f4efd9",
        "muted": "#c0c9ad",
        "accent": "#dbbd73",
        "font": "serif",
        "texture": "grain",
        "icon": "sigil"
      },
      "terms": {
        "briefing": "Field chronicle",
        "people": "Company",
        "resources": "Supplies",
        "expertise": "Lore"
      },
      "sounds": { "enabled": false, "cue": "bell" }
    },
    "templateId": "blank",
    "enabledInstruments": ["briefing"],
    "rules": {
      "version": 1,
      "attributes": [],
      "expertise": [],
      "resources": [],
      "outcomes": []
    },
    "content": [
      {
        "id": "welcome",
        "title": "Welcome, delegates",
        "body": "Introduce your delegation and a concern to discuss.",
        "visibility": "player",
        "prop": true
      }
    ]
  }
}
```

An organizer export includes organizer-only story records and requires owner/organizer membership. A player export is projected on the server; a claimed player pack containing an organizer entry is rejected. Neither format-1 briefing pack includes adventure definitions/solutions, progress, journal entries, attendance, sharing settings, exchange sessions/provenance/receipts/contacts, accounts, memberships, invitations, activity history, live lifecycle state, character settings, factions, characters, or inventories. These additions remain separate database records; use the authorized character-copy API to reuse an identity. Import preserves the pack's nested content/rule IDs while creating a new event UUID, Draft state, fresh owner membership, and `event.imported` audit entry in one transaction. Import never overwrites an existing event. The original event and its permissions remain untouched.

## Batch 2 API additions

All routes below require a signed-in account. Event routes also require current event membership. Cookie-authenticated mutations require the configured exact Origin.

| Route | Behavior |
| --- | --- |
| `GET /api/catalog` | Built-in themes, starter templates, and instrument availability |
| `POST /api/events` | Existing metadata plus optional validated `setup`; returns a new owned Draft |
| `PATCH /api/events/:id` | Owner/organizer update with current `version`; accepts full `setup` or `theme`, never both |
| `GET /api/events/:id/preview?audience=player` | Player projection with no membership controls |
| `GET /api/events/:id/preview?audience=prop` | Player entries additionally marked for prop display |
| `GET /api/events/:id/pack?audience=organizer` | Complete content pack for owners/organizers |
| `GET /api/events/:id/pack?audience=player` | Player-safe pack for any event member |
| `POST /api/events/import` | Body `{ "pack": <event-pack> }`; creates a new owned Draft |

Pack routes return the pack itself. Create/update/import return `{ "event": ... }`; previews return `{ "event": ..., "audience": ..., "readOnly": true }`. Stale versions and archived edits return 409, insufficient roles return 403, and absent/revoked event membership returns 404. Validation failure leaves event data unchanged.


## Character records and approval

`public/characters-model.js` supplies shared validation and explicit public/private projections. Profiles contain exactly `name`, `portrait`, `pronouns`, `biography`, `factionId`, `attributes`, `skills`, `privateObjectives`, and `startingEquipment`. Attributes match the event's configured IDs/ranges; skills must be unique supported expertise IDs. Factions belong to the same event. Profiles reject unknown fields and executable markup. Portraits accept bounded JPEG/PNG/WebP data images with matching signatures, at most 150,000 decoded bytes; external image URLs and SVG are rejected. The browser resizes a chosen source image before saving it.

Default event character settings allow player creation, require organizer approval, allow one active character per player, and share portrait/pronouns/faction in addition to the name. Organizers may set an active-character limit from 1 to 10, require assigned prewritten characters, disable approval, and choose public fields. Creation/assignment checks current event membership and capacity under the event lock; concurrent creation cannot exceed that limit. An event accepts at most 2,000 character records and 50 factions. Retired characters do not consume a player's active limit.

Characters move from `draft` to `pending` to `approved`, or to `changes_requested` with feedback and then resubmission. If approval is disabled, submission activates the character directly. Editing always returns an active character to Draft and clears review notes, including after approval. Only an approved character has a public badge. Retirement is terminal for that record; copying into another event can reuse its identity as a new Draft. Archived event writes are rejected.

Owners, organizers, project superusers, and the currently assigned player can read a full sheet. Other event members receive only approved public character projections. Public projection always includes the character name and only organizer-selected portrait/pronouns/biography/faction/skills. It never contains account identity, private objectives, attribute values, starting equipment, inventory, review notes, badge code, or mutation version. Assignment moves private access immediately; it does not create event membership for the assignee.

Starting equipment is authored profile data. On first approval, its up to 50 entries initialize separate inventory records in the same transaction. `inventory_initialized` prevents later profile edits or reapproval from duplicating/refilling those items. Organizers control subsequent inventory mutations, with version checks, up to 100 entries per character and quantities from 0 to 9,999. Private inventory reads require full-sheet access. Trading and shared balances are not part of this API.

Cross-event copies lock source and destination events in stable ID order, require private access to the source and current access to the destination, and apply destination creation policy/capacity. Copies retain name/portrait/pronouns/biography and only destination-supported skills. Attributes reset to destination defaults; faction, private objectives, starting equipment, inventory, approval, review notes, and progress do not transfer. The new record receives a new character UUID and badge code and is assigned to the caller. Source data is unchanged.

## Badges and local scanning

A badge code is a random 20-character identifier in an unambiguous uppercase alphabet. Its QR encodes the canonical same-origin `/#badge/<code>` link. Badge lookup requires authentication plus event membership or project superuser authority and an approved character. It returns only the public projection even for the owner. Possessing a code grants no edit, ownership, or membership capability. Rotation replaces the code; the old link immediately returns 404. Retirement and membership removal also revoke relevant lookups.

`public/qr.js` generates QR pixels with a four-module quiet zone using the locally vendored generator and decodes with the independent local decoder. Typed codes permit spacing and hyphens. Scanned URLs are parsed as data: only the exact same-origin badge form is accepted, and arbitrary scanned URLs are never navigated. Camera frames and chosen QR photos stay in the browser; only the parsed badge code reaches the API. HTTPS and browser permission are needed for camera access. No microphone is requested. The scanner releases media tracks on success, cancellation, permission-race completion after closure, page hiding, and teardown. Manual codes and image upload remain available fallbacks.

## Project superusers

Migration 003 gives existing accounts default-false `is_superuser`/`is_disabled` flags; requests cannot set them through ordinary registration bodies. The operator may set `BOOTSTRAP_SUPERUSER_EMAIL` in protected deployment configuration. `npm run migrate` then promotes that existing account by setting its superuser flag and enabling it, while preserving its UUID, password hash, memberships, and other data. Provisioning is idempotent and records an audit event only when state changes. It creates no account if the reserved address is absent. Server startup performs a read-only status lookup and logs only `accountExists`/`enabled` for the configured account; provisioning remains a migration-time operation.

Claiming an absent reserved account requires an operator-supplied `BOOTSTRAP_SUPERUSER_SETUP_TOKEN` (32–512 characters), compared through constant-time digests against registration's `setupCode`. Missing/wrong secrets cannot claim the address. Email knowledge alone, arbitrary body role flags, and ordinary event permissions cannot grant the project role. An already-existing reserved account is never replaced by registration; its existing password remains required for sign-in. Configured addresses and setup secrets must not appear in source, packs, public health data, or logs.

Project administration permits bounded/paginated account search, enable/disable, session revocation, and system audit reads. Disabling ordinary accounts also deletes their sessions. Re-enabling does not change credentials. The admin API cannot disable a superuser or grant roles/reset passwords. System audit rows record actor, target, action, and bounded details without credential material. Superuser event mutations still respect lifecycle, record version, data-validation, and protected-owner rules.

## Batch 3 API additions

Routes below require a signed-in, enabled account. Event routes check current event access; private sheets and mutations enforce the additional permissions described above. `:event`, `:character`, `:faction`, and `:item` are UUIDs checked in their parent event scope. Mutations require exact Origin and current versions except creation and cross-event copying.

| Route | Contract |
| --- | --- |
| `GET/PUT /api/events/:event/character-settings` | Read settings; manager updates require all settings fields plus `version` |
| `GET/POST /api/events/:event/factions` | Read event factions; managers create `{ name, description }` |
| `PATCH/DELETE /api/events/:event/factions/:faction` | Manager mutation with `version`; deletion rejects referenced factions |
| `GET/POST /api/events/:event/characters` | Projected list; creation `{ profile, userId? }`, where only managers may choose an assignee or null |
| `GET/PATCH /api/events/:event/characters/:character` | Projected read; assigned player/manager update `{ version, profile }` |
| `POST .../:character/submit` | `{ version }`; submit Draft/change request for approval or activate under event settings |
| `POST .../:character/review` | Manager `{ version, decision: "approve" or "request_changes", feedback }` |
| `POST .../:character/assign` | Manager `{ version, userId: UUID or null }` |
| `POST .../:character/retire` and `POST .../:character/badge` | Assigned player/manager `{ version }`; retire record or rotate lookup code |
| `POST .../:character/copy` | `{ targetEventId }`; return new Draft plus reset warnings |
| `GET/POST .../:character/inventory` | Private read; manager creates `{ name, quantity, notes }` |
| `PATCH/DELETE .../:character/inventory/:item` | Manager mutation with item's `version` |
| `GET /api/badges/:code` | Approved public identity plus public event name/theme; no mutation rights |
| `GET /api/admin/users` | Superuser-only account search: `q`, `page`, `limit` (maximum 100) |
| `GET /api/admin/audit` | Superuser-only paginated system audit |
| `PATCH /api/admin/users/:user` | Superuser `{ disabled: boolean }` only |
| `DELETE /api/admin/users/:user/sessions` | Superuser target-session revocation |

Creation/copy returns HTTP 201; other successful character operations return 200. Invalid input returns 400, unauthenticated access 401, insufficient mutation authority 403, unavailable private/foreign records or badges 404, and stale/archived/capacity conflicts 409. Character/settings/item versions increment only on successful mutations. Private read responses may include separate inventory data; public responses never inherit fields from private serialization.


## Adventure data and access

`src/adventure-templates.js` is server-only and contains the three complete stories, solutions, release words, and two prewritten profiles per template. `GET /api/adventure-templates` returns only title/summary/player-count/duration metadata. Public static routing never serves that module. Templates create fresh Draft events, approved unassigned characters, initial inventory, and new cryptographic prop codes.

`public/adventure-model.js` defines adventure format 1: `{ formatVersion, title, summary, organizerNotes, flags, nodes }`. It accepts up to 50 instruments and 30 flags, within 2,000,000 normalized JSON bytes. Common node fields are `{ id, type, title, summary, code, conditions, actions }`, plus exact type fields. Unknown fields, invalid own-data descriptors, unsupported types/references, duplicate codes/IDs, and cyclic completed-node dependencies are rejected. `dead_drop` is the node type; `dead-drop` is the setup instrument ID.

Conditions require every selected completed node, character skill, and flag. A nonempty `statuses` list matches any listed **event lifecycle status**. Outcomes set declared flags once. RELIC allows 1–8 separately authorized examinations; DEAD DROP holds protected text, optional release phrase, and optional validated MPEG/Ogg/WAV data audio; CIPHERBOX holds an answer, matching mode, 1–20 attempts, up to five threshold-gated hints, and success/failure readings; WAYFINDER holds scene instructions, location, duration, capacity, and optional dated availability. Audio totals at most 1,000,000 decoded bytes per adventure, with allowed MIME signatures and no external URLs.

Players act only as their assigned approved character in Live or Rehearsal. Current membership, account status, enabled instruments, conditions, and record versions are checked on the server. Managers preview approved characters read-only and use separate audited overrides to release/solve/reset attempts. An unapproved character may read its prior journal but receives no newly unlocked instrument content. Public projections omit solutions, release phrases, organizer notes, conditions/actions/flags, unrevealed examination text, and unrequested hint text. Node titles and summaries are public introductions and must not contain secrets. Organizer-only policy removes even the title from new nonpreview node/lookup projections and blocks actions/overrides/replays; it does not retract historical journal snapshots.

Actions acquire the event lock before fresh membership/assignment checks. Each action has a UUID request ID, definition version, character/node IDs, and a supported kind. The server hashes its payload: same ID/same payload returns the original outcome with a fresh authorized snapshot; changed payload returns 409. Completion flags and unique journal entry keys prevent double effects even with a new request ID. Puzzle attempts have a one-second cooldown; exhausted attempts set the failure outcome. Resetting failed attempts preserves previous readings and flags. Journal rows are immutable snapshots of what was actually revealed.

WAYFINDER joining checks open/start/end state and current eligible attendance under the event lock. Ineligible retired/draft/unassigned/disabled or removed-member reservations do not consume live capacity. Minimum players is a gathering guide, maximum capacity is enforced. Joining records a reservation and authored outcome once; leaving/rejoining does not duplicate it. A reservation is not proof that an in-person scene took place.

Definition editing requires Draft/Rehearsal with no run records. A dedicated rehearsal copy uses a new event, fresh codes and character IDs, remapped factions, approved unassigned characters, and initial equipment only. Sources with more than 100 profiles are rejected. Copies carry independently reset sharing policies, but no memberships, invitations, progress, requests, journal, attendance, exchanges, receipts, or contacts. Reset requires that copy's Rehearsal status, current version, and explicit confirmation; it deletes exchange requests, contacts, receipts, copy provenance, and sessions before journal/gameplay tables, preserves policies, and advances the definition version. Original event records, definition, and characters are preserved. Both event factories enforce a current enabled account and bounded creation rate.

## Adventure routes and prop identity

| Route | Contract |
| --- | --- |
| `GET /api/adventure-templates` | Authenticated safe catalog |
| `POST /api/adventure-templates/:theme` | Optional `{ name }`; create full Draft template, return `{ event }` |
| `GET/PUT /api/events/:event/adventure/manage` | Manager definition/progress; save `{ version, definition }` |
| `GET .../adventure/play?characterId=UUID` | Authorized player snapshot; manager-only `preview=true` is read-only |
| `GET .../adventure/lookup?characterId=UUID&code=CODE` | Same snapshot plus focused unlocked node |
| `POST .../adventure/action` | `{ requestId, version, characterId, nodeId, kind, ...kindFields }` |
| `POST .../adventure/override` | Manager `release`, `solve`, or `reset_attempts` with the same common IDs/version |
| `POST .../adventure/rehearsal` | `{}` creates isolated copy and returns `{ event }` |
| `POST .../adventure/reset` | `{ version, confirm: true }` resets a dedicated copy |

Player kinds are `examine` (`examId`, printed `code`), `open` (optional release `code`), `attempt` (`answer`), `hint` (`hintIndex`), `join`, and `leave`. Responses include the fresh safe play snapshot and `{ outcome: { kind, message, replayed } }`. No client-supplied success, profile, or flag value is trusted. Requests are bounded to 5,000 per character/adventure; definition requests use a separate size cap.

Prop QR links use same-origin `/#prop/EVENT_UUID/CODE20`, distinct from character badge links. Scans are parsed as data and never navigate arbitrary URLs. Label printing includes only event name, node title/type, and code/QR. Single-prop view keeps the current character's authorization and offers fullscreen; it does not grant anonymous access or lock an organizer session. Browser camera consent and teardown follow the existing QR scanner contract.

The IndexedDB archive keeps at most 30 event/character journal snapshots, each at most 3 MB. Cached scene data is only a journal reading previously recorded on joining; it does not assert current availability. Preview responses are not cached. Static caching is an exact same-origin GET allowlist, using network-first responses and offline fallback, with no API/range/auth-header/query caching. Failed asset writes do not break the live application.

## Sharing and exchanges

`src/sharing.js` stores policy separately from adventure format 1. Absent, unknown, or inherited policy keys resolve to `restricted`; only new complete starter factories seed RELIC/DEAD DROP as `shareable`. `restricted` permits personal discovery but no exchange. `organizer_only` also blocks new player nodes, prop lookups, actions, and organizer overrides. Read-only manager previews remain permitted; previously authorized journals remain historical snapshots. Sharing PUT is manager-only, event-locked, versioned, and available in every nonarchived lifecycle state. Omitted nodes default to restricted. Every save advances the settings version; an effective policy change advances active exchange versions and clears both confirmations atomically.

Migration 006 adds six event-scoped tables:

| Table | Purpose |
| --- | --- |
| `event_sharing_settings` | Versioned per-node policies |
| `exchange_sessions` | Bound participant users/characters, offers, confirmations, status, fixed deadline |
| `exchange_requests` | Actor-scoped request UUID and canonical payload hash |
| `exchange_copies` | Recipient, copied journal row, canonical original, sender, and exchange provenance |
| `exchange_receipts` | Immutable completed outcome for each participant |
| `exchange_contacts` | Bilateral introductions scoped to the owning account and character |

Both participants must be different enabled accounts with current event access and their own assigned approved character; managers and superusers cannot proxy another character. Create/join/offer/confirm require Live or Rehearsal. Mutations lock event, exchange, then participant users in stable ID order before refreshing eligibility. Pending sessions expire at a fixed server deadline 15 minutes after creation, using a fresh database clock after waits. Codes have 12 cryptographically random uppercase characters (60 bits), and accept one recipient. Bounds include five active sessions per user/event, 40 creations per hour, ten unique readings per offer, and 2 MB combined reading content.

An offer contains journal IDs only. The server resolves owned readings, the canonical original, current enabled node, and current shareable policy. Receipts, unknown/foreign readings, private character data, and inventory cannot be offered. The peer receives titles, never text/audio before completion. Changed offers invalidate both confirmations; matching confirmations atomically create both contacts, copied readings, receipts, journal receipt entries, audit, and request record. Copy uniqueness by event/recipient/canonical original prevents A→B→A duplication. No adventure run, flag, inventory, or balance changes occur.

Every mutation carries a request UUID. Same UUID/same payload returns current authorized server state; changed payload returns 409. Permissions, expiry, and policy are refreshed before pending replays. Completed receipts survive deadline/peer departure while the reader retains their own character and event access; current peer identity is hidden when that peer is no longer eligible. Pending cancellation remains possible during Paused/Ended; completed exchanges cannot be undone. Overview limits are the latest 500 own reading choices, 50 sessions, and 200 contacts.

| Route | Contract |
| --- | --- |
| `GET/PUT /api/events/:event/sharing` | Manager `{version,nodes:[{id,type,title,policy}]}`; PUT `{version,policies:[{nodeId,policy}]}` |
| `GET /api/events/:event/exchanges?characterId=UUID` | Current character, reading metadata, recent sessions, contacts, and read-only state |
| `POST .../exchanges` | `{requestId,characterId}` creates a waiting session |
| `POST .../exchanges/join` | `{requestId,characterId,code}` claims its recipient slot |
| `GET .../exchanges/:exchange?characterId=UUID` | Authorized current detail; public identities, offer titles, confirmation state, and completed receipt |
| `PUT .../exchanges/:exchange/offer` | `{requestId,characterId,version,readingIds}` |
| `POST .../exchanges/:exchange/confirm`, `/cancel`, `/reject` | `{requestId,characterId,version}` |

Mutation responses are `{exchange, outcome:{message,replayed}}`; initial create is 201 and other successes/replays are 200. Detail includes server time, expiry, current version, blocked reason, and permitted cancellation controls. Pairing QR links use same-origin `/#exchange/EVENT_UUID/CODE12`, distinct from badges and props. Scanned URLs are parsed rather than navigated; manual/image/camera choices use local decoding and camera consent. The UI preserves uncertain requests in page memory for explicit retry with the same UUID, fetches authoritative state on resume/conflict, and never infers completion from local taps or queues work offline.
