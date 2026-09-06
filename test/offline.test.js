import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { IDBFactory } from "fake-indexeddb";

const accountA = "10c13814-f22e-4e63-9422-06f2d8e8d8ab";
const accountB = "20c13814-f22e-4e63-9422-06f2d8e8d8ab";
const eventId = "30c13814-f22e-4e63-9422-06f2d8e8d8ab";
const otherEventId = "40c13814-f22e-4e63-9422-06f2d8e8d8ab";
const characterId = "50c13814-f22e-4e63-9422-06f2d8e8d8ab";
let moduleId = 0;
const importFresh = () => import(`../public/offline.js?case=${moduleId++}`);
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

async function fixture(t) {
  const factory = new IDBFactory();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { value: factory, configurable: true });
  t.after(() => previous ? Object.defineProperty(globalThis, "indexedDB", previous) : delete globalThis.indexedDB);
  const offline = await importFresh();
  await offline.setAccount(accountA);
  return { offline, factory };
}
async function reading(offline, extras = {}) {
  return {
    accountId: accountA, scope: await offline.captureReadScope(),
    event: { id: eventId, name: "Lantern rehearsal" },
    character: { id: characterId, name: "Morrow" },
    adventure: { title: "The missing lantern", version: 1 },
    journal: [{ id: "1", nodeId: "old-relic", entryKey: "relic:first", title: "An old inscription", text: "The revealed inscription.", audio: null, type: "relic", createdAt: "2026-09-05T14:00:00.000Z" }],
    ...extras,
  };
}
async function storedRows(factory) {
  const db = await new Promise((resolve, reject) => { const request = factory.open("oracle-saved-readings", 2); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["meta", "readings"]), rows = {};
    for (const store of ["meta", "readings"]) { const read = tx.objectStore(store).getAll(); read.onsuccess = () => { rows[store] = read.result; }; }
    tx.oncomplete = () => { db.close(); resolve(rows); }; tx.onerror = () => reject(tx.error);
  });
}

test("IndexedDB persists only the already-revealed journal projection and label metadata", async (t) => {
  const { offline, factory } = await fixture(t);
  const input = await reading(offline);
  input.event.members = ["SECRET_MEMBERSHIP"];
  input.character.profile = { privateObjectives: "SECRET_OBJECTIVE" };
  input.adventure.definition = { answer: "SECRET_ANSWER", organizerNotes: "SECRET_NOTES" };
  input.nodes = [{ futureText: "SECRET_FUTURE" }];
  input.session = { cookie: "SECRET_COOKIE" };
  input.inventory = ["SECRET_INVENTORY"];
  input.journal[0].conditions = { flag: "SECRET_FLAG" };
  assert.equal(await offline.cacheJournal(input), true);
  const all = await storedRows(factory);
  for (const secret of ["SECRET_MEMBERSHIP", "SECRET_OBJECTIVE", "SECRET_ANSWER", "SECRET_NOTES", "SECRET_FUTURE", "SECRET_COOKIE", "SECRET_INVENTORY", "SECRET_FLAG", "relic:first"]) assert.ok(!JSON.stringify(all).includes(secret), secret);
  assert.deepEqual(Object.keys(all.readings[0]).sort(), ["accountId", "adventure", "character", "event", "journal", "key", "lastChecked", "sequence"]);
  assert.equal(all.readings[0].journal[0].text, "The revealed inscription.");
  const reloaded = await importFresh();
  const archive = await reloaded.loadArchive();
  assert.equal(archive.accountId, accountA);
  assert.equal(archive.records[0].character.name, "Morrow");
  assert.ok(Number.isFinite(Date.parse(archive.lastChecked)));
  assert.equal(await reloaded.captureReadScope(), null, "Persisted scope does not claim a live authenticated session.");
});

