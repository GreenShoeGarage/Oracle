# ORACLE v0.3.0 — Batch 3 release status

Recorded September 5, 2026.

Source: [GreenShoeGarage/Oracle](https://github.com/GreenShoeGarage/Oracle). Release commit: `12a34458de3bdbe0968e7d2b174ba441e7952d09`. Application `0.3.0`; database schema `4`; event-pack format `1`.

Batch 3 is deployed at [oracle.greenshoegarage.com](https://oracle.greenshoegarage.com). Main/staging verification, the complete remote two-player journey, Railway production deployment, and exact-commit production smoke passed. The reserved operator account is absent and awaits its owner's secure first registration; no replacement account or password was fabricated.

## Batch 3 implemented

- Guided character creation: Identity, Abilities, Kit & goals, Review; optional resized portrait, pronouns, biography, faction, event-bound attributes/skills, private objectives, and starting equipment.
- Per-event creation/approval policy and 1–10 active-character limits, organizer reviews/change requests, prewritten assignments, and explicit public identity fields.
- Private sheets and independently stored inventory. First approval initializes starting equipment once; reapproval does not refill or duplicate it. Organizers control later inventory changes.
- Printable public QR badges with camera, image, and manual-code lookup; same-event access checks, code rotation, retirement, and immediate access revocation. Camera/photo decoding is local and camera access requires a user action.
- Cross-event copies create new Drafts under destination rules with new character/badge IDs and reset gameplay data.
- Operator-provisioned project superuser, all-event management, account search, enable/disable, session revocation, and project audit history. Existing selected accounts/passwords are preserved; claiming an absent reserved account requires an operator-held setup secret.
- Additive migrations 003/004 preserve prior accounts and event data while introducing administration and character tables.

Existing accounts, themes, event setup, briefing views, invitations, and lifecycle tools remain supported. Format-1 event packs still contain setup/briefing data only. All twelve planned gameplay instruments, selected-information exchange, trading, automatic challenge resolution, offline synchronization, and complete adventures remain later batches. Batch 4 is next.

## Verified release evidence

| Check | Result |
| --- | --- |
| Local automated suite | 78 tests: 77 passed, 1 deliberate TCP-only skip |
| [Main CI 33998315491](https://github.com/GreenShoeGarage/Oracle/actions/runs/33998315491) | Verification passed on the release commit |
| [Staging CI 33998316104](https://github.com/GreenShoeGarage/Oracle/actions/runs/33998316104) | Verification and full deployed two-player workflow passed |
| GitHub PostgreSQL 18 suite | 78 tests: 77 passed, 1 PGlite-only snapshot skip; TCP password/session race passed |
| Recovery/runtime gates | Populated new and existing tables survived real `pg_dump`/`pg_restore`, including both audit identity sequences; startup and running production-image checks passed |
| [Production CI 33998406816](https://github.com/GreenShoeGarage/Oracle/actions/runs/33998406816) | Exact release commit, v0.3.0, schema 4, and public production checks passed |
| Local DOM/API workflow smoke | Six flows passed with zero JavaScript errors using real app modules, JSDOM, and the real PGlite-backed API |
| Public staging browser inspection | v0.3.0 at 1,363-pixel desktop width, with no horizontal overflow or app console errors |

The remote [staging smoke job 101392685517](https://github.com/GreenShoeGarage/Oracle/actions/runs/33998316104/job/101392685517) passed the existing event/theme/pack isolation journey plus two-character creation/submission/approval, public-field and badge privacy, badge rotation, one-time inventory initialization and reapproval preservation, prewritten assignment, malformed-write rejection, cross-event copies, and revoked character/badge access. Disposable events were archived and test sessions logged out. A prior local checker rehearsal passed 51 reads and 52 writes; the remote result is the release acceptance evidence.

The six local DOM flows covered sign-in and global navigation, administration search, account disable/enable, session revocation, all-event detail, and the complete four-step character creator through submission into Pending. This is DOM/API integration testing, not an authenticated real-browser test. Public desktop browser inspection does not establish mobile or physical-camera behavior. The automated QR suite exercises actual encode/decode and camera lifecycle; authenticated real-browser workflows, representative physical devices, and a human field pilot remain unverified for Batch 3.

## Deployment record

| Target | Project ID | Deployment ID | Result |
| --- | --- | --- | --- |
| [Staging](https://oracle-production-488d.up.railway.app) | `4e75d5ec-f8e9-492d-ae75-e0d44428d24a` | `bf6cf9aa-1097-4f89-80d7-734eb68ba13a` | Success at release commit; full two-player journey passed |
| [Production](https://oracle.greenshoegarage.com) | `d1989864-9a40-4176-a9d3-203a06c4bd72` | `39a3f289-7a8a-4dc1-be21-54cb425332a9` | Final configuration success at release commit; public smoke passed again |

The protected operator setup code is configured for claiming the reserved account. It is delivered separately from the public repository so the owner can create the account and choose their own password. The account has not yet been claimed or enabled as an existing user. Final configuration deployment `39a3f289-7a8a-4dc1-be21-54cb425332a9` succeeded on the same checked commit. Startup confirmed the reserved account is absent. The repeated [production smoke job 101393124457](https://github.com/GreenShoeGarage/Oracle/actions/runs/33998406816/job/101393124457) passed after that deployment (run attempt 2). The initial source deployment `b1f9c0c5-b205-4e92-b6ee-9f3b943a8d93` also succeeded. The reserved-account claim is ready; user activation is still pending.
Each Railway project uses a separate PostgreSQL 18 service, credentials, persistent volume, and default environment named `production`. Staging uses `APP_ENV=staging`; production's canonical origin is `https://oracle.greenshoegarage.com`. `main` is for integration, `staging` deploys tests, and `production` advances only to the exact commit already checked by CI and staging. Production smoke waits for the promoted commit/version/schema using public GET checks. See [DEPLOYMENT.md](DEPLOYMENT.md).

## Remaining operational limits

- Scheduled production backups are not configured. Railway's effective HOBBY limits report `maxBackupsCount: 0`; no external backup runner is configured. CI recovery tests do not protect live data, and event packs do not contain character, account, or history records.
- Schema 4 cannot use schema-1-only v0.1.0 or schema-2-only v0.2.0 rollback images. Preserve migrated data and roll forward with a tested schema-4-compatible fix.
- Unsaved drafts live in page memory until explicitly saved; server actions require connectivity. Public badges identify permitted characters and do not transfer information or inventory.
- The owner must complete the reserved operator account claim with the separately supplied setup code and choose a password. No configured private address, setup secret, or password is recorded in this repository.
