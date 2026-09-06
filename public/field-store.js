// Local drafts and information-only intentions. This store never authenticates
// a user, persists API responses, or authorizes gameplay while disconnected.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES = ['pending', 'sending', 'uncertain', 'needs_review', 'completed'];
const CONTROL = 'oracle-field-control', NOTICE = 'oracle-field-notice';
const DAY = 86400000, LEASE = 60000;
const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
const uuid = value => { if (typeof value !== 'string' || !UUID.test(value)) fail('Local field identity is invalid.'); return value.toLowerCase(); };
const plain = (value, max, required = false) => { if (typeof value !== 'string' || value.length > max || required && !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail('Local field text is invalid.'); return value; };
function data(value, keys = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('Local field records must be plain data.');
  for (const key of Reflect.ownKeys(value)) if (typeof key !== 'string' || keys && !keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) fail('Local field records contain unsupported data.');
  if (keys && keys.some(key => !Object.hasOwn(value, key))) fail('Local field records are missing required data.');
  return value;
}
function list(value, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) fail('Local field lists are invalid or too large.');
  for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, i), 'value')) fail('Local field lists must contain plain data.');
  return value;
}
const integer = (value, min, max) => { if (!Number.isSafeInteger(value) || value < min || value > max) fail('Local field version is invalid.'); return value; };
function scopeFor(value) { data(value, ['accountId', 'generation', 'sequence']); return { accountId: uuid(value.accountId), generation: uuid(value.generation), sequence: integer(value.sequence, 0, Number.MAX_SAFE_INTEGER) }; }
const idb = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
const empty = () => ({ accountId: null, scope: null, contexts: [], drafts: [], requests: [], lastChecked: null });
const storageDefault = () => { try { return globalThis.localStorage; } catch { return null; } };
function payloadFor(kind, value, characterId, persisted = false) {
  const fields = kind === 'create' ? ['characterId'] : kind === 'join' ? ['characterId', 'code'] : kind === 'offer' ? ['exchangeId', 'version', 'readingIds'] : null;
  if (!fields) fail('Only information exchange creation, joining, and reading offers can be queued.');
  data(value, persisted ? [...fields, 'informationOnly'] : fields);
  if (persisted && value.informationOnly !== true) fail('Queued requests must be information-only.');
  let result;
  if (kind !== 'offer') {
    if (uuid(value.characterId) !== characterId) fail('The queued character does not match this field scope.');
    result = { characterId };
    if (kind === 'join') { if (typeof value.code !== 'string' || !/^[A-HJ-NP-Z2-9]{12}$/.test(value.code)) fail('Use a valid twelve-character exchange code.'); result.code = value.code; }
  } else {
    const readingIds = list(value.readingIds, 10).map(uuid).sort();
    if (new Set(readingIds).size !== readingIds.length) fail('Choose each reading only once.');
    result = { exchangeId: uuid(value.exchangeId), version: integer(value.version, 1, 2147483647), readingIds };
  }
  return { ...result, informationOnly: true };
}
function contextProjection(value) {
  data(value); data(value.event);
  const characters = list(value.characters, 10).map(character => { data(character); return { id: uuid(character.id), name: plain(character.name, 80, true) }; });
  if (new Set(characters.map(character => character.id)).size !== characters.length) fail('Choose each own character once.');
  return { event: { id: uuid(value.event.id), name: plain(value.event.name, 100, true) }, characters };
}
function requestProjection(row, now) {
  if (!STATES.includes(row.state)) fail('Local request state is invalid.');
  const characterId = uuid(row.characterId), created = Date.parse(row.createdAt), expires = Date.parse(row.expiresAt);
  if (!Number.isFinite(created) || expires !== created + DAY || !Number.isFinite(Date.parse(row.updatedAt)) || row.attemptedAt !== null && !Number.isFinite(Date.parse(row.attemptedAt))) fail('Local request dates are invalid.');
  const expired = expires <= now && row.state !== 'completed';
  const abandoned = row.state === 'sending' && (!row.leaseUntil || row.leaseUntil <= now);
  return { id: uuid(row.id), requestId: uuid(row.requestId), eventId: uuid(row.eventId), characterId, kind: row.kind, payload: payloadFor(row.kind, row.payload, characterId, true), label: plain(row.label, 160, true), state: expired ? 'needs_review' : abandoned ? row.attemptedAt ? 'uncertain' : 'pending' : row.state, createdAt: row.createdAt, expiresAt: row.expiresAt, attemptedAt: row.attemptedAt, updatedAt: row.updatedAt, message: expired ? row.attemptedAt ? 'This local request expired. The server may already have received it; review the live exchange.' : 'This local request expired before transmission. Create a new request after reviewing current information.' : abandoned ? row.attemptedAt ? 'No confirmed response. Retry only after review; the original request identifier will be reused.' : 'The previous send review ended before transmission.' : plain(row.message || '', 1000), stopped: row.stopped === true };
}

