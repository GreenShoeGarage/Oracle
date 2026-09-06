# ORACLE v0.11.0 — Batch 11 candidate status

Recorded September 6, 2026.

Source: [GreenShoeGarage/Oracle](https://github.com/GreenShoeGarage/Oracle). Application `0.11.0`; database schema `10`; briefing/adventure formats `1`; browser journal archive version `2`. Batch 11's usability and pilot-preparation implementation is complete. The candidate's exact GitHub/PostgreSQL and load gates, Railway staging, full remote all-twelve/all-three-theme workflow, and production verification are pending. The last verified live release remains Batch 10 commit `466b470eb6902fd84e903a0fbb1415b7f7a4fa8e`. Actual human/physical-device acceptance has not occurred and remains blocked until people and devices are available.

## Batch 11 implemented

- Two clear entry paths for players and organizers; event next steps use current authorized event/character facts, with player guidance retained in organizer preview.
- Three immediate actions and collapsed specialist tools, plain action labels, and explanations distinguishing invitation, character badge, prop, and exchange codes.
- 44-pixel touch targets, adjustable text size, narrow-screen wrapping, outdoor/forced-colors support, and retained reduced-motion/audio alternatives.
- Root focus preservation, visible loading state, actionable retry after failures, and protection against connection changes discarding active form text.
- Successful self-leave clears the affected event from both saved-readings and Field desk stores. Hash navigation guards unsaved Field desk work. Clearing all saved device data asks for confirmation and accurately describes its local effect.
- A dependency-free local pilot template/validator with 58 required human/device observations, evidence metadata, explicit not-run/pass/fail/blocked states, and findings that cannot schedule away unresolved critical defects.
- A bounded 100-authenticated-player isolated PostgreSQL load rehearsal with measured latency/concurrency, integrity checks, and disposable cleanup. The full capacity run is pending exact-candidate CI; the small lifecycle test is not that measurement.
- No SQL, pack, archive-format, or gameplay API-contract change. Existing operator identity/password and all persisted event data must remain preserved.

## Batch 11 candidate verification

| Check | Recorded result |
| --- | --- |
| Root DOM/API walkthrough | Nine groups passed with zero uncaught errors using actual modules and local HTTP state; does not establish physical-browser behavior |
| Next-step guide | Five focused tests passed |
| Pilot report validator | Eight focused tests passed; no actual human pilot was run |
| Load tooling | Four focused tests passed, including a two-player lifecycle and bounded non-forced cleanup; 100-player capacity measurement pending exact CI |
| Readability audit | 31 calculated color pairs passed; eleven kit checks passed; physical outdoor/assistive-device acceptance remains unrun |
| Full local `npm run verify` | Passed: 306 tests, 294 passed, zero failures, 12 deliberate TCP-only skips; complete footer and exit 0 recorded, duration 145,383 ms; syntax/version/static asset checks passed before the subsequent load-cleanup fix |
| Exact-release main PostgreSQL CI | First attempt passed the 306-test PostgreSQL suite, then failed in load-runner cleanup; corrected-candidate CI remains pending, including accepted load, populated recovery, startup, and production-image checks |
| Exact-release staging PostgreSQL CI | Pending after main succeeds |
| Railway staging and remote workflow | Pending; retain all twelve instruments in all three themes, copied play/reset, current authorization, and cleanup |
| Railway production and public smoke | Pending after staging succeeds; expect exact version/schema/commit readiness and 70 public GET routes, then record actual result |
| Human and physical-device pilot | Not run; actual iPhone/Android/desktop/shared-tablet, camera/install/offline/update and organizer/new-player observations required by [PILOT.md](PILOT.md) |

The first candidate (`9439760`) reached [main CI 34038258200](https://github.com/GreenShoeGarage/Oracle/actions/runs/34038258200), [verification job 101500202414](https://github.com/GreenShoeGarage/Oracle/actions/runs/34038258200/job/101500202414). Its PostgreSQL suite passed 306 tests (305 passed, zero failures, one PGlite-only skip), but the new isolated load runner failed during disposable database cleanup: the pool's end promise resolved before its backend connection fully closed, and forced database removal triggered an unhandled PostgreSQL `57P01`. No complete `LOAD_REHEARSAL_RESULT` was emitted, so this attempt provides no accepted capacity result. Recovery, startup, and Docker gates did not run. Staging and production were not advanced and remain on Batch 10. The corrected runner waits for owned database connections to drain before plain removal, records unexpected pool errors safely, and passed all four focused load-tool checks; corrected exact-candidate CI remains pending; the measured workload, environment guards, and release gates are unchanged.

Main is checked first so a failing new load gate cannot trigger a staging release. Only the same exact verified candidate may advance to staging, then production after complete remote acceptance. A successful push is not deployment evidence.

## Batch 11 acceptance still outstanding

- Complete the 58 actual observations in [PILOT.md](PILOT.md), including all twelve instruments in every theme, event closure, two-device offline/ambiguous retries, shared-device account privacy, installation/cameras, and accessibility. Automated DOM/HTTP/storage tests cannot substitute for those observations.
- Record the 100-player isolated measurement only after the actual run. It is CI-laboratory capacity for the documented workload/configuration, not a Railway production capacity claim or a human event.
- Resolve/recheck critical findings; schedule other accepted findings with an owner, reason, and target. Required failed or blocked checks remain blockers even when a finding is scheduled.
- Scheduled live database backups remain unavailable/unconfigured under the existing Railway plan. Disposable recovery tests do not create a live backup.
- Batch 12 release preparation may proceed, but final beta/human acceptance and any production-capacity claim remain conditional on actual evidence.

---

## Previous verified release — ORACLE v0.10.0 / Batch 10

Recorded September 6, 2026.

Source: [GreenShoeGarage/Oracle](https://github.com/GreenShoeGarage/Oracle). Application `0.10.0`; database schema `10`; briefing-pack/adventure formats `1`. Release `466b470eb6902fd84e903a0fbb1415b7f7a4fa8e` passed both exact-commit GitHub/PostgreSQL CI jobs, Railway staging, the complete remote all-twelve/all-three-theme workflow, and Railway production. Exact production readiness plus 68 public GET paths passed. Batch 10 is fully deployed at [oracle.greenshoegarage.com](https://oracle.greenshoegarage.com). The existing enabled operator retained identity/password. Actual physical-device and human field acceptance remain outstanding for Batch 11.

## Batch 10 implemented

- Field desk with explicit local Save for player-authored field notes, minimal last-checked own approved-character/event context, account/event generations, cross-tab invalidation, and visible storage failures. Other authoring forms remain in page memory.
- A bounded local queue for invitation creation, joining, and reading-only offers. Every payload retains its original UUID and account scope; no assets, confirmations, protected reveals, scene actions, timers, or administrative writes are queued.
- Explicit review before each send/retry, fresh session/ownership/policy checks, expected-account server binding, separate pending/uncertain/review/confirmed-request states, and once-only server replay. Reconnect never sends or confirms automatically.
- Safe discard before first transmission; attempted requests can stop local retries without claiming server cancellation. Local request expiry requires review; server invitations may expire sooner.
- Same-origin install manifest/icons, complete versioned public cache, bounded connection handling, and explicit update application with an unsaved-work warning and protection for other active tabs.
- Camera/photo/manual-code recovery and current-authorized player/organizer paper fallback aids with historical timestamps and minimal default content.
- No SQL migration or pack-format change. All ten migrations and populated schema-10 recovery expectations remain intact. The browser journal archive advances to IndexedDB version 2 using the same stores and retained readings, blocking legacy version-1 writers. Compatible recovery also requires this local storage boundary and the information-only/account-binding API and stable replay contract.

## Batch 10 verification

| Check | Recorded result |
| --- | --- |
| Complete local staging HTTP rehearsal | Passed 1,075 reads / 1,155 writes using the actual script and disposable HTTP/PGlite app; all twelve instruments in all three themes, guarded create/join/offer replay, session invalidation/relogin, stale terms/current policy, rejected assets, unchanged inventory/balances, one-time receipts, revoked membership, copied play/reset, and cleanup |
| Focused information-only exchange HTTP | Seven passed; existing exchange suite fourteen passed with one deliberate TCP-only skip |
| Schema/recovery audit | No migration required; migrations 001–010 unchanged; retain full enabled operator and all populated schema-10 fixture records, including 28 economy/instrument/operations tables |
| Full local `npm run verify` | Passed: 290 tests, 278 passed, zero failures, 12 deliberate TCP-only skips; complete footer and exit 0 recorded, duration 280,284 ms; syntax/version/static asset checks passed |
| Field storage and sync | Ten store checks and five sync checks passed |
| Independent HTTP/shared IndexedDB integration | Ten checks passed with real HTTP/PGlite and shared IndexedDB fixtures, including isolated account sessions, replay, lease contention, expiry, conflicting terms/policy, and revocation |
| Field/exchange browser modules | Eight Field desk UI checks and four exchange UI checks passed |
| Full application DOM/API walkthrough | Nine groups passed with zero uncaught errors using actual root modules and the real local API |
| Connection transport | Three checks passed |
| Public cache, QR, and install modules | Twenty-one offline/cache checks, fourteen QR checks, and four install checks passed (39 total), including the legacy-archive upgrade/preservation fixture |
| [Main CI 34013678298](https://github.com/GreenShoeGarage/Oracle/actions/runs/34013678298) | Exact release [verification job 101433703601](https://github.com/GreenShoeGarage/Oracle/actions/runs/34013678298/job/101433703601) passed |
| [Staging CI 34013678237](https://github.com/GreenShoeGarage/Oracle/actions/runs/34013678237) | Exact release [verification job 101433703490](https://github.com/GreenShoeGarage/Oracle/actions/runs/34013678237/job/101433703490) passed |
| PostgreSQL 18.6 and recovery/runtime gates | Both jobs passed 290 tests: 289 passed, zero failures, one PGlite-only snapshot skip; all twelve TCP gates, actual populated schema-10 dump/restore, repeated migration, startup, and Docker secure-cookie/graceful-stop checks passed |
| Railway staging deployment | `440e3c45-0684-4081-8b35-66d0ad3cf0b5` succeeded on exact release v0.10.0/schema 10 |
| [Remote staging job 101433847153](https://github.com/GreenShoeGarage/Oracle/actions/runs/34013678237/job/101433847153) | Exact-release complete all-twelve/all-three-theme workflow passed, including field requests, revocation/replays, actual copied play/reset, and cleanup |
| Public desktop browser observation | Staging sign-in page loaded v0.10.0; zero ORACLE application console errors, one unrelated extension-metadata error; no offline/installation or physical-device acceptance inferred |
| [Production CI 34014040708](https://github.com/GreenShoeGarage/Oracle/actions/runs/34014040708) | [Public smoke job 101434651182](https://github.com/GreenShoeGarage/Oracle/actions/runs/34014040708/job/101434651182) passed exact release/version/schema readiness plus 68 public GET paths (69 PASS lines total); no production gameplay writes |

The local HTTP run checks the original server invitation deadline and invalidated sessions without an artificial expiry sleep. The passing controlled storage/integration fixtures cover local expiry and ambiguous request outcomes. PGlite, DOM, and shared IndexedDB simulations are automated evidence, not real concurrent PostgreSQL lock waits, isolated installed browser profiles, physical devices, or a human event.

## Batch 10 deployment record

Railway staging deployment `440e3c45-0684-4081-8b35-66d0ad3cf0b5` succeeded at 05:19:32 UTC on September 6. Startup confirmed schema 10 at 05:19:25 and `server_ready` v0.10.0 in staging at 05:19:30. No SQL migration was added; existing migration history remained at 10. The staging operator is absent as configured; this does not describe production's separately provisioned operator. Both verification jobs passed on `466b470eb6902fd84e903a0fbb1415b7f7a4fa8e`; the complete remote workflow and independent production gate passed. Remote readiness passed at 05:20:31 UTC. Fantasy/cyberpunk/wasteland field journeys passed at 05:22:16/05:23:57/05:25:35; membership-revocation/replay checks at 05:22:32/05:24:12/05:25:50; complete starter paths at 05:22:33/05:24:13/05:25:51. Actual copied play/reset and all twelve instruments in every theme passed. Cleanup finished at 05:25:55 UTC.

Production deployment `1e402c0f-5db1-4700-a97d-57678e31d498` succeeded on the same release at 05:28:12 UTC. At 05:28:04, logs confirmed migration history remained at 10 and `superuser_provisioned` reported `matched: true`. At 05:28:08, `server_ready` confirmed v0.10.0 production and `superuser_status` reported `accountExists: true`, `enabled: true`. The [production smoke job 101434651182](https://github.com/GreenShoeGarage/Oracle/actions/runs/34014040708/job/101434651182) passed exact SHA/version/schema readiness at 05:28:16 and all 68 public GET paths through 05:28:24 (69 PASS lines including readiness). No production account, event, or gameplay data was created. Existing operator identity/password remained intact. Both runtime branches retain `466b470eb6902fd84e903a0fbb1415b7f7a4fa8e`; the final documentation update is main-only.

## Current limits and recovery position

- Actual two-device offline/reconnect acceptance, representative iPhone/Android installation and cameras, real service-worker inspection, human field pilot, and measured load remain outstanding for Batch 11. The available browser tool lacks isolated-context and offline-network controls; automated HTTP/DOM/storage checks do not close that gap.
- Scheduled live backups remain unconfigured: Railway HOBBY reports `maxBackupsCount: 0`, and no external runner is configured. Disposable recovery tests do not back up live event data.
- Field desk saves only explicit field notes and the three allowed information-only request kinds. It does not synchronize all authoring forms, trade assets, or live instrument actions. Confirmation and all game effects require the authoritative server.
- Local data is historical and device-specific. Disconnected clients cannot learn a remote revocation until reconnecting; known logout/account/event invalidation clears scope, and blocked storage must not be presented as a successful save.
- Schema 10 remains required. v0.9 uses the same schema but lacks v0.10's queued information-only/account-bound API. Use a tested compatible roll-forward fix that preserves request replay as well as records; schema equality alone does not justify rollback.

## Previous verified release — Batch 9

Recorded September 6, 2026.

Source: [GreenShoeGarage/Oracle](https://github.com/GreenShoeGarage/Oracle). Release commit `4133a6b51a9a4f2471723f88bd6d6f695a798b2a`; application `0.9.0`; database schema `10`; briefing-pack format `1`; adventure format `1`. STAGEHAND completes all twelve gameplay instruments. Both exact-commit GitHub/PostgreSQL CI runs, Railway staging, the complete remote all-twelve/all-three-theme workflow, and Railway production passed. All 56 exact-commit production public GET checks passed. Batch 9 is fully deployed at [oracle.greenshoegarage.com](https://oracle.greenshoegarage.com).

### Batch 9 implemented

- Versioned encounter configuration linked explicitly to WAYFINDER, private staff notes, public scene messages, scoped staff assignments, performer/prop/check-in acknowledgments, and explicit scene states.
- Whole-party waiting queues, self-queue with explicit acceptance, separate terms revisions, accepted membership snapshots, and atomic dispatch subject to current eligibility/readiness/capacity.
- Absolute server return deadlines and overdue display without automatic release; staff return/cancel acknowledgment, scene/event pauses, terminal scene cancellation with explicit whole-party redirect, and whole-event closure of all active assignments.
- Existing WAYFINDER attendance counted once and preserved across linking/return; managed direct joins require current dispatch and readiness. Operations do not spend assets or award progression.
- Operational BROADSIDE submissions requiring explicit organizer publication. Scene revisions suppress old operational notices and block stale draft approval.
- Themed player/prop views and manager/scoped staff forms, account/event guards, current server refresh, explicit uncertain-request replay, and no live operations cache or offline mutation queue.
- Planning/unlinked starter encounters in all three themes. Copies have fresh encounters and clear staff/runtime; actual rehearsal reset clears parties, acknowledgments, deadlines, activity, replay, and linked operational news while preserving source records.
- Additive migration 010 introduces five tables while preserving all nine old migration records, every populated schema-9 instrument table and earlier data, and the complete enabled operator row.

### Batch 9 verification

| Check | Recorded result |
| --- | --- |
| Legacy/foundation migration suite | 39 tests: 38 passed, zero failures, one existing TCP-only skip; full operator row, all nine prior migration records, all 23 populated schema-8/9 economy/instrument tables, and earlier data preserved |
| Populated recovery fixture | All 28 economy/instrument/operations tables populated and repeat schema-10 migration passed locally; includes current scoped readiness, accepted overdue dispatch, a separate returned party with fallback replay receipt, and approved announcement revision link; real PostgreSQL dump/restore passed in both exact-commit CI runs |
| Local full staging rehearsal | Passed 971 reads / 1,035 writes with all twelve instruments in fantasy, cyberpunk, and wasteland; staff privacy, legacy capacity, consent, cancelled-scene redirect, readiness/event pauses, exact dispatch deadline/replay, approved/current news, real copied play/reset, source preservation, event-end release, and cleanup |
| Focused STAGEHAND HTTP | Core 10 passed; party 10 passed |
| Focused browser modules | Main player/prop UI 8 passed; manager/staff forms 14 passed |
| Existing integration and storage | 35 existing integration checks passed; kit 11 and offline 16 passed |
| Full application DOM/API walkthrough | Eight checks passed with zero uncaught errors using actual modules, HTTP/PGlite, and JSDOM |
| Concurrency fixtures | Four functional race-fixture bodies passed with PGlite; all four new forced PostgreSQL races and the existing eight TCP gates passed in both exact-commit CI runs |
| Full local `npm run verify` | 242 tests: 230 passed, zero failures, 12 deliberate TCP-only skips; syntax/version/static asset checks passed |
| [Main CI 34011392141](https://github.com/GreenShoeGarage/Oracle/actions/runs/34011392141) | Exact-commit [verification job 101427741583](https://github.com/GreenShoeGarage/Oracle/actions/runs/34011392141/job/101427741583) passed |
| [Staging CI 34011392922](https://github.com/GreenShoeGarage/Oracle/actions/runs/34011392922) | Exact-commit [verification job 101427743763](https://github.com/GreenShoeGarage/Oracle/actions/runs/34011392922/job/101427743763) passed; complete remote workflow passed |
| PostgreSQL 18 suite | 242 tests: 241 passed, zero failures, one PGlite-only snapshot skip; all twelve TCP gates passed |
| Recovery/runtime gates | Actual populated schema-10 pg_dump/pg_restore, all five new operations tables, repeated migration, startup, and production Docker image with secure cookies and graceful stop passed |
| [Remote staging job 101427891417](https://github.com/GreenShoeGarage/Oracle/actions/runs/34011392922/job/101427891417) | Exact-commit readiness and the complete all-twelve/all-three-theme workflow passed, including cleanup |
| [Production CI 34011709258](https://github.com/GreenShoeGarage/Oracle/actions/runs/34011709258) | Exact release commit, v0.9.0/schema 10 readiness, and all 56 public GET checks passed; no production accounts, events, or scenario mutations created |

Local HTTP counts describe isolated disposable testing, not deployed acceptance. PGlite exercises PostgreSQL semantics through one connection and does not prove real concurrent lock waits. The four new TCP gates cover competing last-seat dispatch, redirect/consent revision, restrictive scene state versus dispatch, and account revocation/reassignment. The existing eight TCP gates remain required. Both exact-commit CI runs compared all five new operations tables in a real dump/restore, including the captured consent, overdue dispatched party, separate returned party and fallback receipt, readiness actors, and approved-news link.

### Batch 9 deployment record

| Target | Deployment ID | Result |
| --- | --- | --- |
| [Staging](https://oracle-production-488d.up.railway.app) | `29d0f779-c261-40bd-b344-9feda10edf7d` | Exact release v0.9.0/schema 10 succeeded; complete remote workflow passed |
| [Production](https://oracle.greenshoegarage.com) | `7ec0e7d5-0ea6-46e7-8d12-8ece92552fc2` | Exact release v0.9.0/schema 10 succeeded; all 56 public GET checks passed |

Staging logs confirmed migration 10 at 04:24:11 UTC and v0.9.0 `server_ready` in staging at 04:24:17 UTC on September 6. Remote exact-commit readiness passed at 04:25:23 UTC. Fantasy operations/copy-reset/event-end passed at 04:26:56/04:27:07/04:27:09, cyberpunk at 04:28:23/04:28:34/04:28:37, and wasteland at 04:29:51/04:30:03/04:30:06. The complete all-twelve/all-three-theme workflow and cleanup finished at 04:30:13 UTC. Staging and production use separate Railway projects/databases and operator configuration. Production passed its independent exact-commit public gate.

Production logs confirmed migration 10 and the matching existing operator (`matched: true`) at 04:31:37 UTC on September 6. At 04:31:42 UTC, startup reported v0.9.0 in production and `superuser_status` with `accountExists: true`, `enabled: true`. Railway deployment `7ec0e7d5-0ea6-46e7-8d12-8ece92552fc2` succeeded at 04:31:45 UTC. The [production smoke job 101428568828](https://github.com/GreenShoeGarage/Oracle/actions/runs/34011709258/job/101428568828) verified exact release SHA/version/schema at 04:31:46 UTC and passed all 56 public GET checks through 04:32:23 UTC. Production verification created no account or event. The existing enabled operator retained identity/password through idempotent provisioning and additive migration preservation. Both runtime branches retain `4133a6b51a9a4f2471723f88bd6d6f695a798b2a`; final documentation updates are main-only.

### Batch 9 limits and recovery position

- Scheduled live backups remain unconfigured: Railway HOBBY reports `maxBackupsCount: 0` and no external runner is configured. Disposable restore rehearsals do not back up live event data.
- After migration 010, v0.8.0/schema-9 and earlier binaries are incompatible. Preserve upgraded data and use a tested schema-10-compatible roll-forward fix.
- Live encounter readiness, queues, consent, deadlines, availability, cooperative controls, fictional signals, shops, exchanges, and agreement actions require server confirmation. Existing permitted journal archives remain bounded at 1,000 entries/3 MB; there is no offline action queue or real-world sensor integration.
- Staff make the real in-person readiness, dispatch, and return decisions. Overdue never silently frees space, and shared prop views do not lower a signed-in organizer's privileges.
- Coordinated multi-device timing, physical phones/cameras, authenticated real-browser/mobile workflows, service-worker inspection on real devices, load measurements, and a human field pilot remain outstanding. HTTP/DOM/storage checks do not replace those gates.

## Previous verified release — Batch 8

Recorded September 6, 2026.

Source: [GreenShoeGarage/Oracle](https://github.com/GreenShoeGarage/Oracle). Application `0.8.0`; database schema `9`; briefing-pack format `1`; adventure format `1`. Release commit: `ef3d822c0e6a36fd0f1e3081b68f5d750d268106`. Both exact-commit PostgreSQL CI runs, Railway staging, the complete remote workflow, and Railway production passed. All 52 exact-commit production public checks passed. Batch 8 is fully deployed at [oracle.greenshoegarage.com](https://oracle.greenshoegarage.com).

### Batch 8 implemented

- SIGIL shared-device cooperation: captured in-person roles, ordered checkpoints and optional answers, active-time requirements, server timers, host item/resource requirements, and explicit outcomes.
- Atomic final checkpoint/component consumption/flags/journal, once-per-character success, request replay, failed/cancelled retry, and staff operations with reasons.
- Explicit host/event pauses and resume, a 20-second connectivity lease with monotonic heartbeats, fresh server state after reconnect, and no offline progression.
- STATIC prepared prop/zone readings, condition-driven state, bounded published staff choices, versioned overrides, and an explicit fictional label in every signal projection.
- Immutable account-bound collected signals and results, private draft/live publication separation, and current ownership/revocation checks.
- Theme-aware immersive prop presentation, optional local sound with visual equivalents, code printing, and camera/photo/manual entry.
- The same two-role/three-checkpoint starter appears as a fantasy ritual, cyberpunk relay procedure, or wasteland repair. Copies receive fresh prop codes and omit runtime/private state; reset clears actual rehearsal play while preserving authored definitions and the source event.
- Additive migration 009 introduces ten tables while preserving all eight prior migration records, populated schema-8 economy/agreement data, and the existing enabled operator's identity/password.

Eleven gameplay instruments plus Briefing are implemented. STAGEHAND is the next planned instrument in Batch 9. Shared-device roles are in-person performer labels; they do not authorize other characters or imply coordinated multi-device timing. Format-1 briefing/adventure contracts stay unchanged.

### Batch 8 release verification

| Check | Recorded result |
| --- | --- |
| Legacy/foundation migration suite | 38 tests: 37 passed, zero failures, one existing TCP-only skip; complete operator row, all 13 populated schema-8 economy/agreement tables, and all eight old migration records preserved |
| Populated recovery fixture | All 13 existing economy/agreement tables and all ten schema-9 tables contain valid constrained data; repeated schema-9 migration passed locally; actual dump/restore passed in both exact-candidate PostgreSQL CI runs |
| Local full staging rehearsal | Passed 392 reads / 466 writes, including all previous workflows, every-theme cooperation/fictional signal, final component rollback, one-time deduction, staff controls, actual copied play/reset, source preservation, and cleanup |
| Focused instrument HTTP suites | SIGIL 16 passed; STATIC 11 passed |
| Focused browser modules | SIGIL UI 10 passed plus a bounded published/draft authoring check; STATIC UI 8 passed; shared prop/code helpers 7 passed |
| Root integration and persistence checks | 35 existing integration checks passed; 29 kit/offline/component checks passed |
| Full application DOM/API walkthrough | Ten checks passed with zero uncaught errors using actual modules, HTTP/PGlite and JSDOM |
| Full local `npm run verify` | 217 tests: 209 passed, zero failures, eight deliberate TCP-only skips; syntax/version/static asset checks passed |
| [Main CI 34009469012](https://github.com/GreenShoeGarage/Oracle/actions/runs/34009469012) | Passed exact release commit; [verification job 101422627294](https://github.com/GreenShoeGarage/Oracle/actions/runs/34009469012/job/101422627294) |
| [Staging CI 34009469442](https://github.com/GreenShoeGarage/Oracle/actions/runs/34009469442) | Verification and complete remote workflow passed; [verification job 101422628280](https://github.com/GreenShoeGarage/Oracle/actions/runs/34009469442/job/101422628280) |
| PostgreSQL 18 suite | 217 tests: 216 passed, zero failures, one PGlite-only snapshot skip; all eight TCP gates passed, including duplicate SIGIL completion, competing outcomes, and contention with QR trades/purchases |
| Recovery/runtime gates | Actual populated schema-9 pg_dump/pg_restore, all ten new tables, repeated migration, startup, and production Docker image with secure cookies and graceful stop passed |
| [Remote staging job 101422758430](https://github.com/GreenShoeGarage/Oracle/actions/runs/34009469442/job/101422758430) | Exact-release readiness, every prior workflow, all three SIGIL/STATIC themes, final component rollback/once-only consumption, staff controls, actual copied play/reset, and cleanup passed |
| [Production CI 34009665773](https://github.com/GreenShoeGarage/Oracle/actions/runs/34009665773) | Passed exact release commit, v0.8.0/schema 9 readiness, and all 52 public GET checks; no production users, events, or mutations created |

The recovery fixture includes distinct draft/publication snapshots, captured role/component records, completed and paused runs with frozen timer state, immutable result consumption evidence, conditional fictional readings, later staff overrides, and history/replay records. The real PostgreSQL dump/restore gate compared all these tables in both candidate CI runs. The local HTTP request counts are not remote-deployment claims. The authenticated DOM walkthrough verifies actual modules/API state but does not replace physical device testing.

### Batch 8 deployment record

| Target | Deployment ID | Result |
| --- | --- | --- |
| [Staging](https://oracle-production-488d.up.railway.app) | `e8817d54-0bb8-458e-b862-cdf194e614bb` | Exact release v0.8.0/schema 9 succeeded; complete remote workflow passed |
| [Production](https://oracle.greenshoegarage.com) | `19c6b417-2e9d-4e74-9dc3-c7bc1ff34ec3` | Exact release v0.8.0/schema 9 succeeded; all 52 public checks passed |

Staging logs confirmed migration 9 at 03:38:14 UTC and v0.8.0 `server_ready` in staging at 03:38:17 UTC on September 6. The remote workflow passed final component rollback/atomic consumption at 03:40:11, fantasy SIGIL/STATIC at 03:40:12 and copied reset at 03:40:20, cyberpunk at 03:40:38 and copied reset at 03:40:43, and wasteland at 03:40:58 and copied reset at 03:41:03. All three themes and disposable-event/session cleanup completed at 03:41:09 UTC. Staging and production use separate Railway projects and databases. Production passed its independent exact-commit public gate.

Production logs confirmed `migrations_complete: 9` and `superuser_provisioned` with `matched: true` at 03:42:42 UTC on September 6. At 03:42:46 UTC, startup reported v0.8.0 in production and `superuser_status` with `accountExists: true`, `enabled: true`. The [production smoke job 101423150897](https://github.com/GreenShoeGarage/Oracle/actions/runs/34009665773/job/101423150897) verified the exact release commit/version/schema at 03:42:49 UTC and passed all 52 public GET checks through 03:42:57 UTC. Production checks created no accounts or event data. The matching existing operator remains enabled, with identity/password preserved by idempotent provisioning and the additive migration checks. Runtime branches retain the checked release commit; subsequent documentation commits are main-only.

### Batch 8 recorded limits and recovery position

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

Production logs confirmed `migrations_complete: 8` and `superuser_provisioned` with `matched: true` at 02:52:35 UTC on September 6. At 02:52:39 UTC, startup reported v0.7.0 in production and `superuser_status` with `accountExists: true`, `enabled: true`. The [production smoke job 101417500630](https://github.com/GreenShoeGarage/Oracle/actions/runs/34007575785/job/101417500630) verified the exact release commit/version/schema at 02:52:43 UTC and passed all 43 public GET checks from 02:52:43 to 02:52:48 UTC. Production checks created no accounts or event data. Runtime branches retain the checked release commit; subsequent documentation commits do not change the deployed application.

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

Production logs confirmed migration 7 and an existing matching superuser at 01:38:11 UTC on September 6. At 01:38:16 UTC, startup reported v0.6.0 in production and `accountExists: true`, `enabled: true`. Idempotent provisioning preserved the existing UUID/password. The [production smoke job 101408855825](https://github.com/GreenShoeGarage/Oracle/actions/runs/34004393610/job/101408855825) verified the exact commit/version/schema at 01:38:18 UTC and passed all 37 public checks between 01:38:19 and 01:38:23 UTC. Runtime branches retain the checked release commit; subsequent documentation commits do not change the deployed application.

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
