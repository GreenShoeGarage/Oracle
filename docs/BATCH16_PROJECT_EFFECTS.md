# ORACLE Batch 16 — Project contributions and consequences

Version target: **v1.6.0**  
Database schema: **14**  
Status: **implemented on `main`; not yet promoted to production**

Batch 16 connects Community Projects to selected authoritative ORACLE activity without introducing a generic automation engine. A project can now accept server-verified evidence, player-confirmed resource donations, and ordinary staff-reviewed narrative contributions through one completion evaluator. Project completion may then create only a bounded set of authored consequences.

## Player experience

Community Projects remains the single workspace. No new top-level instrument was added.

A milestone can use one of three contribution modes:

- **Staff-reviewed** — the Batch 15 workflow. A player submits a short narrative contribution and staff accepts or declines it.
- **Verified evidence** — the player explicitly selects an eligible record already owned by their current character. ORACLE validates it server-side and credits it immediately when valid.
- **Resource donation** — the player sees the current balance, chooses an exact quantity, confirms the debit, and receives project credit in the same database transaction.

Eligible evidence adapters in this release are intentionally small:

- original **RELIC** discoveries from the character's adventure journal;
- original **DEAD DROP** discoveries from the character's adventure journal;
- successful **SIGIL** outcomes owned by that account-character assignment;
- completed **OATHBOOK** agreements in which that account-character assignment participated.

Receiving somebody else's copied information does not become a new original discovery and cannot be passed off as that player's evidence source.

## Resource donation contract

A resource donation uses the existing economy balance, transaction, and receipt system.

Before committing, ORACLE rechecks the current account, approved character assignment, event access and lifecycle, open project, milestone mode, resource identity, current balance, and the remaining number of units required by that milestone.

The resource debit, economy transaction, economy receipt, accepted project contribution, milestone assessment, and any resulting project completion are committed atomically. If any part fails, the donation does not partially apply.

The project row serializes competing final contributions. Once a resource milestone has no remaining requirement, later donations fail without charging the player. A request that asks to donate more than the remaining requirement also fails before debit.

## Retry and reuse rules

Player evidence and donation mutations require a stable UUID request identity.

An exact retry returns the already committed contribution rather than repeating it. Reusing the same request identity with a different character, milestone, evidence source, evidence type, or donation quantity conflicts.

Accepted evidence is unique by project/source pair. The same authoritative evidence source cannot accidentally count twice toward one project, even with a different request identity.

## Bounded consequences

Organizers can configure two consequence types before project completion:

### Prepared content unlock

A short authored title/body becomes readable only after the project completes and only to its declared audience. The initial audience types are the entire event or an explicit character list.

### BROADSIDE draft

Project completion may create one ordinary unpublished BROADSIDE-compatible bulletin draft. It does **not** publish automatically. Existing organizer review and publication rules still apply.

Consequences receive durable effect records. The one-time project completion receipt prevents retry, correction, or later review changes from creating the same consequence twice.

Batch 16 deliberately does not include arbitrary scripts, webhooks, general event automation, or automatic publication.

## Corrections and refunds

An organizer may issue an explicit refund for a committed resource donation. A refund:

- creates a separate `project_refund` economy transaction and economy receipt;
- returns the original quantity to the original character's resource balance;
- records the authorized actor and reason;
- marks the contribution superseded rather than deleting history;
- cannot run twice for the same contribution;
- cannot overflow the maximum resource balance.

A correction after project completion does not silently reopen the project or replay/retract its already recorded consequences. Published information remains subject to its own existing publication/correction workflow.

## Starter projects

The three Batch 15 starter projects are upgraded when installed in v1.6:

- **Fantasy — Restore the Border Lantern**
- **Cyberpunk — Bring the Neighborhood Relay Online**
- **Wasteland — Restore the Water Watch**

Each starter now includes:

1. a verified-evidence milestone;
2. a resource milestone when the event has at least one economy resource, otherwise a safe staff-reviewed fallback;
3. a staff-reviewed shared-participation milestone;
4. one prepared content unlock;
5. one BROADSIDE draft consequence.

Reinstalling a starter may upgrade an untouched pre-v1.6 starter. A starter with contribution history or completed state is not silently reinterpreted.

## Offline behavior

The v1.6 immutable public shell includes the Community Projects and Batch 16 integration interfaces.

Authoritative evidence submission, resource donations, refunds, milestone-rule changes, and consequences remain connected-only actions. Previously prepared Community Project snapshots remain dated historical copies; they do not authorize spending or contribution while disconnected.

## Persistence

Schema 14 adds Batch 16 fields/tables without rewriting Batch 15 project records:

- contribution mode, resource binding, and eligible-evidence list on project milestones;
- contribution kind, units, source identity, and economy transaction link on project contributions;
- `community_project_consequences`;
- `community_project_effects`;
- `community_project_refunds`;
- project donation/refund transaction kinds in the existing economy ledger.

Existing projects default to `reviewed`, so their behavior remains unchanged until explicitly configured or a v1.6 starter is installed/upgraded.

## Verification gates

The implementation has dedicated automated coverage for the full mixed-mode chain:

**verified evidence → atomic resource donation → staff-reviewed narrative contribution → one-time project completion → content unlock + BROADSIDE draft → explicit refund without reopening/replaying completion.**

The normal ORACLE release gate also covers the complete application regression suite, a 100-authenticated-player isolated PostgreSQL workload, database backup/restore including all Batch 16 tables, repeat schema migration and startup, exact production-image build, and production-session configuration.

Automated verification does not constitute a human LARP field pilot, physical-device/offline acceptance, or sustained Railway capacity measurement.
