# ORACLE

**LARP Field Kit** · v0.9.0 · Green Shoe Garage

ORACLE is a modular web application for Live Action Roleplaying events. Organizers build a themed event, prepare player briefings and private notes, invite participants, and manage the event through rehearsal and play. Players create or receive characters, carry private sheets and inventory, and scan approved public character badges. Shared screens can present selected briefings, cooperative procedures, and explicitly fictional prop readings.

[Open ORACLE](https://oracle.greenshoegarage.com) · [Source repository](https://github.com/GreenShoeGarage/Oracle) · [Staging app](https://oracle-production-488d.up.railway.app)

Batch 9 (v0.9.0, database schema 10), release commit `4133a6b51a9a4f2471723f88bd6d6f695a798b2a`, is fully deployed at [oracle.greenshoegarage.com](https://oracle.greenshoegarage.com). STAGEHAND completes all twelve gameplay instruments. Both exact-commit PostgreSQL CI runs, Railway staging, and the complete remote all-twelve/all-three-theme workflow passed; Railway production and all 56 exact-commit public GET checks passed. The existing operator remains enabled with identity/password preserved. See [docs/STATUS.md](docs/STATUS.md) for evidence. Scheduled database backups remain outstanding because the Railway workspace reports zero managed-backup capacity.

## What works in this release

- STAGEHAND encounter preparation, performer/prop/staff readiness, scoped staff access, party queues, explicit member acceptance, and whole-party dispatch within current capacity.
- Server return deadlines and overdue indicators, acknowledged returns/cancellations, scene/event pauses, and whole-party redirection that clears prior consent.
- Managed WAYFINDER admission with existing attendance preserved, and operational BROADSIDE drafts requiring organizer approval with stale notices hidden after scene changes.
- Themed player/prop and staff views, private operational notes, current staff activity, explicit uncertain-request replay, and actual operations-aware rehearsal copy/reset.

- SIGIL shared-device challenges with in-person role assignments, ordered checkpoints, prepared answers, timers, host inventory/resource requirements, and recorded success/failure outcomes.
- Explicit pause/resume, connectivity leases, cancellation/retry, and staff interventions with reasons; final outcomes and consumed host components commit once.
- STATIC fictional prop/zone readings selected by prepared rules, character discoveries, cooperative outcomes, or staff selection of a published state.
- Separate organizer drafts and published definitions, immutable collected readings, and current account/character authorization throughout.
- Theme-aware immersive prop views, printable codes, camera/photo/manual lookup, optional local sounds, visible equivalents, and clear exit controls.
- The same three-step, two-role starter cooperation appears as a fantasy ritual, cyberpunk relay procedure, or wasteland pump repair. Rehearsals copy authored definitions with new codes and clear their actual runtime state on reset.

- BAZAAR fictional whole-unit resource balances, organizer-defined shops, finite stock, versioned purchases, and immutable transaction receipts.
- Bilateral QR item/resource barter alongside selected readings: revised offers clear both confirmations; all transfers and reading copies commit together, and exact retries produce one transaction.
- OATHBOOK private proposals with exact terms revisions, explicit participant acceptance, independent witnesses, expiration, fixed resource settlements, disputes, organizer rulings, and linked corrections.
- Organizer balance corrections require reasons; character inventory forms also record a reason and before/after quantities in event activity. Existing API clients may omit inventory reasons and receive the documented default audit label.
- Independent authored resource catalogs, new-starter shops with zero initial balances, and rehearsal copies that restore initial stock and inventory without copying balances, trades, or agreements.
- Account-bound receipts, current ownership checks, online confirmation, explicit uncertain-request retry, and no current economy/agreement cache or offline mutation queue.

- TRACE investigation notebooks for evidence, people, places, private theories, selected journal citations, and intentionally shared connections.
- WHISPER organizer-authored rumors with alternate audiences and discovery conditions; collection preserves an explicitly unverified account while hidden truth stays in the staff workspace.
- BROADSIDE proposed announcements, staff submission, organizer review/publication, printable posters, separate correction drafts, and withdrawal.
- Public event, faction, group, and selected-character audiences checked against current membership and approved character ownership.
- Temporary player-to-player QR/code exchanges, selected discovered readings, mutual confirmation, contacts, and journal receipts.
- Organizer sharing permissions, fixed expiry, cancellations, server-backed resume, and duplicate-copy prevention.

- Three complete 30-minute cooperative adventures for 2–6 players, with two approved prewritten characters, printable prop labels, clues, a puzzle, and success/fallback scenes.
- RELIC examination, DEAD DROP messages and uploaded recordings, CIPHERBOX puzzles/hints, and WAYFINDER scene reservations.
- Private discovery journals, linked conditions/outcomes, organizer previews and overrides, and isolated resettable rehearsal copies.
- Read-only saved journal readings and a cached public app shell for previously loaded devices.
- Accounts, private event membership, expiring invitation codes, roles, lifecycle controls, and activity logs.
- Guided character creation with portraits, pronouns, biographies, event factions, attributes, skills, starting equipment, and private objectives.
- Organizer approval/change requests, prewritten character assignment, per-player limits, and controlled public identity fields.
- Initial inventory created once on approval, with later additions and quantity changes managed by organizers.
- Printable QR badges, camera/photo/manual-code lookup, badge rotation, and retirement.
- Cross-event character copies with a fresh identity, destination rules, and reset gameplay data.
- Project administration for an operator-provisioned superuser: all-event access, account search, disable/enable, session revocation, and project audit history.
- A four-step event builder: **World → Event → Material & rules → Review**.
- Fantasy, Cyberpunk, and Wasteland themes with colors, fonts, icons, textures, terminology, and optional sound cues.
- A blank event and three smaller starter briefings: **The Lantern Council**, **The Missing Signal**, and **The Last Water Stop**. These provide a starting scene and organizer preparation notes; choose Start an adventure for a complete playable template.
- Authored material with player or organizer visibility, plus a separate flag for inclusion in prop display.
- Organizer workspace, player preview, player reading view, and fullscreen prop display.
- Bounded rules definitions for attributes, expertise, resources, and named outcomes.
- Versioned JSON event packs: private organizer backups and player material with organizer-only content removed.
- Dark and outdoor reading settings, reduced motion, collapsible navigation, and clear manual-save status.

**Briefing** and twelve gameplay instruments—**RELIC**, **DEAD DROP**, **CIPHERBOX**, **WAYFINDER**, **TRACE**, **WHISPER**, **BROADSIDE**, **BAZAAR**, **OATHBOOK**, **SIGIL**, **STATIC**, and **STAGEHAND**—are available optional instruments. Character badges identify people; prop labels open event instruments. Temporary exchange QR codes support mutually confirmed introductions, selected reading copies, and atomic item/resource barter. Coordinated multi-device timing and offline action synchronization remain later work. Conditions and outcomes are bounded data; they do not run arbitrary scripts.

## Stack and project layout

Node.js 22 (22.9 or newer) or 24, a small native HTTP server, PostgreSQL, and plain HTML/CSS/JavaScript. The only server production package is `pg`. QR generation and decoding use locally vendored browser libraries with their licenses in `public/vendor/`; no QR service or CDN is used. There is no front-end compilation step and no third-party behavioral analytics.

| Path | Purpose |
| --- | --- |
| `src/app.js` | Authenticated API, authorization, static asset delivery |
| `src/security.js` | Password hashing, tokens, cookies, rate limits |
| `src/characters.js`, `public/characters-model.js` | Event character API, validation, and public/private projections |
| `src/admin.js`, `public/admin-ui.js` | Operator provisioning and project administration |
| `src/adventures.js`, `public/adventure-model.js` | Authoritative gameplay, journal, validation, and player projections |
| `src/adventure-templates.js` | Server-only full adventures and solutions |
| `src/stagehand.js`, `src/stagehand-core.js`, `src/stagehand-parties.js` | Scoped operations, readiness, capacity, captured consent, dispatch/return, lifecycle, and publication links |
| `public/stagehand-model.js`, `public/stagehand-ui.js`, `public/stagehand-manage.js` | Validated operations documents, player/prop views, and manager/staff forms |
| `src/sigil.js`, `public/sigil-model.js`, `public/sigil-ui.js` | Shared-device procedures, roles, authoritative timers, checkpoints, and outcomes |
| `src/sigil-components.js` | Atomic requirements and consumption from the current host's inventory/resources |
| `src/static.js`, `public/static-model.js`, `public/static-ui.js` | Prepared fictional signals, staff overrides, and captured readings |
| `public/instrument-code.js`, `public/prop-effects.js`, `public/props.css` | Instrument code parsing and accessible immersive prop presentation |
| `src/economy.js`, `public/economy-model.js`, `public/economy-ui.js` | Fictional resources, shops, purchases, atomic transfers, corrections, and receipts |
| `src/oaths.js`, `public/oath-model.js`, `public/oath-ui.js` | Exact agreement terms, signatures, witnesses, settlement, and organizer adjudication |
| `src/exchanges.js`, `public/exchange-model.js` | Atomic information exchange, provenance, receipts, and request validation |
| `src/sharing.js`, `public/sharing-ui.js` | Organizer sharing policies and player-discovery boundaries |
| `src/story.js`, `public/story-model.js`, `public/story-ui.js` | Rumors, audiences, publication review, corrections, and account-bound reading access |
| `src/trace.js`, `public/trace-model.js`, `public/trace-ui.js` | Private/shared investigation records and permission-filtered citations/connections |
| `public/exchanges-ui.js`, `public/exchange-code.js` | Temporary QR/code pairing, offers, confirmation, and resume |
| `public/adventure-*.js`, `public/prop-code.js` | Organizer/player workflows and printed prop identity |
| `public/offline.js`, `public/sw.js` | Account-scoped saved readings and public static caching |
| `public/characters-ui.js`, `public/qr.js` | Character workflow, portraits, printable badges, and local scanning |
| `src/db.js` | Database pool, transactions, checked migrations |
| `src/server.js` | Startup, readiness, graceful shutdown |
| `public/app.js` | Account, membership, and event interface |
| `public/builder.js`, `public/themes.css` | Guided setup, audience views, and theme presentation |
| `public/kit.js` | Shared browser/server theme, setup, and event-pack validation |
| `migrations/` | Ordered, immutable PostgreSQL migrations |
| `scripts/` | Checks, migration, smoke, and recovery tools |
| `test/` | Database-backed authorization and persistence tests |
| `.github/workflows/ci.yml` | PostgreSQL 18, recovery, Docker, exact-commit staging workflow, and read-only production checks |
| `Dockerfile` | Non-root Railway production image |
| `docs/` | Roadmap, architecture, deployment, and current status |

## Run locally

Prerequisites: Node.js 22.9+ or 24, npm, and a PostgreSQL database. Docker Compose is optional for starting a local database.

```bash
npm ci
cp .env.example .env
```

Set a local database password and start the supplied PostgreSQL 18 service:

```bash
export LOCAL_DB_PASSWORD='replace-with-a-local-only-password'
docker compose up -d postgres
```

Set `DATABASE_URL` in `.env` to your database. Percent-encode special characters in URL usernames and passwords. Do not commit `.env`. The sample credentials are local examples and must be replaced.

```bash
npm run migrate
npm run dev
```

Open `http://localhost:3000`. Create your own account and first event. No default administrator password or seeded user is created. Event creators become that event's owner. Ordinary registration cannot grant project administration; optional operator provisioning is documented below.

## Run a complete starter adventure

1. Select **Start an adventure** and choose Fantasy (**The Last Lantern**), Cyberpunk (**The Last Neighborhood Signal**), or Wasteland (**The Last Water Beacon**). Each creates a new Draft with a complete story, five labeled instruments, and two approved but unassigned characters.
2. Invite two players into that event. Under **Characters**, assign one prewritten character to each player. For 3–6 participants, create or approve additional characters under the event rules. Every player performing app actions needs an assigned approved character.
3. Select **Prepare adventure**. Read the private organizer notes, then **Print prop labels**. Place the RELIC label on an unpowered object or drawing, the DEAD DROP label on an envelope nearby, and the CIPHERBOX label on a paper control plate. Put both WAYFINDER scene labels at the same meeting point. The notes give complete setup and solutions; no coding or real machine/network operation is needed.
4. Use **Make rehearsal copy** for a practice run, then assign its fresh unassigned characters. Otherwise use the original. Set the chosen event to **Rehearsal** or **Live** before players act.
5. Players choose **Open adventure** and their approved character. Scan/type the RELIC prop code and choose **Read the markings**. That discovery unlocks a message with a separate release word. Open it, combine its key with the markings, and enter the resulting answer at the CIPHERBOX. Each player records their own steps while discussing clues together.
6. A correct answer unlocks the final gathering. Three wrong answers unlock an authored manual fallback, so the adventure still has an ending. Join the appropriate WAYFINDER scene and play its ten-minute agreement in person. A reservation records attendance; it does not automatically perform the characters' promises.

All three adventures share this sequence and include optional skill-specific readings, timed organizer instructions, and complete endings. New starter adventures enable TRACE, WHISPER, BROADSIDE, BAZAAR, and OATHBOOK, prepare two alternate rumor drafts plus a related bulletin draft, and include a themed fictional resource and finite-stock supply shop. Spendable character balances start at zero; an organizer must explicitly grant resources. Review their audiences under **Prepare rumors & news** and explicitly publish them when ready; existing events receive no retroactive story content. Prop QR/printed codes identify an instrument; a message's separate release word comes from an earlier discovery. The journal preserves actual revealed readings and requested hints after refresh.

## Author and manage instruments

Use **Prepare adventure** to add or edit RELIC examinations, DEAD DROP messages, CIPHERBOX puzzles, and WAYFINDER scenes through forms. Access conditions require all selected completed discoveries, skills, and flags; if event statuses are selected, any selected status qualifies. Success and exhausted-attempt outcomes set declared flags. Self-referencing or cyclic completed-discovery requirements are rejected.

DEAD DROP supports a written message/transcript and optional uploaded MP3, Ogg, or WAV recording, with at most 1 MB of audio across the adventure. Keep a transcript for players who cannot or prefer not to listen. There are no external recording URLs. Protected text/audio reaches the character's journal only after an authorized opening.

**Preview as this character** is read-only and uses that character's current progress. To intervene, use an explicit **Release discovery**, **Solve puzzle**, or **Reset failed attempts** override; actions are logged. Resetting failed attempts preserves previously learned readings and applied flags. A scene's start/end times and capacity are checked on the server, and ineligible reservations do not occupy places.

Save definitions while the event is Draft or Rehearsal and has no player progress. Once play has started, use a rehearsal copy to try changes. Copies accept source events with at most 100 character profiles and create new prop codes, character identities, unassigned approved characters, and initial inventory. Sharing policies and authored story entries/groups are copied independently, with character, faction, and group audiences remapped to the new event. Copies carry no memberships, invitations, discoveries, attempts, reservations, exchange sessions, contacts, receipts, collected rumors, player investigation records, balances, or agreements. Authored resource catalogs and shops copy with new shop/stock identities and their initial stock quantities. **Reset rehearsal progress** works only on a dedicated copy in Rehearsal; it clears that copy's exchanges, contacts, receipts, gameplay, journal, reservations, rumor collections, and investigations while preserving its policies, authored story/publications/groups, source event, and character records. Economy reset clears balances, economic receipts, and agreements, restores shop stock to its authored initial quantity, and restores the captured initial character inventory, removing items purchased or traded during that rehearsal.

Print labels contain only event name, instrument title/type, code, and QR. Keep solutions in organizer fields. On a focused instrument, choose **Focus on this prop** for a compact display and optional fullscreen. It still uses the current approved character's permissions; it is not an anonymous or locked kiosk. Use a player account on an unattended device.

## Exchange introductions and readings

1. Both players join the same Live or Rehearsal event and select their own assigned approved character under **Exchanges**.
2. One player chooses **Show my QR**. The other chooses **Scan Player**, scans that temporary exchange QR, or enters its 12-character code. Camera use requires consent; an image or typed code is also supported. Character badges remain a separate identity lookup.
3. Each player selects up to ten permitted readings from their own journal and, with BAZAAR enabled, owned inventory quantities and fictional resources, then saves their offer. Both see the partner's current public character identity and offered titles; the other player's reading text/audio remains hidden before completion.
4. Both players explicitly confirm the same offer revision. Only server-confirmed completion creates contacts, received journal readings, atomic item/resource transfers, and receipts. Leave both offers empty for an introduction without sharing readings.

The invitation expires 15 minutes after creation; changes do not extend it. Changing either offer clears both confirmations. A changed organizer policy also clears confirmations on pending exchanges. Either participant may cancel; the invited player may reject. Refresh/resume reads current server state. On an uncertain request, use the explicit retry to reconcile that same request. No pending exchange or offer is queued offline.

An exchange can copy at most 2 MB of readings in total. Receiving an already-known original does not duplicate it, including a reading shared back to its original reader. Copies retain the reading as discovered; they do not complete instruments, set flags, or grant skills. Items and resources move only when separately included in the reviewed trade terms. Peer offers show selected names and quantities, never private inventory notes or the player's other balances/items. If an offered item changes, or any final balance, stock, or inventory limit fails, the entire confirmation rolls back and both players must review current terms. Completed receipts remain readable after expiry or a partner's departure while you retain access to the assigned character and event.

Under **Sharing permissions**, organizers choose **Shareable**, **Restricted**, or **Organizer only** per instrument. Existing and newly authored instruments default to Restricted: personal discovery is allowed, exchange is not. New complete starter adventures explicitly make RELIC and DEAD DROP readings shareable. Organizer only prevents new player listings, lookups, discoveries, and overrides; organizer authoring/read-only preview remains available. Earlier authorized journal readings remain readable and cannot be retracted by changing a policy. Disabled or removed instruments cannot provide new exchange material.

## Trade and record agreements

1. Enable **BAZAAR** and **OATHBOOK** in event setup for existing events. Under BAZAAR's organizer controls, define fictional resources, a shop, and stock with a whole-unit price. This spendable catalog is independent of `setup.rules.resources`; rule defaults never grant funds. Resource IDs and names stay fixed once created so accepted terms remain clear.
2. Select a character and grant or correct its resource balance with a reason. Correct shop stock/prices with a reason and save; a changed displayed stock version requires players to refresh before buying. Purchases require Live or Rehearsal and commit payment, stock decrement, item delivery, and receipt together.
3. For barter, use **Exchanges** with the other player. Save selected item/resource quantities, review both offers, and independently confirm. An introduction or reading-only exchange still works without BAZAAR. A badge scan does not authorize spending.
4. In **OATHBOOK**, choose **Propose agreement**, name participants and optional independent witnesses, write exact terms, and optionally add an expiration and fixed resource transfers. The creator must explicitly accept too. Proposed terms can be revised; a revision clears all acceptance and witnessing. Witnesses attest the terms and cannot authorize payment.
5. After all participants accept, each chooses **Confirm fulfillment**. The final server confirmation performs every listed resource transfer once and records fulfillment. Narrative obligations rely on the participants' judgment. Funds are neither reserved nor moved merely by accepting terms; insufficient resources can prevent settlement.
6. A participant may record a dispute. Organizers review signatures/history and record a reasoned ruling, optionally executing already accepted, eligible, unexpired settlement terms. A previous payment never executes twice. Use a linked BAZAAR correction for a separate audited balance adjustment; original receipts remain intact.

Agreements support 2–8 participant characters from distinct accounts, up to five independent witnesses, and up to 16 fixed resource transfers. Expiration prevents new acceptance, witnessing, or settlement; organizers may still record a narrative ruling. Private agreement access belongs to the captured account and currently assigned character, or authorized event managers. Reassignment does not hand the original agreement or trade journal receipt to a new player. If a newly proposed revision names a new participant, that account can see the current terms and subsequent authorized history, not earlier private terms; event managers retain the full review history. Item loans, borrowing, escrow, external payments, and automatic narrative adjudication are outside this batch.

Current balances, shops, offers, agreements, and detailed transaction records require connectivity. An already-authorized completed trade journal receipt may remain in the ordinary saved-readings archive; it does not establish current balances or spending rights. Unsaved text and uncertain requests remain only in the open tab. Use the explicit retry after an uncertain response to reconcile the same request; a local tap never establishes completion.

## Investigate and follow the living story

1. Organizers open **Prepare rumors & news**. Create a WHISPER rumor or BROADSIDE bulletin, choose its readers and any discovery/skill/flag/event-status conditions, then save. Staff can author and submit entries; an owner, organizer, or project superuser must review and publish. Publication requires Live or Rehearsal.
2. Players open **Rumors & news** with their own approved character. Eligible rumors show their title and source; select **Collect** to record that account in the journal. Different characters can receive different tellings. Collection does not reveal hidden truth, prove a claim, or complete a discovery.
3. Open **TRACE · Investigation** to add evidence, a person, a place, or a theory. New records default to private. Cite up to ten permitted journal readings and connect up to ten currently visible records. Select an audience deliberately when sharing your written notes.
4. Use **Exchanges** to transfer an organizer-permitted rumor or other reading with both players' confirmation. A citation alone does not share its text. Another player sees citation metadata only after independently acquiring the same original reading, and sees a linked record only while allowed to read it.
5. Players can propose a bulletin from their own observations or permitted journal material. It remains awaiting review until an organizer publishes it. Editing a live bulletin or rumor creates a separate draft: the last approved publication remains visible until **Publish**. Republishing requires a correction note; **Withdraw** removes current availability. A published bulletin can be opened as a printable poster.

**Who can read it?** Public means approved characters inside this event. Faction and group audiences follow current affiliations and group membership. Selected-character audiences name specific characters; a private TRACE record with nobody selected belongs only to its author. Organizers and superusers cannot open another player's private notebook through their management role. Sharing text does not expose private citations, inaccessible linked records, account email, or hidden organizer truth.

Collected WHISPER readings are tied to the collecting account as well as its assigned character. Reassigning a character does not give its new player the previous player's captured rumors or private theories. The new player may explicitly collect a currently eligible publication or receive a permitted reading through a newly confirmed exchange. Existing immutable journal/copy provenance is retained; a new completed receipt can grant access without duplicating the underlying copy. Current ownership and access are checked again after reconnecting.

Rumors and publications remain server-backed. A withdrawal or audience change prevents new access, but cannot retract readings already legitimately collected or exchanged. Publication/shareability changes clear pending exchange confirmations. No story or investigation action changes inventory, story flags, scene attendance, or adventure completion.

## Run a cooperative challenge or fictional prop

1. Start a complete adventure, assign its two prewritten characters, and put the event in rehearsal. New starters include a published SIGIL procedure and STATIC signal; existing events are never silently populated.
2. In SIGIL preparation, review the roles, ordered steps, time limits, discovery conditions, and result text/flags. Add inventory or whole-unit resource requirements where needed and explicitly mark any component consumed on success. Save a draft, then publish it.
3. Print the instrument label. The host scans its QR code or enters its short code, reviews the required components, binds the host's matching inventory items, and names the people performing each role.
4. Gather around the host device and complete the ordered steps. These role names describe people cooperating in person; they do not authorize spending from another player's character. Only the host's reviewed components can be consumed.
5. Pause before stepping away. Resume explicitly when ready. Event pause freezes active challenges; reopening the event does not resume them automatically. Cancellation consumes nothing and permits a new attempt. A successful character cannot farm the same challenge again.
6. Read STATIC using its prop/zone code. Every result says **Fictional event reading**. A starter's prepared reading changes after successful cooperation; staff may choose another published state with a recorded reason or restore the prepared rules.
7. Save a STATIC reading to keep an immutable journal copy. If the signal changes before the server accepts collection, refresh and review the new reading. Retrying an already accepted request preserves the original receipt.
8. Enter immersive prop mode for the current player procedure or reading. Sound starts silent and requires an explicit user gesture; text and visual state remain available. Fullscreen is optional. Use a player account on unattended hardware because hiding navigation does not remove an organizer account's permissions.

SIGIL timing is server-authoritative. A visible active host renews a 20-second connectivity lease; missed contact pauses at the lease boundary and preserves the remaining active time. If the actual challenge deadline arrives first, it fails and records its outcome on the next authorized server interaction. If access or the configured outcome becomes invalid, staff can see a recorded cancellation instead of a result. The interface freezes controls when connectivity is uncertain; it never declares local success. After reconnecting, review the server's current state and explicitly resume a paused attempt. Coordinated multi-device timing is outside this release.

## Saved readings and connectivity

A successfully loaded player journal can be saved automatically on this device. **Saved readings** shows only previously revealed text/audio, with its last-check time and read-only status. The service worker caches the public app shell; it never caches API responses. The device must first load ORACLE and the readings while connected, and its browser must support the required storage.

Offline mode cannot sign in, check current permissions, unlock a clue, submit an answer, change inventory, reserve a scene, or complete an exchange. No actions are queued for replay. Completed exchange readings, receipts, and authorized WHISPER snapshots use the same journal archive. Each snapshot retains the existing limit of 1,000 journal entries and 3 MB; larger journals require connectivity for their complete contents. Codes, offers, contacts, pending requests, TRACE notebooks, hidden truth, current news, current balances, shops, pending trade offers, detailed transaction objects, and agreement terms/signatures are not stored offline. Completed trade journal receipt text may be saved with other already-authorized journal readings. Reconnect to continue play. Saved readings belong to the last signed-in account; logout/account switching and known access revocation clear the relevant cache. **Clear saved readings** removes local copies. Revocation cannot be discovered while disconnected, so use device access controls for private readings on shared hardware. This is basic reading continuity, not a local event server or full offline synchronization.

## Build and run an event

1. Create an account, then choose **Blank event** for your own setup.
2. In **World**, select a theme and starter template. Optional theme audio plays only when someone taps its cue button.
3. In **Event**, enter the name, public briefing, location, and optional start time. These details are visible to every event member, including prop viewers.
4. In **Material & rules**, add briefing entries, choose who can read each one, and mark player entries to include in prop display. Expand **Edit rules profile** to define starting ranges and named expertise/outcomes. Disable Briefing if you do not want its entries displayed; authored records remain saved.
5. In **Review**, inspect the player material and select **Create event**. The new event starts in Draft. Later, use **Edit field kit** and **Save field kit** to update it.
6. Switch to **Player preview** or **Prop display** to inspect the appropriate material. **Change theme** preserves the event's rules, authored records, membership, and progress.
7. Open **Invite people**. Player codes can admit a group; Staff and Organizer codes admit one person. Copy the code while displayed—ORACLE stores its hash and cannot redisplay it. You deliver the code; ORACLE sends no email invitations.
8. Players create an account, choose **Join an event**, and enter the invitation code. Spaces and hyphens are accepted. They can read permitted material and download the player pack.
9. Use **People** to manage members. Start rehearsal, go live, pause/resume, end, and archive as appropriate. Ending closes enrollment; archiving freezes event edits. Ending and archiving require confirmation.

**Saving:** The setup form saves when you select **Create event** or **Save field kit** on the Review step. It shows unsaved, saving, or confirmed status. Unsaved form work lives in the current browser page, not a durable offline draft. Canceling with edits asks before discarding them. A failed request keeps the open draft available to retry. Changes need connectivity; refresh to see another organizer's edits. A stale save returns a conflict instead of overwriting a newer event version.

**Reading settings:** Select Dark or Outdoor, follow the device's motion preference or reduce motion, and collapse navigation for more reading space. These preferences persist in this browser. Event content is stored on the server; there is no telemetry or behavioral analytics.

**Shared prop devices:** Player and prop previews exclude organizer-only entries, but previewing does not lower a signed-in organizer's account permissions. Use a separate player account on an unattended device. Prop display is a reading view, not a locked kiosk or a new authorization role. Fullscreen depends on browser support.

## Run live encounters with STAGEHAND

1. Enable **STAGEHAND** and **WAYFINDER**, then open STAGEHAND's staff workspace. Every new starter has a planning encounter with example performer, prop, and check-in preparation. It begins unlinked, so the original adventure remains playable.
2. Configure an encounter: choose its WAYFINDER scene, public message, private staff notes, assigned staff, capacity, return window, and checklist. Linking transfers admission to party dispatch. The authored scene's conditions, time window, and maximum still apply. Saving configuration clears readiness and pauses an open encounter.
3. Assigned staff acknowledge each preparation with a reason, then explicitly open the scene. Managers can operate all encounters; staff see only their assignments. Existing WAYFINDER attendance remains counted. An unready check or pause blocks further dispatch.
4. Create a waiting party from approved assigned characters, or let a player join the queue for their own character. Every member reviews and accepts their own current assignment, including self-queued players. Queueing does not reserve capacity. Staff dispatch the whole accepted party only when every member is eligible and the group fits. Players may then join the linked WAYFINDER scene without consuming another seat.
5. Monitor the server's return timestamp. **Overdue** keeps seats reserved until staff acknowledge return or cancellation. Pauses do not extend the absolute window. Cancelling/ending one encounter retains its waiting queue for explicit redirect or cancellation; redirecting moves the whole waiting party and clears all consent. Dispatched parties must return/cancel before reassignment. Ending the whole event cancels all waiting/dispatched assignments.
6. Prepare an operational announcement with public text, then have an organizer review and publish it through **BROADSIDE**. Staff submission alone never publishes. Any encounter revision hides its older availability notices and prevents stale drafts from being approved; prepare and approve a replacement from the current state.
7. Make a rehearsal copy to practice. It has fresh planning encounters, no staff assignments or parties, and no inherited approval links. A reset removes actual copied consent, dispatch, readiness, activity, and operational bulletins while preserving authored configuration and source event records.

Players see eligible public scenes and their own response/counts, without staff notes, readiness details, or other members' identities. Shared screens use the same filtered state. Live availability and actions require connectivity; return deadlines are not a local timer or an automatic release. Ordinary return/cancel remains available while an event is paused or an instrument is disabled; archived events are read-only. Staff still make the in-person readiness and return decisions.

## Create and use characters

1. Join or open an event and select **Characters**. Organizers can expand **Character settings & factions** to enable player creation, require approval, choose 1–10 active characters per player, set public fields, and create event factions. Defaults allow player creation, require approval, and permit one active character per player.
2. Select **Create character** and follow **Identity → Abilities → Kit & goals → Review**. Add an optional portrait, pronouns, biography, and faction; choose attributes and skills allowed by this event; then add private objectives and proposed starting equipment. JPEG, PNG, and WebP uploads up to 8 MB are resized locally for storage.
3. Use **Save draft** or **Save character** to persist the sheet. Open it and choose **Submit for approval**. If approval is disabled, choose **Activate character**. Saving an edited approved character returns it to Draft, so its public badge stays unavailable until it is approved or activated again.
4. An organizer opens a submitted sheet and chooses **Approve character** or **Request changes**. A change request includes private feedback. The first approval creates the starting inventory once. Reapproval does not duplicate or refill items; organizers use the separate Inventory controls for later corrections, with an explicit reason recorded alongside before/after quantities. Confirmed purchases and trades also update current inventory.
5. To prepare a prewritten character, an organizer chooses **Unassigned · prewritten character** under Assign to. Use **Assign character** later to give its complete private sheet to a current event member. Assignment obeys the destination player's active-character limit and removes the former assignee's private access immediately.
6. Open an approved character and choose **Public badge & QR** to inspect the permitted identity, copy its link, or print a badge. **Scan a badge** accepts a camera scan, a QR photo, the printed code, or a badge link from this ORACLE site. Readers must sign in and belong to the same event. A badge grants no editing, inventory, or organizer privileges.

Character name is always shared after approval. The organizer may also allow portrait, pronouns, biography, faction, and skills. Private objectives, attributes, equipment, inventory, review notes, and account details are excluded from public cards. The complete sheet is visible to its assigned player, event managers, and project superusers.

Camera access starts only after **Start camera** and the browser's permission prompt. It stops after a successful scan, Stop camera, closing the scanner, or hiding/leaving the page. Camera frames and QR photos are decoded locally; only the extracted badge identifier is sent for an authorized lookup. If camera access is denied, enter the code or choose a QR image instead. Portraits are different: the resized portrait is saved with the character.

**Copy to another event** creates a new Draft assigned to you. Name, portrait, pronouns, and biography carry over; only skills present in the destination rules remain. Attributes use destination defaults. Faction, private objectives, starting equipment, inventory, approval, and event progress are reset, with new character and badge identifiers. The destination's creation policy, membership, and character limit apply.

Retiring a character makes it read-only and invalidates its badge. Replacing a badge code invalidates the previous printed QR/link immediately. Archived event data remains readable under its normal permissions, while edits are blocked.

## Project administration

An operator-provisioned project superuser can open **Project administration** to search accounts, disable or re-enable access, sign out sessions, and review project activity. **All events** provides event management across the project. Disabling an account revokes its sessions and prevents sign-in while retaining its data; re-enabling preserves its password. The interface cannot disable superusers, change passwords, or grant new superuser roles.

Provisioning uses protected deployment settings, never an email address embedded in the repository. An already-existing account selected by the operator is promoted during `npm run migrate` without replacing its identity or password. If that reserved account does not exist, first registration requires an operator-held setup secret as well as normal account details. Knowing the reserved email alone cannot claim the role. See [deployment provisioning instructions](docs/DEPLOYMENT.md#project-superuser-provisioning).

## Export, reuse, and customize

**Export organizer backup** downloads event setup and all authored material, including private organizer notes. Keep that file private. **Export player material** removes organizer-only entries on the server. A player pack still contains public event details, the theme, and rules definitions; put secrets only in entries marked **Organizer only**.

From the event list, choose **Import briefing pack**, select the JSON file, inspect its validation preview, and select **Create from pack**. Import always creates a new Draft owned by the importing account. It keeps the pack's theme, rules, and content identifiers but creates a new event identity and fresh owner membership. Existing events remain intact. Memberships, account information, invitation codes, activity history, and live event state are never exported or imported.

An organizer pack is a reusable content backup, **not a database backup**. Format 1 contains event setup and briefing material; it does not include adventure definitions/solutions, discoveries, reservations, sharing policies, exchanges, contacts, receipts, story entries/publications/groups, rumor collections, investigation records, cooperative/fictional instrument state, operations configurations/parties, characters, factions, character settings, inventories, participants, or event history. Use the separate character-copy workflow to reuse a character identity. A player pack can also seed a new event, but cannot recover omitted private material.

Custom themes can be supplied inside a validated event pack. They may contain approved color, font, texture, icon, terminology, and sound choices; arbitrary CSS, markup, scripts, formulas, and external asset URLs are rejected. There is no custom theme editor in this release. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#event-pack-format) for the exact format and a valid example.

## Permissions

| Action | Owner | Organizer | Staff | Player |
| --- | --- | --- | --- | --- |
| Read player material and own event roster | Yes | Yes | Yes | Yes |
| Read organizer-only briefing material | Yes | Yes | No | No |
| Author/submit rumors and bulletins; read their hidden story notes | Yes | Yes | Yes | No |
| Publish/withdraw stories or manage audience groups | Yes | Yes | No | No |
| Use own approved character for rumors, proposals, and TRACE | Yes | Yes | Yes | Yes |
| Bypass another player's private TRACE records | No | No | No | No |
| Configure STAGEHAND encounters and staff assignments | Yes | Yes | No | No |
| Acknowledge readiness, operate parties, prepare operations news | Yes | Yes | Assigned encounters only | No |
| Accept own party or cancel own sole waiting party | Yes | Yes | Yes | Yes |
| Publish operational BROADSIDE announcements | Yes | Yes | No | No |
| Author/publish SIGIL or STATIC definitions | Yes | Yes | No | No |
| Operate SIGIL or prepared STATIC states with a reason | Yes | Yes | Yes | No |
| Host SIGIL or collect STATIC using own approved character | Yes | Yes | Yes | Yes |
| Spend another character's assets through an in-person role | No | No | No | No |
| Edit event, theme, setup / change lifecycle | Yes | Yes | No | No |
| Export organizer backup | Yes | Yes | No | No |
| Export player material / view prop material | Yes | Yes | Yes | Yes |
| Invite players or staff | Yes | Yes | No | No |
| Invite organizers | Yes | No | No | No |
| Change membership roles | Yes | No | No | No |
| Remove players or staff | Yes | Yes | Self only | Self only |
| Remove an organizer | Yes | Self only | No | No |
| Review invitation list/activity | Yes | Yes | No | No |
| Remove or demote the owner | No | No | No | No |

The table describes event membership roles. A project superuser has an explicit server-checked project role with access across events and management authority. Ordinary membership and badge possession cannot grant that role. Event access is enforced on every server request. A remembered event URL or an old session does not preserve access after membership removal. Accounts keep their email private; the event roster contains display names and roles. Reusable Player codes grant no higher role. Privileged codes are single-use, and role changes revoke any outstanding invitations issued by the changed member.

## Environment settings

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL connection string; use Railway private references |
| `APP_ORIGIN` | Exact browser origin, without trailing slash, such as `https://your-domain.example` |
| `NODE_ENV` | `production` for deployed environments; enables HTTPS-only secure cookies |
| `PORT` | Railway-supplied listening port; local default 3000 |
| `APP_ENV` | `development`, `staging`, or `production`; staging is visibly labeled |
| `REGISTRATION_ENABLED` | Set `false` to close account registration; existing sign-in still works |
| `DATABASE_SSL` | `require` for verified external TLS, or `disable` for the intended private network connection |
| `BOOTSTRAP_SUPERUSER_EMAIL` | Optional operator-selected reserved account; protected deployment configuration only |
| `BOOTSTRAP_SUPERUSER_SETUP_TOKEN` | Optional 32–512-character operator secret, required only to claim a reserved account that does not already exist |

When `APP_ORIGIN` is omitted, Railway's generated `RAILWAY_PUBLIC_DOMAIN` may supply the HTTPS origin. Set it explicitly for a custom domain. Use one canonical app origin; redirect aliases to it. Cookie-authenticated writes from other origins are rejected.

Sessions use random opaque tokens stored as SHA-256 hashes, with a seven-day server expiry. Passwords use salted scrypt. Password changes invalidate other sessions. Rate limiting is database-backed. There is no email password-reset workflow in this batch; protect your credentials and follow an operator-verified account recovery procedure if needed.

## Verification

```bash
npm run verify
```

Without `TEST_DATABASE_URL`, the suite uses PGlite (PostgreSQL compiled to WebAssembly). This validates SQL, API permissions, persistence, and request behavior locally. PGlite is single-connection and is not used in production; its results do not establish PostgreSQL multi-connection lock behavior.

For the production database path, use a dedicated disposable database whose name begins with `oracle_test`:

```bash
export TEST_DATABASE_URL='postgresql://oracle:local-password@localhost:5432/oracle_test'
npm run verify
```

The suite resets that database's `public` schema. Never point it at an event database. The GitHub workflow provisions PostgreSQL 18 for this gate, rehearses `pg_dump`/`pg_restore` into a new database with content and identity-sequence comparisons, checks startup and shutdown, and builds and runs the production Docker image with secure session settings.

For a deployed service:

```bash
SMOKE_ORIGIN='https://your-oracle-host.example' npm run smoke
```

The smoke command checks the expected application/schema versions, session API, and public assets without creating users or changing event data.

For the configured disposable staging environment:

```bash
EXPECTED_COMMIT='<full-40-character-release-commit>' node scripts/staging-check.js
```

This script waits for the expected deployment commit, app version, and schema. It then creates disposable staging accounts/events to exercise event isolation, invitation redemption, role restrictions, player/prop secret filtering, all three theme switches, pack round trips, stale saves, fresh-session persistence, and immediate access removal. Batch 3 extends the journey through two approved characters, faction/field settings, badge privacy and rotation, inventory initialization/reapproval, prewritten assignment, malformed-write rejection, and cross-event copies. Batch 4 extends it through all three complete adventures, protected readings, puzzle hints/failure/overrides, request replay, reservations, and rehearsal isolation. Batch 5 adds bilateral introductions, selected reading exchange, both-party consent, changed-policy/offer checks, duplicate prevention, receipt persistence, and rehearsal cleanup. Batch 7 additionally verifies finite shops, explicit resource grants, purchase replay, mixed item/resource barter and rollback, an independent witness, revised agreement signatures, settlement replay, disputes/adjudication, linked corrections, and economy-aware rehearsal reset. Batch 6 adds alternate private rumors, hidden truth checks, confirmed QR rumor transfer, private and intentionally shared TRACE records, every audience type with current group/faction revocation, player proposal review, separate live/correction drafts, withdrawal, discovery-gated rumor collection, and story-aware rehearsal copy/reset. Batch 8 adds the same two-role/three-step cooperation in every theme, frozen pauses and reconnect state, one-time resource/item consumption and final-step rollback, conditional/manual fictional signals, stale collection/replay, staff access, and actual copied instrument play/reset. Batch 9 runs all twelve instruments in every theme and verifies scoped readiness, exact whole-party assent, capacity/legacy attendance, scene cancellation and redirect, pauses/returns, approved current operational news, actual copied operations reset, and whole-event closure. Cleanup archives test events and logs out test sessions. Mutations are restricted to the allowlisted staging origin. The `staging-smoke` GitHub job runs this after `verify` and uses `GITHUB_SHA` as the required deployed commit. After promotion, `production-smoke` waits for that same commit at the canonical production domain and runs public GET checks without creating users or events.

## Railway deployment and recovery

Follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Staging and production use separate Railway projects, PostgreSQL databases, and volumes. The `main` branch is for integration, `staging` deploys the test environment, and Railway production follows the dedicated `production` release branch. Future promotions require a successful CI run and the staging checks described in the release guide. Scheduled backups are not configured: the workspace currently reports zero managed-backup capacity. The passed CI restore rehearsal verifies recovery tooling, but does not back up live event data.

## Troubleshooting

- **Startup reports CONFIG_OR_SCHEMA_ERROR:** Check required environment values and run `npm run migrate` using the same database as the application.
- **Ready endpoint returns 503:** PostgreSQL or the expected schema is unavailable. Inspect operational logs and database state; do not bypass readiness.
- **Sign-in does not persist after deployment:** Use HTTPS and make `APP_ORIGIN` match the address in the browser. Production cookies require HTTPS.
- **Write request is rejected:** Use the canonical origin. An alternate hostname or incorrect `APP_ORIGIN` fails the Origin check.
- **Invitation fails:** Check its expiry, remaining uses, revocation, issuer role, and whether the event has ended. Staff/Organizer codes work once.
- **Edit conflict:** Preserve any unsaved text you need, refresh the event, review the latest details, and reapply your change.
- **Pack import is rejected:** Use event-pack format version 1. Review the validation message for unsupported fields, invalid rules, theme contrast, duplicate identifiers, or oversized content.
- **No rumors appear:** Check WHISPER is enabled, the entry is published, your character is approved and assigned to you, and its audience/conditions include that character. Drafts are never collected.
- **A corrected bulletin still shows old text:** Save prepares the correction draft. An organizer must review and select Publish before the live publication changes.
- **A TRACE citation or connection is missing:** You need current access to the linked record or your own authorized copy of the cited original. Sharing notes alone does not reveal those records.
- **An exchange cannot complete:** Check both approved character assignments, event status, the fixed expiry, current sharing permissions, and both confirmations. Changed offers require both players to review again.
- **A reading cannot be offered:** Only your discovered, currently shareable readings from enabled instruments qualify. Receipts and private character fields cannot be offered as readings. BAZAAR items/resources use their own separate trade selectors.
- **A purchase or trade fails:** Refresh the displayed stock/items, check available quantities and fictional resources, and review both offers again. A failed final check transfers nothing.
- **Agreement acceptance disappeared:** A proposed terms revision clears all earlier signatures and witness attestations. Review and accept the current revision.
- **A settlement is waiting:** Every participant must separately confirm fulfillment. A witness cannot authorize payment, and current resources must still cover every accepted transfer.
- **An adventure action is blocked:** Confirm that the event is Live or Rehearsal, the character is approved and assigned to you, the instrument is enabled, and its earlier discoveries are complete.
- **A message rejects the printed code:** Its release word is separate from the prop label; find that word in an earlier reading.
- **Adventure editing is locked:** Make a rehearsal copy. Only a dedicated copy in Rehearsal can have its progress reset before editing.
- **No readings appear offline:** Open the adventure and reveal its readings while connected first. Browser storage may be unavailable or have been cleared.
- **A badge is unavailable:** Sign in to the correct event. Only approved characters resolve; an edit, retirement, removed membership, or replaced code may invalidate an old badge.
- **A character cannot be created or assigned:** Check that player creation is enabled and the current event member has room under the active-character limit.
- **Inventory did not refill after reapproval:** This is expected. Starting equipment initializes once; an organizer must change current inventory separately.
- **Material is missing:** Check that Briefing is enabled, the entry is visible to players, and—if viewing a prop—it is marked for prop display. Refresh after saving.
- **Theme changed but outdoor colors stayed light:** Outdoor is a local readability override. Choose Dark under Reading settings to see the theme palette.
- **Too many attempts:** Authentication and join requests are rate limited. Wait for the stated interval.
- **An organizer cannot promote someone:** Only the owner can change roles or invite another organizer.

App logs include request identifiers and error categories. Do not add passwords, session tokens, invitation codes, database URLs, or private briefings to logs.
