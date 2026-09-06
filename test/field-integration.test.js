import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { testDatabase } from './database.js';
import { migrate } from '../src/db.js';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { defaultSetup } from '../public/kit.js';
import { defaultCharacterProfile } from '../public/characters-model.js';
import { defaultAdventure, defaultAdventureNode } from '../public/adventure-model.js';
import { createFieldStore } from '../public/field-store.js';
import { createFieldSync } from '../public/field-sync.js';

let database, pool, server, origin;
const users = {}, pass = 'Independent field resilience fixture passphrase';
const base = f => `/api/events/${f.event.id}`;
const exchanges = f => `${base(f)}/exchanges`;
const command = (f, who, extra = {}) => ({ requestId: randomUUID(), characterId: f.characters[who].id, ...extra });
async function request(path, method = 'GET', data, who = users.owner, expected = who?.id) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...(who?.cookie ? { Cookie: who.cookie } : {}), ...(expected ? { 'X-ORACLE-Expected-Account': expected } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  const raw = await response.text();
  return { status: response.status, data: raw ? JSON.parse(raw) : null, account: response.headers.get('x-oracle-account'), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
function ok(response, status = 200) { assert.equal(response.status, status, JSON.stringify(response.data)); return response.data; }
async function fixture() {
  const setup = defaultSetup(); setup.enabledInstruments = ['briefing', 'relic', 'bazaar'];
  const event = ok(await request('/api/events', 'POST', { name: 'Independent field resilience', setup }), 201).event;
  await pool.query("UPDATE events SET status='rehearsal' WHERE id=$1", [event.id]);
  const f = { event, characters: {}, readings: {} };
  for (const who of ['one', 'two', 'replacement']) {
    await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'player')", [event.id, users[who].id]);
    if (who === 'replacement') continue;
    f.characters[who] = ok(await request(`${base(f)}/characters`, 'POST', { profile: { ...defaultCharacterProfile(setup.rules), name: `Field ${who}`, privateObjectives: `PRIVATE ${who} objective` } }, users[who]), 201).character;
    await pool.query("UPDATE characters SET status='approved',inventory_initialized=true WHERE id=$1", [f.characters[who].id]);
    await pool.query("INSERT INTO character_inventory(id,event_id,character_id,name,quantity,notes) VALUES($1,$2,$3,'Untraded lantern',1,'PRIVATE inventory note')", [randomUUID(), event.id, f.characters[who].id]);
    await pool.query("INSERT INTO adventure_runs(event_id,character_id,progress,flags) VALUES($1,$2,'{}','{\"original\":true}')", [event.id, f.characters[who].id]);
    f.readings[who] = randomUUID();
    await pool.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,type) VALUES($1,$2,$3,'field-relic','field-relic:exam:examine',$4,$5,'relic')", [f.readings[who], event.id, f.characters[who].id, `Known ${who} inscription`, `PRIVATE ${who} reading`]);
  }
  await pool.query('INSERT INTO event_adventures(event_id,definition) VALUES($1,$2)', [event.id, JSON.stringify({ ...defaultAdventure(), nodes: [defaultAdventureNode('relic', 'field-relic', 'AAAAAAAAAAAAAAAAAAAA')] })]);
  await pool.query("INSERT INTO event_sharing_settings(event_id,policies) VALUES($1,'{\"field-relic\":\"shareable\"}')", [event.id]);
  return f;
}
async function effects(f) {
  const tables = {
    inventory: ['character_inventory', 'id,character_id,name,quantity,version'],
    runs: ['adventure_runs', 'character_id,progress,flags'],
    copies: ['exchange_copies', 'journal_id'],
    receipts: ['exchange_receipts', 'exchange_id,owner_user_id'],
    transactions: ['economy_transactions', 'id'],
  };
  const result = {};
  for (const [key, [table, columns]] of Object.entries(tables)) result[key] = (await pool.query(`SELECT ${columns} FROM ${table} WHERE event_id=$1 ORDER BY 1`, [f.event.id])).rows;
  return result;
}
async function negotiating(f) {
  const first = ok(await request(exchanges(f), 'POST', command(f, 'one'), users.one), 201).exchange;
  return ok(await request(`${exchanges(f)}/join`, 'POST', command(f, 'two', { code: first.code }), users.two)).exchange;
}
before(async () => {
  database = await testDatabase(); pool = database.pool; await migrate(pool);
  let handler; server = createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  handler = createApp({ pool, config: { ...readConfig({ DATABASE_URL: 'postgres://unused' }), origin }, logger: entry => console.error(entry) });
  for (const who of ['owner', 'one', 'two', 'replacement']) {
    const response = await request('/api/auth/register', 'POST', { email: `${who}@field-integration.example.test`, displayName: `Field ${who}`, password: pass }, null);
    users[who] = { ...ok(response, 201).user, cookie: response.cookie };
  }
  console.log(`Field integration database: ${database.kind}`);
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); if (database) await database.close(); });

