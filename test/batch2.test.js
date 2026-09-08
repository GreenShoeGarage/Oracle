import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { testDatabase } from "./database.js";
import { migrate, checkSchema } from "../src/db.js";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { defaultSetup, THEMES } from "../public/kit.js";
import { defaultStoryDocument } from "../public/story-model.js";
import { defaultCharacterProfile } from "../public/characters-model.js";
import { defaultAdventure, defaultAdventureNode } from "../public/adventure-model.js";

let database, pool, server, origin;
const users = {};
const legacy = { user: randomUUID(), event: randomUUID(), invitation: randomUUID(), faction: randomUUID(), character: randomUUID(), inventory: randomUUID(), storyInventory: randomUUID(), storyEvent: randomUUID(), storyCharacter: randomUUID(), peerUser: randomUUID(), peerCharacter: randomUUID(), originJournal: randomUUID(), sharedJournal: randomUUID(), exchange: randomUUID() };
const secret = "ORGANIZER SECRET: the archivist is the missing heir.";
const pass = "Batch two test passphrase!";
async function request(path, method = "GET", data, who, headers = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(method !== "GET" ? { "Content-Type": "application/json", Origin: origin } : {}),
      ...(who?.cookie ? { Cookie: who.cookie } : {}),
      ...headers,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const raw = response.status === 204 ? "" : await response.text();
  return {
    status: response.status,
    data: raw && response.headers.get("content-type")?.includes("application/json") ? JSON.parse(raw) : raw,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
    headers: response.headers,
  };
}
function setup() {
  const result = defaultSetup("fantasy", "council");
  result.content = [
    { id: "welcome", title: "Welcome", body: "Gather at the gate at sunset.", visibility: "player", prop: true },
    { id: "field-notes", title: "Field notes", body: "Bring a lantern and water.", visibility: "player", prop: false },
    { id: "organizer-notes", title: "Hidden truth", body: secret, visibility: "organizer", prop: false },
  ];
  return result;
}
async function createEvent(name = "Theme rehearsal", customSetup = setup(), who = users.owner) {
  const result = await request("/api/events", "POST", { name, description: "A shared event briefing.", location: "The gate", setup: customSetup }, who);
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.event;
}
async function join(event, who, role = "player") {
  const invite = await request(`/api/events/${event.id}/invites`, "POST", { role, maxUses: 1 }, users.owner);
  assert.equal(invite.status, 201, JSON.stringify(invite.data));
  const result = await request("/api/events/join", "POST", { code: invite.data.invitation.code }, who);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return { result, invitation: invite.data.invitation };
}
function noPrivate(result) {
  const serialized = JSON.stringify(result.data);
  assert.ok(!serialized.includes(secret), "Organizer-only content leaked into a public response.");
  assert.ok(!serialized.includes("owner_user_id"));
  assert.ok(!serialized.includes("password_hash"));
  assert.ok(!serialized.includes("token_hash"));
}

