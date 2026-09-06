import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './database.js';
import { migrate } from '../src/db.js';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { defaultSetup } from '../public/kit.js';
import { defaultCharacterProfile } from '../public/characters-model.js';
import { defaultAdventure, defaultAdventureNode } from '../public/adventure-model.js';

let database, pool, server, origin;
const users = {};
const onlyTCP = 'Independent PostgreSQL TCP connections are required to prove simultaneous instrument contention.';
async function request(path, method = 'GET', data, who = users.manager) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...(who?.cookie ? { Cookie: who.cookie } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  const raw = await response.text();
  return { status: response.status, data: raw ? JSON.parse(raw) : null, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
function ok(response, status = 200) { assert.equal(response.status, status, JSON.stringify(response.data)); return response.data; }
const root = f => `/api/events/${f.event.id}`;
const command = (f, who, extra = {}) => ({ requestId: randomUUID(), characterId: f.characters[who].id, ...extra });
const checkpoint = (f, run, extra = {}) => command(f, 'host', { version: run.version, checkpointId: 'seal', roleId: 'keeper', answer: '', ...extra });
async function assets(f, who = 'host') { return ok(await request(`${root(f)}/bazaar?characterId=${f.characters[who].id}`, 'GET', undefined, users[who])); }
const quantity = value => value.balances.find(row => row.resourceId === 'sparks')?.quantity || 0;
const tokens = value => value.inventory.filter(row => row.name === 'Last sigil token').reduce((sum, row) => sum + row.quantity, 0);

async function fixture() {
  const setup = defaultSetup(); setup.enabledInstruments = ['briefing', 'relic', 'bazaar', 'sigil'];
  const event = ok(await request('/api/events', 'POST', { name: 'Shared instrument contention', setup }), 201).event;
  await pool.query("UPDATE events SET status='rehearsal' WHERE id=$1", [event.id]);
  const characters = {}, readings = {};
  for (const who of ['host', 'peer']) {
    await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'player')", [event.id, users[who].id]);
    characters[who] = ok(await request(`${root({ event })}/characters`, 'POST', { profile: { ...defaultCharacterProfile(setup.rules), name: `Instrument ${who}` } }, users[who]), 201).character;
    await pool.query("UPDATE characters SET status='approved',inventory_initialized=true WHERE id=$1", [characters[who].id]);
    readings[who] = randomUUID();
    await pool.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,type) VALUES($1,$2,$3,'relic','relic:examine',$4,$5,'relic')", [readings[who], event.id, characters[who].id, `Known ${who} clue`, `PRIVATE ${who} reading for the atomic trade`]);
    await pool.query("INSERT INTO adventure_runs(event_id,character_id,progress,flags) VALUES($1,$2,'{}','{}')", [event.id, characters[who].id]);
  }
  const definition = { ...defaultAdventure(), flags: [{ id: 'first-finished', name: 'First challenge complete' }, { id: 'second-finished', name: 'Second challenge complete' }, { id: 'challenge-failed', name: 'Challenge failed' }], nodes: [defaultAdventureNode('relic', 'relic', 'AAAAAAAAAAAAAAAAAAAA')] };
  await pool.query('INSERT INTO event_adventures(event_id,definition) VALUES($1,$2)', [event.id, JSON.stringify(definition)]);
  await pool.query("INSERT INTO event_sharing_settings(event_id,policies) VALUES($1,'{\"relic\":\"shareable\"}')", [event.id]);
  const f = { event, characters, readings, itemId: randomUUID() };
  await pool.query("INSERT INTO character_inventory(id,event_id,character_id,name,quantity,notes) VALUES($1,$2,$3,'Last sigil token',1,'SECRET inventory note')", [f.itemId, event.id, characters.host.id]);
  ok(await request(`${root(f)}/bazaar/resources`, 'POST', { requestId: randomUUID(), id: 'sparks', name: 'Sparks' }), 201);
  ok(await request(`${root(f)}/bazaar/adjust`, 'POST', { ...command(f, 'host'), resourceId: 'sparks', quantity: 5, version: 0, reason: 'Five sparks for the independent contention fixture' }));
  return f;
}
async function start(f, { flag = 'first-finished', consumeItem = true, consumeResource = true } = {}) {
  const document = {
    title: `Complete ${flag}`, summary: 'Use the last shared resources once.', organizerNotes: 'PRIVATE expected outcome note', durationSeconds: 3600,
    roles: [{ id: 'keeper', name: 'Keeper', instructions: 'Hold the seal together.' }],
    components: [
      { id: 'token', name: 'Last sigil token', kind: 'item', itemName: 'Last sigil token', resourceId: null, quantity: 1, consume: consumeItem },
      { id: 'sparks', name: 'Sparks', kind: 'resource', itemName: null, resourceId: 'sparks', quantity: 5, consume: consumeResource },
    ],
    checkpoints: [{ id: 'seal', title: 'Seal the working', instructions: 'Acknowledge the final seal.', roleId: 'keeper', minimumSeconds: 0, answer: null }],
    conditions: { completed: [], flags: [], skills: [], statuses: [] },
    success: { text: `The ${flag} working is complete.`, flags: [flag] }, failure: { text: 'The working ran out of time.', flags: ['challenge-failed'] },
  };
  let entry = ok(await request(`${root(f)}/sigil/entries`, 'POST', { requestId: randomUUID(), document }), 201).entry;
  entry = ok(await request(`${root(f)}/sigil/entries/${entry.id}/publish`, 'POST', { requestId: randomUUID(), version: entry.version })).entry;
  const input = command(f, 'host', { entryId: entry.id, publishedVersion: entry.publishedVersion, code: entry.code, roles: [{ roleId: 'keeper', performer: 'Host at the shared device' }], bindings: [{ componentId: 'token', itemId: f.itemId }] });
  const run = ok(await request(`${root(f)}/sigil/start`, 'POST', input, users.host), 201).run;
  assert.equal(run.status, 'running'); assert.ok(!JSON.stringify(run).includes('PRIVATE expected outcome note'));
  return { entry, run, input };
}
async function state(f) {
  const flags = (await pool.query('SELECT flags FROM adventure_runs WHERE event_id=$1 AND character_id=$2', [f.event.id, f.characters.host.id])).rows[0]?.flags || {};
  const outcomes = (await pool.query('SELECT * FROM sigil_outcomes WHERE event_id=$1 ORDER BY run_id', [f.event.id])).rows;
  const journals = (await pool.query("SELECT id,character_id,text FROM adventure_journal WHERE event_id=$1 AND type='sigil' ORDER BY id", [f.event.id])).rows;
  return { flags, outcomes, journals };
}

