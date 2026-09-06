import { renderBadgeQR, scanImage, startScanner } from './qr.js';
import { parseExchangeInput } from './exchange-code.js';

const activeStatuses = new Set(['waiting', 'negotiating', 'unavailable']);
const statusNames = { waiting: 'Waiting for a player', negotiating: 'Reviewing offers', completed: 'Completed', cancelled: 'Cancelled', rejected: 'Declined', expired: 'Expired', unavailable: 'Unavailable' };
const typeNames = { whisper: 'Rumor account', relic: 'Relic reading', dead_drop: 'Message', cipherbox: 'Cipher reading', wayfinder: 'Scene reading', shared_reading: 'Shared reading', exchange_receipt: 'Exchange receipt' };
const sameIds = (a, b) => a.length === b.length && [...a].sort().every((id, index) => id === [...b].sort()[index]);
const assetKey = assets => JSON.stringify({ items: (assets?.items || []).map(item => ({ itemId: item.itemId, quantity: Number(item.quantity), version: item.version })).sort((a, b) => a.itemId.localeCompare(b.itemId)), resources: (assets?.resources || []).map(resource => ({ resourceId: resource.resourceId, quantity: Number(resource.quantity) })).sort((a, b) => a.resourceId.localeCompare(b.resourceId)) });
const quantityLabel = value => Number(value || 0).toLocaleString();

