# ORACLE engagement roadmap

Planning revision 1.0 · September 7, 2026 · Proposed Batches 13–17

Status: planned, not implemented. The deployed baseline is v1.2.0. This document plans connection cards, personal character arcs, community projects, and small Fantasy/Cyberpunk/Wasteland starter packs. Version targets describe delivery order, not calendar commitments.

The player outcome is simple: someone to approach, a personal reason to care, and something meaningful to accomplish together. Keep these features in the existing character, event, and Field desk screens. Each is optional, and existing events retain their current behavior until an organizer enables or installs the relevant feature.

## Delivery sequence

| Batch | Target | Player-visible result | Relative scope |
| --- | --- | --- | --- |
| 13 | v1.3 — Connection cards | Find a comfortable opening for an in-person scene; read prepared cards offline | Medium |
| 14 | v1.4 — Personal character arcs | Choose a character journey, follow flexible prompts, and save private reflections | Medium |
| 15 | v1.5 — Community projects | Contribute to a shared goal and see accepted collective progress | Large |
| 16 | v1.6 — Project contributions and consequences | Use verified instrument outcomes and player-confirmed resource contributions to change the fictional world | Large |
| 17 | v1.7 — Complete starter experiences | Run a coherent themed gathering with cards, arcs, and a shared project using a short setup workflow | Medium |

Starter material ships with each feature. Batch 17 assembles and refines the complete experiences; it is not a prerequisite for using earlier batches.

## Batch 13 — Connection cards

**Experience.** A player opens their character and sees one suggested conversation to start. A card contains a situation, a person or role to approach, an opening line, and an optional follow-up. Begin with a small active selection instead of a long task list.

- Support general conversation invitations and subjective suspicions first. An organizer can select a small deck, preview distribution, and offer cards to eligible characters using public character or faction information.
- Let players keep, replace, pause, or dismiss a prompt without a penalty or an explanation. Dismissal is not shown to other players. Do not expose acceptance/dismissal statistics as an organizer engagement score.
- Include optional paired history: a proposed shared fact becomes established only after both players agree to its exact text. Until then, it is visibly a proposal. A badge scan identifies the permitted public character; it does not accept a relationship.
- Show unpaired or unavailable suggestions clearly and provide a role-based alternative when a named counterpart has not joined, has left, or is unavailable. Avoid requiring organizers to hand-match every player.
- Ship six short cards per theme, including low-pressure openings for newcomers. Permit text customization before distribution; published edits must not silently replace an accepted shared-history statement.
- Extend **Prepare for the field** to save the player's permitted active card text and accepted shared facts, with preparation time and read-back verification. Offer a compact player-only print view. New assignments and mutual acceptance require a connection.

**Foundation included in this batch.** Separate authored templates, published versions, assignments, and player responses. Bind player responses to the current account–character assignment. Add backward-compatible database migrations and versioned browser preparation changes only where needed; preserve existing field notes, queued information requests, and their original identifiers. Document the new audience rules before implementing API projections.

**Done when:** a new player can find an understandable opening without staff explanation; optional participation and replacement work; shared history requires agreement from both sides; suggestions reveal no private objectives; prepared cards reopen without a connection in automated storage/browser checks; reassignment and account clearing cannot expose a previous player's responses. Verify character loss, unavailable counterparts, published edits, exact retries, and rehearsal reset. Record actual device and player observations separately.

## Batch 14 — Personal character arcs

**Experience.** A player chooses one optional arc such as learning to trust, finding a place to belong, or deciding what ambition costs. Three flexible prompts suggest scenes; the player records their own progress after play.

- Offer three arcs per theme. Each includes a starting question, three optional turning points, and a closing reflection. Themes change the story language; progression follows the same mechanics.
- Let players mark, undo, skip, replace, or end an arc. Replacing an arc preserves its earlier record unless the player explicitly chooses to clear it. These are narrative reflections with no XP, resource rewards, or organizer performance grading.
- Persist the player's selection and progress while connected. Keep progress and the selected arc private to that player in normal application views; organizers author available templates without gaining access to individual reflection records.
- Save optional reflections as explicitly saved local Field desk notes. Label their device-local status. Do not silently upload them or advertise cross-device note synchronization.
- Prepare the selected prompts and last-confirmed progress for offline reading. Local reflections remain writable offline; marking authoritative progress requires a connection in this release. Reconnecting refreshes current progress without overwriting unsaved local text.
- Add a restrained next-step prompt to the character screen, with no streaks or overdue warnings. A player can follow an arc without needing another player's participation or a particular roleplaying style.

**Done when:** selection, undo, replacement, and progress survive a reload; another player and ordinary organizer cannot read private selections/progress; local reflections survive a cold reopen after an explicit save; storage failures remain visible; old player notes and progress never transfer with a reassigned character. A new player can explain their next optional scene in their own words.