// The observer holds the same event mutex used by all authoritative mutations.
// Neither command starts until both independent TCP connections are waiting;
// refreshing PostgreSQL's cached statistics makes the observation meaningful.
async function contend(eventId, operations) {
  const blocker = await pool.connect(); let pending = [], observed = false;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM events WHERE id=$1 FOR UPDATE', [eventId]);
    pending = operations.map(operation => operation());
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await blocker.query('SELECT pg_stat_clear_snapshot()');
      const waiting = (await blocker.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM events WHERE id=$1 FOR UPDATE%' AND pid<>pg_backend_pid()")).rows;
      if (waiting.length >= operations.length) { observed = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await blocker.query('COMMIT');
    const results = await Promise.all(pending);
    assert.ok(observed, 'Both independent HTTP mutations must wait on the held event mutex.');
    return results;
  } finally {
    await blocker.query('ROLLBACK').catch(() => {}); blocker.release(); await Promise.allSettled(pending);
  }
}

before(async () => {
  if (!process.env.TEST_DATABASE_URL) return;
  database = await testDatabase(); pool = database.pool; await migrate(pool);
  let handler; server = createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  handler = createApp({ pool, config: { ...readConfig({ DATABASE_URL: 'postgres://unused' }), origin }, logger: entry => console.error(entry) });
  for (const name of ['manager', 'host', 'peer']) {
    const result = await request('/api/auth/register', 'POST', { displayName: `Instrument contention ${name}`, email: `${name}@instrument-contention.example.test`, password: 'Independent instrument contention passphrase' }, null);
    users[name] = { ...ok(result, 201).user, cookie: result.cookie };
  }
  console.log(`Instrument contention database: ${database.kind}`);
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); if (database) await database.close(); });

