// Only already-permitted journal readings enter this store. No API response,
// adventure definition, session credential, profile, inventory, or puzzle state
// is persisted. Service-worker caching is a separate static-assets-only layer.
const DATABASE = "oracle-saved-readings";
// A prior app version must not write unsequenced snapshots into this archive.
// The upgrade keeps the existing stores and already-saved readings intact.
const DATABASE_VERSION = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RECORD_BYTES = 3_000_000;
const MAX_RECORDS = 30;
const INVALIDATED_KEY = "oracle-readings-invalidated";
let currentAccount = null;
let blocked = false;
let queue = Promise.resolve();
let authGeneration = 0;
const SIGNAL_KEY = "oracle-readings-signal";
const subscriberSet = new Set();
const seenSignals = new Set();
const instanceId = crypto.randomUUID();
let channel = null, eventsStarted = false;
const empty = () => ({ accountId: null, records: [], lastChecked: null });
const enqueue = (operation) => {
  const job = queue.then(operation);
  queue = job.catch(() => {});
  return job;
};
const nonce = () => crypto.randomUUID();
function invalidated() {
  try { return blocked || typeof localStorage !== "undefined" && localStorage.getItem(INVALIDATED_KEY) === "1"; }
  catch { return blocked; }
}
function invalidate() {
  blocked = true;
  try { localStorage.setItem(INVALIDATED_KEY, "1"); } catch { /* In-memory denial still applies when browser storage is unavailable. */ }
}
function allowArchive() {
  blocked = false;
  try { localStorage.removeItem(INVALIDATED_KEY); } catch { /* A remaining tombstone safely keeps the archive unavailable. */ }
}
function own(value, key) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}
function identifier(value) {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error("Saved reading identity is invalid.");
  return value.toLowerCase();
}
function plain(value, limit, required = false) {
  if (typeof value !== "string" || value.length > limit || (required && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error("Saved reading text is invalid.");
  return value;
}
function savedAudio(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > 1_400_000) throw new Error("Saved audio is invalid.");
  const match = /^data:audio\/(mpeg|ogg|wav);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4) throw new Error("Saved audio is invalid.");
  let header;
  try { header = atob(match[2].slice(0, 32)); } catch { throw new Error("Saved audio is invalid."); }
  const valid = match[1] === "ogg" ? header.startsWith("OggS") : match[1] === "wav" ? header.startsWith("RIFF") && header.slice(8, 12) === "WAVE" : header.startsWith("ID3") || (header.charCodeAt(0) === 255 && (header.charCodeAt(1) & 224) === 224);
  if (!valid) throw new Error("Saved audio is invalid.");
  return value;
}
function projection(input) {
  const event = own(input, "event"), character = own(input, "character"), adventure = own(input, "adventure"), journal = own(input, "journal");
  if (!Array.isArray(journal) || journal.length > 1000 || Reflect.ownKeys(journal).length !== journal.length + 1) throw new Error("Saved journal is invalid.");
  const result = {
    event: { id: identifier(own(event, "id")), name: plain(own(event, "name"), 100, true) },
    character: { id: identifier(own(character, "id")), name: plain(own(character, "name"), 80, true) },
    adventure: { title: plain(own(adventure, "title"), 200, true), version: own(adventure, "version") },
    journal: Array.from({ length: journal.length }, (unused, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(journal, index);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new Error("Saved journal must contain plain readings.");
      const entry = descriptor.value;
      const createdAt = plain(own(entry, "createdAt"), 40, true);
      if (!Number.isFinite(Date.parse(createdAt))) throw new Error("Saved reading date is invalid.");
      const rawId = own(entry, "id");
      if (typeof rawId !== "string" && !Number.isSafeInteger(rawId)) throw new Error("Saved reading identity is invalid.");
      return {
        id: plain(String(rawId), 100, true),
        nodeId: plain(own(entry, "nodeId"), 48, true),
        // Server snapshots can combine a 120-character node title and exam
        // label, or a 12,000-character scene body and 200-character location.
        title: plain(own(entry, "title"), 250, true),
        text: plain(own(entry, "text"), 12250),
        audio: savedAudio(own(entry, "audio")),
        type: plain(own(entry, "type"), 48, true),
        createdAt,
      };
    }),
  };
  if (!Number.isSafeInteger(result.adventure.version) || result.adventure.version < 0) throw new Error("Saved adventure version is invalid.");
  if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_RECORD_BYTES) throw new Error("This journal is too large to save on this device.");
  return result;
}
function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("Saved readings are unavailable in this browser.")); return; }
    const request = indexedDB.open(DATABASE, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      if (!db.objectStoreNames.contains("readings")) db.createObjectStore("readings", { keyPath: "key" });
    };
    request.onerror = () => reject(request.error || new Error("Saved readings could not be opened."));
    request.onblocked = () => reject(new Error("Close other ORACLE tabs to update saved readings."));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}
