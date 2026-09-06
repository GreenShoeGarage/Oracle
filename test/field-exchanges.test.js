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
import { digest } from "../src/security.js";
import { validateExchangeRequest } from "../public/exchange-model.js";

let database, pool, server, origin;
const users = {}, pass = "Exchange integration passphrase!";
const secretOne = "PRIVATE reading: the copper gate opens westward.", secretTwo = "PRIVATE reading: ask the lookout about the red lantern.";
const code = "AAAAAAAAAAAAAAAAAAAA";
async function request(path, method = "GET", data, who = users.owner, expectedAccount = who?.id) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(method !== "GET" ? { "Content-Type": "application/json", Origin: origin } : {}), ...(who?.cookie ? { Cookie: who.cookie } : {}), ...(expectedAccount !== null && expectedAccount !== undefined ? { "X-ORACLE-Expected-Account": expectedAccount } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  const raw = await response.text(); return { status: response.status, data: raw ? JSON.parse(raw) : null, cookie: response.headers.get("set-cookie")?.split(";")[0], account: response.headers.get("x-oracle-account") };
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
  for (const name of ["owner", "one", "two", "third", "outsider"]) { const result = await request("/api/auth/register", "POST", { displayName: `Exchange ${name}`, email: `${name}@field-exchange.example.test`, password: pass }, null); users[name] = { ...ok(result, 201).user, cookie: result.cookie }; }
  console.log(`Field exchange integration database: ${database.kind}`);
});
after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); if (database) await database.close(); });

test('information-only markers allow create, join and reading offers while rejecting every asset field and final confirmation', () => {
  for (const action of ['create', 'join', 'offer']) {
    const input = { requestId: randomUUID(), characterId: randomUUID(), informationOnly: true, ...(action === 'join' ? { code: 'A'.repeat(12) } : action === 'offer' ? { version: 1, readingIds: [randomUUID()] } : {}) };
    assert.equal(validateExchangeRequest(input, action).informationOnly, true);
    for (const marker of [false, 'true', 1, null]) assert.throws(() => validateExchangeRequest({ ...input, informationOnly: marker }, action), { status: 400 });
    for (const field of ['items', 'resources']) assert.throws(() => validateExchangeRequest({ ...input, [field]: [] }, action), { status: 400 });
  }
  for (const action of ['confirm', 'cancel', 'reject']) assert.throws(() => validateExchangeRequest({ requestId: randomUUID(), characterId: randomUUID(), version: 1, informationOnly: true }, action), { status: 400 });
});

test('expected-account guard rejects stale-cookie reads and writes before reassigned-character commands can execute', async () => {
  const f = await fixture(), input = bodyFor(f, 'one', { informationOnly: true });
  await pool.query('UPDATE characters SET user_id=$2 WHERE id=$1', [f.characters.one.id, users.two.id]);
  const sessionsBefore = (await pool.query('SELECT count(*)::int AS n FROM exchange_sessions WHERE event_id=$1', [f.event.id])).rows[0].n;
  const response = await request(base(f), 'POST', input, users.two, users.one.id);
  assert.equal(response.status, 409); assert.equal(response.account, users.two.id); assert.equal(response.data.exchange, undefined);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM exchange_sessions WHERE event_id=$1', [f.event.id])).rows[0].n, sessionsBefore);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM exchange_requests WHERE event_id=$1', [f.event.id])).rows[0].n, 0);
  const session = await request('/api/session', 'GET', undefined, users.two, users.one.id); assert.equal(session.status, 409); assert.equal(session.data.user, undefined);
  assert.equal((await request(`${base(f)}?characterId=${f.characters.one.id}`, 'GET', undefined, users.two, users.one.id)).status, 409);
  assert.equal((await request(base(f), 'POST', input, users.two, 'invalid-account')).status, 401);
  assert.equal((await request(base(f), 'POST', input, null, users.one.id)).status, 401);
  assert.equal((await request(base(f), 'POST', input, users.two, null)).status, 409, 'Information-only work requires the captured-account header.');
  assert.equal(ok(await request('/api/session', 'GET', undefined, users.two, users.two.id.toUpperCase())).user.id, users.two.id);
  const usersBefore = (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  assert.equal((await request('/api/auth/register', 'POST', { displayName: 'Must not create', email: 'no-side-effect@field-exchange.example.test', password: pass }, users.two, users.one.id)).status, 409);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n, usersBefore);
});

