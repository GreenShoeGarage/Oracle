import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createFieldStore } from '../public/field-store.js';
import { defaultSetup } from '../public/kit.js';
import { defaultCharacterProfile } from '../public/characters-model.js';
import { projectPreparation, preparationReadiness } from '../public/preparation-model.js';
import { createFieldUI } from '../public/field-ui.js';

const uid = () => crypto.randomUUID();
async function fixture(t) {
  const factory = new IDBFactory(), values = new Map(), accountId = uid(), eventId = uid(), characterId = uid();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const options = { indexedDB: factory, storage, channel: null }, store = createFieldStore(options);
  t.after(() => store.close()); await store.setAccount(accountId);
  const setup = defaultSetup('fantasy', 'council');
  const character = { id: characterId, eventId, userId: accountId, status: 'approved', visibility: 'private', profile: { ...defaultCharacterProfile(setup.rules), name: 'Morrow', biography: 'A trusted courier', privateObjectives: 'Keep the lantern safe.' }, inventory: [{ name: 'Lantern', quantity: 1, notes: 'Keep dry' }], reviewNotes: 'MANAGER_REVIEW', badgeCode: 'SECRET_BADGE' };
  const preparedAt = new Date().toISOString();
  const preparation = { event: { id: eventId, name: 'Field rehearsal', description: 'Camp gathering', location: 'Pine grove', startsAt: null }, setup, factions: [], characters: [character], journals: [{ characterId, readingIds: ['known-reading'], verifiedAt: preparedAt }], preparedAt };
  const save = async (extra = {}) => store.savePreparation({ scope: await store.captureScope(), accountId, preparation, ...extra });
  return { factory, options, store, accountId, eventId, characterId, preparation, character, save };
}
async function rawContexts(factory) {
  const db = await new Promise((resolve, reject) => { const request = factory.open('oracle-field-desk', 2); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  return new Promise((resolve, reject) => { const tx = db.transaction(['contexts']), read = tx.objectStore('contexts').getAll(); let rows; read.onsuccess = () => { rows = read.result; }; tx.oncomplete = () => { db.close(); resolve(rows); }; tx.onerror = () => reject(tx.error); });
}

test('prepared snapshots survive cold reload with only player briefing and own character data, preserving local notes and requests', async t => {
  const f = await fixture(t); await f.save();
  const scope = await f.store.captureScope();
  await f.store.saveDraft({ scope, accountId: f.accountId, eventId: f.eventId, characterId: f.characterId, text: 'My local observation' });
  await f.store.enqueueRequest({ scope, accountId: f.accountId, eventId: f.eventId, characterId: f.characterId, kind: 'create', payload: { characterId: f.characterId }, label: 'Information invitation' });
  await f.save();
  const reload = createFieldStore(f.options); t.after(() => reload.close()); const local = await reload.loadLocal();
  assert.equal(local.contexts[0].preparation.characters[0].profile.privateObjectives, 'Keep the lantern safe.');
  assert.equal(local.contexts[0].preparation.characters[0].inventory[0].name, 'Lantern');
  assert.equal(local.drafts[0].text, 'My local observation'); assert.equal(local.requests[0].state, 'pending');
  const raw = JSON.stringify(await rawContexts(f.factory));
  for (const secret of ['MANAGER_REVIEW', 'SECRET_BADGE', 'organizer-notes', 'Organizer preparation']) assert.ok(!raw.includes(secret), secret);
  assert.equal(local.contexts[0].preparation.setup.content.every(row => row.visibility === 'player'), true);
  assert.equal(await reload.savePreparation({ scope: await reload.captureScope(), accountId: f.accountId, preparation: f.preparation }), false, 'an offline store cannot invent a fresh preparation');
});

test('preparation rejects other users, public cards, unapproved characters and unknown formats before persistence', async t => {
  const f = await fixture(t);
  for (const changes of [{ userId: uid() }, { visibility: 'public' }, { eventId: uid() }, { status: 'pending' }]) await assert.rejects(f.save({ preparation: { ...f.preparation, characters: [{ ...f.character, ...changes }] } }), /Only your own/);
  await assert.rejects(f.save({ preparation: { ...f.preparation, version: 2 } }), /format/);
  assert.equal((await f.store.loadLocal()).contexts.length, 0);
});

test('newer context or preparation snapshots win and removing a character removes its private offline material', async t => {
  const f = await fixture(t); await f.save(); const older = await f.store.captureScope(), newer = await f.store.captureScope();
  const newerPreparation = { ...f.preparation, event: { ...f.preparation.event, name: 'New name' } };
  assert.equal(await f.save({ scope: newer, preparation: newerPreparation }), true);
  assert.equal(await f.save({ scope: older }), false);
  assert.equal((await f.store.loadLocal()).contexts[0].preparation.event.name, 'New name');
  const stale = await f.store.captureScope();
  await f.store.saveContext({ scope: await f.store.captureScope(), accountId: f.accountId, event: f.preparation.event, characters: [] });
  assert.equal(await f.save({ scope: stale }), false);
  const local = await f.store.loadLocal(); assert.equal(local.contexts[0].preparation.characters.length, 0); assert.equal(local.contexts[0].preparation.journals.length, 0);
  assert.ok(!JSON.stringify(await rawContexts(f.factory)).includes('Keep the lantern safe.'));
});

test('clear, event purge, account switch and failed clear invalidate in-flight preparations across tabs', async t => {
  const f = await fixture(t); await f.save(); const other = createFieldStore(f.options); t.after(() => other.close()); await other.setAccount(f.accountId);
  const stale = await other.captureScope(); await f.store.purgeEvent(f.eventId);
  await assert.rejects(other.savePreparation({ scope: stale, accountId: f.accountId, preparation: f.preparation }), { status: 409 });
  await f.store.setAccount(f.accountId); await f.save();
  const inFlight = f.save(); const clear = f.store.clearAll(); await Promise.allSettled([inFlight, clear]); assert.equal((await f.store.loadLocal()).contexts.length, 0);
  await f.store.setAccount(f.accountId); await f.save(); await f.store.setAccount(uid());
  assert.equal((await f.store.loadLocal()).contexts.length, 0); assert.equal((await other.loadLocal()).accountId, null);
  await f.store.setAccount(f.accountId); await f.save();
  const original = f.factory.open; f.factory.open = () => { throw new Error('Storage unavailable'); };
  await assert.rejects(f.store.clearAll(), /Storage unavailable/); f.factory.open = original;
  const reload = createFieldStore(f.options); t.after(() => reload.close()); assert.equal((await reload.loadLocal()).accountId, null);
  await reload.setAccount(f.accountId); assert.equal((await reload.loadLocal()).contexts.length, 0);
});

test('older context-only data remains usable and storage failure never becomes a successful preparation', async t => {
  const f = await fixture(t), scope = await f.store.captureScope();
  await f.store.saveContext({ scope, accountId: f.accountId, event: f.preparation.event, characters: [{ id: f.characterId, name: 'Morrow' }] });
  assert.equal((await f.store.loadLocal()).contexts[0].preparation, undefined);
  const original = f.factory.open; f.factory.open = () => { throw new Error('Quota or storage unavailable'); };
  await assert.rejects(f.store.savePreparation({ scope, accountId: f.accountId, preparation: f.preparation }), /storage unavailable/);
  assert.match((await f.store.loadLocal()).storageError, /storage/); f.factory.open = original;
  assert.equal((await f.store.loadLocal()).contexts[0].preparation, undefined);
});

test('readiness requires an account-matching saved journal and distinguishes missing character or evicted records', async t => {
  const f = await fixture(t), pack = projectPreparation(f.preparation, f.accountId);
  const archive = { accountId: f.accountId, records: [{ event: { id: f.eventId }, character: { id: f.characterId }, journal: [{ id: 'known-reading' }], lastChecked: pack.preparedAt }] };
  assert.deepEqual(preparationReadiness(pack, archive, f.accountId), { missing: [], journalCount: 1 });
  assert.equal(preparationReadiness(pack, { ...archive, accountId: uid() }, f.accountId).missing.length, 1);
  assert.equal(preparationReadiness(pack, { ...archive, records: [] }, f.accountId).missing.length, 1);
  assert.equal(preparationReadiness({ ...pack, characters: [], journals: [] }, archive, f.accountId).missing.length, 1);
});

function mockDOM(t) {
  for (const [name, value] of Object.entries({ document: { querySelector: () => null, addEventListener() {}, body: { classList: { remove() {} } } }, window: { addEventListener() {}, confirm: () => true }, navigator: { onLine: true } })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name); Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => original ? Object.defineProperty(globalThis, name, original) : delete globalThis[name]);
  }
}
async function uiFixture(t, { journalSaves = true, pauseSession = null, currentEmptyEvent = false } = {}) {
  mockDOM(t); const f = await fixture(t), state = { session: { user: { id: f.accountId } }, event: { id: f.eventId, name: 'Field rehearsal' }, view: 'home' };
  const emptyEvent = { ...f.preparation.event, id: uid(), name: 'New event with no character' };
  if (currentEmptyEvent) { await f.save(); state.event = emptyEvent; }
  let markup = '', archive = { accountId: f.accountId, records: [] }, posts = 0;
  const reading = { preview: false, event: f.preparation.event, character: { id: f.characterId, name: 'Morrow' }, characters: [{ id: f.characterId, name: 'Morrow' }], adventure: { title: 'The lantern', version: 1 }, journal: [{ id: 'known-reading', title: 'Known inscription', text: 'Publicly revealed', audio: null }] };
  const api = async (path, method, body, options) => {
    assert.equal(method, 'GET'); assert.equal(options.expectedAccount, f.accountId); if (method !== 'GET') posts++;
    if (path === '/api/session') { if (pauseSession) await pauseSession; return { user: { id: f.accountId } }; }
    if (path === `/api/events/${emptyEvent.id}/characters`) return { characters: [], factions: [] };
    if (path === `/api/events/${emptyEvent.id}`) return { event: { ...emptyEvent, setup: f.preparation.setup, starts_at: null } };
    if (path.endsWith(`/characters/${f.characterId}`)) return { character: f.character, inventory: f.character.inventory };
    if (path.endsWith('/characters')) return { characters: [f.character, { ...f.character, id: uid(), userId: uid(), profile: { ...f.character.profile, name: 'PRIVATE OTHER PLAYER' } }], factions: [] };
    if (path.includes('/adventure/play?')) return reading;
    return { event: { ...f.preparation.event, setup: f.preparation.setup, starts_at: null }, members: [{ email: 'PRIVATE MEMBER' }] };
  };
  const offline = { setAccount: async () => {}, captureReadScope: async () => ({ accountId: f.accountId }), cacheJournal: async () => { if (!journalSaves) return false; archive.records = [{ ...reading, lastChecked: new Date().toISOString() }]; return true; }, loadArchive: async () => archive };
  const ui = createFieldUI({ state, api, shell: html => { markup = html; }, esc: value => String(value).replaceAll('<', '&lt;'), store: f.store, offline, sync: { busy: false, reset() {} }, toast() {}, openModal() {}, closeModal() {}, checkOfflineShell: async () => true, isOfflineShellReady: () => true });
  await ui.open(); return { ...f, ui, state, offline, emptyEvent, html: () => markup, posts: () => posts };
}