async function transaction(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let result;
    const tx = db.transaction(["meta", "readings"], mode);
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error || new Error("Saved readings could not be updated.")); };
    try { operation(tx.objectStore("meta"), tx.objectStore("readings"), (value) => { result = value; }); }
    catch (error) { tx.abort(); db.close(); reject(error); }
  });
}

function notifyArchive(message, external) {
  for (const callback of subscriberSet) { try { callback({ type: message.type, ...(message.accountId ? { accountId: message.accountId } : {}), ...(message.eventId ? { eventId: message.eventId } : {}), external }); } catch { /* Another listener must not interrupt privacy invalidation. */ } }
}
function receiveSignal(message) {
  if (!message || !['account', 'clear', 'event', 'change'].includes(own(message, 'type')) || own(message, 'source') === instanceId || typeof own(message, 'nonce') !== 'string' || seenSignals.has(message.nonce)) return;
  if (message.accountId && !UUID.test(message.accountId) || message.eventId && !UUID.test(message.eventId)) return;
  seenSignals.add(message.nonce); if (seenSignals.size > 100) seenSignals.delete(seenSignals.values().next().value);
  if (message.type !== 'change') {
    authGeneration++;
    if (['account', 'clear'].includes(message.type)) { currentAccount = null; blocked = true; }
  }
  notifyArchive(message, true);
}
function ensureArchiveEvents() {
  if (eventsStarted || typeof window === 'undefined') return;
  eventsStarted = true;
  window.addEventListener('storage', event => { if (event.key !== SIGNAL_KEY || !event.newValue) return; try { receiveSignal(JSON.parse(event.newValue)); } catch { /* Ignore malformed metadata. */ } });
  if (typeof window.BroadcastChannel === 'function') { try { channel = new window.BroadcastChannel('oracle-readings-data'); channel.onmessage = event => receiveSignal(event.data); } catch { /* Storage events remain available. */ } }
}
function announce(type, extra = {}) {
  ensureArchiveEvents(); const message = { type, ...extra, source: instanceId, nonce: nonce() };
  notifyArchive(message, false);
  try { channel?.postMessage(message); } catch { /* A closed channel cannot prevent local invalidation. */ }
  try { localStorage.setItem(SIGNAL_KEY, JSON.stringify(message)); localStorage.removeItem(SIGNAL_KEY); } catch { /* IndexedDB generations still reject stale writes. */ }
}
/** Metadata only. Clear visible private state on external account/clear/event. */
export function subscribeArchive(listener) { if (typeof listener !== 'function') throw new Error('Archive listener must be a function.'); ensureArchiveEvents(); subscriberSet.add(listener); return () => subscriberSet.delete(listener); }

/** Only call with an account returned by a fresh, successful live session check. */
export function setAccount(userId) {
  ensureArchiveEvents();
  const requestedAccount = userId == null ? null : identifier(userId), previouslyInvalidated = invalidated();
  if (requestedAccount !== currentAccount || previouslyInvalidated) authGeneration++;
  currentAccount = requestedAccount; const token = authGeneration;
  // A tombstone persists if browser storage fails during account switching.
  invalidate();
  return enqueue(async () => {
    let changed = false;
    const result = await transaction('readwrite', (meta, readings, done) => {
      const read = meta.get('scope');
      read.onsuccess = () => {
        if (authGeneration !== token || currentAccount !== requestedAccount) { done(null); return; }
        const previous = read.result;
        changed = previous?.accountId !== requestedAccount;
        if (previouslyInvalidated || !requestedAccount || changed) { readings.clear(); meta.put({ key: 'scope', accountId: requestedAccount, generation: nonce(), sequence: 0 }); }
        else if (!Number.isSafeInteger(previous.sequence)) meta.put({ ...previous, sequence: 0 });
        done(requestedAccount);
      };
    });
    if (authGeneration === token && currentAccount === requestedAccount) { allowArchive(); if (changed) announce(requestedAccount ? 'account' : 'clear', requestedAccount ? { accountId: requestedAccount } : {}); }
    return result;
  });
}

