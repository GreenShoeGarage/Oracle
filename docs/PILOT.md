# ORACLE beta pilot

ORACLE is ready for a supervised beta rehearsal. **The physical-device and human pilot has not been run.** Automated tests, the isolated load rehearsal, browser emulation, and deployed HTTP checks are separate evidence. They cannot establish that a player can use a real phone comfortably during an event.

This guide covers Batch 11's remaining acceptance work. Use [STATUS.md](STATUS.md) for the exact deployed release and existing automated evidence. Record the version and full deployment commit actually used; start a new report when the tested release changes. Do not combine results from different versions into an apparently complete release report.

## Prepare one small rehearsal

Use a disposable rehearsal event with consenting participants and fictional content. Keep pilot accounts and data separate from a live event. Do not reset a live event, repurpose the production superuser, or record anyone's login credentials. An organizer, two new players, and an observer are enough for the core walkthrough; the organizer may also observe after completing the unassisted setup task.

Have an actual iPhone with Safari, an actual Android phone with its chosen supported browser, a desktop organizer computer, and a shared tablet. Record each model, operating-system version, browser/version, and any important accessibility setting. A resized desktop window does not count as a phone. Use both normal-browser and installed-app modes for the phone checks. Installation availability and terminology vary by browser; an unsupported installation path is a recorded limitation, not a silent pass.

Print the fictional prop codes and a small paper observation sheet. Have a safe place to stop walking before scanning. Prepare two disposable events and separate player accounts for privacy checks. Arrange a reversible way to disconnect each physical device from the internet; a UI label saying “offline” alone does not establish network loss.

Begin with Fantasy, then repeat the connected instrument rehearsal in Cyberpunk and Wasteland. Use separate starter events so changing a theme or resetting a rehearsal cannot alter the evidence from another run. Enable and prepare the relevant instruments. Give fictional resources explicitly; starter rule defaults do not grant spendable funds. Publish the intended material and approve/assign the player characters before testing protected journeys.

## Record results locally

From the repository root, create a private report outside the repository:

```sh
node scripts/pilot-report.js init /tmp/oracle-pilot.json
node scripts/pilot-report.js check /tmp/oracle-pilot.json
node scripts/pilot-report.js check /tmp/oracle-pilot.json --require-ready
```

`init` refuses to overwrite an existing file. The new report has every observation and load measurement set to `not_run`; it does not perform a test. The tool makes no network requests, reads no browser or account data, and sends no telemetry. Keep your actual report and private supporting evidence in your own controlled location; `/tmp` is only a convenient local example and is not durable storage.

Edit the JSON in a text editor. Fill `release.version`, the full 40-character `release.commit`, and the exact `release.origin` without a path or query. Record the four physical devices. Every attempted observation needs a UTC `observedAt`, an observer alias such as `observer-1`, an outcome description or sanitized evidence reference, and the relevant device IDs. A passing row must include all devices required by its check. For a check spanning several devices, identify each device's result in the evidence; if one fails, the combined row fails. `humanObservationAttested` remains false until an observer confirms the report records actual people using actual devices.

| Status | Use it when |
| --- | --- |
| `not_run` | Nobody has attempted this check. |
| `pass` | The observed behavior meets the stated acceptance result on every required device. |
| `fail` | The check ran and behavior did not meet the acceptance result. |
| `blocked` | A missing device, permission, preparation step, or other constraint prevented completion. Explain it. |

`check` exits 0 for a structurally valid report even when incomplete, and prints every outstanding gate. `--require-ready` exits 2 until all recorded gates are satisfied. Malformed reports exit 1. No report status is a deployment command. Even a complete report is self-reported evidence, not independent certification of untested devices or hosting capacity. The schema accepts only documented fields and limits reports to 1 MB; reference evidence instead of embedding recordings or application exports.

Use aliases, generic device descriptions, elapsed times, and cropped/redacted screenshots. Do not include names, email addresses, character biographies, private readings, unrevealed answers, invite/badge codes, cookies, tokens, database URLs, or whole network/storage exports. The validator checks structure, not the privacy of free text; review it before sharing or committing anything. Evidence can be a local reference such as `pilot-notes/iphone-camera-01` plus a concise factual observation. Do not add analytics or recording services to collect the pilot.

