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

let database, pool, server, origin;
const users = {};
const password = "Economy contention integration passphrase";

async function request(path, method = "GET", data, who = users.owner) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(method !== "GET" ? { "Content-Type": "application/json", Origin: origin } : {}),
      ...(who?.cookie ? { Cookie: who.cookie } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const raw = await response.text();
  return {
    status: response.status,
    data: raw ? JSON.parse(raw) : null,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
function ok(response, status = 200) {
  assert.equal(response.status, status, JSON.stringify(response.data));
  return response.data;
}
const bazaar = (f) => `/api/events/${f.event.id}/bazaar`;
const exchanges = (f) => `/api/events/${f.event.id}/exchanges`;
const command = (f, who, value = {}) => ({ requestId: randomUUID(), characterId: f.characters[who].id, ...value });
async function assets(f, who) {
  return ok(await request(`${bazaar(f)}?characterId=${f.characters[who].id}`, "GET", undefined, users[who]));
}
function balance(value) {
  return value.balances.find((row) => row.resourceId === "credits")?.quantity ?? 0;
}

async function fixture() {
  const setup = defaultSetup();
  setup.enabledInstruments = ["briefing", "relic", "bazaar", "oathbook"];
  const event = ok(await request("/api/events", "POST", { name: "Atomic economy contention", setup }), 201).event;
  await pool.query("UPDATE events SET status='rehearsal' WHERE id=$1", [event.id]);
  const characters = {}, readings = {};
  for (const name of ["donor", "one", "two"]) {
    await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'player')", [event.id, users[name].id]);
    const profile = { ...defaultCharacterProfile(setup.rules), name: `Trader ${name}` };
    characters[name] = ok(await request(`/api/events/${event.id}/characters`, "POST", { profile }, users[name]), 201).character;
    await pool.query("UPDATE characters SET status='approved',inventory_initialized=true WHERE id=$1", [characters[name].id]);
    readings[name] = randomUUID();
    await pool.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,type) VALUES($1,$2,$3,'relic','relic:examine',$4,$5,'relic')", [readings[name], event.id, characters[name].id, `Clue ${name}`, `PRIVATE ${name} reading`]);
  }
  const definition = { ...defaultAdventure(), nodes: [defaultAdventureNode("relic", "relic", "AAAAAAAAAAAAAAAAAAAA")] };
  await pool.query("INSERT INTO event_adventures(event_id,definition) VALUES($1,$2)", [event.id, JSON.stringify(definition)]);
  await pool.query("INSERT INTO event_sharing_settings(event_id,policies) VALUES($1,'{\"relic\":\"shareable\"}')", [event.id]);
  const f = { event, characters, readings };
  ok(await request(`${bazaar(f)}/resources`, "POST", { requestId: randomUUID(), id: "credits", name: "Credits" }), 201);
  for (const name of ["donor", "one", "two"]) {
    ok(await request(`${bazaar(f)}/adjust`, "POST", { ...command(f, name), resourceId: "credits", quantity: 100, version: 0, reason: "Contention fixture opening balance" }));
  }
  return f;
}