/** Capture before the authorized request. Sequence allocation is cross-tab atomic. */
export function captureReadScope() {
  const requestedAccount = currentAccount, token = authGeneration;
  if (!requestedAccount || invalidated()) return Promise.resolve(null);
  return enqueue(() => transaction('readwrite', (meta, _readings, done) => {
    const read = meta.get('scope');
    read.onsuccess = () => {
      const saved = read.result;
      if (invalidated() || authGeneration !== token || saved?.accountId !== requestedAccount || currentAccount !== requestedAccount) { done(null); return; }
      const sequence = (Number.isSafeInteger(saved.sequence) ? saved.sequence : 0) + 1;
      if (!Number.isSafeInteger(sequence)) { done(null); return; }
      meta.put({ ...saved, sequence });
      done({ accountId: requestedAccount, generation: saved.generation, sequence, authGeneration: token });
    };
  }));
}

/** Persist only a successful, non-preview journal; older responses cannot replace newer snapshots. */
export function cacheJournal(input) {
  const scope = own(input, 'scope'), accountId = own(input, 'accountId');
  if (!scope || !currentAccount || invalidated() || accountId !== currentAccount || own(scope, 'accountId') !== accountId || own(scope, 'authGeneration') !== authGeneration) return Promise.resolve(false);
  if (own(input, 'preview') === true) return Promise.resolve(false);
  const safe = projection(input), generation = own(scope, 'generation'), sequence = own(scope, 'sequence'), token = authGeneration;
  if (!Number.isSafeInteger(sequence) || sequence < 1) return Promise.resolve(false);
  return enqueue(async () => {
    const savedResult = await transaction('readwrite', (meta, readings, done) => {
      const read = meta.get('scope');
      read.onsuccess = () => {
        const saved = read.result;
        if (invalidated() || authGeneration !== token || currentAccount !== accountId || saved?.accountId !== accountId || saved.generation !== generation || sequence > saved.sequence) { done(false); return; }
        const key = `${accountId}:${safe.event.id}:${safe.character.id}`, previous = readings.get(key);
        previous.onsuccess = () => {
          if (invalidated() || authGeneration !== token || (previous.result?.sequence || 0) >= sequence) { done(false); return; }
          const lastChecked = new Date().toISOString();
          readings.put({ key, accountId, ...safe, sequence, lastChecked });
          const all = readings.getAll(); all.onsuccess = () => { const ordered = all.result.sort((a, b) => String(b.lastChecked).localeCompare(String(a.lastChecked))); for (const row of ordered.slice(MAX_RECORDS)) readings.delete(row.key); };
          done(true);
        };
      };
    });
    if (savedResult && authGeneration === token && !invalidated()) announce('change', { accountId, eventId: safe.event.id });
    return Boolean(savedResult && authGeneration === token && !invalidated());
  });
}

export function clearArchive({ keepAccount = false } = {}) {
  if (!keepAccount) currentAccount = null;
  const keep = keepAccount ? currentAccount : null, token = ++authGeneration;
  invalidate(); announce('clear', keep ? { accountId: keep } : {});
  return enqueue(async () => {
    const result = await transaction('readwrite', (meta, readings, done) => {
      readings.clear(); const read = meta.get('scope');
      read.onsuccess = () => { meta.put({ key: 'scope', accountId: keep && read.result?.accountId === keep ? keep : null, generation: nonce(), sequence: 0 }); done(true); };
    });
    if (authGeneration === token && currentAccount === keep) allowArchive();
    return result;
  });
}