before(async () => {
  database = await testDatabase();
  pool = database.pool;
  // Recreate the already-deployed Batch 1 state before the additive migration.
  const oldSql = await readFile(new URL("../migrations/001_foundation.sql", import.meta.url), "utf8");
  await pool.query(oldSql);
  await pool.query("CREATE TABLE schema_migrations (version integer PRIMARY KEY,name text NOT NULL,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())");
  await pool.query("INSERT INTO schema_migrations(version,name,checksum) VALUES(1,$1,$2)", ["001_foundation.sql", createHash("sha256").update(oldSql).digest("hex")]);
  await pool.query("INSERT INTO users(id,email,display_name,password_hash) VALUES($1,'legacy@example.test','Existing organizer','existing-hash')", [legacy.user]);
  await pool.query("INSERT INTO events(id,owner_user_id,name,description,location,status,version) VALUES($1,$2,'Existing live event','Original description','Original location','live',7)", [legacy.event, legacy.user]);
  await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'owner')", [legacy.event, legacy.user]);
  await pool.query("INSERT INTO invitations(id,event_id,token_hash,role,created_by,max_uses,expires_at) VALUES($1,$2,'original-token-hash','player',$3,3,now()+interval '1 day')", [legacy.invitation, legacy.event, legacy.user]);
  await pool.query("INSERT INTO audit_entries(event_id,actor_id,action,details) VALUES($1,$2,'event.created','{}')", [legacy.event, legacy.user]);
  // Preserve populated deployed character and adventure data through migration,
  // while the assertions below continue checking the original Batch 1 data.
  for (const name of ["002_event_setup.sql", "003_superuser.sql", "004_characters.sql", "005_adventures.sql", "006_exchanges.sql", "007_story.sql", "008_economy.sql", "009_instruments.sql"]) {
    const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
    await pool.query(sql);
    await pool.query("INSERT INTO schema_migrations(version,name,checksum) VALUES($1,$2,$3)", [Number(name.slice(0, 3)), name, createHash("sha256").update(sql).digest("hex")]);
  }
  await pool.query("UPDATE users SET is_superuser=true WHERE id=$1", [legacy.user]);
  await pool.query("INSERT INTO event_character_settings(event_id,max_per_player,version) VALUES($1,2,3)", [legacy.event]);
  await pool.query("INSERT INTO factions(id,event_id,name,description) VALUES($1,$2,'Existing guild','Existing faction description')", [legacy.faction, legacy.event]);
  const profile = { ...defaultCharacterProfile(), name: "Existing approved character", factionId: legacy.faction, privateObjectives: "Existing private objective", startingEquipment: [{ name: "Existing lantern", quantity: 3, notes: "Original allocation" }] };
  await pool.query("INSERT INTO characters(id,event_id,user_id,status,profile,badge_code,review_notes,inventory_initialized,version) VALUES($1,$2,$3,'approved',$4,'ABCDEFGHJKLMNPQRSTUV','Existing review',true,8)", [legacy.character, legacy.event, legacy.user, JSON.stringify(profile)]);
  await pool.query("INSERT INTO character_inventory(id,event_id,character_id,name,quantity,notes,version) VALUES($1,$2,$3,'Existing lantern',1,'Already consumed two',4)", [legacy.inventory, legacy.event, legacy.character]);
  legacy.tables = {};
  for (const table of ["event_character_settings", "factions", "characters", "character_inventory"])
    legacy.tables[table] = (await pool.query(`SELECT * FROM ${table} WHERE event_id=$1`, [legacy.event])).rows;
  const storySetup = defaultSetup();
  storySetup.enabledInstruments = ["briefing", "relic", "wayfinder"];
  const relic = defaultAdventureNode("relic", "existing-relic", "ABCDEFGHJKLMNPQRSTUV");
  relic.actions.success = ["discovered"];
  const scene = defaultAdventureNode("wayfinder", "existing-scene", "BCDEFGHJKLMNPQRSTUVW");
  const definition = { ...defaultAdventure(), organizerNotes: "Existing private organizer plan", flags: [{ id: "discovered", name: "Existing discovery" }], nodes: [relic, scene] };
  await pool.query("INSERT INTO events(id,owner_user_id,name,status,setup) VALUES($1,$2,'Existing story event','live',$3)", [legacy.storyEvent, legacy.user, JSON.stringify(storySetup)]);
  await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'owner')", [legacy.storyEvent, legacy.user]);
  await pool.query("INSERT INTO characters(id,event_id,user_id,status,profile,badge_code,inventory_initialized) VALUES($1,$2,$3,'approved',$4,'CDEFGHJKLMNPQRSTUVWX',true)", [legacy.storyCharacter, legacy.storyEvent, legacy.user, JSON.stringify({ ...defaultCharacterProfile(), name: "Existing story character" })]);
  await pool.query("INSERT INTO event_adventures(event_id,definition,version) VALUES($1,$2,3)", [legacy.storyEvent, JSON.stringify(definition)]);
  await pool.query("INSERT INTO adventure_runs(event_id,character_id,progress,flags) VALUES($1,$2,$3,'{\"discovered\":true}')", [legacy.storyEvent, legacy.storyCharacter, JSON.stringify({ [relic.id]: { completed: true, failed: false, attempts: 0, hints: [], examinations: ["examine"], lastAttemptAt: null } })]);
  await pool.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,type) VALUES($1,$2,$3,$4,'existing-relic:exam:examine','Existing private reading','An already discovered secret.','relic')", [legacy.originJournal, legacy.storyEvent, legacy.storyCharacter, relic.id]);
  await pool.query("INSERT INTO adventure_requests(event_id,character_id,request_id,payload_hash,outcome) VALUES($1,$2,$3,'existing-action-hash','{\"kind\":\"examine\",\"message\":\"Reading saved to your journal.\",\"replayed\":false}')", [legacy.storyEvent, legacy.storyCharacter, randomUUID()]);
  await pool.query("INSERT INTO adventure_attendance(event_id,node_id,character_id) VALUES($1,$2,$3)", [legacy.storyEvent, scene.id, legacy.storyCharacter]);
  legacy.storyTables = {};
  for (const table of ["event_adventures", "adventure_runs", "adventure_journal", "adventure_requests", "adventure_attendance"])
    legacy.storyTables[table] = (await pool.query(`SELECT * FROM ${table} WHERE event_id=$1`, [legacy.storyEvent])).rows;
  // Preserve a completed, populated schema-6 exchange rather than checking
  // only empty tables. The second account has its own copied reading and receipt.
  await pool.query("INSERT INTO users(id,email,display_name,password_hash) VALUES($1,'legacy-peer@example.test','Existing exchange peer','existing-peer-hash')", [legacy.peerUser]);
  await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'player')", [legacy.storyEvent, legacy.peerUser]);
  await pool.query("INSERT INTO characters(id,event_id,user_id,status,profile,badge_code,inventory_initialized) VALUES($1,$2,$3,'approved',$4,'DEFGHJKLMNPQRSTUVWXY',true)", [legacy.peerCharacter, legacy.storyEvent, legacy.peerUser, JSON.stringify({ ...defaultCharacterProfile(), name: "Existing exchange peer" })]);
  await pool.query("INSERT INTO event_sharing_settings(event_id,version,policies) VALUES($1,3,$2)", [legacy.storyEvent, JSON.stringify({ [relic.id]: "shareable" })]);
  await pool.query("INSERT INTO exchange_sessions(id,event_id,code,status,version,initiator_user_id,initiator_character_id,recipient_user_id,recipient_character_id,initiator_offer,recipient_offer,initiator_confirmed_version,recipient_confirmed_version,completed_at) VALUES($1,$2,'ABCDEFGHJKLM','completed',4,$3,$4,$5,$6,$7,'[]',4,4,clock_timestamp())", [legacy.exchange, legacy.storyEvent, legacy.user, legacy.storyCharacter, legacy.peerUser, legacy.peerCharacter, JSON.stringify([legacy.originJournal])]);
  await pool.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,type) VALUES($1,$2,$3,$4,$5,'Existing private reading','An already discovered secret.','shared_reading')", [legacy.sharedJournal, legacy.storyEvent, legacy.peerCharacter, relic.id, `exchange-reading:${legacy.originJournal}`]);
  await pool.query("INSERT INTO exchange_copies(event_id,recipient_character_id,origin_journal_id,journal_id,exchange_id,sender_character_id) VALUES($1,$2,$3,$4,$5,$6)", [legacy.storyEvent, legacy.peerCharacter, legacy.originJournal, legacy.sharedJournal, legacy.exchange, legacy.storyCharacter]);
  const completedAt = (await pool.query("SELECT completed_at FROM exchange_sessions WHERE id=$1", [legacy.exchange])).rows[0].completed_at;
  for (const [user, character, peer, peerCharacter, partnerName] of [
    [legacy.user, legacy.storyCharacter, legacy.peerUser, legacy.peerCharacter, "Existing exchange peer"],
    [legacy.peerUser, legacy.peerCharacter, legacy.user, legacy.storyCharacter, "Existing story character"],
  ]) {
    await pool.query("INSERT INTO exchange_receipts(exchange_id,event_id,owner_user_id,owner_character_id,receipt) VALUES($1,$2,$3,$4,$5)", [legacy.exchange, legacy.storyEvent, user, character, JSON.stringify({ completedAt, partnerName, introduced: true, sent: character === legacy.storyCharacter ? [{ title: "Existing private reading" }] : [], received: character === legacy.peerCharacter ? [{ id: legacy.sharedJournal, title: "Existing private reading", text: "An already discovered secret.", type: "shared_reading", audio: null, alreadyKnown: false }] : [] })]);
    await pool.query("INSERT INTO exchange_contacts(id,event_id,owner_user_id,owner_character_id,peer_user_id,peer_character_id) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), legacy.storyEvent, user, character, peer, peerCharacter]);
  }
  await pool.query("INSERT INTO exchange_requests(event_id,actor_user_id,request_id,payload_hash,exchange_id) VALUES($1,$2,$3,'existing-confirmation-hash',$4)", [legacy.storyEvent, legacy.peerUser, randomUUID(), legacy.exchange]);
  legacy.exchangeTables = {};
  for (const table of ["event_sharing_settings", "exchange_sessions", "exchange_copies", "exchange_receipts", "exchange_contacts", "exchange_requests"])
    legacy.exchangeTables[table] = (await pool.query(`SELECT * FROM ${table} WHERE event_id=$1 ORDER BY 1,2`, [legacy.storyEvent])).rows;
  // Populate every deployed schema-7 table before schema-10 migration. Preserve
  // private drafts, published snapshots, citations, and exact acceptance history.
  const groupId = randomUUID(), rumorId = randomUUID(), traceId = randomUUID(), rumorJournalId = randomUUID();
  await pool.query("INSERT INTO story_groups(id,event_id,name,character_ids,version) VALUES($1,$2,'Existing investigation group',$3,4)", [groupId, legacy.storyEvent, JSON.stringify([legacy.storyCharacter, legacy.peerCharacter])]);
  const rumor = { ...defaultStoryDocument(), title: "Existing witness account", body: "An already published account.", topic: "Private staff topic", truth: "Private staff truth", audience: { type: "group", ids: [groupId] }, shareable: true };
  await pool.query("INSERT INTO story_entries(id,event_id,kind,document,status,version,published,published_version,created_by) VALUES($1,$2,'rumor',$3,'submitted',6,$4,5,$5)", [rumorId, legacy.storyEvent, JSON.stringify({ ...rumor, body: "A correction awaiting review.", correctionNote: "An exact preserved correction." }), JSON.stringify({ ...rumor, publishedAt: "2026-09-01T12:00:00.000Z" }), legacy.user]);
  await pool.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,type) VALUES($1,$2,$3,$4,$5,$6,$7,'whisper')", [rumorJournalId, legacy.storyEvent, legacy.storyCharacter, `whisper:${rumorId}`, `whisper:${rumorId}:5`, rumor.title, rumor.body]);
  await pool.query("INSERT INTO story_readings(id,event_id,entry_id,owner_user_id,character_id,publication_version,journal_id) VALUES($1,$2,$3,$4,$5,5,$6)", [randomUUID(), legacy.storyEvent, rumorId, legacy.user, legacy.storyCharacter, rumorJournalId]);
  await pool.query("INSERT INTO story_requests(event_id,actor_user_id,request_id,payload_hash,target_id,action) VALUES($1,$2,$3,'existing-collection-hash',$4,'collect')", [legacy.storyEvent, legacy.user, randomUUID(), rumorId]);
  await pool.query("INSERT INTO story_activity(id,event_id,entry_id,actor_id,action,version) VALUES($1,$2,$3,$4,'published',5)", [randomUUID(), legacy.storyEvent, rumorId, legacy.user]);
  const trace = { kind: "theory", title: "Existing private theory", notes: "Private speculation awaiting evidence.", audience: { type: "private", ids: [] }, sources: [legacy.originJournal, rumorJournalId], links: [] };
  await pool.query("INSERT INTO trace_records(id,event_id,owner_user_id,character_id,document,version) VALUES($1,$2,$3,$4,$5,3)", [traceId, legacy.storyEvent, legacy.user, legacy.storyCharacter, JSON.stringify(trace)]);
  await pool.query("INSERT INTO trace_requests(event_id,actor_user_id,request_id,payload_hash,record_id) VALUES($1,$2,$3,'existing-theory-hash',$4)", [legacy.storyEvent, legacy.user, randomUUID(), traceId]);
  legacy.narrativeTables = {};
  for (const table of ["story_groups", "story_entries", "story_readings", "story_requests", "story_activity", "trace_records", "trace_requests"])
    legacy.narrativeTables[table] = (await pool.query(`SELECT * FROM ${table} WHERE event_id=$1 ORDER BY 1,2`, [legacy.storyEvent])).rows;
  // Populate every schema-8 table before migration 10 so preservation covers actual economic and agreement data.
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const resourceId = "existing-tokens", shopId = randomUUID(), stockId = randomUUID(), agreementId = randomUUID(), transactionId = randomUUID();
  await pool.query("INSERT INTO economy_resources(event_id,id,name) VALUES($1,$2,'Existing fictional tokens')", [legacy.storyEvent, resourceId]);
  for (const [characterId, quantity] of [[legacy.storyCharacter, 7], [legacy.peerCharacter, 13]])
    await pool.query("INSERT INTO economy_balances(event_id,character_id,resource_id,quantity,version) VALUES($1,$2,$3,$4,3)", [legacy.storyEvent, characterId, resourceId, quantity]);
  await pool.query("INSERT INTO economy_shops(id,event_id,name,description,enabled,version) VALUES($1,$2,'Existing supply shop','Preserve the authored fictional shop.',true,2)", [shopId, legacy.storyEvent]);
  await pool.query("INSERT INTO economy_stock(id,event_id,shop_id,name,description,quantity,initial_quantity,resource_id,unit_price,version) VALUES($1,$2,$3,'Existing rope','Public inventory description.',2,3,$4,2,4)", [stockId, legacy.storyEvent, shopId, resourceId]);
  const settledAt = new Date().toISOString();
  const settlement = [{ fromCharacterId: legacy.storyCharacter, toCharacterId: legacy.peerCharacter, resourceId, quantity: 3 }];
  const economyReceipt = { id: transactionId, kind: "oath", createdAt: settledAt, referenceId: agreementId, transfers: [{ fromCharacterId: legacy.storyCharacter, fromName: "Existing story character", toCharacterId: legacy.peerCharacter, toName: "Existing exchange recipient", items: [], resources: [{ resourceId, name: "Existing fictional tokens", quantity: 3 }] }] };
  const terms = "The travellers accepted the delivery of the recovered lantern and a three-token settlement.";
  await pool.query("INSERT INTO oath_agreements(id,event_id,creator_user_id,creator_character_id,title,terms,settlement,status,version,terms_version,settled_at,receipt) VALUES($1,$2,$3,$4,'Existing delivery agreement',$5,$6,'fulfilled',7,2,$7,$8)", [agreementId, legacy.storyEvent, legacy.user, legacy.storyCharacter, terms, JSON.stringify(settlement), settledAt, JSON.stringify(economyReceipt)]);
  for (const [characterId, ownerId, name] of [[legacy.storyCharacter, legacy.user, "Existing story character"], [legacy.peerCharacter, legacy.peerUser, "Existing exchange recipient"]])
    await pool.query("INSERT INTO oath_participants(event_id,agreement_id,character_id,owner_user_id,name,kind,accepted_terms_version,accepted_at,settlement_terms_version,settlement_confirmed_at) VALUES($1,$2,$3,$4,$5,'participant',2,$6,2,$6)", [legacy.storyEvent, agreementId, characterId, ownerId, name, settledAt]);
  await pool.query("INSERT INTO oath_history(id,event_id,agreement_id,actor_user_id,character_id,character_name,action,terms_version,details) VALUES($1,$2,$3,$4,$5,$6,'revised',2,$7)", [randomUUID(), legacy.storyEvent, agreementId, legacy.user, legacy.storyCharacter, "Existing story character", JSON.stringify({ snapshot: { title: "Existing delivery agreement", terms, participantIds: [legacy.storyCharacter, legacy.peerCharacter], witnessIds: [], expiresAt: null, settlement }, reason: "Preserve the exact terms accepted by both characters." })]);
  const settlementRequestId = randomUUID();
  await pool.query("INSERT INTO oath_requests(event_id,actor_user_id,request_id,payload_hash,agreement_id) VALUES($1,$2,$3,$4,$5)", [legacy.storyEvent, legacy.peerUser, settlementRequestId, hash(JSON.stringify({ action: "settle", agreementId, characterId: legacy.peerCharacter, version: 6 })), agreementId]);
  await pool.query("INSERT INTO economy_transactions(id,event_id,kind,reference_id,payload_hash,actor_user_id,receipt,created_at) VALUES($1,$2,'oath',$3,$4,$5,$6,$7)", [transactionId, legacy.storyEvent, agreementId, hash(JSON.stringify(settlement)), legacy.peerUser, JSON.stringify(economyReceipt), settledAt]);
  for (const [ownerId, characterId] of [[legacy.user, legacy.storyCharacter], [legacy.peerUser, legacy.peerCharacter]])
    await pool.query("INSERT INTO economy_receipts(event_id,transaction_id,owner_user_id,owner_character_id) VALUES($1,$2,$3,$4)", [legacy.storyEvent, transactionId, ownerId, characterId]);
  await pool.query("INSERT INTO economy_requests(event_id,actor_user_id,request_id,payload_hash,action,response) VALUES($1,$2,$3,$4,'resources.create',$5)", [legacy.storyEvent, legacy.user, randomUUID(), hash(JSON.stringify({ id: resourceId, name: "Existing fictional tokens" })), JSON.stringify({ resource: { id: resourceId, name: "Existing fictional tokens" } })]);
  const baseline = (await pool.query("SELECT * FROM character_inventory WHERE event_id=$1 ORDER BY id", [legacy.storyEvent])).rows;
  await pool.query("INSERT INTO economy_baselines(event_id,inventory) VALUES($1,$2)", [legacy.storyEvent, JSON.stringify(baseline)]);
  await pool.query("INSERT INTO exchange_trade_offers(event_id,exchange_id,side,snapshot) VALUES($1,$2,'initiator',$3)", [legacy.storyEvent, legacy.exchange, JSON.stringify({ items: [], resources: [], valid: true })]);
  legacy.economyTables = {};
  for (const table of ["economy_resources", "economy_balances", "economy_shops", "economy_stock", "economy_transactions", "economy_receipts", "economy_requests", "economy_baselines", "exchange_trade_offers", "oath_agreements", "oath_participants", "oath_history", "oath_requests"])
    legacy.economyTables[table] = (await pool.query(`SELECT * FROM ${table} WHERE event_id=$1 ORDER BY 1,2`, [legacy.storyEvent])).rows;
  // Populate every schema-9 table, including completed and paused timers, before applying migration 10.
  await pool.query("INSERT INTO character_inventory(id,event_id,character_id,name,quantity,notes,version) VALUES($1,$2,$3,'Existing field lantern',1,'Consumed during an existing procedure.',2)", [legacy.storyInventory, legacy.storyEvent, legacy.storyCharacter]);
  const propCode = () => [...randomBytes(20)].map(byte => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[byte % 32]).join("");
  const sigilId = randomUUID(), pausedEntryId = randomUUID(), sigilRunId = randomUUID(), pausedRunId = randomUUID(), sigilJournalId = randomUUID();
  const sigilDocument = {
    title: "Existing cooperative procedure", summary: "Two people operate one fictional prop.", organizerNotes: "Private staff instructions must survive recovery.", durationSeconds: 120,
    roles: [{ id: "keeper", name: "Keeper", instructions: "Hold the lantern." }, { id: "reader", name: "Reader", instructions: "Read the markings." }],
    components: [{ id: "lantern", name: "Lantern", kind: "item", itemName: "Existing field lantern", resourceId: null, quantity: 1, consume: true }],
    checkpoints: [{ id: "prepare", title: "Prepare", instructions: "Place the lantern on the prop.", roleId: "keeper", minimumSeconds: 0, answer: null }, { id: "align", title: "Align", instructions: "Read the prepared code.", roleId: "reader", minimumSeconds: 1, answer: "LANTERN" }],
    conditions: { completed: [relic.id], flags: [], skills: [], statuses: [] },
    success: { text: "The restored fictional signal is stable.", flags: ["discovered"] }, failure: { text: "The prepared sequence timed out.", flags: [] },
  };
  const roles = [{ roleId: "keeper", performer: "First in-person participant" }, { roleId: "reader", performer: "Second in-person participant" }];
  const bindings = [{ componentId: "lantern", itemId: legacy.storyInventory }];
  for (const [entryId, title] of [[sigilId, sigilDocument.title], [pausedEntryId, "Existing paused procedure"]])
    await pool.query("INSERT INTO sigil_entries(id,event_id,code,document,published,status,version,published_version,created_by) VALUES($1,$2,$3,$4,$5,'published',3,2,$6)", [entryId, legacy.storyEvent, propCode(), JSON.stringify({ ...sigilDocument, title, organizerNotes: "A revised private staff draft awaiting the next publication." }), JSON.stringify({ ...sigilDocument, title }), legacy.user]);
  await pool.query("INSERT INTO sigil_runs(id,event_id,entry_id,owner_user_id,character_id,character_name,snapshot,published_version,roles,bindings,status,version,checkpoint_index,remaining_ms,checkpoint_elapsed_ms,heartbeat_sequence) VALUES($1,$2,$3,$4,$5,$6,$7,2,$8,$9,'succeeded',8,2,70000,0,5)", [sigilRunId, legacy.storyEvent, sigilId, legacy.user, legacy.storyCharacter, "Existing story character", JSON.stringify(sigilDocument), JSON.stringify(roles), JSON.stringify(bindings)]);
  await pool.query("INSERT INTO sigil_runs(id,event_id,entry_id,owner_user_id,character_id,character_name,snapshot,published_version,roles,bindings,status,pause_reason,version,checkpoint_index,remaining_ms,checkpoint_elapsed_ms,heartbeat_sequence) VALUES($1,$2,$3,$4,$5,$6,$7,2,$8,$9,'paused','connection',5,1,45000,1200,4)", [pausedRunId, legacy.storyEvent, pausedEntryId, legacy.user, legacy.storyCharacter, "Existing story character", JSON.stringify({ ...sigilDocument, title: "Existing paused procedure" }), JSON.stringify(roles), JSON.stringify(bindings)]);
  await pool.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,type) VALUES($1,$2,$3,$4,$5,$6,$7,'sigil')", [sigilJournalId, legacy.storyEvent, legacy.storyCharacter, `sigil:${sigilId}`, `sigil:${sigilRunId}`, sigilDocument.title, sigilDocument.success.text]);
  const consumption = { items: [{ itemId: legacy.storyInventory, name: "Existing field lantern", required: 1, consumed: 1, before: 2, after: 1 }], resources: [] };
  await pool.query("INSERT INTO sigil_outcomes(id,event_id,run_id,entry_id,owner_user_id,character_id,status,text,flags,consumption,journal_id) VALUES($1,$2,$3,$4,$5,$6,'succeeded',$7,$8,$9,$10)", [randomUUID(), legacy.storyEvent, sigilRunId, sigilId, legacy.user, legacy.storyCharacter, sigilDocument.success.text, JSON.stringify(sigilDocument.success.flags), JSON.stringify(consumption), sigilJournalId]);
  await pool.query("INSERT INTO sigil_requests(event_id,actor_user_id,request_id,payload_hash,action,entry_id,run_id,outcome) VALUES($1,$2,$3,$4,'checkpoint',$5,$6,$7)", [legacy.storyEvent, legacy.user, randomUUID(), hash(JSON.stringify({ runId: sigilRunId, checkpointId: "align", roleId: "reader", answer: "LANTERN", version: 7 })), sigilId, sigilRunId, JSON.stringify({ status: "succeeded", journalId: sigilJournalId })]);
  await pool.query("INSERT INTO sigil_history(id,event_id,run_id,actor_user_id,action,details) VALUES($1,$2,$3,$4,'succeeded',$5)", [randomUUID(), legacy.storyEvent, sigilRunId, legacy.user, JSON.stringify({ reason: "Staff confirmed the group completed its in-person procedure.", consumption })]);
  await pool.query("INSERT INTO sigil_history(id,event_id,run_id,actor_user_id,action,details) VALUES($1,$2,$3,$4,'paused',$5)", [randomUUID(), legacy.storyEvent, pausedRunId, legacy.user, JSON.stringify({ reason: "connection", remainingMs: 45000, checkpointElapsedMs: 1200 })]);
  const staticId = randomUUID(), staticJournalId = randomUUID();
  const staticDocument = {
    title: "Existing fictional scanner", summary: "A prepared fictional zone reading.", organizerNotes: "Private explanation of the future fictional signal.", zoneLabel: "Lantern chamber",
    conditions: { completed: [relic.id], flags: [], skills: [], statuses: [] },
    states: [{ id: "unsettled", label: "Unsettled", text: "A fictional oscillation moves across the chamber.", level: 65, tone: "alert" }, { id: "restored", label: "Restored", text: "The fictional chamber signal is stable.", level: 15, tone: "calm" }],
    defaultStateId: "unsettled", rules: [{ id: "discovered", conditions: { completed: [], flags: ["discovered"], skills: [], statuses: [] }, stateId: "restored" }],
  };
  await pool.query("INSERT INTO static_entries(id,event_id,code,document,published,status,version,published_version,created_by) VALUES($1,$2,$3,$4,$5,'published',4,3,$6)", [staticId, legacy.storyEvent, propCode(), JSON.stringify({ ...staticDocument, organizerNotes: "Private revised draft after publication." }), JSON.stringify(staticDocument), legacy.user]);
  await pool.query("INSERT INTO static_overrides(event_id,entry_id,version,state_id,reason,actor_user_id) VALUES($1,$2,2,'unsettled','Staff prepared a fictional signal change after observing the group.',$3)", [legacy.storyEvent, staticId, legacy.user]);
  await pool.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,type) VALUES($1,$2,$3,$4,$5,$6,$7,'static')", [staticJournalId, legacy.storyEvent, legacy.storyCharacter, `static:${staticId}`, `static:${staticId}:captured`, staticDocument.title, staticDocument.states[1].text]);
  const readingKey = hash(JSON.stringify({ entryId: staticId, publicationVersion: 3, stateId: "restored", source: "conditions", overrideVersion: 0 }));
  await pool.query("INSERT INTO static_readings(id,event_id,entry_id,owner_user_id,character_id,publication_version,reading_key,state_id,source,journal_id) VALUES($1,$2,$3,$4,$5,3,$6,'restored','conditions',$7)", [randomUUID(), legacy.storyEvent, staticId, legacy.user, legacy.storyCharacter, readingKey, staticJournalId]);
  await pool.query("INSERT INTO static_requests(event_id,actor_user_id,request_id,payload_hash,action,target_id) VALUES($1,$2,$3,$4,'collect',$5)", [legacy.storyEvent, legacy.user, randomUUID(), hash(JSON.stringify({ entryId: staticId, publicationVersion: 3, readingKey })), staticId]);
  await pool.query("INSERT INTO static_history(id,event_id,entry_id,actor_user_id,action,version,reason,details) VALUES($1,$2,$3,$4,'state',2,'Staff prepared a fictional signal change after observing the group.',$5)", [randomUUID(), legacy.storyEvent, staticId, legacy.user, JSON.stringify({ stateId: "unsettled", previousStateId: null })]);
  legacy.instrumentTables = {};
  for (const table of ["sigil_entries", "sigil_runs", "sigil_outcomes", "sigil_requests", "sigil_history", "static_entries", "static_overrides", "static_readings", "static_requests", "static_history", "character_inventory"])
    legacy.instrumentTables[table] = (await pool.query(`SELECT * FROM ${table} WHERE event_id=$1 ORDER BY 1,2`, [legacy.storyEvent])).rows;
  legacy.migrations = (await pool.query("SELECT * FROM schema_migrations ORDER BY version")).rows;
  legacy.operator = (await pool.query("SELECT * FROM users WHERE id=$1", [legacy.user])).rows[0];
  // Re-capture the journal after all account-bound instrument and exchange receipts were added.
  legacy.storyTables.adventure_journal = (await pool.query("SELECT * FROM adventure_journal WHERE event_id=$1", [legacy.storyEvent])).rows;
  await migrate(pool);
  let handler;
  server = createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  handler = createApp({ pool, config: { ...readConfig({ DATABASE_URL: "postgres://unused", PORT: "3000" }), origin }, logger: () => {} });
  for (const name of ["owner", "organizer", "staff", "player", "outsider"]) {
    const result = await request("/api/auth/register", "POST", { displayName: `Batch2 ${name}`, email: `${name}@batch2.example.test`, password: pass });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    users[name] = { ...result.data.user, cookie: result.cookie };
  }
  console.log(`Batch 2 integration database: ${database.kind}`);
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (database) await database.close();
});