// Hold the shared event mutex until both HTTP commands are demonstrably waiting
// on different TCP connections. Snapshot refresh is necessary inside this open
// observer transaction; otherwise PostgreSQL can keep its first activity view.
async function contend(eventId, operations) {
  const blocker = await pool.connect();
  let pending = [], observed = false;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM events WHERE id=$1 FOR UPDATE", [eventId]);
    pending = operations.map((operation) => operation());
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await blocker.query("SELECT pg_stat_clear_snapshot()");
      const waiting = (await blocker.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM events WHERE id=$1 FOR UPDATE%' AND pid<>pg_backend_pid()")).rows;
      if (waiting.length >= operations.length) { observed = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await blocker.query("COMMIT");
    const results = await Promise.all(pending);
    assert.equal(observed, true, "Both independent HTTP commands must wait for the held event lock before the race starts.");
    return results;
  } finally {
    await blocker.query("ROLLBACK").catch(() => {});
    blocker.release();
    await Promise.allSettled(pending);
  }
}

before(async () => {
  if (!process.env.TEST_DATABASE_URL) return;
  database = await testDatabase(); pool = database.pool; await migrate(pool);
  let handler;
  server = createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  handler = createApp({ pool, config: { ...readConfig({ DATABASE_URL: "postgres://unused" }), origin }, logger: (entry) => console.error(entry) });
  for (const name of ["owner", "donor", "one", "two"]) {
    const result = await request("/api/auth/register", "POST", { displayName: `Contention ${name}`, email: `${name}@economy-contention.example.test`, password }, null);
    users[name] = { ...ok(result, 201).user, cookie: result.cookie };
  }
  console.log(`Economy contention database: ${database.kind}`);
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (database) await database.close();
});

test("forced TCP purchases of the last shop item produce one debit, delivery, receipt and retry result", { timeout: 25000 }, async (t) => {
  if (!process.env.TEST_DATABASE_URL) return t.skip("Independent PostgreSQL TCP connections are required to prove simultaneous purchase contention.");
  const f = await fixture();
  const shop = ok(await request(`${bazaar(f)}/shops`, "POST", { requestId: randomUUID(), name: "Last stock", description: "One item remains", enabled: true }), 201).shop;
  const stock = ok(await request(`${bazaar(f)}/shops/${shop.id}/stock`, "POST", { requestId: randomUUID(), name: "Unique crystal", description: "Public listing", quantity: 1, resourceId: "credits", unitPrice: 10 }), 201).stock;
  const buyers = ["one", "two"];
  const bodies = buyers.map((name) => command(f, name, { shopId: shop.id, stockId: stock.id, version: stock.version, quantity: 1 }));
  const receiptsBefore = ok(await request(`${bazaar(f)}/manage`)).receipts.length;
  const results = await contend(f.event.id, buyers.map((name, index) => () => request(`${bazaar(f)}/purchase`, "POST", bodies[index], users[name])));
  assert.deepEqual(results.map((row) => row.status).sort(), [200, 409]);
  const winner = results.findIndex((row) => row.status === 200), loser = 1 - winner;
  const after = await Promise.all(buyers.map((name) => assets(f, name)));
  assert.equal(balance(after[winner]), 90); assert.equal(balance(after[loser]), 100);
  assert.equal(after[winner].inventory.filter((row) => row.name === "Unique crystal").reduce((sum, row) => sum + row.quantity, 0), 1);
  assert.equal(after[loser].inventory.filter((row) => row.name === "Unique crystal").length, 0);
  assert.equal(after[winner].shops.find((row) => row.id === shop.id).stock.find((row) => row.id === stock.id).quantity, 0);
  const receipt = ok(results[winner]).receipt;
  const replay = ok(await request(`${bazaar(f)}/purchase`, "POST", bodies[winner], users[buyers[winner]]));
  assert.equal(replay.outcome.replayed, true); assert.deepEqual(replay.receipt, receipt);
  assert.equal(ok(await request(`${bazaar(f)}/manage`)).receipts.length, receiptsBefore + 1);
  assert.equal(balance(await assets(f, buyers[winner])), 90);
  assert.equal((await request(`${bazaar(f)}/purchase`, "POST", { ...bodies[winner], quantity: 2 }, users[buyers[winner]])).status, 409);
});

test("forced TCP final QR confirmations cannot spend one item twice or copy readings from the losing trade", { timeout: 25000 }, async (t) => {
  if (!process.env.TEST_DATABASE_URL) return t.skip("Independent PostgreSQL TCP connections are required to prove simultaneous final trade contention.");
  const f = await fixture();
  const itemId = randomUUID();
  await pool.query("INSERT INTO character_inventory(id,event_id,character_id,name,quantity,notes) VALUES($1,$2,$3,'Unique trade token',1,'SECRET source inventory note')", [itemId, f.event.id, f.characters.donor.id]);
  const buyers = ["one", "two"], sessions = [];
  for (const [index, buyer] of buyers.entries()) {
    let exchange = ok(await request(exchanges(f), "POST", command(f, "donor"), users.donor), 201).exchange;
    exchange = ok(await request(`${exchanges(f)}/join`, "POST", command(f, buyer, { code: exchange.code }), users[buyer])).exchange;
    exchange = ok(await request(`${exchanges(f)}/${exchange.id}/offer`, "PUT", command(f, "donor", { version: exchange.version, readingIds: [f.readings.donor], items: [{ itemId, quantity: 1, version: 1 }], resources: [] }), users.donor)).exchange;
    exchange = ok(await request(`${exchanges(f)}/${exchange.id}/offer`, "PUT", command(f, buyer, { version: exchange.version, readingIds: [f.readings[buyer]], items: [], resources: [{ resourceId: "credits", quantity: 5 + index * 2 }] }), users[buyer])).exchange;
    exchange = ok(await request(`${exchanges(f)}/${exchange.id}/confirm`, "POST", command(f, "donor", { version: exchange.version }), users.donor)).exchange;
    sessions.push(exchange);
  }
  const bodies = buyers.map((buyer, index) => command(f, buyer, { version: sessions[index].version }));
  const receiptsBefore = ok(await request(`${bazaar(f)}/manage`)).receipts.length;
  const results = await contend(f.event.id, buyers.map((buyer, index) => () => request(`${exchanges(f)}/${sessions[index].id}/confirm`, "POST", bodies[index], users[buyer])));
  assert.deepEqual(results.map((row) => row.status).sort(), [200, 409]);
  const winner = results.findIndex((row) => row.status === 200), loser = 1 - winner, price = 5 + winner * 2;
  const after = await Promise.all(["donor", ...buyers].map((name) => assets(f, name)));
  assert.equal(balance(after[0]), 100 + price);
  assert.equal(balance(after[winner + 1]), 100 - price); assert.equal(balance(after[loser + 1]), 100);
  assert.equal(after.reduce((sum, row) => sum + row.inventory.filter((item) => item.name === "Unique trade token").reduce((quantity, item) => quantity + item.quantity, 0), 0), 1);
  assert.equal(after[winner + 1].inventory.find((item) => item.name === "Unique trade token").quantity, 1);
  assert.equal(after[loser + 1].inventory.some((item) => item.name === "Unique trade token"), false);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM exchange_copies WHERE exchange_id=$1", [sessions[loser].id])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM exchange_receipts WHERE exchange_id=$1", [sessions[loser].id])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM adventure_journal WHERE event_id=$1 AND character_id=$2 AND type='exchange_receipt'", [f.event.id, f.characters[buyers[loser]].id])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM exchange_copies WHERE exchange_id=$1", [sessions[winner].id])).rows[0].n, 2);
  assert.equal(ok(await request(`${bazaar(f)}/manage`)).receipts.length, receiptsBefore + 1);
  const completed = ok(results[winner]).exchange;
  assert.equal(completed.status, "completed");
  assert.ok(!JSON.stringify(completed).includes("SECRET source inventory note"));
  const replay = ok(await request(`${exchanges(f)}/${sessions[winner].id}/confirm`, "POST", bodies[winner], users[buyers[winner]]));
  assert.equal(replay.outcome.replayed, true); assert.deepEqual(replay.exchange.receipt, completed.receipt);
  assert.equal(ok(await request(`${bazaar(f)}/manage`)).receipts.length, receiptsBefore + 1);
  assert.equal(balance(await assets(f, "donor")), 100 + price);
});