test('forced TCP duplicate final SIGIL request applies one component charge, flag and journal outcome', { timeout: 25000 }, async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip(onlyTCP);
  const f = await fixture(), challenge = await start(f), payload = checkpoint(f, challenge.run), path = `${root(f)}/sigil/runs/${challenge.run.id}/checkpoint`;
  const results = await contend(f.event.id, [() => request(path, 'POST', payload, users.host), () => request(path, 'POST', payload, users.host)]);
  assert.deepEqual(results.map(result => result.status), [200, 200]);
  const first = results.find(result => !result.data.outcome.replayed), replay = results.find(result => result.data.outcome.replayed);
  assert.ok(first); assert.ok(replay); assert.equal(first.data.run.status, 'succeeded'); assert.deepEqual(replay.data.run.result, first.data.run.result);
  const after = await assets(f), evidence = await state(f);
  assert.equal(tokens(after), 0); assert.equal(quantity(after), 0); assert.equal(evidence.outcomes.length, 1); assert.equal(evidence.journals.length, 1); assert.equal(evidence.flags['first-finished'], true);
  assert.ok(!JSON.stringify(first.data.run.result).includes('SECRET inventory note'));
  assert.equal((await request(path, 'POST', { ...payload, requestId: randomUUID(), version: first.data.run.version }, users.host)).status, 409);
  assert.equal((await request(`${root(f)}/sigil/start`, 'POST', { ...challenge.input, requestId: randomUUID() }, users.host)).status, 409);
  const unchanged = await state(f); assert.deepEqual(unchanged, evidence); assert.equal(quantity(await assets(f)), 0);
});

test('forced TCP competing SIGIL outcomes cannot consume one item and resource balance twice', { timeout: 25000 }, async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip(onlyTCP);
  const f = await fixture(), challenges = [await start(f), await start(f, { flag: 'second-finished' })];
  const payloads = challenges.map(({ run }) => checkpoint(f, run));
  const results = await contend(f.event.id, challenges.map(({ run }, index) => () => request(`${root(f)}/sigil/runs/${run.id}/checkpoint`, 'POST', payloads[index], users.host)));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const winner = results.findIndex(result => result.status === 200), loser = 1 - winner;
  const after = await assets(f), evidence = await state(f);
  assert.equal(tokens(after), 0); assert.equal(quantity(after), 0); assert.equal(evidence.outcomes.length, 1); assert.equal(evidence.journals.length, 1);
  assert.equal(evidence.flags[winner === 0 ? 'first-finished' : 'second-finished'], true);
  assert.notEqual(evidence.flags[loser === 0 ? 'first-finished' : 'second-finished'], true);
  const losingRun = ok(await request(`${root(f)}/sigil/runs/${challenges[loser].run.id}?characterId=${f.characters.host.id}`, 'GET', undefined, users.host)).run;
  assert.equal(losingRun.result, null); assert.equal(losingRun.completedCheckpoints.length, 0); assert.equal(losingRun.version, challenges[loser].run.version);
  const winningRetry = ok(await request(`${root(f)}/sigil/runs/${challenges[winner].run.id}/checkpoint`, 'POST', payloads[winner], users.host));
  assert.equal(winningRetry.outcome.replayed, true); assert.deepEqual(await state(f), evidence);
});