test("Batch 1 to Batch 9 migration preserves event identity, lifecycle, membership, invitations and audit", async () => {
  assert.equal(await migrate(pool), 14);
  assert.equal(await checkSchema(pool), 14);
  const event = (await pool.query("SELECT * FROM events WHERE id=$1", [legacy.event])).rows[0];
  assert.equal(event.name, "Existing live event");
  assert.equal(event.description, "Original description");
  assert.equal(event.location, "Original location");
  assert.equal(event.status, "live");
  assert.equal(event.version, 7);
  assert.equal(event.owner_user_id, legacy.user);
  assert.deepEqual(event.setup, defaultSetup("fantasy", "blank"));
  assert.equal((await pool.query("SELECT role FROM memberships WHERE event_id=$1 AND user_id=$2", [legacy.event, legacy.user])).rows[0].role, "owner");
  assert.equal((await pool.query("SELECT token_hash FROM invitations WHERE id=$1", [legacy.invitation])).rows[0].token_hash, "original-token-hash");
  assert.equal((await pool.query("SELECT action FROM audit_entries WHERE event_id=$1", [legacy.event])).rows[0].action, "event.created");
  const user = (await pool.query("SELECT id,password_hash,is_superuser,is_disabled FROM users WHERE id=$1", [legacy.user])).rows[0];
  assert.equal(user.id, legacy.user);
  assert.equal(user.password_hash, "existing-hash");
  assert.equal(user.is_superuser, true, "An enabled existing superuser must retain their access and password.");
  assert.equal(user.is_disabled, false);
  assert.deepEqual((await pool.query("SELECT * FROM users WHERE id=$1", [legacy.user])).rows[0], legacy.operator, "The entire enabled operator row must survive migration unchanged.");
  assert.deepEqual((await pool.query("SELECT version FROM schema_migrations ORDER BY version")).rows.map((row) => row.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual((await pool.query("SELECT * FROM schema_migrations WHERE version<=9 ORDER BY version")).rows, legacy.migrations, "All nine deployed migration names, checksums and original application timestamps must be preserved.");
});

test("Batch 3 character identities, approval, private sheets, inventory and settings survive Batch 9 migration", async () => {
  for (const [table, before] of Object.entries(legacy.tables))
    assert.deepEqual((await pool.query(`SELECT * FROM ${table} WHERE event_id=$1`, [legacy.event])).rows, before, `${table} must survive the additive migrations unchanged.`);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM event_adventures WHERE event_id=$1", [legacy.event])).rows[0].n, 0, "Existing events must not silently acquire a starter adventure.");
});

test("Batch 4 definitions, progress, private journals, retries and attendance survive Batch 9", async () => {
  for (const [table, before] of Object.entries(legacy.storyTables))
    assert.deepEqual((await pool.query(`SELECT * FROM ${table} WHERE event_id=$1`, [legacy.storyEvent])).rows, before, `${table} must survive the additive story migration unchanged.`);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM story_entries WHERE event_id=$1", [legacy.event])).rows[0].n, 0, "Migration must not seed new story content into existing adventures.");
});

test("Batch 5 sharing, completed exchanges, private copies, bilateral receipts and replay records survive Batch 9", async () => {
  for (const [table, before] of Object.entries(legacy.exchangeTables))
    assert.deepEqual((await pool.query(`SELECT * FROM ${table} WHERE event_id=$1 ORDER BY 1,2`, [legacy.storyEvent])).rows, before, `${table} must survive schema 6 to 10 unchanged.`);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM story_groups WHERE event_id=$1", [legacy.event])).rows[0].n, 0, "An existing event must not silently acquire audience groups.");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM trace_records WHERE event_id=$1", [legacy.event])).rows[0].n, 0, "Migration must not create private player investigation records.");
});