test('queued information commands replay exactly once without copying readings or changing inventory until live confirmations', async () => {
  const f = await fixture(), inventoryBefore = (await pool.query('SELECT * FROM character_inventory WHERE event_id=$1 ORDER BY id', [f.event.id])).rows;
  const createInput = bodyFor(f, 'one', { informationOnly: true });
  let exchange = ok(await request(base(f), 'POST', createInput, users.one), 201).exchange;
  assert.equal(ok(await request(base(f), 'POST', createInput, users.one)).outcome.replayed, true);
  const joinInput = bodyFor(f, 'two', { code: exchange.code, informationOnly: true });
  exchange = ok(await request(`${base(f)}/join`, 'POST', joinInput, users.two)).exchange;
  assert.equal(ok(await request(`${base(f)}/join`, 'POST', joinInput, users.two)).outcome.replayed, true);
  const offerInput = bodyFor(f, 'one', { version: exchange.version, readingIds: [f.readings.one], informationOnly: true });
  exchange = ok(await request(`${base(f)}/${exchange.id}/offer`, 'PUT', offerInput, users.one)).exchange;
  assert.equal(ok(await request(`${base(f)}/${exchange.id}/offer`, 'PUT', offerInput, users.one)).outcome.replayed, true);
  assert.equal((await request(`${base(f)}/${exchange.id}/offer`, 'PUT', { ...offerInput, readingIds: [] }, users.one)).status, 409);
  assert.equal((await request(`${base(f)}/${exchange.id}/confirm`, 'POST', bodyFor(f, 'one', { version: exchange.version, informationOnly: true }), users.one)).status, 400);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM exchange_contacts WHERE event_id=$1', [f.event.id])).rows[0].n, 0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM exchange_copies WHERE event_id=$1', [f.event.id])).rows[0].n, 0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM exchange_requests WHERE event_id=$1', [f.event.id])).rows[0].n, 3);
  exchange = await confirm(f, exchange, 'one'); exchange = await confirm(f, exchange, 'two'); assert.equal(exchange.status, 'completed');
  assert.equal(exchange.receipt.received[0].text, secretOne);
  assert.deepEqual((await pool.query('SELECT * FROM character_inventory WHERE event_id=$1 ORDER BY id', [f.event.id])).rows, inventoryBefore);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM economy_transactions WHERE event_id=$1', [f.event.id])).rows[0].n, 0);
});

test('saved information cannot join, replace or recover an exchange containing either side’s asset offer', async () => {
  const f = await fixture();
  await pool.query("UPDATE events SET setup=jsonb_set(setup,'{enabledInstruments}','[\"briefing\",\"relic\",\"dead-drop\",\"bazaar\"]') WHERE id=$1", [f.event.id]);
  let exchange = await create(f);
  const item = (await pool.query('SELECT * FROM character_inventory WHERE event_id=$1 AND character_id=$2', [f.event.id, f.characters.one.id])).rows[0];
  const trade = bodyFor(f, 'one', { version: exchange.version, readingIds: [], items: [{ itemId: item.id, quantity: 1, version: item.version }], resources: [] });
  exchange = ok(await request(`${base(f)}/${exchange.id}/offer`, 'PUT', trade, users.one)).exchange;
  const joinInput = bodyFor(f, 'two', { code: exchange.code, informationOnly: true });
  assert.equal((await request(`${base(f)}/join`, 'POST', joinInput, users.two)).status, 409);
  assert.equal((await pool.query('SELECT recipient_user_id FROM exchange_sessions WHERE id=$1', [exchange.id])).rows[0].recipient_user_id, null);
  exchange = await join(f, exchange);
  const before = (await pool.query('SELECT * FROM exchange_trade_offers WHERE event_id=$1 ORDER BY side', [f.event.id])).rows;
  for (const who of ['one', 'two']) {
    assert.equal((await request(`${base(f)}/${exchange.id}/offer`, 'PUT', bodyFor(f, who, { version: exchange.version, readingIds: [], informationOnly: true }), users[who])).status, 409);
  }
  assert.deepEqual((await pool.query('SELECT * FROM exchange_trade_offers WHERE event_id=$1 ORDER BY side', [f.event.id])).rows, before);
  assert.equal((await pool.query('SELECT quantity FROM character_inventory WHERE id=$1', [item.id])).rows[0].quantity, 1);
  const noAssets = await join(f, await create(f));
  const information = bodyFor(f, 'one', { version: noAssets.version, readingIds: [f.readings.one], informationOnly: true });
  let changed = ok(await request(`${base(f)}/${noAssets.id}/offer`, 'PUT', information, users.one)).exchange;
  changed = ok(await request(`${base(f)}/${changed.id}/offer`, 'PUT', { ...trade, requestId: randomUUID(), version: changed.version }, users.one)).exchange;
  assert.equal((await request(`${base(f)}/${changed.id}/offer`, 'PUT', information, users.one)).status, 409, 'A queued replay cannot silently recover a now asset-bearing trade.');
});

