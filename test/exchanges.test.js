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
import { validateExchangeRequest } from "../public/exchange-model.js";

let database, pool, server, origin;
const users = {}, pass = "Exchange integration passphrase!";
const secretOne = "PRIVATE reading: the copper gate opens westward.", secretTwo = "PRIVATE reading: ask the lookout about the red lantern.";
const code = "AAAAAAAAAAAAAAAAAAAA";
async function request(path, method = "GET", data, who = users.owner) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(method !== "GET" ? { "Content-Type": "application/json", Origin: origin } : {}), ...(who?.cookie ? { Cookie: who.cookie } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  const raw = await response.text(); return { status: response.status, data: raw ? JSON.parse(raw) : null, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
function ok(response, status = 200) { assert.equal(response.status, status, JSON.stringify(response.data)); return response.data; }
const base = (f) => `/api/events/${f.event.id}/exchanges`;
const bodyFor = (f, who, data = {}) => ({ requestId: randomUUID(), characterId: f.characters[who].id, ...data });
async function fixture() {
  const setup = defaultSetup(); setup.enabledInstruments = ["briefing", "relic", "dead-drop"];
  const event = ok(await request("/api/events", "POST", { name: "Exchange rehearsal", setup }), 201).event;
  await pool.query("UPDATE events SET status='rehearsal' WHERE id=$1", [event.id]);
  for (const name of ["one", "two", "third"]) await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'player')", [event.id, users[name].id]);
  const characters = {}, readings = {};
  for (const name of ["one", "two", "third"]) {
    const profile = { ...defaultCharacterProfile(setup.rules), name: `Courier ${name}`, privateObjectives: "PRIVATE character objective", startingEquipment: [{ name: "Untraded item", quantity: 1, notes: "Private inventory" }] };
    characters[name] = ok(await request(`/api/events/${event.id}/characters`, "POST", { profile }, users[name]), 201).character;
    await pool.query("UPDATE characters SET status='approved',inventory_initialized=true WHERE id=$1", [characters[name].id]);
    await pool.query("INSERT INTO character_inventory(id,event_id,character_id,name,quantity,notes) VALUES($1,$2,$3,'Untraded item',1,'Private inventory')", [randomUUID(), event.id, characters[name].id]);
    await pool.query("INSERT INTO adventure_runs(event_id,character_id,progress,flags) VALUES($1,$2,'{}','{\"original\":true}')", [event.id, characters[name].id]);
    const id = randomUUID(), text = name === "one" ? secretOne : secretTwo;
    await pool.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,type) VALUES($1,$2,$3,'relic','relic:exam:examine',$4,$5,'relic')", [id, event.id, characters[name].id, `Known clue ${name}`, text]); readings[name] = id;
  }
  const definition = { ...defaultAdventure(), nodes: [defaultAdventureNode("relic", "relic", code), defaultAdventureNode("dead_drop", "restricted", "BBBBBBBBBBBBBBBBBBBB")] };
  await pool.query("INSERT INTO event_adventures(event_id,definition) VALUES($1,$2)", [event.id, JSON.stringify(definition)]);
  await pool.query("INSERT INTO event_sharing_settings(event_id,policies) VALUES($1,'{\"relic\":\"shareable\",\"restricted\":\"restricted\"}')", [event.id]);
  readings.restricted = randomUUID(); await pool.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,type) VALUES($1,$2,$3,'restricted','restricted:success','Restricted clue','PRIVATE restricted reading','dead_drop')", [readings.restricted, event.id, characters.one.id]);
  return { event, characters, readings };
}
async function create(f, who = "one") { return ok(await request(base(f), "POST", bodyFor(f, who), users[who]), 201).exchange; }
async function join(f, exchange, who = "two") { return ok(await request(`${base(f)}/join`, "POST", bodyFor(f, who, { code: exchange.code }), users[who])).exchange; }
async function view(f, exchange, who = "one") { return ok(await request(`${base(f)}/${exchange.id}?characterId=${f.characters[who].id}`, "GET", undefined, users[who])).exchange; }
async function offer(f, exchange, who, ids) { return ok(await request(`${base(f)}/${exchange.id}/offer`, "PUT", bodyFor(f, who, { version: exchange.version, readingIds: ids }), users[who])).exchange; }
async function confirm(f, exchange, who) { return ok(await request(`${base(f)}/${exchange.id}/confirm`, "POST", bodyFor(f, who, { version: exchange.version }), users[who])).exchange; }
function noPrivate(value) { const text = JSON.stringify(value); for (const denied of [secretOne, secretTwo, "PRIVATE character objective", "Private inventory", "password_hash", "user_id", users.one.email, users.two.email]) assert.ok(!text.includes(denied), `Private content leaked: ${denied}`); }
async function completePair(f, giveOne = [], giveTwo = []) {
  let exchange = await join(f, await create(f)); exchange = await offer(f, exchange, "one", giveOne); exchange = await offer(f, exchange, "two", giveTwo); exchange = await confirm(f, exchange, "one"); return await confirm(f, exchange, "two");
}
before(async () => {
  database = await testDatabase(); pool = database.pool; await migrate(pool);
  let handler; server = createServer((req, res) => handler(req, res)); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  handler = createApp({ pool, config: { ...readConfig({ DATABASE_URL: "postgres://unused", PORT: "3000" }), origin }, logger: (entry) => console.error(entry) });
  for (const name of ["owner", "one", "two", "third", "outsider"]) { const result = await request("/api/auth/register", "POST", { displayName: `Exchange ${name}`, email: `${name}@exchange.example.test`, password: pass }, null); users[name] = { ...ok(result, 201).user, cookie: result.cookie }; }
  console.log(`Exchange integration database: ${database.kind}`);
});
after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); if (database) await database.close(); });

