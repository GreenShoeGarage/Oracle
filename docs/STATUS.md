# ORACLE v0.8.0 — Batch 8 release status

Recorded September 6, 2026.

Source: [GreenShoeGarage/Oracle](https://github.com/GreenShoeGarage/Oracle). Candidate application `0.8.0`; database schema `9`; briefing-pack format `1`; adventure format `1`. Production remains the verified Batch 7 release until this candidate passes its exact-commit CI, staging, and production gates. No Batch 8 deployment is claimed here yet.

## Batch 8 implemented

- SIGIL shared-device cooperation: captured in-person roles, ordered checkpoints and optional answers, active-time requirements, server timers, host item/resource requirements, and explicit outcomes.
- Atomic final checkpoint/component consumption/flags/journal, once-per-character success, request replay, failed/cancelled retry, and staff operations with reasons.
- Explicit host/event pauses and resume, a 20-second connectivity lease with monotonic heartbeats, fresh server state after reconnect, and no offline progression.
- STATIC prepared prop/zone readings, condition-driven state, bounded published staff choices, versioned overrides, and an explicit fictional label in every signal projection.
- Immutable account-bound collected signals and results, private draft/live publication separation, and current ownership/revocation checks.
- Theme-aware immersive prop presentation, optional local sound with visual equivalents, code printing, and camera/photo/manual entry.
- The same two-role/three-checkpoint starter appears as a fantasy ritual, cyberpunk relay procedure, or wasteland repair. Copies receive fresh prop codes and omit runtime/private state; reset clears actual rehearsal play while preserving authored definitions and the source event.
- Additive migration 009 introduces ten tables while preserving all eight prior migration records, populated schema-8 economy/agreement data, and the existing enabled operator's identity/password.

Eleven gameplay instruments plus Briefing are implemented. STAGEHAND is the next planned instrument in Batch 9. Shared-device roles are in-person performer labels; they do not authorize other characters or imply coordinated multi-device timing. Format-1 briefing/adventure contracts stay unchanged.

## Batch 8 candidate verification

| Check | Recorded result |
| --- | --- |
| Legacy/foundation migration suite | 38 tests: 37 passed, zero failures, one existing TCP-only skip; complete operator row, all 13 populated schema-8 economy/agreement tables, and all eight old migration records preserved |
| Populated recovery fixture | All 13 existing economy/agreement tables and all ten schema-9 tables contain valid constrained data; repeated schema-9 migration passed locally |
| Local full staging rehearsal | Passed 392 reads / 466 writes, including all previous workflows, every-theme cooperation/fictional signal, final component rollback, one-time deduction, staff controls, actual copied play/reset, source preservation, and cleanup |
| Focused instrument HTTP suites | SIGIL 16 passed; STATIC 11 passed |
| Focused browser modules | SIGIL UI 10 passed plus a bounded published/draft authoring check; STATIC UI 8 passed; shared prop/code helpers 7 passed |
| Root integration and persistence checks | 35 existing integration checks passed; 29 kit/offline/component checks passed |
| Full application DOM/API walkthrough | Ten checks passed with zero uncaught errors using actual modules, HTTP/PGlite and JSDOM |
| Contention fixture workflows | Four new functional fixtures passed with PGlite; real PostgreSQL contention remains a CI gate |
| Full application, PostgreSQL, Docker and release gates | Pending exact candidate verification |

The recovery fixture includes distinct draft/publication snapshots, captured role/component records, completed and paused runs with frozen timer state, immutable result consumption evidence, conditional fictional readings, later staff overrides, and history/replay records. The real PostgreSQL dump/restore gate must compare all these tables before promotion. Local fixtures and HTTP checks are not remote-deployment claims.

## Current limits and recovery position

- Scheduled live backups remain unconfigured: Railway HOBBY reports `maxBackupsCount: 0` and no external runner is configured. Disposable restore rehearsals do not back up live event data.
- After migration 009, v0.7.0/schema-8 and earlier binaries are incompatible. Preserve upgraded data and use a tested schema-9-compatible roll-forward fix.
- Current cooperative timers, controls, component availability, fictional signals, shops, exchanges, and agreement state require server confirmation. Permitted completed journal text can enter the existing 1,000-entry/3 MB archive, tied to the captured account and character. There is no offline mutation queue or real-world sensor integration.
- Coordinated multi-device timing, physical phones/cameras, authenticated real-browser/mobile workflows, real service-worker inspection, load measurements, and a human field pilot remain outstanding. HTTP, DOM, and storage automation do not replace those gates.

## Previous verified release — Batch 7

Recorded September 6, 2026.

Source: [GreenShoeGarage/Oracle](https://github.com/GreenShoeGarage/Oracle). Application `0.7.0`; database schema `8`; briefing-pack format `1`; adventure format `1`. Release commit: `a008a659d4f2cc9425a88640bffd5f3df8774d2b`. Railway staging and production and all three CI runs passed on this exact commit.

Release commit `a008a659d4f2cc9425a88640bffd5f3df8774d2b` passed both main and staging CI: 183 PostgreSQL tests (182 passed, zero failures, one PGlite-only snapshot skip), all four TCP gates including forced last-stock and same-item contention, actual populated schema-8 dump/restore, startup, and the production Docker image. Railway staging and the complete deployed BAZAAR/QR/OATHBOOK/three-theme adventure/story workflow passed on that same commit. Railway production and all 43 exact-commit public checks passed on that same release, confirming v0.7.0/schema 8 and the existing enabled operator account. Production migration/startup confirmed the matching existing operator account is enabled; idempotent provisioning and migration tests preserve its identity/password.

### Batch 7 implemented

- BAZAAR fictional whole-unit resource balances, organizer-defined shops, finite stock, versioned purchases, and immutable transaction receipts.
- Bilateral QR item/resource barter alongside selected readings: revised offers clear both confirmations; all transfers and reading copies commit together, and exact retries produce one transaction.
- OATHBOOK private proposals with exact terms revisions, explicit participant acceptance, independent witnesses, expiration, fixed resource settlements, disputes, organizer rulings, and linked corrections.
- Organizer balance corrections require reasons; character inventory forms also record a reason and before/after quantities in event activity. Existing API clients may omit inventory reasons and receive the documented default audit label.
- Independent authored resource catalogs, new-starter shops with zero initial balances, and rehearsal copies that restore initial stock and inventory without copying balances, trades, or agreements.
- Account-bound receipts, revision-audience-filtered agreement history with a 512-entry cap, current ownership checks, online confirmation, explicit uncertain-request retry, and no current economy/agreement cache or offline mutation queue.

Nine gameplay instruments are implemented; three remain planned. Batch 8 adds cooperative challenges and immersive props next. Existing briefing/adventure formats stay 1; briefing packs do not export economy, agreement, character, adventure, exchange, or story histories.

### Batch 7 release verification

| Check | Recorded result |
| --- | --- |
| Local HTTP staging rehearsal | Passed 305 reads and 342 writes, including all previous event/character/three-theme adventure/exchange/story workflows, new purchases, mixed barter, independent witnessing, settlement, adjudication, linked correction, and actual rehearsal reset |
| Legacy/foundation migration checks | 37-test set covered by the initial run plus a corrected planned-instrument fixture rerun: 36 passing tests and one existing TCP-only skip; populated schema-7 records and the complete enabled operator row preserved |
| Recovery fixture | All 13 new tables populated with valid constraints; repeated schema-8 migration passed locally; actual PostgreSQL dump/restore passed in both candidate CI runs |
| Root integration checks | 22 passed |
| Kit/offline checks | 27 passed |
| Full app DOM/API walkthrough | Eight checks passed with zero uncaught errors, using actual modules/HTTP/PGlite and JSDOM, including lost purchase/trade/settlement responses and reassignment privacy |
| Focused OATHBOOK UI checks | Ten scenarios passed |
| New and extended HTTP suites | Economy 7 passed; OATHBOOK 13 passed; exchange 14 passed plus one TCP-only skip; story 13 passed including trade-receipt journal privacy |
| Full local `npm run verify` | 183 tests: 179 passed, zero failures, four deliberate TCP-only skips; syntax, version, and static assets passed |
| [Main CI 34007392337](https://github.com/GreenShoeGarage/Oracle/actions/runs/34007392337) | Passed on the exact release commit; [verification job 101417013274](https://github.com/GreenShoeGarage/Oracle/actions/runs/34007392337/job/101417013274) |
| [Staging CI 34007392743](https://github.com/GreenShoeGarage/Oracle/actions/runs/34007392743) | Verification and complete remote workflow passed; [verification job 101417014468](https://github.com/GreenShoeGarage/Oracle/actions/runs/34007392743/job/101417014468) |
| PostgreSQL 18 suite | 183 tests: 182 passed, zero failures, one PGlite-only snapshot skip; all four TCP gates passed, including forced last-stock and same-item trade contention |
| Recovery/runtime gates | Actual populated-table pg_dump/pg_restore including all 13 new tables, repeated migration, startup, and the production Docker image with secure cookies and graceful stop passed |
| [Remote staging job 101417119106](https://github.com/GreenShoeGarage/Oracle/actions/runs/34007392743/job/101417119106) | Exact-release readiness, BAZAAR, mixed QR barter, OATHBOOK, actual economy reset, every prior three-theme adventure/exchange/story path, and cleanup passed |
| [Production CI 34007575785](https://github.com/GreenShoeGarage/Oracle/actions/runs/34007575785) | Passed exact release commit, v0.7.0/schema 8 readiness, and all 43 public GET checks; no production users, events, or mutations created |

The local journey demonstrates corrected shop pricing, finite stock, purchase replay and failed-funds isolation; mixed item/resource barter with revised consent, last-leg rejection without partial writes, and identical retry receipts; revised exact agreement terms, a separate-account witness, participant-only settlement, dispute/adjudication without double payment, and a linked correction. It also populates a rehearsal with actual purchases and an agreement, restores its initial inventory/stock, clears only rehearsal balances/history, and checks the original event remains intact. Local request counts are not remote-deployment claims.

### Batch 7 deployment record

| Target | Project ID | Deployment ID | Result |
| --- | --- | --- | --- |
| [Staging](https://oracle-production-488d.up.railway.app) | `4e75d5ec-f8e9-492d-ae75-e0d44428d24a` | `9cce9b03-3d96-4056-acb9-5b6df23948b8` | Exact release v0.7.0/schema 8 succeeded; complete remote workflow passed |
| [Production](https://oracle.greenshoegarage.com) | `d1989864-9a40-4176-a9d3-203a06c4bd72` | `fc197e70-365f-4545-9b4e-caccbc5419bb` | Exact release v0.7.0/schema 8 succeeded; all 43 public checks passed |

Staging logs confirmed migration 8 at 02:48:08 UTC and v0.7.0 `server_ready` in staging at 02:48:14 UTC on September 6. The remote workflow verified exact-commit readiness at 02:48:56 UTC, passed BAZAAR at 02:50:00, QR barter at 02:50:04, OATHBOOK at 02:50:09, and economy reset at 02:50:18. All three adventure paths and disposable-event/session cleanup completed at 02:50:57 UTC. Staging and production remain separate Railway projects and databases.

Production logs confirmed `migrations_complete: 8` and `superuser_provisioned` with `matched: true` at 02:52:35 UTC on September 6. At 02:52:39 UTC, startup reported v0.7.0 in production and `superuser_status` with `accountExists: true`, `enabled: true`. The [production smoke job 101417500630](https://github.com/GreenShoeGarage/Oracle/actions/runs/34007575785/job/101417500630) verified the exact release commit/version/schema at 02:52:43 UTC and passed all 43 public GET checks from 02:52:43 to 02:52:48 UTC. Production checks created no accounts or event data. Runtime branches retain the checked release commit; subsequent documentation commits do not change the deployed application. No private operator address, account identifier, setup secret, or password appears in these documents.

### Current limits and recovery position

- Scheduled live backups remain unconfigured: Railway HOBBY reports `maxBackupsCount: 0` and no external runner is configured. Disposable restore rehearsals do not back up live event data.
- After migration 008, v0.6.0/schema-7 and earlier binaries are incompatible. Preserve the upgraded data and use a tested schema-8-compatible roll-forward fix.
- Current balances, shops, pending offers, detailed transaction objects, and agreement terms/signatures are online-only. Authorized completed trade journal receipt text can enter the existing 1,000-entry/3 MB archive; it is historical evidence and confers no current spending rights. Reassignment filters prior captured receipt access. No economy/agreement mutation queue is introduced.
- Physical phones/cameras, authenticated real-browser/mobile workflows, real service-worker inspection, load measurements, and a human field pilot remain unverified. HTTP, DOM, and storage automation do not replace those gates.

## Previous verified release — Batch 6

Recorded September 6, 2026.

Source: [GreenShoeGarage/Oracle](https://github.com/GreenShoeGarage/Oracle). Application `0.6.0`; database schema `7`; briefing-pack format `1`; adventure format `1`. Release commit: `9c14293bd6a13d5d5912070bdacda6b24308df43`. Railway staging and production both passed on this exact commit.

Batch 6 was deployed at [oracle.greenshoegarage.com](https://oracle.greenshoegarage.com). Local verification, real PostgreSQL CI, the complete remote staging workflow, Railway production, and exact-commit public smoke passed. Production migration/startup confirmed the existing reserved operator account is enabled, preserving its identity and password.

### Batch 6 implemented

- TRACE records evidence, people, places, and theories with private defaults, selected journal citations, explicit sharing, visible connections, search/filtering, and archive.
- WHISPER supplies authored alternate accounts with current audience/condition checks and explicit collection. Hidden staff truth/topic and inaccessible variants stay off player paths; collected rumors remain labeled unverified.
- BROADSIDE provides player proposals, staff drafts/submission, organizer review/publication, printable posters, correction drafts separate from the live publication, correction notes, and withdrawal.
- Public event, faction, group, and selected-character audiences follow current approved character access. Managers cannot proxy a player's private investigation. Shared notes omit citations the reader has not independently acquired and links to unavailable records.
- Existing QR exchanges can transfer shareable rumor snapshots with bilateral confirmation. Publication/shareability/withdrawal changes invalidate outstanding consent; received information never grants game flags, progression, or inventory.
- WHISPER captures are account-bound. Reassignment hides former-player captures and private work; a new player can explicitly recollect eligible material or acquire it through a new completed exchange. A receipt can grant an existing immutable copy without rewriting its provenance or duplicating it.
- New starter stories are drafts awaiting review. Rehearsals remap authored character/faction/group audiences, exclude original collections and player investigations, and reset disposable play while preserving authored entries/publications/groups and the source event.
- Migration 007 adds seven story/TRACE tables and a receipt lookup index. Populated schema-6 exchange/adventure/account records and prior migration files remain intact.

Seven gameplay instruments are available; five remain planned. Batch 7 is next. Format-1 briefing packs remain setup/material only and do not export story, investigation, exchange, character, or adventure state.

### Batch 6 release verification

| Check | Recorded result |
| --- | --- |
| Legacy/foundation migration suite | 36 tests: 35 passed, zero failures, one existing TCP-only skip; populated schema-6 exchanges and enabled superuser identity/password preserved |
| Recovery fixture | Every new story/TRACE table populated with valid foreign keys; repeated schema-7 migration passed locally; actual PostgreSQL dump/restore passed in both candidate CI runs |
| TRACE and story HTTP suites | Eleven TRACE and twelve story tests passed; final TRACE audience-validation alignment passed all eleven focused tests again |
| Focused story UI checks | Fourteen checks passed, including current-role changes and semantic dirty-state tracking |
| Focused TRACE UI checks | Ten checks passed, including semantically unchanged JSONB round trips |
| Local HTTP staging rehearsal | 252 reads/287 writes passed, including every audience and prior three-theme adventure/exchange paths |
| Full app DOM/API walkthrough | Ten end-to-end checks passed with zero uncaught JavaScript errors using actual modules, HTTP/PGlite, and JSDOM |
| Full local `npm run verify` | 157 tests: 155 passed, zero failures, two deliberate existing TCP-only skips; syntax/assets passed |
| [Main CI 34004234561](https://github.com/GreenShoeGarage/Oracle/actions/runs/34004234561) | Passed at the exact release commit |
| [Staging CI 34004234793](https://github.com/GreenShoeGarage/Oracle/actions/runs/34004234793) | Verification and complete remote workflow passed |
| PostgreSQL 18.6 suite | 157 tests: 156 passed, zero failures, one PGlite-only snapshot skip; both TCP races passed |
| Recovery/runtime gates | Populated schema-7 dump/restore, both audit sequences, repeated migration, startup, and running production Docker/session/graceful-stop checks passed |
| [Remote staging job 101408528522](https://github.com/GreenShoeGarage/Oracle/actions/runs/34004234793/job/101408528522) | Exact-release readiness, 37 public checks, story/TRACE/all-audience workflow, all three adventures/exchanges, rehearsal reset, and cleanup passed |
| [Production CI 34004393610](https://github.com/GreenShoeGarage/Oracle/actions/runs/34004393610) | Exact release commit, v0.6.0/schema 7 readiness, and all 37 public GET checks passed; no production accounts/events/mutations created |

The local staging script exercises differing private rumor accounts; explicit collection/retry; hidden truths; manager exclusion from private theories; canonical citations after confirmed QR sharing; private links; public/private/group/faction audiences; group/faction removal and actual character reapproval; player proposal review; separate draft/live corrections; withdrawal; exchange confirmation invalidation; real discovery-gated collection; and source-preserving rehearsal remapping/reset. The full-app DOM walkthrough also checks persisted notes, selected evidence, safe bulletin poster content, uncertain-response retry, exact UUID reuse, and account/character privacy boundaries. The full suite completed before a final bounded TRACE audience-validation alignment; all eleven focused TRACE tests passed afterward. Both exact-candidate PostgreSQL CI runs then passed the complete suite. Their sole skip is the PGlite-specific snapshot test, replaced by actual dump/restore. Local request counts are not remote-deployment claims.

### Batch 6 deployment record

| Target | Project ID | Deployment ID | Result |
| --- | --- | --- | --- |
| [Staging](https://oracle-production-488d.up.railway.app) | `4e75d5ec-f8e9-492d-ae75-e0d44428d24a` | `edf175c1-e090-47ab-b6a2-62813b3e20cd` | Exact release v0.6.0/schema 7 success; complete remote workflow passed |
| [Production](https://oracle.greenshoegarage.com) | `d1989864-9a40-4176-a9d3-203a06c4bd72` | `04ebac6c-854e-4cab-b0be-2bb00f5ec689` | Exact release v0.6.0/schema 7 success; public smoke passed |

Staging logs confirmed migration 7 at 01:34:32 UTC and v0.6.0 `server_ready` in staging at 01:34:38 UTC on September 6. The remote workflow finished all three adventure paths and archived its disposable events/signed out sessions at 01:36:33 UTC. These checks used the exact release commit. Staging and production remain separate Railway projects and databases.

Production logs confirmed migration 7 and an existing matching superuser at 01:38:11 UTC on September 6. At 01:38:16 UTC, startup reported v0.6.0 in production and `accountExists: true`, `enabled: true`. Idempotent provisioning preserved the existing UUID/password. The [production smoke job 101408855825](https://github.com/GreenShoeGarage/Oracle/actions/runs/34004393610/job/101408855825) verified the exact commit/version/schema at 01:38:18 UTC and passed all 37 public checks between 01:38:19 and 01:38:23 UTC. Runtime branches retain the checked release commit; subsequent documentation commits do not change the deployed application. No private operator address, account identifier, setup secret, or password appears in these documents.

### Current limits and recovery position

- Scheduled production backups remain unconfigured. Railway HOBBY reports `maxBackupsCount: 0`; no external runner is configured. Disposable restore rehearsals and briefing packs do not back up live data.
- After migration 007, earlier v0.5.0/schema-6 and older binaries are incompatible. Preserve data and use a tested schema-7-compatible roll-forward fix.
- Offline journal snapshots retain the existing 1,000-entry/3 MB limit and may contain only previously authorized readings/receipts, including WHISPER. TRACE, current news, hidden truth, and pending writes are not cached. Device permissions may be stale while disconnected; known revocation/account change clears the relevant archive.
- Physical phones/cameras, authenticated real-browser/mobile workflows, real service-worker inspection, load measurements, and a human field pilot remain unverified. HTTP, DOM, and storage automation do not replace those gates.

## Previous verified release — Batch 5

Recorded September 6, 2026.

Source: [GreenShoeGarage/Oracle](https://github.com/GreenShoeGarage/Oracle). Release commit: `72cce5d6858c6b59b34b7c8c80bc874bb088e099`. Application `0.5.0`; database schema `6`; briefing-pack format `1`; adventure format `1`.

Batch 5 is deployed at [oracle.greenshoegarage.com](https://oracle.greenshoegarage.com). Local verification, real PostgreSQL CI, the complete remote staging workflow, Railway production, and exact-commit public smoke passed. Production startup confirms the existing reserved operator account is enabled, with identity and password preserved.

### Batch 5 implemented

- Temporary QR or 12-character code pairing for two distinct players using their own assigned approved characters in Live/Rehearsal events.
- Selected discovered readings, current public character identity, titles-only partner offers, and independent confirmation by both players. Empty offers create an introduction.
- Atomic completed contacts, reading copies, provenance, and journal receipts; canonical-original deduplication includes sharing a reading back to its original reader.
- Fixed 15-minute expiry, cancellation/rejection, changed-offer/policy confirmation resets, current access checks, and request replay returning current server state.
- Organizer sharing permissions. Existing adventures default to restricted; new complete starters seed RELIC/DEAD DROP as shareable. Organizer-only blocks new player reveals/overrides but preserves historical readings.
- Independently copied rehearsal policies and exchange-aware reset. No sessions, contacts, receipts, or progress are copied from the source event.
- Memory-only pending offers/requests, explicit uncertain-request retry, server-backed resume, and completed journal archival through the existing permission-filtered path. No offline exchange queue.
- Additive migration 006 with six sharing/exchange tables; existing schema-5 adventure and earlier account/event/character data are retained.

No inventory, money, skills, flags, or adventure progression transfers. Briefing-pack format 1 remains setup/material only and excludes sharing policies, exchanges, contacts, receipts, characters, and adventure state. Eight gameplay instruments remain planned; Batch 6 is next.

### Batch 5 release verification

| Check | Recorded result |
| --- | --- |
| Sharing HTTP/PGlite suite | Six tests passed: authorization, strict versions/input, lifecycle, confirmation resets, organizer-only/history boundaries, starter/copy policies, and populated rehearsal cleanup |
| Adventure regression suite | Eleven tests passed after policy integration |
| QR/offline targeted suite | 21 tests passed |
| Local `npm run verify` | 131 tests: 129 passed, zero failures, two deliberate TCP-only skips; syntax/assets passed |
| Exchange engine suite | 13 tests: 12 passed, one TCP-only skip locally |
| Full app DOM/API smoke | Nine flows passed with zero uncaught JavaScript errors using actual app modules, HTTP/PGlite, and IndexedDB |
| Focused exchange UI checks | Six checks passed |
| Local HTTP staging rehearsal | All prior three-theme adventure paths plus exchanges and completed-exchange rehearsal reset passed: 188 reads, 237 writes |
| Sharing source syntax and whitespace | Passed |
| [Main CI 34002025263](https://github.com/GreenShoeGarage/Oracle/actions/runs/34002025263) | Passed at the exact release commit |
| [Staging CI 34002025408](https://github.com/GreenShoeGarage/Oracle/actions/runs/34002025408) | Verification and complete deployed workflow passed |
| PostgreSQL 18 suite | 131 tests: 130 passed, zero failures, one PGlite-only snapshot skip; both TCP race tests passed |
| Recovery/runtime gates | Real populated-table dump/restore, migration preservation, startup, and running production Docker checks passed |
| [Remote staging job 101402565229](https://github.com/GreenShoeGarage/Oracle/actions/runs/34002025408/job/101402565229) | New exchanges, all three adventures, completed-exchange rehearsal reset, and disposable-data cleanup passed |
| [Production CI 34002163969](https://github.com/GreenShoeGarage/Oracle/actions/runs/34002163969) | Exact release commit, v0.5.0/schema 6 readiness, and 31 public GET checks passed; no accounts/events/mutations created |

The full app checks cover temporary QR and explicit joining, no peer reading body before both confirmations, changed-offer resets, unsaved-navigation guards, lost-confirmation retry with the identical request UUID, exactly two receipts/contacts, journal persistence, and character-reassignment cache removal. Sharing controls also passed change/discard-guard/save against the actual API. Both tests skipped locally passed against real PostgreSQL TCP in CI. CI skips only the PGlite-specific snapshot test, replacing it with the real dump/restore gate.

The 188 reads/237 writes describe the local staging rehearsal only. The remote workflow passed independently on the exact release commit. Physical phones, mobile-camera consent, authenticated real-browser workflows, actual service-worker inspection, load measurement, and a human field pilot remain unverified.

### Batch 5 deployment record

| Target | Project ID | Deployment ID | Result |
| --- | --- | --- | --- |
| [Staging](https://oracle-production-488d.up.railway.app) | `4e75d5ec-f8e9-492d-ae75-e0d44428d24a` | `82cc4760-efba-490a-a36d-d32e706c4218` | v0.5.0/schema 6 success; complete workflow passed |
| [Production](https://oracle.greenshoegarage.com) | `d1989864-9a40-4176-a9d3-203a06c4bd72` | `0dcec31f-a368-4fb8-883b-5a4dcb9ad47f` | v0.5.0/schema 6 success; exact-commit production smoke passed |

Staging and production remain separate Railway projects with separate PostgreSQL services, credentials, and volumes. Production uses the canonical custom domain and dedicated `production` branch; exact-commit CI/staging checks must pass before promotion. See [DEPLOYMENT.md](DEPLOYMENT.md).

Production logs at 00:46:50 UTC on September 6 confirmed migration 6 and a matching existing operator account. At 00:46:55 UTC startup confirmed v0.5.0 in production and `accountExists: true`, `enabled: true`. Idempotent provisioning preserved the existing UUID/password. The [production smoke job 101402849264](https://github.com/GreenShoeGarage/Oracle/actions/runs/34002163969/job/101402849264) passed readiness and all 31 public checks between 00:47:00 and 00:47:03 UTC. Runtime branches use the same checked release commit; subsequent documentation commits do not change that deployment. No private email, user identifier, setup secret, or password appears in these documents.

### Batch 5 recorded limits

- Scheduled production backups remain unconfigured. Railway HOBBY effective limits report `maxBackupsCount: 0`; no external runner is configured. Disposable CI restore tests and briefing packs do not back up live event data.
- After schema 6 migration, v0.4.0/schema 5 and earlier binaries are incompatible rollback images. Preserve data and use a tested schema-6-compatible roll-forward fix.
- Saved readings may reflect stale permissions while disconnected. They are read-only and cleared on account changes or known revocation; pending exchanges require connectivity and current authorization.
- Physical-device/camera, authenticated real-browser/mobile, load, and human field testing remain future gates. Automated HTTP, DOM, and storage tests do not substitute for them.