test("archive upgrade preserves saved readings while refusing older unsequenced writers", async (t) => {
  const { offline, factory } = await fixture(t);
  await offline.cacheJournal(await reading(offline));
  const rows = await storedRows(factory), legacy = new IDBFactory();
  const oldDB = await new Promise((resolve, reject) => {
    const request = legacy.open("oracle-saved-readings", 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("meta", { keyPath: "key" }); request.result.createObjectStore("readings", { keyPath: "key" }); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = oldDB.transaction(["meta", "readings"], "readwrite");
    for (const store of ["meta", "readings"]) for (const row of rows[store]) { const copy = { ...row }; delete copy.sequence; tx.objectStore(store).put(copy); }
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  oldDB.close(); Object.defineProperty(globalThis, "indexedDB", { value: legacy, configurable: true });
  const upgraded = await importFresh(), archive = await upgraded.loadArchive();
  assert.equal(archive.records[0].journal[0].text, "The revealed inscription.");
  await assert.rejects(new Promise((resolve, reject) => { const request = legacy.open("oracle-saved-readings", 1); request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error); }), { name: "VersionError" });
});

test("maximum valid combined relic titles and scene readings survive offline storage intact", async (t) => {
  const { offline } = await fixture(t);
  const input = await reading(offline);
  const relicTitle = `${"R".repeat(120)}: ${"E".repeat(120)}`;
  const sceneText = `${"S".repeat(12000)}\n\nLocation: ${"L".repeat(200)}`;
  input.journal = [
    { ...input.journal[0], title: relicTitle, text: "Revealed examination. ".padEnd(6000, ".") },
    { ...input.journal[0], id: "2", nodeId: "long-scene", type: "wayfinder", title: "W".repeat(120), text: sceneText },
  ];
  assert.equal(relicTitle.length, 242);
  assert.equal(sceneText.length, 12212);
  assert.equal(await offline.cacheJournal(input), true);
  const reloaded = await importFresh();
  const saved = (await reloaded.loadArchive()).records[0].journal;
  assert.equal(saved[0].title, relicTitle);
  assert.equal(saved[0].text, input.journal[0].text);
  assert.equal(saved[1].text, sceneText);
});

test("completed exchange journal receipts and received readings persist without pending exchange details", async (t) => {
  const { offline, factory } = await fixture(t);
  const input = await reading(offline);
  const receiptTitle = "Completed exchange receipt".padEnd(250, ".");
  const receiptText = "Sent: Inscription. Received: Map. Introduction completed.".padEnd(12250, ".");
  const receivedTitle = `${"R".repeat(120)}: ${"E".repeat(120)}`;
  const receivedText = `${"S".repeat(12000)}\n\nLocation: ${"L".repeat(200)}`;
  input.journal = [
    { ...input.journal[0], id: "received-1", type: "shared_reading", title: receivedTitle, text: receivedText, sourceExchange: "SECRET_SOURCE_EXCHANGE" },
    { ...input.journal[0], id: "receipt-1", nodeId: "exchange", type: "exchange_receipt", title: receiptTitle, text: receiptText, offer: "SECRET_PENDING_OFFER" },
  ];
  input.exchange = {
    status: "negotiating", code: "ABCD2345EFGH",
    own: { offered: [{ text: "SECRET_UNCONFIRMED_READING" }] },
    partner: { character: { profile: { email: "SECRET_PRIVATE_CONTACT", privateObjectives: "SECRET_PARTNER_OBJECTIVE" } } },
    receipt: { received: [{ text: "SECRET_DIRECT_DETAIL_BODY" }] },
  };
  input.pendingOffers = ["SECRET_PENDING_OFFER"];
  input.contacts = [{ email: "SECRET_PRIVATE_CONTACT" }];
  assert.equal(await offline.cacheJournal(input), true);
  const persisted = JSON.stringify(await storedRows(factory));
  for (const secret of ["ABCD2345EFGH", "SECRET_SOURCE_EXCHANGE", "SECRET_PENDING_OFFER", "SECRET_UNCONFIRMED_READING", "SECRET_PRIVATE_CONTACT", "SECRET_PARTNER_OBJECTIVE", "SECRET_DIRECT_DETAIL_BODY"]) assert.ok(!persisted.includes(secret), secret);
  const archive = await (await importFresh()).loadArchive();
  const saved = archive.records[0].journal;
  assert.deepEqual(saved.map(({ type, nodeId, title, text }) => ({ type, nodeId, title, text })), [
    { type: "shared_reading", nodeId: "old-relic", title: receivedTitle, text: receivedText },
    { type: "exchange_receipt", nodeId: "exchange", title: receiptTitle, text: receiptText },
  ]);
  for (const entry of saved) assert.deepEqual(Object.keys(entry).sort(), ["audio", "createdAt", "id", "nodeId", "text", "title", "type"]);
  const html = offline.renderArchive({ esc, archive });
  assert.ok(html.includes(receiptText));
  assert.ok(html.includes(receivedText));
  assert.ok(!html.includes("ABCD2345EFGH"));
  assert.ok(!html.includes("SECRET_"));
});

test("collected WHISPER journal snapshots survive without story truth, current investigations, balances or agreements", async (t) => {
  const { offline, factory } = await fixture(t);
  const input = await reading(offline);
  const whisperId = "60c13814-f22e-4e63-9422-06f2d8e8d8ab";
  const title = "W".repeat(120), text = "A collected, unverified telling. ".padEnd(6000, ".");
  input.journal = [{
    ...input.journal[0], id: "whisper-journal-1", nodeId: `whisper:${whisperId}`, type: "whisper", title, text,
    entryKey: `whisper:${whisperId}:7`, truth: "SECRET_ORGANIZER_TRUTH", topic: "SECRET_ALTERNATE_TELLING",
    conditions: { flags: ["SECRET_TARGET_CONDITION"] }, audience: { type: "private", ids: ["SECRET_AUDIENCE_CHARACTER"] },
    publication: { correctionNote: "SECRET_UNPUBLISHED_CORRECTION" },
  }];
  input.story = { rumors: [{ title: "SECRET_UNCOLLECTED_RUMOR" }], bulletins: [{ body: "SECRET_CURRENT_NEWS" }] };
  input.trace = { records: [{ notes: "SECRET_PRIVATE_THEORY", sources: ["SECRET_PRIVATE_CITATION"] }] };
  input.bazaar = { balances: [{ resourceId: "SECRET_CURRENT_BALANCE", quantity: 47 }], inventory: [{ name: "SECRET_UNOFFERED_ITEM" }] };
  input.sigil = { runs: [{ timer: "SECRET_SIGIL_TIMER", answer: "SECRET_SIGIL_ANSWER", performers: ["SECRET_SIGIL_PERFORMER"] }] };
  input.static = { state: { text: "SECRET_CURRENT_SIGNAL" }, overrides: [{ reason: "SECRET_STAFF_OVERRIDE" }] };
  input.oaths = { agreements: [{ terms: "SECRET_PRIVATE_AGREEMENT", history: [{ reason: "SECRET_DISPUTE_REASON" }] }] };
  assert.equal(await offline.cacheJournal(input), true);
  const persisted = JSON.stringify(await storedRows(factory));
  for (const secret of ["SECRET_ORGANIZER_TRUTH", "SECRET_ALTERNATE_TELLING", "SECRET_TARGET_CONDITION", "SECRET_AUDIENCE_CHARACTER", "SECRET_UNPUBLISHED_CORRECTION", "SECRET_UNCOLLECTED_RUMOR", "SECRET_CURRENT_NEWS", "SECRET_PRIVATE_THEORY", "SECRET_PRIVATE_CITATION", "SECRET_CURRENT_BALANCE", "SECRET_UNOFFERED_ITEM", "SECRET_PRIVATE_AGREEMENT", "SECRET_DISPUTE_REASON", "SECRET_SIGIL_TIMER", "SECRET_SIGIL_ANSWER", "SECRET_SIGIL_PERFORMER", "SECRET_CURRENT_SIGNAL", "SECRET_STAFF_OVERRIDE", `whisper:${whisperId}:7`]) assert.ok(!persisted.includes(secret), secret);
  const archive = await (await importFresh()).loadArchive(), saved = archive.records[0].journal[0];
  assert.deepEqual(Object.keys(saved).sort(), ["audio", "createdAt", "id", "nodeId", "text", "title", "type"]);
  assert.equal(saved.type, "whisper");
  assert.equal(saved.nodeId, `whisper:${whisperId}`);
  assert.equal(saved.title, title);
  assert.equal(saved.text, text);
  assert.ok(offline.renderArchive({ esc, archive }).includes(text));
});

test("logout and account changes clear previous readings and reject late responses", async (t) => {
  const { offline } = await fixture(t);
  const oldResponse = await reading(offline);
  await offline.cacheJournal(oldResponse);
  await offline.setAccount(accountB);
  assert.deepEqual((await offline.loadArchive()).records, []);
  assert.equal(await offline.cacheJournal(oldResponse), false);
  const own = await reading(offline, { accountId: accountB });
  assert.equal(await offline.cacheJournal(own), true);
  await offline.clearArchive();
  assert.deepEqual(await offline.loadArchive(), { accountId: null, records: [], lastChecked: null });
  assert.equal(await offline.cacheJournal(own), false);
  assert.equal(await offline.captureReadScope(), null);
});

test("known membership purge removes the whole event and invalidates in-flight reads", async (t) => {
  const { offline } = await fixture(t);
  const stale = await reading(offline);
  await offline.cacheJournal(stale);
  await offline.cacheJournal(await reading(offline, { event: { id: otherEventId, name: "Other event" } }));
  await offline.purgeEvent(eventId);
  const archive = await offline.loadArchive();
  assert.deepEqual(archive.records.map((record) => record.event.id), [otherEventId]);
  assert.equal(await offline.cacheJournal(stale), false, "A previously allowed response cannot undo a later revocation purge.");
  assert.equal(await offline.cacheJournal(await reading(offline)), true, "A newly scoped live check after rejoining can save again.");
});

test("a second tab cannot recreate data after another tab clears or switches accounts", async (t) => {
  const { offline } = await fixture(t);
  const otherTab = await importFresh();
  await otherTab.setAccount(accountA);
  const stale = await reading(otherTab);
  await offline.clearArchive();
  assert.equal(await otherTab.cacheJournal(stale), false);
  await offline.setAccount(accountB);
  assert.equal(await otherTab.captureReadScope(), null);
  assert.deepEqual((await otherTab.loadArchive()).records, []);
});

test("manual cache clearing preserves a verified account only when requested", async (t) => {
  const { offline } = await fixture(t);
  const old = await reading(offline);
  await offline.cacheJournal(old);
  await offline.clearArchive({ keepAccount: true });
  assert.equal((await offline.loadArchive()).accountId, accountA);
  assert.equal(await offline.cacheJournal(old), false);
  assert.equal(await offline.cacheJournal(await reading(offline)), true);
});

test("a failed logout clear suppresses stale IndexedDB readings across reload until safely cleared", async (t) => {
  const { offline, factory } = await fixture(t);
  const flags = new Map(), previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key) => flags.get(key) || null, setItem: (key, value) => flags.set(key, value), removeItem: (key) => flags.delete(key),
  } });
  t.after(() => previous ? Object.defineProperty(globalThis, "localStorage", previous) : delete globalThis.localStorage);
  await offline.cacheJournal(await reading(offline));
  const open = factory.open;
  factory.open = () => { throw new Error("Temporary IndexedDB failure"); };
  await assert.rejects(offline.clearArchive(), /Temporary/);
  factory.open = open;
  assert.deepEqual(await offline.loadArchive(), { accountId: null, records: [], lastChecked: null });
  const reloaded = await importFresh();
  assert.deepEqual(await reloaded.loadArchive(), { accountId: null, records: [], lastChecked: null });
  await reloaded.setAccount(accountA);
  assert.deepEqual((await reloaded.loadArchive()).records, [], "Fresh live verification clears records left behind by the failed logout operation.");
  assert.equal(flags.size, 0);
});