## Observe setup and the first five minutes

Ask each participant to perform a task before explaining the interface. Observe confusion without turning the trial into a guided demonstration. Record completion time, wrong turns, requests for help, and the words the person expected to see. Do not record participants' identities.

| Report check | Task and acceptance result |
| --- | --- |
| `organizer-onboarding` | On the desktop, create a rehearsal from a starter, explain its purpose, locate private preparation notes, prepare props, invite players, approve/assign characters, and start the rehearsal. The organizer can describe what players will do next and can recover from a mistaken selection. Record any assistance. |
| `player-onboarding-iphone`, `player-onboarding-android` | A new player joins, creates/submits a character where creation is permitted, understands approval/assignment status, opens the approved character, and finds the first task and manual prop-code entry. The player can distinguish their character from their account and understands who can see the result. Record any assistance. |

If assistance was necessary, record the obstruction as a finding and recheck the revised journey. Judge whether the task remained understandable and usable; do not hide a stalled task by counting the observer's actions as the player's success.

## Run the complete connected event in every theme

Each theme has one report row for every instrument, for example `fantasy-relic`, plus `fantasy-connected-event-closure`. Use both players together, keep the organizer on the desktop, and record the devices actually used. Repeat all thirteen rows for Cyberpunk and Wasteland. Instruments with shared-device roles remain shared-device experiences; this does not assert coordinated multi-device timing.

| Instrument | Task and acceptance result |
| --- | --- |
| RELIC | Scan or type a prop code, choose an eligible examination, and collect the authorized reading. A protected reading stays inaccessible before its required discovery. A repeated opening does not duplicate its effect. |
| DEAD DROP | Follow the prior clue, enter the authored release word, and open the message. Check text/transcript and optional recording without requiring audio. A failed or denied attempt does not reveal protected text or sound. |
| CIPHERBOX | Try an incorrect answer, request an allowed hint, then solve the puzzle or use its authored exhausted-attempt fallback. Feedback and the resulting journal/outcome match the chosen path. |
| WAYFINDER | Find the next eligible scene, join when allowed, and understand full, paused, closed, or otherwise unavailable states. Current attendance and capacity match the organizer's view. |
| TRACE | Save a private theory with a permitted journal citation, then intentionally share one record. The other player sees the selected record but cannot read private theories or inaccessible citations. |
| WHISPER | Receive the two prepared audience variants with the appropriate characters. Each remains an attributed, unverified rumor; organizer truth and other audiences stay hidden. |
| BROADSIDE | A staff member proposes a notice; an organizer reviews/publishes it. Players see the current approved notice. Correct or withdraw it and confirm stale content is no longer presented as current. |
| BAZAAR | Give fictional funds, buy finite stock, then complete an item/resource barter with two explicit confirmations. Check both balances, inventory, stock, and receipts. Repeating the accepted request does not charge or transfer again. |
| OATHBOOK | Propose terms, revise them, and verify old acceptance is cleared. Collect the required participant/witness actions, settle once, and inspect the receipt. Witnessing alone cannot authorize another player's payment. |
| SIGIL | Assign the in-person roles on the host device, complete ordered checkpoints, and observe the result. Also disconnect the host during a separate attempt, observe its server-controlled pause/failure, and explicitly recover after reconnecting. The client must not invent success. |
| STATIC | Read a fictional prop state, change an eligible published condition or staff selection, and collect the current result. Earlier collected readings remain historical; the current reading is clearly fictional. |
| STAGEHAND | Complete staff readiness, queue a party, obtain every member's acceptance, dispatch within capacity, and return/check in. Delay or cancel another encounter, explicitly redirect its party, and verify approved availability notices match the current scene. |
| Connected event closure | Follow the clue, exchange selected readings, investigate, trade, cooperate, and attend the dispatched encounter as one event. Close the event while one device has an older view. New live actions must stop after revalidation; open parties/capacity and staff/player views settle consistently. Previously authorized history remains identifiable as history. |