export function createFieldStore(options = {}) {
  const factory = options.indexedDB || globalThis.indexedDB, storage = Object.hasOwn(options, 'storage') ? options.storage : storageDefault(), now = options.now || (() => Date.now()), dbName = options.dbName || 'oracle-field-desk';
  const tabId = crypto.randomUUID(), listeners = new Set();
  const channel = Object.hasOwn(options, 'channel') ? options.channel : typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('oracle-field-data') : null;
  let currentAccount = null, verifiedAccount = null, invalidated = false, revision = 0, tail = Promise.resolve(), memoryControl = null, closed = false;
  const serial = job => { const result = tail.then(job); tail = result.catch(() => {}); return result; };
  function control() { try { const value = storage?.getItem(CONTROL); return value ? JSON.parse(value) : memoryControl; } catch { return memoryControl; } }
  function writeControl(value) { memoryControl = value; try { storage?.setItem(CONTROL, JSON.stringify(value)); } catch { /* IndexedDB generation checks still apply. */ } }
  function notify(event, external = false) {
    const message = { type: event.type, reason: event.reason, ...(event.eventId ? { eventId: event.eventId } : {}), external };
    for (const listener of listeners) { try { listener(message); } catch { /* One view cannot prevent another from clearing. */ } }
    if (!external) { const broadcast = { ...message, tabId, id: crypto.randomUUID() }; try { channel?.postMessage(broadcast); } catch { /* Storage event is a second transport. */ } try { storage?.setItem(NOTICE, JSON.stringify(broadcast)); } catch { /* Synchronous control checks remain authoritative. */ } }
  }
  const seen = new Set();
  function receive(message) {
    if (!message || message.tabId === tabId || !['change', 'invalidate'].includes(message.type) || seen.has(message.id)) return;
    seen.add(message.id); if (seen.size > 100) seen.delete(seen.values().next().value);
    if (message.type === 'invalidate') { invalidated = true; verifiedAccount = null; revision++; }
    notify(message, true);
  }
  if (channel) channel.onmessage = event => receive(event.data);
  const onStorage = event => { if (event.key === NOTICE && event.newValue) { try { receive(JSON.parse(event.newValue)); } catch { /* Ignore malformed metadata. */ } } };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  function invalidate(reason, accountId, eventId = null) {
    invalidated = true; verifiedAccount = null; revision++;
    const previous = control(), pending = previous?.blocked && previous.accountId === accountId ? previous : null;
    const eventIds = [...new Set([...(pending?.eventIds || []), ...(eventId ? [eventId] : [])])];
    const clear = ['clear', 'account'].includes(reason) || pending?.clear === true || eventIds.length > 30;
    const generation = crypto.randomUUID(); writeControl({ accountId, generation, blocked: true, clear, eventIds: clear ? [] : eventIds });
    notify({ type: 'invalidate', reason, eventId }); return generation;
  }
  async function transaction(mode, operation) {
    if (!factory || closed) fail('Local field storage is unavailable in this browser.', 503);
    const database = await new Promise((resolve, reject) => {
      let settled = false; const request = factory.open(dbName, 1);
      request.onupgradeneeded = () => { for (const name of ['meta', 'contexts', 'drafts', 'requests']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' }); };
      request.onerror = () => { settled = true; reject(request.error); };
      request.onblocked = () => { settled = true; reject(new Error('Close other ORACLE tabs before updating local field storage.')); };
      request.onsuccess = () => { if (settled) request.result.close(); else { request.result.onversionchange = () => request.result.close(); resolve(request.result); } };
    });
    return new Promise((resolve, reject) => {
      const tx = database.transaction(['meta', 'contexts', 'drafts', 'requests'], mode), stores = Object.fromEntries(['meta', 'contexts', 'drafts', 'requests'].map(name => [name, tx.objectStore(name)]));
      let result, failure;
      tx.oncomplete = () => { database.close(); resolve(result); };
      tx.onerror = tx.onabort = () => { database.close(); reject(failure || tx.error || new Error('Local field storage could not be updated.')); };
      Promise.resolve().then(() => operation(stores)).then(value => { result = value; }).catch(error => { failure = error; try { tx.abort(); } catch { database.close(); reject(error); } });
    });
  }
  function matches(saved, scope = null) {
    const marker = control();
    return !closed && !invalidated && saved?.accountId && (!currentAccount || currentAccount === saved.accountId) && (!marker || !marker.blocked && marker.accountId === saved.accountId && marker.generation === saved.generation) && (!scope || scope.accountId === saved.accountId && scope.generation === saved.generation);
  }
  const scopeOf = saved => ({ accountId: saved.accountId, generation: saved.generation, sequence: saved.sequence || 0 });
  async function scoped(stores, scope, accountId) {
    scope = scopeFor(scope);
    accountId ??= scope.accountId;
    const saved = await idb(stores.meta.get('scope'));
    if (!scope || uuid(accountId) !== scope.accountId || !matches(saved, scope)) fail('The local account scope changed. Reconnect and review this device.', 409);
    return saved;
  }
  async function requireCharacter(stores, accountId, eventId, characterId) {
    const context = await idb(stores.contexts.get(`${accountId}:${eventId}`));
    if (!context || !context.characters.some(character => character.id === characterId)) fail('Check this own approved character while connected before saving field work.', 409);
    return context;
  }
  async function setAccount(userId) {
    const accountId = userId === null || userId === undefined ? null : uuid(userId), previousControl = control();
    if (previousControl?.blocked && !previousControl.clear && previousControl.accountId === accountId) {
      currentAccount = accountId; verifiedAccount = null;
      return serial(() => transaction('readwrite', stores => applyInvalidation(stores, accountId))).then(() => setAccount(accountId));
    }
    const wasInvalid = previousControl?.blocked || invalidated && !previousControl;
    const knownChange = !accountId || previousControl && previousControl.accountId !== accountId || currentAccount && currentAccount !== accountId || wasInvalid;
    currentAccount = accountId; verifiedAccount = null; revision++;
    const generation = knownChange ? invalidate('account', accountId) : null, callRevision = revision;
    return serial(() => transaction('readwrite', async stores => {
      const saved = await idb(stores.meta.get('scope'));
      if (revision !== callRevision || currentAccount !== accountId || generation && control()?.generation !== generation) return null;
      let next = saved;
      if (knownChange || saved?.accountId !== accountId || !saved) {
        for (const name of ['contexts', 'drafts', 'requests']) stores[name].clear();
        next = { id: 'scope', accountId, generation: generation || crypto.randomUUID(), sequence: 0 }; stores.meta.put(next);
      }
      writeControl({ accountId, generation: next.generation, blocked: false }); invalidated = false; verifiedAccount = accountId;
      return accountId;
    })).then(value => { notify({ type: 'change', reason: 'account' }); return value; });
  }
  async function applyInvalidation(stores, expectedAccount) {
    const marker = control();
    if (!marker || marker.accountId !== expectedAccount) return false;
    if (!marker.blocked) { invalidated = false; return true; }
    const saved = await idb(stores.meta.get('scope'));
    if (!marker.clear && saved?.accountId !== marker.accountId) return false;
    if (marker.clear) for (const name of ['contexts', 'drafts', 'requests']) stores[name].clear();
    else for (const name of ['contexts', 'drafts', 'requests']) for (const row of await idb(stores[name].getAll())) if (marker.eventIds.includes(row.eventId || row.event?.id)) stores[name].delete(row.id);
    stores.meta.put({ id: 'scope', accountId: marker.clear ? marker.accountId : saved.accountId, generation: marker.generation, sequence: 0 });
    if (control()?.generation === marker.generation) { writeControl({ accountId: marker.accountId, generation: marker.generation, blocked: false }); invalidated = false; }
    return true;
  }
  function clearAll({ keepAccount = false } = {}) {
    const accountId = keepAccount ? currentAccount : null; invalidate('clear', accountId);
    currentAccount = accountId;
    return serial(() => transaction('readwrite', stores => applyInvalidation(stores, accountId)));
  }
  function purgeEvent(eventId) {
    eventId = uuid(eventId); const marker = control();
    if (currentAccount && marker?.accountId && currentAccount !== marker.accountId) return Promise.resolve(false);
    const accountId = currentAccount || marker?.accountId || null; invalidate('purge', accountId, eventId);
    return serial(() => transaction('readwrite', stores => applyInvalidation(stores, accountId)));
  }
  function captureScope() {
    return serial(() => transaction('readwrite', async stores => {
      const saved = await idb(stores.meta.get('scope')); if (!matches(saved)) return null;
      saved.sequence = (saved.sequence || 0) + 1; stores.meta.put(saved); return scopeOf(saved);
    }));
  }
  function saveContext(input) {
    data(input, ['scope', 'accountId', 'event', 'characters']); const safe = contextProjection(input), accountId = uuid(input.accountId), callRevision = revision;
    if (verifiedAccount !== accountId) return Promise.resolve(false);
    return serial(() => transaction('readwrite', async stores => {
      await scoped(stores, input.scope, accountId); if (revision !== callRevision || verifiedAccount !== accountId) return false;
      const id = `${accountId}:${safe.event.id}`, existing = await idb(stores.contexts.get(id));
      if (existing && existing.generation === input.scope.generation && existing.sequence > input.scope.sequence) return false;
      const all = await idb(stores.contexts.getAll()); if (!existing && all.length >= 30) fail('This device already has thirty saved event contexts. Clear an event before adding another.', 429);
      stores.contexts.put({ id, accountId, ...safe, generation: input.scope.generation, sequence: integer(input.scope.sequence, 0, Number.MAX_SAFE_INTEGER), lastChecked: new Date(now()).toISOString() });
      const ids = new Set(safe.characters.map(character => character.id));
      for (const name of ['drafts', 'requests']) for (const row of await idb(stores[name].getAll())) if (row.accountId === accountId && row.eventId === safe.event.id && !ids.has(row.characterId)) stores[name].delete(row.id);
      return true;
    })).then(result => { if (result) notify({ type: 'change', reason: 'write', eventId: safe.event.id }); return result; });
  }
  function draftInput(input, withText) {
    data(input); const required = ['scope', 'accountId', 'eventId', 'characterId', ...(withText ? ['text'] : [])];
    if (Object.keys(input).some(key => ![...required, 'expectedRevision'].includes(key)) || required.some(key => !Object.hasOwn(input, key))) fail('Local note fields are invalid.');
    const expectedRevision = input.expectedRevision === null || input.expectedRevision === undefined ? null : integer(input.expectedRevision, 1, Number.MAX_SAFE_INTEGER);
    return { accountId: uuid(input.accountId), eventId: uuid(input.eventId), characterId: uuid(input.characterId), expectedRevision, ...(withText ? { text: plain(input.text, 12000) } : {}) };
  }
  function saveDraft(input) {
    const safe = draftInput(input, true), callRevision = revision;
    return serial(() => transaction('readwrite', async stores => {
      await scoped(stores, input.scope, safe.accountId); await requireCharacter(stores, safe.accountId, safe.eventId, safe.characterId); if (revision !== callRevision) fail('The local scope changed.', 409);
      const id = `${safe.accountId}:${safe.eventId}:${safe.characterId}`, prior = await idb(stores.drafts.get(id));
      if ((prior?.revision || null) !== safe.expectedRevision) fail('This note changed in another tab. Review the saved note before replacing it.', 409);
      const { expectedRevision, ...value } = safe; void expectedRevision;
      const row = { id, ...value, revision: (prior?.revision || 0) + 1, updatedAt: new Date(now()).toISOString() }; stores.drafts.put(row);
      const { accountId, ...result } = row; void accountId; return result;
    })).then(result => { notify({ type: 'change', reason: 'write', eventId: safe.eventId }); return result; });
  }
  function removeDraft(input) {
    const safe = draftInput(input, false);
    return serial(() => transaction('readwrite', async stores => {
      await scoped(stores, input.scope, safe.accountId); const id = `${safe.accountId}:${safe.eventId}:${safe.characterId}`, prior = await idb(stores.drafts.get(id));
      if ((prior?.revision || null) !== safe.expectedRevision) fail('This note changed in another tab. Review the saved note before deleting it.', 409);
      stores.drafts.delete(id); return true;
    })).then(result => { notify({ type: 'change', reason: 'write', eventId: safe.eventId }); return result; });
  }
  function enqueueRequest(input) {
    data(input, ['scope', 'accountId', 'eventId', 'characterId', 'kind', 'payload', 'label']);
    const accountId = uuid(input.accountId), eventId = uuid(input.eventId), characterId = uuid(input.characterId), payload = payloadFor(input.kind, input.payload, characterId), label = plain(input.label, 160, true), callRevision = revision;
    return serial(() => transaction('readwrite', async stores => {
      await scoped(stores, input.scope, accountId); await requireCharacter(stores, accountId, eventId, characterId); if (revision !== callRevision) fail('The local scope changed.', 409);
      if ((await idb(stores.requests.getAll())).length >= 50) fail('This device already has fifty queued request records. Review or clear records before adding another.', 429);
      const id = crypto.randomUUID(), created = now(), row = { id, requestId: id, accountId, eventId, characterId, kind: input.kind, payload, label, state: 'pending', createdAt: new Date(created).toISOString(), expiresAt: new Date(created + DAY).toISOString(), updatedAt: new Date(created).toISOString(), attemptedAt: null, message: 'Saved locally. No request has been sent.', stopped: false, leaseToken: null, leaseUntil: null };
      stores.requests.put(row); return requestProjection(row, now());
    })).then(result => { notify({ type: 'change', reason: 'write', eventId }); return result; });
  }
  function loadLocal() {
    return serial(async () => {
      try { return await transaction('readonly', async stores => {
        const saved = await idb(stores.meta.get('scope')); if (!matches(saved)) return empty();
        const contexts = [], drafts = [], requests = [];
        for (const row of await idb(stores.contexts.getAll())) if (row.accountId === saved.accountId) { try { const safe = contextProjection(row); if (Number.isFinite(Date.parse(row.lastChecked))) contexts.push({ ...safe, lastChecked: row.lastChecked }); } catch { /* Reject damaged local data. */ } }
        const allowed = row => contexts.some(context => context.event.id === row.eventId && context.characters.some(character => character.id === row.characterId));
        for (const row of await idb(stores.drafts.getAll())) if (row.accountId === saved.accountId && allowed(row)) { try { if (Number.isFinite(Date.parse(row.updatedAt))) drafts.push({ id: plain(row.id, 120, true), eventId: uuid(row.eventId), characterId: uuid(row.characterId), text: plain(row.text, 12000), revision: integer(row.revision, 1, Number.MAX_SAFE_INTEGER), updatedAt: row.updatedAt }); } catch { /* Reject damaged local data. */ } }
        for (const row of await idb(stores.requests.getAll())) if (row.accountId === saved.accountId && allowed(row)) { try { const safe = requestProjection(row, now()); if (safe.id === safe.requestId) requests.push(safe); } catch { /* No malformed request can reach send. */ } }
        if (!matches(saved)) return empty();
        contexts.sort((a, b) => b.lastChecked.localeCompare(a.lastChecked)); drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); requests.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return { accountId: saved.accountId, scope: scopeOf(saved), contexts: contexts.slice(0, 30), drafts, requests: requests.slice(0, 50), lastChecked: contexts[0]?.lastChecked || null };
      }); } catch { return empty(); }
    });
  }
  async function requestRow(stores, id, scope = null) {
    if (scope) scope = scopeFor(scope);
    const saved = await idb(stores.meta.get('scope')); if (!matches(saved, scope)) fail('The local account scope changed. Reconnect before sending.', 409);
    const row = await idb(stores.requests.get(uuid(id))); if (!row || row.accountId !== saved.accountId) fail('Local request not found.', 404);
    if (row.id !== row.requestId) fail('Local request identity is damaged.');
    requestProjection(row, now()); await requireCharacter(stores, row.accountId, row.eventId, row.characterId); return { row, saved };
  }
  function cancelRequest(id) {
    return serial(() => transaction('readwrite', async stores => {
      const { row } = await requestRow(stores, id);
      if (!row.attemptedAt && row.state !== 'completed') { stores.requests.delete(row.id); return { removed: true, uncertain: false, message: 'Removed before transmission. No request was sent.' }; }
      if (row.state === 'completed') { stores.requests.delete(row.id); return { removed: true, uncertain: false, message: 'Local receipt removed. The confirmed server action is unchanged.' }; }
      row.stopped = true; row.state = 'uncertain'; row.message = 'Retries stopped. The server may already have received this request; this does not cancel anything on the server.'; row.updatedAt = new Date(now()).toISOString(); stores.requests.put(row);
      return { removed: false, uncertain: true, message: row.message };
    })).then(result => { notify({ type: 'change', reason: 'write' }); return result; });
  }
  function claimRequest(id) {
    return serial(() => transaction('readwrite', async stores => {
      const { row, saved } = await requestRow(stores, id), projected = requestProjection(row, now());
      if (row.state === 'sending' && row.leaseUntil > now()) fail('Another tab is reviewing or sending this request.', 409);
      if (row.stopped || !['pending', 'uncertain'].includes(projected.state)) fail(projected.state === 'needs_review' ? projected.message || 'Review current information and create a new request.' : 'This request is not available for sending.', 409);
      row.state = 'sending'; row.leaseToken = crypto.randomUUID(); row.leaseOwner = tabId; row.leaseUntil = now() + LEASE; row.updatedAt = new Date(now()).toISOString(); row.message = 'Checking the current account and character before sending.'; stores.requests.put(row);
      return { request: requestProjection(row, now()), leaseToken: row.leaseToken, scope: scopeOf(saved) };
    })).then(result => { notify({ type: 'change', reason: 'write' }); return result; });
  }
  function assertLease(id, leaseToken, scope) {
    return serial(() => transaction('readonly', async stores => {
      const { row } = await requestRow(stores, id, scope);
      if (row.stopped || row.leaseToken !== leaseToken || row.leaseOwner !== tabId || row.leaseUntil <= now()) fail('The local send was stopped or another tab took over. Review the request again.', 409);
      return requestProjection(row, now());
    }));
  }
  function beginTransmission(id, leaseToken, scope) {
    return serial(() => transaction('readwrite', async stores => {
      const { row } = await requestRow(stores, id, scope);
      if (row.stopped || row.leaseToken !== leaseToken || row.leaseOwner !== tabId || row.leaseUntil <= now() || Date.parse(row.expiresAt) <= now()) fail('The local send expired or was stopped. Review the current request.', 409);
      row.attemptedAt ||= new Date(now()).toISOString(); row.leaseUntil = now() + LEASE; row.updatedAt = new Date(now()).toISOString(); row.message = 'Waiting for a confirmed server response.'; stores.requests.put(row); return requestProjection(row, now());
    }));
  }
  function markRequest(id, patch) {
    data(patch, ['scope', 'leaseToken', 'state', 'message']);
    if (!['pending', 'uncertain', 'needs_review', 'completed'].includes(patch.state)) fail('Unsupported local request transition.');
    const message = plain(patch.message, 1000);
    return serial(() => transaction('readwrite', async stores => {
      const { row } = await requestRow(stores, id, patch.scope);
      if (row.leaseToken !== patch.leaseToken || row.leaseOwner !== tabId) fail('Another tab owns this request transition.', 409);
      if (patch.state === 'pending' && row.attemptedAt) fail('A transmitted request cannot be marked unsent.');
      row.state = row.stopped && patch.state !== 'completed' ? 'uncertain' : patch.state; row.message = row.stopped && patch.state !== 'completed' ? 'Retries stopped. The server may already have received this request.' : message;
      row.leaseToken = null; row.leaseOwner = null; row.leaseUntil = null; row.updatedAt = new Date(now()).toISOString(); stores.requests.put(row); return requestProjection(row, now());
    })).then(result => { notify({ type: 'change', reason: 'write' }); return result; });
  }
  function close() { closed = true; invalidated = true; revision++; channel?.close?.(); if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage); listeners.clear(); }
  return { setAccount, clearAll, purgeEvent, captureScope, saveContext, loadLocal, saveDraft, removeDraft, enqueueRequest, cancelRequest, claimRequest, assertLease, beginTransmission, markRequest, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }, close };
}

const store = createFieldStore();
export const setAccount = (...args) => store.setAccount(...args);
export const clearAll = (...args) => store.clearAll(...args);
export const purgeEvent = (...args) => store.purgeEvent(...args);
export const captureScope = (...args) => store.captureScope(...args);
export const saveContext = (...args) => store.saveContext(...args);
export const loadLocal = (...args) => store.loadLocal(...args);
export const saveDraft = (...args) => store.saveDraft(...args);
export const removeDraft = (...args) => store.removeDraft(...args);
export const enqueueRequest = (...args) => store.enqueueRequest(...args);
export const cancelRequest = (...args) => store.cancelRequest(...args);
export const claimRequest = (...args) => store.claimRequest(...args);
export const assertLease = (...args) => store.assertLease(...args);
export const beginTransmission = (...args) => store.beginTransmission(...args);
export const markRequest = (...args) => store.markRequest(...args);
export const subscribe = (...args) => store.subscribe(...args);