test("exchange requests strictly allow identifiers and reject prototype actions or forged content", () => {
  const payload = { requestId: randomUUID(), characterId: randomUUID(), version: 1, readingIds: [randomUUID()] };
  assert.deepEqual(validateExchangeRequest(payload, "offer"), payload);
  for (const action of ["constructor", "toString", "__proto__", "anything"]) assert.throws(() => validateExchangeRequest({}, action), { status: 400 });
  for (const mutate of [(p) => { p.text = secretOne; }, (p) => { p.version = "1"; }, (p) => { p.readingIds.push(p.readingIds[0]); }, (p) => { p.readingIds = ["not-a-uuid"]; }, (p) => { p.requestId = "bad"; }]) { const copy = structuredClone(payload); mutate(copy); assert.throws(() => validateExchangeRequest(copy, "offer"), { status: 400 }); }
});

test("a zero-reading introduction requires two independent confirmations and creates bilateral contacts/receipts", async () => {
  const f = await fixture(); let exchange = await create(f); assert.equal(exchange.version, 1); assert.equal(exchange.status, "waiting"); assert.match(exchange.code, /^[A-HJ-NP-Z2-9]{12}$/);
  const expiresAt = exchange.expiresAt; exchange = await join(f, exchange); assert.equal(exchange.version, 2); assert.equal(exchange.code, null); assert.equal(exchange.status, "negotiating");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM exchange_contacts WHERE event_id=$1", [f.event.id])).rows[0].n, 0);
  exchange = await confirm(f, exchange, "one"); assert.equal(exchange.version, 2); assert.equal(exchange.status, "negotiating"); assert.equal(exchange.own.confirmed, true); assert.equal(exchange.receipt, null); noPrivate(exchange);
  exchange = await confirm(f, exchange, "two"); assert.equal(exchange.status, "completed"); assert.equal(exchange.expiresAt, expiresAt); assert.equal(exchange.receipt.introduced, true); assert.deepEqual(exchange.receipt.sent, []); assert.deepEqual(exchange.receipt.received, []);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM exchange_contacts WHERE event_id=$1", [f.event.id])).rows[0].n, 2);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM adventure_journal WHERE event_id=$1 AND type='exchange_receipt'", [f.event.id])).rows[0].n, 2);
  const contacts = ok(await request(`${base(f)}?characterId=${f.characters.one.id}`, "GET", undefined, users.one)).contacts; assert.equal(contacts.length, 1); assert.equal(contacts[0].character.id, f.characters.two.id); noPrivate(contacts);
});