test("Populated Batch 6 rumors, publications, private investigations and replay records survive Batch 9", async () => {
  for (const table of ["economy_resources", "economy_balances", "economy_shops", "economy_stock", "economy_transactions", "economy_receipts", "economy_requests", "economy_baselines", "exchange_trade_offers", "oath_agreements", "oath_participants", "oath_history", "oath_requests"])
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE event_id=$1`, [legacy.event])).rows[0].n, 0, `Migration must not silently seed ${table} into existing events.`);
  for (const [table, before] of Object.entries(legacy.narrativeTables))
    assert.deepEqual((await pool.query(`SELECT * FROM ${table} WHERE event_id=$1 ORDER BY 1,2`, [legacy.storyEvent])).rows, before, `${table} must survive schema 7 to 10 unchanged.`);
});

test("Populated Batch 7 economy, atomic trade offers, fixed terms, signatures and correction evidence survive Batch 9", async () => {
  for (const [table, before] of Object.entries(legacy.economyTables)) {
    assert.ok(before.length > 0, `${table} must have a populated deployed fixture.`);
    assert.deepEqual((await pool.query(`SELECT * FROM ${table} WHERE event_id=$1 ORDER BY 1,2`, [legacy.storyEvent])).rows, before, `${table} must survive schema 8 to 10 unchanged.`);
  }
  for (const table of ["sigil_entries", "sigil_runs", "sigil_outcomes", "sigil_requests", "sigil_history", "static_entries", "static_overrides", "static_readings", "static_requests", "static_history"])
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE event_id=$1`, [legacy.event])).rows[0].n, 0, `Migration must not seed ${table} into existing events.`);
});

