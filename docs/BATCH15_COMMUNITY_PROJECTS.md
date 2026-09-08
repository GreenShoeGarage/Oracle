# ORACLE Batch 15 — Community Projects

Release target: **v1.5.0** · schema **13**

Community Projects give an event a small set of shared goals with visible milestones and several ways to help. This release is deliberately narrative-first: it does not spend inventory, consume currency, or automatically convert instrument results into progress. Those verified effects remain Batch 16 work.

## Player experience

A published project shows its purpose, announced outcome, milestones, accepted collective progress, and contribution routes. Players choose an approved character, a milestone, and a route, then describe what they contributed. Submissions are visibly pending until staff accepts them. Players see their own submission history and can withdraw a still-pending submission.

Each starter project includes a lower-pressure route for notes, logistics, private suggestions, or other behind-the-scenes support. Starter milestones default to **distinct player accounts**, so several characters or several submissions from one person cannot satisfy a multi-person requirement.

Players can explicitly save a dated project snapshot on their device. The snapshot is read-back verified and clearly presented as historical reference material. It never authorizes a contribution and never claims to be current shared progress. Shared mutations require connectivity.

## Organizer and staff experience

Organizers can install one repeat-safe starter project for the event theme or author a custom project. New projects begin as drafts and become player-visible only when opened. Organizers can close an unfinished project. A completed project is historical and cannot be silently reopened.

Staff and organizers share a contribution review queue. Review decisions are version checked. Pending and declined work never count toward a milestone. Review notes are visible to the submitting player.

When a milestone reaches its requirement, ORACLE writes a durable milestone-completion receipt. When every milestone is satisfied, it writes one project-completion receipt and moves the project to completed. Exact retries cannot create a second completion. A later review correction remains recorded but does not silently reopen or re-complete historical project state.

## Starter projects

- **Fantasy — Restore the Border Lantern:** establish access, make a workable relighting plan, and arrange a shared watch.
- **Cyberpunk — Bring the Neighborhood Relay Online:** reach the relay, stabilize it, and establish how the neighborhood will use it.
- **Wasteland — Restore the Water Watch:** understand the damage, make the system workable, and arrange an ongoing watch.

## Privacy and counting boundaries

Player-facing project responses contain published project text, collective counts, and that player's own submissions. Organizer notes are not sent to players. Reviewers can see submitted contribution text because reviewing it is their explicit event role. There is no contribution leaderboard and no organizer engagement score.

Distinct-account milestones count accepted contributions by unique user account. The alternate `accepted_contributions` counting rule is available for organizer-authored milestones when the fiction genuinely calls for several separate acts rather than several people.

## Release checks

Batch 15 tests cover explicit/repeat-safe starter installation, player visibility boundaries, organizer-note privacy, stable request retries, pending-state exclusion, distinct-account counting, staff review permissions, completion receipts, non-reopening corrections, bounded withdrawal, and outsider denial. The v1.5 offline shell includes the complete v1.3/v1.4 wrapper chain plus the new project workspace so saved snapshots remain usable without a network connection.