test("two-way selected readings remain private until completion and never alter inventory or story progress", async () => {
  const f = await fixture();
  const beforeRuns = (await pool.query("SELECT * FROM adventure_runs WHERE event_id=$1 ORDER BY character_id", [f.event.id])).rows;
  const beforeInventory = (await pool.query("SELECT * FROM character_inventory WHERE event_id=$1 ORDER BY id", [f.event.id])).rows;
  let exchange = await join(f, await create(f)); exchange = await offer(f, exchange, "one", [f.readings.one]); exchange = await offer(f, exchange, "two", [f.readings.two]); noPrivate(exchange); assert.deepEqual(exchange.partner.offered, [{ id: f.readings.one, title: "Known clue one", type: "relic" }]);
  exchange = await confirm(f, exchange, "one"); noPrivate(await view(f, exchange, "two"));
  exchange = await confirm(f, exchange, "two"); assert.equal(exchange.receipt.received[0].text, secretOne); assert.equal(exchange.receipt.received[0].alreadyKnown, false);
  const first = await view(f, exchange); assert.equal(first.receipt.received[0].text, secretTwo); assert.equal(first.receipt.received[0].type, "shared_reading");
  assert.deepEqual((await pool.query("SELECT * FROM adventure_runs WHERE event_id=$1 ORDER BY character_id", [f.event.id])).rows, beforeRuns);
  assert.deepEqual((await pool.query("SELECT * FROM character_inventory WHERE event_id=$1 ORDER BY id", [f.event.id])).rows, beforeInventory);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM exchange_copies WHERE event_id=$1", [f.event.id])).rows[0].n, 2);
  const audit = (await pool.query("SELECT details FROM audit_entries WHERE event_id=$1", [f.event.id])).rows; noPrivate(audit);
});

test("offer changes reset both confirmations while no-op changes preserve consent and deadline", async () => {
  const f = await fixture(); let exchange = await create(f); exchange = await offer(f, exchange, "one", [f.readings.one]); const deadline = exchange.expiresAt;
  exchange = await join(f, exchange); exchange = await confirm(f, exchange, "one"); const version = exchange.version;
  const noChange = await offer(f, exchange, "one", [f.readings.one]); assert.equal(noChange.version, version); assert.equal(noChange.own.confirmed, true);
  exchange = await offer(f, noChange, "two", [f.readings.two]); assert.equal(exchange.version, version + 1); assert.equal(exchange.own.confirmed, false); assert.equal(exchange.partner.confirmed, false); assert.equal(exchange.expiresAt, deadline);
  assert.equal((await request(`${base(f)}/${exchange.id}/confirm`, "POST", bodyFor(f, "one", { version }), users.one)).status, 409);
  assert.equal((await request(`${base(f)}/${exchange.id}/offer`, "PUT", bodyFor(f, "one", { version: exchange.version, readingIds: [f.readings.restricted] }), users.one)).status, 403);
});

