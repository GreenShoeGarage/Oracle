# ORACLE

*LARP Field Kit*

Development roadmap · Planning revision: 1.6 · September 5, 2026

Status: Batch 4 (v0.4.0, schema 5) is implemented and undergoing release verification. Local automated tests and the three-theme workflow rehearsal passed; exact-commit CI and deployment results are pending. Batch 3 remains the last verified production release at [oracle.greenshoegarage.com](https://oracle.greenshoegarage.com). Scheduled backups remain outstanding because Railway reports zero managed-backup capacity. Batch 5 is next; Batches 5–12 remain planned.

Product name: ORACLE. Subtitle: LARP Field Kit.  
Agreed delivery platform: GitHub and Railway, with PostgreSQL for shared event state.

Build one modular application for Live Action Roleplaying events. Organizers select a theme, configure an event, enable the instruments they need, and invite players. Players create or receive characters, discover information, interact through QR codes, and participate in scenes. The browser should support conversations, movement, and physical props through brief, purposeful interactions.

The first complete adventure is targeted for v0.4. Player-to-player information exchanges arrive in v0.5. All twelve instruments are targeted to be functional by v0.9; field hardening, a beta pilot, and release preparation follow. Versions express dependency order and completion gates, not calendar commitments. Batches 1–4 status are recorded below; Batches 5–12 remain planned.

**Product commitments**

- One codebase, with optional modules and shared records for characters, factions, objects, locations, discoveries, resources, agreements, and encounters.
- Three views: a focused player interface, an organizer workspace, and a fullscreen prop/kiosk interface.
- Three initial themes: fantasy, cyberpunk, and wasteland. Each receives a complete starter adventure by v0.4.
- Separate theme packs, event packs, and rules profiles. Appearance changes preserve stable identifiers and existing progress; rule changes are explicit and validated.
- Players can create characters, receive prewritten characters, and copy a character template into another event. Progression, approvals, equipment, and private knowledge remain event-specific.
- QR codes support public introductions, controlled information sharing, and later item exchanges. Every scanning workflow also accepts a short code.
- PostgreSQL is authoritative for shared inventories, exchanges, permissions, and event state. Offline behavior is explicitly defined for each action.
- Backward compatibility begins with the first persisted schema: version detection, validated imports, tested migrations, and recovery procedures.
- No mandatory social integrations or third-party game accounts. No behavioral analytics. Operational logs exclude private story content and credentials where practical.

**Batch 1 — v0.1: Platform and reliable deployment**

Implementation status: Deployed foundation with accounts, isolated event membership/roles, invitations, lifecycle controls, migrations, health/readiness, and GitHub/Railway release infrastructure. Batch 2's successful remote two-account workflow closes the previously interrupted authenticated staging gate. Scheduled backups remain outstanding: the effective Railway HOBBY limits report zero managed-backup capacity. Passing CI restore rehearsals verifies tooling but does not protect live event data. See [STATUS.md](STATUS.md).

Create the GitHub project, application skeleton, Railway application and database configuration, and a repeatable deployment workflow. Establish an isolated staging environment, authentication, event membership, organizer/staff/player permissions, and server-side event isolation. Define event states: draft, rehearsal, live, paused, ended, and archived.

Set up database migrations, backups, readiness and health endpoints, structured operational errors, visible application version, and the initial setup guide. Define the data ownership and offline synchronization contract now so later modules use consistent rules. Keep environment secrets outside source control and user-facing configuration.

Completion gate: A checked commit can be deployed to staging; a user can create an event and return to persisted data; two events cannot access each other's records. Rehearse a migration and recovery on test data. Establish a production release path that waits for successful checks.

**Batch 2 — v0.2: Themes and guided event setup**

Implementation status (September 5, 2026): Source v0.2.0 implements Fantasy, Cyberpunk, and Wasteland themes; the four-step event builder; Blank event and three starter briefings; optional Briefing; player/organizer/prop views; outdoor and reduced-motion settings; collapsible controls; explicit save status; bounded rules definitions; and strict format-1 organizer/player event-pack import/export. Themes preserve rules and stable content IDs. The twelve planned gameplay instruments are unavailable. The three themed starters contain opening briefings and organizer notes, not complete adventures.

Migration 002 adds setup data while preserving Batch 1 events, lifecycle, memberships, invitations, and audit records. The database advances to schema 2; v0.1.0 is not a compatible rollback target. Recover through a tested schema-2-compatible roll-forward fix. Release commit `537c17443947694664499d91007c289bdfc2ac6d` passed PostgreSQL 18, recovery, and production-image CI plus the exact-commit remote two-account staging workflow. Local tests and 11 Chromium scenario groups also passed, including all three theme wizards, audience filtering, pack reuse, failed-save recovery, and desktop/375-pixel layouts. Railway production deployment and the exact-commit public smoke job passed, confirming v0.2.0 with schema 2 at the canonical domain. Batch 2 is complete and deployed. The existing scheduled-backup limitation remains open. See [STATUS.md](STATUS.md).

Build theme packs with color and typography tokens, icons, textures, terminology, optional sound definitions, and accessible fallbacks. Ship fantasy, cyberpunk, and wasteland starter packs. Create the event builder: choose a theme, choose a template, enable available instruments, add content, and preview as a player.

Implement basic player, organizer, and prop views; responsive layouts; collapsible controls; clear save status; optional reduced motion; and readable outdoor/dark settings. Define a bounded rules profile for attributes, expertise, resources, and challenge outcomes. Support validated, versioned event-pack import/export with distinct organizer backups and safe player material. Unimplemented modules remain unavailable in the player interface.

Completion gate: The same test event can switch among all three themes without changing its rules or losing records. A new organizer can create, preview, export, and reimport a small event. Imported themes use strictly validated data and built-in visual/audio choices; arbitrary CSS, markup, scripts, formulas, and external asset URLs are rejected.

**Batch 3 — v0.3: Characters, factions, and identity**

Implementation status: Deployed v0.3.0 provides a four-step character creator, event factions, organizer approval/change requests, creation limits, prewritten assignment, public-field controls, private sheets, initial inventory, printable QR badges, camera/photo/manual lookup, badge rotation, retirement, and cross-event identity copies. Copies use destination attribute defaults and supported skills, with new identity/badge and no transferred faction, objectives, equipment, inventory, or approval. Badges require signed-in event access and never confer editing rights. Event-pack format 1 remains setup/briefing-only.

This batch also provides an operator-provisioned project superuser, all-event management, account enable/disable, session revocation, and project audit history. Existing selected accounts retain their identity and password; an absent reserved account requires an operator-held secret to claim. No personal operator address or secret belongs in source. Additive migrations advance the database to schema 4; earlier binaries require incompatible schemas, so recover with a tested schema-4 roll-forward fix.

Release commit `12a34458de3bdbe0968e7d2b174ba441e7952d09` passed 78-test CI (77 passed, one environment-specific skip), populated-table recovery, the running production image, the full remote two-player staging journey, and exact-commit production smoke. Six local DOM/API flows and public staging desktop inspection also passed; these are not authenticated real-browser or physical-camera tests. The reserved operator account has a protected claim mechanism and awaits the owner choosing their password. See [STATUS.md](STATUS.md) for evidence. Scheduled backups remain open; physical-device and human field testing remain future gates.

Build a guided character creator for name, portrait, optional pronouns, biography, affiliation, skills, starting equipment, and private objectives. Support organizer approval, freely created characters within event limits, and assignment of prewritten characters. Separate account identity from the fictional character.

Add public character cards, private character sheets, event enrollment, basic inventory records, printable QR badges, and short-code lookup. Display only event-permitted information. Copying a character into another event creates a template requiring that event's validation, without transferring its inventory or discoveries.

Completion gate: Two players can join the same event, create or receive characters, obtain approval where required, and scan each other's public cards. Private fields remain inaccessible through both the interface and direct requests. Printed badges grant no character-control privileges.

**Batch 4 — v0.4: First complete playable adventure**

Implementation status: Candidate v0.4.0 includes RELIC, DEAD DROP, CIPHERBOX, and WAYFINDER; per-character discovery journals; bounded completed-node/skill/flag/event-status conditions; idempotent outcomes; uploaded recordings; safe printed prop labels; focused prop view; read-only previews; and explicit organizer overrides. Dedicated rehearsal copies preserve the source and can reset their own progress. Already-permitted journal readings and the public app shell can be read offline; new actions/reveals require connectivity.

Three complete 30-minute adventures for 2–6 players are implemented: The Last Lantern (Fantasy), The Last Neighborhood Signal (Cyberpunk), and The Last Water Beacon (Wasteland). Each creates two approved unassigned characters, a relic discovery, a gated message, a solvable puzzle with hints, and complete success/fallback scenes. Assignment, printing, rehearsal, and running instructions are included in private organizer notes. Format-1 briefing packs do not contain adventure definitions or progress.

Local verification passed 106 tests (105 passed, one TCP-only skip), plus a full three-theme HTTP rehearsal (145 reads/196 writes) and eleven DOM/API flows with zero uncaught JavaScript errors. Final CI and actual deployment evidence are pending in [STATUS.md](STATUS.md). These results do not claim authenticated real-browser/mobile-camera or human field testing. Migration 005 requires schema-5-compatible roll-forward recovery. Scheduled backups remain unresolved; the reserved operator claim remains idempotent and preserves account identity/passwords.

Implement four connected instruments:

- RELIC: Identify a prop by QR/manual code, select an examination, and reveal authored observations according to expertise and event conditions.
- DEAD DROP: Release documents, messages, or recordings through configured codes, discoveries, or organizer actions.
- CIPHERBOX: Configure reusable fictional terminal puzzles and locks with hints, attempts, success/failure outcomes, and organizer override.
- WAYFINDER: Present locations and available scenes with play style, duration, availability, and participation details.

Add the discovery journal, content relationships, and simple condition/action rules. Support a single-prop kiosk workflow, organizer player-preview, and a resettable rehearsal copy. Cache the app shell and already permitted readings for basic offline viewing; new protected reveals require authorization from the host.

Deliver one complete adventure adapted for all three themes. Each includes characters, printable prop labels, a discovery, a message, a puzzle, and a resulting scene.

Completion gate: An organizer and two players can complete the adventure on separate devices in each theme. Findings survive reloads, clues do not reveal unauthorized answers, and repeated requests cannot apply a one-time outcome twice. This is the first playable alpha.

**Batch 5 — v0.5: Player-to-player QR exchanges**

Add Show My QR, Scan Player, introductions, an in-world contacts list, and selected clue/message sharing. Temporary exchange sessions allow both players to choose offers, review them, confirm, and receive journal receipts. Support expiration, cancellation, reconnecting, and a short-code alternative.

Distinguish copyable information from owned inventory. This batch handles information exchanges; authoritative item trading arrives in Batch 7. Event rules can mark material as shareable, restricted, or organizer-only. Public badge lookup and exchange authorization are separate mechanisms.

Completion gate: Two phones can introduce characters and exchange only selected, permitted information. Expired sessions, changed offers, rejected requests, and repeated confirmations behave predictably. A changed offer requires renewed confirmation. A lost connection never displays an unconfirmed exchange as complete.

**Batch 6 — v0.6: Investigation and living story**

Implement TRACE, WHISPER, and BROADSIDE. TRACE connects evidence, people, places, provenance, private theories, and intentionally shared investigation records. WHISPER supplies organizer-authored rumors, alternate tellings, and leads for players or an in-character broker. BROADSIDE publishes approved bulletins, posters, and event news.

Connect discoveries to story conditions and proposed announcements. Give organizers publication review, an activity log, and correction tools. Keep player speculation distinct from confirmed game facts; a rumor's hidden truth does not become visible merely because it is collected.

Completion gate: Two players can receive different accounts, share selected evidence, and build an investigation. An organizer can publish a related bulletin to the intended audience. Public, faction, group, and private records enforce their respective access rules.

**Batch 7 — v0.7: Economy, trades, and agreements**

Implement BAZAAR and OATHBOOK. Add fictional resource balances, item ownership and quantities, organizer-defined shops, stock, purchases, and bilateral barter. Extend QR exchanges to atomic trades: all agreed transfers succeed together or none do.

Add agreements with participants, terms, witnesses, expiration, status, and organizer adjudication. Support explicit settlement terms where practical; narrative obligations require human judgment. Record receipts and organizer corrections. Inventory transfers require server confirmation; borrowing and complex lending rules are reserved for later expansion.

Completion gate: Concurrent attempts to trade the same item cannot duplicate it or create negative stock. Retrying an accepted request produces one transaction. Agreements preserve who accepted which terms, and disputed outcomes can be corrected with an audit record.

**Batch 8 — v0.8: Cooperative challenges and immersive props**

Implement SIGIL and STATIC. SIGIL runs cooperative sequences with assigned roles, components, checkpoints, timers, and configured outcomes. STATIC presents fictional readings driven by prop/zone codes, prepared event state, or organizer input.

Expand prop mode with theme-specific presentation, optional sounds, clear visual equivalents, and staff-protected controls. Connect challenges to discoveries, inventory requirements, and event outcomes. Provide pause, resume, cancellation, retry, and organizer override. Start with shared-device cooperative play; coordinated multi-device timing can follow after that workflow is dependable.

Completion gate: A group can run the same underlying challenge as a fantasy ritual, cyberpunk system procedure, or wasteland repair. Outcomes and resource consumption apply once. Pausing or losing connectivity produces a defined state. STATIC readings remain clearly fictional.

**Batch 9 — v0.9: Live event operations**

Implement STAGEHAND with encounter queues, party assignments, return windows, performer and prop readiness, capacity, staff acknowledgments, and scene status. Connect operational readiness to WAYFINDER availability and approved BROADSIDE announcements.

Add event and scene pause controls, queue reassignment, cancellations, and a compact organizer activity view. Staff see the operational information their role needs. Prop tablets and player views respect live, paused, and ended event states.

Completion gate: An organizer can run multiple encounters, delay or cancel one, redirect its queue, and see consistent player-facing availability. Rehearse a connected scenario that exercises every instrument. All twelve instruments are now functionally present.

**Batch 10 — v0.10: Offline behavior and field resilience**

Harden the mobile installable web app, caching, low-bandwidth behavior, camera fallbacks, and reconnect handling. Preserve allowed journal content and local drafts. Introductions and information-sharing requests may be queued with an explicit pending status and revalidated on reconnect. Pending work can be canceled before transmission.

Keep authoritative trades, protected reveals, shared stock, and live encounter state dependent on server confirmation. Queue entries carry stable request identifiers so reconnects do not repeat effects. Expired sessions and revoked membership require fresh authorization; account switching/sign-out clears the relevant local cache. Sensitive unrevealed content stays on the server.

Provide printable player aids and organizer fallback lists. A local event-host server is a separate later capability, not a promised component of v1.0.

Completion gate: Put two devices through offline, reconnect, duplicate-request, expired-session, and conflicting-change scenarios. No private data crosses accounts or events; pending actions resolve visibly; inventory remains consistent. Document exactly which actions work offline and which wait for connectivity.

**Batch 11 — v0.11: Beta pilot and usability pass**

Run a complete event rehearsal covering character creation, scanning, information exchange, investigation, trade, cooperative play, encounter dispatch, and event closure. Check camera behavior and manual-code alternatives on representative iPhone and Android browsers, desktop organizer screens, and a shared tablet.

Observe organizer setup and new-player onboarding; remove unnecessary steps and unexplained terminology. Check keyboard access, readable contrast, touch targets, text scaling, reduced motion, and optional audio. Exercise loading, empty, permission-denied, and failure states rather than only successful demonstrations.

Use 100 simultaneously connected players in one event as a provisional load-test target. Confirm or revise this target before the test and record the hosting configuration, workload, observed limits, and result. Actual human field testing is a release dependency; automated tests are recorded separately and cannot substitute for it. Seek pilot results when people and devices are available rather than claiming a field test happened.

Completion gate: No unresolved critical defects in access control, data integrity, or the core player journey. Core journeys work on the tested devices; the measured capacity and any limitations are documented; pilot findings have been resolved or explicitly scheduled.

**Batch 12 — v1.0: Production release and handoff**

Finalize the organizer quick start, player guide, comprehensive GitHub README, theme/event-pack documentation, migration and backup instructions, troubleshooting, and release notes. Ship the three starter adventures and clean sample-data/reset workflows that cannot accidentally reset a live event.

Rehearse backup restoration and application rollback against a compatible database schema. Use additive migrations where possible; a database restore is an explicit recovery procedure, not an automatic response to an application rollback. Validate assets, persistence, and the deployment from a clean environment.

Deploy the checked release commit through staging to Railway production and the selected custom domain. Verify readiness, authenticated access, a disposable test-event workflow, and the deployed version. Record the actual deployment result and retain the last known good release.

Completion gate: All twelve instruments meet their acceptance criteria; each starter adventure works; compatibility and recovery procedures are exercised; documentation matches the deployed version; release checks pass. Development upgrades preserve existing event data within the documented compatibility policy.

**Theme mechanism**

| Shared function | Fantasy | Cyberpunk | Wasteland |
| --- | --- | --- | --- |
| Object examination | Scrying lens | Forensic scanner | Salvage inspection kit |
| Fictional detector | Arcane resonance meter | Signal analyzer | Contamination scanner |
| Cooperative challenge | Ritual circle | Coordinated system override | Generator repair |
| Hidden communications | Sealed missives | Encrypted transmissions | Coded radio messages |
| Agreements | Binding oaths | Corporate contracts | Settlement accords |
| Trade | Guild quartermaster | Black-market exchange | Trading post |
| News | Town crier's broadsheet | Underground newswire | Settlement bulletin |

Theme packs affect presentation and vocabulary. Event packs supply the story and content. Rules profiles define game data and, as gameplay instruments arrive, their supported behavior. In v0.2 they are bounded definitions only. The theme can rename an explicitly configured resource but cannot silently change balances, ability requirements, or outcomes. Every interface retains understandable actions and accessibility overrides.

**Checks required throughout development**

- Each enabled feature has working persistence, authorization, validation, loading/error states, and a demonstrated player or organizer outcome.
- The relevant user journey is verified on the actual release commit. Build, migration, and targeted regression checks run before promotion; production health and smoke checks run after deployment.
- Cross-event isolation, secret access, QR authorization, repeated requests, and inventory concurrency receive dedicated tests when those capabilities are introduced.
- Imports are validated before changes apply. Recovery snapshots and explicit confirmation protect destructive event actions. Existing data is migrated and checked rather than silently discarded.
- A short interface cleanup accompanies each batch. The player navigation remains compact; theme vocabulary does not obscure essential actions.
- Completion reports state what shipped, what was verified, the deployed version when applicable, and concrete remaining limitations.

**Expansion after v1.0**

Prioritize these using pilot feedback: additional theme packs and richer theme authoring; campaign continuity with explicit character migration; a library of reusable encounter templates; multi-device cooperative challenges; physical prop bridges for readers, lights, and sound; richer map authoring; and a local event host for sites without internet access.

The initial release does not attempt a universal rules engine, real-money marketplace, unrestricted scripting system, or automatic AI adjudication. These boundaries keep the first product focused on dependable event interactions.

Next development batch after the active Batch 4 release: Batch 5 — player-to-player information exchanges. Batch 4 verification/deployment is in progress; scheduled database backups remain a separate operational item. Public branding uses ORACLE with the subtitle “LARP Field Kit.”
