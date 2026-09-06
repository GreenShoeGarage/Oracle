import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./database.js";
import { migrate } from "../src/db.js";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { defaultSetup } from "../public/kit.js";
import { defaultCharacterProfile } from "../public/characters-model.js";
import { defaultAdventure, defaultAdventureNode } from "../public/adventure-model.js";
import { readSharing, sharingPolicyFor, seedSharing } from "../src/sharing.js";

let database, pool, server, origin;
const users = {}, propCode = "AAAAAAAAAAAAAAAAAAAA";
async function request(path, method = "GET", data, who = users.owner) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(method !== "GET" ? { "Content-Type": "application/json", Origin: origin } : {}), ...(who?.cookie ? { Cookie: who.cookie } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
const ok = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.data)); return response.data; };
const path = (f, suffix = "sharing") => `/api/events/${f.event.id}/${suffix}`;
async function fixture() {
  const setup = defaultSetup("fantasy"); setup.enabledInstruments = ["briefing", "relic", "dead-drop", "cipherbox", "wayfinder"];
  const event = ok(await request("/api/events", "POST", { name: "Sharing test", setup }), 201).event;
  const characters = {};
  for (const name of ["one", "two"]) {
    await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'player')", [event.id, users[name].id]);
    const profile = { ...defaultCharacterProfile(setup.rules), name: `Reader ${name}` };
    characters[name] = ok(await request(`/api/events/${event.id}/characters`, "POST", { profile }, users[name]), 201).character;
    await pool.query("UPDATE characters SET status='approved',inventory_initialized=true WHERE id=$1", [characters[name].id]);
  }
  const relic = defaultAdventureNode("relic", "relic", propCode); relic.title = "Hidden relic title"; relic.examinations[0].text = "Historical relic reading";
  const scene = defaultAdventureNode("wayfinder", "scene", "BBBBBBBBBBBBBBBBBBBB"); scene.title = "Hidden scene title"; scene.body = "Unseen gathering instructions";
  const definition = { ...defaultAdventure(), nodes: [relic, scene] };
  const { version } = ok(await request(`/api/events/${event.id}/adventure/manage`, "PUT", { version: 0, definition }));
  await pool.query("UPDATE events SET status='rehearsal' WHERE id=$1", [event.id]);
  return { event, characters, definition, version };
}
const permissions = (relic = "shareable", scene = "restricted") => [{ nodeId: "relic", policy: relic }, { nodeId: "scene", policy: scene }];
const act = (f, kind = "examine") => ({ requestId: randomUUID(), version: f.version, characterId: f.characters.one.id, nodeId: "relic", kind, ...(kind === "examine" ? { examId: "examine", code: propCode } : {}) });
async function session(f, status = "negotiating", expired = false) {
  const id = randomUUID();
  await pool.query("INSERT INTO exchange_sessions(id,event_id,code,status,version,initiator_user_id,initiator_character_id,recipient_user_id,recipient_character_id,initiator_confirmed_version,recipient_confirmed_version,expires_at) VALUES($1,$2,$3,$4,4,$5,$6,$7,$8,4,4,clock_timestamp()+$9::interval)", [id, f.event.id, randomUUID().replaceAll("-", "").slice(0, 12).replace(/[01]/g, "A").toUpperCase(), status, users.one.id, f.characters.one.id, users.two.id, f.characters.two.id, expired ? "-1 minute" : "15 minutes"]);
  return id;
}

before(async () => {
  database = await testDatabase(); pool = database.pool; await migrate(pool);
  let handler; server = createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  handler = createApp({ pool, config: { ...readConfig({ DATABASE_URL: "postgres://unused", PORT: "3000" }), origin }, logger: entry => console.error(entry) });
  for (const name of ["owner", "one", "two", "outsider"]) { const response = await request("/api/auth/register", "POST", { displayName: `Sharing ${name}`, email: `${name}@sharing.example.test`, password: "Sharing integration passphrase!" }, null); users[name] = { ...ok(response, 201).user, cookie: response.cookie }; }
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); if (database) await database.close(); });

test("sharing defaults reject inherited, unknown, and accessor permissions", () => {
  assert.equal(sharingPolicyFor({ policies: Object.create({ relic: "shareable" }) }, "relic"), "restricted");
  assert.equal(sharingPolicyFor({ policies: { relic: "anything" } }, "relic"), "restricted");
  assert.equal(sharingPolicyFor({}, "constructor"), "restricted");
  let ran = false; const values = {}; Object.defineProperty(values, "relic", { get() { ran = true; return "shareable"; } });
  assert.equal(sharingPolicyFor({ policies: values }, "relic"), "restricted"); assert.equal(ran, false);
});