test('forced TCP final SIGIL versus QR trade commits one whole use and no losing reading copies', { timeout: 25000 }, async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip(onlyTCP);
  const f = await fixture(), challenge = await start(f);
  let exchange = ok(await request(`${root(f)}/exchanges`, 'POST', command(f, 'host'), users.host), 201).exchange;
  exchange = ok(await request(`${root(f)}/exchanges/join`, 'POST', command(f, 'peer', { code: exchange.code }), users.peer)).exchange;
  exchange = ok(await request(`${root(f)}/exchanges/${exchange.id}/offer`, 'PUT', command(f, 'host', { version: exchange.version, readingIds: [f.readings.host], items: [{ itemId: f.itemId, quantity: 1, version: 1 }], resources: [{ resourceId: 'sparks', quantity: 5 }] }), users.host)).exchange;
  exchange = ok(await request(`${root(f)}/exchanges/${exchange.id}/offer`, 'PUT', command(f, 'peer', { version: exchange.version, readingIds: [f.readings.peer], items: [], resources: [] }), users.peer)).exchange;
  exchange = ok(await request(`${root(f)}/exchanges/${exchange.id}/confirm`, 'POST', command(f, 'host', { version: exchange.version }), users.host)).exchange;
  const finalSigil = checkpoint(f, challenge.run), finalTrade = command(f, 'peer', { version: exchange.version });
  const results = await contend(f.event.id, [() => request(`${root(f)}/sigil/runs/${challenge.run.id}/checkpoint`, 'POST', finalSigil, users.host), () => request(`${root(f)}/exchanges/${exchange.id}/confirm`, 'POST', finalTrade, users.peer)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const sigilWon = results[0].status === 200, after = await assets(f), peer = await assets(f, 'peer'), evidence = await state(f);
  assert.equal(tokens(after), 0); assert.equal(quantity(after), 0); assert.equal(tokens(peer), sigilWon ? 0 : 1); assert.equal(quantity(peer), sigilWon ? 0 : 5);
  assert.equal(evidence.outcomes.length, sigilWon ? 1 : 0); assert.equal(evidence.journals.length, sigilWon ? 1 : 0); assert.equal(evidence.flags['first-finished'] === true, sigilWon);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM exchange_copies WHERE event_id=$1 AND exchange_id=$2', [f.event.id, exchange.id])).rows[0].n, sigilWon ? 0 : 2);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM exchange_receipts WHERE event_id=$1 AND exchange_id=$2', [f.event.id, exchange.id])).rows[0].n, sigilWon ? 0 : 2);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM economy_transactions WHERE event_id=$1 AND kind='exchange'", [f.event.id])).rows[0].n, sigilWon ? 0 : 1);
  const retry = sigilWon ? await request(`${root(f)}/sigil/runs/${challenge.run.id}/checkpoint`, 'POST', finalSigil, users.host) : await request(`${root(f)}/exchanges/${exchange.id}/confirm`, 'POST', finalTrade, users.peer);
  assert.equal(ok(retry).outcome.replayed, true); assert.deepEqual(await state(f), evidence);
});

test('forced TCP final SIGIL versus purchase cannot spend the last resource balance twice', { timeout: 25000 }, async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip(onlyTCP);
  const f = await fixture(), challenge = await start(f, { consumeItem: false });
  const shop = ok(await request(`${root(f)}/bazaar/shops`, 'POST', { requestId: randomUUID(), name: 'Supply cache', description: '', enabled: true }), 201).shop;
  const stock = ok(await request(`${root(f)}/bazaar/shops/${shop.id}/stock`, 'POST', { requestId: randomUUID(), name: 'Replacement lantern', description: '', quantity: 1, resourceId: 'sparks', unitPrice: 5 }), 201).stock;
  const finalSigil = checkpoint(f, challenge.run), purchase = command(f, 'host', { shopId: shop.id, stockId: stock.id, version: stock.version, quantity: 1 });
  const results = await contend(f.event.id, [() => request(`${root(f)}/sigil/runs/${challenge.run.id}/checkpoint`, 'POST', finalSigil, users.host), () => request(`${root(f)}/bazaar/purchase`, 'POST', purchase, users.host)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const sigilWon = results[0].status === 200, after = await assets(f), evidence = await state(f);
  assert.equal(quantity(after), 0); assert.equal(tokens(after), 1);
  assert.equal(after.inventory.filter(item => item.name === 'Replacement lantern').reduce((sum, item) => sum + item.quantity, 0), sigilWon ? 0 : 1);
  assert.equal(after.shops.find(row => row.id === shop.id).stock.find(row => row.id === stock.id).quantity, sigilWon ? 1 : 0);
  assert.equal(evidence.outcomes.length, sigilWon ? 1 : 0); assert.equal(evidence.journals.length, sigilWon ? 1 : 0); assert.equal(evidence.flags['first-finished'] === true, sigilWon);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM economy_transactions WHERE event_id=$1 AND kind='purchase'", [f.event.id])).rows[0].n, sigilWon ? 0 : 1);
  const retry = sigilWon ? await request(`${root(f)}/sigil/runs/${challenge.run.id}/checkpoint`, 'POST', finalSigil, users.host) : await request(`${root(f)}/bazaar/purchase`, 'POST', purchase, users.host);
  assert.equal(ok(retry).outcome.replayed, true); assert.deepEqual(await state(f), evidence); assert.equal(quantity(await assets(f)), 0);
});
