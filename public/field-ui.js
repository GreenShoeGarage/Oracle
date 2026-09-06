import { parseExchangeInput } from './exchange-code.js';

const emptyLocal = () => ({ accountId: null, scope: null, contexts: [], drafts: [], requests: [], lastChecked: null });
const when = value => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not checked';
const kindName = kind => ({ create: 'Create an information exchange', join: 'Join an information exchange', offer: 'Save a reading-only offer' })[kind] || 'Information request';
const stateName = row => row.stopped ? 'Retries stopped · outcome may be unknown' : ({ pending: 'Saved · never transmitted', sending: 'Checking with ORACLE', uncertain: 'Outcome uncertain · retry the same request', needs_review: 'Needs review', completed: 'Server confirmed' })[row.state] || 'Needs review';

export function createFieldUI(ctx) {
  const { state, api, shell, esc, openModal, closeModal, toast, loadEvent, store, sync, offline } = ctx;
  let local = emptyLocal(), accountId = null, selected = null, draftText = '', savedText = '', savedAt = null, savedRevision = null, draftConflict = null, joinCode = '', reviewAcknowledged = false;
  let epoch = 0, loading = false, busy = false, feedback = '', feedbackError = false, reviewId = null, printData = null, printSelection = new Set(), printEpoch = 0, queueBusy = false;
  const connected = () => navigator.onLine !== false;
  const signedIn = () => Boolean(state.session?.user?.id);
  const disabled = value => value ? 'disabled' : '';
  const scopeKey = value => value ? `${value.eventId}/${value.characterId}` : '';
  const contextFor = eventId => local.contexts.find(row => row.event.id === eventId);
  const characterFor = (eventId, characterId) => contextFor(eventId)?.characters.find(row => row.id === characterId);
  const current = token => token.epoch === epoch && token.accountId === accountId && (!state.session?.user?.id || state.session.user.id === accountId) && state.view === 'field';
  const token = () => ({ epoch, accountId });
  const dirty = () => draftText !== savedText;
  function capture() {
    const form = document.querySelector('#field-note-form'); if (form?.dataset.scope === scopeKey(selected) && !form.querySelector('textarea')?.disabled) draftText = form.querySelector('textarea').value;
    const join = document.querySelector('#field-join-form'); if (join?.dataset.scope === scopeKey(selected)) joinCode = join.querySelector('[name="code"]').value;
    const review = document.querySelector('#field-send-form'); if (review?.dataset.id === reviewId) reviewAcknowledged = Boolean(review.querySelector('[name="acknowledged"]')?.checked);
  }
  function cleanupModal() { printEpoch++; printData = null; printSelection.clear(); document.body.classList.remove('field-printing'); }
  function reset() { epoch++; cleanupModal(); local = emptyLocal(); accountId = null; selected = null; draftText = ''; savedText = ''; savedAt = null; savedRevision = null; draftConflict = null; joinCode = ''; reviewAcknowledged = false; loading = false; busy = false; feedback = ''; feedbackError = false; reviewId = null; }
  function confirmDiscard(destination) {
    if (destination === 'modal') return true;
    capture(); if (busy || queueBusy || sync?.busy) { toast('Wait for the current Field desk action to finish.'); return false; }
    if ((dirty() || joinCode) && !window.confirm('Leave the unsaved field note or unsubmitted join code? Save it on this device before leaving to keep it.')) return false;
    draftText = savedText; draftConflict = null; joinCode = ''; reviewId = null; reviewAcknowledged = false; cleanupModal(); return true;
  }
  function selectScope(value, preserve = false) {
    if (scopeKey(selected) !== scopeKey(value)) joinCode = '';
    selected = value;
    const entry = local.drafts.find(row => row.eventId === value?.eventId && row.characterId === value?.characterId);
    if (preserve && dirty()) { if ((entry?.revision || null) !== savedRevision && (entry?.text || '') !== savedText) draftConflict = entry || { text: '', updatedAt: null, revision: null }; return; }
    draftText = entry?.text || ''; savedText = draftText; savedAt = entry?.updatedAt || null; savedRevision = entry?.revision || null; draftConflict = null;
  }
  async function load({ preserve = true } = {}) {
    capture(); const before = token(), next = await store.loadLocal();
    if (before.epoch !== epoch || state.view !== 'field') return;
    const liveAccount = state.session?.user?.id || null;
    if (liveAccount && next.accountId && next.accountId !== liveAccount) { local = emptyLocal(); accountId = liveAccount; selected = null; draftText = savedText = ''; savedAt = null; savedRevision = null; draftConflict = null; joinCode = ''; reviewId = null; reviewAcknowledged = false; return; }
    if (accountId && next.accountId !== accountId) { draftText = savedText = ''; selected = null; savedAt = null; savedRevision = null; draftConflict = null; joinCode = ''; reviewId = null; reviewAcknowledged = false; cleanupModal(); }
    local = next; accountId = next.accountId || liveAccount;
    let nextScope = selected && characterFor(selected.eventId, selected.characterId) ? selected : null;
    if (!nextScope) { const context = local.contexts.find(row => row.event.id === state.event?.id && row.characters.length) || local.contexts.find(row => row.characters.length); if (context) nextScope = { eventId: context.event.id, characterId: context.characters[0].id }; }
    selectScope(nextScope, preserve && scopeKey(nextScope) === scopeKey(selected));
    if (reviewId && !local.requests.some(row => row.id === reviewId)) reviewId = null;
  }
  async function rememberContext(event, characters, scope) {
    const who = state.session?.user?.id; if (!who || !connected() || !event?.id || !Array.isArray(characters)) return null;
    if (!scope || scope.accountId !== who || state.session?.user?.id !== who) return null;
    return store.saveContext({ scope, accountId: who, event: { id: event.id, name: event.name }, characters: characters.map(row => ({ id: row.id, name: row.name })) });
  }
  async function checkContext() {
    if (!signedIn() || !connected() || !state.event?.id) throw new Error('Open an event while signed in and connected to check your own characters.');
    const who = state.session.user.id, id = state.event.id;
    const session = await api('/api/session', 'GET', undefined, { expectedAccount: who });
    if (session.user?.id !== who || state.session?.user?.id !== who) throw new Error('Reconnect with the account that is currently signed in.');
    await store.setAccount(who);
    const scope = await store.captureScope();
    if (!scope || scope.accountId !== who) throw new Error('Reconnect to establish this account’s local scope.');
    const result = await api(`/api/events/${id}/adventure/play`, 'GET', undefined, { expectedAccount: who });
    if (state.session?.user?.id !== who || state.event?.id !== id) return;
    await store.saveContext({ scope, accountId: who, event: { id: result.event.id, name: result.event.name }, characters: result.characters.map(row => ({ id: row.id, name: row.name })) });
  }
  async function open(options = {}) {
    if (state.view === 'field' && !confirmDiscard()) return;
    epoch++; cleanupModal(); state.view = 'field'; loading = true; feedback = ''; feedbackError = false;
    if (options.eventId && options.characterId) selected = { eventId: options.eventId, characterId: options.characterId };
    render();
    try { await load({ preserve: false }); loading = false; render(); }
    catch (error) { loading = false; feedback = error.message || 'Local field data is unavailable in this browser.'; feedbackError = true; render(); }
  }
  async function queue(input) {
    if (queueBusy) throw new Error('Wait for the request to finish saving.');
    queueBusy = true;
    try {
      const scope = await store.captureScope();
      if (!scope || state.session?.user?.id && state.session.user.id !== scope.accountId) throw new Error('Open this character while connected before saving a request on this device.');
      const result = await store.enqueueRequest({ scope, accountId: scope.accountId, eventId: input.eventId, characterId: input.characterId, kind: input.kind, payload: input.payload, label: input.label || kindName(input.kind) });
      toast('Saved on this device. Review and send it from the Field desk after reconnecting.');
      if (state.view === 'field') { await load(); feedback = 'Request saved locally. It has not been sent to ORACLE.'; feedbackError = false; render(); }
      return result;
    } finally { queueBusy = false; }
  }
  async function saveNote() {
    capture(); if (!selected || busy || draftConflict) return;
    busy = true; const context = token(), choice = { ...selected }, text = draftText;
    try {
      const scope = await store.captureScope(); if (!scope || scope.accountId !== accountId) throw new Error('This device’s account scope changed. Reopen the Field desk.');
      const saved = await store.saveDraft({ scope, accountId, ...choice, text, expectedRevision: savedRevision });
      if (!current(context) || scopeKey(choice) !== scopeKey(selected)) return;
      savedText = text; savedAt = saved.updatedAt; savedRevision = saved.revision; await load(); feedback = 'Field note saved on this device. It has not been added to your online journal.'; feedbackError = false;
    } catch (error) { if (current(context)) { feedback = error.message; feedbackError = true; if (error.status === 409) await load(); } }
    finally { busy = false; if (current(context)) render(); }
  }
  function scopePicker() {
    const choices = local.contexts.flatMap(row => row.characters.map(character => ({ value: `${row.event.id}/${character.id}`, name: `${row.event.name} · ${character.name}` })));
    return choices.length ? `<form id="field-scope-form" class="field-scope-picker"><label>Local event and character<select name="scope" ${disabled(busy || Boolean(sync?.busy))}>${choices.map(row => `<option value="${esc(row.value)}" ${row.value === scopeKey(selected) ? 'selected' : ''}>${esc(row.name)}</option>`).join('')}</select></label><button type="submit" ${disabled(busy || Boolean(sync?.busy))}>Use this scope</button></form><p class="hint">Own character labels last checked ${esc(when(contextFor(selected?.eventId)?.lastChecked))}. This saved context does not confirm current event access.</p>` : '<section class="empty"><h2>No own character context saved yet.</h2><p>Open an event and choose Check my characters while connected. Only approved characters assigned to your account can be used for local notes and queued requests.</p></section>';
  }
  function noteView() {
    if (!selected) return '';
    return `<section class="panel field-note"><div class="panel-head"><h2>Field note</h2><span id="field-note-status" class="save-status" role="status">${dirty() ? 'Unsaved text · this tab only' : savedAt ? `Saved ${esc(when(savedAt))}` : 'No saved note yet'}</span></div><p class="hint">A private note on this device for ${esc(characterFor(selected.eventId, selected.characterId)?.name || 'your character')}. This does not change character stats, discoveries, or the online journal.</p>${draftConflict ? `<section class="field-notice" role="alert"><h3>The saved note changed in another tab.</h3><p>Your typed text is retained. Review the saved copy before choosing which text to keep.</p><details><summary>Latest saved note · ${esc(when(draftConflict.updatedAt))}</summary><p class="field-copy">${esc(draftConflict.text)}</p></details><div class="actions mt"><button type="button" data-action="field-use-saved">Use saved copy</button><button type="button" data-action="field-keep-note">Keep my typed text for saving</button></div></section>` : ''}<form id="field-note-form" data-scope="${esc(scopeKey(selected))}"><label>Observations and handwritten follow-up<textarea name="text" rows="9" maxlength="12000" ${disabled(busy)}>${esc(draftText)}</textarea></label><div class="actions mt"><button type="submit" class="primary" ${disabled(busy || Boolean(draftConflict))}>Save note on this device</button>${savedAt ? `<button type="button" class="quiet" data-action="field-delete-note" ${disabled(busy)}>Delete saved note</button>` : ''}</div></form></section>`;
  }
  function queueComposer() {
    if (!selected) return '';
    return `<details class="panel field-compose"><summary>Save an information request for reconnecting</summary><p class="hint">These requests prepare an information exchange. Both players must still review and confirm online. Nothing sends automatically.</p><button type="button" class="mt" data-action="field-queue-create" ${disabled(busy || queueBusy)}>Save invitation request</button><form id="field-join-form" data-scope="${esc(scopeKey(selected))}" class="mt"><label>Temporary exchange code or ORACLE link<input name="code" value="${esc(joinCode)}" maxlength="500" required autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX"></label><button type="submit" class="mt" ${disabled(busy || queueBusy)}>Save join request</button></form><p class="hint mt">Invitation codes can expire before reconnecting. Reading-only offers can be saved from a currently opened exchange. Item trades, confirmations, timers, scene admission, and staff actions require a live connection.</p></details>`;
  }
  function requestView(row) {
    const context = contextFor(row.eventId), character = characterFor(row.eventId, row.characterId), canSend = !row.stopped && ['pending', 'uncertain'].includes(row.state), reviewing = reviewId === row.id;
    return `<article class="field-request" data-request-id="${esc(row.id)}"><div class="panel-head"><h3>${esc(row.label || kindName(row.kind))}</h3><span class="badge">${esc(stateName(row))}</span></div><p>${esc(context?.event.name || 'Saved event')} · ${esc(character?.name || 'Saved character')}</p><p class="hint">Saved ${esc(when(row.createdAt))} · Local review deadline ${esc(when(row.expiresAt))}</p>${row.attemptedAt ? `<p class="hint">First transmission attempt ${esc(when(row.attemptedAt))}</p>` : '<p class="hint">No transmission has been recorded on this device.</p>'}${row.kind === 'join' ? `<p>Invitation code: <code>${esc(row.payload.code)}</code></p>` : row.kind === 'offer' ? `<p>${row.payload.readingIds.length} selected reading${row.payload.readingIds.length === 1 ? '' : 's'} · Offer revision ${row.payload.version}. No items or resources are included.</p>` : '<p>Creates a temporary information-exchange invitation after authorization is checked.</p>'}${row.message ? `<p class="field-notice">${esc(row.message)}</p>` : ''}${row.state === 'uncertain' || row.stopped ? '<p class="field-notice">ORACLE may already have received this request. Its original identifier is retained; stopping local retries does not cancel anything on the server.</p>' : ''}${row.state === 'needs_review' ? '<p class="hint">Open current exchanges to review expiry, access, or changed terms. This saved payload will not be repaired or confirmed automatically.</p>' : ''}${reviewing ? `<form id="field-send-form" data-id="${esc(row.id)}" class="field-send-review"><h4>Review this saved request</h4><p>ORACLE will check your current signed-in account, event access, character assignment, and exchange policy before sending this exact stored request. The selected payload will remain unchanged.</p><label class="check-line"><input type="checkbox" name="acknowledged" required ${reviewAcknowledged ? 'checked' : ''} ${disabled(busy || Boolean(sync?.busy))}><span>I reviewed this request and want to ${row.state === 'uncertain' ? 'retry its original transmission' : 'send it now'}.</span></label><div class="actions mt"><button type="submit" class="primary" ${disabled(!connected() || !signedIn() || busy || Boolean(sync?.busy) || !canSend)}>Check access and ${row.state === 'uncertain' ? 'retry' : 'send'}</button><button type="button" data-action="field-close-review">Close review</button></div></form>` : ''}<div class="actions mt">${canSend && !reviewing ? `<button type="button" class="primary" data-action="field-review" data-id="${esc(row.id)}" ${disabled(!connected() || !signedIn() || busy || Boolean(sync?.busy))}>${row.state === 'uncertain' ? 'Review exact retry' : 'Review and send'}</button>` : ''}${row.state !== 'sending' && !row.stopped ? `<button type="button" class="quiet" data-action="field-cancel-request" data-id="${esc(row.id)}" ${disabled(busy || Boolean(sync?.busy))}>${row.state === 'completed' ? 'Remove local receipt' : row.attemptedAt ? 'Stop local retries' : 'Discard unsent request'}</button>` : ''}${connected() && signedIn() ? `<button type="button" class="quiet" data-action="field-exchanges" data-event-id="${esc(row.eventId)}" data-character-id="${esc(row.characterId)}">Open current exchanges</button>` : ''}</div></article>`;
  }
  function render() {
    if (state.view !== 'field') return;
    const mismatch = state.session?.user?.id && accountId && state.session.user.id !== accountId;
    if (mismatch) { reset(); accountId = state.session.user.id; }
    shell(`<section class="field-workspace"><header class="page-head"><div><p class="eyebrow">ORACLE · LARP Field Kit</p><h1>Field desk</h1><p class="muted">Keep local notes and review information requests when you reconnect.</p></div><div class="actions"><button type="button" data-action="field-refresh" ${disabled(busy)}>Refresh local view</button><button type="button" class="primary" data-action="offline-refresh" ${disabled(busy)}>Reconnect to ORACLE</button></div></header><p class="field-notice" role="status">${signedIn() && connected() ? 'Local device workspace. Saved contexts are historical; sending checks your current access again.' : 'Local view for the last checked account on this device. This is not an authenticated session and cannot confirm current event access.'} No queued request sends automatically.</p>${loading ? '<p role="status">Opening local field data…</p>' : ''}${feedback ? `<p class="field-feedback ${feedbackError ? 'error' : ''}" role="${feedbackError ? 'alert' : 'status'}">${esc(feedback)}</p>` : ''}<div class="actions mt">${signedIn() ? `<button type="button" data-action="field-check-context" ${disabled(!connected() || busy || !state.event?.id)}>Check my characters in this event</button>` : ''}<button type="button" data-action="offline-open">Open saved journal readings</button><button type="button" class="quiet" data-action="field-clear-device" ${disabled(busy || Boolean(sync?.busy))}>Clear device data</button></div>${scopePicker()}<div class="field-layout"><div class="field-stack">${noteView()}${queueComposer()}<details class="panel field-print-options"><summary>Prepare paper fallback aids</summary><p class="hint">A fresh online permission check is required. The paper is timestamped and historical; it does not authorize new inventory transfers, scene places, or discoveries.</p><div class="actions mt"><button type="button" data-action="field-player-aid" ${disabled(!selected || !connected() || !signedIn() || busy)}>Prepare player aid</button>${ctx.isManager?.() ? `<button type="button" data-action="field-organizer-aid" ${disabled(!state.event?.id || !connected() || !signedIn() || busy)}>Prepare organizer fallback list</button>` : ''}</div></details></div><section class="panel field-requests"><div class="panel-head"><h2>Saved information requests</h2><span class="hint">${local.requests.length} of 50</span></div><p class="hint">Pending, uncertain, review-needed, and confirmed requests remain separate. Each transmission uses its original request identifier.</p>${local.requests.map(requestView).join('') || '<p class="hint mt">No information requests are saved on this device.</p>'}</section></div></section>`);
  }
  async function sendRequest(id) {
    const row = local.requests.find(item => item.id === id); if (!row || busy || !connected() || !signedIn()) return;
    busy = true; capture(); const context = token(); render();
    try { const result = await sync.send(id); if (!current(context)) return; reviewId = null; feedback = result?.request?.state === 'completed' && result.result ? 'The server confirmed this request. Open current exchanges to review the result; both players still confirm the final exchange online.' : result?.request?.message || 'The request state has been updated. Review its status below.'; feedbackError = result?.request?.state !== 'completed'; await load(); }
    catch (error) { if (current(context)) { feedback = error.message || 'The request needs review before another attempt.'; feedbackError = true; await load(); } }
    finally { busy = false; if (current(context)) render(); }
  }
  async function freshPlayerAid(choice, who) {
    const result = await api(`/api/events/${choice.eventId}/adventure/play?${new URLSearchParams({ characterId: choice.characterId })}`, 'GET', undefined, { expectedAccount: who });
    if (result.preview || result.character?.id !== choice.characterId || !result.characters?.some(row => row.id === choice.characterId)) throw new Error('An approved character currently assigned to you is needed for a player aid.');
    return { kind: 'player', event: { id: result.event.id, name: result.event.name }, character: { id: result.character.id, name: result.character.name }, journal: result.journal.map(row => ({ id: row.id, title: row.title, text: row.text, createdAt: row.createdAt })), checkedAt: new Date().toISOString(), accountId: who };
  }
  async function freshOrganizerAid(id, who) {
    const result = await api(`/api/events/${id}/stagehand/manage`, 'GET', undefined, { expectedAccount: who });
    if (!result.canManage) throw new Error('Current organizer access is required to prepare this fallback list.');
    return { kind: 'organizer', event: { id: result.event.id, name: result.event.name }, characters: result.context.characters.map(row => ({ name: row.name })), scenes: result.context.nodes.map(node => { const linked = result.encounters.find(row => row.document.nodeId === node.id); return { title: node.title, capacity: linked?.capacity || node.maxPlayers, status: linked?.state || node.availability }; }), checkedAt: result.serverTime || new Date().toISOString(), accountId: who };
  }
  function aidMarkup() {
    if (!printData) return '';
    const head = `<header><p>ORACLE · LARP Field Kit</p><h1>${printData.kind === 'player' ? 'Player field aid' : 'Organizer fallback list'}</h1><h2>${esc(printData.event.name)}</h2><p>Checked ${esc(when(printData.checkedAt))} · Historical paper copy</p></header>`;
    const guidance = '<section><h2>When the connection drops</h2><ol><li>Write the time, scene or prop code, and observation below.</li><li>Use the Field desk for saved notes and information-only requests. Review and send them explicitly after reconnecting.</li><li>Ask event staff to resolve live scene admission or resource changes. Paper notes do not confirm game actions.</li></ol><p>Printed codes: character badges and instrument props use 20 characters; temporary exchange codes use 12. Choose the matching instrument when entering a code.</p></section>';
    const blankRows = count => Array.from({ length: count }, () => '<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>').join('');
    if (printData.kind === 'player') return `${head}<section><h2>${esc(printData.character.name)}</h2><p>Approved character assigned to this account when checked.</p></section>${guidance}${printData.journal.filter(row => printSelection.has(row.id)).map(row => `<article class="field-paper-reading"><h2>${esc(row.title)}</h2><p>Journal entry ${esc(when(row.createdAt))}</p><p class="field-copy">${esc(row.text)}</p></article>`).join('')}<section class="field-paper-tracking"><h2>Manual observations</h2><table><thead><tr><th>Time</th><th>Prop or scene code</th><th>Observation</th><th>Staff follow-up</th></tr></thead><tbody>${blankRows(8)}</tbody></table></section>`;
    return `${head}<p>Current approved character names and scene titles only. These historical lists reserve no seats and confirm no transfers. Record observations by hand and reconcile with authorized staff when connected.</p><section><h2>Character check-in</h2><table><thead><tr><th>Character</th><th>Time / location</th><th>Manual note</th><th>Staff initials</th></tr></thead><tbody>${printData.characters.map(row => `<tr><td>${esc(row.name)}</td><td></td><td></td><td></td></tr>`).join('') || blankRows(5)}</tbody></table></section><section class="field-paper-tracking"><h2>Scene fallback tracking</h2><table><thead><tr><th>Scene · checked state</th><th>Capacity when checked</th><th>Group / return note</th><th>Staff initials</th></tr></thead><tbody>${printData.scenes.map(row => `<tr><td>${esc(row.title)} · ${esc(row.status)}</td><td>${row.capacity}</td><td></td><td></td></tr>`).join('') || blankRows(5)}</tbody></table></section>`;
  }
  function renderAidModal() {
    openModal(printData.kind === 'player' ? 'Player aid preview' : 'Organizer fallback preview', `<p class="hint">This preview stays in memory. Print reads current authorization and content again; only the selected material enters the paper.</p>${printData.kind === 'player' ? `<details><summary>Include selected journal readings · optional, up to 20</summary><div class="field-journal-choices">${printData.journal.map(row => `<label class="check-line"><input type="checkbox" name="fieldJournalId" value="${esc(row.id)}" ${printSelection.has(row.id) ? 'checked' : ''}><span>${esc(row.title)}</span></label>`).join('') || '<p>No journal readings are currently available.</p>'}</div></details>` : ''}<article id="field-print-aid">${aidMarkup()}</article><p id="field-print-status" class="hint" role="status">Prepared ${esc(when(printData.checkedAt))}. Printed copies can become out of date.</p><div class="actions mt"><button type="button" class="primary" data-action="field-print">Recheck and print</button><button type="button" data-action="close">Close preview</button></div>`);
    document.querySelector('#modal')?.classList.add('wide-modal');
  }
  async function prepareAid(kind) {
    if (!connected() || !signedIn() || busy) return;
    capture(); const who = state.session.user.id, generation = ++printEpoch, context = token(), choice = selected ? { ...selected } : null; busy = true;
    try {
      const result = kind === 'player' ? await freshPlayerAid(choice, who) : await freshOrganizerAid(state.event.id, who);
      if (!current(context) || generation !== printEpoch || state.session?.user?.id !== who) return;
      printData = result; printSelection.clear(); renderAidModal();
    } catch (error) { if (current(context)) { feedback = error.message; feedbackError = true; render(); } }
    finally { busy = false; }
  }
  async function printAid() {
    if (!printData || busy || !connected() || state.session?.user?.id !== printData.accountId) { toast('Reconnect with the same account before printing.'); return; }
    const generation = printEpoch, previous = printData; busy = true;
    const label = document.querySelector('#field-print-status'); if (label) label.textContent = 'Rechecking current authorization and selected content…';
    try {
      const result = previous.kind === 'player' ? await freshPlayerAid({ eventId: previous.event.id, characterId: previous.character.id }, previous.accountId) : await freshOrganizerAid(previous.event.id, previous.accountId);
      if (generation !== printEpoch || state.session?.user?.id !== previous.accountId) return;
      printData = result; if (result.kind === 'player') printSelection = new Set([...printSelection].filter(id => result.journal.some(row => row.id === id)));
      document.querySelector('#field-print-aid').innerHTML = aidMarkup(); if (label) label.textContent = `Current access checked ${when(result.checkedAt)}.`;
      document.body.classList.add('field-printing'); window.print();
    } catch (error) { if (generation === printEpoch) { document.querySelector('#field-print-aid')?.replaceChildren(); printData = null; if (label) label.textContent = error.message || 'Current authorization could not be confirmed. Close and prepare a fresh aid.'; } }
    finally { busy = false; }
  }
  async function action(nameOrButton, buttonValue) {
    const button = typeof nameOrButton === 'string' ? buttonValue || { dataset: { action: nameOrButton } } : nameOrButton, name = typeof nameOrButton === 'string' ? nameOrButton : button?.dataset.action;
    if (!name?.startsWith('field-')) return false; capture();
    try {
      if (name === 'field-open') await open();
      else if (name === 'field-refresh') { await load(); render(); }
      else if (name === 'field-check-context') { await checkContext(); await load(); feedback = 'Own character labels checked and saved on this device.'; feedbackError = false; render(); }
      else if (name === 'field-clear-device') { if (confirmDiscard() && window.confirm('Clear saved journal readings, local field notes, and queued request records from this device? This does not cancel requests already received by ORACLE.')) { sync.reset(); await Promise.all([store.clearAll({ keepAccount: signedIn() }), offline.clearArchive({ keepAccount: signedIn() })]); reset(); state.view = 'field'; await load({ preserve: false }); feedback = 'Device copies cleared. No server records were cancelled.'; render(); } }
      else if (name === 'field-delete-note' && selected && !busy) { if (window.confirm('Delete this saved local note?')) { const scope = await store.captureScope(); await store.removeDraft({ scope, accountId, ...selected, expectedRevision: savedRevision }); draftText = savedText = ''; savedAt = null; savedRevision = null; draftConflict = null; await load({ preserve: false }); render(); } }
      else if (name === 'field-use-saved' && draftConflict) { draftText = savedText = draftConflict.text; savedAt = draftConflict.updatedAt; savedRevision = draftConflict.revision; draftConflict = null; render(); }
      else if (name === 'field-keep-note' && draftConflict) { savedText = draftConflict.text; savedAt = draftConflict.updatedAt; savedRevision = draftConflict.revision; draftConflict = null; render(); }
      else if (name === 'field-queue-create' && selected) await queue({ ...selected, kind: 'create', payload: { characterId: selected.characterId }, label: 'Information-exchange invitation' });
      else if (name === 'field-review') { if (!busy && connected() && signedIn()) { reviewId = button.dataset.id; reviewAcknowledged = false; render(); } }
      else if (name === 'field-close-review') { if (!busy && !sync.busy) { reviewId = null; reviewAcknowledged = false; render(); } }
      else if (name === 'field-cancel-request') { const row = local.requests.find(item => item.id === button.dataset.id); if (row && !busy && !sync.busy && window.confirm(row.attemptedAt ? 'Stop or remove this local retry record? ORACLE may already have received the request; this does not cancel the server action.' : 'Discard this saved request before it is sent?')) { const result = await store.cancelRequest(row.id); await load(); feedback = result.message; feedbackError = false; reviewId = null; render(); } }
      else if (name === 'field-exchanges' && connected() && signedIn() && confirmDiscard()) { const id = button.dataset.eventId, characterId = button.dataset.characterId; reset(); await loadEvent(id); await ctx.openExchanges(characterId); }
      else if (name === 'field-player-aid') await prepareAid('player');
      else if (name === 'field-organizer-aid') await prepareAid('organizer');
      else if (name === 'field-print') await printAid();
      else return false;
    } catch (error) { if (state.view === 'field') { feedback = error.message || 'This local action could not be completed.'; feedbackError = true; if (error.status === 409) await load(); render(); } else toast(error.message); }
    return true;
  }
  async function submit(form) {
    if (!form.id.startsWith('field-')) return false;
    capture(); const data = new FormData(form);
    if (!form.reportValidity()) return true;
    try {
      if (form.id === 'field-note-form') await saveNote();
      else if (form.id === 'field-scope-form') { if (confirmDiscard()) { const [eventId, characterId] = String(data.get('scope')).split('/'); if (characterFor(eventId, characterId)) { selectScope({ eventId, characterId }); render(); } } }
      else if (form.id === 'field-join-form' && selected) { const parsed = parseExchangeInput(String(data.get('code')), location.origin, selected.eventId); if (parsed.eventId !== selected.eventId) throw new Error('Choose the event named by this exchange link before saving the request.'); await queue({ ...selected, kind: 'join', payload: { characterId: selected.characterId, code: parsed.code }, label: 'Join an information exchange' }); joinCode = ''; render(); }
      else if (form.id === 'field-send-form' && data.get('acknowledged') === 'on') await sendRequest(form.dataset.id);
      else return false;
    } catch (error) { feedback = error.message; feedbackError = true; render(); }
    return true;
  }
  document.addEventListener('input', event => { if (event.target.closest('#field-note-form')) { capture(); const label = document.querySelector('#field-note-status'); if (label) label.textContent = dirty() ? 'Unsaved text · this tab only' : savedAt ? `Saved ${when(savedAt)}` : 'No saved note yet'; } });
  document.addEventListener('change', event => { if (event.target.name === 'fieldJournalId' && printData?.kind === 'player') { const checkbox = event.target; if (checkbox.checked && printSelection.size >= 20) { checkbox.checked = false; toast('Select at most 20 readings for one player aid.'); return; } if (checkbox.checked) printSelection.add(checkbox.value); else printSelection.delete(checkbox.value); document.querySelector('#field-print-aid').innerHTML = aidMarkup(); } });
  window.addEventListener('beforeunload', event => { capture(); if (dirty() || joinCode || busy || sync?.busy) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('afterprint', () => document.body.classList.remove('field-printing'));
  for (const event of ['online', 'offline']) window.addEventListener(event, () => { if (state.view === 'field') { capture(); feedback = event === 'online' ? 'Connection detected. Reconnect to verify your session, then explicitly review and send a saved request.' : 'Offline. Saved notes and request drafts stay local; nothing will transmit.'; feedbackError = false; render(); } });
  store.subscribe?.(event => {
    if (event.type === 'invalidate') { const visible = state.view === 'field'; sync.reset(); reset(); if (visible) { feedback = 'Local access changed. Device copies are hidden until their current scope is checked.'; render(); } return; }
    if (state.view === 'field' && !busy && !queueBusy) { void load().then(() => { if (state.view === 'field') render(); }).catch(() => {}); }
  });
  function canUpdate() { if (busy || queueBusy || sync?.busy) { toast('Wait for the Field desk save or transmission to finish before updating.'); return false; } return true; }
  return { open, render, action, submit, reset, confirmDiscard, cleanupModal, queue, rememberContext, captureContextScope: () => store.captureScope(), canUpdate, beforeUpdate: async () => confirmDiscard(), isDirty: () => { capture(); return dirty() || Boolean(joinCode) || busy; } };
}