test('field preparation UI reads back reference data, excludes other players and remains readable after offline reload', async t => {
  const f = await uiFixture(t); await f.ui.action('field-prepare');
  assert.match(f.html(), /saved and read back/); assert.match(f.html(), /Saved reference material and journal copies are available/);
  assert.match(f.html(), /Keep the lantern safe/); assert.ok(!f.html().includes('PRIVATE OTHER PLAYER')); assert.ok(!f.html().includes('PRIVATE MEMBER')); assert.equal(f.posts(), 0);
  f.state.session = null; globalThis.navigator.onLine = false; f.ui.reset(); await f.ui.open();
  assert.match(f.html(), /Keep the lantern safe/); assert.match(f.html(), /Historical reference saved/); assert.match(f.html(), /Reconnect and sign in/);
});

test('a cold offline Field desk opens saved preparation without any current session or event before its initial render', async t => {
  const f = await uiFixture(t); await f.ui.action('field-prepare');
  globalThis.navigator.onLine = false;
  const coldStore = createFieldStore(f.options); t.after(() => coldStore.close());
  const state = { session: null, event: null, view: 'offline' }; let markup = '';
  const coldUI = createFieldUI({ state, store: coldStore, offline: f.offline, api: async () => { throw new Error('A cold offline view must not fetch private data.'); }, shell: html => { markup = html; }, esc: value => String(value).replaceAll('<', '&lt;'), sync: { busy: false, reset() {} }, toast() {}, openModal() {}, closeModal() {} });
  await coldUI.open();
  assert.equal(state.view, 'field'); assert.match(markup, /Keep the lantern safe/); assert.match(markup, /Historical reference saved/); assert.match(markup, /Reconnect and sign in/);
});

