# Batch 19 — Organizer Command Deck

ORACLE v1.9.0 candidate · September 8, 2026 · SQL schema 15 unchanged

## Use

Open an event in Organizer view and select **Command Deck** in the sidebar or event overview. **Needs attention** shows operational work, grouped by category, with a checked timestamp and a manual refresh. Choose Review to open the existing source workflow. Character and bulletin items open their exact record; project links preserve the event/project and provide a return to the deck. Scene items open STAGEHAND's existing event-scoped operations view.

The summary reports enabled player memberships (not physical attendance), pending character approvals, unassigned characters, submitted contributions, open projects, and currently available managed encounters. Expand the project, scene, and story-guidance sections as needed. Empty queues do not certify that an event is ready to run.

## Authority and privacy

`GET /api/events/:eventId/command-deck` is the only added endpoint. It requires current owner, organizer, or project-superuser authority; ordinary staff continue to use their existing assigned tools. The main application's authentication, expected-account guard, error handling, and access clearing apply. Alternate audience/query parameters and all mutations are rejected.

The report is assembled in a repeatable-read, read-only transaction, with authority checked within the snapshot and again after it completes. No decisions, attendance, gameplay progress, publication, inventory, or audit activity are written by this GET.

The response excludes character biographies/private objectives, contribution bodies and evidence, bulletin bodies/truth, staff notes, private arc selections/progress/reflections, connection responses, and paired-history confirmations. Connection attention depends only on broken assignment/counterpart eligibility and does not depend on keep/dismiss/pause choices. Work counts are not player rankings or engagement scores.

## Source-of-truth rules

- Character approvals and assignments remain in Characters.
- Community projects count accepted distinct accounts, accepted contribution count, or accepted resource units according to the existing milestone rule. Pending work never counts. A historical completion receipt is shown as historical after corrections; reading the deck never completes or reopens a milestone.
- BROADSIDE lists drafts and submissions for deliberate editorial review, not automatic publication. Previous live text remains separate from a correction draft.
- STAGEHAND supplies availability, readiness, reserved capacity, blocked parties, and overdue return windows through its existing engine. Overdue parties are not returned or released automatically.
- Upcoming times are authored WAYFINDER start times. Starter guidance is optional run-sheet material, not generated plot or inferred player behavior.

Attention lists show at most 25 records per category while retaining their full counts. Project overviews show 50 projects; scene overviews show 25 encounters. Explicit overflow notices lead to the existing complete workspaces. The count is of work items; one record can require more than one kind of attention.

## Connected field behavior

Private deck reports live only in page memory and are sent with `Cache-Control: private, no-store`. They are not saved to browser storage or the service-worker cache. Disconnect, account change, event change, leaving the workspace, and permission errors clear the report. A failed refresh does not become a false zero or an apparently current cached report. Late responses cannot replace another account/event/view.

Opening the deck, manual refresh, foreground focus, and successful reconnection recheck server state. There is no interval polling or telemetry. Filters, open overview panels, and keyboard focus are preserved during an ordinary refresh. Display and install controls do not discard the checked deck. Switching to Player or Prop view closes the private deck before rendering the event preview. Field player preparation remains unchanged.

The immutable v1.9 shell includes the new renderer/styles and complete inherited module chain. A shared asset responder preserves one current release identity across all modules; the full-shell HTTP regression and remote shell-smoke gates remain enabled.

## Adjacent reliability correction

Project creation/review previously committed a transaction and then requested its detailed response from the pool while still holding the client. On a one-connection pool this can wait on itself; under contention it can also delay responses. The response now uses the already-held client after commit. Existing review, concurrency, and completion semantics are unchanged.

## Verification and release boundary

Dedicated tests exercise organizer/player/staff/outsider/superuser boundaries, expected-account protection, all three themes, cross-event isolation, queue reconciliation through actual approval/publication/review actions, resource-unit versus distinct-account counting, privacy, bounded responses, read-only SQL, mid-report demotion, paused/archived states, and overdue parties without mutation. UI tests cover escaping, original-workflow navigation, filters/focus, offline clearing, role failures, and late account/event responses. Three additional regressions exercise the actual main-app dispatcher for display controls, audience changes, event navigation, and connectivity checks.

Local full-application DOM/HTTP checks use a disposable PGlite-backed app for event deep links, exact character/bulletin navigation, return-to-deck, offline clearing, and reconnection. Chromium rendered the resulting markup in memory at 1440, 390, and 320 pixels with no horizontal overflow, including a forced-colors render. Browser network navigation was unavailable in the local environment, so that render is not a full real-browser network journey. Neither result establishes physical iPhone/Android, assistive-technology, or human field acceptance.

The standard release gates remain required: exact main CI; isolated PostgreSQL load, recovery, startup, and image checks; later exact staging deployment with the remote gameplay journey and shell checks; explicit production promotion; read-only public checks. Batch 19 adds all-theme Command Deck authorization and assignment-queue checks to that staging journey. Production promotion is a separate step.