## Batch 15 — Community projects

**Experience.** The event screen shows a small set of shared goals, their milestones, ways to help, accepted progress, and what completion will change. A player chooses a contribution that suits their character.

- Add organizer-authored projects with a published title, purpose, audience, bounded milestones, contribution instructions, and an announced fictional outcome. Keep future revelations and organizer notes in the authoring view.
- Start with narrative contributions reviewed by an organizer: negotiating access, arranging a meeting, reporting a relevant discovery, or helping stage a scene. Existing readings may be explicitly selected as supporting evidence only when their sharing policy permits it. Evidence is not automatically published to the project audience.
- Provide one review list for staff. Show submitted, accepted, declined, withdrawn, and superseded states with clear player feedback. Pending work is not counted as completed progress.
- Default participation counts to distinct player accounts so several characters cannot satisfy a multiple-player requirement for one person. Make each project's counting rule visible before contribution.
- Offer several contribution routes, including one that does not require wealth, public speaking, or winning a puzzle. Do not display individual rankings.
- Fetch authoritative project state when a connected view opens, when the user refreshes, and after a contribution result. An explicitly prepared project summary may be read offline with its saved time; it is not current progress.
- Submission, staff decisions, and completion require connectivity. Players can save an offline idea in Field desk and deliberately submit it after reconnecting. The existing information-exchange queue is not extended to accept project mutations.
- Ship one complete project per theme. This first release has no inventory spending or automatic cross-instrument rewards.

**Done when:** several players can contribute concurrently; repeated submissions and review clicks produce one accepted contribution; one-time milestones and project completion happen once; pending/declined work does not count; permissions and pause/end states are rechecked at commit. Staff corrections preserve the previous decision and an explanation. Offline snapshots cannot authorize a contribution or imply that a project is still open.

After completion, changing a contribution decision must not silently reopen the project, award completion again, or retract an already published outcome. Require an explicit recorded organizer correction; any future access change or bulletin withdrawal follows its existing authorization process. Information already legitimately read cannot be erased from players' knowledge.

## Batch 16 — Project contributions and consequences

**Experience.** Existing ORACLE activities become explicit ways to help a project, and completed projects produce a visible authored consequence.

- Add a small typed set of evidence adapters: an eligible RELIC/DEAD DROP discovery, a recorded SIGIL outcome, and an eligible completed OATHBOOK agreement. Add other instruments only for a concrete starter need. Receiving a copied reading does not become the original character's discovery or a new completion receipt.
- Players explicitly offer eligible evidence. Validate current ownership, permitted use, audience, and the source receipt on the server. Rules state whether a source can satisfy more than one requirement; default to once per project, and prevent one receipt from being credited twice accidentally.
- Add player-confirmed item/resource donations against organizer-published requirements through the existing economy transaction machinery. Present the exact amount, milestone availability, and consequence before confirmation. Recheck current assets and commit the debit, contribution, and receipt atomically. Concurrent donations to a final slot must not overcharge the losing request. Eligible donations are committed immediately after player confirmation; this batch does not introduce a pending staff-approval reservation system.
- Keep rewards and unlocks to a bounded, reviewed set: a project completion record, a prepared content unlock for an explicit audience, and a BROADSIDE draft for organizer publication. A project never bypasses the existing bulletin review process or publishes private evidence automatically.
- Define closed/withdrawn project behavior and donation cancellation/refund rules before enabling spending. Stop new donations immediately when unavailable. Accepted contributions are not silently reversed; any permitted refund or correction is a separately recorded, authorized transaction with its own stable identity.
- Protect every accepted contribution and resulting effect with durable receipts and expected versions. Retrying a completion cannot grant a reward, debit resources, or create the same announcement twice. Paused or archived events cannot accept new play actions.

**Done when:** two players racing for the final requirement receive correct results; timeouts and exact retries produce one effect; insufficient/stale inventory causes no partial spending; revoked evidence fails closed; results and corrections remain explainable. The full chain from permitted discovery or player-confirmed donation through project completion and approved public news works in staging.

## Batch 17 — Complete starter experiences and field refinement

**Experience.** An organizer picks a theme, previews a ready-to-run bundle, adds it to an event, and assigns characters through the existing workflow. A short organizer guide explains the opening, optional scenes, contribution routes, and ending.

| Theme | Working starter title | Six connection cards revolve around | Three arc options | One community project |
| --- | --- | --- | --- | --- |
| Fantasy | The Lantern Gathering | Old favors, a remembered crest, a disputed promise | Trust, belonging, responsibility | Restore a shared border lantern |
| Cyberpunk | The Neighborhood Relay | A returned data shard, a former partner, conflicting loyalties | Trust, autonomy, redemption | Bring a community relay online |
| Wasteland | The Water Watch | Salvage favors, convoy memories, settlement obligations | Hope, belonging, leadership | Restore a water beacon and arrange its watch |