test("unsafe audio, non-data objects, excessive readings, and preview caching are rejected", async (t) => {
  const { offline } = await fixture(t);
  assert.equal(await offline.cacheJournal({ preview: true, accountId: accountA, scope: await offline.captureReadScope() }), false);
  for (const audio of ["https://evil.test/audio.mp3", "data:text/html;base64,PHNjcmlwdD4=", "data:audio/mpeg;base64,bm90LWF1ZGlv", 'data:audio/ogg;base64,T2dnUw==" onload="alert(1)']) {
    const input = await reading(offline); input.journal[0].audio = audio;
    await assert.rejects(async () => offline.cacheJournal(input), /audio/);
  }
  const excessive = await reading(offline); excessive.journal = Array(1001).fill(excessive.journal[0]);
  await assert.rejects(async () => offline.cacheJournal(excessive), /journal/);
  let executed = false;
  const getter = await reading(offline);
  Object.defineProperty(getter.journal, 0, { enumerable: true, get() { executed = true; throw new Error("Do not execute."); } });
  await assert.rejects(async () => offline.cacheJournal(getter), /plain readings/);
  assert.equal(executed, false);
  const method = await reading(offline);
  method.journal[0].id = { toString() { executed = true; return "1"; } };
  await assert.rejects(async () => offline.cacheJournal(method), /identity/);
  assert.equal(executed, false);
});