test("Populated Batch 8 cooperative publications, paused timers, outcomes, fictional signals and captured receipts survive Batch 9", async () => {
  for (const [table, before] of Object.entries(legacy.instrumentTables)) {
    assert.ok(before.length > 0, `${table} must contain actual deployed instrument data.`);
    assert.deepEqual((await pool.query(`SELECT * FROM ${table} WHERE event_id=$1 ORDER BY 1,2`, [legacy.storyEvent])).rows, before, `${table} must survive schema 9 to 10 unchanged.`);
  }
  for (const table of ["stagehand_encounters", "stagehand_parties", "stagehand_requests", "stagehand_history", "stagehand_announcements"])
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0, `Migration must not silently seed ${table} into existing events.`);
});

test("catalog requires authentication and theme module is served under the script CSP", async () => {
  assert.equal((await request("/api/catalog")).status, 401);
  const catalog = await request("/api/catalog", "GET", undefined, users.owner);
  assert.equal(catalog.status, 200);
  assert.ok(catalog.data.themes && catalog.data.templates && catalog.data.instruments);
  const module = await request("/kit.js");
  assert.equal(module.status, 200);
  assert.match(module.headers.get("content-type"), /text\/javascript/);
  assert.match(module.headers.get("content-security-policy"), /script-src 'self'/);
  assert.ok(!module.headers.get("content-security-policy").includes("unsafe-inline"));
});

