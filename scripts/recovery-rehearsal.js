import { spawn } from "node:child_process";
import { mkdtemp, rm, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createPool, migrate, transaction } from "../src/db.js";
import { digest } from "../src/security.js";
import { defaultSetup } from "../public/kit.js";
import { defaultCharacterProfile } from "../public/characters-model.js";
import { defaultStoryDocument } from "../public/story-model.js";
import { defaultAdventure, defaultAdventureNode, validateAdventure } from "../public/adventure-model.js";
const sourceUrl = new URL(process.env.TEST_DATABASE_URL || "");
const targetUrl = new URL(process.env.RESTORE_DATABASE_URL || "");
for (const url of [sourceUrl, targetUrl])
  if (!/^oracle_test[a-z0-9_]*$/.test(url.pathname.slice(1)))
    throw new Error(
      "Recovery rehearsal is limited to disposable oracle_test* databases.",
    );
assert.notEqual(
  sourceUrl.pathname,
  targetUrl.pathname,
  "Source and restore database names must differ.",
);
assert.equal(
  sourceUrl.host,
  targetUrl.host,
  "Use the same disposable test server for this rehearsal.",
);
const source = createPool({ databaseUrl: sourceUrl.href, ssl: false });
let restored;
const directory = await mkdtemp(join(tmpdir(), "oracle-recovery-"));
const backup = join(directory, "database.dump");
function pgTool(tool, args, inputFd, outputFd, url = sourceUrl) {
  const container = process.env.PG_TOOL_CONTAINER;
  const command = container ? "docker" : tool;
  const argv = container ? ["exec", "-i", container, tool, ...args] : args;
  const env = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
  };
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, {
      env,
      stdio: [inputFd ?? "ignore", outputFd ?? "ignore", "pipe"],
    });
    child.stderr.resume();
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `${tool} failed (${code}). Verify matching PostgreSQL client tools and the configured test credentials.`,
            ),
          ),
    );
  });
}
try {
  const name = targetUrl.pathname.slice(1);
  // Never replace an existing database, even if its name looks disposable.
  assert.equal(
    (await source.query("SELECT 1 FROM pg_database WHERE datname=$1", [name]))
      .rows.length,
    0,
    "Restore database already exists; choose a fresh name.",
  );
  // The last integration suite can leave the new tables empty. Seed a complete
  // fictional record in this already-validated disposable database so the
  // dump/restore gate checks actual character, administrator and adventure data.
  await migrate(source);
  const fixture = { user: randomUUID(), peer: randomUUID(), event: randomUUID(), faction: randomUUID(), character: randomUUID(), peerCharacter: randomUUID(), item: randomUUID(), originJournal: randomUUID(), sharedJournal: randomUUID(), exchange: randomUUID(), group: randomUUID(), rumor: randomUUID(), bulletin: randomUUID(), rumorJournal: randomUUID(), trace: randomUUID() };
  const setup = defaultSetup("fantasy", "council");
  setup.enabledInstruments = ["briefing", "relic", "wayfinder", "trace", "whisper", "broadside"];
  const profile = {
    ...defaultCharacterProfile(setup.rules), name: "Recovery rehearsal character", factionId: fixture.faction,
    privateObjectives: "A fictional secret that must survive database recovery.",
    startingEquipment: [{ name: "Recovery lantern", quantity: 2, notes: "Original allocation." }],
  };
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const badge = [...randomBytes(20)].map((byte) => alphabet[byte % alphabet.length]).join("");
  const propCode = () => [...randomBytes(20)].map((byte) => alphabet[byte % alphabet.length]).join("");
  const relic = defaultAdventureNode("relic", "recovery-relic", propCode());
  relic.actions.success = ["recovered"];
  relic.examinations[0].text = "An authorized private reading preserved through database recovery.";
  const scene = defaultAdventureNode("wayfinder", "recovery-scene", propCode());
  scene.conditions.completed = [relic.id];
  scene.conditions.flags = ["recovered"];
  const definition = validateAdventure({ ...defaultAdventure(), title: "Recovery adventure", organizerNotes: "Preserve this private organizer plan.", flags: [{ id: "recovered", name: "Reading recovered" }], nodes: [relic, scene] }, setup);
  const progress = {
    [relic.id]: { completed: true, failed: false, attempts: 0, hints: [], examinations: [relic.examinations[0].id], lastAttemptAt: null },
    [scene.id]: { completed: true, failed: false, attempts: 0, hints: [], examinations: [], lastAttemptAt: null },
  };
  const requestId = randomUUID();
  const actionInput = { requestId, version: 1, characterId: fixture.character, nodeId: relic.id, kind: "examine", examId: relic.examinations[0].id, code: relic.code };
  const payloadHash = digest(JSON.stringify({ override: false, input: Object.fromEntries(Object.keys(actionInput).sort().map((key) => [key, actionInput[key]])) }));
  await transaction(source, async (client) => {
    await client.query("INSERT INTO users(id,email,display_name,password_hash,is_superuser,is_disabled) VALUES($1,$2,'Recovery rehearsal','not-a-login-credential',true,false)", [fixture.user, `recovery-${fixture.user}@example.invalid`]);
    await client.query("INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Recovery exchange peer','not-a-login-credential')", [fixture.peer, `recovery-${fixture.peer}@example.invalid`]);
    await client.query("INSERT INTO events(id,owner_user_id,name,setup,status) VALUES($1,$2,'Recovery rehearsal event',$3,'rehearsal')", [fixture.event, fixture.user, JSON.stringify(setup)]);
    await client.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'owner')", [fixture.event, fixture.user]);
    await client.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'player')", [fixture.event, fixture.peer]);
    await client.query("INSERT INTO event_character_settings(event_id,require_approval,max_per_player,public_fields,version) VALUES($1,true,2,'[\"pronouns\",\"faction\"]',3)", [fixture.event]);
    await client.query("INSERT INTO factions(id,event_id,name,description) VALUES($1,$2,'Recovery guild','Preserve this faction description.')", [fixture.faction, fixture.event]);
    await client.query("INSERT INTO characters(id,event_id,user_id,status,profile,badge_code,review_notes,inventory_initialized,version) VALUES($1,$2,$3,'approved',$4,$5,'Approval survives recovery.',true,5)", [fixture.character, fixture.event, fixture.user, JSON.stringify(profile), badge]);
    await client.query("INSERT INTO characters(id,event_id,user_id,status,profile,badge_code,inventory_initialized) VALUES($1,$2,$3,'approved',$4,$5,true)", [fixture.peerCharacter, fixture.event, fixture.peer, JSON.stringify({ ...defaultCharacterProfile(setup.rules), name: "Recovery exchange recipient" }), propCode()]);
    await client.query("INSERT INTO character_inventory(id,event_id,character_id,name,quantity,notes,version) VALUES($1,$2,$3,'Recovery lantern',1,'Current quantity after use.',2)", [fixture.item, fixture.event, fixture.character]);
    await client.query("INSERT INTO system_audit_entries(actor_id,target_user_id,action,details) VALUES($1,$1,'recovery.fixture',$2)", [fixture.user, JSON.stringify({ fictional: true, eventId: fixture.event })]);
    await client.query("INSERT INTO event_adventures(event_id,definition) VALUES($1,$2)", [fixture.event, JSON.stringify(definition)]);
    await client.query("INSERT INTO adventure_runs(event_id,character_id,progress,flags) VALUES($1,$2,$3,'{\"recovered\":true}')", [fixture.event, fixture.character, JSON.stringify(progress)]);
    await client.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,audio,type) VALUES($1,$2,$3,$4,$5,$6,$7,NULL,'relic')", [fixture.originJournal, fixture.event, fixture.character, relic.id, `${relic.id}:exam:${relic.examinations[0].id}`, relic.title, relic.examinations[0].text]);
    await client.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,audio,type) VALUES($1,$2,$3,$4,$5,$6,$7,NULL,'wayfinder')", [randomUUID(), fixture.event, fixture.character, scene.id, `${scene.id}:success`, scene.title, scene.body]);
    await client.query("INSERT INTO adventure_requests(event_id,character_id,request_id,payload_hash,outcome) VALUES($1,$2,$3,$4,$5)", [fixture.event, fixture.character, requestId, payloadHash, JSON.stringify({ kind: "examine", message: "Reading saved to your journal.", replayed: false })]);
    await client.query("INSERT INTO adventure_attendance(event_id,node_id,character_id) VALUES($1,$2,$3)", [fixture.event, scene.id, fixture.character]);
    await client.query("INSERT INTO event_sharing_settings(event_id,version,policies) VALUES($1,2,$2)", [fixture.event, JSON.stringify({ [relic.id]: "shareable", [scene.id]: "restricted" })]);
    await client.query("INSERT INTO exchange_sessions(id,event_id,code,status,version,initiator_user_id,initiator_character_id,recipient_user_id,recipient_character_id,initiator_offer,recipient_offer,initiator_confirmed_version,recipient_confirmed_version,completed_at) VALUES($1,$2,$3,'completed',3,$4,$5,$6,$7,$8,'[]',3,3,clock_timestamp())", [fixture.exchange, fixture.event, propCode().slice(0, 12), fixture.user, fixture.character, fixture.peer, fixture.peerCharacter, JSON.stringify([fixture.originJournal])]);
    await client.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,audio,type) VALUES($1,$2,$3,$4,$5,$6,$7,NULL,'shared_reading')", [fixture.sharedJournal, fixture.event, fixture.peerCharacter, relic.id, `exchange-reading:${fixture.originJournal}`, relic.title, relic.examinations[0].text]);
    await client.query("INSERT INTO exchange_copies(event_id,recipient_character_id,origin_journal_id,journal_id,exchange_id,sender_character_id) VALUES($1,$2,$3,$4,$5,$6)", [fixture.event, fixture.peerCharacter, fixture.originJournal, fixture.sharedJournal, fixture.exchange, fixture.character]);
    const completedAt = (await client.query("SELECT completed_at FROM exchange_sessions WHERE id=$1", [fixture.exchange])).rows[0].completed_at;
    const receivedReading = { id: fixture.sharedJournal, title: relic.title, text: relic.examinations[0].text, audio: null, type: "shared_reading", alreadyKnown: false };
    for (const [ownerUser, ownerCharacter, peerUser, peerCharacter, sent, received] of [
      [fixture.user, fixture.character, fixture.peer, fixture.peerCharacter, [{ title: relic.title }], []],
      [fixture.peer, fixture.peerCharacter, fixture.user, fixture.character, [], [receivedReading]],
    ]) {
      const receipt = { completedAt, partnerName: peerCharacter === fixture.peerCharacter ? "Recovery exchange recipient" : profile.name, sent, received, introduced: true };
      await client.query("INSERT INTO exchange_receipts(exchange_id,event_id,owner_user_id,owner_character_id,receipt) VALUES($1,$2,$3,$4,$5)", [fixture.exchange, fixture.event, ownerUser, ownerCharacter, JSON.stringify(receipt)]);
      await client.query("INSERT INTO exchange_contacts(id,event_id,owner_user_id,owner_character_id,peer_user_id,peer_character_id) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), fixture.event, ownerUser, ownerCharacter, peerUser, peerCharacter]);
      await client.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,type) VALUES($1,$2,$3,'exchange',$4,'Exchange receipt','Completed fictional exchange: contact and reading receipt preserved.','exchange_receipt')", [randomUUID(), fixture.event, ownerCharacter, `exchange-receipt:${fixture.exchange}`]);
    }
    const exchangeRequestId = randomUUID();
    const exchangePayloadHash = digest(JSON.stringify({ action: "confirm", targetId: fixture.exchange, input: { requestId: exchangeRequestId, characterId: fixture.peerCharacter, version: 3 } }));
    await client.query("INSERT INTO exchange_requests(event_id,actor_user_id,request_id,payload_hash,exchange_id) VALUES($1,$2,$3,$4,$5)", [fixture.event, fixture.peer, exchangeRequestId, exchangePayloadHash, fixture.exchange]);
    await client.query("INSERT INTO story_groups(id,event_id,name,character_ids,version) VALUES($1,$2,'Recovery investigation group',$3,2)", [fixture.group, fixture.event, JSON.stringify([fixture.character, fixture.peerCharacter])]);
    const rumor = { ...defaultStoryDocument(), title: "Recovery witness account", body: "A witness reports the lantern was moved before dusk.", sourceLabel: "The watchkeeper", topic: "Lantern disappearance", truth: "Organizer-only: this witness confused two evenings.", audience: { type: "group", ids: [fixture.group] }, conditions: { completed: [relic.id], flags: ["recovered"], skills: [], statuses: [] }, shareable: true };
    const publishedAt = new Date().toISOString();
    const draft = { ...rumor, body: "An unpublished corrected witness account.", correctionNote: "A correction awaiting organizer review." };
    await client.query("INSERT INTO story_entries(id,event_id,kind,document,status,version,published,published_version,created_by) VALUES($1,$2,'rumor',$3,'submitted',3,$4,2,$5)", [fixture.rumor, fixture.event, JSON.stringify(draft), JSON.stringify({ ...rumor, publishedAt }), fixture.user]);
    const bulletin = { ...defaultStoryDocument(), title: "Recovery organizer bulletin", body: "The lantern has been found; meet at the original place.", sourceLabel: "Event organizers", audience: { type: "private", ids: [fixture.peerCharacter] }, correctionNote: "Corrected the meeting place after review." };
    await client.query("INSERT INTO story_entries(id,event_id,kind,document,status,version,published,published_version,created_by) VALUES($1,$2,'bulletin',$3,'published',5,$4,5,$5)", [fixture.bulletin, fixture.event, JSON.stringify(bulletin), JSON.stringify({ ...bulletin, publishedAt }), fixture.user]);
    await client.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,type) VALUES($1,$2,$3,$4,$5,$6,$7,'whisper')", [fixture.rumorJournal, fixture.event, fixture.character, `whisper:${fixture.rumor}`, `whisper:${fixture.rumor}:2`, rumor.title, rumor.body]);
    await client.query("INSERT INTO story_readings(id,event_id,entry_id,owner_user_id,character_id,publication_version,journal_id) VALUES($1,$2,$3,$4,$5,2,$6)", [randomUUID(), fixture.event, fixture.rumor, fixture.user, fixture.character, fixture.rumorJournal]);
    await client.query("INSERT INTO story_requests(event_id,actor_user_id,request_id,payload_hash,target_id,action) VALUES($1,$2,$3,$4,$5,'collect')", [fixture.event, fixture.user, randomUUID(), digest(JSON.stringify({ characterId: fixture.character, entryId: fixture.rumor, publicationVersion: 2 })), fixture.rumor]);
    await client.query("INSERT INTO story_activity(id,event_id,entry_id,actor_id,action,version) VALUES($1,$2,$3,$4,'published',5)", [randomUUID(), fixture.event, fixture.bulletin, fixture.user]);
    const trace = { kind: "theory", title: "Recovery private hypothesis", notes: "The reported movement may be an innocent mistake; this is player speculation.", audience: { type: "private", ids: [] }, sources: [fixture.originJournal, fixture.rumorJournal], links: [] };
    await client.query("INSERT INTO trace_records(id,event_id,owner_user_id,character_id,document,version,archived) VALUES($1,$2,$3,$4,$5,3,false)", [fixture.trace, fixture.event, fixture.user, fixture.character, JSON.stringify(trace)]);
    await client.query("INSERT INTO trace_requests(event_id,actor_user_id,request_id,payload_hash,record_id) VALUES($1,$2,$3,$4,$5)", [fixture.event, fixture.user, randomUUID(), digest(JSON.stringify(trace)), fixture.trace]);
    // A settled agreement with immutable economic evidence ensures every new
    // schema-8 table contains real values in the PostgreSQL dump/restore gate.
    const resourceId = "recovery-tokens", shopId = randomUUID(), stockId = randomUUID(), agreementId = randomUUID(), transactionId = randomUUID();
    await client.query("INSERT INTO economy_resources(event_id,id,name) VALUES($1,$2,'Recovery fictional tokens')", [fixture.event, resourceId]);
    for (const [characterId, quantity] of [[fixture.character, 7], [fixture.peerCharacter, 13]])
      await client.query("INSERT INTO economy_balances(event_id,character_id,resource_id,quantity,version) VALUES($1,$2,$3,$4,3)", [fixture.event, characterId, resourceId, quantity]);
    await client.query("INSERT INTO economy_shops(id,event_id,name,description,enabled,version) VALUES($1,$2,'Recovery supply shop','Preserve the authored fictional shop.',true,2)", [shopId, fixture.event]);
    await client.query("INSERT INTO economy_stock(id,event_id,shop_id,name,description,quantity,initial_quantity,resource_id,unit_price,version) VALUES($1,$2,$3,'Recovery rope','Public inventory description.',2,3,$4,2,4)", [stockId, fixture.event, shopId, resourceId]);
    const settledAt = new Date().toISOString();
    const settlement = [{ fromCharacterId: fixture.character, toCharacterId: fixture.peerCharacter, resourceId, quantity: 3 }];
    const economyReceipt = { id: transactionId, kind: "oath", createdAt: settledAt, referenceId: agreementId, transfers: [{ fromCharacterId: fixture.character, fromName: profile.name, toCharacterId: fixture.peerCharacter, toName: "Recovery exchange recipient", items: [], resources: [{ resourceId, name: "Recovery fictional tokens", quantity: 3 }] }] };
    const terms = "The travellers accepted the delivery of the recovered lantern and a three-token settlement.";
    await client.query("INSERT INTO oath_agreements(id,event_id,creator_user_id,creator_character_id,title,terms,settlement,status,version,terms_version,settled_at,receipt) VALUES($1,$2,$3,$4,'Recovery delivery agreement',$5,$6,'fulfilled',7,2,$7,$8)", [agreementId, fixture.event, fixture.user, fixture.character, terms, JSON.stringify(settlement), settledAt, JSON.stringify(economyReceipt)]);
    for (const [characterId, ownerId, name] of [[fixture.character, fixture.user, profile.name], [fixture.peerCharacter, fixture.peer, "Recovery exchange recipient"]])
      await client.query("INSERT INTO oath_participants(event_id,agreement_id,character_id,owner_user_id,name,kind,accepted_terms_version,accepted_at,settlement_terms_version,settlement_confirmed_at) VALUES($1,$2,$3,$4,$5,'participant',2,$6,2,$6)", [fixture.event, agreementId, characterId, ownerId, name, settledAt]);
    await client.query("INSERT INTO oath_history(id,event_id,agreement_id,actor_user_id,character_id,character_name,action,terms_version,details) VALUES($1,$2,$3,$4,$5,$6,'revised',2,$7)", [randomUUID(), fixture.event, agreementId, fixture.user, fixture.character, profile.name, JSON.stringify({ snapshot: { title: "Recovery delivery agreement", terms, participantIds: [fixture.character, fixture.peerCharacter], witnessIds: [], expiresAt: null, settlement }, reason: "Preserve the exact terms accepted by both characters." })]);
    const settlementRequestId = randomUUID();
    await client.query("INSERT INTO oath_requests(event_id,actor_user_id,request_id,payload_hash,agreement_id) VALUES($1,$2,$3,$4,$5)", [fixture.event, fixture.peer, settlementRequestId, digest(JSON.stringify({ action: "settle", agreementId, characterId: fixture.peerCharacter, version: 6 })), agreementId]);
    await client.query("INSERT INTO economy_transactions(id,event_id,kind,reference_id,payload_hash,actor_user_id,receipt,created_at) VALUES($1,$2,'oath',$3,$4,$5,$6,$7)", [transactionId, fixture.event, agreementId, digest(JSON.stringify(settlement)), fixture.peer, JSON.stringify(economyReceipt), settledAt]);
    for (const [ownerId, characterId] of [[fixture.user, fixture.character], [fixture.peer, fixture.peerCharacter]])
      await client.query("INSERT INTO economy_receipts(event_id,transaction_id,owner_user_id,owner_character_id) VALUES($1,$2,$3,$4)", [fixture.event, transactionId, ownerId, characterId]);
    await client.query("INSERT INTO economy_requests(event_id,actor_user_id,request_id,payload_hash,action,response) VALUES($1,$2,$3,$4,'resources.create',$5)", [fixture.event, fixture.user, randomUUID(), digest(JSON.stringify({ id: resourceId, name: "Recovery fictional tokens" })), JSON.stringify({ resource: { id: resourceId, name: "Recovery fictional tokens" } })]);
    const baseline = (await client.query("SELECT * FROM character_inventory WHERE event_id=$1 ORDER BY id", [fixture.event])).rows;
    await client.query("INSERT INTO economy_baselines(event_id,inventory) VALUES($1,$2)", [fixture.event, JSON.stringify(baseline)]);
    await client.query("INSERT INTO exchange_trade_offers(event_id,exchange_id,side,snapshot) VALUES($1,$2,'initiator',$3)", [fixture.event, fixture.exchange, JSON.stringify({ items: [], resources: [], valid: true })]);
    // Populate authored snapshots, completed and paused cooperative timers,
    // captured results, fictional overrides and private readings before dumping.
    const sigilId = randomUUID(), pausedEntryId = randomUUID(), sigilRunId = randomUUID(), pausedRunId = randomUUID(), sigilJournalId = randomUUID();
    const sigilDocument = {
      title: "Recovery cooperative procedure", summary: "Two people operate one fictional prop.", organizerNotes: "Private staff instructions must survive recovery.", durationSeconds: 120,
      roles: [{ id: "keeper", name: "Keeper", instructions: "Hold the lantern." }, { id: "reader", name: "Reader", instructions: "Read the markings." }],
      components: [{ id: "lantern", name: "Lantern", kind: "item", itemName: "Recovery lantern", resourceId: null, quantity: 1, consume: true }],
      checkpoints: [{ id: "prepare", title: "Prepare", instructions: "Place the lantern on the prop.", roleId: "keeper", minimumSeconds: 0, answer: null }, { id: "align", title: "Align", instructions: "Read the prepared code.", roleId: "reader", minimumSeconds: 1, answer: "LANTERN" }],
      conditions: { completed: [relic.id], flags: [], skills: [], statuses: [] },
      success: { text: "The restored fictional signal is stable.", flags: ["recovered"] }, failure: { text: "The prepared sequence timed out.", flags: [] },
    };
    const roles = [{ roleId: "keeper", performer: "First in-person participant" }, { roleId: "reader", performer: "Second in-person participant" }];
    const bindings = [{ componentId: "lantern", itemId: fixture.item }];
    for (const [entryId, title] of [[sigilId, sigilDocument.title], [pausedEntryId, "Recovery paused procedure"]])
      await client.query("INSERT INTO sigil_entries(id,event_id,code,document,published,status,version,published_version,created_by) VALUES($1,$2,$3,$4,$5,'published',3,2,$6)", [entryId, fixture.event, propCode(), JSON.stringify({ ...sigilDocument, title, organizerNotes: "A revised private staff draft awaiting the next publication." }), JSON.stringify({ ...sigilDocument, title }), fixture.user]);
    await client.query("INSERT INTO sigil_runs(id,event_id,entry_id,owner_user_id,character_id,character_name,snapshot,published_version,roles,bindings,status,version,checkpoint_index,remaining_ms,checkpoint_elapsed_ms,heartbeat_sequence) VALUES($1,$2,$3,$4,$5,$6,$7,2,$8,$9,'succeeded',8,2,70000,0,5)", [sigilRunId, fixture.event, sigilId, fixture.user, fixture.character, profile.name, JSON.stringify(sigilDocument), JSON.stringify(roles), JSON.stringify(bindings)]);
    await client.query("INSERT INTO sigil_runs(id,event_id,entry_id,owner_user_id,character_id,character_name,snapshot,published_version,roles,bindings,status,pause_reason,version,checkpoint_index,remaining_ms,checkpoint_elapsed_ms,heartbeat_sequence) VALUES($1,$2,$3,$4,$5,$6,$7,2,$8,$9,'paused','connection',5,1,45000,1200,4)", [pausedRunId, fixture.event, pausedEntryId, fixture.user, fixture.character, profile.name, JSON.stringify({ ...sigilDocument, title: "Recovery paused procedure" }), JSON.stringify(roles), JSON.stringify(bindings)]);
    await client.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,type) VALUES($1,$2,$3,$4,$5,$6,$7,'sigil')", [sigilJournalId, fixture.event, fixture.character, `sigil:${sigilId}`, `sigil:${sigilRunId}`, sigilDocument.title, sigilDocument.success.text]);
    const consumption = { items: [{ itemId: fixture.item, name: "Recovery lantern", required: 1, consumed: 1, before: 2, after: 1 }], resources: [] };
    await client.query("INSERT INTO sigil_outcomes(id,event_id,run_id,entry_id,owner_user_id,character_id,status,text,flags,consumption,journal_id) VALUES($1,$2,$3,$4,$5,$6,'succeeded',$7,$8,$9,$10)", [randomUUID(), fixture.event, sigilRunId, sigilId, fixture.user, fixture.character, sigilDocument.success.text, JSON.stringify(sigilDocument.success.flags), JSON.stringify(consumption), sigilJournalId]);
    await client.query("INSERT INTO sigil_requests(event_id,actor_user_id,request_id,payload_hash,action,entry_id,run_id,outcome) VALUES($1,$2,$3,$4,'checkpoint',$5,$6,$7)", [fixture.event, fixture.user, randomUUID(), digest(JSON.stringify({ runId: sigilRunId, checkpointId: "align", roleId: "reader", answer: "LANTERN", version: 7 })), sigilId, sigilRunId, JSON.stringify({ status: "succeeded", journalId: sigilJournalId })]);
    await client.query("INSERT INTO sigil_history(id,event_id,run_id,actor_user_id,action,details) VALUES($1,$2,$3,$4,'succeeded',$5)", [randomUUID(), fixture.event, sigilRunId, fixture.user, JSON.stringify({ reason: "Staff confirmed the group completed its in-person procedure.", consumption })]);
    await client.query("INSERT INTO sigil_history(id,event_id,run_id,actor_user_id,action,details) VALUES($1,$2,$3,$4,'paused',$5)", [randomUUID(), fixture.event, pausedRunId, fixture.user, JSON.stringify({ reason: "connection", remainingMs: 45000, checkpointElapsedMs: 1200 })]);
    const staticId = randomUUID(), staticJournalId = randomUUID();
    const staticDocument = {
      title: "Recovery fictional scanner", summary: "A prepared fictional zone reading.", organizerNotes: "Private explanation of the future fictional signal.", zoneLabel: "Lantern chamber",
      conditions: { completed: [relic.id], flags: [], skills: [], statuses: [] },
      states: [{ id: "unsettled", label: "Unsettled", text: "A fictional oscillation moves across the chamber.", level: 65, tone: "alert" }, { id: "restored", label: "Restored", text: "The fictional chamber signal is stable.", level: 15, tone: "calm" }],
      defaultStateId: "unsettled", rules: [{ id: "recovered", conditions: { completed: [], flags: ["recovered"], skills: [], statuses: [] }, stateId: "restored" }],
    };
    await client.query("INSERT INTO static_entries(id,event_id,code,document,published,status,version,published_version,created_by) VALUES($1,$2,$3,$4,$5,'published',4,3,$6)", [staticId, fixture.event, propCode(), JSON.stringify({ ...staticDocument, organizerNotes: "Private revised draft after publication." }), JSON.stringify(staticDocument), fixture.user]);
    await client.query("INSERT INTO static_overrides(event_id,entry_id,version,state_id,reason,actor_user_id) VALUES($1,$2,2,'unsettled','Staff prepared a fictional signal change after observing the group.',$3)", [fixture.event, staticId, fixture.user]);
    await client.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,type) VALUES($1,$2,$3,$4,$5,$6,$7,'static')", [staticJournalId, fixture.event, fixture.character, `static:${staticId}`, `static:${staticId}:captured`, staticDocument.title, staticDocument.states[1].text]);
    const readingKey = digest(JSON.stringify({ entryId: staticId, publicationVersion: 3, stateId: "restored", source: "conditions", overrideVersion: 0 }));
    await client.query("INSERT INTO static_readings(id,event_id,entry_id,owner_user_id,character_id,publication_version,reading_key,state_id,source,journal_id) VALUES($1,$2,$3,$4,$5,3,$6,'restored','conditions',$7)", [randomUUID(), fixture.event, staticId, fixture.user, fixture.character, readingKey, staticJournalId]);
    await client.query("INSERT INTO static_requests(event_id,actor_user_id,request_id,payload_hash,action,target_id) VALUES($1,$2,$3,$4,'collect',$5)", [fixture.event, fixture.user, randomUUID(), digest(JSON.stringify({ entryId: staticId, publicationVersion: 3, readingKey })), staticId]);
    await client.query("INSERT INTO static_history(id,event_id,entry_id,actor_user_id,action,version,reason,details) VALUES($1,$2,$3,$4,'state',2,'Staff prepared a fictional signal change after observing the group.',$5)", [randomUUID(), fixture.event, staticId, fixture.user, JSON.stringify({ stateId: "unsettled", previousStateId: null })]);
    // Live operations preserve scoped staff, acknowledged checks, captured
    // whole-party consent, an overdue occupied return window and approved news.
    const operationsStaff = randomUUID(), encounterId = randomUUID(), partyId = randomUUID(), announcementId = randomUUID();
    await client.query("INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Recovery scene operator','not-a-login-credential')", [operationsStaff, `recovery-staff-${operationsStaff}@example.invalid`]);
    await client.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'staff')", [fixture.event, operationsStaff]);
    const dispatchedAt = new Date(Date.now() - 20 * 60000).toISOString(), returnBy = new Date(Date.now() - 15 * 60000).toISOString();
    const encounterDocument = { title: "Recovery staffed scene", nodeId: scene.id, publicMessage: "Check in with the scene operator.", staffNotes: "Private performer setup and prop handling notes.", capacity: 2, staffUserIds: [operationsStaff], checks: [{ id: "performer", label: "Performer briefed", kind: "performer" }, { id: "prop", label: "Lantern prop checked", kind: "prop" }, { id: "check-in", label: "Staff check-in ready", kind: "staff" }], returnMinutes: 5 };
    const readyChecks = Object.fromEntries(encounterDocument.checks.map(check => [check.id, { ready: true, actorId: operationsStaff, at: dispatchedAt, reason: "Staff acknowledged the prepared scene check." }]));
    await client.query("INSERT INTO stagehand_encounters(id,event_id,document,state,checks,version,created_by) VALUES($1,$2,$3,'open',$4,7,$5)", [encounterId, fixture.event, JSON.stringify(encounterDocument), JSON.stringify(readyChecks), fixture.user]);
    await client.query("INSERT INTO adventure_runs(event_id,character_id,progress,flags) VALUES($1,$2,$3,'{\"recovered\":true}')", [fixture.event, fixture.peerCharacter, JSON.stringify(progress)]);
    await client.query("INSERT INTO adventure_attendance(event_id,node_id,character_id) VALUES($1,$2,$3)", [fixture.event, scene.id, fixture.peerCharacter]);
    const partyMembers = [[fixture.character, fixture.user, profile.name, true], [fixture.peerCharacter, fixture.peer, "Recovery exchange recipient", false]].map(([characterId, ownerUserId, name, attendedBefore]) => ({ characterId, ownerUserId, name, response: "accepted", responseTermsVersion: 2, respondedAt: dispatchedAt, attendedBefore }));
    await client.query("INSERT INTO stagehand_parties(id,event_id,encounter_id,name,status,version,terms_version,return_minutes,members,dispatched_at,return_by,dispatched_node_id,created_by) VALUES($1,$2,$3,'Recovery whole party','dispatched',6,2,5,$4,$5,$6,$7,$8)", [partyId, fixture.event, encounterId, JSON.stringify(partyMembers), dispatchedAt, returnBy, scene.id, operationsStaff]);
    const returnedPartyId = randomUUID(), releaseRequestId = randomUUID();
    const releaseOutcome = { action: "return", replayed: false, message: "The party returned and its reservation was released.", targetId: returnedPartyId };
    const releaseReceipt = { actorUserId: operationsStaff, requestId: releaseRequestId, payloadHash: digest(JSON.stringify({ action: "return", target: returnedPartyId, input: { requestId: releaseRequestId, version: 6, reason: "Staff acknowledged the earlier party return." } })), action: "return", characterId: null, manage: true, outcome: releaseOutcome };
    await client.query("INSERT INTO stagehand_parties(id,event_id,encounter_id,name,status,version,terms_version,return_minutes,members,dispatched_at,return_by,dispatched_node_id,release_receipt,created_by) VALUES($1,$2,$3,'Recovery acknowledged party','returned',7,2,5,$4,$5,$6,$7,$8,$9)", [returnedPartyId, fixture.event, encounterId, JSON.stringify(partyMembers), dispatchedAt, returnBy, scene.id, JSON.stringify(releaseReceipt), operationsStaff]);
    const operationOutcome = { action: "dispatch", replayed: false, message: "Party dispatched; return acknowledgment remains outstanding.", targetId: partyId };
    await client.query("INSERT INTO stagehand_requests(event_id,actor_user_id,request_id,payload_hash,action,target_id,character_id,manage,outcome) VALUES($1,$2,$3,$4,'dispatch',$5,NULL,true,$6)", [fixture.event, operationsStaff, randomUUID(), digest(JSON.stringify({ partyId, version: 5, reason: "Staff acknowledged departure of the accepted party." })), partyId, JSON.stringify(operationOutcome)]);
    await client.query("INSERT INTO stagehand_history(id,event_id,encounter_id,party_id,actor_user_id,action,details) VALUES($1,$2,$3,$4,$5,'dispatch',$6)", [randomUUID(), fixture.event, encounterId, partyId, operationsStaff, JSON.stringify({ reason: "Staff acknowledged departure of the accepted party.", returnBy, memberCount: 2 })]);
    const announcementDocument = { ...defaultStoryDocument(), title: "Recovery scene availability", body: "The staffed lantern scene is open; accepted parties should check in with the operator.", sourceLabel: "Scene operations" };
    await client.query("INSERT INTO story_entries(id,event_id,kind,document,status,version,published,published_version,created_by) VALUES($1,$2,'bulletin',$3,'published',2,$4,1,$5)", [announcementId, fixture.event, JSON.stringify(announcementDocument), JSON.stringify({ ...announcementDocument, publishedAt: dispatchedAt }), operationsStaff]);
    await client.query("INSERT INTO stagehand_announcements(id,event_id,encounter_id,encounter_version,story_entry_id,created_by) VALUES($1,$2,$3,7,$4,$5)", [randomUUID(), fixture.event, encounterId, announcementId, operationsStaff]);
  });
  for (const table of ["economy_resources", "economy_balances", "economy_shops", "economy_stock", "economy_transactions", "economy_receipts", "economy_requests", "economy_baselines", "exchange_trade_offers", "oath_agreements", "oath_participants", "oath_history", "oath_requests", "sigil_entries", "sigil_runs", "sigil_outcomes", "sigil_requests", "sigil_history", "static_entries", "static_overrides", "static_readings", "static_requests", "static_history", "stagehand_encounters", "stagehand_parties", "stagehand_requests", "stagehand_history", "stagehand_announcements"])
    assert.ok((await source.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n > 0, `${table} must contain actual recovery data.`);
  await source.query(`CREATE DATABASE "${name}"`);
  const out = await open(backup, "wx", 0o600);
  try {
    await pgTool(
      "pg_dump",
      [
        "-U",
        decodeURIComponent(sourceUrl.username),
        "-d",
        sourceUrl.pathname.slice(1),
        "--format=custom",
        "--no-owner",
        "--no-acl",
      ],
      undefined,
      out.fd,
    );
  } finally {
    await out.close();
  }
  const input = await open(backup, "r");
  try {
    await pgTool(
      "pg_restore",
      [
        "-U",
        decodeURIComponent(targetUrl.username),
        "-d",
        name,
        "--no-owner",
        "--no-acl",
        "--exit-on-error",
      ],
      input.fd,
      undefined,
      targetUrl,
    );
  } finally {
    await input.close();
  }
  restored = createPool({ databaseUrl: targetUrl.href, ssl: false });
  for (const [table, order] of [
    ["users", "id"],
    ["events", "id"],
    ["memberships", "event_id,user_id"],
    ["invitations", "id"],
    ["audit_entries", "id"],
    ["system_audit_entries", "id"],
    ["event_character_settings", "event_id"],
    ["factions", "id"],
    ["characters", "id"],
    ["character_inventory", "id"],
    ["event_adventures", "event_id"],
    ["adventure_runs", "event_id,character_id"],
    ["adventure_journal", "id"],
    ["adventure_requests", "event_id,character_id,request_id"],
    ["adventure_attendance", "event_id,node_id,character_id"],
    ["event_sharing_settings", "event_id"],
    ["exchange_sessions", "id"],
    ["exchange_requests", "event_id,actor_user_id,request_id"],
    ["exchange_copies", "event_id,recipient_character_id,origin_journal_id"],
    ["exchange_receipts", "exchange_id,owner_user_id"],
    ["exchange_contacts", "id"],
    ["story_groups", "id"],
    ["story_entries", "id"],
    ["story_readings", "id"],
    ["story_requests", "event_id,actor_user_id,request_id"],
    ["story_activity", "id"],
    ["trace_records", "id"],
    ["trace_requests", "event_id,actor_user_id,request_id"],
    ["economy_resources", "event_id,id"],
    ["economy_balances", "event_id,character_id,resource_id"],
    ["economy_shops", "id"],
    ["economy_stock", "id"],
    ["economy_transactions", "id"],
    ["economy_receipts", "event_id,transaction_id,owner_user_id,owner_character_id"],
    ["economy_requests", "event_id,actor_user_id,request_id"],
    ["economy_baselines", "event_id"],
    ["exchange_trade_offers", "event_id,exchange_id,side"],
    ["oath_agreements", "id"],
    ["oath_participants", "event_id,agreement_id,character_id"],
    ["oath_history", "id"],
    ["oath_requests", "event_id,actor_user_id,request_id"],
    ["sigil_entries", "id"],
    ["sigil_runs", "id"],
    ["sigil_outcomes", "id"],
    ["sigil_requests", "event_id,actor_user_id,request_id"],
    ["sigil_history", "id"],
    ["static_entries", "id"],
    ["static_overrides", "event_id,entry_id"],
    ["static_readings", "id"],
    ["static_requests", "event_id,actor_user_id,request_id"],
    ["static_history", "id"],
    ["stagehand_encounters", "id"],
    ["stagehand_parties", "id"],
    ["stagehand_requests", "event_id,actor_user_id,request_id"],
    ["stagehand_history", "id"],
    ["stagehand_announcements", "event_id,story_entry_id"],
    ["schema_migrations", "version"],
  ]) {
    const a = (await source.query(`SELECT * FROM ${table} ORDER BY ${order}`))
      .rows;
    const b = (await restored.query(`SELECT * FROM ${table} ORDER BY ${order}`))
      .rows;
    assert.equal(
      digest(JSON.stringify(b)),
      digest(JSON.stringify(a)),
      `${table} restored content`,
    );
  }
  assert.equal(await migrate(restored), 10, "The recovered database must accept repeat migration at schema 10.");
  const event = (
    await restored.query("SELECT id,owner_user_id FROM events LIMIT 1")
  ).rows[0];
  assert.ok(event, "Rehearsal source must contain an event.");
  const maximum = BigInt(
    (
      await restored.query(
        "SELECT COALESCE(max(id),0) AS id FROM audit_entries",
      )
    ).rows[0].id,
  );
  const inserted = (
    await restored.query(
      "INSERT INTO audit_entries(event_id,actor_id,action) VALUES($1,$2,'recovery.rehearsed') RETURNING id",
      [event.id, event.owner_user_id],
    )
  ).rows[0];
  assert.ok(
    BigInt(inserted.id) > maximum,
    "Restored identity sequence must advance safely.",
  );
  const maximumSystemAudit = BigInt((await restored.query("SELECT COALESCE(max(id),0) AS id FROM system_audit_entries")).rows[0].id);
  const systemAudit = (await restored.query("INSERT INTO system_audit_entries(actor_id,target_user_id,action) VALUES($1,$1,'recovery.rehearsed') RETURNING id", [fixture.user])).rows[0];
  assert.ok(BigInt(systemAudit.id) > maximumSystemAudit, "Restored system audit identity sequence must advance safely.");
  console.log(
    "PostgreSQL pg_dump/pg_restore round trip, populated characters, administrators, adventures, journals, sharing policies, exchange sessions, provenance, bilateral contacts and receipts, story groups and draft/publication separation, hidden truths, collected rumors, activity, private investigations, fictional balances and finite shops, atomic transaction receipts, inventory baselines, fixed agreement terms and captured signatures, replay records, published cooperative snapshots and private drafts, captured roles and components, completed outcomes and paused timer state, fictional signal rules and staff overrides, account-bound readings, scoped scene staff and readiness acknowledgments, captured party consent and overdue occupied return windows, approved scene-linked bulletins, operations history/replays, both audit sequences, and migration after restore passed.",
  );
} finally {
  if (restored) await restored.end();
  await source.end();
  await rm(directory, { recursive: true, force: true });
}
