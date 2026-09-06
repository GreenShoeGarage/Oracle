# ORACLE release notes

## v1.1.0 — feedback and field preparation

Candidate work is in progress; see [release status](STATUS.md) for verification and deployment evidence.

- **Prepare for the field** saves the permitted event briefing/rules and the player's own approved character, checks saved journal data, and reports preparation time and storage failures.
- Separate public-app and event-data readiness makes offline availability clearer. Shared game actions still require connectivity and server confirmation.
- A static public introduction, feature list, help/catalog links, and public-page metadata make the app understandable before JavaScript loads.
- Mobile metadata, initial display/color handling, and guarded startup focus and announcements address installation and accessibility feedback.
- Documentation now accurately limits briefing packs to setup/briefing material and distinguishes database restoration from the unrun application rollback rehearsal.

SQL schema 10, briefing/adventure formats 1, and journal archive version 2 are retained. The browser Field desk database upgrades to IndexedDB version 2, preserving its stores, contexts, notes, and requests while blocking older version-1 writers from discarding prepared material. Save open work and close or update older tabs if the upgrade is blocked. Existing information-only requests retain their account scope, identifiers, and explicit replay behavior.

## v1.0.0 — Batch 12

Release `782671590b3ea3547f0bd3a24a7a98ed5af76dd4` shipped public Help & guides, organizer/player handoff documentation, an install-panel layout correction, and protection against resetting a rehearsal copy after it enters Live play. It retains the three starter adventures, all twelve instruments, character/QR workflows, and Field desk support from earlier releases.

Exact PostgreSQL CI, populated recovery/startup/image checks, isolated load, the complete remote staging journey, and production readiness plus **72 public GET paths** passed. The PostgreSQL suite had 309 tests: 308 passed, zero failures, and one PGlite-only skip. Production deployment `bc9ea961-3b1d-4201-b68e-c45d73c03bca` succeeded on September 6, 2026.

The physical-device/human pilot remained unrun. The rollback helper was not integrated or rehearsed. Sustained Railway capacity and scheduled live backups were not established by this release.