test("Batch 1 event creation remains compatible and persisted setup defaults are valid", async () => {
  const result = await request("/api/events", "POST", { name: "Old client creation" }, users.owner);
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.deepEqual(result.data.event.setup, defaultSetup());
  assert.equal((await request(`/api/events/${result.data.event.id}`, "GET", undefined, users.owner)).data.event.id, result.data.event.id);
});

test("switching all three themes preserves IDs, rules, content and lifecycle across reloads", async () => {
  let event = await createEvent();
  const original = structuredClone(event);
  for (const themeId of ["cyberpunk", "wasteland", "fantasy"]) {
    const theme = Array.isArray(THEMES) ? THEMES.find((entry) => entry.id === themeId) : THEMES[themeId];
    const result = await request(`/api/events/${event.id}`, "PATCH", { version: event.version, theme }, users.owner);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    event = (await request(`/api/events/${event.id}`, "GET", undefined, users.owner)).data.event;
    assert.equal(event.setup.theme.id, themeId);
    assert.equal(event.id, original.id);
    assert.equal(event.status, original.status);
    assert.equal(event.name, original.name);
    assert.deepEqual(event.setup.rules, original.setup.rules);
    assert.deepEqual(event.setup.content, original.setup.content);
    assert.deepEqual(event.setup.enabledInstruments, original.setup.enabledInstruments);
  }
  assert.equal(event.version, original.version + 3);
});