test("request retries return fresh state and committed receipts without duplicate transfers", async () => {
  const f = await fixture(); const creation = bodyFor(f, "one");
  let exchange = ok(await request(base(f), "POST", creation, users.one), 201).exchange;
  assert.equal(ok(await request(base(f), "POST", creation, users.one)).outcome.replayed, true);
  exchange = await join(f, exchange); exchange = await offer(f, exchange, "one", [f.readings.one]);
  const firstConfirmation = bodyFor(f, "one", { version: exchange.version }); exchange = ok(await request(`${base(f)}/${exchange.id}/confirm`, "POST", firstConfirmation, users.one)).exchange;
  exchange = await offer(f, exchange, "two", [f.readings.two]);
  const replayed = ok(await request(`${base(f)}/${exchange.id}/confirm`, "POST", firstConfirmation, users.one)); assert.equal(replayed.outcome.replayed, true); assert.equal(replayed.exchange.own.confirmed, false); assert.equal(replayed.exchange.version, exchange.version);
  assert.equal((await request(`${base(f)}/${exchange.id}/confirm`, "POST", { ...firstConfirmation, version: exchange.version }, users.one)).status, 409);
  exchange = await confirm(f, exchange, "one"); const finalBody = bodyFor(f, "two", { version: exchange.version });
  const complete = ok(await request(`${base(f)}/${exchange.id}/confirm`, "POST", finalBody, users.two)); const duplicate = ok(await request(`${base(f)}/${exchange.id}/confirm`, "POST", finalBody, users.two)); assert.equal(duplicate.outcome.replayed, true); assert.deepEqual(duplicate.exchange.receipt, complete.exchange.receipt);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM exchange_copies WHERE event_id=$1", [f.event.id])).rows[0].n, 2);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM exchange_receipts WHERE event_id=$1", [f.event.id])).rows[0].n, 2);
});

test("third parties, same accounts, cross-event IDs and forged offers cannot access or control an exchange", async () => {
  const f = await fixture(), second = await fixture(); const exchange = await create(f);
  assert.equal((await request(`${base(f)}/join`, "POST", bodyFor(f, "one", { code: exchange.code }), users.one)).status, 409);
  assert.equal((await request(`${base(f)}/${exchange.id}?characterId=${f.characters.third.id}`, "GET", undefined, users.third)).status, 404);
  assert.equal((await request(`${base(f)}/${exchange.id}?characterId=${f.characters.one.id}`, "GET", undefined, users.owner)).status, 404);
  assert.equal((await request(`${base(second)}/${exchange.id}?characterId=${second.characters.one.id}`, "GET", undefined, users.one)).status, 404);
  assert.equal((await request(`${base(f)}/${exchange.id}/offer`, "PUT", bodyFor(f, "one", { version: exchange.version, readingIds: [f.readings.two] }), users.one)).status, 404);
  assert.equal((await request(`${base(f)}/${exchange.id}/offer`, "PUT", { ...bodyFor(f, "one", { version: exchange.version, readingIds: [] }), text: "forged" }, users.one)).status, 400);
  await join(f, exchange); assert.equal((await request(`${base(f)}/join`, "POST", bodyFor(f, "third", { code: exchange.code }), users.third)).status, 404);
});

test("canonical provenance deduplicates repeated sharing and a reading returning to its origin", async () => {
  const f = await fixture(); const first = await completePair(f, [f.readings.one], []); const copiedId = first.receipt.received[0].id;
  const second = await completePair(f, [f.readings.one], [copiedId]);
  assert.equal(second.receipt.received[0].alreadyKnown, true); const original = await view(f, second, "one"); assert.equal(original.receipt.received[0].alreadyKnown, true); assert.equal(original.receipt.received[0].id, f.readings.one);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM exchange_copies WHERE event_id=$1", [f.event.id])).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM exchange_contacts WHERE event_id=$1", [f.event.id])).rows[0].n, 2);
  const receiptId = (await pool.query("SELECT id FROM adventure_journal WHERE event_id=$1 AND character_id=$2 AND type='exchange_receipt' LIMIT 1", [f.event.id, f.characters.one.id])).rows[0].id;
  const pending = await create(f); assert.equal((await request(`${base(f)}/${pending.id}/offer`, "PUT", bodyFor(f, "one", { version: pending.version, readingIds: [receiptId] }), users.one)).status, 403);
});