test('failed journal persistence is visible and never reports the preparation complete', async t => {
  const f = await uiFixture(t, { journalSaves: false }); await f.ui.action('field-prepare');
  assert.match(f.html(), /journal could not be saved/); assert.match(f.html(), /Preparation needs attention/); assert.ok(!f.html().includes('Saved reference material and journal copies are available'));
  assert.equal((await f.store.loadLocal()).contexts[0].preparation.journals.length, 0);
});

test('clear or account switch while preparation is checking the session cannot restore private snapshots', async t => {
  let resume; const pauseSession = new Promise(resolve => { resume = resolve; }), f = await uiFixture(t, { pauseSession });
  const preparing = f.ui.action('field-prepare'); await f.store.clearAll(); f.state.session = { user: { id: uid() } }; resume(); await preparing;
  assert.equal((await f.store.loadLocal()).contexts.length, 0); assert.ok(!f.html().includes('Keep the lantern safe'));
});

test('a newly opened event with no own character can prepare its briefing while an older event has a saved character scope', async t => {
  const f = await uiFixture(t, { currentEmptyEvent: true });
  assert.match(f.html(), /Save New event with no character before/);
  await f.ui.action('field-prepare');
  const local = await f.store.loadLocal(), saved = local.contexts.find(row => row.event.id === f.emptyEvent.id)?.preparation;
  assert.ok(saved); assert.equal(saved.characters.length, 0); assert.ok(saved.setup.content.length);
  assert.match(f.html(), /No approved character is assigned to you/);
  assert.equal(local.contexts.some(row => row.event.id === f.eventId), true);
});