The reading exchange must include both a character introduction and selected reading copies: a badge identifies a person, while a temporary exchange invitation opens a mutually confirmed exchange. The receiver must not see protected reading content before completion. Verify both players' receipt and contact/history views after refreshing.

## Exercise actual devices and failure recovery

| Report check | Task and acceptance result |
| --- | --- |
| `installation-iphone`, `installation-android` | Install using the browser's supported flow; open from the home screen, refresh/relaunch, and confirm the displayed version. Disconnect after the shell and a permitted journal have loaded. The shell and eligible saved readings open; current live data is not represented as cached authority. Record normal and installed modes. |
| `camera-fallback-iphone`, `camera-fallback-android` | Grant camera access and scan a printed code, then deny/revoke access and try manual entry plus a local photo. Cover permission dismissal, unavailable camera, invalid code, dim light, background/foreground, and closing the scanner. Camera indicators stop when scanning closes; every failure offers a usable fallback without exposing codes in the report. |
| `offline-reconnect-pair` | Both phones load their own approved character/journal online. Disconnect both. Explicitly save a field note and queue an information-only invitation/join/reading-offer request. Restart the app, verify the local note/pending status, then reconnect. Nothing sends automatically. Review and explicitly send each eligible request; inventory, funds, live encounters, and protected reveals remain server-confirmed. |
| `duplicate-and-conflicting-change` | Arrange a dropped response after an information request reaches the server, then retry that same queued request. Observe one effect/receipt. On the other phone, change the exchange terms or eligibility before the first phone reviews pending work; stale work needs review or fails visibly. Do not change the payload of an uncertain request or treat “stop retries” as server cancellation. If the network setup cannot produce an actual ambiguous response, mark this blocked rather than substituting a fixture. |
| `expired-session-and-revocation` | End/invalidate a disposable player's session from another signed-in session, and separately revoke membership or character eligibility while its phone has an older view. Attempt a fresh action/reconnect. The app requires fresh authorization and clears inappropriate cached scope; it does not send a queued action under another account. Repeat with each phone. |
| `shared-device-account-event-isolation` | On the shared tablet, account A saves allowed local work. Go offline, sign out, and hand the device to B; reconnect and sign in as B. Repeat with an old A tab and with two events. A's private UI/readings/queue must not reappear for B or another event, including after old requests finish. Offline sign-out must clear the visible local session promptly. |
| `same-browser-note-conflict` | In two desktop tabs sharing the same account/event store, edit the same saved field note. Save competing versions and observe conflict review without silently overwriting the newer note. Field notes are device-local; they are not expected to synchronize between two phones. |
| `update-with-active-tabs` | On desktop and both phones, keep an older tab/app open while a compatible test release is available. Record both versions. New code is applied only after explicit review; pending sends or unsafe active tabs prevent it. Close older tabs as directed, apply, and reopen. Allowed notes/readings survive; another tab is not silently reloaded mid-task. A future compatible test build is needed to close this gate if no update is available during the pilot. |
| `loading-empty-denied-failure` | On desktop and both phones, check an empty account/event, slow loading, permission denial, a disconnected request, and a rejected save. Status, recovery action, and saved/pending/uncertain meanings stay visible; controls recover. A connection change must not erase text being edited or move focus unexpectedly. Unsaved authoring forms are page memory; only the Field desk has explicit durable local Save. |
| `print-and-event-closure` | Print a freshly authorized player aid and minimal organizer fallback list from desktop/tablet. Check selected content, timestamp, legibility, page breaks, and exclusion of private answers. Close the event, refresh, and verify current actions stop while the paper remains clearly historical. |

Changing policy does not retract previously authorized immutable journal readings. Judge cache privacy against the ownership/account/event rules documented in the application, not against a promise to erase already received information.

## Check accessibility on each device

Complete `accessibility-iphone`, `accessibility-android`, `accessibility-desktop`, and `accessibility-shared-tablet`. For each, record actual settings and observations:

