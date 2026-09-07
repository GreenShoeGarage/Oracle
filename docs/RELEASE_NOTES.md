# ORACLE release notes

## v1.2.0 — public screenshot tour

- Public `/tour.html` explains ORACLE before registration, with examples of every instrument, the three themes, character sheets and QR exchanges, organizer workflows, and field preparation.
- Nineteen distinct screenshots show fictional data rendered by the shipped interface. Visitors can enlarge images and browse 21 complete, inert examples without an account.
- Homepage, help, and in-app navigation link to the tour. The production sitemap includes it; staging remains excluded from indexing.
- Images load lazily below the first screen and stay outside the installed field kit’s offline cache. No gameplay, SQL schema, stored-data format, account, or permission changes.

Release `705a3e702a42f4148ea12a74fd1e9eb93aef03ae` is deployed at [oracle.greenshoegarage.com](https://oracle.greenshoegarage.com). Exact main and accepted staging verification each passed 334 tests (333 passed, zero failures, one expected skip), plus existing runtime/recovery/load gates. The complete remote all-twelve/all-three-theme journey with cleanup, Railway production, and independent exact readiness plus 104 public GET paths passed. [Release status](STATUS.md) records deployment evidence and the unchanged-candidate staging retry. [Tour maintenance](TOUR.md) documents regeneration and screenshot provenance.

## v1.1.0 — feedback and field preparation

Release `da681123a25141b47893cba794fc7738b34a5c6d` is deployed at [oracle.greenshoegarage.com](https://oracle.greenshoegarage.com). Exact main/staging PostgreSQL verification, the complete remote all-twelve/all-three-theme journey with cleanup, Railway production, and all 78 public GET checks passed. See [release status](STATUS.md) for evidence.

- **Prepare for the field** saves the permitted event briefing/rules and the player's own approved character, checks saved journal data, and reports preparation time and storage failures.
- Separate public-app and event-data readiness makes offline availability clearer. Shared game actions still require connectivity and server confirmation.
- A static public introduction, feature list, help/catalog links, and public-page metadata make the app understandable before JavaScript loads.
- Mobile metadata, initial display/color handling, and guarded startup focus on the main content and announcements address installation and accessibility feedback.
- Documentation now accurately limits briefing packs to setup/briefing material and distinguishes database restoration from the unrun application rollback rehearsal.

SQL schema 10, briefing/adventure formats 1, and journal archive version 2 are retained. The browser Field desk database upgrades to IndexedDB version 2, preserving its stores, contexts, notes, and requests while blocking older version-1 writers from discarding prepared material. Save open work and close or update older tabs if the upgrade is blocked. Existing information-only requests retain their account scope, identifiers, and explicit replay behavior.

Verification: both PostgreSQL suites passed 332 tests (331 passed, zero failures, one expected skip), plus isolated load, populated recovery, startup, and Docker gates. Three preparation/API/local-storage integration groups passed. Desktop staging checks covered the homepage/help, startup status, and keyboard entry without claiming mobile, physical-device, or assistive-technology acceptance. Complete remote staging and cleanup passed. Production deployment `0a3a2b8a-94d5-4a95-b5d4-27ec6ab24270` and [production CI 34067963685](https://github.com/GreenShoeGarage/Oracle/actions/runs/34067963685) confirmed the exact release and all 78 public GET paths on September 6, 2026.

## v1.0.0 — Batch 12

Release `782671590b3ea3547f0bd3a24a7a98ed5af76dd4` shipped public Help & guides, organizer/player handoff documentation, an install-panel layout correction, and protection against resetting a rehearsal copy after it enters Live play. It retains the three starter adventures, all twelve instruments, character/QR workflows, and Field desk support from earlier releases.

Exact PostgreSQL CI, populated recovery/startup/image checks, isolated load, the complete remote staging journey, and production readiness plus **72 public GET paths** passed. The PostgreSQL suite had 309 tests: 308 passed, zero failures, and one PGlite-only skip. Production deployment `bc9ea961-3b1d-4201-b68e-c45d73c03bca` succeeded on September 6, 2026.

The physical-device/human pilot remained unrun. The rollback helper was not integrated or rehearsed. Sustained Railway capacity and scheduled live backups were not established by this release.