test('queued offer replay revalidates current sharing, version, event access and expired invitation state', async () => {
  const f = await fixture(); let exchange = await join(f, await create(f));
  const queued = bodyFor(f, 'one', { version: exchange.version, readingIds: [f.readings.one], informationOnly: true });
  exchange = await offer(f, exchange, 'two', [f.readings.two]);
  assert.equal((await request(`${base(f)}/${exchange.id}/offer`, 'PUT', queued, users.one)).status, 409);
  const current = { ...queued, requestId: randomUUID(), version: exchange.version };
  exchange = ok(await request(`${base(f)}/${exchange.id}/offer`, 'PUT', current, users.one)).exchange;
  await pool.query("UPDATE event_sharing_settings SET policies='{}',version=version+1 WHERE event_id=$1", [f.event.id]);
  assert.equal((await request(`${base(f)}/${exchange.id}/offer`, 'PUT', current, users.one)).status, 403);
  await pool.query("UPDATE event_sharing_settings SET policies='{\"relic\":\"shareable\"}',version=version+1 WHERE event_id=$1", [f.event.id]);
  await pool.query('DELETE FROM memberships WHERE event_id=$1 AND user_id=$2', [f.event.id, users.one.id]);
  assert.equal((await request(`${base(f)}/${exchange.id}/offer`, 'PUT', current, users.one)).status, 404);
  await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'player')", [f.event.id, users.one.id]);
  await pool.query("UPDATE exchange_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [exchange.id]);
  assert.equal((await request(`${base(f)}/${exchange.id}/offer`, 'PUT', current, users.one)).status, 409);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM exchange_copies WHERE event_id=$1', [f.event.id])).rows[0].n, 0);
});

test('expired authentication rejects queued work before mutation and exact recovery works after fresh same-account sign-in', async () => {
  const f = await fixture(), input = bodyFor(f, 'one', { informationOnly: true });
  await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1", [users.one.id]);
  assert.equal((await request(base(f), 'POST', input, users.one)).status, 401);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM exchange_sessions WHERE event_id=$1', [f.event.id])).rows[0].n, 0);
  const login = await request('/api/auth/login', 'POST', { email: users.one.email, password: pass }, null, null); ok(login); users.one.cookie = login.cookie;
  ok(await request(base(f), 'POST', input, users.one), 201);
  assert.equal(ok(await request(base(f), 'POST', input, users.one)).outcome.replayed, true);
});

test('committed join retries bypass exhausted code-guess limits while new failed lookups remain durably limited', async () => {
  const f = await fixture(), invitation = await create(f), input = bodyFor(f, 'two', { code: invitation.code, informationOnly: true });
  ok(await request(`${base(f)}/join`, 'POST', input, users.two));
  const slot = Math.floor(Date.now() / 900_000);
  for (const offset of [0, 1]) await pool.query('INSERT INTO rate_limits(key,attempts,expires_at) VALUES($1,30,$2) ON CONFLICT(key) DO UPDATE SET attempts=30,expires_at=EXCLUDED.expires_at', [digest(`${slot + offset}:exchange-join:${f.event.id}:${users.two.id}`), new Date((slot + offset + 1) * 900_000)]);
  assert.equal(ok(await request(`${base(f)}/join`, 'POST', input, users.two)).outcome.replayed, true);
  assert.equal((await request(`${base(f)}/join`, 'POST', { ...input, code: 'Z'.repeat(12) }, users.two)).status, 409, 'Reusing a known UUID for another code still fails its hash check.');
  assert.equal((await request(`${base(f)}/join`, 'POST', { ...input, requestId: randomUUID(), code: 'Z'.repeat(12) }, users.two)).status, 429);
  const bad = bodyFor(f, 'third', { code: 'Z'.repeat(12), informationOnly: true });
  assert.equal((await request(`${base(f)}/join`, 'POST', bad, users.third)).status, 404);
  assert.equal((await request(`${base(f)}/join`, 'POST', { ...bad, requestId: randomUUID() }, users.third)).status, 404);
  const limitRows = (await pool.query('SELECT attempts FROM rate_limits WHERE key=ANY($1::text[])', [[0, 1].map(offset => digest(`${slot + offset}:exchange-join:${f.event.id}:${users.third.id}`))])).rows;
  assert.equal(limitRows.reduce((sum, row) => sum + row.attempts, 0), 2, 'Rolled-back invalid joins must still consume their lookup allowance.');
});
