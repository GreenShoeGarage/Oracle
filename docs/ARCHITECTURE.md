# ORACLE architecture and data contracts

Application v0.2.0 · Database schema 2 · Event-pack format 1

**Identity and data ownership.** An account belongs to a person. Event membership grants a role within one event. Future characters, inventories, factions, clues, and encounters must carry an event ID and authorize against current membership. Copying content into another event creates new event-owned records. The client never decides ownership or privileges.

**Authorization.** Event reads join membership with the requested event ID. Event mutations acquire the event and acting membership row locks before checking permission and writing. Invitation redemption locks the event, then its invitation, in a consistent order. Event/subresource IDs are always checked together. Owner mutation is excluded until an explicitly designed transfer workflow exists.

**Passwords and sessions.** Passwords use asynchronous scrypt with a 16-byte random salt, N=32768, r=8, p=1, and a 64-byte derived value. Sessions use 32-byte random tokens and store only token hashes. Login and password change lock the account row so credential changes and session invalidation have an explicit order. Browser writes require an exact Origin match. The deployed cookie is Secure, HttpOnly, SameSite=Lax, and host-only.

**Invitations.** Codes contain 80 bits of cryptographic randomness using a human-readable alphabet, are stored hashed, and expire within seven days. Privileged invites are single-use. The event owner and organizers may create player/staff invitations; only the owner may create an organizer invitation. Redemption checks the current issuer role. Removing/demoting an issuer revokes their outstanding invitations.

**Event lifecycle.** draft → rehearsal → live; rehearsal may return to draft; live and paused may alternate; either may end; ended may archive. Ended/archived events reject new enrollment. Archiving freezes event content. Data-access revocation remains possible to protect old event records. Event updates require the current integer version, preventing silent overwrites.

**Migrations.** SQL files are immutable once applied. The runner takes a PostgreSQL advisory lock, records file checksums, and applies each new migration transactionally. It refuses changed migration history and unsupported versions. Migration `002_event_setup.sql` adds a non-null JSONB `events.setup` column with a valid blank Fantasy setup and an object constraint. Existing event IDs, metadata, owners, lifecycle, version counters, memberships, invitation hashes, and audit records remain intact. A regression fixture created with Batch 1's schema verifies this preservation. Creating an event without `setup` remains supported and receives the same default.

Startup and readiness require schema 2. The v0.1 application requires schema 1, so it is **not a valid rollback image after migration 002**. Keep the migrated data and roll forward with a schema-2-compatible fix. Do not remove schema checks or drop the setup column to make an older binary start. Database restoration is a separate operator-directed incident action described in [DEPLOYMENT.md](DEPLOYMENT.md).

**Themes, event packs and rules.** `public/kit.js` is the shared browser/server contract. Themes control presentation and terminology; setup contains the selected theme, enabled instruments, declarative rules, and authored material. A theme-only update replaces only `setup.theme`, preserving rules, content identifiers, event ownership, and progress. `templateId` records the starter used; it is not an instruction to reapply or execute a template. Available starters are Blank event, The Lantern Council, The Missing Signal, and The Last Water Stop. The latter three are briefing seeds, not complete adventures.

Themes accept six-digit hex colors, enumerated fonts (`serif`, `sans`, `mono`), textures (`none`, `grain`, `grid`, `dust`), icons (`sigil`, `chip`, `compass`), four terminology fields, and optional cues (`bell`, `pulse`, `click`). Text, muted text, and accent must each reach 4.5:1 contrast against both background and panel. Theme assets are built into the application. Arbitrary CSS, HTML, scripts, URLs, and formulas are rejected. Sound is synthesized locally after a user gesture; no remote sound asset or autoplay is used.

Rules define up to 12 attributes, 24 expertise entries, 12 resources, and 12 named outcomes. Attribute/resource minimum, maximum, and default values must be finite, between -1,000,000 and 1,000,000, and satisfy `min ≤ default ≤ max`. These are bounded definitions, not executable mechanics. Character values and challenge resolution arrive in later batches.

**Offline contract.** v0.2 requires connectivity for server actions. The guided setup uses explicit Save, with dirty/saving/confirmed status and a discard guard. Its unsaved draft lives only in page memory. Reading preferences use local storage; event data is not cached for offline use. Later releases may cache the app shell and data already authorized for the current event/account. Pending local actions are distinct from confirmed server changes; each replayable request needs a stable request identifier. Logout/account switching clears the associated cache. Unrevealed secrets remain server-side. Trades and shared inventories are authoritative database transactions and remain pending until confirmed. A local event host is a separate future capability.

**Operational boundaries.** `/health/live` reports the running process; `/health/ready` also verifies the database/schema. Neither reveals credentials or participant data. The server drains on SIGTERM and imposes request/header timeouts. Old sessions and rate-limit buckets are periodically removed. Staging and production require distinct databases, secrets and domains.


## Audience boundaries

Event authorization runs before a response is projected for its audience. Owners and organizers may receive organizer material. Staff and players receive only entries with `visibility: "player"`, including in event list, detail, join, pack, and preview responses. Prop projection also requires `prop: true`; marking an organizer entry for prop display cannot expose it. Preview responses omit account/membership details and declare `readOnly: true`.

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

An organizer export includes organizer-only story records and requires owner/organizer membership. A player export is projected on the server; a claimed player pack containing an organizer entry is rejected. Neither pack includes accounts, memberships, invitations, activity history, or live lifecycle state. Import preserves the pack's nested content/rule IDs while creating a new event UUID, Draft state, fresh owner membership, and `event.imported` audit entry in one transaction. Import never overwrites an existing event. The original event and its permissions remain untouched.

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