test("offline view escapes permitted reading text and offers no gameplay mutations", async (t) => {
  const { offline } = await fixture(t);
  const input = await reading(offline);
  input.journal[0].text = '<img src=x onerror="alert(1)"> A literal clue';
  await offline.cacheJournal(input);
  const html = offline.renderArchive({ esc, archive: await offline.loadArchive() });
  assert.match(html, /&lt;img/);
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /Read-only/);
  assert.match(html, /Last checked/);
  assert.match(html, /Scene availability and membership may have changed/);
  assert.deepEqual([...html.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]), ["offline-refresh", "offline-clear"]);
  assert.ok(!html.includes("<form"));
});

test("unavailable IndexedDB leaves online use possible and renders an honest empty archive", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { value: undefined, configurable: true });
  t.after(() => previous ? Object.defineProperty(globalThis, "indexedDB", previous) : delete globalThis.indexedDB);
  const offline = await importFresh();
  await assert.rejects(offline.setAccount(accountA), /unavailable/);
  assert.deepEqual(await offline.loadArchive(), { accountId: null, records: [], lastChecked: null });
  assert.match(offline.renderArchive({ esc }), /No saved readings yet/);
});


test("later authorized journal snapshots win even when older responses arrive last", async t => {
  const { offline } = await fixture(t);
  const first = await reading(offline), second = await reading(offline);
  first.journal[0].text = 'Earlier snapshot'; second.journal[0].text = 'Current snapshot';
  assert.equal(await offline.cacheJournal(second), true);
  assert.equal(await offline.cacheJournal(first), false);
  assert.equal((await offline.loadArchive()).records[0].journal[0].text, 'Current snapshot');
  const scope = await offline.captureReadScope();
  await offline.setAccount(accountA);
  const same = await offline.captureReadScope();
  assert.equal(same.generation, scope.generation, 'Same-account verification preserves the archive generation.');
  assert.ok(same.sequence > scope.sequence);
  assert.equal((await offline.loadArchive()).records.length, 1);
});