test('information request resumes with one immutable UUID and never confirms or transfers inventory', async () => {
  const f = await fixture(), before = await effects(f);
  const payload = command(f, 'one', { informationOnly: true });
  const initial = ok(await request(exchanges(f), 'POST', payload, users.one), 201);
  const retry = ok(await request(exchanges(f), 'POST', payload, users.one));
  assert.equal(retry.outcome.replayed, true); assert.equal(retry.exchange.id, initial.exchange.id);
  assert.equal(retry.exchange.status, 'waiting'); assert.equal(retry.exchange.own.confirmed, false);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM exchange_sessions WHERE event_id=$1', [f.event.id])).rows[0].n, 1);
  assert.equal((await request(exchanges(f), 'POST', { ...payload, informationOnly: false }, users.one)).status, 400);
  assert.deepEqual(await effects(f), before);
});

test('expected account fences cookie switches and expired sessions before saved work can mutate', async () => {
  const f = await fixture(), before = await effects(f), payload = command(f, 'one', { informationOnly: true });
  const changed = await request(exchanges(f), 'POST', payload, users.two, users.one.id);
  assert.equal(changed.status, 409); assert.equal(changed.account, users.two.id);
  assert.equal((await request(exchanges(f), 'POST', payload, users.one, null)).status, 409);
  const freshLogin = await request('/api/auth/login', 'POST', { email: users.one.email, password: pass }, null);
  const device = { ...users.one, cookie: freshLogin.cookie }; ok(freshLogin);
  ok(await request('/api/auth/logout', 'POST', {}, device), 204);
  assert.equal((await request(exchanges(f), 'POST', payload, device)).status, 401);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM exchange_sessions WHERE event_id=$1', [f.event.id])).rows[0].n, 0);
  assert.deepEqual(await effects(f), before);
});

test('queued reading terms and sharing permission are checked again without silently changing assent', async () => {
  const f = await fixture(), before = await effects(f); let exchange = await negotiating(f);
  const queued = command(f, 'one', { informationOnly: true, version: exchange.version, readingIds: [f.readings.one] });
  exchange = ok(await request(`${exchanges(f)}/${exchange.id}/offer`, 'PUT', command(f, 'two', { version: exchange.version, readingIds: [f.readings.two] }), users.two)).exchange;
  assert.equal((await request(`${exchanges(f)}/${exchange.id}/offer`, 'PUT', queued, users.one)).status, 409);
  const latest = { ...queued, requestId: randomUUID(), version: exchange.version };
  const policy = ok(await request(`${base(f)}/sharing`));
  ok(await request(`${base(f)}/sharing`, 'PUT', { version: policy.version, policies: [{ nodeId: 'field-relic', policy: 'restricted' }] }));
  // Read the new version explicitly for an independent current-policy check;
  // the original immutable queued payload remains unchanged and stale.
  const current = ok(await request(`${exchanges(f)}/${exchange.id}?characterId=${f.characters.one.id}`, 'GET', undefined, users.one)).exchange;
  const denied = await request(`${exchanges(f)}/${exchange.id}/offer`, 'PUT', { ...latest, version: current.version }, users.one);
  assert.equal(denied.status, 403);
  const row = (await pool.query('SELECT initiator_offer,initiator_confirmed_version,recipient_confirmed_version FROM exchange_sessions WHERE id=$1', [exchange.id])).rows[0];
  assert.deepEqual(row.initiator_offer, []); assert.equal(row.initiator_confirmed_version, null); assert.equal(row.recipient_confirmed_version, null);
  assert.deepEqual(await effects(f), before);
});