test("manager policy API defaults old data to restricted and rejects stale, unknown or nonmanager edits", async () => {
  const f = await fixture();
  const initial = ok(await request(path(f))); assert.equal(initial.version, 0); assert.ok(initial.nodes.every(node => node.policy === "restricted"));
  assert.deepEqual(Object.keys(initial.nodes[0]).sort(), ["id", "policy", "title", "type"]);
  assert.equal((await request(path(f), "GET", undefined, users.one)).status, 403);
  assert.equal((await request(path(f), "PUT", { version: 0, policies: [] }, users.one)).status, 403);
  assert.equal((await request(path(f), "GET", undefined, users.outsider)).status, 404);
  for (const policies of [[{ nodeId: "missing", policy: "shareable" }], [{ nodeId: "relic", policy: "public" }], [{ nodeId: "relic", policy: "shareable", text: "forged" }], [{ nodeId: "relic", policy: "shareable" }, { nodeId: "relic", policy: "restricted" }], Array.from({ length: 51 }, () => ({ nodeId: "relic", policy: "restricted" }))]) assert.equal((await request(path(f), "PUT", { version: 0, policies })).status, 400);
  assert.equal((await request(path(f), "PUT", { version: 0, policies: [], definition: {} })).status, 400);
  const next = ok(await request(path(f), "PUT", { version: 0, policies: [{ nodeId: "relic", policy: "shareable" }] }));
  assert.equal(next.version, 1); assert.equal(next.nodes[1].policy, "restricted");
  assert.equal((await request(path(f), "PUT", { version: 0, policies: [] })).status, 409);
});

test("changed policies clear both active confirmations; no-op, completed and expired exchanges preserve theirs", async () => {
  const f = await fixture(), active = await session(f), expired = await session(f, "negotiating", true), completed = await session(f, "completed");
  const first = ok(await request(path(f), "PUT", { version: 0, policies: permissions() }));
  const rows = (await pool.query("SELECT id,version,initiator_confirmed_version,recipient_confirmed_version FROM exchange_sessions WHERE event_id=$1", [f.event.id])).rows;
  const current = rows.find(row => row.id === active); assert.equal(current.version, 5); assert.equal(current.initiator_confirmed_version, null); assert.equal(current.recipient_confirmed_version, null);
  for (const id of [expired, completed]) assert.deepEqual(rows.find(row => row.id === id), { id, version: 4, initiator_confirmed_version: 4, recipient_confirmed_version: 4 });
  await pool.query("UPDATE exchange_sessions SET initiator_confirmed_version=5,recipient_confirmed_version=5 WHERE id=$1", [active]);
  ok(await request(path(f), "PUT", { version: first.version, policies: permissions() }));
  assert.deepEqual((await pool.query("SELECT version,initiator_confirmed_version,recipient_confirmed_version FROM exchange_sessions WHERE id=$1", [active])).rows[0], { version: 5, initiator_confirmed_version: 5, recipient_confirmed_version: 5 });
  for (const status of ["draft", "rehearsal", "live", "paused", "ended"]) {
    await pool.query("UPDATE events SET status=$2 WHERE id=$1", [f.event.id, status]);
    const record = ok(await request(path(f))); ok(await request(path(f), "PUT", { version: record.version, policies: permissions(status === "live" ? "restricted" : "shareable") }));
  }
  await pool.query("UPDATE events SET status='archived' WHERE id=$1", [f.event.id]);
  assert.equal((await request(path(f), "PUT", { version: ok(await request(path(f))).version, policies: [] })).status, 409);
});

test("organizer-only blocks new listings, lookup, actions, overrides and replays while preserving historical journals", async () => {
  const f = await fixture(), input = act(f);
  const discovered = ok(await request(path(f, "adventure/action"), "POST", input, users.one)); assert.equal(discovered.journal.length, 1);
  ok(await request(path(f), "PUT", { version: 0, policies: permissions("organizer_only", "organizer_only") }));
  const fresh = ok(await request(path(f, "adventure/play"), "GET", undefined, users.two));
  assert.equal(fresh.nodes.length, 0); assert.equal(fresh.journal.length, 0); assert.ok(!JSON.stringify(fresh).includes("Hidden")); assert.ok(!JSON.stringify(fresh).includes("Unseen gathering"));
  const history = ok(await request(path(f, "adventure/play"), "GET", undefined, users.one)); assert.deepEqual(history.journal, discovered.journal); assert.equal(history.nodes.length, 0);
  assert.equal((await request(path(f, `adventure/lookup?characterId=${f.characters.one.id}&code=${propCode}`), "GET", undefined, users.one)).status, 404);
  assert.equal((await request(path(f, "adventure/action"), "POST", input, users.one)).status, 404);
  assert.equal((await request(path(f, "adventure/action"), "POST", act(f), users.one)).status, 404);
  assert.equal((await request(path(f, "adventure/override"), "POST", act(f, "release"))).status, 404);
  const preview = ok(await request(path(f, `adventure/play?characterId=${f.characters.two.id}&preview=true`))); assert.equal(preview.nodes.length, 2); assert.equal(preview.readOnly, true); assert.equal(preview.journal.length, 0);
  assert.equal(ok(await request(path(f, `adventure/lookup?characterId=${f.characters.two.id}&preview=true&code=${propCode}`))).focusNodeId, "relic");
  ok(await request(path(f), "PUT", { version: 1, policies: permissions("restricted") }));
  assert.equal(ok(await request(path(f, "adventure/play"), "GET", undefined, users.two)).nodes.length, 2);
  assert.equal(ok(await request(path(f, "adventure/action"), "POST", { ...act(f), characterId: f.characters.two.id }, users.two)).journal.length, 1);
});