test("expiry, pause, cancellation, rejection and reconnect use authoritative current state", async () => {
  const f = await fixture(); let exchange = await join(f, await create(f));
  const ownBody = bodyFor(f, "one", { version: exchange.version }); exchange = ok(await request(`${base(f)}/${exchange.id}/confirm`, "POST", ownBody, users.one)).exchange;
  await pool.query("UPDATE events SET status='paused' WHERE id=$1", [f.event.id]);
  assert.equal((await request(`${base(f)}/${exchange.id}/confirm`, "POST", ownBody, users.one)).status, 409);
  const paused = await view(f, exchange); assert.equal(paused.readOnly, true); assert.equal(paused.canCancel, true);
  exchange = ok(await request(`${base(f)}/${exchange.id}/cancel`, "POST", bodyFor(f, "one", { version: exchange.version }), users.one)).exchange; assert.equal(exchange.status, "cancelled");
  await pool.query("UPDATE events SET status='rehearsal' WHERE id=$1", [f.event.id]); exchange = await join(f, await create(f));
  assert.equal((await view(f, exchange, "one")).canReject, false); assert.equal((await view(f, exchange, "two")).canReject, true);
  assert.equal(ok(await request(`${base(f)}/${exchange.id}/reject`, "POST", bodyFor(f, "two", { version: exchange.version }), users.two)).exchange.status, "rejected");
  exchange = await join(f, await create(f)); await pool.query("UPDATE exchange_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [exchange.id]);
  assert.equal((await view(f, exchange)).status, "expired"); assert.equal((await request(`${base(f)}/${exchange.id}/confirm`, "POST", bodyFor(f, "one", { version: exchange.version }), users.one)).status, 409);
  const login = await request("/api/auth/login", "POST", { email: users.one.email, password: pass }, null); users.one.cookie = login.cookie; assert.equal((await view(f, exchange)).status, "expired");
});

test("completed history survives peer departure but ownership transfer denies the former account", async () => {
  const f = await fixture(); const exchange = await completePair(f, [f.readings.one], [f.readings.two]);
  await pool.query("UPDATE exchange_sessions SET expires_at=clock_timestamp()-interval '1 day' WHERE id=$1", [exchange.id]);
  await pool.query("DELETE FROM memberships WHERE event_id=$1 AND user_id=$2", [f.event.id, users.two.id]);
  const historical = await view(f, exchange); assert.equal(historical.status, "completed"); assert.equal(historical.partner, null); assert.equal(historical.receipt.received[0].text, secretTwo);
  const overview = ok(await request(`${base(f)}?characterId=${f.characters.one.id}`, "GET", undefined, users.one)); assert.equal(overview.contacts[0].character, null); noPrivate(overview.sessions);
  await pool.query("UPDATE characters SET user_id=$2 WHERE id=$1", [f.characters.one.id, users.third.id]);
  const removed = await request(`${base(f)}/${exchange.id}?characterId=${f.characters.one.id}`, "GET", undefined, users.one); assert.equal(removed.status, 404); assert.equal(removed.data.error, "Character not found or not assigned to you.");
  assert.equal((await request(`${base(f)}/${exchange.id}?characterId=${f.characters.one.id}`, "GET", undefined, users.third)).status, 404);
});

test("policy changes and final confirmation serialize without partial copies", async () => {
  const f = await fixture(); let exchange = await join(f, await create(f)); exchange = await offer(f, exchange, "one", [f.readings.one]); exchange = await confirm(f, exchange, "one");
  const policy = { version: 1, policies: [{ nodeId: "relic", policy: "restricted" }, { nodeId: "restricted", policy: "restricted" }] };
  const results = await Promise.all([request(`/api/events/${f.event.id}/sharing`, "PUT", policy), request(`${base(f)}/${exchange.id}/confirm`, "POST", bodyFor(f, "two", { version: exchange.version }), users.two)]);
  assert.equal(results[0].status, 200); assert.ok([200, 409].includes(results[1].status));
  const state = await view(f, exchange); const copies = (await pool.query("SELECT count(*)::int AS n FROM exchange_copies WHERE event_id=$1", [f.event.id])).rows[0].n;
  assert.equal(copies, state.status === "completed" ? 1 : 0);
  if (state.status !== "completed") { assert.equal(state.own.confirmed, false); assert.equal(state.partner.confirmed, false); assert.ok(state.blockedReason); }
});

test("simultaneous final confirmations and cancellation never create partial completion", async () => {
  const f = await fixture(); let exchange = await join(f, await create(f)); exchange = await offer(f, exchange, "one", [f.readings.one]); exchange = await confirm(f, exchange, "one");
  const results = await Promise.all([request(`${base(f)}/${exchange.id}/confirm`, "POST", bodyFor(f, "two", { version: exchange.version }), users.two), request(`${base(f)}/${exchange.id}/cancel`, "POST", bodyFor(f, "one", { version: exchange.version }), users.one)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const state = await view(f, exchange); assert.ok(["completed", "cancelled"].includes(state.status));
  const totals = (await pool.query("SELECT (SELECT count(*) FROM exchange_receipts WHERE event_id=$1)::int AS receipts,(SELECT count(*) FROM exchange_copies WHERE event_id=$1)::int AS copies", [f.event.id])).rows[0];
  assert.deepEqual(totals, state.status === "completed" ? { receipts: 2, copies: 1 } : { receipts: 0, copies: 0 });
});

test("active invitation limit and invalid-code throttling cannot be bypassed by transaction rollback", async () => {
  const f = await fixture(); const active = [];
  for (let n = 0; n < 5; n++) active.push(await create(f));
  assert.equal((await request(base(f), "POST", bodyFor(f, "one"), users.one)).status, 429);
  ok(await request(`${base(f)}/${active[0].id}/cancel`, "POST", bodyFor(f, "one", { version: 1 }), users.one)); await create(f);
  for (let n = 0; n < 30; n++) assert.equal((await request(`${base(f)}/join`, "POST", bodyFor(f, "third", { code: "ZZZZZZZZZZZZ" }), users.third)).status, 404);
  assert.equal((await request(`${base(f)}/join`, "POST", bodyFor(f, "third", { code: "ZZZZZZZZZZZZ" }), users.third)).status, 429);
  assert.equal((await request(`/api/events/${f.event.id.toUpperCase()}/exchanges/join`, "POST", bodyFor(f, "third", { code: "ZZZZZZZZZZZZ" }), users.third)).status, 429);
});

test("admin disable while a final confirmation waits cannot deadlock or share with a disabled peer", { timeout: 20000 }, async (t) => {
  if (!process.env.TEST_DATABASE_URL) return t.skip("Real PostgreSQL connections are required for a forced row-lock ordering test.");
  const f = await fixture();
  const adminName = users.one.id < users.two.id ? "one" : "two", targetName = adminName === "one" ? "two" : "one";
  await pool.query("UPDATE users SET is_superuser=true WHERE id=$1", [users[adminName].id]);
  let exchange = await join(f, await create(f)); exchange = await offer(f, exchange, "one", [f.readings.one]); exchange = await confirm(f, exchange, targetName);
  const blocker = await pool.connect();
  try {
    await blocker.query("BEGIN"); await blocker.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [users[targetName].id]);
    const pendingConfirm = request(`${base(f)}/${exchange.id}/confirm`, "POST", bodyFor(f, adminName, { version: exchange.version }), users[adminName]);
    // Wait until the HTTP transaction is waiting for our row lock. The lower
    // UUID superuser share lock must stay compatible with this audit FK read.
    const deadline = Date.now() + 5000; let waiting = false;
    while (Date.now() < deadline) { await blocker.query("SELECT pg_stat_clear_snapshot()"); const rows = (await blocker.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM users WHERE id=ANY%' AND pid<>pg_backend_pid()" )).rows; if (rows.length) { waiting = true; break; } await new Promise((resolve) => setTimeout(resolve, 20)); }
    assert.equal(waiting, true, "The final confirmation should wait for the disabled user's lock.");
    await blocker.query("UPDATE users SET is_disabled=true WHERE id=$1", [users[targetName].id]);
    await blocker.query("INSERT INTO system_audit_entries(actor_id,target_user_id,action,details) VALUES($1,$2,'user.disabled','{}')", [users[adminName].id, users[targetName].id]);
    await blocker.query("COMMIT");
    assert.equal((await pendingConfirm).status, 409);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM exchange_copies WHERE event_id=$1", [f.event.id])).rows[0].n, 0);
  } finally { await blocker.query("ROLLBACK").catch(() => {}); blocker.release(); await pool.query("UPDATE users SET is_disabled=false,is_superuser=false WHERE id=ANY($1::uuid[])", [[users.one.id, users.two.id]]); }
});

async function tradeFixture() {
  const f = await fixture();
  await pool.query("UPDATE events SET setup=jsonb_set(setup,'{enabledInstruments}','[\"briefing\",\"relic\",\"dead-drop\",\"bazaar\"]') WHERE id=$1", [f.event.id]);
  await pool.query("INSERT INTO economy_resources(event_id,id,name) VALUES($1,'crowns','Crowns')", [f.event.id]);
  for (const who of ['one', 'two']) await pool.query("INSERT INTO economy_balances(event_id,character_id,resource_id,quantity) VALUES($1,$2,'crowns',20)", [f.event.id, f.characters[who].id]);
  f.item = (await pool.query('SELECT id,name,quantity,version FROM character_inventory WHERE event_id=$1 AND character_id=$2', [f.event.id, f.characters.one.id])).rows[0];
  return f;
}
async function assetOffer(f, exchange, who, assets, readings = []) {
  return ok(await request(`${base(f)}/${exchange.id}/offer`, 'PUT', bodyFor(f, who, { version: exchange.version, readingIds: readings, items: assets.items || [], resources: assets.resources || [] }), users[who])).exchange;
}

test('QR trade terms bind item versions and both consents, transfer atomically, and preserve immutable receipts after source consumption', async () => {
  const f = await tradeFixture();
  let exchange = await join(f, await create(f));
  const assets = { items: [{ itemId: f.item.id, quantity: 1, version: 1 }], resources: [{ resourceId: 'crowns', quantity: 3 }] };
  exchange = await assetOffer(f, exchange, 'one', assets, [f.readings.one]);
  exchange = await assetOffer(f, exchange, 'two', { resources: [{ resourceId: 'crowns', quantity: 7 }] });
  assert.deepEqual(exchange.partner.assets.items, [{ itemId: f.item.id, name: f.item.name, quantity: 1, version: 1 }]); noPrivate(exchange);
  exchange = await confirm(f, exchange, 'one'); const version = exchange.version;
  exchange = await assetOffer(f, exchange, 'one', assets, [f.readings.one]); assert.equal(exchange.version, version); assert.equal(exchange.own.confirmed, true);
  await pool.query('UPDATE character_inventory SET version=version+1 WHERE id=$1', [f.item.id]);
  assert.equal((await request(`${base(f)}/${exchange.id}/confirm`, 'POST', bodyFor(f, 'two', { version }), users.two)).status, 409);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM exchange_copies WHERE event_id=$1', [f.event.id])).rows[0].n, 0);
  exchange = await assetOffer(f, exchange, 'one', { ...assets, items: [{ ...assets.items[0], version: 2 }] }, [f.readings.one]); assert.equal(exchange.version, version + 1); assert.equal(exchange.own.confirmed, false); assert.equal(exchange.partner.confirmed, false);
  exchange = await confirm(f, exchange, 'one'); const finalInput = bodyFor(f, 'two', { version: exchange.version });
  const completed = ok(await request(`${base(f)}/${exchange.id}/confirm`, 'POST', finalInput, users.two)); assert.equal(completed.exchange.status, 'completed'); assert.equal(completed.exchange.receipt.received[0].text, secretOne); assert.equal(completed.exchange.receipt.assets.received.items[0].quantity, 1);
  assert.ok(completed.exchange.receipt.assets.transactionId); const replay = ok(await request(`${base(f)}/${exchange.id}/confirm`, 'POST', finalInput, users.two)); assert.equal(replay.outcome.replayed, true); assert.equal(replay.exchange.receipt.assets.transactionId, completed.exchange.receipt.assets.transactionId);
  const sender = await view(f, exchange, 'one'); assert.equal(sender.own.assets.valid, true); assert.equal(sender.receipt.assets.sent.items[0].name, f.item.name); assert.equal(sender.blockedReason, null);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM economy_transactions WHERE event_id=$1', [f.event.id])).rows[0].n, 1);
  assert.equal((await pool.query('SELECT quantity FROM economy_balances WHERE event_id=$1 AND character_id=$2', [f.event.id, f.characters.one.id])).rows[0].quantity, 24);
  assert.equal((await pool.query('SELECT quantity FROM economy_balances WHERE event_id=$1 AND character_id=$2', [f.event.id, f.characters.two.id])).rows[0].quantity, 16);
  assert.equal((await pool.query('SELECT id FROM character_inventory WHERE id=$1', [f.item.id])).rows.length, 0);
  const recipientItem = (await pool.query("SELECT * FROM character_inventory WHERE event_id=$1 AND character_id=$2 AND notes=''", [f.event.id, f.characters.two.id])).rows[0]; assert.equal(recipientItem.quantity, 1); assert.equal(recipientItem.notes, '');
});

test('last-leg inventory capacity failure rolls back every reading, balance, item, receipt and final assent', async () => {
  const f = await tradeFixture();
  await pool.query("UPDATE character_inventory SET name='Unique offered item' WHERE id=$1", [f.item.id]);
  for (let i = 0; i < 99; i++) await pool.query('INSERT INTO character_inventory(id,event_id,character_id,name,quantity,notes) VALUES($1,$2,$3,$4,1,\'\')', [randomUUID(), f.event.id, f.characters.two.id, `Occupied slot ${i}`]);
  let exchange = await join(f, await create(f)); exchange = await assetOffer(f, exchange, 'one', { items: [{ itemId: f.item.id, quantity: 1, version: 1 }], resources: [{ resourceId: 'crowns', quantity: 3 }] }, [f.readings.one]); exchange = await confirm(f, exchange, 'one');
  const snapshot = async () => ({ inventory: (await pool.query('SELECT * FROM character_inventory WHERE event_id=$1 ORDER BY id', [f.event.id])).rows, balances: (await pool.query('SELECT * FROM economy_balances WHERE event_id=$1 ORDER BY character_id', [f.event.id])).rows, journal: (await pool.query('SELECT * FROM adventure_journal WHERE event_id=$1 ORDER BY id', [f.event.id])).rows });
  const before = await snapshot();
  assert.equal((await request(`${base(f)}/${exchange.id}/confirm`, 'POST', bodyFor(f, 'two', { version: exchange.version }), users.two)).status, 409);
  assert.deepEqual(await snapshot(), before);
  for (const table of ['economy_transactions', 'exchange_receipts', 'exchange_copies']) assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE event_id=$1`, [f.event.id])).rows[0].n, 0);
  const current = await view(f, exchange, 'two'); assert.equal(current.status, 'negotiating'); assert.equal(current.own.confirmed, false); assert.equal(current.partner.confirmed, true);
  await pool.query("UPDATE events SET setup=jsonb_set(setup,'{enabledInstruments}','[\"briefing\",\"relic\",\"dead-drop\"]') WHERE id=$1", [f.event.id]);
  assert.equal((await request(`${base(f)}/${exchange.id}/confirm`, 'POST', bodyFor(f, 'two', { version: exchange.version }), users.two)).status, 409);
  exchange = await assetOffer(f, exchange, 'one', {}, [f.readings.one]); exchange = await confirm(f, exchange, 'one'); exchange = await confirm(f, exchange, 'two'); assert.equal(exchange.status, 'completed'); assert.equal(exchange.receipt.assets.transactionId, null);
});
