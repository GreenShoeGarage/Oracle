# ORACLE v0.3.0 — Batch 3 release status

Recorded September 5, 2026.

Source: [GreenShoeGarage/Oracle](https://github.com/GreenShoeGarage/Oracle). Candidate application `0.3.0`; database schema `4`; event-pack format `1`. Batch 3 is implemented and undergoing verification. Production's last verified release is `537c17443947694664499d91007c289bdfc2ac6d` (v0.2.0, schema 2).

## Batch 3 implemented

- Guided character creation: Identity, Abilities, Kit & goals, Review; optional resized portrait, pronouns, biography, faction, event-bound attributes/skills, private objectives, and starting equipment.
- Per-event creation/approval policy and 1–10 active-character limits, organizer reviews/change requests, prewritten assignments, and explicit public identity fields.
- Private sheets and independently stored inventory. First approval initializes starting equipment once; reapproval does not refill or duplicate it. Organizers control later inventory changes.
- Printable public QR badges with camera, image, and manual-code lookup; same-event access checks, code rotation, retirement, and immediate access revocation. Camera/photo decoding is local and camera access requires a user action.
- Cross-event copies create new Drafts under destination rules with new character/badge IDs and reset gameplay data.
- Operator-provisioned project superuser, all-event management, account search, enable/disable, session revocation, and project audit history. Existing selected accounts/passwords are preserved; claiming an absent reserved account requires an operator-held setup secret.
- Additive migrations 003/004 preserve prior accounts and event data while introducing administration and character tables.

Existing accounts, themes, event setup, briefing views, invitations, and lifecycle tools remain supported. Format-1 event packs still contain setup/briefing data only. All twelve planned gameplay instruments, selected-information exchange, trading, automatic challenge resolution, offline synchronization, and complete adventures remain later batches. Batch 4 is next.

## Candidate verification

Local API, model, security, QR, and regression verification is in progress; final candidate totals will be recorded after the complete suite finishes. The expanded staging checker passed a local HTTP rehearsal (51 read requests and 52 writes), covering the existing setup workflow plus two-character approval, badge privacy/rotation, prewritten assignment, inventory/reapproval, and cross-event copying. This rehearses the checker, not the remote deployment.

Batch 3 authenticated real-browser workflow verification has not been performed. The previously passed Batch 2 Chromium checks do not establish coverage of the new character/admin interface. DOM checks, public browser inspection, real PostgreSQL CI, the full exact-commit remote staging journey, and production verification will be recorded only when actual results are available. Representative physical-device scanning and a human field pilot remain future gates.

The recovery rehearsal now includes actual character, inventory, faction, settings, and administration fixture records. Source availability is not a claim that the candidate CI/recovery run has passed.

## Last verified deployment

| Target | Project ID | Batch 2 deployment ID | Verified baseline |
| --- | --- | --- | --- |
| [Staging](https://oracle-production-488d.up.railway.app) | `4e75d5ec-f8e9-492d-ae75-e0d44428d24a` | `e8b1aef5-0b88-4069-bac3-a138b831ce1d` | v0.2.0; full two-account workflow passed |
| [Production](https://oracle.greenshoegarage.com) | `d1989864-9a40-4176-a9d3-203a06c4bd72` | `d8e09f12-373d-4201-911f-8bd7365a3e12` | v0.2.0; exact-commit public smoke passed |

Batch 2 passed [main CI 33996969465](https://github.com/GreenShoeGarage/Oracle/actions/runs/33996969465), [staging CI 33996970033](https://github.com/GreenShoeGarage/Oracle/actions/runs/33996970033), and [production smoke 33997027349](https://github.com/GreenShoeGarage/Oracle/actions/runs/33997027349), closing the original interrupted authenticated staging gate. These are baseline results, not Batch 3 deployment evidence.

Each Railway project uses a separate PostgreSQL 18 service, credentials, persistent volume, and default environment named `production`. Staging uses `APP_ENV=staging`; production's canonical origin is `https://oracle.greenshoegarage.com`. `main` is for integration, `staging` deploys tests, and `production` advances only to the exact commit already checked by CI and staging. Production smoke waits for the promoted commit/version/schema using public GET checks. See [DEPLOYMENT.md](DEPLOYMENT.md).

## Remaining operational limits

- Scheduled production backups are not configured. Railway's effective HOBBY limits report `maxBackupsCount: 0`; no external backup runner is configured. CI recovery tests do not protect live data, and event packs do not contain character, account, or history records.
- Schema 4 cannot use schema-1-only v0.1.0 or schema-2-only v0.2.0 rollback images. Preserve migrated data and roll forward with a tested schema-4-compatible fix.
- Unsaved drafts live in page memory until explicitly saved; server actions require connectivity. Public badges identify permitted characters and do not transfer information or inventory.
- Operator provisioning results for the candidate must be verified against the deployment; no configured private address, setup secret, or password is recorded in source.