test("external archive metadata invalidates visible listeners and pending scopes synchronously", async t => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), listeners = new Map();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener: (name, callback) => listeners.set(name, callback) } });
  t.after(() => previousWindow ? Object.defineProperty(globalThis, 'window', previousWindow) : delete globalThis.window);
  const { offline } = await fixture(t), events = [], unsubscribe = offline.subscribeArchive(event => events.push(event));
  const input = await reading(offline); await offline.cacheJournal(input);
  const pendingRead = offline.loadArchive();
  listeners.get('storage')({ key: 'oracle-readings-signal', newValue: JSON.stringify({ type: 'clear', nonce: crypto.randomUUID(), source: 'another-browser-tab' }) });
  assert.deepEqual(events.at(-1), { type: 'clear', external: true });
  assert.equal(await offline.cacheJournal(input), false);
  assert.equal(await offline.captureReadScope(), null);
  assert.deepEqual((await pendingRead).records, []);
  assert.deepEqual((await offline.loadArchive()).records, []);
  unsubscribe();
});

async function worker({ version = '0.10.0', stores = new Map(), clients = [] } = {}) {
  let source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  source = source.replace("const VERSION = '0.10.0';", `const VERSION = '${version}';`);
  const origin = 'https://oracle.example.test', listeners = new Map(), requests = [];
  let network = async request => {
    const path = new URL(request.url).pathname;
    return new Response(`${version} public ${path}`, { headers: { 'x-oracle-shell-version': version, 'content-type': path === '/' ? 'text/html' : path.endsWith('.css') ? 'text/css' : path.endsWith('.png') ? 'image/png' : path.endsWith('.webmanifest') ? 'application/manifest+json' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript' } });
  };
  let cacheFailure = false, putFailure = false, claimed = 0, skipped = 0, liveClients = clients;
  const keyOf = key => typeof key === 'string' ? key : key.url;
  const cachesMock = {
    open: async name => { if (cacheFailure) throw new Error('Storage unavailable'); if (!stores.has(name)) stores.set(name, new Map()); const values = stores.get(name); return {
      put: async (key, response) => { if (putFailure) throw new Error('Quota exceeded'); values.set(keyOf(key), response.clone()); },
      match: async key => values.get(keyOf(key))?.clone(), delete: async key => values.delete(keyOf(key)), keys: async () => [...values.keys()].map(key => new Request(key)),
    }; }, keys: async () => [...stores.keys()], delete: async name => stores.delete(name),
  };
  const context = vm.createContext({ URL, Request, Response, Set, Map, Promise, AbortController, Uint8Array, Date, encodeURIComponent,
    setTimeout: (fn, ms) => setTimeout(fn, ms === 4000 ? 20 : ms), clearTimeout,
    self: { location: { origin }, clients: { claim: async () => { claimed++; }, matchAll: async () => liveClients }, skipWaiting: async () => { skipped++; }, addEventListener: (name, handler) => listeners.set(name, handler) },
    caches: cachesMock, fetch: async request => { requests.push(request); return network(request); },
  });
  vm.runInContext(source + '\nthis.testWorker = {cacheableRequest, STATIC_ASSETS, CACHE_NAME};', context);
  return { origin, requests, stores, assets: Array.from(context.testWorker.STATIC_ASSETS), cacheName: context.testWorker.CACHE_NAME,
    accepts: (path, options) => context.testWorker.cacheableRequest(new Request(new URL(path, origin), options)),
    network: fn => { network = fn; }, storageUnavailable: () => { cacheFailure = true; }, quotaFull: () => { putFailure = true; }, clients: value => { liveClients = value; }, claimed: () => claimed, skipped: () => skipped,
    run: async (name, path = '/app.js', options = {}) => {
      let response, wait; const request = new Request(new URL(path, origin), options.request || {});
      if (options.navigation) Object.defineProperty(request, 'mode', { value: 'navigate' });
      listeners.get(name)({ request, clientId: options.clientId, resultingClientId: options.resultingClientId, respondWith: promise => { response = promise; }, waitUntil: promise => { wait = promise; } });
      if (wait) await wait; return response ? await response : undefined;
    },
    message: async (data, client = { id: 'current-tab', url: origin + '/' }) => { let wait, response; listeners.get('message')({ data, source: client, ports: [{ postMessage: value => { response = value; } }], waitUntil: promise => { wait = promise; } }); if (wait) await wait; return response; },
  };
}

test('service worker intercepts only the explicit same-origin public shell allowlist', async () => {
  const sw = await worker();
  for (const path of sw.assets) assert.equal(sw.accepts(path), true, path);
  for (const path of ['/api/session', '/api/auth/logout', '/api/events/id/exchanges', '/api/events/id/stagehand/manage', '/api/events/id/adventure/play', '/api/events/id/sigil/runs/id/heartbeat', '/api/events/id/static', '/health/ready', '/unknown', '/app.js?token=private', '/?badge=private', 'https://evil.test/app.js', '/sw.js', '/__oracle_shell_client__/anything']) { assert.equal(sw.accepts(path), false, path); assert.equal(await sw.run('fetch', path), undefined); }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) assert.equal(sw.accepts('/app.js', { method }), false);
  assert.equal(sw.accepts('/app.js', { headers: { authorization: 'Bearer private' } }), false);
  assert.equal(sw.accepts('/app.js', { headers: { range: 'bytes=0-20' } }), false);
  assert.equal(sw.requests.length, 0);
});

test('service worker installs a complete public build without cookies, rejects mixed versions, and preserves unrelated caches', async () => {
  const stores = new Map([['oracle-static-old', new Map()], ['unrelated-app', new Map()]]), sw = await worker({ stores });
  await sw.run('install'); assert.equal(sw.requests.length, sw.assets.length);
  assert.ok(sw.requests.every(request => request.credentials === 'omit' && request.cache === 'reload' && request.redirect === 'error'));
  assert.equal(stores.get(sw.cacheName).size, sw.assets.length + 1, 'Completeness marker follows every required asset.');
  await sw.run('activate'); assert.equal(stores.has('oracle-static-old'), false); assert.equal(stores.has('unrelated-app'), true); assert.equal(sw.claimed(), 1); assert.equal(sw.skipped(), 0, 'Installation never forces an update.');
  const mixed = await worker(); mixed.network(async () => new Response('newer source', { headers: { 'content-type': 'text/javascript', 'x-oracle-shell-version': '0.11.0' } }));
  await assert.rejects(mixed.run('install'), /match|mixed|incomplete/); assert.equal(mixed.stores.has(mixed.cacheName), false, 'Failed builds never become a partially usable cache.');
});

test('active immutable shell ignores newer deployments, 503s, weak networks and API-shaped responses', async () => {
  const sw = await worker(); await sw.run('install'); const initialCount = sw.requests.length;
  for (const network of [async () => new Response('new', { headers: { 'content-type': 'text/javascript', 'x-oracle-shell-version': '0.11.0' } }), async () => new Response('down', { status: 503 }), async () => { throw new Error('Offline'); }, async () => new Response('PRIVATE_JSON', { headers: { 'content-type': 'application/json' } }), () => new Promise(() => {})]) {
    sw.network(network); assert.equal(await (await sw.run('fetch')).text(), '0.10.0 public /app.js');
  }
  assert.equal(sw.requests.length, initialCount, 'Cached build assets never request or overwrite with a newer version.');
});

test('explicit update preserves old active client builds across worker restarts and blocks unknown legacy tabs', async () => {
  const oldTab = { id: 'old-tab', url: 'https://oracle.example.test/' }, newTab = { id: 'new-tab', url: 'https://oracle.example.test/' }, legacy = { id: 'legacy-tab', url: 'https://oracle.example.test/' };
  const old = await worker({ clients: [oldTab] }); await old.run('install'); assert.equal((await old.message({ type: 'ORACLE_CLIENT_VERSION', version: '0.10.0' }, oldTab)).ok, true);
  const next = await worker({ version: '0.11.0', stores: old.stores, clients: [oldTab, newTab, legacy] }); await next.run('install');
  const blocked = await next.message({ type: 'ORACLE_APPLY_UPDATE', clientVersion: '0.11.0' }, newTab); assert.equal(blocked.reason, 'other-tabs'); assert.equal(next.skipped(), 0);
  next.clients([oldTab, newTab]); assert.equal((await next.message({ type: 'ORACLE_APPLY_UPDATE', clientVersion: '0.11.0' }, newTab)).ok, true); assert.equal(next.skipped(), 1); await next.run('activate');
  assert.equal(await (await next.run('fetch', '/app.js', { clientId: oldTab.id })).text(), '0.10.0 public /app.js');
  assert.equal(await (await next.run('fetch', '/app.js', { clientId: newTab.id })).text(), '0.11.0 public /app.js');
  const restarted = await worker({ version: '0.11.0', stores: old.stores, clients: [oldTab, newTab] });
  assert.equal(await (await restarted.run('fetch', '/app.js', { clientId: oldTab.id })).text(), '0.10.0 public /app.js');
  await restarted.run('fetch', '/', { navigation: true, clientId: oldTab.id, resultingClientId: 'reloaded-tab' });
  assert.equal(await (await restarted.run('fetch', '/app.js', { clientId: 'reloaded-tab' })).text(), '0.11.0 public /app.js');
});

test('missing storage uses only a matching bounded network asset and never caches failures', async () => {
  const sw = await worker(); sw.storageUnavailable(); assert.equal(await (await sw.run('fetch')).text(), '0.10.0 public /app.js');
  sw.network(async () => new Response('wrong version', { headers: { 'content-type': 'text/javascript', 'x-oracle-shell-version': '0.11.0' } })); assert.equal((await sw.run('fetch')).status, 503);
  sw.network(() => new Promise(() => {})); assert.equal((await sw.run('fetch')).status, 503); assert.equal(sw.requests.at(-1).signal.aborted, true);
  sw.network(async () => new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'text/javascript', 'x-oracle-shell-version': '0.10.0' } })); assert.equal((await sw.run('fetch')).status, 503, 'Body stalls are bounded as well as connection stalls.');
  const full = await worker(); full.quotaFull(); await assert.rejects(full.run('install'), /Quota/); assert.equal(full.stores.has(full.cacheName), false);
});

test('install manifest uses the same origin with proper raster icons and a maskable safe area', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.id, '/'); assert.equal(manifest.start_url, '/'); assert.equal(manifest.scope, '/'); assert.equal(manifest.display, 'standalone'); assert.match(manifest.name, /ORACLE.*LARP Field Kit/);
  for (const icon of manifest.icons.filter(row => row.type === 'image/png')) {
    assert.match(icon.src, /^\/[a-z0-9-]+\.png$/); const bytes = await readFile(new URL(`../public${icon.src}`, import.meta.url)); assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const [width, height] = icon.sizes.split('x').map(Number); assert.equal(bytes.readUInt32BE(16), width); assert.equal(bytes.readUInt32BE(20), height);
  }
  assert.ok(manifest.icons.some(row => row.sizes === '192x192')); assert.ok(manifest.icons.some(row => row.sizes === '512x512' && row.purpose === 'maskable'));
  const svg = await readFile(new URL('../public/app-icon.svg', import.meta.url), 'utf8'); assert.ok(!/script|foreignObject|href=|onload=/i.test(svg));
});