1. Use the available keyboard or assistive navigation to reach primary actions, forms, dialogs, and manual code entry. Focus must remain visible, follow a sensible order, and return appropriately when a dialog closes. Check an appropriate screen reader where available; record unavailable coverage as a limitation.
2. Increase text size and test a narrow view. Labels, error messages, menus, and confirmation controls must stay readable and reachable without overlap. Do not use visual appearance at one desktop size as phone evidence.
3. Check touch targets while holding the device, readability in outdoor lighting, and each theme's outdoor/high-contrast setting. Information must remain understandable without relying on color alone.
4. Enable reduced motion and disable optional audio. All required information must remain available as text; recordings need their transcript and no critical outcome may depend on hearing a cue.
5. Observe loading, empty, failed, and permission-denied states with the same settings. Record the task that failed, expected result, actual result, and a sanitized reproduction.

## Keep load evidence separate

The provisional target is **100 simultaneously connected players in one event**. Confirm it before measurement; if changing it, record the reason. The repository's bounded `scripts/load-rehearsal.js` measures an isolated PostgreSQL application with distinct authenticated synthetic player accounts. It performs no Railway load test and does not establish outdoor-network or human performance.

For an existing disposable loopback test database configuration, its local report command is:

```sh
node scripts/load-rehearsal.js --report=qa/load-rehearsal.json
```

Use that script's documented environment guards and disposable-database cleanup. Do not point it at production. Copy only its measured summary into the pilot's `load` section: confirmed target, observed concurrent players, actual duration, environment, hosting/CPU/memory/database configuration, workload, date, and a sanitized evidence reference. Include error/latency measurements, integrity checks, cleanup, and observed limits in the workload/evidence description. Record the shared-IP authentication constraint separately from steady-state player traffic: the unchanged limit is 60 combined registration/login attempts per 15 minutes. Pre-register and sign in ahead of time or stagger arrivals; account creation in advance alone does not remove the sign-in limit. `load.status` stays `not_run` until a real measurement exists; a prepared command or estimate is not a passing result.

For this script's report, use `target.confirmedBeforeRun` for the confirmed target, `measurement.peakPlayerConnections` for observed connected players, and `measurement.durationMs / 1000` for the measured workload duration. Record `pass` only when `result` is `passed`, `capacityTargetMet` is true, and the integrity/cleanup checks succeeded. Preserve the hosting and per-route latency/error limits in the referenced report. Account creation counts alone are not measured concurrency. The pilot validator does not import or independently verify that referenced file; the observer must check its actual result.

A passing isolated result can document capacity for that stated environment. It cannot be relabeled Railway capacity. If intended event size or network conditions exceed the measured workload, record that limitation and schedule the appropriate follow-up before relying on it.

## Resolve findings and read the outcome

Add a `findings` record for each reproducible problem. Link it to report check IDs (or `load`) and use this shape:

```json
{
  "id": "pilot-001",
  "severity": "medium",
  "status": "scheduled",
  "checkIds": ["player-onboarding-iphone"],
  "summary": "Describe the observed problem without player data.",
  "evidence": "Sanitized observation or local evidence reference.",
  "owner": "maintainer-1",
  "resolution": "Explain the planned change and why deferral is acceptable.",
  "scheduledFor": "A named release or date"
}
```

| Severity | Meaning |
| --- | --- |
| `critical` | Unauthorized disclosure/access, data loss/corruption, duplicated authoritative effects, or a blocked core player journey with no workable recovery. Must be resolved and rechecked. |
| `high` | A major task fails or is seriously obstructed; a documented workaround exists. |
| `medium` | Confusion or friction causes wrong turns but the task can be completed. |
| `low` | Minor wording, layout, or polish issue. |

Findings may be `open`, `scheduled`, or `resolved`. A scheduled noncritical finding needs an owner alias, a reason/plan, and a target date or release. A resolved finding needs fix and successful recheck evidence in `resolution`. An unresolved critical finding always blocks acceptance even if scheduled. A failed or blocked required check also blocks acceptance even when its associated finding has a plan; re-run that check and record its actual passing result after a fix or acceptable recovery is verified.

Review the report with the organizer after the event. Record the main source of player confusion, the main organizer burden, observed session duration, actual supported device/browser versions, measured load limits, and the next owned actions in the relevant check evidence/findings. Do not declare Batch 11's human acceptance complete until its required observations exist. Batch 12 release preparation must retain any outstanding device, human-pilot, or hosting limitations explicitly.