test("new themed starters seed shareable relics and messages; rehearsals copy independent policies only", async () => {
  for (const theme of ["fantasy", "cyberpunk", "wasteland"]) {
    const event = ok(await request(`/api/adventure-templates/${theme}`, "POST", {}), 201).event, f = { event };
    const settings = ok(await request(path(f))); assert.equal(settings.version, 1);
    for (const node of settings.nodes) assert.equal(node.policy, ["relic", "dead_drop"].includes(node.type) ? "shareable" : "restricted");
  }
  const f = await fixture();
  ok(await request(path(f), "PUT", { version: 0, policies: permissions("organizer_only", "shareable") }));
  await session(f);
  const copied = { event: ok(await request(path(f, "adventure/rehearsal"), "POST", {}), 201).event };
  const copySettings = ok(await request(path(copied))); assert.equal(copySettings.version, 1); assert.deepEqual(copySettings.nodes.map(node => node.policy), ["organizer_only", "shareable"]);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM exchange_sessions WHERE event_id=$1", [copied.event.id])).rows[0].n, 0);
  ok(await request(path(copied), "PUT", { version: 1, policies: [] }));
  assert.equal((await readSharing(pool, f.event.id)).policies.relic, "organizer_only");
  await seedSharing(pool, f.event.id, f.definition); assert.equal((await readSharing(pool, f.event.id)).policies.relic, "organizer_only");
});

test("rehearsal reset atomically clears exchanges and receipts before journal while preserving policies and source", async () => {
  const source = await fixture();
  ok(await request(path(source), "PUT", { version: 0, policies: permissions() }));
  const sourceSession = await session(source);
  const event = ok(await request(path(source, "adventure/rehearsal"), "POST", {}), 201).event;
  const rows = (await pool.query("SELECT id FROM characters WHERE event_id=$1 ORDER BY id", [event.id])).rows;
  const f = { event, characters: { one: rows[0], two: rows[1] } };
  for (const name of ["one", "two"]) { await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'player')", [event.id, users[name].id]); await pool.query("UPDATE characters SET user_id=$2 WHERE id=$1", [f.characters[name].id, users[name].id]); }
  const exchangeId = await session(f, "completed"), original = randomUUID(), copy = randomUUID(), receipt = randomUUID();
  for (const [id, character, type] of [[original, f.characters.one.id, "relic"], [copy, f.characters.two.id, "shared_reading"], [receipt, f.characters.one.id, "exchange_receipt"]]) await pool.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,type) VALUES($1,$2,$3,'relic',$4,'Reading','Preserved source',$5)", [id, event.id, character, id, type]);
  await pool.query("INSERT INTO exchange_requests(event_id,actor_user_id,request_id,payload_hash,exchange_id) VALUES($1,$2,$3,'hash',$4)", [event.id, users.one.id, randomUUID(), exchangeId]);
  await pool.query("INSERT INTO exchange_copies(event_id,recipient_character_id,origin_journal_id,journal_id,exchange_id,sender_character_id) VALUES($1,$2,$3,$4,$5,$6)", [event.id, f.characters.two.id, original, copy, exchangeId, f.characters.one.id]);
  await pool.query("INSERT INTO exchange_receipts(exchange_id,event_id,owner_user_id,owner_character_id,receipt) VALUES($1,$2,$3,$4,'{}')", [exchangeId, event.id, users.one.id, f.characters.one.id]);
  await pool.query("INSERT INTO exchange_contacts(id,event_id,owner_user_id,owner_character_id,peer_user_id,peer_character_id) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), event.id, users.one.id, f.characters.one.id, users.two.id, f.characters.two.id]);
  const before = ok(await request(path(f, "adventure/manage")));
  ok(await request(path(f, "adventure/reset"), "POST", { version: before.version, confirm: true }));
  for (const table of ["exchange_requests", "exchange_contacts", "exchange_receipts", "exchange_copies", "exchange_sessions", "adventure_journal"]) assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE event_id=$1`, [event.id])).rows[0].n, 0, table);
  assert.equal((await readSharing(pool, event.id)).policies.relic, "shareable");
  assert.equal((await pool.query("SELECT id FROM exchange_sessions WHERE id=$1", [sourceSession])).rows[0].id, sourceSession);
  assert.equal((await readSharing(pool, source.event.id)).policies.relic, "shareable");
});