test('saved work cannot cross events or survive revoked membership and captured character reassignment', async () => {
  const f = await fixture(), other = await fixture(), before = await effects(f), payload = command(f, 'one', { informationOnly: true });
  assert.equal((await request(exchanges(other), 'POST', payload, users.one)).status, 404);
  await pool.query('DELETE FROM memberships WHERE event_id=$1 AND user_id=$2', [f.event.id, users.one.id]);
  assert.equal((await request(exchanges(f), 'POST', payload, users.one)).status, 404);
  await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'player')", [f.event.id, users.one.id]);
  await pool.query('UPDATE characters SET user_id=$2,version=version+1 WHERE id=$1', [f.characters.one.id, users.replacement.id]);
  assert.equal((await request(exchanges(f), 'POST', payload, users.one)).status, 404);
  assert.equal((await request(exchanges(f), 'POST', payload, users.replacement, users.one.id)).status, 409);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM exchange_sessions WHERE event_id=$1', [f.event.id])).rows[0].n, 0);
  assert.deepEqual(await effects(f), before);
});

test('information-only requests cannot change a trade or disguise asset and confirmation commands', async () => {
  const f = await fixture(), before = await effects(f); let exchange = await negotiating(f);
  const item = before.inventory.find(row => row.character_id === f.characters.two.id);
  exchange = ok(await request(`${exchanges(f)}/${exchange.id}/offer`, 'PUT', command(f, 'two', { version: exchange.version, readingIds: [], items: [{ itemId: item.id, version: item.version, quantity: 1 }], resources: [] }), users.two)).exchange;
  const payload = command(f, 'one', { informationOnly: true, version: exchange.version, readingIds: [f.readings.one] });
  assert.equal((await request(`${exchanges(f)}/${exchange.id}/offer`, 'PUT', payload, users.one)).status, 409);
  assert.equal((await request(`${exchanges(f)}/${exchange.id}/offer`, 'PUT', { ...payload, requestId: randomUUID(), items: [], resources: [] }, users.one)).status, 400);
  assert.equal((await request(`${exchanges(f)}/${exchange.id}/confirm`, 'POST', command(f, 'one', { informationOnly: true, version: exchange.version }), users.one)).status, 400);
  assert.deepEqual(await effects(f), before);
});

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function localClients() {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  const options = { indexedDB: new IDBFactory(), storage, dbName: `field-integration-${randomUUID()}`, channel: null }, clients = [];
  return { client() { const store = createFieldStore(options); clients.push(store); return store; }, close() { clients.forEach(store => store.close()); } };
}
async function localScope(store, f, who = 'one') {
  await store.setAccount(users[who].id);
  const scope = await store.captureScope();
  await store.saveContext({ scope, accountId: users[who].id, event: { id: f.event.id, name: f.event.name }, characters: [{ id: f.characters[who].id, name: `Field ${who}` }] });
  return { scope, accountId: users[who].id, eventId: f.event.id, characterId: f.characters[who].id };
}
function clientApi(who, calls, gate) {
  return async (path, method = 'GET', body, options) => {
    calls.push({ path, method, body: body && structuredClone(body), expectedAccount: options?.expectedAccount });
    const response = await request(path, method, body, who, options?.expectedAccount);
    if (gate) await gate({ path, method, body, response });
    if (response.status >= 400) { const error = new Error(response.data?.error || 'HTTP request rejected'); error.status = response.status; throw error; }
    return response.data;
  };
}

