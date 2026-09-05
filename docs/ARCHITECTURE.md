# ORACLE architecture and data contracts

Application v0.3.0 · Database schema 4 · Event-pack format 1

**Identity and data ownership.** An account belongs to a person. Event membership grants a role within one event. Characters, inventories, and factions carry an event ID and authorize against current membership; future clues and encounters must follow the same contract. Copying content into another event creates new event-owned records. The client never decides ownership or privileges.

**Authorization.** Event reads join membership with the requested event ID. A database-backed project superuser may manage all events; this is an explicit global role rather than a forged event membership. Disabled accounts fail session authorization. Event mutations acquire the event and acting membership row locks before checking permission and writing. Invitation redemption locks the event, then its invitation, in a consistent order. Event/subresource IDs are always checked together. Owner mutation is excluded until an explicitly designed transfer workflow exists.

**Passwords and sessions.** Passwords use asynchronous scrypt with a 16-byte random salt, N=32768, r=8, p=1, and a 64-byte derived value. Sessions use 32-byte random tokens and store only token hashes. Login and password change lock the account row so credential changes and session invalidation have an explicit order. Browser writes require an exact Origin match. The deployed cookie is Secure, HttpOnly, SameSite=Lax, and host-only.

**Invitations.** Codes contain 80 bits of cryptographic randomness using a human-readable alphabet, are stored hashed, and expire within seven days. Privileged invites are single-use. The event owner and organizers may create player/staff invitations; only the owner may create an organizer invitation. Redemption checks the current issuer role. Removing/demoting an issuer revokes their outstanding invitations.

**Event lifecycle.** draft → rehearsal → live; rehearsal may return to draft; live and paused may alternate; either may end; ended may archive. Ended/archived events reject new enrollment. Archiving freezes event content. Data-access revocation remains possible to protect old event records. Event updates require the current integer version, preventing silent overwrites.

**Migrations.** SQL files are immutable once applied. The runner takes a PostgreSQL advisory lock, records file checksums, and applies each new migration transactionally. It refuses changed migration history and unsupported versions. Migration `002_event_setup.sql` adds a non-null JSONB `events.setup` column with a valid blank Fantasy setup and an object constraint. Existing event IDs, metadata, owners, lifecycle, version counters, memberships, invitation hashes, and audit records remain intact. A regression fixture created with Batch 1's schema verifies this preservation. Creating an event without `setup` remains supported and receives the same default.

Migration 003 adds default-false superuser/disabled flags and system audit history. Migration 004 adds event character settings, factions, characters, and independent inventory tables with event-scoped constraints. Earlier event setup, memberships, invitations, audit records, and credentials are retained. Startup and readiness require schema 4. The v0.1 and v0.2 applications require older exact schema versions and are **not valid rollback images after this upgrade**. Preserve the migrated data and roll forward with a schema-4-compatible fix. Do not remove schema checks or drop new data to make an older binary start. Database restoration is a separate operator-directed incident action described in [DEPLOYMENT.md](DEPLOYMENT.md).

**Themes, event packs and rules.** `public/kit.js` is the shared browser/server contract. Themes control presentation and terminology; setup contains the selected theme, enabled instruments, declarative rules, and authored material. A theme-only update replaces only `setup.theme`, preserving rules, content identifiers, event ownership, and progress. `templateId` records the starter used; it is not an instruction to reapply or execute a template. Available starters are Blank event, The Lantern Council, The Missing Signal, and The Last Water Stop. The latter three are briefing seeds, not complete adventures.

Themes accept six-digit hex colors, enumerated fonts (`serif`, `sans`, `mono`), textures (`none`, `grain`, `grid`, `dust`), icons (`sigil`, `chip`, `compass`), four terminology fields, and optional cues (`bell`, `pulse`, `click`). Text, muted text, and accent must each reach 4.5:1 contrast against both background and panel. Theme assets are built into the application. Arbitrary CSS, HTML, scripts, URLs, and formulas are rejected. Sound is synthesized locally after a user gesture; no remote sound asset or autoplay is used.

Rules define up to 12 attributes, 24 expertise entries, 12 resources, and 12 named outcomes. Attribute/resource minimum, maximum, and default values must be finite, between -1,000,000 and 1,000,000, and satisfy `min ≤ default ≤ max`. These are bounded definitions, not executable mechanics. Batch 3 character attributes and skills validate against these definitions. Automatic challenge resolution remains a later batch.

**Offline contract.** v0.3 requires connectivity for server actions. The guided setup uses explicit Save, with dirty/saving/confirmed status and a discard guard. Its unsaved draft lives only in page memory. Reading preferences use local storage; event data is not cached for offline use. Later releases may cache the app shell and data already authorized for the current event/account. Pending local actions are distinct from confirmed server changes; each replayable request needs a stable request identifier. Logout/account switching clears the associated cache. Unrevealed secrets remain server-side. Trades and shared inventories are authoritative database transactions and remain pending until confirmed. A local event host is a separate future capability.

**Operational boundaries.** `/health/live` reports the running process; `/health/ready` also verifies the database/schema. Neither reveals credentials or participant data. The server drains on SIGTERM and imposes request/header timeouts. Old sessions and rate-limit buckets are periodically removed. Staging and production require distinct databases, secrets and domains.


## Audience boundaries

Event authorization runs before a response is projected for its audience. Owners, organizers, and project superusers may receive organizer material. Staff and players receive only entries with `visibility: "player"`, including in event list, detail, join, pack, and preview responses. Prop projection also requires `prop: true`; marking an organizer entry for prop display cannot expose it. Preview responses omit account/membership details and declare `readOnly: true`.

Event metadata, theme terminology, and rules are shared with every event member. Private narrative belongs in content explicitly marked `organizer`. A disabled Briefing instrument hides its cards, but does not delete records or make player-visible content secret: permitted content remains in player exports. Instrument visibility is a display choice; audience permission is the access boundary.

Prop mode is a filtered reading interface, not a kiosk security boundary. Selecting a player/prop preview on an organizer account does not revoke that account's organizer permissions. Use a player account on unattended hardware. A future dedicated prop session will need its own restricted authorization design.

## Setup validation

Each object has an exact set of supported fields and a format version. Unknown/missing fields, duplicate IDs, invalid ranges, unsupported instruments, invalid calendar dates, unsupported future versions, prototype-bearing objects, accessors, and sparse lists are rejected before import or update. Nested IDs use a lowercase letter followed by lowercase letters, digits, or hyphens, with at most 48 characters. IDs are unique within each collection.

Setup is limited to 180,000 normalized UTF-8 JSON bytes. A complete event pack is limited to 200,000 bytes, reserving enough room for maximum-sized public event metadata. Raw create/update/import requests are capped at 256 KiB, while ordinary small API bodies retain smaller limits. Content is limited to 20 entries, with titles up to 120 characters and bodies up to 6,000 characters. The server independently validates every write; browser validation is for feedback.

All twelve planned gameplay instruments remain catalogued as unavailable. `enabledInstruments` currently accepts only `briefing`, or an empty list. An import cannot enable a future feature by guessing its identifier.

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

An organizer export includes organizer-only story records and requires owner/organizer membership. A player export is projected on the server; a claimed player pack containing an organizer entry is rejected. Neither format-1 pack includes accounts, memberships, invitations, activity history, live lifecycle state, character settings, factions, characters, or inventories. These additions remain separate database records; use the authorized character-copy API to reuse an identity. Import preserves the pack's nested content/rule IDs while creating a new event UUID, Draft state, fresh owner membership, and `event.imported` audit entry in one transaction. Import never overwrites an existing event. The original event and its permissions remain untouched.

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
