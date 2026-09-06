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
    await client.query("INSERT INTO users(id,email,display_name,password_hash,is_superuser,is_disabled) VALUES($1,$2,'Recovery rehearsal','not-a-login-credential',true,true)", [fixture.user, `recovery-${fixture.user}@example.invalid`]);
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
  });
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
  await migrate(restored);
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
    "PostgreSQL pg_dump/pg_restore round trip, populated characters, administrators, adventures, journals, sharing policies, exchange sessions, provenance, bilateral contacts and receipts, story groups and draft/publication separation, hidden truths, collected rumors, activity, private investigations, replay records, both audit sequences, and migration after restore passed.",
  );
} finally {
  if (restored) await restored.end();
  await source.end();
  await rm(directory, { recursive: true, force: true });
}