test('two same-origin clients serialize an explicit send and reload retries the committed request exactly once', async () => {
  const f = await fixture(), before = await effects(f), local = localClients(), calls = [], committed = deferred(), release = deferred();
  try {
    const first = local.client(), second = local.client(), scope = await localScope(first, f);
    await second.setAccount(users.one.id);
    await first.saveDraft({ ...scope, text: 'LOCAL handwritten observation, not an online discovery' });
    const discarded = await first.enqueueRequest({ ...scope, kind: 'create', payload: { characterId: scope.characterId }, label: 'Discard before transmission' });
    await second.cancelRequest(discarded.id);
    assert.equal(calls.length, 0);
    const queued = await first.enqueueRequest({ ...scope, kind: 'create', payload: { characterId: scope.characterId }, label: 'Recover original invitation' });
    const syncOne = createFieldSync({ store: first, api: clientApi(users.one, calls, async ({ method, response }) => {
      if (method === 'POST') { assert.equal(response.status, 201); committed.resolve(); await release.promise; throw new TypeError('Response lost after commit'); }
    }) });
    const syncTwo = createFieldSync({ store: second, api: clientApi(users.one, calls) });
    const send = assert.rejects(syncOne.send(queued.id), /Response lost after commit/);
    await committed.promise;
    await assert.rejects(syncTwo.send(queued.id), /Another tab/);
    assert.equal(calls.filter(row => row.method !== 'GET').length, 1);
    release.resolve(); await send;
    assert.equal((await second.loadLocal()).requests[0].state, 'uncertain');
    first.close(); second.close();
    const reloaded = local.client(); await reloaded.setAccount(users.one.id);
    const saved = await reloaded.loadLocal();
    assert.equal(saved.drafts[0].text, 'LOCAL handwritten observation, not an online discovery');
    assert.equal(saved.requests[0].id, queued.id); assert.equal(saved.requests[0].state, 'uncertain');
    assert.equal(calls.filter(row => row.method !== 'GET').length, 1, 'Opening a client must never flush queued work');
    const outcome = await createFieldSync({ store: reloaded, api: clientApi(users.one, calls) }).send(queued.id);
    assert.equal(outcome.request.state, 'completed'); assert.equal(outcome.result.outcome.replayed, true);
    const writes = calls.filter(row => row.method !== 'GET');
    assert.equal(writes.length, 2); assert.deepEqual(writes[1].body, writes[0].body); assert.equal(writes[0].body.requestId, queued.id);
    assert.ok(calls.every(row => row.expectedAccount === users.one.id));
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM exchange_sessions WHERE event_id=$1', [f.event.id])).rows[0].n, 1);
    assert.equal(JSON.stringify(await reloaded.loadLocal()).includes('PRIVATE'), false);
    assert.deepEqual(await effects(f), before);
  } finally { release.resolve(); local.close(); }
});

test('account change in another client invalidates a held session check before any saved command is transmitted', async () => {
  const f = await fixture(), before = await effects(f), local = localClients(), calls = [], checked = deferred(), release = deferred();
  try {
    const first = local.client(), second = local.client(), scope = await localScope(first, f);
    await second.setAccount(users.one.id);
    const queued = await first.enqueueRequest({ ...scope, kind: 'create', payload: { characterId: scope.characterId }, label: 'Bound to first account' });
    const sync = createFieldSync({ store: first, api: clientApi(users.one, calls, async ({ path }) => { if (path === '/api/session') { checked.resolve(); await release.promise; } }) });
    const sending = assert.rejects(sync.send(queued.id), /scope|account|lease|changed/i);
    await checked.promise; await second.setAccount(users.two.id); release.resolve(); await sending;
    assert.equal(calls.filter(row => row.method !== 'GET').length, 0);
    assert.deepEqual((await first.loadLocal()).requests, []);
    assert.equal((await second.loadLocal()).accountId, users.two.id); assert.deepEqual((await second.loadLocal()).contexts, []);
    assert.deepEqual(await effects(f), before);
  } finally { release.resolve(); local.close(); }
});