/** Known membership revocation or event removal invalidates pending old snapshots. */
export function purgeEvent(eventId) {
  const id = identifier(eventId), account = currentAccount, token = ++authGeneration;
  invalidate(); announce('event', { eventId: id, ...(account ? { accountId: account } : {}) });
  return enqueue(async () => {
    const result = await transaction('readwrite', (meta, readings, done) => {
      const read = meta.get('scope');
      read.onsuccess = () => {
        if (read.result) meta.put({ ...read.result, generation: nonce(), sequence: 0 });
        const all = readings.getAll(); all.onsuccess = () => { for (const row of all.result) if (row.event?.id === id) readings.delete(row.key); done(true); };
      };
    });
    if (authGeneration === token && currentAccount === account) allowArchive();
    return result;
  });
}

export function loadArchive() {
  ensureArchiveEvents(); const token = authGeneration, requestedAccount = currentAccount;
  if (invalidated()) return Promise.resolve(empty());
  return enqueue(async () => {
    try {
      const result = await transaction('readonly', (meta, readings, done) => {
        const read = meta.get('scope');
        read.onsuccess = () => {
          const accountId = read.result?.accountId;
          if (invalidated() || authGeneration !== token || !accountId || !UUID.test(accountId) || requestedAccount && requestedAccount !== accountId) { done(empty()); return; }
          const all = readings.getAll();
          all.onsuccess = () => {
            if (invalidated() || authGeneration !== token) { done(empty()); return; }
            const records = [];
            for (const row of all.result) { if (row.accountId !== accountId || !Number.isFinite(Date.parse(row.lastChecked))) continue; try { records.push({ ...projection(row), lastChecked: row.lastChecked }); } catch { /* Damaged data never enters the archive. */ } }
            records.sort((a, b) => b.lastChecked.localeCompare(a.lastChecked));
            done({ accountId, records, lastChecked: records[0]?.lastChecked || null });
          };
        };
      });
      return invalidated() || authGeneration !== token ? empty() : result;
    } catch { return empty(); }
  });
}

/** Standalone read-only view: no authenticated navigation or adventure actions. */
export function renderArchive({ esc, archive = empty(), fieldDesk = false }) {
  if (invalidated() || currentAccount && archive.accountId && currentAccount !== archive.accountId) archive = empty();
  const when = (value) => new Date(value).toLocaleString();
  const rows = [];
  for (const record of Array.isArray(archive.records) ? archive.records : []) {
    try { rows.push({ ...projection(record), lastChecked: plain(record.lastChecked, 40, true) }); } catch { /* Ignore invalid local data. */ }
  }
  return `<main class="workspace" id="main" tabindex="-1"><header class="page-head"><div><p class="eyebrow">ORACLE · LARP Field Kit</p><h1>Saved readings</h1><p class="muted">Read-only copies on this device.</p></div><div class="actions"><button class="primary" data-action="offline-refresh">Reconnect to ORACLE</button><button data-action="offline-clear">Clear all local data</button>${fieldDesk ? '<button data-action="field-open">Open Field desk</button>' : ""}</div></header><p class="preview-banner" role="status">This view cannot check event access or unlock new content. Reconnect to continue play. Scene availability and membership may have changed since the last check.</p><p class="hint">These copies belong to the last signed-in account on this device. Signing out or changing accounts clears them.</p>${rows.length ? `<div class="stack">${rows.map((record) => `<details class="panel"><summary>${esc(record.event.name)} · ${esc(record.character.name)} · ${record.journal.length} readings</summary><p class="hint mt">${esc(record.adventure.title)} · Last checked ${esc(when(record.lastChecked))}</p>${record.journal.length ? record.journal.map((entry) => `<article class="character-block"><h2>${esc(entry.title)}</h2><p class="hint">${esc(when(entry.createdAt))}</p><p class="prose">${esc(entry.text)}</p>${entry.audio ? `<audio controls preload="none" src="${esc(entry.audio)}">Audio playback is unavailable.</audio>` : ""}</article>`).join("") : '<p class="hint">No readings had been revealed when this copy was saved.</p>'}</details>`).join("")}</div>` : '<section class="empty"><h2>No saved readings yet.</h2><p>Open an adventure and reveal a reading while connected. Permitted journal entries can then be read here without a connection.</p></section>'}</main>`;
}

export async function registerOfflineShell() {
  if (typeof navigator === "undefined" || !navigator.serviceWorker || typeof isSecureContext === "undefined" || !isSecureContext) return null;
  try { return await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }); }
  catch { return null; }
}