These are proposed new bundles, distinct from the three existing starter adventures. Target small gatherings of roughly 2–6 players and a 30–45 minute session; validate and revise those targets through play. Provide role-based alternatives when a suggested counterpart is absent, enough independent contributions for a small party, and optional expansion guidance for larger groups.

- Assemble the feature content already delivered: six cards, three arcs, and one project per theme. Include character assignment suggestions, printable player prompts, organizer notes, and an alternate ending when the project is unfinished.
- Make installation preview changes before applying. Track installed template versions; a repeated install must not duplicate assignments or overwrite customized content. Existing events receive no retroactive content.
- Treat these as built-in content bundles initially. Do not silently add them to existing format-1 briefing/adventure exports. If downloadable bundles are included, define and validate an explicitly versioned format and remapping rules first.
- Rehearsal copies receive authored definitions with new identifiers. They exclude source-player responses, paired-history acceptance, arc selections/reflections, contributions, and rewards. Reset clears only the rehearsal's play state and any economy effects according to its existing baseline rules.
- Refine the combined character and event screens so the next optional action is easy to find. Update help and the public screenshot tour as each feature ships, then show one connected starter example in this batch.
- Run a small field pilot with newcomers and players who prefer lower-pressure participation. Observe whether they can start a scene, find a contribution, and leave the phone to roleplay; note organizer interventions and usability problems without adding behavioral tracking to production.

**Done when:** every themed bundle works from invitation and character assignment through connection, personal arc, collective outcome, ending, and rehearsal reset; repeat installation and reset preserve customized/source events; accepted field findings are recorded and critical defects fixed. Public examples accurately show shipped behavior. Automated tests and production deployment do not count as human or physical-device acceptance.

## Offline and visibility contract

| Material/action | Offline behavior | Reconnection behavior |
| --- | --- | --- |
| Assigned cards and accepted shared facts | Read explicitly prepared, permitted text with its saved time | Refresh assignment and access; mutual acceptance is an online action |
| Chosen arc prompts and progress | Read saved prompts and last-confirmed progress | Refresh server progress; review and perform changes while connected |
| Personal reflections or contribution ideas | Explicitly save private local Field desk notes | Keep local; nothing submits or becomes public automatically |
| Community project summary | Read an explicitly saved, permitted historical snapshot | Fetch current audience-filtered progress and availability |
| Contributions, approvals, donations, and outcomes | Require connectivity; no offline commitment or automatic retry queue | Submit deliberately with fresh authorization, version checks, and a stable request ID |

Card acceptance, selected arcs, private progress, and notes belong to the account–character assignment. Reassignment may retain the organizer's authored template, but never transfers the previous player's consent or personal record. Other players see only explicitly shared facts or permitted collective project information. Project staff can review submitted contributions; they do not gain access to unrelated arc reflections.

Extend the existing bounded preparation projection and account/event clearing rules. Never cache a roster or hidden character material merely to suggest a connection. A saved named counterpart contains only the permitted text necessary for the player's card. Logout, account change, event departure, or known reassignment/revocation clears the affected records. A disconnected device cannot learn a remote permission change; previously prepared material remains a dated copy until the app can recheck it. Print views inherit the same audience limits.

## Engineering and release requirements

- Baseline: SQL schema 10, Field desk database version 2, and existing stored formats. Allocate actual migration/version numbers during implementation, using additive migrations and tested upgrades; do not reinterpret old records silently.
- Keep templates, publication snapshots, assignments, player state, contributions, and outcome receipts distinct. Add focused authorization, retry/concurrency, reassignments, preparation, and rehearsal tests with the feature that introduces each behavior.
- Ship rehearsal-copy/reset support with every feature's first release, applying the authored-definition versus personal/play-state rules above. Batches 13–16 each verify their own isolated copy/reset behavior; Batch 17 rechecks the combined journey.
- Keep unsaved form text intact across refreshes, connectivity changes, and stale-version errors. Render loading, unavailable, revoked, and storage-failure states with clear next actions.
- Each software release follows the existing exact main verification → Railway staging → full remote journey/cleanup → production promotion → public readiness checks. Update recovery fixtures and the remote journey when stored structures or playable behavior expand.
- Deliver documentation and an accurate public tour example in each feature batch. Preserve the historical deployment and unresolved device/operations records in [STATUS.md](STATUS.md); this planning document closes none of those outstanding checks.

First implementation target: **Batch 13 — Connection cards**. Batch 14 depends on its assignment/privacy foundation; Batch 15 adds shared project state; Batch 16 adds verified effects; Batch 17 combines the delivered features into polished starter experiences.