test('reconnect checks changed assent, revoked policy and expired invitations without repairing saved payloads', async () => {
  const f = await fixture(), before = await effects(f), local = localClients(), calls = [];
  try {
    const store = local.client(), scope = await localScope(store, f); let exchange = await negotiating(f);
    const queued = await store.enqueueRequest({ ...scope, kind: 'offer', payload: { exchangeId: exchange.id, version: exchange.version, readingIds: [f.readings.one] }, label: 'Original reading terms' });
    exchange = ok(await request(`${exchanges(f)}/${exchange.id}/offer`, 'PUT', command(f, 'two', { version: exchange.version, readingIds: [f.readings.two] }), users.two)).exchange;
    const sync = createFieldSync({ store, api: clientApi(users.one, calls) });
    await assert.rejects(sync.send(queued.id), /terms changed/i);
    let saved = (await store.loadLocal()).requests.find(row => row.id === queued.id);
    assert.equal(saved.state, 'needs_review'); assert.deepEqual(saved.payload, queued.payload); assert.equal(saved.attemptedAt, null);
    const restricted = await store.enqueueRequest({ ...scope, kind: 'offer', payload: { exchangeId: exchange.id, version: exchange.version, readingIds: [f.readings.one] }, label: 'Policy recheck' });
    const sharing = ok(await request(`${base(f)}/sharing`));
    ok(await request(`${base(f)}/sharing`, 'PUT', { version: sharing.version, policies: [{ nodeId: 'field-relic', policy: 'restricted' }] }));
    await assert.rejects(sync.send(restricted.id), /changed|sharing|available/i);
    saved = (await store.loadLocal()).requests.find(row => row.id === restricted.id);
    assert.equal(saved.state, 'needs_review'); assert.deepEqual(saved.payload, restricted.payload);
    const peer = ok(await request(exchanges(f), 'POST', command(f, 'two'), users.two), 201).exchange;
    const join = await store.enqueueRequest({ ...scope, kind: 'join', payload: { characterId: scope.characterId, code: peer.code }, label: 'Expiring invitation' });
    await pool.query("UPDATE exchange_sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [peer.id]);
    await assert.rejects(sync.send(join.id), /expired/i);
    saved = (await store.loadLocal()).requests.find(row => row.id === join.id);
    assert.equal(saved.state, 'needs_review'); assert.equal(saved.payload.code, join.payload.code);
    assert.equal(calls.filter(row => row.method !== 'GET').length, 1, 'Only the current join reaches the server; stale offers stay local');
    assert.deepEqual(await effects(f), before);
  } finally { local.close(); }
});

test('expired HTTP session and revoked event access stop client transmission while other event work remains scoped', async () => {
  const f = await fixture(), other = await fixture(), before = await effects(f), local = localClients(), calls = [];
  try {
    const store = local.client(), scope = await localScope(store, f);
    const otherScope = await localScope(store, other);
    await store.saveDraft({ ...otherScope, text: 'Other event handwritten note' });
    const queued = await store.enqueueRequest({ ...scope, kind: 'create', payload: { characterId: scope.characterId }, label: 'Expired session review' });
    const login = await request('/api/auth/login', 'POST', { email: users.one.email, password: pass }, null), device = { ...users.one, cookie: login.cookie }; ok(login);
    ok(await request('/api/auth/logout', 'POST', {}, device), 204);
    await assert.rejects(createFieldSync({ store, api: clientApi(device, calls) }).send(queued.id), error => error.status === 401);
    assert.equal((await store.loadLocal()).requests[0].state, 'needs_review');
    const revoked = await store.enqueueRequest({ ...scope, kind: 'create', payload: { characterId: scope.characterId }, label: 'Revoked membership review' });
    await pool.query('DELETE FROM memberships WHERE event_id=$1 AND user_id=$2', [f.event.id, users.one.id]);
    await assert.rejects(createFieldSync({ store, api: clientApi(users.one, calls) }).send(revoked.id), error => error.status === 404);
    assert.equal(calls.filter(row => row.method !== 'GET').length, 0);
    await store.purgeEvent(f.event.id);
    const saved = await store.loadLocal(); assert.equal(saved.contexts.length, 1); assert.equal(saved.contexts[0].event.id, other.event.id);
    assert.equal(saved.drafts[0].text, 'Other event handwritten note'); assert.deepEqual(saved.requests, []);
    assert.deepEqual(await effects(f), before);
  } finally { local.close(); }
});

test('a waiting information offer can be sent and its uncertain replay preserves original terms after the peer joins', async () => {
  const f = await fixture(), before = await effects(f), local = localClients(), calls = [];
  try {
    const store = local.client(), scope = await localScope(store, f);
    const invitation = ok(await request(exchanges(f), 'POST', command(f, 'one'), users.one), 201).exchange;
    const queued = await store.enqueueRequest({ ...scope, kind: 'offer', payload: { exchangeId: invitation.id, version: invitation.version, readingIds: [f.readings.one] }, label: 'Reading-only waiting offer' });
    await assert.rejects(createFieldSync({ store, api: clientApi(users.one, calls, async ({ method, response }) => {
      if (method === 'PUT') { assert.equal(response.status, 200); throw new TypeError('Lost waiting offer receipt'); }
    }) }).send(queued.id), /Lost waiting offer receipt/);
    assert.equal((await store.loadLocal()).requests[0].state, 'uncertain');
    const joined = ok(await request(`${exchanges(f)}/join`, 'POST', command(f, 'two', { code: invitation.code }), users.two)).exchange;
    assert.ok(joined.version > queued.payload.version);
    const result = await createFieldSync({ store, api: clientApi(users.one, calls) }).send(queued.id);
    assert.equal(result.request.state, 'completed'); assert.equal(result.result.outcome.replayed, true);
    assert.deepEqual(result.result.exchange.own.offered.map(reading => reading.id), [f.readings.one]);
    const writes = calls.filter(row => row.method === 'PUT'); assert.equal(writes.length, 2); assert.deepEqual(writes[0].body, writes[1].body);
    assert.equal(result.result.exchange.own.confirmed, false); assert.equal(result.result.exchange.partner.confirmed, false);
    assert.deepEqual(await effects(f), before);
  } finally { local.close(); }
});
