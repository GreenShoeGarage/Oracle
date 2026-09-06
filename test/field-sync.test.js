import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createFieldStore } from '../public/field-store.js';
import { createFieldSync } from '../public/field-sync.js';

const uid = () => crypto.randomUUID();
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(t) {
  const values = new Map(), accountId = uid(), eventId = uid(), characterId = uid(), exchangeId = uid();
  const store = createFieldStore({ indexedDB: new IDBFactory(), channel: null, storage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } });
  t.after(() => store.close()); await store.setAccount(accountId); const scope = await store.captureScope();
  await store.saveContext({ scope, accountId, event: { id: eventId, name: 'Rehearsal' }, characters: [{ id: characterId, name: 'Morrow' }] });
  const queue = () => store.enqueueRequest({ scope, accountId, eventId, characterId, kind: 'create', payload: { characterId }, label: 'Information exchange' });
  const overview = { event: { id: eventId, status: 'live' }, character: { id: characterId }, readOnly: false };
  const result = { exchange: { id: exchangeId, event: { id: eventId }, character: { id: characterId }, privateDetail: 'LIVE_ONLY_SECRET' } };
  const calls = [];
  function apiWith(hook = async () => undefined) { return async (path, method, body, options) => { const call = { path, method, body, options }; calls.push(call); const intercepted = await hook(call); if (intercepted !== undefined) return intercepted; if (path === '/api/session') return { user: { id: accountId } }; return method === 'GET' ? overview : result; }; }
  return { store, scope, accountId, eventId, characterId, queue, calls, apiWith, overview };
}

test('queued requests stay local until explicit send and every fresh read and write carries the captured account', async t => {
  const f = await fixture(t), request = await f.queue(), sync = createFieldSync({ api: f.apiWith(), store: f.store });
  assert.equal(sync.busy, false); assert.deepEqual(f.calls, []);
  const sent = await sync.send(request.id); assert.equal(sent.request.state, 'completed'); assert.equal(sync.busy, false);
  assert.deepEqual(f.calls.map(call => call.method), ['GET', 'GET', 'POST']);
  for (const call of f.calls) assert.deepEqual(call.options, { expectedAccount: f.accountId });
  assert.deepEqual(f.calls[2].body, { requestId: request.requestId, characterId: f.characterId, informationOnly: true });
  const local = await f.store.loadLocal(); assert.ok(!JSON.stringify(local).includes('LIVE_ONLY_SECRET')); assert.ok(local.requests[0].attemptedAt);
});

test('cancellation during a pending session check prevents any transmission and late reads cannot restore the request', async t => {
  const f = await fixture(t), request = await f.queue(), started = deferred(), finish = deferred();
  const sync = createFieldSync({ store: f.store, api: f.apiWith(async call => { if (call.path === '/api/session') { started.resolve(); await finish.promise; } }) });
  const outcome = sync.send(request.id).catch(error => error); await started.promise;
  assert.equal((await f.store.cancelRequest(request.id)).uncertain, false); finish.resolve();
  assert.equal((await outcome).status, 404); assert.equal(f.calls.length, 1); assert.deepEqual((await f.store.loadLocal()).requests, []);
});

test('closing the review during preflight prevents transmission and requires a new review', async t => {
  const f = await fixture(t), request = await f.queue(), started = deferred(), finish = deferred();
  const sync = createFieldSync({ store: f.store, api: f.apiWith(async call => { if (call.path !== '/api/session') { started.resolve(); await finish.promise; } }) });
  const outcome = sync.send(request.id).catch(error => error); await started.promise; sync.reset(); finish.resolve();
  assert.equal((await outcome).status, 409); assert.equal(f.calls.filter(call => call.method !== 'GET').length, 0);
  const row = (await f.store.loadLocal()).requests[0]; assert.equal(row.state, 'needs_review'); assert.equal(row.attemptedAt, null);
});

test('preflight network failure remains unsent while a lost mutation response preserves the original uncertain request', async t => {
  const f = await fixture(t), request = await f.queue(); let failed = false;
  const sync = createFieldSync({ store: f.store, api: f.apiWith(async call => { if (!failed) { failed = true; throw new TypeError('Connection failed'); } if (call.method === 'POST') throw new TypeError('Response lost'); }) });
  await assert.rejects(sync.send(request.id), /Connection failed/); let row = (await f.store.loadLocal()).requests[0]; assert.equal(row.state, 'pending'); assert.equal(row.attemptedAt, null);
  await assert.rejects(sync.send(request.id), /Response lost/); row = (await f.store.loadLocal()).requests[0]; assert.equal(row.state, 'uncertain'); assert.ok(row.attemptedAt); assert.equal(row.requestId, request.requestId); assert.deepEqual(row.payload, request.payload);
});

test('a newly different account or unavailable current event cannot transmit the saved request', async t => {
  for (const change of ['account', 'event']) {
    const f = await fixture(t), request = await f.queue();
    const sync = createFieldSync({ store: f.store, api: f.apiWith(async call => change === 'account' && call.path === '/api/session' ? { user: { id: uid() } } : change === 'event' && call.path !== '/api/session' ? { ...f.overview, readOnly: true } : undefined) });
    await assert.rejects(sync.send(request.id), error => [401, 409].includes(error.status));
    assert.equal(f.calls.filter(call => call.method !== 'GET').length, 0); const row = (await f.store.loadLocal()).requests[0]; assert.equal(row.state, 'needs_review'); assert.equal(row.attemptedAt, null);
  }
});
