import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createFieldStore } from '../public/field-store.js';

const uid = () => crypto.randomUUID();
function shared() { const values = new Map(); return { factory: new IDBFactory(), storage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }, values }; }
async function fixture(t) {
  const environment = shared(), accountId = uid(), eventId = uid(), characterId = uid(); let time = Date.now();
  const options = { indexedDB: environment.factory, storage: environment.storage, channel: null, now: () => time };
  const store = createFieldStore(options); t.after(() => store.close()); await store.setAccount(accountId);
  const scope = await store.captureScope();
  await store.saveContext({ scope, accountId, event: { id: eventId, name: 'Field rehearsal' }, characters: [{ id: characterId, name: 'Morrow' }] });
  const input = () => ({ scope, accountId, eventId, characterId });
  const queue = (kind = 'create', payload = { characterId }) => store.enqueueRequest({ ...input(), kind, payload, label: 'Information exchange' });
  return { ...environment, options, store, accountId, eventId, characterId, scope, input, queue, advance: ms => { time += ms; } };
}
async function rows(factory) {
  const db = await new Promise((resolve, reject) => { const request = factory.open('oracle-field-desk', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  return new Promise((resolve, reject) => { const result = {}, tx = db.transaction(['meta', 'contexts', 'drafts', 'requests']); for (const name of ['meta', 'contexts', 'drafts', 'requests']) { const read = tx.objectStore(name).getAll(); read.onsuccess = () => { result[name] = read.result; }; } tx.oncomplete = () => { db.close(); resolve(result); }; tx.onerror = () => reject(tx.error); });
}

test('field storage projects own labels and literal notes, rejects authoritative payloads, and never persists supplied private fields', async t => {
  const f = await fixture(t), { store } = f;
  await store.saveContext({ scope: await store.captureScope(), accountId: f.accountId, event: { id: f.eventId, name: 'Field rehearsal', answers: 'SECRET_ANSWER' }, characters: [{ id: f.characterId, name: 'Morrow', email: 'SECRET_EMAIL', inventory: ['SECRET_STOCK'] }] });
  const draft = await store.saveDraft({ ...f.input(), text: '<literal field notes>', expectedRevision: null }); assert.equal(draft.revision, 1);
  const request = await f.queue(); assert.equal(request.id, request.requestId); assert.equal(request.payload.informationOnly, true);
  const raw = JSON.stringify(await rows(f.factory)); for (const secret of ['SECRET_ANSWER', 'SECRET_EMAIL', 'SECRET_STOCK']) assert.ok(!raw.includes(secret));
  assert.equal((await store.loadLocal()).drafts[0].text, '<literal field notes>');
  for (const kind of ['confirm', 'trade', 'reveal', 'purchase', 'heartbeat', 'dispatch', 'constructor']) await assert.rejects(async () => f.queue(kind), /Only information/);
  for (const payload of [{ characterId: f.characterId, items: [] }, { characterId: f.characterId, informationOnly: false }, { characterId: uid() }]) await assert.rejects(async () => f.queue('create', payload));
  await assert.rejects(async () => f.queue('offer', { exchangeId: uid(), version: 1, readingIds: [uid()], resources: [] }));
  let ran = false; const bad = { characterId: f.characterId }; Object.defineProperty(bad, 'code', { enumerable: true, get() { ran = true; return 'AAAAAAAAAAAA'; } }); await assert.rejects(async () => f.queue('join', bad)); assert.equal(ran, false);
});

test('offline reload may use last checked local scope but cannot invent a fresh own-character context', async t => {
  const f = await fixture(t); await f.store.saveDraft({ ...f.input(), text: 'Original note' }); await f.queue();
  const offline = createFieldStore(f.options); t.after(() => offline.close());
  const local = await offline.loadLocal(); assert.equal(local.accountId, f.accountId); assert.equal(local.requests.length, 1);
  const scope = await offline.captureScope(); assert.equal(scope.accountId, f.accountId);
  assert.equal(await offline.saveContext({ scope, accountId: f.accountId, event: { id: f.eventId, name: 'Forged live context' }, characters: [{ id: uid(), name: 'Someone else' }] }), false);
  await offline.saveDraft({ ...f.input(), scope, expectedRevision: 1, text: 'Written locally while disconnected.' });
  assert.equal((await f.store.loadLocal()).drafts[0].revision, 2);
  await assert.rejects(offline.saveDraft({ ...f.input(), scope, characterId: uid(), text: 'Foreign character' }), { status: 409 });
});

test('atomic note revisions prevent simultaneous tabs overwriting or deleting each other’s unsaved work', async t => {
  const f = await fixture(t), other = createFieldStore(f.options); t.after(() => other.close()); await other.setAccount(f.accountId);
  await f.store.saveDraft({ ...f.input(), text: 'First note' }); const otherScope = await other.captureScope();
  const result = await Promise.allSettled([f.store.saveDraft({ ...f.input(), expectedRevision: 1, text: 'Tab one edit' }), other.saveDraft({ ...f.input(), scope: otherScope, expectedRevision: 1, text: 'Tab two edit' })]);
  assert.equal(result.filter(row => row.status === 'fulfilled').length, 1); assert.equal(result.find(row => row.status === 'rejected').reason.status, 409);
  const saved = (await f.store.loadLocal()).drafts[0]; assert.equal(saved.revision, 2);
  await assert.rejects(other.removeDraft({ ...f.input(), scope: otherScope, expectedRevision: 1 }), { status: 409 });
  assert.equal((await f.store.loadLocal()).drafts[0].text, saved.text);
  assert.equal(await other.removeDraft({ ...f.input(), scope: otherScope, expectedRevision: 2 }), true); assert.equal((await f.store.loadLocal()).drafts.length, 0);
});

test('ordered live contexts prune lost characters and stale responses cannot restore their notes or requests', async t => {
  const f = await fixture(t); await f.store.saveDraft({ ...f.input(), text: 'Private note' }); await f.queue();
  const older = await f.store.captureScope(), newer = await f.store.captureScope(), nextCharacter = uid();
  assert.equal(await f.store.saveContext({ scope: newer, accountId: f.accountId, event: { id: f.eventId, name: 'Current event' }, characters: [{ id: nextCharacter, name: 'Current own character' }] }), true);
  assert.equal(await f.store.saveContext({ scope: older, accountId: f.accountId, event: { id: f.eventId, name: 'Stale event' }, characters: [{ id: f.characterId, name: 'Former character' }] }), false);
  const local = await f.store.loadLocal(); assert.equal(local.contexts[0].event.name, 'Current event'); assert.deepEqual(local.drafts, []); assert.deepEqual(local.requests, []);
  await assert.rejects(f.queue(), { status: 409 });
});

test('account changes and synchronous clear invalidate old writes and other tabs without restoring prior account data', async t => {
  const f = await fixture(t), other = createFieldStore(f.options); t.after(() => other.close()); await other.setAccount(f.accountId); const stale = await other.captureScope(); await f.queue();
  const clear = f.store.clearAll(); assert.equal(await other.captureScope(), null); await clear;
  await assert.rejects(other.saveDraft({ ...f.input(), scope: stale, text: 'Late private response' }), { status: 409 });
  const next = uid(); await f.store.setAccount(next); assert.equal((await other.loadLocal()).accountId, null); assert.equal(await other.captureScope(), null);
  assert.equal((await f.store.loadLocal()).accountId, next); assert.deepEqual((await f.store.loadLocal()).requests, []);
});

test('a failed clear leaves a persistent tombstone until fresh account checking safely clears abandoned data', async t => {
  const f = await fixture(t); await f.queue(); const original = f.factory.open;
  f.factory.open = () => { throw new Error('Storage temporarily unavailable'); };
  await assert.rejects(f.store.clearAll(), /temporarily/); f.factory.open = original;
  const reload = createFieldStore(f.options); t.after(() => reload.close()); assert.equal((await reload.loadLocal()).accountId, null);
  await reload.setAccount(f.accountId); assert.deepEqual((await reload.loadLocal()).requests, []);
});

test('pending cancellation prevents transmission while stopping an attempted request stays explicitly uncertain', async t => {
  const f = await fixture(t), pending = await f.queue(), first = await f.store.claimRequest(pending.id);
  assert.equal((await f.store.cancelRequest(pending.id)).uncertain, false); await assert.rejects(f.store.beginTransmission(pending.id, first.leaseToken, first.scope), { status: 404 });
  const attempted = await f.queue(), claim = await f.store.claimRequest(attempted.id); await f.store.beginTransmission(attempted.id, claim.leaseToken, claim.scope);
  const result = await f.store.cancelRequest(attempted.id); assert.equal(result.removed, false); assert.equal(result.uncertain, true); assert.match(result.message, /may already/);
  const local = (await f.store.loadLocal()).requests[0]; assert.equal(local.state, 'uncertain'); assert.equal(local.stopped, true); await assert.rejects(f.store.claimRequest(attempted.id), { status: 409 });
  const complete = await f.store.markRequest(attempted.id, { scope: claim.scope, leaseToken: claim.leaseToken, state: 'completed', message: 'Confirmed response arrived.' }); assert.equal(complete.state, 'completed');
});

test('shared IndexedDB leases serialize dispatch and expired leases permit only the same immutable request', async t => {
  const f = await fixture(t), other = createFieldStore(f.options); t.after(() => other.close()); await other.setAccount(f.accountId);
  const queued = await f.queue('join', { characterId: f.characterId, code: 'AAAAAAAAAAAA' });
  const races = await Promise.allSettled([f.store.claimRequest(queued.id), other.claimRequest(queued.id)]); assert.equal(races.filter(row => row.status === 'fulfilled').length, 1);
  const winner = races[0].status === 'fulfilled' ? f.store : other, loser = winner === f.store ? other : f.store, claim = races.find(row => row.status === 'fulfilled').value;
  await winner.beginTransmission(queued.id, claim.leaseToken, claim.scope); f.advance(61000);
  assert.equal((await loser.loadLocal()).requests[0].state, 'uncertain');
  const retry = await loser.claimRequest(queued.id); assert.equal(retry.request.requestId, queued.requestId); assert.deepEqual(retry.request.payload, queued.payload);
  await assert.rejects(winner.markRequest(queued.id, { scope: claim.scope, leaseToken: claim.leaseToken, state: 'completed', message: 'Late stale lease result' }), { status: 409 });
  await loser.markRequest(queued.id, { scope: retry.scope, leaseToken: retry.leaseToken, state: 'uncertain', message: 'Needs original UUID retry.' });
  f.advance(86400000); const expired = (await loser.loadLocal()).requests[0]; assert.equal(expired.state, 'needs_review'); assert.match(expired.message, /may already/); await assert.rejects(loser.claimRequest(queued.id), { status: 409 });
});

test('bounded request records, payload copies and event purge retain unrelated local drafts only', async t => {
  const f = await fixture(t), readings = [uid()], payload = { exchangeId: uid(), version: 3, readingIds: readings }, queued = await f.queue('offer', payload);
  readings.push(uid()); queued.payload.readingIds.push(uid()); assert.equal((await f.store.loadLocal()).requests[0].payload.readingIds.length, 1);
  for (let i = 1; i < 50; i++) await f.queue(); await assert.rejects(f.queue(), { status: 429 });
  await assert.rejects(async () => f.store.saveDraft({ ...f.input(), text: 'x'.repeat(12001) }));
  const otherEvent = uid(), scope = await f.store.captureScope(); await f.store.saveContext({ scope, accountId: f.accountId, event: { id: otherEvent, name: 'Other event' }, characters: [{ id: f.characterId, name: 'Morrow' }] });
  await f.store.saveDraft({ ...f.input(), scope, eventId: otherEvent, text: 'Keep this separate event note.' });
  await f.store.purgeEvent(f.eventId); const local = await f.store.loadLocal(); assert.deepEqual(local.contexts.map(row => row.event.id), [otherEvent]); assert.equal(local.drafts.length, 1); assert.deepEqual(local.requests, []);
  await assert.rejects(f.store.saveDraft({ ...f.input(), scope, eventId: otherEvent, text: 'Stale generation' }), { status: 409 });
});

test('concurrent event purges accumulate and an immediately following purge cannot weaken a full device clear', async t => {
  const f = await fixture(t), secondEvent = uid(), thirdEvent = uid();
  for (const eventId of [secondEvent, thirdEvent]) { const scope = await f.store.captureScope(); await f.store.saveContext({ scope, accountId: f.accountId, event: { id: eventId, name: 'Another event' }, characters: [{ id: f.characterId, name: 'Morrow' }] }); await f.store.saveDraft({ ...f.input(), scope, eventId, text: 'Local note' }); }
  await f.queue(); await Promise.all([f.store.purgeEvent(f.eventId), f.store.purgeEvent(secondEvent)]);
  let local = await f.store.loadLocal(); assert.deepEqual(local.contexts.map(row => row.event.id), [thirdEvent]); assert.deepEqual(local.drafts.map(row => row.eventId), [thirdEvent]); assert.equal(local.requests.length, 0);
  await f.store.setAccount(f.accountId); const scope = await f.store.captureScope();
  assert.equal(await f.store.saveContext({ scope, accountId: f.accountId, event: { id: thirdEvent, name: 'Fresh context after generation change' }, characters: [{ id: f.characterId, name: 'Morrow' }] }), true);
  await Promise.all([f.store.clearAll(), f.store.purgeEvent(thirdEvent)]);
  local = await f.store.loadLocal(); assert.equal(local.accountId, null); assert.deepEqual(local.contexts, []); assert.deepEqual(local.drafts, []);
});