export function createExchangeUI(ctx) {
  const { state, api, shell, esc, loadEvent, openModal, closeModal, toast, err } = ctx;
  let dashboard = null, detail = null, accountId = null, selectedCharacterId = null;
  let epoch = 0, modalEpoch = 0, pollTimer = null, clockTimer = null, pollBusy = false;
  let selectedItems = new Map(), selectedResources = new Map();
  let selectedReadings = new Set(), draftVersion = null, offerDirty = false, offerConflict = false, scannerDirty = false;
  let pendingRequest = null, feedback = null, serverOffset = 0, scannerController = null, scannerStop = null, scanBusy = false;
  let fieldQueueBusy = false, queueJoinMode = false, fieldContextAt = null, fieldContextReady = Promise.resolve(), fieldReadScopes = new WeakMap();
  const connected = () => navigator.onLine !== false;
  const eventId = () => dashboard?.event.id || state.event?.id;
  const base = (id = eventId()) => `/api/events/${id}/exchanges`;
  const nameOf = (character) => character?.profile?.name || character?.name || 'Character unavailable';
  const now = () => Date.now() + serverOffset;
  const isExpired = () => detail && activeStatuses.has(detail.status) && Date.parse(detail.expiresAt) <= now();
  const canWrite = () => connected() && !pendingRequest && detail && activeStatuses.has(detail.status) && !detail.readOnly && !isExpired();
  const canConfirm = () => canWrite() && detail.status === 'negotiating' && detail.partner && !detail.blockedReason && !detail.own.confirmed && !offerDirty && !offerConflict;
  const canQueueField = () => Boolean(ctx.queueFieldRequest && dashboard?.character && selectedCharacterId && !pendingRequest && !fieldQueueBusy);
  const hasSavedAssets = () => [detail?.own.assets, detail?.partner?.assets].some(assets => assets?.items?.length || assets?.resources?.length);
  const canQueueOffer = () => Boolean(canQueueField() && detail && ['waiting', 'negotiating'].includes(detail.status) && !offerConflict && !isExpired() && !selectedItems.size && !selectedResources.size && !hasSavedAssets() && selectedReadings.size <= 10);
  const date = (value) => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const status = (value) => `<span class="badge exchange-status ${esc(value)}">${esc(statusNames[value] || value)}</span>`;
  const formatCode = (value) => value.match(/.{1,4}/g)?.join('-') || value;
  function stopPolling() { if (pollTimer) clearTimeout(pollTimer); if (clockTimer) clearInterval(clockTimer); pollTimer = null; clockTimer = null; }
  function reset() {
    epoch++; modalEpoch++; stopPolling(); stopCamera(); accountId = null; dashboard = null; detail = null; selectedCharacterId = null;
    selectedReadings.clear(); selectedItems.clear(); selectedResources.clear(); draftVersion = null; offerDirty = false; offerConflict = false; scannerDirty = false; pendingRequest = null; feedback = null; serverOffset = 0; scanBusy = false; pollBusy = false; fieldQueueBusy = false; queueJoinMode = false; fieldContextAt = null; fieldContextReady = Promise.resolve(); fieldReadScopes = new WeakMap();
  }
  function ensureAccount() {
    const current = state.session?.user?.id || null;
    if (current !== accountId) { reset(); accountId = current; }
    return current;
  }
  function currentContext(generation, who, id) { return generation === epoch && who && who === state.session?.user?.id && state.event?.id === id; }
  function rememberFieldContext(result) {
    if (!ctx.rememberFieldContext || !result?.event || !Array.isArray(result.characters)) return;
    fieldContextAt = new Date().toISOString();
    fieldContextReady = Promise.resolve(ctx.rememberFieldContext(result.event, result.characters, fieldReadScopes.get(result))).catch(() => {});
    fieldReadScopes.delete(result);
  }
  async function request(path, method = 'GET', data) {
    const who = ensureAccount();
    const readScope = method === 'GET' && /\/exchanges(?:\?[^#]*)?$/.test(path) && ctx.captureFieldScope ? await ctx.captureFieldScope() : null;
    const result = await api(path, method, data, { expectedAccount: who });
    if (!who || who !== state.session?.user?.id) { const error = new Error('Your account changed. Open this event again.'); error.status = 409; throw error; }
    if (readScope && result && typeof result === 'object') fieldReadScopes.set(result, readScope);
    return result;
  }
  function selectedAssets() { return { items: [...selectedItems.values()], resources: [...selectedResources.values()] }; }
  function restoreAssets(assets) {
    selectedItems = new Map((assets?.items || []).map(item => [item.itemId, { ...item, quantity: String(item.quantity) }]));
    selectedResources = new Map((assets?.resources || []).map(resource => [resource.resourceId, { ...resource, quantity: String(resource.quantity) }]));
  }
  function updateDirty() { offerDirty = !sameIds([...selectedReadings], detail.own.offered.map(reading => reading.id)) || assetKey(selectedAssets()) !== assetKey(detail.own.assets); }
  function applyDetail(result, preserveDraft = true) {
    const next = result.exchange, sameSession = detail?.id === next.id;
    const savedIds = next.own.offered.map((reading) => reading.id);
    if (!sameSession || !activeStatuses.has(next.status) || !preserveDraft || !offerDirty || (sameIds([...selectedReadings], savedIds) && assetKey(selectedAssets()) === assetKey(next.own.assets))) {
      selectedReadings = new Set(savedIds); restoreAssets(next.own.assets); offerDirty = false; offerConflict = false; draftVersion = next.version;
    } else if (draftVersion !== next.version) offerConflict = true;
    detail = next; selectedCharacterId = next.character.id;
    serverOffset = Number.isFinite(Date.parse(next.serverTime)) ? Date.parse(next.serverTime) - Date.now() : 0;
    if (dashboard?.event.id === next.event.id) dashboard.event.status = next.event.status;
    if (state.event?.id === next.event.id) state.event.status = next.event.status;
  }
  async function open(options = {}) {
    const who = ensureAccount(), id = state.event?.id, generation = ++epoch;
    if (!id) throw new Error('Open an event before exchanging information.');
    stopPolling(); feedback = null;
    const characterId = options.characterId || (dashboard?.event.id === id ? selectedCharacterId : null);
    const query = characterId ? `?${new URLSearchParams({ characterId })}` : '';
    const result = await request(`${base(id)}${query}`);
    if (!currentContext(generation, who, id)) return;
    dashboard = result; rememberFieldContext(result); selectedCharacterId = result.character?.id || null; detail = null;
    selectedReadings.clear(); selectedItems.clear(); selectedResources.clear(); offerDirty = false; offerConflict = false; draftVersion = null;
    if (options.exchangeId && selectedCharacterId) {
      const exchange = await request(`${base(id)}/${options.exchangeId}?${new URLSearchParams({ characterId: selectedCharacterId })}`);
      if (!currentContext(generation, who, id)) return;
      applyDetail(exchange, false);
    }
    state.view = 'exchanges'; render();
  }
  async function refresh({ quiet = false } = {}) {
    if (!dashboard || !connected()) return;
    const who = ensureAccount(), id = eventId(), characterId = selectedCharacterId, exchangeId = detail?.id, generation = ++epoch;
    stopPolling();
    const result = await request(`${base(id)}${characterId ? `?${new URLSearchParams({ characterId })}` : ''}`);
    if (!currentContext(generation, who, id)) return;
    dashboard = result; rememberFieldContext(result); selectedCharacterId = result.character?.id || null;
    if (exchangeId && selectedCharacterId) {
      const exchange = await request(`${base(id)}/${exchangeId}?${new URLSearchParams({ characterId: selectedCharacterId })}`);
      if (!currentContext(generation, who, id)) return;
      applyDetail(exchange, true);
    } else detail = null;
    render(); if (!quiet) toast('Exchange information refreshed.');
  }
  function schedulePoll() {
    stopPolling();
    if (!detail || !activeStatuses.has(detail.status) || !connected() || document.hidden || state.view !== 'exchanges') return;
    clockTimer = setInterval(updateClock, 1000);
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      if (pollBusy || pendingRequest?.sending || !connected() || document.hidden || state.view !== 'exchanges' || !detail) { schedulePoll(); return; }
      pollBusy = true;
      const who = accountId, id = eventId(), exchangeId = detail.id, characterId = selectedCharacterId, generation = epoch;
      try {
        const result = await request(`${base(id)}/${exchangeId}?${new URLSearchParams({ characterId })}`);
        if (!currentContext(generation, who, id) || detail?.id !== exchangeId) return;
        const changed = result.exchange.version !== detail.version || result.exchange.status !== detail.status;
        if (changed) {
          const overview = await request(`${base(id)}?${new URLSearchParams({ characterId })}`);
          if (!currentContext(generation, who, id) || detail?.id !== exchangeId) return;
          dashboard = overview; rememberFieldContext(overview);
        }
        applyDetail(result, true); render({ preserveInteraction: true });
      } catch (error) {
        if (currentContext(generation, who, id) && state.view === 'exchanges') {
          const indicator = document.querySelector('#exchange-live-status'); if (indicator) indicator.textContent = 'Could not refresh. Use Refresh to check the latest state.';
        }
      } finally { pollBusy = false; schedulePoll(); }
    }, 5000);
  }
  function updateClock() {
    const element = document.querySelector('#exchange-deadline');
    if (element && detail) element.textContent = deadlineText(detail.expiresAt);
    if (isExpired()) {
      document.querySelectorAll('#exchange-offer-form button[type="submit"], [data-action="exchange-confirm"]').forEach((button) => { button.disabled = true; });
    }
  }
  function deadlineText(expiresAt) {
    const seconds = Math.max(0, Math.ceil((Date.parse(expiresAt) - now()) / 1000));
    return seconds ? `Expires in ${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s` : 'Time elapsed · refresh to check the final status';
  }
  function characterPicker() {
    const choices = [...(dashboard.characters || [])];
    if (dashboard.character && !choices.some((character) => character.id === dashboard.character.id)) choices.push(dashboard.character);
    if (!choices.length) return `<section class="empty"><h2>Choose your place in the story first.</h2><p>${esc(dashboard.message || 'You need an approved character assigned to you before you can exchange information.')}</p><button class="primary" data-action="character-open">Open characters</button></section>`;
    return `<form id="exchange-character-form" class="exchange-character-picker">${err}<label>Exchanging as<select name="characterId">${choices.map((character) => `<option value="${esc(character.id)}" ${character.id === selectedCharacterId ? 'selected' : ''}>${esc(character.name)}</option>`).join('')}</select></label><button type="submit">Use character</button></form>`;
  }
  function pendingBanner() {
    if (!pendingRequest) return '';
    return `<section class="exchange-pending" role="status"><h3>${pendingRequest.sending ? 'Checking your exchange…' : 'This action has no confirmed response yet.'}</h3><p>${pendingRequest.sending ? 'Wait for the server to confirm the result.' : 'Retry sends exactly the same action. ORACLE will recover its current result without making a second exchange.'}</p>${!pendingRequest.sending ? `<button class="primary mt" data-action="exchange-retry" ${!connected() ? 'disabled' : ''}>Retry pending action</button>` : ''}</section>`;
  }
  function publicIdentity(character, compact = false) {
    if (!character) return '<p class="hint">Character unavailable.</p>';
    const profile = character.profile || {}, initials = (profile.name || '?').trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
    const portrait = profile.portrait ? `<img class="exchange-avatar" src="${esc(profile.portrait)}" alt="Portrait of ${esc(profile.name)}">` : `<span class="exchange-avatar" aria-hidden="true">${esc(initials)}</span>`;
    const skills = profile.skills?.map((id) => state.event?.setup?.rules?.expertise?.find((skill) => skill.id === id)?.name || id);
    return `<div class="exchange-identity">${portrait}<div><h3>${esc(profile.name)}</h3>${profile.pronouns ? `<p class="hint">${esc(profile.pronouns)}</p>` : ''}${profile.faction ? `<p class="hint">${esc(profile.faction.name)}</p>` : ''}</div></div>${!compact && profile.biography ? `<p class="prose exchange-biography">${esc(profile.biography)}</p>` : ''}${!compact && skills?.length ? `<p class="hint">${skills.map(esc).join(' · ')}</p>` : ''}`;
  }
  function sessionCard(session) {
    return `<button class="exchange-session" data-action="exchange-session" data-id="${esc(session.id)}"><span><strong>${esc(session.partner ? nameOf(session.partner) : session.status === 'waiting' ? 'Your invitation' : 'Exchange')}</strong><span class="hint">${esc(date(session.updatedAt))}</span></span>${status(session.status)}${session.ownConfirmed || session.partnerConfirmed ? `<span class="hint">You: ${session.ownConfirmed ? 'confirmed' : 'not confirmed'} · Partner: ${session.partnerConfirmed ? 'confirmed' : 'not confirmed'}</span>` : ''}</button>`;
  }
  function overview() {
    const active = dashboard.sessions.filter((session) => activeStatuses.has(session.status)), recent = dashboard.sessions.filter((session) => !activeStatuses.has(session.status));
    return `${characterPicker()}${dashboard.character ? `<div class="exchange-start-actions"><button class="primary" data-action="exchange-create" ${dashboard.readOnly || pendingRequest ? 'disabled' : ''}><strong>Show my QR</strong><span>Create a temporary exchange invitation</span></button><button data-action="exchange-scan" ${dashboard.readOnly || pendingRequest ? 'disabled' : ''}><strong>Scan player</strong><span>Use their exchange QR or 12-character code</span></button></div>${dashboard.readOnly ? `<p class="exchange-banner">${esc(dashboard.message || 'Exchanges can begin while this event is live or in rehearsal, using an approved character.')}</p>` : ''}<section class="exchange-section"><div class="panel-head"><h2>Pending exchanges</h2><span class="hint">${active.length}</span></div>${active.length ? `<div class="exchange-session-list">${active.map(sessionCard).join('')}</div>` : '<p class="hint">Your invitations and exchanges awaiting confirmation will appear here.</p>'}</section><details class="panel exchange-section"><summary>Recent exchanges · ${recent.length}</summary>${recent.length ? `<div class="exchange-session-list mt">${recent.map(sessionCard).join('')}</div>` : '<p class="hint">No completed or closed exchanges yet.</p>'}<p class="hint mt">The most recent exchanges are shown here.</p></details>${contacts()}${fieldActions()}` : ''}`;
  }
  function contacts() {
    return `<details class="panel exchange-section"><summary>Contacts · ${dashboard.contacts.length}</summary><p class="hint">Characters you met through an exchange both players confirmed.</p>${dashboard.contacts.length ? `<div class="exchange-contacts mt">${dashboard.contacts.map((contact) => `<details class="exchange-contact"><summary>${esc(nameOf(contact.character))}</summary>${publicIdentity(contact.character)}<p class="hint mt">Met ${esc(date(contact.metAt))}</p></details>`).join('')}</div>` : '<p class="hint mt">Complete an introduction or exchange to add your first contact.</p>'}</details>`;
  }
  function fieldActions(offlineView = false) {
    if (!ctx.queueFieldRequest || !dashboard?.character) return '';
    return `<section class="exchange-local-actions"><h3>Save for reconnecting</h3><p class="hint">${offlineView ? `Last checked ${esc(date(fieldContextAt))}: ${esc(dashboard.character.name)}. ` : ''}Save an information-only request on this device, then review and send it explicitly from the Field desk. Nothing is transmitted now; both players still confirm the exchange online.</p><div class="actions"><button type="button" data-action="exchange-queue-create" ${!canQueueField() ? 'disabled' : ''}>Save invitation request</button><button type="button" data-action="exchange-queue-join" ${!canQueueField() ? 'disabled' : ''}>Save a join code</button>${detail ? `<button type="button" data-action="exchange-queue-offer" ${!canQueueOffer() ? 'disabled' : ''}>Save reading-only offer</button>` : ''}${ctx.openField ? '<button type="button" class="quiet" data-action="exchange-field">Open Field desk</button>' : ''}</div>${detail ? `<p class="hint">${canQueueOffer() ? `${selectedReadings.size} selected reading IDs and offer revision ${draftVersion} will be saved; reading text stays out of the request store.` : 'A queued offer requires an unexpired, reviewed exchange with no selected or saved assets on either side. Review trading terms online.'}</p>` : ''}</section>`;
  }
  async function queueField(kind, payload, characterId = selectedCharacterId) {
    if (!canQueueField()) throw new Error('Resolve the pending action and choose a checked character before saving locally.');
    const who = accountId, id = eventId(), generation = epoch;
    fieldQueueBusy = true;
    try {
      await fieldContextReady;
      if (!currentContext(generation, who, id)) throw new Error('Your account or event changed. Open the checked character again.');
      const row = await ctx.queueFieldRequest({ eventId: id, characterId, kind, payload, label: ({ create: 'Information-exchange invitation', join: 'Join an information exchange', offer: 'Reading-only exchange offer' })[kind] });
      if (!currentContext(generation, who, id)) return row;
      if (kind === 'offer') { offerDirty = false; selectedReadings = new Set(detail.own.offered.map(reading => reading.id)); restoreAssets(detail.own.assets); draftVersion = detail.version; }
      feedback = 'Saved on this device, not sent. Open the Field desk to review and send the original request after reconnecting.';
      render({ preserveInteraction: true }); return row;
    } finally { fieldQueueBusy = false; if (currentContext(generation, who, id) && state.view === 'exchanges') render({ preserveInteraction: true }); }
  }
  async function saveJoinRequest(form) {
    if (!form || scanBusy) throw new Error('Wait for the current code lookup to finish.');
    const data = new FormData(form), parsed = parseExchangeInput(String(data.get('code') || ''), location.origin, eventId());
    if (parsed.eventId !== eventId()) throw new Error('Choose the event named by this exchange link before saving it.');
    const characterId = String(data.get('characterId') || '');
    if (!dashboard.characters.some(row => row.id === characterId)) throw new Error('Choose one of your last checked approved characters.');
    stopCamera(); await queueField('join', { characterId, code: parsed.code }, characterId);
    scannerDirty = false; closeModal(true);
  }
  function qrInvitation() {
    if (!detail.code || detail.status !== 'waiting') return '';
    return `<section class="exchange-invitation"><div><h2>Let the other player scan this.</h2><p class="hint">This invitation admits one player from your event. They will choose what to offer after joining.</p><p id="exchange-deadline" class="exchange-deadline" role="status">${esc(deadlineText(detail.expiresAt))}</p><p class="hint">An exchange QR starts a conversation. Both players still need to confirm the final offer.</p></div><div class="exchange-qr-card"><div id="exchange-qr" class="exchange-qr" aria-label="Temporary exchange invitation QR code"></div><p id="exchange-code" class="exchange-code">${esc(formatCode(detail.code))}</p><button class="quiet" data-action="exchange-copy-code">Copy code</button></div></section>`;
  }
  function availableReadings() {
    const result = [...(dashboard.readings || [])];
    for (const reading of detail.own.offered) if (!result.some((entry) => entry.id === reading.id)) result.push({ ...reading, shareable: false, policy: 'restricted' });
    return result;
  }
  function assetOptions(editable) {
    const enabled = state.event?.setup?.enabledInstruments?.includes('bazaar');
    const items = [...(dashboard.inventory || [])], resources = [...(dashboard.resources || [])];
    for (const offered of selectedItems.values()) if (!items.some(item => item.id === offered.itemId)) items.push({ id: offered.itemId, name: offered.name || 'Unavailable item', quantity: 0, version: offered.version, unavailable: true });
    for (const offered of selectedResources.values()) if (!resources.some(resource => resource.id === offered.resourceId)) resources.push({ id: offered.resourceId, name: offered.name || 'Unavailable resource', unavailable: true });
    if (!enabled && !selectedItems.size && !selectedResources.size) return '<p class="hint mt">Organizers can enable BAZAAR to add items and resources to exchanges.</p>';
    return `<details class="exchange-asset-picker" open><summary>Offer items and resources</summary><p class="hint">Offer up to 10 item rows and 20 resource types. Enter whole quantities; zero leaves an asset out. Only these selected terms are shown to your partner. Assets stay yours until both players confirm and the server completes every transfer.</p>${!enabled ? '<p class="exchange-banner">BAZAAR is disabled. Remove the asset offers to continue with a reading exchange.</p>' : ''}${items.length ? `<h4 class="mt">Inventory</h4><div class="exchange-asset-options">${items.map(item => `<label class="exchange-asset-option"><span><strong>${esc(item.name)}</strong><span class="hint">${quantityLabel(item.quantity)} available${item.unavailable ? ' · Remove unavailable item' : selectedItems.has(item.id) && selectedItems.get(item.id).version !== item.version ? ' · Inventory changed; review before saving' : ''}</span></span><input type="number" inputmode="numeric" step="1" min="0" max="${Math.max(item.quantity, Number(selectedItems.get(item.id)?.quantity) || 0)}" name="item-${esc(item.id)}" data-trade-item="${esc(item.id)}" data-item-version="${item.version}" value="${esc(selectedItems.get(item.id)?.quantity || '0')}" aria-label="Quantity of ${esc(item.name)} to offer" ${!editable ? 'disabled' : ''}></label>`).join('')}</div>` : '<p class="hint mt">No inventory items are available.</p>'}${resources.length ? `<h4 class="mt">Resources</h4><div class="exchange-asset-options">${resources.map(resource => { const balance = dashboard.balances?.find(row => row.resourceId === resource.id); return `<label class="exchange-asset-option"><span><strong>${esc(resource.name)}</strong><span class="hint">${quantityLabel(balance?.quantity)} available${resource.unavailable ? ' · Remove unavailable resource' : ''}</span></span><input type="number" inputmode="numeric" step="1" min="0" max="${Math.max(balance?.quantity || 0, Number(selectedResources.get(resource.id)?.quantity) || 0)}" name="resource-${esc(resource.id)}" data-trade-resource="${esc(resource.id)}" value="${esc(selectedResources.get(resource.id)?.quantity || '0')}" aria-label="Quantity of ${esc(resource.name)} to offer" ${!editable ? 'disabled' : ''}></label>`; }).join('')}</div>` : ''}${detail.own.assets?.valid === false ? '<div class="exchange-banner"><p>Your saved assets changed or are no longer available. Review current inventory, remove unavailable entries and save a fresh offer.</p><button type="button" class="mt" data-action="exchange-refresh-assets">Review current inventory</button></div>' : ''}</details>`;
  }
  function assetTitles(assets, emptyText = 'No items or resources.') {
    const lines = [...(assets?.items || []).map(item => `${quantityLabel(item.quantity)} × ${item.name}`), ...(assets?.resources || []).map(resource => `${quantityLabel(resource.quantity)} ${resource.name}`)];
    return lines.length ? `<ul class="exchange-title-list exchange-assets-list">${lines.map(line => `<li>${esc(line)}</li>`).join('')}</ul>` : `<p class="hint">${emptyText}</p>`;
  }
  function ownOffer() {
    const readings = availableReadings(), editable = canWrite();
    return `<section class="panel exchange-offer"><p class="eyebrow">Your public identity</p>${publicIdentity(detail.own.character, true)}<form id="exchange-offer-form">${err}<details class="exchange-offer-picker" open><summary>Choose readings to offer</summary><p class="hint">Share up to 10 discovered readings. Their full text and any audio will be copied only after both players confirm. Leave everything empty for an introduction.</p><p id="exchange-selection-count" class="hint">${selectedReadings.size} of 10 selected</p>${readings.length ? `<div class="exchange-reading-options">${readings.map((reading) => `<label class="exchange-reading-option"><input type="checkbox" name="readingIds" value="${esc(reading.id)}" data-shareable="${reading.shareable ? 'true' : 'false'}" ${selectedReadings.has(reading.id) ? 'checked' : ''} ${!editable || (!reading.shareable && !selectedReadings.has(reading.id)) || (selectedReadings.size >= 10 && !selectedReadings.has(reading.id)) ? 'disabled' : ''}><span><strong>${esc(reading.title)}</strong><span class="hint">${esc(typeNames[reading.type] || 'Reading')}${!reading.shareable ? ' · Not available to share' : ''}</span></span></label>`).join('')}</div>` : '<p class="hint">You have no readings to offer yet. You can still introduce your character or offer assets.</p>'}</details>${assetOptions(editable)}<p id="exchange-offer-save-status" class="save-status" role="status">${offerDirty ? 'Unsaved offer changes' : 'Offer saved'}</p>${offerConflict ? '<div class="exchange-banner"><p>This exchange changed while you were editing. Your selection has been preserved. Review both sides before applying it to the updated offer.</p><button type="button" class="mt" data-action="exchange-review-latest">Keep my selection for this revision</button></div>' : ''}<button type="submit" class="primary" ${!editable || !offerDirty || offerConflict ? 'disabled' : ''}>Save my offer</button>${ctx.queueFieldRequest ? `<button type="button" class="quiet mt" data-action="exchange-queue-offer" ${!canQueueOffer() ? 'disabled' : ''}>Save reading-only offer for reconnecting</button><p class="hint mt">Only selected reading IDs and the reviewed revision are saved locally. No asset offer or confirmation can be queued.</p>` : ''}</form><p class="hint mt">Changing either saved offer clears both confirmations.</p></section>`;
  }
  function offerTitles(readings, emptyText) { return readings.length ? `<ul class="exchange-title-list">${readings.map((reading) => `<li>${esc(reading.title)}</li>`).join('')}</ul>` : `<p class="hint">${emptyText}</p>`; }
  function partnerOffer() {
    return `<section class="panel exchange-offer"><p class="eyebrow">Their public identity</p>${detail.partner ? `${publicIdentity(detail.partner.character)}<h3 class="mt">Their saved offer</h3>${offerTitles(detail.partner.offered, 'No readings offered.')}${assetTitles(detail.partner.assets)}<p class="hint mt">You can read offered material after both players confirm.</p>` : detail.status === 'waiting' ? '<h3 class="mt">Waiting for the other player.</h3><p class="hint">They will appear here after joining your invitation.</p>' : '<h3 class="mt">Partner unavailable.</h3><p class="hint">Their current public identity is unavailable for this exchange.</p>'}</section>`;
  }
  function confirmation() {
    return `<section class="panel exchange-review"><div class="panel-head"><h2>Review the exchange</h2><span class="hint">Offer revision ${detail.version}</span></div><p class="hint">Both public identities will be shared. Review every saved reading, item and resource quantity. All agreed transfers succeed together or none do.</p><div class="exchange-review-columns"><section><h3>You will share</h3>${offerTitles(detail.own.offered, 'No readings.')}${assetTitles(detail.own.assets)}</section><section><h3>You will receive</h3>${detail.partner ? `${offerTitles(detail.partner.offered, 'No readings.')}${assetTitles(detail.partner.assets)}` : '<p class="hint">Waiting for a partner.</p>'}</section></div><div class="exchange-confirmations"><p><span aria-hidden="true">${detail.own.confirmed ? '✓' : '○'}</span> You: <strong>${detail.own.confirmed ? 'confirmed this offer' : 'not confirmed'}</strong></p><p><span aria-hidden="true">${detail.partner?.confirmed ? '✓' : '○'}</span> ${esc(detail.partner ? nameOf(detail.partner.character) : 'Partner')}: <strong>${detail.partner?.confirmed ? 'confirmed this offer' : 'not confirmed'}</strong></p></div>${detail.blockedReason ? `<p class="exchange-banner">${esc(detail.blockedReason)}</p>` : ''}<p id="exchange-confirm-help" class="hint">${offerDirty ? 'Save your offer changes before confirming.' : detail.own.confirmed ? 'Your confirmation is recorded. Waiting for the other player to confirm this same offer.' : 'Confirmation applies to this saved offer. A change requires both players to confirm again.'}</p><button class="primary mt" data-action="exchange-confirm" ${!canConfirm() ? 'disabled' : ''}>${detail.own.confirmed ? 'Your confirmation is recorded' : 'Confirm this exchange'}</button></section>`;
  }
  function receipt() {
    const record = detail.receipt;
    if (!record) return '<p class="exchange-banner">This exchange is complete. Refresh to load its receipt.</p>';
    return `<section class="panel exchange-receipt"><p class="eyebrow">Confirmed by both players</p><h2>Exchange complete</h2><p class="hint">${esc(date(record.completedAt))}</p>${record.introduced ? '<p class="mt">Your introduction is recorded in Contacts.</p>' : ''}<details class="exchange-receipt-sent mt"><summary>You shared · ${record.sent.length} readings</summary>${offerTitles(record.sent, 'An introduction with no readings.')}</details><h3 class="mt">You received</h3>${record.received.length ? `<div class="exchange-received-list">${record.received.map((reading) => `<article class="exchange-received"><h3>${esc(reading.title)}</h3><p class="hint">${reading.alreadyKnown ? 'Already in your journal · no duplicate added' : 'Saved to your journal'}</p><p class="prose mt">${esc(reading.text)}</p>${reading.audio ? `<audio controls preload="none" src="${esc(reading.audio)}" aria-label="Audio for ${esc(reading.title)}">Audio playback is unavailable.</audio>` : ''}</article>`).join('')}</div>` : '<p class="hint">An introduction with no readings.</p>'}${record.assets?.transactionId ? `<div class="exchange-review-columns mt"><section><h3>Assets sent</h3>${assetTitles(record.assets.sent)}</section><section><h3>Assets received</h3>${assetTitles(record.assets.received)}</section></div><p class="hint exchange-transaction-reference">Trade receipt ${esc(record.assets.transactionId)} · inventory and balances updated together.</p>` : ''}<p class="hint mt">Shared readings are saved in your journal. Reading exchanges do not grant adventure progress.</p><button class="primary mt" data-action="exchange-journal">Open journal in adventure</button></section>`;
  }
  function session() {
    const active = activeStatuses.has(detail.status);
    const partnerName = detail.partner ? nameOf(detail.partner.character) : detail.receipt?.partnerName;
    return `<header class="exchange-session-heading"><div><p class="eyebrow">Exchanging as ${esc(detail.character.name)}</p><h2>${partnerName ? `Exchange with ${esc(partnerName)}` : 'Your exchange invitation'}</h2></div>${status(detail.status)}</header>${active && !detail.code ? `<p id="exchange-deadline" class="exchange-deadline">${esc(deadlineText(detail.expiresAt))}</p>` : ''}${qrInvitation()}${detail.status === 'completed' ? receipt() : active ? `${detail.readOnly && !detail.blockedReason ? '<p class="exchange-banner">This exchange is read-only while play is paused or your character is unavailable.</p>' : ''}<div class="exchange-offer-columns">${ownOffer()}${partnerOffer()}</div>${confirmation()}` : `<section class="panel exchange-closed"><h2>${esc(statusNames[detail.status] || 'Exchange closed')}</h2><p class="hint">No material was transferred by this exchange.</p><button class="mt" data-action="exchange-overview">Back to exchanges</button></section>`}<div class="exchange-session-footer"><p id="exchange-live-status" class="hint">${active ? 'Checks for updates while this exchange is open.' : 'Server-confirmed exchange history.'}</p><div class="actions">${detail.canReject ? `<button class="quiet" data-action="exchange-reject" ${!connected() || pendingRequest ? 'disabled' : ''}>Decline exchange</button>` : ''}${detail.canCancel ? `<button class="quiet danger" data-action="exchange-cancel" ${!connected() || pendingRequest ? 'disabled' : ''}>Cancel exchange</button>` : ''}</div></div>`;
  }
  function captureInteraction() {
    const active = document.activeElement;
    return {
      focus: active ? { action: active.dataset?.action, id: active.dataset?.id, formId: active.closest?.('form')?.id, name: active.name, value: active.value, type: active.type } : null,
      disclosures: [...document.querySelectorAll('.exchanges-workspace details')].map((element) => ({ className: element.className, open: element.open })),
      readingScroll: document.querySelector('.exchange-reading-options')?.scrollTop || 0,
    };
  }
  function restoreInteraction(saved) {
    const disclosures = document.querySelectorAll('.exchanges-workspace details');
    saved.disclosures.forEach((item, index) => { if (disclosures[index]?.className === item.className) disclosures[index].open = item.open; });
    const options = document.querySelector('.exchange-reading-options'); if (options) options.scrollTop = saved.readingScroll;
    const focus = saved.focus; let element;
    if (focus?.formId) {
      const form = document.getElementById(focus.formId);
      element = focus.type === 'submit' ? form?.querySelector('button[type="submit"]') : [...(form?.querySelectorAll('[name]') || [])].find((item) => item.name === focus.name && item.value === focus.value);
    } else if (focus?.action) element = [...document.querySelectorAll('button[data-action]')].find((item) => item.dataset.action === focus.action && item.dataset.id === focus.id);
    if (element && !element.disabled) element.focus({ preventScroll: true });
  }
  function render({ preserveInteraction = false } = {}) {
    ensureAccount();
    if (state.view !== 'exchanges') { stopPolling(); return; }
    const interaction = preserveInteraction ? captureInteraction() : null;
    if (!dashboard || dashboard.event.id !== state.event?.id) { shell('<p role="status">Open an event to see its exchanges.</p>'); return; }
    const content = !connected() ? `<section class="empty"><h2>Live exchange review is offline.</h2><p>Saved invitation, join, and reading-only offer requests can wait for explicit review after reconnecting. Confirmations and asset trades require a live connection.</p><button data-action="offline-open">Open saved readings</button></section>${fieldActions(true)}` : detail ? session() : overview();
    shell(`<section class="exchanges-workspace"><div class="actions"><button class="quiet" data-action="${detail ? 'exchange-overview' : 'exchange-event'}">← ${detail ? 'All exchanges' : 'Event briefing'}</button></div><header class="page-head mt"><div><p class="eyebrow">${esc(dashboard.event.name)}</p><h1>Exchanges</h1><p class="muted">Meet another character, share readings and agree a trade.</p></div><button data-action="exchange-refresh" ${!connected() || pendingRequest?.sending ? 'disabled' : ''}>Refresh</button></header>${pendingBanner()}${feedback ? `<p class="exchange-feedback" role="status">${esc(feedback)}</p>` : ''}${content}</section>`);
    if (connected() && detail?.code && detail.status === 'waiting') {
      try { const canvas = renderBadgeQR(document.querySelector('#exchange-qr'), `${location.origin}/#exchange/${detail.event.id}/${detail.code}`, 256); canvas.setAttribute('aria-label', 'Temporary player exchange invitation QR code'); }
      catch { const qr = document.querySelector('#exchange-qr'); if (qr) qr.textContent = 'Use the invitation code below.'; }
    }
    if (interaction) restoreInteraction(interaction);
    schedulePoll();
  }
  async function runMutation(path, body, options = {}) {
    ensureAccount(); if (!connected()) throw new Error('Reconnect before changing an exchange.');
    if (pendingRequest && !options.retry) throw new Error('Retry the pending action before making another change.');
    const requestRecord = options.retry ? pendingRequest : { path, method: options.method || 'POST', body: { requestId: crypto.randomUUID(), ...body }, eventId: eventId(), characterId: body.characterId, exchangeId: detail?.id || null, kind: options.kind, sending: false };
    if (!requestRecord || requestRecord.sending) return;
    const who = accountId, id = requestRecord.eventId, generation = ++epoch;
    stopPolling(); requestRecord.sending = true; pendingRequest = requestRecord; feedback = null; render();
    try {
      const result = await request(requestRecord.path, requestRecord.method, requestRecord.body);
      if (!currentContext(generation, who, id)) return;
      pendingRequest = null;
      const modalStillCurrent = options.modalEpoch === undefined || options.modalEpoch === modalEpoch;
      if (modalStillCurrent) {
        applyDetail(result, requestRecord.kind !== 'offer'); feedback = result.outcome?.message || 'Exchange updated.';
        if (options.modalEpoch !== undefined) { scannerDirty = false; closeModal(true); }
      } else feedback = 'The invitation was joined. Refresh recent exchanges to continue.';
      try {
        const overview = await request(`${base(id)}?${new URLSearchParams({ characterId: requestRecord.characterId })}`);
        if (!currentContext(generation, who, id)) return;
        dashboard = overview; rememberFieldContext(overview); selectedCharacterId = overview.character?.id || requestRecord.characterId;
      } catch {
        if (currentContext(generation, who, id)) feedback = 'Your exchange action was confirmed. Refresh to update the recent exchanges and contacts list.';
      }
      if (currentContext(generation, who, id)) render();
    } catch (error) {
      if (!currentContext(generation, who, id)) return;
      requestRecord.sending = false;
      if (error.status >= 400 && error.status < 500) {
        pendingRequest = null; feedback = error.message;
        if (error.status === 409 && detail) {
          try {
            const [overview, exchange] = await Promise.all([request(`${base(id)}?${new URLSearchParams({ characterId: requestRecord.characterId })}`), request(`${base(id)}/${detail.id}?${new URLSearchParams({ characterId: requestRecord.characterId })}`)]);
            if (!currentContext(generation, who, id)) return;
            dashboard = overview; rememberFieldContext(overview); applyDetail(exchange, true);
          } catch { /* Keep the original error and let Refresh recover the current state. */ }
        }
      } else feedback = 'The connection did not confirm this action. Use Retry pending action to recover its result.';
      render();
    } finally {
      if (pendingRequest === requestRecord) { requestRecord.sending = false; if (state.view === 'exchanges' && accountId === who) render(); }
    }
  }
  async function retryPending() {
    const record = pendingRequest; if (!record) return;
    if (state.event?.id !== record.eventId || selectedCharacterId !== record.characterId) {
      await loadEvent(record.eventId); await open({ characterId: record.characterId, exchangeId: record.exchangeId });
    }
    await runMutation(record.path, record.body, { retry: true });
  }
  function scanModal(code = '', saveForReconnect = false) {
    cleanupModal();
    queueJoinMode = saveForReconnect;
    const characters = dashboard?.characters || [];
    openModal('Join a player’s exchange', `<p class="hint">Use their temporary exchange QR or 12-character code. A character badge QR is a separate public identity card.</p>${err}<div class="exchange-scanner"><video id="exchange-scanner-video" muted playsinline hidden></video><p id="exchange-scanner-status" class="hint" role="status">${code ? 'Invitation found. Check your character, then choose Join exchange.' : 'The camera stays off until you choose Start camera.'}</p><div class="actions"><button data-action="exchange-camera">Start camera</button><button data-action="exchange-camera-stop" hidden>Stop camera</button></div><label>Read a QR image<input id="exchange-scan-file" type="file" accept="image/png,image/jpeg,image/webp"></label><form id="exchange-join-form">${err}<label>Join as<select name="characterId" ${!characters.length ? 'disabled' : ''}>${characters.map((character) => `<option value="${esc(character.id)}" ${character.id === selectedCharacterId ? 'selected' : ''}>${esc(character.name)}</option>`).join('')}</select></label><label>Exchange code or link<input name="code" value="${esc(code ? formatCode(code) : '')}" required maxlength="500" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX"></label><p class="hint">Joining opens the offer review. Nothing is shared until you both confirm.</p><button class="primary" type="submit" ${!characters.length || pendingRequest || fieldQueueBusy || (!queueJoinMode && (!connected() || dashboard.readOnly)) ? 'disabled' : ''}>${queueJoinMode ? 'Save join request for reconnecting' : 'Join exchange'}</button>${ctx.queueFieldRequest && !queueJoinMode ? `<button type="button" class="quiet mt" data-action="exchange-save-join" ${!canQueueField() ? 'disabled' : ''}>Save join request for reconnecting</button>` : ''}${queueJoinMode ? '<p class="hint mt">This stores the code locally. It does not join or confirm the exchange. Codes can expire before reconnecting.</p>' : ''}${!characters.length ? '<p class="hint">An approved character assigned to you is needed for this event.</p>' : ''}</form></div>`);
    document.querySelector('#modal').classList.add('wide-modal'); scannerDirty = Boolean(code);
  }
  async function prepareInvitation(value, expectedEpoch) {
    const parsed = parseExchangeInput(value, location.origin, state.event?.id);
    if (!parsed.eventId) throw new Error('Open an event before entering an exchange code.');
    if (expectedEpoch !== undefined && expectedEpoch !== modalEpoch) return;
    const saveForReconnect = queueJoinMode;
    if (saveForReconnect && parsed.eventId !== eventId()) throw new Error('Choose the exchange link’s event while connected before saving its join request.');
    if (state.event?.id !== parsed.eventId || dashboard?.event.id !== parsed.eventId) {
      await loadEvent(parsed.eventId); if (expectedEpoch !== undefined && expectedEpoch !== modalEpoch) return;
      await open(); if (expectedEpoch !== undefined && expectedEpoch !== modalEpoch) return;
    }
    scanModal(parsed.code, saveForReconnect);
  }
  function scannerError(error) { const label = document.querySelector('#exchange-scanner-status'); if (label) label.textContent = error.message || String(error); else toast(error.message || 'This exchange code could not be read.'); }
  async function camera() {
    if (scannerController || scanBusy) return;
    const currentEpoch = modalEpoch, controller = new AbortController(), video = document.querySelector('#exchange-scanner-video');
    scannerController = controller; video.hidden = false; document.querySelector('#exchange-scanner-status').textContent = 'Requesting camera access…';
    document.querySelector('[data-action="exchange-camera"]').hidden = true; document.querySelector('[data-action="exchange-camera-stop"]').hidden = false;
    const stop = await startScanner(video, (value) => {
      if (currentEpoch !== modalEpoch) return; stopCamera(); if (scanBusy) return; scanBusy = true;
      void prepareInvitation(value, currentEpoch).catch((error) => { if (currentEpoch === modalEpoch) scannerError(error); }).finally(() => { if (currentEpoch === modalEpoch) scanBusy = false; });
    }, (error) => { if (currentEpoch === modalEpoch) { stopCamera(); scannerError(error); } }, { signal: controller.signal });
    if (controller.signal.aborted || currentEpoch !== modalEpoch) { stop(); return; }
    scannerStop = stop; document.querySelector('#exchange-scanner-status').textContent = 'Point the camera at the player’s exchange QR code.';
  }
  function stopCamera() {
    scannerController?.abort(); scannerController = null; scannerStop?.(); scannerStop = null;
    const video = document.querySelector('#exchange-scanner-video'); if (video) video.hidden = true;
    const start = document.querySelector('[data-action="exchange-camera"]'), stop = document.querySelector('[data-action="exchange-camera-stop"]');
    if (start) start.hidden = false; if (stop) stop.hidden = true;
  }
  function cleanupModal() { modalEpoch++; stopCamera(); scannerDirty = false; scanBusy = false; queueJoinMode = false; if (state.session?.user?.id !== accountId) ensureAccount(); }
  function confirmDiscard(scope) {
    if (fieldQueueBusy) { toast('Wait for the information request to finish saving locally.'); return false; }
    if (scope === 'modal') { if (scannerDirty && !window.confirm('Close this exchange invitation without joining?')) return false; return true; }
    if (offerDirty && !window.confirm('Discard your unsaved offer selection?')) return false;
    if (pendingRequest && !window.confirm('An action still needs a confirmed response. Keep this page open so you can return and retry it. Leave this exchange view?')) return false;
    if (detail) { selectedReadings = new Set(detail.own.offered.map((reading) => reading.id)); restoreAssets(detail.own.assets); draftVersion = detail.version; }
    offerDirty = false; offerConflict = false; return true;
  }
  async function handleHash() {
    if (!location.hash.startsWith('#exchange/') || !state.session?.user) return false;
    if (!confirmDiscard()) { history.replaceState(null, '', `${location.pathname}${location.search}`); return true; }
    try { await prepareInvitation(`${location.origin}/${location.hash}`); }
    catch (error) { toast(error.message || 'This exchange invitation could not be opened.'); }
    if (state.session?.user) history.replaceState(null, '', `${location.pathname}${location.search}`);
    return true;
  }
  async function action(button) {
    const actionName = button.dataset.action; if (!actionName?.startsWith('exchange-')) return false;
    ensureAccount();
    switch (actionName) {
      case 'exchange-open': await open(); break;
      case 'exchange-event': if (confirmDiscard()) { stopPolling(); await loadEvent(state.event.id); } break;
      case 'exchange-overview': if (confirmDiscard()) await open({ characterId: selectedCharacterId }); break;
      case 'exchange-session': if (confirmDiscard()) await open({ characterId: selectedCharacterId, exchangeId: button.dataset.id }); break;
      case 'exchange-refresh': if (confirmDiscard()) await refresh(); break;
      case 'exchange-refresh-assets': {
        if (!connected() || pendingRequest) throw new Error('Reconnect and resolve the pending action first.');
        await refresh({ quiet: true });
        if (!detail || state.view !== 'exchanges') break;
        for (const [id, item] of selectedItems) { const currentItem = dashboard.inventory?.find(row => row.id === id); if (currentItem) selectedItems.set(id, { ...item, name: currentItem.name, version: currentItem.version }); }
        draftVersion = detail.version; offerConflict = false; updateDirty(); feedback = 'Current inventory reviewed. Check quantities and save the new offer before confirming.'; render(); break;
      }
      case 'exchange-journal': if (confirmDiscard()) { stopPolling(); if (typeof ctx.openJournal !== 'function') throw new Error('Open the adventure to read this character’s journal.'); await ctx.openJournal(selectedCharacterId); } break;
      case 'exchange-create': if (!dashboard?.character || dashboard.readOnly) throw new Error('Choose an approved character during live play or rehearsal.'); await runMutation(base(), { characterId: selectedCharacterId }, { kind: 'create' }); break;
      case 'exchange-queue-create': await queueField('create', { characterId: selectedCharacterId }); break;
      case 'exchange-queue-join': if (!canQueueField()) throw new Error('Choose a checked character and resolve the pending action first.'); scanModal('', true); break;
      case 'exchange-save-join': await saveJoinRequest(document.querySelector('#exchange-join-form')); break;
      case 'exchange-queue-offer': if (!canQueueOffer()) throw new Error('A saved reading-only request requires reviewed, unexpired terms with no selected or saved assets on either side.'); await queueField('offer', { exchangeId: detail.id, version: draftVersion, readingIds: [...selectedReadings] }); break;
      case 'exchange-field': if (ctx.openField && confirmDiscard()) { stopPolling(); await ctx.openField(); } break;
      case 'exchange-scan': if (!connected() || pendingRequest) throw new Error('Reconnect and resolve any pending action before joining an exchange.'); scanModal(); break;
      case 'exchange-camera': void camera().catch(scannerError); break;
      case 'exchange-camera-stop': modalEpoch++; stopCamera(); document.querySelector('#exchange-scanner-status').textContent = 'Camera stopped. Enter a code or choose a QR image.'; break;
      case 'exchange-copy-code': try { await navigator.clipboard.writeText(formatCode(detail.code)); toast('Exchange code copied.'); } catch { const element = document.querySelector('#exchange-code'), range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); toast('Copy the selected code manually.'); } break;
      case 'exchange-review-latest': draftVersion = detail.version; offerConflict = false; render(); break;
      case 'exchange-confirm': if (!canConfirm()) throw new Error('Review and save the current offer before confirming.'); await runMutation(`${base()}/${detail.id}/confirm`, { characterId: selectedCharacterId, version: detail.version }, { kind: 'confirm' }); break;
      case 'exchange-cancel': case 'exchange-reject': {
        const kind = actionName === 'exchange-cancel' ? 'cancel' : 'reject';
        if (window.confirm(`${kind === 'cancel' ? 'Cancel' : 'Decline'} this exchange? No offered material will be transferred.`)) await runMutation(`${base()}/${detail.id}/${kind}`, { characterId: selectedCharacterId, version: detail.version }, { kind });
        break;
      }
      case 'exchange-retry': await retryPending(); break;
    }
    return true;
  }
  async function submit(form) {
    if (!form.id.startsWith('exchange-')) return false;
    const data = new FormData(form);
    if (form.id === 'exchange-character-form') { if (confirmDiscard()) await open({ characterId: data.get('characterId') }); }
    if (form.id === 'exchange-offer-form') {
      if (!canWrite() || offerConflict) throw new Error('Review the latest exchange before saving your offer.');
      if (selectedReadings.size > 10) throw new Error('Choose no more than 10 readings.');
      if ([...selectedReadings].some((id) => !dashboard.readings.some((reading) => reading.id === id && reading.shareable))) throw new Error('Remove readings that are no longer available to share.');
      await runMutation(`${base()}/${detail.id}/offer`, { characterId: selectedCharacterId, version: draftVersion, readingIds: [...selectedReadings], ...validatedAssets() }, { kind: 'offer', method: 'PUT' });
    }
    if (form.id === 'exchange-join-form') {
      if (queueJoinMode) { await saveJoinRequest(form); return true; }
      if (scanBusy) throw new Error('Wait for the current QR image to finish.');
      const parsed = parseExchangeInput(data.get('code'), location.origin, state.event?.id);
      if (parsed.eventId !== eventId()) { await prepareInvitation(data.get('code'), modalEpoch); return true; }
      const characterId = data.get('characterId'); if (!dashboard.characters.some((character) => character.id === characterId)) throw new Error('Choose an approved character assigned to you.');
      stopCamera(); scannerDirty = false; closeModal(true);
      await runMutation(`${base()}/join`, { characterId, code: parsed.code }, { kind: 'join' });
    }
    return true;
  }
  function validatedAssets() {
    const assets = selectedAssets(), whole = (value, max) => { if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > max) throw new Error('Offer positive whole quantities within your available inventory and balances.'); return Number(value); };
    if (assets.items.length > 10 || assets.resources.length > 20) throw new Error('Choose no more than 10 item rows and 20 resource types.');
    if ((assets.items.length || assets.resources.length) && !state.event?.setup?.enabledInstruments?.includes('bazaar')) throw new Error('Remove asset offers while BAZAAR is disabled.');
    return { items: assets.items.map(item => { const row = dashboard.inventory?.find(candidate => candidate.id === item.itemId); const quantity = whole(item.quantity, 9999); if (!row || row.version !== item.version || row.quantity < quantity) throw new Error('Review current inventory and remove unavailable item quantities before saving.'); return { itemId: item.itemId, version: item.version, quantity }; }), resources: assets.resources.map(resource => { const row = dashboard.balances?.find(candidate => candidate.resourceId === resource.resourceId); const quantity = whole(resource.quantity, 1000000000); if (!row || row.quantity < quantity) throw new Error('Your offered resource quantity exceeds the available balance.'); return { resourceId: resource.resourceId, quantity }; }) };
  }
  document.addEventListener('input', (event) => {
    if (event.target.closest('#exchange-join-form')) scannerDirty = true;
    const input = event.target;
    if (!input.closest('#exchange-offer-form') || !detail || pendingRequest || (!input.dataset.tradeItem && !input.dataset.tradeResource)) return;
    if (input.dataset.tradeItem) { const id = input.dataset.tradeItem, row = dashboard.inventory?.find(item => item.id === id); if (input.value === '0') selectedItems.delete(id); else selectedItems.set(id, { itemId: id, quantity: input.value, version: row?.version || Number(input.dataset.itemVersion), name: row?.name || selectedItems.get(id)?.name || 'Unavailable item' }); }
    else { const id = input.dataset.tradeResource, row = dashboard.resources?.find(resource => resource.id === id); if (input.value === '0') selectedResources.delete(id); else selectedResources.set(id, { resourceId: id, quantity: input.value, name: row?.name || selectedResources.get(id)?.name || 'Unavailable resource' }); }
    updateDirty();
    document.querySelector('#exchange-offer-save-status').textContent = offerDirty ? 'Unsaved offer changes' : 'Offer saved';
    document.querySelector('#exchange-offer-form button[type="submit"]').disabled = !canWrite() || !offerDirty || offerConflict;
    document.querySelector('[data-action="exchange-confirm"]').disabled = !canConfirm();
    document.querySelector('#exchange-confirm-help').textContent = offerDirty ? 'Save your offer changes before confirming.' : 'Confirmation applies to this saved offer. A change requires both players to confirm again.';
    document.querySelectorAll('[data-action="exchange-queue-offer"]').forEach(button => { button.disabled = !canQueueOffer(); });
  });
  document.addEventListener('change', async (event) => {
    if (event.target.closest('#exchange-offer-form') && event.target.name === 'readingIds') {
      const checkbox = event.target;
      if (checkbox.checked && (checkbox.dataset.shareable !== 'true' || selectedReadings.size >= 10)) { checkbox.checked = false; return; }
      if (checkbox.checked) selectedReadings.add(checkbox.value); else selectedReadings.delete(checkbox.value);
      updateDirty();
      document.querySelector('#exchange-selection-count').textContent = `${selectedReadings.size} of 10 selected`;
      document.querySelector('#exchange-offer-save-status').textContent = offerDirty ? 'Unsaved offer changes' : 'Offer saved';
      document.querySelector('#exchange-offer-form button[type="submit"]').disabled = !canWrite() || !offerDirty || offerConflict;
      document.querySelector('[data-action="exchange-confirm"]').disabled = !canConfirm();
      document.querySelector('#exchange-confirm-help').textContent = offerDirty ? 'Save your offer changes before confirming.' : 'Confirmation applies to this saved offer. A change requires both players to confirm again.';
      document.querySelectorAll('[data-action="exchange-queue-offer"]').forEach(button => { button.disabled = !canQueueOffer(); });
      document.querySelectorAll('#exchange-offer-form [name="readingIds"]').forEach((item) => { item.disabled = !canWrite() || (!item.checked && (item.dataset.shareable !== 'true' || selectedReadings.size >= 10)); });
    }
    if (event.target.id !== 'exchange-scan-file') return;
    const file = event.target.files?.[0]; if (!file || scanBusy) return;
    const currentEpoch = modalEpoch; stopCamera(); scanBusy = true; document.querySelector('#exchange-scanner-status').textContent = 'Reading the QR image…';
    try { const value = await scanImage(file); if (currentEpoch === modalEpoch) await prepareInvitation(value, currentEpoch); }
    catch (error) { if (currentEpoch === modalEpoch) scannerError(error); }
    finally { if (currentEpoch === modalEpoch) scanBusy = false; }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stopPolling(); stopCamera(); } else schedulePoll(); });
  window.addEventListener('pagehide', () => { stopPolling(); cleanupModal(); });
  window.addEventListener('beforeunload', (event) => { if (offerDirty || scannerDirty || pendingRequest) { event.preventDefault(); event.returnValue = ''; } });
  return { open, render, action, submit, handleHash, cleanupModal, confirmDiscard, isDirty: () => offerDirty || scannerDirty || Boolean(pendingRequest), reset };
}
