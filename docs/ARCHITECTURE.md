# ORACLE foundation contracts

**Identity and data ownership.** An account belongs to a person. Event membership grants a role within one event. Future characters, inventories, factions, clues, and encounters must carry an event ID and authorize against current membership. Copying content into another event creates new event-owned records. The client never decides ownership or privileges.

**Authorization.** Event reads join membership with the requested event ID. Event mutations acquire the event and acting membership row locks before checking permission and writing. Invitation redemption locks the event, then its invitation, in a consistent order. Event/subresource IDs are always checked together. Owner mutation is excluded until an explicitly designed transfer workflow exists.

**Passwords and sessions.** Passwords use asynchronous scrypt with a 16-byte random salt, N=32768, r=8, p=1, and a 64-byte derived value. Sessions use 32-byte random tokens and store only token hashes. Login and password change lock the account row so credential changes and session invalidation have an explicit order. Browser writes require an exact Origin match. The deployed cookie is Secure, HttpOnly, SameSite=Lax, and host-only.

**Invitations.** Codes contain 80 bits of cryptographic randomness using a human-readable alphabet, are stored hashed, and expire within seven days. Privileged invites are single-use. The event owner and organizers may create player/staff invitations; only the owner may create an organizer invitation. Redemption checks the current issuer role. Removing/demoting an issuer revokes their outstanding invitations.

**Event lifecycle.** draft → rehearsal → live; rehearsal may return to draft; live and paused may alternate; either may end; ended may archive. Ended/archived events reject new enrollment. Archiving freezes event content. Data-access revocation remains possible to protect old event records. Event updates require the current integer version, preventing silent overwrites.

**Migrations.** SQL files are immutable once applied. The migration runner takes a PostgreSQL advisory lock, records file checksums, and applies each new migration transactionally. It refuses changed migration history and unsupported versions. Startup and readiness require the expected schema version. Future batches must explicitly expand schema compatibility ranges when safe; do not remove the check just to allow a rollback.

**Themes, event packs and rules.** The future theme layer controls presentation and terminology. Event packs contain story data. Rules profiles define behavior. Stable internal IDs must survive a theme switch. Theme/event imports will be versioned and validated before application. None of those imports may execute arbitrary code.

**Offline contract.** v0.1 requires a connection for all actions and makes that limitation visible. Later releases may cache the app shell and data already authorized for the current event/account. Pending local actions are distinct from confirmed server changes; each replayable request needs a stable request identifier. Logout/account switching clears the associated cache. Unrevealed secrets remain server-side. Trades and shared inventories are authoritative database transactions and remain pending until confirmed. A local event host is a separate future capability.

**Operational boundaries.** `/health/live` reports the running process; `/health/ready` also verifies the database/schema. Neither reveals credentials or participant data. The server drains on SIGTERM and imposes request/header timeouts. Old sessions and rate-limit buckets are periodically removed. Staging and production require distinct databases, secrets and domains.
