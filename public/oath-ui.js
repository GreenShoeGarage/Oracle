const clone = value => structuredClone(value);
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const STATUS_NAMES = { proposed: 'Awaiting acceptance', active: 'Active', fulfilled: 'Fulfilled', disputed: 'Disputed', cancelled: 'Cancelled', adjudicated: 'Adjudicated', expired: 'Expired', unavailable: 'Unavailable' };
const ACTION_NAMES = { created: 'Proposed', revised: 'Terms revised', accepted: 'Accepted terms', witnessed: 'Witnessed terms', settlement_confirmed: 'Confirmed fulfillment', fulfilled: 'Fulfilled', disputed: 'Dispute recorded', cancelled: 'Cancelled', adjudicated: 'Organizer ruling' };
const localTime = value => {
  if (!value) return '';
  const time = new Date(value), pad = part => String(part).padStart(2, '0');
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}T${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
};
const fingerprint = value => canonical({ title: value.title, terms: value.terms, participantIds: [...value.participantIds].sort(), witnessIds: [...value.witnessIds].sort(), expiresLocal: value.expiresLocal, settlement: [...value.settlement].sort((a, b) => canonical(a).localeCompare(canonical(b))) });

export function createOathUI(ctx) {
  const { state, api, shell, esc, loadEvent, toast, err } = ctx;
  let dashboard = null, agreement = null, accountId = null, eventId = null, characterId = null, manage = false, epoch = 0;
  let editor = null, decision = null, pending = null, loading = false, feedback = '', feedbackError = false, filter = 'all';
  const connected = () => navigator.onLine !== false;
  const base = (id = eventId || state.event?.id) => `/api/events/${id}/oaths`;
  const scope = () => ({ epoch, accountId, eventId, characterId, manage });
  const current = value => value.epoch === epoch && value.accountId && value.accountId === state.session?.user?.id && value.eventId === state.event?.id && value.characterId === characterId && value.manage === manage && state.view === 'oaths';
  const disabled = value => value ? 'disabled' : '';
  const date = value => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'No expiration';
  const canPropose = () => Boolean(connected() && !pending && !manage && dashboard?.character && !dashboard.readOnly);
  const canEdit = () => Boolean(canPropose() && (!editor?.id || agreement?.id === editor.id && agreement.canEdit));
  const draftDirty = () => Boolean(editor && fingerprint(editor.document) !== editor.baseline);
  const decisionDirty = () => Boolean(decision && (decision.reason || decision.acknowledged || decision.settle || decision.outcome !== 'fulfilled'));
  const dirty = () => draftDirty() || decisionDirty();
  const name = id => agreement?.participants?.find(row => row.characterId === id)?.name || dashboard?.participants?.find(row => row.id === id)?.name || dashboard?.characters?.find(row => row.id === id)?.name || 'Unavailable character';
  const resourceName = id => dashboard?.resources?.find(row => row.id === id)?.name || 'Unavailable resource';
  function reset() {
    epoch++; dashboard = null; agreement = null; accountId = null; eventId = null; characterId = null; manage = false;
    editor = null; decision = null; pending = null; loading = false; feedback = ''; feedbackError = false; filter = 'all';
  }
  function ensureAccount() {
    const who = state.session?.user?.id || null;
    if (who !== accountId) { reset(); accountId = who; }
    return who;
  }
  function draftOf(row) {
    return { title: row?.title || '', terms: row?.terms || '', participantIds: row ? row.participants.map(item => item.characterId) : [characterId], witnessIds: row ? row.witnesses.map(item => item.characterId) : [], expiresAt: row?.expiresAt || null, expiresLocal: localTime(row?.expiresAt), settlement: (row?.settlement || []).map(({ fromCharacterId, toCharacterId, resourceId, quantity }) => ({ fromCharacterId, toCharacterId, resourceId, quantity })) };
  }
  function beginEditor(row = null) {
    const document = draftOf(row);
    editor = { id: row?.id || null, key: row?.id || crypto.randomUUID(), version: row?.version || null, document, baseline: fingerprint(document), conflict: false, latest: null };
    decision = null; feedback = ''; feedbackError = false;
  }
  function capture() {
    if (pending || state.view !== 'oaths') return;
    const form = document.querySelector('#oath-editor-form');
    if (editor && form?.dataset.editorKey === editor.key && !form.querySelector('fieldset')?.disabled) {
      const data = new FormData(form);
      editor.document = { ...editor.document, title: String(data.get('title') || ''), terms: String(data.get('terms') || ''), participantIds: [characterId, ...data.getAll('participantIds').map(String).filter(id => id !== characterId)], witnessIds: data.getAll('witnessIds').map(String), expiresLocal: localTime(String(data.get('expiresAt') || '')), settlement: [...form.querySelectorAll('[data-oath-transfer]')].map(row => ({ fromCharacterId: row.querySelector('[data-transfer-field="fromCharacterId"]').value, toCharacterId: row.querySelector('[data-transfer-field="toCharacterId"]').value, resourceId: row.querySelector('[data-transfer-field="resourceId"]').value, quantity: Number(row.querySelector('[data-transfer-field="quantity"]').value) })) };
    }
    const decisionForm = document.querySelector('#oath-decision-form');
    if (decision && decisionForm && !decisionForm.querySelector('fieldset')?.disabled) {
      const data = new FormData(decisionForm);
      decision.reason = String(data.get('reason') || ''); decision.acknowledged = data.get('acknowledged') === 'on';
      decision.settle = data.get('settle') === 'on'; decision.outcome = String(data.get('outcome') || 'fulfilled');
    }
  }
  function applyDashboard(result) {
    dashboard = result; eventId = result.event.id;
    if (!manage) characterId = result.character?.id || null;
    if (state.event?.id === result.event.id) { state.event.status = result.event.status; if (result.event.role) state.event.role = result.event.role; }
  }
  function applyAgreement(result) {
    agreement = result;
    if (editor?.id === result?.id && result.version !== editor.version) { editor.conflict = true; editor.latest = result; }
    if (decision && result?.version !== decision.version) { decision.stale = true; decision.acknowledged = false; }
  }
  async function fetchDashboard(context) {
    const query = new URLSearchParams(context.manage ? { manage: 'true' } : context.characterId ? { characterId: context.characterId } : {});
    return api(`${base(context.eventId)}${query.size ? `?${query}` : ''}`);
  }
  async function fetchAgreement(context, id) {
    return api(`${base(context.eventId)}/${id}${!context.manage && context.characterId ? `?${new URLSearchParams({ characterId: context.characterId })}` : ''}`);
  }
  async function open(options = {}, requestedManage = false, requestedCharacter = null) {
    ensureAccount();
    if (state.view === 'oaths' && !confirmDiscard()) return;
    if (options?.id) options = { manage: requestedManage, characterId: requestedCharacter };
    const id = state.event?.id; if (!id) throw new Error('Open an event before opening OATHBOOK.');
    const chosen = options.characterId || (!options.manage && eventId === id ? characterId : null);
    epoch++; eventId = id; manage = Boolean(options.manage); characterId = chosen; dashboard = null; agreement = null; editor = null; decision = null; pending = null; loading = true; feedback = ''; feedbackError = false; state.view = 'oaths';
    const context = scope(); render();
    try { const result = await fetchDashboard(context); if (!current(context)) return; applyDashboard(result); loading = false; render(); }
    catch (error) { if (!current(context)) return; loading = false; feedback = error.message; feedbackError = true; render(); }
  }
  async function refresh() {
    capture();
    if (pending) { toast('Retry the pending action before refreshing OATHBOOK.'); return; }
    if (!connected()) { toast('Reconnect to load current agreements.'); return; }
    epoch++; const context = scope(), selectedId = agreement?.id || editor?.id;
    try {
      const result = await fetchDashboard(context); if (!current(context)) return; applyDashboard(result);
      // The server may select the first owned character when none was requested.
      const detailContext = scope();
      if (selectedId) { const result = await fetchAgreement(detailContext, selectedId); if (!current(detailContext)) return; applyAgreement(result.agreement); }
      feedback = editor?.conflict || decision?.stale ? 'This agreement changed. Your draft is retained; review the current terms before continuing.' : 'Agreements refreshed.'; feedbackError = false; render();
    } catch (error) { if (!current(scopeForCharacter(context))) return; handleReadError(error); render(); }
  }
  function scopeForCharacter(context) { return { ...context, characterId }; }
  function handleReadError(error) {
    if ([401, 403, 404].includes(error.status)) { agreement = null; editor = null; decision = null; if (manage || error.status === 401 || error.message?.includes('Event not found') || error.message?.includes('Character not found')) dashboard = null; }
    feedback = error.message || 'OATHBOOK could not be loaded. Reconnect and try again.'; feedbackError = true;
  }
  async function selectAgreement(id) {
    if (!confirmDiscard()) return;
    epoch++; const context = scope(); editor = null; decision = null; agreement = null; loading = true; feedback = ''; render();
    try { const result = await fetchAgreement(context, id); if (!current(context)) return; applyAgreement(result.agreement); loading = false; render(); document.querySelector('#oath-detail-title')?.focus(); }
    catch (error) { if (!current(context)) return; loading = false; handleReadError(error); render(); }
  }
  function pendingBanner() {
    if (!pending) return '';
    return `<section class="oath-notice" role="status"><strong>${pending.sending ? 'Waiting for ORACLE to confirm…' : 'This action has no confirmed response yet.'}</strong><p>${pending.sending ? 'Keep this view open while the result is checked.' : 'The action may have completed. Retry uses the same request to recover the result without recording it or transferring resources twice.'}</p>${!pending.sending ? `<button type="button" class="primary mt" data-action="oath-retry" ${disabled(!connected())}>Retry pending action</button>` : ''}</section>`;
  }
  function characterPicker() {
    if (manage) return '<p class="oath-notice">Organizer review shows event agreements. To propose, accept, witness, or confirm fulfillment, switch to your own character.</p>';
    const rows = dashboard.characters || [];
    if (!rows.length) return `<section class="empty"><h2>An approved character is needed.</h2><p>${esc(dashboard.message || 'Choose a character assigned to you before making an agreement.')}</p><button type="button" data-action="character-open">Open characters</button></section>`;
    return `<form id="oath-character-form" class="oath-character-picker"><label>Acting as<select name="characterId" ${disabled(Boolean(pending))}>${rows.map(row => `<option value="${esc(row.id)}" ${row.id === characterId ? 'selected' : ''}>${esc(row.name)}</option>`).join('')}</select></label><button type="submit" ${disabled(Boolean(pending))}>Use character</button></form>`;
  }
  function statusBadge(row) { return `<span class="badge">${esc(STATUS_NAMES[row.status] || row.status || 'Agreement')}</span>`; }
  function agreementList() {
    const rows = (dashboard.agreements || []).filter(row => filter === 'all' || row.status === filter);
    return `<aside class="panel oath-list" aria-label="Agreements"><div class="panel-head"><h2>${manage ? 'Event agreements' : 'Your agreements'}</h2><span class="hint">${rows.length}</span></div>${!manage ? `<button type="button" class="primary mt" data-action="oath-new" ${disabled(!canPropose())}>Propose agreement</button>` : ''}<label class="mt">Show<select id="oath-filter"><option value="all" ${filter === 'all' ? 'selected' : ''}>All agreements</option>${Object.entries(STATUS_NAMES).map(([value, label]) => `<option value="${value}" ${filter === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label><div class="oath-agreement-list">${rows.length ? rows.map(row => `<button type="button" class="oath-card ${agreement?.id === row.id ? 'selected' : ''}" data-action="oath-select" data-id="${esc(row.id)}" aria-pressed="${agreement?.id === row.id}" ${disabled(Boolean(pending))}><strong>${esc(row.title)}</strong>${statusBadge(row)}<span class="hint">Terms revision ${row.termsVersion || 1}${row.expiresAt ? ` · Expires ${esc(date(row.expiresAt))}` : ''}</span></button>`).join('') : `<p class="hint">${dashboard.agreements?.length ? 'No agreements match this status.' : manage ? 'Player agreements will appear here for organizer review.' : 'Propose terms with another player, or wait for an invitation to participate or witness.'}</p>`}</div></aside>`;
  }
  function transfersView(transfers, rows = agreement?.participants || []) {
    const displayName = id => rows.find(row => (row.characterId || row.id) === id)?.name || name(id);
    return transfers?.length ? `<ol class="oath-transfers">${transfers.map(row => `<li><strong>${esc(displayName(row.fromCharacterId))}</strong> gives <strong>${Number(row.quantity).toLocaleString()} ${esc(row.resourceName || resourceName(row.resourceId))}</strong> to <strong>${esc(displayName(row.toCharacterId))}</strong></li>`).join('')}</ol>` : '<p class="hint">No resource transfer is attached. Participants confirm the narrative obligations themselves.</p>';
  }
  function termsView(row) {
    return `<section class="oath-terms" aria-label="Exact agreement terms"><h3>Terms · revision ${row.termsVersion}</h3><p class="oath-copy">${esc(row.terms)}</p><p class="hint mt">${row.expiresAt ? `Expires ${esc(date(row.expiresAt))}` : 'No expiration is set.'}</p><h3 class="mt">Settlement terms</h3>${transfersView(row.settlement, row.participants)}${row.settlement?.length ? '<p class="hint mt">Resources move together only after every participant confirms fulfillment, or an organizer explicitly settles the accepted terms. Acceptance alone does not reserve or transfer resources.</p>' : ''}</section>`;
  }
  function signaturesView(row) {
    return `<section class="oath-signatures"><h3>Participants</h3><ul>${row.participants.map(person => `<li><strong>${esc(person.name)}${person.characterId === characterId && !manage ? ' · You' : ''}</strong><span class="hint">${person.accepted ? `Accepted revision ${person.acceptedTermsVersion || row.termsVersion}${person.acceptedAt ? ` · ${esc(date(person.acceptedAt))}` : ''}` : 'Has not accepted these terms'}${person.settlementConfirmed ? ' · Fulfillment confirmed' : ''}</span></li>`).join('')}</ul><h3 class="mt">Witnesses</h3>${row.witnesses.length ? `<ul>${row.witnesses.map(person => `<li><strong>${esc(person.name)}${person.characterId === characterId && !manage ? ' · You' : ''}</strong><span class="hint">${person.witnessed ? `Witnessed revision ${person.termsVersion || row.termsVersion}${person.witnessedAt ? ` · ${esc(date(person.witnessedAt))}` : ''}` : 'Has not witnessed these terms'}</span></li>`).join('')}</ul>` : '<p class="hint">No witnesses named.</p>'}<p class="hint mt">A witness attests to the displayed terms. Witnessing does not authorize a resource transfer.</p></section>`;
  }
  function receiptView(receipt) {
    if (!receipt) return '';
    return `<section class="oath-receipt"><h3>Settlement receipt</h3><p class="hint">Confirmed ${esc(date(receipt.createdAt || receipt.completedAt))}</p>${(receipt.transfers || []).length ? `<ul class="oath-transfers">${receipt.transfers.map(transfer => `<li><strong>${esc(transfer.fromName || name(transfer.fromCharacterId))}</strong> → <strong>${esc(transfer.toName || name(transfer.toCharacterId))}</strong><ul>${(transfer.resources || []).map(resource => `<li>${Number(resource.quantity).toLocaleString()} ${esc(resource.name || resourceName(resource.resourceId))}</li>`).join('')}</ul></li>`).join('')}</ul>` : '<p class="hint">Settlement confirmed.</p>'}<p class="hint mt">Receipt ${esc(receipt.id || '')}. Later disputes and corrections preserve this record.</p></section>`;
  }
  function historyView(row) {
    const savedTerms = (snapshot, label) => snapshot ? `<details class="oath-history-snapshot"><summary>${esc(label)} · revision ${snapshot.termsVersion}</summary><h4>${esc(snapshot.title)}</h4>${termsView(snapshot)}<p class="hint mt">Participants: ${(snapshot.participants || []).map(person => esc(person.name)).join(', ') || 'None'}. Witnesses: ${(snapshot.witnesses || []).map(person => esc(person.name)).join(', ') || 'None'}.</p></details>` : '';
    return `<details class="oath-history" data-oath-disclosure="history"><summary>Acceptance and ruling history · ${row.history?.length || 0}</summary><ol>${(row.history || []).map(item => `<li><strong>${esc(ACTION_NAMES[item.action] || item.action.replaceAll('_', ' '))}</strong><span class="hint">${item.characterName ? `${esc(item.characterName)} · ` : ''}${esc(date(item.at))}${item.termsVersion ? ` · Terms revision ${item.termsVersion}` : ''}</span>${item.reason ? `<p class="oath-copy">${esc(item.reason)}</p>` : ''}${item.outcome ? `<p>Outcome: ${esc(STATUS_NAMES[item.outcome] || item.outcome)}</p>` : ''}${savedTerms(item.priorSnapshot, 'Previous exact terms')}${savedTerms(item.snapshot, 'Saved exact terms')}</li>`).join('')}</ol></details>`;
  }
  function allowed(verb) {
    if (!agreement || pending || !connected()) return false;
    if (verb === 'adjudicate') return manage && dashboard?.canManage && agreement.canAdjudicate;
    if (manage || !dashboard?.character) return false;
    return Boolean(agreement[{ accept: 'canAccept', witness: 'canWitness', settle: 'canSettle', dispute: 'canDispute', cancel: 'canCancel' }[verb]]);
  }
  function detailView() {
    const row = agreement;
    if (!row) return `<section class="panel oath-empty"><p class="eyebrow">OATHBOOK</p><h2>${loading ? 'Loading agreement…' : 'Keep your word on record.'}</h2><p>${loading ? 'Checking the current terms and your access.' : 'Agree on exact terms, invite witnesses, and record fulfillment or an organizer ruling.'}</p></section>`;
    return `<article class="panel oath-reading"><div class="panel-head"><div><p class="eyebrow">OATHBOOK · ${manage ? 'Organizer review' : 'Player agreement'}</p><h2 id="oath-detail-title" tabindex="-1">${esc(row.title)}</h2></div>${statusBadge(row)}</div>${row.blockedReason ? `<p class="oath-notice" role="status">${esc(row.blockedReason)}</p>` : ''}${termsView(row)}${signaturesView(row)}${receiptView(row.receipt)}${decision ? decisionView() : `<div class="actions oath-decision-actions">${!manage && row.canEdit ? `<button type="button" data-action="oath-edit" ${disabled(!canPropose())}>Revise proposed terms</button>` : ''}${[['accept', 'Review and accept terms'], ['witness', 'Witness these terms'], ['settle', 'Confirm fulfillment'], ['dispute', 'Record a dispute'], ['cancel', 'Cancel proposal'], ['adjudicate', 'Record organizer ruling']].filter(([verb]) => allowed(verb)).map(([verb, label]) => `<button type="button" data-action="oath-${verb}" class="${verb === 'accept' || verb === 'settle' ? 'primary' : 'quiet'}">${label}</button>`).join('')}</div>`}${manage && dashboard.canManage && ctx.openBazaar ? `<section class="oath-corrections"><h3>Linked resource correction</h3><p class="hint">After a ruling, a resource correction can be recorded in BAZAAR with a reason and this agreement attached. It creates a separate receipt.</p><button type="button" class="quiet mt" data-action="oath-correction" ${disabled(Boolean(pending) || !connected() || dashboard.event.status === 'archived')}>Open BAZAAR correction</button></section>` : ''}${historyView(row)}</article>`;
  }
  function decisionView() {
    const verb = decision.verb, hasReason = ['dispute', 'adjudicate'].includes(verb);
    const labels = { accept: 'Accept these exact terms', witness: 'Witness these exact terms', settle: 'Confirm fulfillment and settlement', dispute: 'Record a dispute', cancel: 'Cancel this proposal', adjudicate: 'Record an organizer ruling' };
    const statements = { accept: `As ${name(characterId)}, I accept terms revision ${agreement.termsVersion}, including its listed resource transfers.`, witness: `As ${name(characterId)}, I witness the displayed terms revision ${agreement.termsVersion}.`, settle: `As ${name(characterId)}, I confirm the obligations are fulfilled and authorize the exact resource settlement listed above.`, dispute: 'I want this concern recorded in the agreement history. Any completed settlement remains recorded.', cancel: 'I want to cancel this proposal before it becomes active.', adjudicate: 'I have reviewed the terms, signatures, receipt, and history and want this ruling recorded.' };
    return `<form id="oath-decision-form" class="oath-decision">${err || ''}<h3>${esc(labels[verb])}</h3>${decision.stale ? '<p class="oath-notice" role="alert">The agreement changed after you opened this action. Review the current terms above, then reopen this action before confirming.</p>' : ''}<fieldset ${disabled(Boolean(pending) || !connected() || decision.stale || !allowed(verb))}><legend class="oath-sr-only">Confirm agreement action</legend>${hasReason ? `<label>${verb === 'dispute' ? 'What is disputed?' : 'Ruling and reason'}<textarea name="reason" rows="5" maxlength="2000" required>${esc(decision.reason)}</textarea></label>` : ''}${verb === 'adjudicate' ? `<label>Ruling outcome<select name="outcome"><option value="fulfilled" ${decision.outcome === 'fulfilled' ? 'selected' : ''}>Obligations fulfilled</option><option value="cancelled" ${decision.outcome === 'cancelled' ? 'selected' : ''}>Agreement cancelled</option></select></label><label class="oath-check"><input type="checkbox" name="settle" ${decision.settle ? 'checked' : ''} ${disabled(Boolean(agreement.receipt) || !agreement.settlement.length || decision.outcome === 'cancelled')}><span>Execute the accepted resource settlement now</span></label><p class="hint">${agreement.receipt ? 'The recorded settlement has already happened and cannot execute again.' : decision.outcome === 'cancelled' ? 'A cancellation ruling does not execute resource transfers.' : agreement.settlement.length ? 'Leaving this unchecked records the narrative ruling without moving resources. Executing settlement also requires every participant’s current acceptance and eligibility, and unexpired terms.' : 'This agreement contains no resource transfers.'}</p>` : ''}<label class="oath-check oath-acknowledgement"><input name="acknowledged" type="checkbox" required ${decision.acknowledged ? 'checked' : ''}><span>${esc(statements[verb])}</span></label></fieldset><div class="actions mt"><button type="submit" class="primary" ${disabled(Boolean(pending) || !connected() || decision.stale || !allowed(verb))}>${esc(labels[verb])}</button><button type="button" class="quiet" data-action="oath-close-decision" ${disabled(Boolean(pending?.sending))}>${decision.stale ? 'Close and review' : 'Back to agreement'}</button></div><p class="hint mt">${verb === 'settle' ? 'Nothing moves until ORACLE confirms the result. If another participant has not confirmed yet, your confirmation waits for theirs.' : verb === 'accept' ? 'This acceptance is saved against the displayed terms revision. Revised terms require everyone to accept again.' : ''}</p></form>`;
  }
  function directory(selected = []) {
    const rows = [...(dashboard.participants || [])];
    for (const id of selected) if (!rows.some(row => row.id === id)) rows.push({ id, name: name(id), unavailable: true });
    return rows;
  }
  function choices(field, selected, excluded = []) {
    const rows = directory(selected).filter(row => !excluded.includes(row.id) || selected.includes(row.id));
    return rows.length ? `<div class="oath-checklist">${rows.map(row => `<label class="oath-check"><input type="checkbox" name="${field}" value="${esc(row.id)}" ${selected.includes(row.id) ? 'checked' : ''}><span>${esc(row.name)}${row.unavailable ? ' · unavailable; remove before saving' : ''}</span></label>`).join('')}</div>` : '<p class="hint">No eligible characters are available.</p>';
  }
  function options(rows, value, placeholder) {
    const values = [...rows];
    if (value && !values.some(row => row.id === value)) values.push({ id: value, name: 'Unavailable choice · select another' });
    return `<option value="">${esc(placeholder)}</option>${values.map(row => `<option value="${esc(row.id)}" ${row.id === value ? 'selected' : ''}>${esc(row.name)}</option>`).join('')}`;
  }
  function transferEditor() {
    const doc = editor.document, people = directory(doc.participantIds).filter(row => doc.participantIds.includes(row.id));
    return `<section class="oath-transfer-editor"><h3>Fixed resource settlement · optional</h3><p class="hint">Each listed transfer happens together when fulfillment is confirmed. Use whole units. Narrative promises belong in the terms above.</p><div class="oath-transfer-rows">${doc.settlement.map((row, index) => `<fieldset class="oath-transfer-row" data-oath-transfer="${index}"><legend>Transfer ${index + 1}</legend><label>From participant<select data-transfer-field="fromCharacterId" required>${options(people, row.fromCharacterId, 'Select giver')}</select></label><label>To participant<select data-transfer-field="toCharacterId" required>${options(people, row.toCharacterId, 'Select recipient')}</select></label><label>Resource<select data-transfer-field="resourceId" required>${options(dashboard.resources || [], row.resourceId, 'Select resource')}</select></label><label>Quantity<input data-transfer-field="quantity" type="number" min="1" max="1000000000" step="1" inputmode="numeric" value="${Number.isFinite(row.quantity) ? row.quantity : ''}" required></label><button type="button" class="quiet" data-action="oath-remove-transfer" data-index="${index}" aria-label="Remove transfer ${index + 1}">Remove transfer</button></fieldset>`).join('')}</div><button type="button" class="quiet mt" data-action="oath-add-transfer" ${disabled(doc.settlement.length >= 16 || !dashboard.resources?.length)}>Add resource transfer</button>${!dashboard.resources?.length ? '<p class="hint mt">An organizer can define resources in BAZAAR. Agreements can still record narrative obligations.</p>' : ''}</section>`;
  }
  function editorView() {
    const doc = editor.document;
    return `<section class="panel oath-editor"><div class="panel-head"><h2>${editor.id ? 'Revise proposed agreement' : 'Propose an agreement'}</h2><span id="oath-save-state" class="save-status" role="status">${pending ? 'Awaiting confirmation' : draftDirty() ? 'Unsaved changes · held in this tab' : editor.id ? 'Saved terms' : 'New proposal · held in this tab'}</span></div>${editor.id ? '<p class="oath-notice">Changing terms, participants, witnesses, expiration, or settlement clears every acceptance and witness attestation. Everyone reviews the new revision.</p>' : '<p class="hint mt">Only the named participants, witnesses, and event organizers can read this agreement. Proposing does not accept it; you will explicitly accept the saved terms too.</p>'}${editor.conflict ? `<section class="oath-notice" role="alert"><h3>The saved agreement changed.</h3><p>Your draft is retained. Review the latest terms before choosing what to save.</p>${editor.latest ? `${termsView(editor.latest)}${signaturesView(editor.latest)}<div class="actions mt"><button type="button" data-action="oath-use-latest">Use latest saved terms</button>${editor.latest.canEdit ? '<button type="button" data-action="oath-keep-draft">Keep my draft for this revision</button>' : '<p class="hint">This agreement can no longer be revised.</p>'}</div>` : '<button type="button" class="mt" data-action="oath-refresh">Load latest terms</button>'}</section>` : ''}<form id="oath-editor-form" data-editor-key="${esc(editor.key)}">${err || ''}<fieldset class="oath-fields" ${disabled(!canEdit())}><legend class="oath-sr-only">Agreement proposal</legend><label>Title<input name="title" maxlength="120" value="${esc(doc.title)}" required></label><label>Exact terms<textarea name="terms" rows="9" maxlength="12000" required>${esc(doc.terms)}</textarea></label><fieldset class="oath-choice-group"><legend>Participants · 2 to 8 characters</legend><p class="hint">${esc(name(characterId))} is included as the proposer. Choose one character per player.</p>${choices('participantIds', doc.participantIds.filter(id => id !== characterId), [characterId])}</fieldset><fieldset class="oath-choice-group"><legend>Witnesses · optional, up to 5</legend>${choices('witnessIds', doc.witnessIds, doc.participantIds)}<p class="hint">Witnesses must be separate players from the participants and each other.</p></fieldset><label>Expiration · your local time, optional<input name="expiresAt" type="datetime-local" step="1" value="${esc(doc.expiresLocal)}"></label><p class="hint">Choose a future time within one year, or leave it blank. Expiration prevents new acceptance and settlement.</p>${transferEditor()}</fieldset><div class="actions mt"><button type="submit" class="primary" ${disabled(!canEdit() || editor.conflict)}>Save ${editor.id ? 'revised terms' : 'proposal'}</button><button type="button" class="quiet" data-action="oath-close-editor" ${disabled(Boolean(pending?.sending))}>${editor.id ? 'Back to agreement' : 'Discard draft'}</button></div></form></section>`;
  }
  function render() {
    ensureAccount(); if (state.view !== 'oaths') return;
    if (!dashboard || dashboard.event?.id !== state.event?.id) {
      shell(`<section class="oath-workspace"><button type="button" class="quiet" data-action="oath-event">← Event briefing</button><h1 class="mt">OATHBOOK</h1><p role="${feedbackError ? 'alert' : 'status'}">${esc(feedback || (loading ? 'Loading agreements…' : 'Open the event to load OATHBOOK.'))}</p>${feedback ? '<button type="button" class="mt" data-action="oath-refresh">Try again</button>' : ''}</section>`); return;
    }
    const disclosures = new Map([...document.querySelectorAll('[data-oath-disclosure]')].map(element => [element.dataset.oathDisclosure, element.open]));
    shell(`<section class="oath-workspace"><div class="actions"><button type="button" class="quiet" data-action="oath-event">← Event briefing</button>${dashboard.canManage ? `<button type="button" class="quiet" data-action="${manage ? 'oath-open' : 'oath-manage'}">${manage ? 'Act as my character' : 'Review event agreements'}</button>` : ''}</div><header class="page-head mt"><div><p class="eyebrow">${esc(dashboard.event.name)} · OATHBOOK${manage ? ' · Organizer review' : ''}</p><h1>Agreements & obligations</h1><p class="muted">Set the terms. Witness the promise. Record the outcome.</p></div><button type="button" data-action="oath-refresh" ${disabled(Boolean(pending) || !connected())}>Refresh</button></header>${pendingBanner()}${feedback ? `<p class="oath-feedback ${feedbackError ? 'error' : ''}" role="${feedbackError ? 'alert' : 'status'}">${esc(feedback)}</p>` : ''}${!connected() ? '<section class="empty"><h2>Reconnect for current agreements.</h2><p>Acceptance, witnesses, and settlement need a server confirmation. Any draft stays in this tab until you reconnect or leave.</p></section>' : `${characterPicker()}${!manage && dashboard.readOnly ? `<p class="oath-notice">${esc(dashboard.message || 'Agreements are read-only. Proposals and participant actions require OATHBOOK to be enabled during live play or rehearsal.')}</p>` : ''}${manage || dashboard.character ? `<div class="oath-layout">${agreementList()}<section class="oath-detail" aria-label="Agreement details">${editor ? editorView() : detailView()}</section></div>` : ''}`}</section>`);
    for (const element of document.querySelectorAll('[data-oath-disclosure]')) if (disclosures.has(element.dataset.oathDisclosure)) element.open = disclosures.get(element.dataset.oathDisclosure);
  }
  function successMessage(request) {
    return ({ create: 'Agreement proposed. Review and accept the saved terms when you are ready.', revise: 'Revised terms saved. Every participant and witness must confirm the new revision.', accept: 'Your acceptance is recorded against these exact terms.', witness: 'Your witness attestation is recorded.', settle: agreement?.receipt || agreement?.status === 'fulfilled' ? 'Fulfillment confirmed. The completed settlement is recorded below.' : 'Your fulfillment confirmation is recorded. Other participants still need to confirm.', dispute: 'Dispute recorded. Any completed settlement remains in the history.', cancel: 'Proposal cancelled.', adjudicate: 'Organizer ruling recorded.' })[request.kind] || 'Agreement updated.';
  }
  async function mutate(path, method, body, kind, retry = false) {
    ensureAccount(); capture();
    if (!connected()) { feedback = 'Reconnect before recording an agreement action.'; feedbackError = true; render(); return; }
    if (pending && !retry) { toast('Retry the pending action before starting another.'); return; }
    const request = retry ? pending : { path, method, body: { ...clone(body), requestId: crypto.randomUUID() }, kind, sending: false };
    if (!request || request.sending) return;
    epoch++; const context = scope(); request.sending = true; pending = request; feedback = ''; feedbackError = false; render();
    try {
      const result = await api(request.path, request.method, request.body); if (!current(context)) return;
      pending = null; editor = null; decision = null; if (result.agreement) agreement = result.agreement;
      const confirmed = successMessage(request); feedback = confirmed; feedbackError = false;
      try { const latest = await fetchDashboard(context); if (!current(context)) return; applyDashboard(latest); }
      catch (error) { if (!current(context)) return; if ([401, 403, 404].includes(error.status)) handleReadError(error); else { feedback = `${confirmed} Refresh to load the latest list.`; feedbackError = true; } }
      if (current(scopeForCharacter(context))) { render(); toast(confirmed); }
    } catch (error) {
      if (!current(context)) return;
      request.sending = false;
      if (error.status >= 400 && error.status < 500) pending = null;
      if (!pending && [401, 403, 404].includes(error.status)) handleReadError(error);
      else {
        feedback = pending ? 'The response was interrupted. Retry the pending action to recover its result.' : `${error.message}${editor ? ' Your draft is retained.' : ''}`; feedbackError = true;
        if (error.status === 409) {
          if (editor?.id) { editor.conflict = true; editor.latest = null; }
          if (decision) { decision.stale = true; decision.acknowledged = false; }
          // Never retarget a signature or ruling to newer terms automatically.
          if (agreement?.id) { try { const latest = await fetchAgreement(context, agreement.id); if (!current(context)) return; applyAgreement(latest.agreement); } catch (refreshError) { if (!current(context)) return; if ([401, 403, 404].includes(refreshError.status)) handleReadError(refreshError); } }
        }
      }
      if (current(context)) render();
    }
  }
  function confirmDiscard(destination) {
    if (destination === 'modal') return true;
    capture();
    if (pending?.sending) { toast('Wait for the OATHBOOK action to finish.'); return false; }
    if (pending && !window.confirm('This action may already be recorded. Leave and discard its retry information and any unsaved agreement draft?')) return false;
    if (!pending && dirty() && !window.confirm('Discard your unsaved agreement changes?')) return false;
    pending = null; editor = null; decision = null; return true;
  }
  async function action(button) {
    const verb = button.dataset.action; if (!verb?.startsWith('oath-')) return false;
    ensureAccount(); capture();
    if (verb === 'oath-open' || verb === 'oath-manage') await open({ manage: verb === 'oath-manage', characterId: button.dataset.characterId });
    else if (verb === 'oath-event') { if (confirmDiscard()) { epoch++; await loadEvent(state.event.id); } }
    else if (verb === 'oath-refresh') await refresh();
    else if (verb === 'oath-retry') await mutate(null, null, null, null, true);
    else if (verb === 'oath-select') await selectAgreement(button.dataset.id);
    else if (verb === 'oath-new') { if (canPropose() && confirmDiscard()) { agreement = null; beginEditor(); render(); document.querySelector('#oath-editor-form input[name="title"]')?.focus(); } }
    else if (verb === 'oath-edit') { if (!manage && agreement?.canEdit && canPropose() && confirmDiscard()) { beginEditor(agreement); render(); } }
    else if (verb === 'oath-close-editor' || verb === 'oath-close-decision') { if (confirmDiscard()) render(); }
    else if (verb === 'oath-add-transfer') {
      if (editor && canEdit() && editor.document.settlement.length < 16) { const people = editor.document.participantIds; editor.document.settlement.push({ fromCharacterId: characterId, toCharacterId: people.find(id => id !== characterId) || '', resourceId: dashboard.resources[0]?.id || '', quantity: 1 }); render(); }
    } else if (verb === 'oath-remove-transfer') { if (editor && canEdit()) { const index = Number(button.dataset.index); if (Number.isInteger(index) && index >= 0 && index < editor.document.settlement.length) { editor.document.settlement.splice(index, 1); render(); } } }
    else if (verb === 'oath-use-latest') { if (editor?.latest) { const latest = editor.latest; agreement = latest; if (latest.canEdit) beginEditor(latest); else editor = null; render(); } }
    else if (verb === 'oath-keep-draft') { if (editor?.latest?.canEdit) { editor.version = editor.latest.version; editor.baseline = fingerprint(draftOf(editor.latest)); editor.conflict = false; editor.latest = null; feedback = 'Your draft targets the reviewed revision. Save to ask everyone to accept the revised terms.'; feedbackError = false; render(); } }
    else if (verb === 'oath-correction') { if (manage && dashboard?.canManage && agreement && ctx.openBazaar && confirmDiscard()) { const id = agreement.id, person = agreement.participants[0]?.characterId || null; epoch++; await ctx.openBazaar(person, id); } }
    else if (['accept', 'witness', 'settle', 'dispute', 'cancel', 'adjudicate'].includes(verb.slice(5))) {
      const kind = verb.slice(5);
      if (allowed(kind) && confirmDiscard()) { decision = { verb: kind, version: agreement.version, termsVersion: agreement.termsVersion, reason: '', outcome: 'fulfilled', settle: false, acknowledged: false, stale: false }; feedback = ''; feedbackError = false; render(); document.querySelector('#oath-decision-form')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }
    } else return false;
    return true;
  }
  function editorPayload() {
    const doc = editor.document;
    const expiresAt = doc.expiresLocal === localTime(doc.expiresAt) ? doc.expiresAt : doc.expiresLocal ? new Date(doc.expiresLocal).toISOString() : null;
    return { characterId, title: doc.title, terms: doc.terms, participantIds: [...doc.participantIds], witnessIds: [...doc.witnessIds], expiresAt, settlement: clone(doc.settlement), ...(editor.id ? { version: editor.version } : {}) };
  }
  async function submit(form) {
    if (form.id === 'oath-character-form') { const chosen = String(new FormData(form).get('characterId') || ''); await open({ characterId: chosen }); return true; }
    if (!['oath-editor-form', 'oath-decision-form'].includes(form.id)) return false;
    capture();
    if (form.id === 'oath-editor-form') {
      if (!editor || !canEdit() || editor.conflict || !form.reportValidity()) return true;
      const doc = editor.document;
      if (doc.participantIds.length < 2 || doc.participantIds.length > 8 || doc.witnessIds.length > 5 || doc.witnessIds.some(id => doc.participantIds.includes(id))) { feedback = 'Choose 2 to 8 participants and up to 5 separate witnesses.'; feedbackError = true; render(); return true; }
      if (doc.settlement.some(row => row.fromCharacterId === row.toCharacterId || !doc.participantIds.includes(row.fromCharacterId) || !doc.participantIds.includes(row.toCharacterId) || !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 1000000000)) { feedback = 'Every resource transfer needs two different selected participants and a positive whole-unit quantity.'; feedbackError = true; render(); return true; }
      let body; try { body = editorPayload(); } catch { feedback = 'Choose a valid expiration time.'; feedbackError = true; render(); return true; }
      await mutate(`${base()}${editor.id ? `/${editor.id}` : ''}`, editor.id ? 'PUT' : 'POST', body, editor.id ? 'revise' : 'create');
    } else {
      if (!decision || decision.stale || !allowed(decision.verb) || !form.reportValidity() || !decision.acknowledged) return true;
      if (decision.version !== agreement.version || decision.termsVersion !== agreement.termsVersion) { decision.stale = true; decision.acknowledged = false; render(); return true; }
      const verb = decision.verb, body = verb === 'adjudicate' ? { version: decision.version, outcome: decision.outcome, reason: decision.reason, settle: decision.outcome === 'fulfilled' && decision.settle && !agreement.receipt && agreement.settlement.length > 0 } : { characterId, version: decision.version, ...(verb === 'dispute' ? { reason: decision.reason } : {}) };
      await mutate(`${base()}/${agreement.id}/${verb}`, 'POST', body, verb);
    }
    return true;
  }
  function changed(event) {
    if (state.view !== 'oaths' || !event.target.closest('#oath-editor-form, #oath-decision-form')) return;
    capture();
    const indicator = document.querySelector('#oath-save-state'); if (indicator) indicator.textContent = draftDirty() ? 'Unsaved changes · held in this tab' : editor?.id ? 'Saved terms' : 'New proposal · held in this tab';
    if (event.type === 'change' && event.target.name === 'outcome' && decision) { if (decision.outcome === 'cancelled') decision.settle = false; decision.acknowledged = false; render(); document.querySelector('[name=outcome]')?.focus(); }
    if (event.type === 'change' && event.target.name === 'participantIds' && editor) {
      const selectedId = event.target.value; editor.document.witnessIds = editor.document.witnessIds.filter(id => !editor.document.participantIds.includes(id)); render(); [...document.querySelectorAll('[name=participantIds]')].find(input => input.value === selectedId)?.focus();
    }
  }
  document.addEventListener('input', changed);
  document.addEventListener('change', event => { changed(event); if (state.view === 'oaths' && event.target.id === 'oath-filter') { capture(); filter = event.target.value; render(); } });
  window.addEventListener('beforeunload', event => { capture(); if (dirty() || pending) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('offline', () => { if (state.view === 'oaths') { capture(); render(); } });
  window.addEventListener('online', () => { if (state.view === 'oaths') render(); });
  return { open, render, action, submit, confirmDiscard, isDirty: () => { capture(); return dirty() || Boolean(pending); }, reset, cleanupModal() {} };
}
