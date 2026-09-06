# ORACLE v0.5.0 — Batch 5 release status

Recorded September 6, 2026.

Source: [GreenShoeGarage/Oracle](https://github.com/GreenShoeGarage/Oracle). Release commit: `72cce5d6858c6b59b34b7c8c80bc874bb088e099`. Application `0.5.0`; database schema `6`; briefing-pack format `1`; adventure format `1`.

Batch 5 is deployed at [oracle.greenshoegarage.com](https://oracle.greenshoegarage.com). Local verification, real PostgreSQL CI, the complete remote staging workflow, Railway production, and exact-commit public smoke passed. Production startup confirms the existing reserved operator account is enabled, with identity and password preserved.

## Batch 5 implemented

- Temporary QR or 12-character code pairing for two distinct players using their own assigned approved characters in Live/Rehearsal events.
- Selected discovered readings, current public character identity, titles-only partner offers, and independent confirmation by both players. Empty offers create an introduction.
- Atomic completed contacts, reading copies, provenance, and journal receipts; canonical-original deduplication includes sharing a reading back to its original reader.
- Fixed 15-minute expiry, cancellation/rejection, changed-offer/policy confirmation resets, current access checks, and request replay returning current server state.
- Organizer sharing permissions. Existing adventures default to restricted; new complete starters seed RELIC/DEAD DROP as shareable. Organizer-only blocks new player reveals/overrides but preserves historical readings.
- Independently copied rehearsal policies and exchange-aware reset. No sessions, contacts, receipts, or progress are copied from the source event.
- Memory-only pending offers/requests, explicit uncertain-request retry, server-backed resume, and completed journal archival through the existing permission-filtered path. No offline exchange queue.
- Additive migration 006 with six sharing/exchange tables; existing schema-5 adventure and earlier account/event/character data are retained.

No inventory, money, skills, flags, or adventure progression transfers. Briefing-pack format 1 remains setup/material only and excludes sharing policies, exchanges, contacts, receipts, characters, and adventure state. Eight gameplay instruments remain planned; Batch 6 is next.

## Release verification

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

## Deployment record

| Target | Project ID | Deployment ID | Result |
| --- | --- | --- | --- |
| [Staging](https://oracle-production-488d.up.railway.app) | `4e75d5ec-f8e9-492d-ae75-e0d44428d24a` | `82cc4760-efba-490a-a36d-d32e706c4218` | v0.5.0/schema 6 success; complete workflow passed |
| [Production](https://oracle.greenshoegarage.com) | `d1989864-9a40-4176-a9d3-203a06c4bd72` | `0dcec31f-a368-4fb8-883b-5a4dcb9ad47f` | v0.5.0/schema 6 success; exact-commit production smoke passed |

Staging and production remain separate Railway projects with separate PostgreSQL services, credentials, and volumes. Production uses the canonical custom domain and dedicated `production` branch; exact-commit CI/staging checks must pass before promotion. See [DEPLOYMENT.md](DEPLOYMENT.md).

Production logs at 00:46:50 UTC on September 6 confirmed migration 6 and a matching existing operator account. At 00:46:55 UTC startup confirmed v0.5.0 in production and `accountExists: true`, `enabled: true`. Idempotent provisioning preserved the existing UUID/password. The [production smoke job 101402849264](https://github.com/GreenShoeGarage/Oracle/actions/runs/34002163969/job/101402849264) passed readiness and all 31 public checks between 00:47:00 and 00:47:03 UTC. Runtime branches use the same checked release commit; subsequent documentation commits do not change that deployment. No private email, user identifier, setup secret, or password appears in these documents.

## Remaining limits

- Scheduled production backups remain unconfigured. Railway HOBBY effective limits report `maxBackupsCount: 0`; no external runner is configured. Disposable CI restore tests and briefing packs do not back up live event data.
- After schema 6 migration, v0.4.0/schema 5 and earlier binaries are incompatible rollback images. Preserve data and use a tested schema-6-compatible roll-forward fix.
- Saved readings may reflect stale permissions while disconnected. They are read-only and cleared on account changes or known revocation; pending exchanges require connectivity and current authorization.
- Physical-device/camera, authenticated real-browser/mobile, load, and human field testing remain future gates. Automated HTTP, DOM, and storage tests do not substitute for them.