test("setup writes enforce organizer permissions, optimistic versions and atomic validation", async () => {
  const event = await createEvent("Permission rehearsal");
  await join(event, users.player);
  await join(event, users.staff, "staff");
  await join(event, users.organizer, "organizer");
  const changed = setup();
  changed.content[0].title = "New public briefing";
  for (const who of [users.player, users.staff])
    assert.equal((await request(`/api/events/${event.id}`, "PATCH", { version: event.version, setup: changed }, who)).status, 403);
  assert.equal((await request(`/api/events/${event.id}`, "PATCH", { version: event.version, setup: changed }, users.organizer)).status, 200);
  assert.equal((await request(`/api/events/${event.id}`, "PATCH", { version: event.version, setup: setup() }, users.owner)).status, 409);
  const invalid = structuredClone(changed);
  invalid.theme.tokens.accent = "url(javascript:alert(1))";
  assert.equal((await request(`/api/events/${event.id}`, "PATCH", { version: 2, name: "Must not persist", setup: invalid }, users.owner)).status, 400);
  const result = await request(`/api/events/${event.id}`, "GET", undefined, users.owner);
  assert.equal(result.data.event.version, 2);
  assert.equal(result.data.event.name, event.name);
  assert.equal(result.data.event.setup.content[0].title, "New public briefing");
});