test('field database upgrade preserves version-one notes and requests while rejecting old version-one writers', async t => {
  const f = await fixture(t), scope = await f.store.captureScope();
  await f.store.saveContext({ scope, accountId: f.accountId, event: f.preparation.event, characters: [{ id: f.characterId, name: 'Morrow' }] });
  const draft = await f.store.saveDraft({ scope, accountId: f.accountId, eventId: f.eventId, characterId: f.characterId, text: 'Version one note' });
  const queued = await f.store.enqueueRequest({ scope, accountId: f.accountId, eventId: f.eventId, characterId: f.characterId, kind: 'create', payload: { characterId: f.characterId }, label: 'Old invitation' });
  const oldFactory = new IDBFactory();
  await new Promise((resolve, reject) => {
    const request = oldFactory.open('oracle-field-desk', 1);
    request.onupgradeneeded = () => { for (const name of ['meta', 'contexts', 'drafts', 'requests']) request.result.createObjectStore(name, { keyPath: 'id' }); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(['meta', 'contexts', 'drafts', 'requests'], 'readwrite');
      tx.objectStore('meta').put({ id: 'scope', accountId: f.accountId, generation: scope.generation, sequence: scope.sequence });
      tx.objectStore('contexts').put({ id: `${f.accountId}:${f.eventId}`, accountId: f.accountId, event: { id: f.eventId, name: 'Field rehearsal' }, characters: [{ id: f.characterId, name: 'Morrow' }], generation: scope.generation, sequence: scope.sequence, lastChecked: new Date().toISOString() });
      tx.objectStore('drafts').put({ ...draft, accountId: f.accountId }); tx.objectStore('requests').put({ ...queued, accountId: f.accountId });
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  });
  const upgraded = createFieldStore({ ...f.options, indexedDB: oldFactory }); t.after(() => upgraded.close());
  const local = await upgraded.loadLocal(); assert.equal(local.drafts[0].text, 'Version one note'); assert.equal(local.requests[0].requestId, queued.requestId);
  await upgraded.setAccount(f.accountId); assert.equal(await upgraded.savePreparation({ scope: await upgraded.captureScope(), accountId: f.accountId, preparation: f.preparation }), true);
  await assert.rejects(new Promise((resolve, reject) => { const request = oldFactory.open('oracle-field-desk', 1); request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error); }), { name: 'VersionError' });
  assert.equal((await upgraded.loadLocal()).contexts[0].preparation.characters[0].profile.name, 'Morrow');
});
