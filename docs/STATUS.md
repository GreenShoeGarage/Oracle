# ORACLE v0.5.0 — Batch 5 candidate status

Recorded September 6, 2026.

Source: [GreenShoeGarage/Oracle](https://github.com/GreenShoeGarage/Oracle). Candidate application `0.5.0`; database schema `6`; briefing-pack format `1`; adventure format `1`. The candidate commit and deployment evidence will be recorded after the remaining gates pass.

Batch 5 implementation and local verification are complete; real PostgreSQL CI, remote staging, and production promotion remain pending. [Production](https://oracle.greenshoegarage.com) remains on verified Batch 4 until the candidate passes those gates. The existing reserved operator account was last confirmed enabled during Batch 4, with identity and password preserved.

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

## Candidate verification

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
| Main/staging CI and real PostgreSQL recovery/runtime gates | Pending candidate commit and successful jobs |
| Exact-commit remote staging workflow | Pending |
| Railway production and public-only smoke | Pending promotion |

The full app checks cover temporary QR and explicit joining, no peer reading body before both confirmations, changed-offer resets, unsaved-navigation guards, lost-confirmation retry with the identical request UUID, exactly two receipts/contacts, journal persistence, and character-reassignment cache removal. Sharing controls also passed change/discard-guard/save against the actual API. The two local suite skips require PostgreSQL TCP; their CI results are still pending.

These are candidate-local results, not deployed-release evidence. Physical phones, mobile-camera consent, authenticated real-browser workflows, actual service-worker inspection, load measurement, and a human field pilot remain unverified.

## Most recent verified deployment

The Batch 4 runtime commit is `f3d77a5df4c3f130fc5a658c9d2d4e9753b1d7c1` (v0.4.0/schema 5). [Main CI 34000116757](https://github.com/GreenShoeGarage/Oracle/actions/runs/34000116757), [staging CI 34000116740](https://github.com/GreenShoeGarage/Oracle/actions/runs/34000116740), the remote three-theme adventure workflow, and [production CI 34000309961](https://github.com/GreenShoeGarage/Oracle/actions/runs/34000309961) passed on that commit.

| Target | Project ID | Batch 4 deployment ID | Result |
| --- | --- | --- | --- |
| [Staging](https://oracle-production-488d.up.railway.app) | `4e75d5ec-f8e9-492d-ae75-e0d44428d24a` | `f364f026-ca07-42b7-a5ad-668164e448ed` | v0.4.0/schema 5; complete adventure workflow passed |
| [Production](https://oracle.greenshoegarage.com) | `d1989864-9a40-4176-a9d3-203a06c4bd72` | `d785c33e-2dd4-4038-93f1-2e74180034cb` | v0.4.0/schema 5; 25 public GET checks passed |

Staging and production remain separate Railway projects with separate PostgreSQL services, credentials, and volumes. Production uses the canonical custom domain and dedicated `production` branch; exact-commit CI/staging checks must pass before promotion. See [DEPLOYMENT.md](DEPLOYMENT.md).

Batch 4 migration/startup logs confirmed the existing reserved operator account matched and was enabled. Provisioning remains idempotent and preserves that account's UUID/password. No private email, user identifier, setup secret, or password appears in these documents. Batch 5 startup will be checked independently before claiming a new deployment result.

## Remaining limits

- Scheduled production backups remain unconfigured. Railway HOBBY effective limits report `maxBackupsCount: 0`; no external runner is configured. Disposable CI restore tests and briefing packs do not back up live event data.
- After schema 6 migration, v0.4.0/schema 5 and earlier binaries are incompatible rollback images. Preserve data and use a tested schema-6-compatible roll-forward fix.
- Saved readings may reflect stale permissions while disconnected. They are read-only and cleared on account changes or known revocation; pending exchanges require connectivity and current authorization.
- Physical-device/camera, authenticated real-browser/mobile, load, and human field testing remain future gates. Automated HTTP, DOM, and storage tests do not substitute for them.