test("every player route strips organizer material and previews exclude account and membership data", async () => {
  const event = await createEvent("Projection rehearsal");
  const joined = await join(event, users.player);
  noPrivate(joined.result);
  const responses = await Promise.all([
    request("/api/events", "GET", undefined, users.player),
    request(`/api/events/${event.id}`, "GET", undefined, users.player),
    request(`/api/events/${event.id}/pack?audience=player`, "GET", undefined, users.player),
    request(`/api/events/${event.id}/preview?audience=player`, "GET", undefined, users.owner),
    request(`/api/events/${event.id}/preview?audience=prop`, "GET", undefined, users.owner),
  ]);
  for (const result of responses) { assert.equal(result.status, 200); noPrivate(result); }
  const playerPreview = responses[3];
  assert.equal(playerPreview.data.readOnly, true);
  assert.equal(playerPreview.data.event.role, undefined);
  assert.equal(playerPreview.data.members, undefined);
  assert.ok(!JSON.stringify(playerPreview.data).includes(users.owner.email));
  assert.deepEqual(playerPreview.data.event.setup.content.map((entry) => entry.id), ["welcome", "field-notes"]);
  assert.deepEqual(responses[4].data.event.setup.content.map((entry) => entry.id), ["welcome"]);
  assert.equal((await request(`/api/events/${event.id}/pack?audience=organizer`, "GET", undefined, users.player)).status, 403);
  for (const suffix of ["pack?audience=player", "pack?audience=organizer", "preview?audience=player", "preview?audience=prop"])
    assert.equal((await request(`/api/events/${event.id}/${suffix}`, "GET", undefined, users.outsider)).status, 404);
  const ownerPack = await request(`/api/events/${event.id}/pack?audience=organizer`, "GET", undefined, users.owner);
  assert.ok(JSON.stringify(ownerPack.data).includes(secret));
  for (const forbidden of ["owner_user_id", "password_hash", "token_hash", users.owner.id, users.owner.email, event.id])
    assert.ok(!JSON.stringify(ownerPack.data).includes(forbidden), `Export included ${forbidden}`);
});

test("event-pack import creates a new owned draft and preserves the source event and content", async () => {
  let event = await createEvent("Export rehearsal");
  event = (await request(`/api/events/${event.id}`, "PATCH", { version: event.version, status: "rehearsal" }, users.owner)).data.event;
  const pack = (await request(`/api/events/${event.id}/pack?audience=organizer`, "GET", undefined, users.owner)).data;
  const imported = await request("/api/events/import", "POST", { pack }, users.outsider);
  assert.equal(imported.status, 201, JSON.stringify(imported.data));
  const copy = imported.data.event;
  assert.notEqual(copy.id, event.id);
  assert.equal(copy.status, "draft");
  assert.equal(copy.version, 1);
  assert.equal(copy.role, "owner");
  assert.deepEqual(copy.setup, event.setup);
  const members = (await pool.query("SELECT user_id,role FROM memberships WHERE event_id=$1", [copy.id])).rows;
  assert.deepEqual(members, [{ user_id: users.outsider.id, role: "owner" }]);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM invitations WHERE event_id=$1", [copy.id])).rows[0].n, 0);
  const audit = (await pool.query("SELECT action,details FROM audit_entries WHERE event_id=$1", [copy.id])).rows;
  assert.deepEqual(audit, [{ action: "event.imported", details: { audience: "organizer", formatVersion: 1 } }]);
  const source = (await request(`/api/events/${event.id}`, "GET", undefined, users.owner)).data.event;
  assert.equal(source.status, "rehearsal");
  assert.equal(source.version, event.version);
  assert.deepEqual(source.setup, event.setup);
});

test("invalid or future event packs cannot create or overwrite records", async () => {
  const event = await createEvent("Import validation rehearsal");
  const pack = (await request(`/api/events/${event.id}/pack?audience=organizer`, "GET", undefined, users.owner)).data;
  const beforeCount = (await pool.query("SELECT count(*)::int AS n FROM events")).rows[0].n;
  for (const mutate of [
    (p) => { p.version = 999; },
    (p) => { p.event.id = event.id; },
    (p) => { p.event.status = "live"; },
    (p) => { p.memberships = [{ user_id: users.owner.id, role: "owner" }]; },
    (p) => { p.setup.theme.script = "alert(1)"; },
    (p) => { p.setup.enabledInstruments = ["unknown-instrument"]; },
  ]) {
    const invalid = structuredClone(pack); mutate(invalid);
    const result = await request("/api/events/import", "POST", { pack: invalid }, users.outsider);
    assert.equal(result.status, 400, JSON.stringify(result.data));
  }
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM events")).rows[0].n, beforeCount);
  const current = (await request(`/api/events/${event.id}`, "GET", undefined, users.owner)).data.event;
  assert.equal(current.version, event.version);
  assert.deepEqual(current.setup, event.setup);
});

test("archived events remain read-only while permitted exports and previews still work", async () => {
  const event = await createEvent("Archived rehearsal");
  await pool.query("UPDATE events SET status='archived' WHERE id=$1", [event.id]);
  assert.equal((await request(`/api/events/${event.id}`, "PATCH", { version: event.version, setup: setup() }, users.owner)).status, 409);
  assert.equal((await request(`/api/events/${event.id}/pack?audience=organizer`, "GET", undefined, users.owner)).status, 200);
  assert.equal((await request(`/api/events/${event.id}/preview?audience=player`, "GET", undefined, users.owner)).status, 200);
  assert.equal((await request(`/api/events/${event.id}/preview?audience=organizer`, "GET", undefined, users.owner)).status, 400);
});

test("event setup accepts bounded content above 16 KiB while authentication stays small", async () => {
  const large = setup();
  large.content = Array.from({ length: 5 }, (_, index) => ({ id: `chapter-${index}`, title: `Chapter ${index}`, body: "Story. ".repeat(600), visibility: "player", prop: false }));
  const event = await createEvent("Larger event pack", large);
  assert.ok(JSON.stringify(event.setup).length > 16384);
  const pack = (await request(`/api/events/${event.id}/pack?audience=organizer`, "GET", undefined, users.owner)).data;
  assert.equal((await request("/api/events/import", "POST", { pack }, users.outsider)).status, 201);
  assert.equal((await request("/api/auth/login", "POST", { email: "owner@batch2.example.test", password: pass, padding: "x".repeat(17000) })).status, 413);
  assert.equal((await request("/api/events", "POST", { name: "Oversized", padding: "x".repeat(262144) }, users.owner)).status, 413);
});
