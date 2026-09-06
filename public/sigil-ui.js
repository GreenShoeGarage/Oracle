import { renderBadgeQR, scanImage, startScanner } from './qr.js';
import { parseInstrumentInput } from './instrument-code.js';
import { createPropEffects } from './prop-effects.js';

const clone = value => structuredClone(value);
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const labelStatus = value => ({ running: 'In progress', paused: 'Paused', succeeded: 'Completed', failed: 'Failed', cancelled: 'Cancelled', unavailable: 'Unavailable' })[value] || value;
const newId = prefix => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const emptyConditions = () => ({ completed: [], flags: [], skills: [], statuses: [] });
const freshDocument = () => ({ title: '', summary: '', organizerNotes: '', durationSeconds: 300, roles: [{ id: 'lead', name: 'Lead', instructions: '' }, { id: 'support', name: 'Support', instructions: '' }], components: [], checkpoints: [{ id: 'begin', title: 'Begin the sequence', instructions: 'Prepare your group and confirm you are ready.', roleId: 'lead', minimumSeconds: 0, answer: null }], conditions: emptyConditions(), success: { text: 'The sequence is complete.', flags: [] }, failure: { text: 'The sequence ran out of time.', flags: [] } });
const milliseconds = value => typeof value === 'number' ? value : new Date(value).getTime();
const duration = value => { const seconds = Math.ceil(Math.max(0, Number(value) || 0) / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };

export function createSigilUI(ctx) {
  const { state, api, shell, esc, loadEvent, toast, openModal, closeModal, err } = ctx;
  const effects = createPropEffects();
  let dashboard = null, eventId = null, accountId = null, characterId = null, manage = false, epoch = 0;
  let editor = null, challenge = null, challengeCode = '', startDraft = null, run = null, runReceivedAt = 0, answer = '', decision = null;
  let pending = null, loading = false, feedback = '', feedbackError = false, stale = false, poster = null;
  let heartbeatTimer = null, clockTimer = null, heartbeatBusy = false, heartbeatSequence = 0;
  let modalEpoch = 0, scannerController = null, scannerStop = null, scanBusy = false, scanDirty = false;
  const connected = () => navigator.onLine !== false;
  const disabled = value => value ? 'disabled' : '';
  const base = (id = eventId) => `/api/events/${id}/sigil`;
  const scope = () => ({ epoch, accountId, eventId, characterId, manage });
  const current = context => context.epoch === epoch && context.accountId && context.accountId === state.session?.user?.id && context.eventId === state.event?.id && context.characterId === characterId && context.manage === manage && state.view === 'sigil';
  const draftDirty = () => Boolean(editor && canonical(editor.document) !== editor.baseline);
  const contentDirty = () => draftDirty() || Boolean(startDraft && (startDraft.roles.some(row => row.performer) || startDraft.bindings.some(row => row.itemId) || startDraft.consent)) || Boolean(answer || decision?.reason);
  const dirty = () => contentDirty() || scanDirty;
  const editable = () => Boolean(manage && dashboard?.canManage && dashboard.event?.status !== 'archived' && connected() && !pending);
  const date = value => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const feedbackView = () => feedback ? `<p class="sigil-feedback ${feedbackError ? 'error' : ''}" role="${feedbackError ? 'alert' : 'status'}">${esc(feedback)}</p>` : '';

  function stopTimers() { clearInterval(heartbeatTimer); clearInterval(clockTimer); heartbeatTimer = null; clockTimer = null; }
  function stopCamera() {
    scannerController?.abort(); scannerController = null; scannerStop?.(); scannerStop = null;
    const video = document.querySelector('#sigil-scanner-video'); if (video) video.hidden = true;
    const start = document.querySelector('[data-action="sigil-camera"]'), stop = document.querySelector('[data-action="sigil-camera-stop"]');
    if (start) start.hidden = false; if (stop) stop.hidden = true;
  }
  function cleanupModal() { modalEpoch++; stopCamera(); scanBusy = false; scanDirty = false; }
  function reset() {
    epoch++; cleanupModal(); stopTimers(); effects.cleanup(); dashboard = null; eventId = null; accountId = null; characterId = null; manage = false;
    editor = null; challenge = null; challengeCode = ''; startDraft = null; run = null; answer = ''; decision = null; pending = null; loading = false; feedback = ''; feedbackError = false; stale = false; poster = null; heartbeatSequence = 0; heartbeatBusy = false;
  }
  function ensureAccount() { const who = state.session?.user?.id || null; if (who !== accountId) { reset(); accountId = who; } return who; }
  function capture() {
    if (pending || state.view !== 'sigil') return;
    const form = document.querySelector('#sigil-editor-form');
    if (editor && form?.dataset.editorKey === editor.key && !form.querySelector('fieldset')?.disabled) {
      const data = new FormData(form), get = key => String(data.get(key) || '');
      editor.document = { ...editor.document, title: get('title'), summary: get('summary'), organizerNotes: get('organizerNotes'), durationSeconds: Number(data.get('durationSeconds')),
        roles: [...form.querySelectorAll('[data-sigil-role]')].map(row => ({ id: row.dataset.sigilRole, name: row.querySelector('[data-role="name"]').value, instructions: row.querySelector('[data-role="instructions"]').value })),
        components: [...form.querySelectorAll('[data-sigil-component]')].map(row => { const kind = row.querySelector('[data-component="kind"]').value; return { id: row.dataset.sigilComponent, name: row.querySelector('[data-component="name"]').value, kind, itemName: kind === 'item' ? row.querySelector('[data-component="itemName"]').value : null, resourceId: kind === 'resource' ? row.querySelector('[data-component="resourceId"]').value : null, quantity: Number(row.querySelector('[data-component="quantity"]').value), consume: row.querySelector('[data-component="consume"]').checked }; }),
        checkpoints: [...form.querySelectorAll('[data-sigil-checkpoint]')].map(row => ({ id: row.dataset.sigilCheckpoint, title: row.querySelector('[data-step="title"]').value, instructions: row.querySelector('[data-step="instructions"]').value, roleId: row.querySelector('[data-step="roleId"]').value, minimumSeconds: Number(row.querySelector('[data-step="minimumSeconds"]').value), answer: row.querySelector('[data-step="answer"]').value || null })),
        conditions: Object.fromEntries(['completed', 'flags', 'skills', 'statuses'].map(key => [key, data.getAll(`conditions.${key}`).map(String)])),
        success: { text: get('success.text'), flags: data.getAll('success.flags').map(String) }, failure: { text: get('failure.text'), flags: data.getAll('failure.flags').map(String) } };
    }
    const start = document.querySelector('#sigil-start-form');
    if (startDraft && start?.dataset.challengeId === challenge?.id && !start.querySelector('fieldset')?.disabled) {
      const data = new FormData(start); startDraft.roles = startDraft.roles.map(row => ({ ...row, performer: String(data.get(`performer.${row.roleId}`) || '') }));
      startDraft.bindings = startDraft.bindings.map(row => ({ ...row, itemId: String(data.get(`binding.${row.componentId}`) || '') })); startDraft.consent = data.get('consent') === 'on';
    }
    const step = document.querySelector('#sigil-checkpoint-form'); if (step && run && step.dataset.runId === run.id) answer = step.querySelector('[name="answer"]')?.value || '';
    const operation = document.querySelector('#sigil-operation-form'); if (decision && operation) decision.reason = String(new FormData(operation).get('reason') || '');
  }
  function applyDashboard(result) {
    dashboard = result; eventId = result.event.id; if (!manage) characterId = result.character?.id || null;
    if (state.event?.id === eventId) { state.event.status = result.event.status; if (result.event.role) state.event.role = result.event.role; }
    if (editor?.id) { const latest = result.entries?.find(row => row.id === editor.id); if (!latest || latest.version !== editor.version) { editor.conflict = true; editor.latest = latest || null; } }
  }
  function applyRun(next) {
    const previous = run;
    if (!next) { run = null; answer = ''; decision = null; return; }
    if (previous?.id !== next.id || previous.currentCheckpoint?.id !== next.currentCheckpoint?.id) answer = '';
    if (decision && next.version !== decision.version) decision.stale = true;
    run = next; runReceivedAt = performance.now(); heartbeatSequence = Math.max(heartbeatSequence, Number(next.heartbeatSequence) || 0); stale = false;
    if (effects.active && previous?.id === next.id && (previous.currentCheckpoint?.id !== next.currentCheckpoint?.id || previous.status !== next.status)) effects.cue(next.status === 'succeeded' ? 'success' : next.status === 'failed' ? 'failure' : 'checkpoint');
  }
  async function readDashboard(context = scope()) { return api(`${base(context.eventId)}${context.manage ? '/manage' : context.characterId ? `?${new URLSearchParams({ characterId: context.characterId })}` : ''}`); }
  async function readRun(id, context = scope()) { return api(`${base(context.eventId)}/runs/${id}${!context.manage && context.characterId ? `?${new URLSearchParams({ characterId: context.characterId })}` : ''}`); }
  function readError(error) {
    stale = true; feedback = error.message || 'Reconnect and refresh to check the current sequence.'; feedbackError = true;
    if ([401, 403, 404].includes(error.status)) { run = null; challenge = null; startDraft = null; editor = null; decision = null; effects.exit(); if (manage || error.status === 401 || /Event not found|Character not found/.test(error.message || '')) dashboard = null; }
  }
  async function open(options = {}) {
    ensureAccount(); if (state.view === 'sigil' && !confirmDiscard()) return;
    if (!state.event?.id) throw new Error('Open an event before opening SIGIL.');
    const id = state.event.id, chosen = options.characterId || (!options.manage && eventId === id ? characterId : null);
    cleanupModal(); stopTimers(); effects.exit(); epoch++; eventId = id; manage = Boolean(options.manage); characterId = chosen; dashboard = null; run = null; editor = null; challenge = null; startDraft = null; decision = null; answer = ''; pending = null; poster = null; stale = false; loading = true; feedback = ''; feedbackError = false; state.view = 'sigil';
    const context = scope(); render();
    try { const result = await readDashboard(context); if (!current(context)) return; applyDashboard(result); loading = false; render(); }
    catch (error) { if (!current(context)) return; loading = false; readError(error); render(); }
  }
  async function refresh() {
    capture(); if (pending) { toast('Retry the pending action before refreshing.'); return; }
    if (!connected()) { toast('Reconnect before checking the sequence.'); return; }
    epoch++; heartbeatBusy = false; const context = scope(), selectedId = run?.id; loading = true;
    try {
      const result = await readDashboard(context); if (!current(context)) return; applyDashboard(result);
      const detailContext = scope(); if (selectedId) { const detail = await readRun(selectedId, detailContext); if (!current(detailContext)) return; applyRun(detail.run); }
      stale = false; feedback = editor?.conflict ? 'This draft changed elsewhere. Your edits are retained; compare with the latest draft before saving.' : 'Current server state loaded. A paused sequence needs an explicit resume.'; feedbackError = false;
    } catch (error) { if (!current({ ...context, characterId })) return; readError(error); }
    finally { if (current({ ...context, characterId })) { loading = false; render(); } }
  }
  async function selectRun(id) {
    if (!confirmDiscard()) return; cleanupModal(); effects.exit(); epoch++; heartbeatBusy = false; run = null; challenge = null; startDraft = null; editor = null; decision = null; answer = ''; loading = true; feedback = ''; const context = scope(); render();
    try { const result = await readRun(id, context); if (!current(context)) return; applyRun(result.run); loading = false; render(); document.querySelector('#sigil-run-title')?.focus(); }
    catch (error) { if (!current(context)) return; loading = false; readError(error); render(); }
  }
  function clock() {
    if (!run) return { remaining: 0, checkpoint: 0, expiredLease: false, expiredTime: false };
    const elapsed = run.status === 'running' ? Math.max(0, performance.now() - runReceivedAt) : 0;
    const lease = run.leaseExpiresAt ? Math.max(0, milliseconds(run.leaseExpiresAt) - milliseconds(run.serverTime)) : Infinity;
    const counted = Math.min(elapsed, lease);
    return { remaining: Math.max(0, Number(run.remainingMs) - counted), checkpoint: Math.max(0, Number(run.checkpointRemainingMs) - counted), expiredLease: run.status === 'running' && elapsed >= lease, expiredTime: run.status === 'running' && counted >= Number(run.remainingMs) };
  }
  function runWritable() { const time = clock(); return Boolean(run && connected() && !stale && !pending && !loading && !time.expiredLease && !time.expiredTime); }
  function updateClock() {
    if (state.view !== 'sigil' || accountId !== state.session?.user?.id || eventId !== state.event?.id) { stopTimers(); effects.exit(); stopCamera(); return; }
    const time = clock();
    for (const node of document.querySelectorAll('[data-sigil-clock]')) node.textContent = duration(time.remaining);
    const hold = document.querySelector('[data-sigil-hold]'); if (hold) hold.textContent = time.checkpoint > 0 ? `Hold this checkpoint for ${duration(time.checkpoint)} more active time.` : 'The minimum checkpoint time has elapsed.';
    const connection = document.querySelector('#sigil-connection-state'); if (connection) connection.textContent = !connected() || stale ? 'Connection unconfirmed. Controls are frozen; reconnect and refresh.' : time.expiredTime ? 'Time elapsed. Waiting for the server to confirm the outcome.' : time.expiredLease ? 'Connection lease elapsed. Refresh, then explicitly resume if paused.' : run?.status === 'paused' ? 'Timer paused. Resume explicitly when the group is ready.' : 'Server-confirmed sequence. Connection checked every 5 seconds.';
    for (const button of document.querySelectorAll('[data-sigil-player-control]')) { const permission = button.dataset.sigilPlayerControl; button.disabled = !runWritable() || manage || !run?.[permission] || permission === 'canAdvance' && time.checkpoint > 0; }
    for (const button of document.querySelectorAll('[data-sigil-staff-control]')) button.disabled = !runWritable() || !manage || !run?.canOperate;
  }
  function ensureTimers() {
    if (!clockTimer) clockTimer = setInterval(updateClock, 250);
    if (!heartbeatTimer) heartbeatTimer = setInterval(() => { void heartbeat(); }, 5000);
    updateClock();
  }
  async function heartbeat() {
    if (state.view !== 'sigil' || document.hidden || manage || !run || run.status !== 'running' || !connected() || stale || pending || loading || heartbeatBusy) return;
    const context = scope(), id = run.id, initialVersion = run.version; heartbeatBusy = true;
    try {
      const result = await api(`${base()}/runs/${id}/heartbeat`, 'POST', { characterId, sequence: ++heartbeatSequence });
      if (!current(context) || run?.id !== id || pending || run.version > result.run.version || run.version !== initialVersion) return;
      const changed = run.status !== result.run.status || run.version !== result.run.version || run.currentCheckpoint?.id !== result.run.currentCheckpoint?.id; capture(); applyRun(result.run);
      if (changed) render(); else updateClock();
    } catch (error) { if (current(context) && run?.id === id && !pending) { capture(); readError(error); render(); } }
    finally { if (current(context)) heartbeatBusy = false; }
  }
  function pendingBanner() {
    return pending ? `<section class="sigil-notice" role="status"><strong>${pending.sending ? 'Waiting for server confirmation…' : 'This action has no confirmed response.'}</strong><p>${pending.sending ? 'The controls stay locked while ORACLE checks this request.' : 'It may have completed. Retry recovers the same request without consuming components or recording the outcome twice.'}</p>${!pending.sending ? `<button type="button" class="primary mt" data-action="sigil-retry" ${disabled(!connected())}>Retry pending action</button>` : ''}</section>` : '';
  }
  async function mutate(path, method, body, kind, retry = false) {
    ensureAccount(); capture(); if (!connected()) throw new Error('Reconnect before changing this sequence.');
    if (pending && !retry) throw new Error('Retry the pending action before making another change.');
    const record = retry ? pending : { path, method, body: kind === 'confirm-timeout' ? clone(body) : { ...clone(body), requestId: crypto.randomUUID() }, kind, sending: false };
    if (!record || record.sending) return;
    epoch++; heartbeatBusy = false; const context = scope(); pending = record; record.sending = true; feedback = ''; render();
    try {
      const result = await api(record.path, record.method, record.body); if (!current(context)) return;
      pending = null; stale = false; decision = null;
      if (result.run) { applyRun(result.run); challenge = null; startDraft = null; }
      if (result.entry) { if (record.kind === 'save') beginEditor(result.entry); }
      feedback = result.message || result.outcome?.message || (result.outcome?.replayed ? 'Earlier action recovered. No duplicate component consumption or outcome was recorded.' : record.kind === 'checkpoint' && result.run?.currentCheckpoint?.id === record.body.checkpointId ? 'That answer did not advance the checkpoint. Review it and try again.' : 'Server confirmed your action.'); feedbackError = result.outcome?.accepted === false;
      if (record.kind === 'checkpoint') answer = '';
      try { const fresh = await readDashboard(context); if (!current(context)) return; applyDashboard(fresh); }
      catch (error) { if (!current(context)) return; if ([401, 403, 404].includes(error.status)) readError(error); else feedback += ' Refresh to load the latest event list.'; }
    } catch (error) {
      if (!current(context)) return; record.sending = false;
      if (error.status >= 400 && error.status < 500) {
        pending = null; feedback = error.message; feedbackError = true;
        if (error.status === 409) { stale = Boolean(run); if (editor) editor.conflict = true; if (decision) decision.stale = true; feedback += editor ? ' Your draft is retained. Refresh and review the latest revision.' : ' Refresh the server state before continuing.'; }
        if ([401, 403, 404].includes(error.status)) readError(error);
      } else { stale = true; feedback = 'The connection did not confirm this action. Retry pending action to recover its result.'; feedbackError = true; }
    } finally { if (current(context)) { if (pending === record) record.sending = false; render(); } }
  }
  function beginEditor(row = null) {
    const value = clone(row?.document || freshDocument()); editor = { id: row?.id || null, key: crypto.randomUUID(), version: row?.version || null, document: value, baseline: canonical(value), conflict: false, latest: null }; run = null; challenge = null; startDraft = null; answer = ''; decision = null; effects.exit();
  }
  function options(rows, chosen, placeholder = 'Choose…') { return `<option value="">${esc(placeholder)}</option>${rows.map(row => `<option value="${esc(row.id)}" ${row.id === chosen ? 'selected' : ''}>${esc(row.name || row.title || row.label || row.id)}</option>`).join('')}`; }
  function picks(name, rows, chosen = []) {
    const all = [...rows, ...chosen.filter(id => !rows.some(row => row.id === id)).map(id => ({ id, name: `Unavailable reference: ${id}` }))];
    return all.length ? `<div class="sigil-picks">${all.map(row => `<label><input type="checkbox" name="${esc(name)}" value="${esc(row.id)}" ${chosen.includes(row.id) ? 'checked' : ''}> <span>${esc(row.name || row.title || row.label || row.id)}</span></label>`).join('')}</div>` : '<p class="hint">No event references are configured.</p>';
  }
  function editorView() {
    const doc = editor.document, context = dashboard.context || {}, locked = !editable();
    const saved = dashboard.entries?.find(row => row.id === editor.id);
    const publicationNotice = saved?.status === 'withdrawn' ? '<p class="sigil-notice">This challenge is withdrawn. Save any draft edits, then publish to make the challenge available again. Existing sessions require an explicit resume.</p>' : saved?.publishedVersion ? `<p class="sigil-notice">Published revision ${saved.publishedVersion} remains the player version. ${saved.hasUnpublishedChanges ? 'Saved draft changes are waiting to be published.' : 'The saved draft matches that publication.'} Save any edits, then choose Publish draft to make them live.</p>` : '<p class="hint">This challenge has no published version. Save the draft, then publish it when ready.</p>';
    return `<article class="panel sigil-editor"><div class="panel-head"><div><p class="eyebrow">Organizer authoring</p><h2>${editor.id ? 'Edit challenge draft' : 'New cooperative challenge'}</h2></div><button type="button" class="quiet" data-action="sigil-close-editor" ${disabled(Boolean(pending))}>Close draft</button></div><p id="sigil-save-state" class="hint" role="status">${editor.conflict ? 'Review required' : draftDirty() ? 'Unsaved changes · held in this tab' : editor.id ? 'Saved draft loaded' : 'New draft · held in this tab'}</p>${publicationNotice}${editor.conflict ? `<section class="sigil-notice"><h3>Review the latest draft</h3><p>Your edits are retained. Refresh to load the current saved version.</p>${editor.latest ? `<details><summary>Latest saved draft: ${esc(editor.latest.document?.title || 'Challenge')}</summary><p class="sigil-copy">${esc(editor.latest.document?.summary || '')}</p><p>${editor.latest.document?.checkpoints?.length || 0} checkpoints · ${editor.latest.document?.roles?.length || 0} roles · ${Number(editor.latest.document?.durationSeconds) || 0} seconds</p><pre class="sigil-draft-comparison">${esc(JSON.stringify(editor.latest.document, null, 2))}</pre></details><div class="actions"><button type="button" data-action="sigil-use-latest">Use latest draft</button><button type="button" data-action="sigil-keep-draft">Keep my edits against this revision</button></div>` : '<button type="button" data-action="sigil-refresh">Load latest draft</button>'}</section>` : ''}<form id="sigil-editor-form" data-editor-key="${esc(editor.key)}">${err}<fieldset ${disabled(locked)}><label>Challenge title<input name="title" value="${esc(doc.title)}" required maxlength="120"></label><label>Player summary<textarea name="summary" maxlength="2000" rows="3">${esc(doc.summary)}</textarea></label><label>Total active time (seconds)<input name="durationSeconds" type="number" min="10" max="3600" step="1" value="${doc.durationSeconds}" required></label><details class="sigil-section" open><summary>Cooperative roles · ${doc.roles.length}</summary><p class="hint">These are people at one shared device. All components belong to the host character.</p>${doc.roles.map((row, index) => `<div class="sigil-author-row" data-sigil-role="${esc(row.id)}"><div class="sigil-row-head"><h3>Role ${index + 1}</h3><button type="button" class="quiet" data-action="sigil-remove-role" data-index="${index}" ${disabled(doc.roles.length <= 1)}>Remove role</button></div><label>Role name<input data-role="name" value="${esc(row.name)}" required maxlength="80"></label><label>Role instructions<textarea data-role="instructions" rows="2" maxlength="1000">${esc(row.instructions)}</textarea></label></div>`).join('')}<button type="button" data-action="sigil-add-role" ${disabled(doc.roles.length >= 6)}>Add role</button></details><details class="sigil-section"><summary>Components · ${doc.components.length}</summary><p class="hint">Every requirement is checked at the start and at successful completion. Nothing is reserved. Only components marked “Consume on success” are deducted.</p>${doc.components.map((row, index) => `<div class="sigil-author-row" data-sigil-component="${esc(row.id)}"><div class="sigil-row-head"><h3>Component ${index + 1}</h3><button type="button" class="quiet" data-action="sigil-remove-component" data-index="${index}">Remove component</button></div><label>Player label<input data-component="name" value="${esc(row.name)}" maxlength="80" required></label><div class="sigil-fields"><label>Component type<select data-component="kind"><option value="item" ${row.kind === 'item' ? 'selected' : ''}>Inventory item</option><option value="resource" ${row.kind === 'resource' ? 'selected' : ''}>Event resource</option></select></label><label ${row.kind !== 'item' ? 'hidden' : ''}>Exact inventory item name<input data-component="itemName" value="${esc(row.itemName || '')}" maxlength="100" ${row.kind === 'item' ? 'required' : ''}></label><label ${row.kind !== 'resource' ? 'hidden' : ''}>Resource<select data-component="resourceId" ${row.kind === 'resource' ? 'required' : ''}>${options(context.resources || [], row.resourceId)}</select></label><label>Required quantity<input data-component="quantity" type="number" min="1" max="${row.kind === 'item' ? '9999' : '1000000000'}" step="1" value="${row.quantity}" required></label></div><label class="sigil-check"><input type="checkbox" data-component="consume" ${row.consume ? 'checked' : ''}> Consume on success</label></div>`).join('')}<button type="button" data-action="sigil-add-component" ${disabled(doc.components.length >= 10)}>Add component</button></details><details class="sigil-section" open><summary>Ordered checkpoints · ${doc.checkpoints.length}</summary>${doc.checkpoints.map((row, index) => `<div class="sigil-author-row" data-sigil-checkpoint="${esc(row.id)}"><div class="sigil-row-head"><h3>Checkpoint ${index + 1}</h3><div class="actions"><button type="button" class="quiet" data-action="sigil-step-up" data-index="${index}" aria-label="Move checkpoint ${index + 1} earlier" ${disabled(index === 0)}>↑</button><button type="button" class="quiet" data-action="sigil-step-down" data-index="${index}" aria-label="Move checkpoint ${index + 1} later" ${disabled(index === doc.checkpoints.length - 1)}>↓</button><button type="button" class="quiet" data-action="sigil-remove-checkpoint" data-index="${index}" ${disabled(doc.checkpoints.length <= 1)}>Remove</button></div></div><label>Title<input data-step="title" value="${esc(row.title)}" maxlength="120" required></label><label>Instructions shown at this checkpoint<textarea data-step="instructions" maxlength="3000" rows="3" required>${esc(row.instructions)}</textarea></label><div class="sigil-fields"><label>Assigned role<select data-step="roleId" required>${options(doc.roles, row.roleId)}</select></label><label>Minimum active time (seconds)<input data-step="minimumSeconds" type="number" min="0" max="600" step="1" value="${row.minimumSeconds}" required></label></div><label>Expected answer (optional)<input data-step="answer" value="${esc(row.answer || '')}" maxlength="80" autocomplete="off"></label><p class="hint">Leave blank for an acknowledgment. Answers are checked without case differences and are hidden from players.</p></div>`).join('')}<button type="button" data-action="sigil-add-checkpoint" ${disabled(doc.checkpoints.length >= 12)}>Add checkpoint</button></details><details class="sigil-section"><summary>Access requirements</summary><p class="hint">All selected discoveries, flags, and skills are required. At most 10 per category. Leave event statuses empty to use normal live and rehearsal access.</p><h3>Discoveries completed</h3>${picks('conditions.completed', context.nodes || [], doc.conditions.completed)}<h3>Event flags</h3>${picks('conditions.flags', context.flags || [], doc.conditions.flags)}<h3>Character skills</h3>${picks('conditions.skills', context.skills || [], doc.conditions.skills)}<h3>Allowed event statuses</h3>${picks('conditions.statuses', ['draft', 'rehearsal', 'live', 'paused', 'ended', 'archived'].map(id => ({ id, name: id })), doc.conditions.statuses)}</details><details class="sigil-section"><summary>Outcomes and private notes</summary><label>Success journal text<textarea name="success.text" maxlength="6000" rows="3" required>${esc(doc.success.text)}</textarea></label><h3>Flags set on success</h3>${picks('success.flags', context.flags || [], doc.success.flags)}<label>Failure journal text<textarea name="failure.text" maxlength="6000" rows="3" required>${esc(doc.failure.text)}</textarea></label><h3>Flags set on failure</h3>${picks('failure.flags', context.flags || [], doc.failure.flags)}<label>Private organizer notes<textarea name="organizerNotes" maxlength="6000" rows="4">${esc(doc.organizerNotes)}</textarea></label><p class="hint">Outcomes set configured flags and record a journal entry. Cancellation records no outcome and consumes nothing.</p></details><button type="submit" class="primary" ${disabled(editor.conflict)}>Save draft</button><p class="hint mt">Saving a draft does not publish it. Running groups keep the published version they started.</p></fieldset></form></article>`;
  }
  function characterPicker() {
    if (manage) return '<p class="sigil-notice">Organizer controls require current staff access and a recorded reason. Use your own character to participate. Use a player account for an unattended prop; prop presentation does not restrict a staff account.</p>';
    if (!dashboard.characters?.length) return `<section class="empty"><h2>An approved character is needed.</h2><p>${esc(dashboard.message || 'Use a character assigned to you to host a cooperative sequence.')}</p><button type="button" data-action="character-open">Open characters</button></section>`;
    return `<form id="sigil-character-form" class="sigil-character-picker"><label>Host character<select name="characterId" ${disabled(Boolean(pending))}>${options(dashboard.characters, characterId, 'Choose your character')}</select></label><button type="submit" ${disabled(Boolean(pending))}>Use character</button></form>`;
  }
  function listView() {
    const entries = manage ? dashboard.entries || [] : dashboard.challenges || [];
    return `<aside class="panel sigil-list"><div class="panel-head"><h2>${manage ? 'Challenge definitions' : 'Cooperative challenges'}</h2>${manage && dashboard.canManage ? `<button type="button" data-action="sigil-new" ${disabled(!editable())}>New challenge</button>` : ''}</div>${!manage ? `<button type="button" class="primary mt" data-action="sigil-scan" ${disabled(!connected() || !dashboard.character || Boolean(pending))}>Identify challenge prop</button>` : ''}<div class="sigil-card-list">${entries.length ? entries.map(row => `<article class="sigil-card"><div class="sigil-row-head"><h3>${esc(row.title || row.document?.title || row.published?.title || 'Challenge')}</h3><span class="badge">${esc(manage ? row.hasUnpublishedChanges ? 'Published · draft changes' : row.status || (row.publishedVersion ? 'Published' : 'Draft') : row.completed ? 'Completed' : row.available ? 'Available' : 'Locked')}</span></div><p class="hint sigil-copy">${esc(row.summary || row.document?.summary || row.published?.summary || '')}</p>${row.blockedReason ? `<p class="hint">${esc(row.blockedReason)}</p>` : ''}${manage ? `<div class="actions">${dashboard.canManage ? `<button type="button" data-action="sigil-edit" data-id="${esc(row.id)}" ${disabled(Boolean(pending))}>Edit draft</button><button type="button" data-action="sigil-publish" data-id="${esc(row.id)}" ${disabled(!editable())}>${row.publishedVersion ? 'Publish draft' : 'Publish'}</button>${row.status === 'published' ? `<button type="button" data-action="sigil-withdraw" data-id="${esc(row.id)}" ${disabled(!editable())}>Withdraw</button>` : ''}` : ''}${row.code ? `<button type="button" data-action="sigil-label" data-id="${esc(row.id)}" ${disabled(Boolean(pending))}>Prop label</button>` : ''}</div>` : !row.completed ? '<p class="hint">Use the printed prop code to review roles and components.</p>' : ''}</article>`).join('') : '<p class="hint">No challenges have been prepared for this event.</p>'}</div><h2 class="mt">${manage ? 'Group sessions' : 'Your sessions'}</h2><div class="sigil-card-list">${dashboard.runs?.length ? dashboard.runs.map(row => `<button type="button" class="sigil-session ${run?.id === row.id ? 'selected' : ''}" data-action="sigil-run" data-id="${esc(row.id)}" ${disabled(Boolean(pending))}><strong>${esc(row.title || 'Cooperative sequence')}</strong><span>${esc(labelStatus(row.status))}${row.character?.name ? ` · ${esc(row.character.name)}` : ''}</span></button>`).join('') : '<p class="hint">Sessions appear here after a host starts a challenge.</p>'}</div></aside>`;
  }
  function componentList(rows, host = dashboard?.character?.name || run?.character?.name || 'the host') {
    return rows?.length ? `<ul class="sigil-components">${rows.map(row => `<li><strong>${Number(row.quantity).toLocaleString()} × ${esc(row.name)}</strong><span>${row.consume ? 'Consumed on success' : 'Required, kept afterward'}${row.kind === 'item' ? ` · Exact item: ${esc(row.itemName)}` : ''}</span></li>`).join('')}</ul><p class="hint">Supplied only by ${esc(host)}. Requirements are checked again at completion. Nothing is reserved.</p>` : '<p class="hint">This challenge has no inventory or resource requirements.</p>';
  }
  function challengeView() {
    const row = challenge;
    return `<article class="panel sigil-challenge"><p class="eyebrow">SIGIL · Shared-device cooperation</p><h2>${esc(row.title)}</h2><p class="sigil-copy">${esc(row.summary)}</p><p><strong>${duration(row.durationSeconds * 1000)}</strong> of active time · ${row.roles.length} roles</p>${row.blockedReason ? `<p class="sigil-notice">${esc(row.blockedReason)}</p>` : ''}<h3 class="mt">Host requirements</h3>${componentList(row.components)}<form id="sigil-start-form" data-challenge-id="${esc(row.id)}">${err}<fieldset ${disabled(Boolean(pending) || !connected() || !row.available || dashboard.readOnly)}><h3>Who is doing each role?</h3><p class="hint">Name people beside this device. This does not authorize another player’s account or inventory.</p>${row.roles.map(role => `<label>${esc(role.name)}<input name="performer.${esc(role.id)}" value="${esc(startDraft.roles.find(item => item.roleId === role.id)?.performer || '')}" maxlength="80" required autocomplete="off"></label>${role.instructions ? `<p class="hint sigil-copy">${esc(role.instructions)}</p>` : ''}`).join('')}${row.components.filter(item => item.kind === 'item').map(component => `<label>Select ${esc(component.name)} from ${esc(dashboard.character?.name || 'your character')}<select name="binding.${esc(component.id)}" required>${options((dashboard.inventory || []).filter(item => item.name === component.itemName && Number(item.quantity) >= component.quantity).map(item => ({ id: item.id, name: `${item.name} · ${Number(item.quantity).toLocaleString()} available` })), startDraft.bindings.find(item => item.componentId === component.id)?.itemId, 'Choose an eligible inventory item')}</select></label>`).join('')}${row.components.some(item => item.kind === 'resource') ? `<p class="hint">Current host resources: ${(dashboard.balances || []).map(balance => `${Number(balance.quantity).toLocaleString()} ${esc(balance.name || dashboard.resources?.find(resource => resource.id === balance.resourceId)?.name || balance.resourceId)}`).join(', ') || 'No resource balance recorded'}.</p>` : ''}<label class="sigil-check"><input type="checkbox" name="consent" required ${startDraft.consent ? 'checked' : ''}> <span>I am hosting as <strong>${esc(dashboard.character?.name || 'my character')}</strong>. I agree to the listed requirements and consumption on success.</span></label><button type="submit" class="primary">Start cooperative sequence</button><p class="hint">Keep this page visible. Pause before putting the device away. A lost connection can count up to 20 seconds before the server freezes the timer; reconnect and resume explicitly.</p></fieldset></form></article>`;
  }
  function receiptView(result) {
    if (!result) return '';
    const consumed = [...(result.consumption?.items || []), ...(result.consumption?.resources || [])].filter(row => row.consumed > 0);
    return `<section class="sigil-result" role="status"><h3>${esc(labelStatus(result.status))}</h3><p class="sigil-copy">${esc(result.text || '')}</p>${consumed.length ? `<h4>Components consumed</h4><ul>${consumed.map(row => `<li>${Number(row.consumed).toLocaleString()} × ${esc(row.name)}</li>`).join('')}</ul>` : '<p class="hint">No components were consumed.</p>'}${result.flags?.length ? `<p class="hint">Outcome flags recorded: ${result.flags.map(esc).join(', ')}.</p>` : ''}<p class="hint">${esc(date(result.at))}</p>${!manage && result.journalId && ctx.openJournal ? '<button type="button" data-action="sigil-journal">Open my journal</button>' : ''}</section>`;
  }
  function runView() {
    const row = run, step = row.currentCheckpoint, role = row.roles?.find(item => (item.roleId || item.id) === step?.roleId), time = clock();
    return `<article class="panel sigil-run instrument-prop-surface ${effects.active ? 'sigil-prop-active' : ''}" data-sigil-status="${esc(row.status)}"><div class="sigil-prop-toolbar actions">${effects.active ? '<button type="button" data-action="sigil-prop-exit">Exit prop mode</button><button type="button" data-action="sigil-fullscreen">Full screen</button><button type="button" data-action="sigil-sound" aria-pressed="' + effects.soundEnabled + '">' + (effects.soundEnabled ? 'Sound on · turn off' : 'Sound off · turn on') + '</button>' : !manage ? '<button type="button" data-action="sigil-prop">Enter prop mode</button>' : ''}</div><div class="sigil-row-head"><div><p class="eyebrow">SIGIL · ${esc(row.character?.name || 'Group session')}</p><h2 id="sigil-run-title" tabindex="-1">${esc(row.title)}</h2></div><span class="badge">${esc(labelStatus(row.status))}</span></div><div class="sigil-timer"><span class="sigil-clock" data-sigil-clock aria-label="Remaining active time">${duration(time.remaining)}</span><span>active time remaining</span></div><p id="sigil-connection-state" class="sigil-connection" role="status"></p>${row.pauseReason ? `<p class="sigil-notice">Pause reason: ${esc(row.pauseReason)}</p>` : ''}${row.blockedReason ? `<p class="sigil-notice">${esc(row.blockedReason)}</p>` : ''}${effects.active ? pendingBanner() + feedbackView() : ''}${step ? `<section class="sigil-checkpoint"><p class="eyebrow">Checkpoint ${(row.completedCheckpoints?.length || 0) + 1}</p><h3>${esc(step.title)}</h3><p class="sigil-role">${esc(role?.performer || 'Assigned performer')} <span>· ${esc(role?.name || role?.roleName || step.roleId)}</span></p><p class="sigil-copy sigil-instructions">${esc(step.instructions)}</p>${step.minimumSeconds ? '<p class="hint" data-sigil-hold></p>' : ''}${!manage ? `<form id="sigil-checkpoint-form" data-run-id="${esc(row.id)}">${err}${step.requiresAnswer ? `<label>Checkpoint answer<input name="answer" value="${esc(answer)}" maxlength="80" required autocomplete="off" ${disabled(!runWritable() || row.status !== 'running')}></label>` : '<input type="hidden" name="answer" value="">'}<button type="submit" class="primary" data-sigil-player-control="canAdvance" ${disabled(!runWritable() || !row.canAdvance || time.checkpoint > 0)}>${step.requiresAnswer ? 'Check answer and continue' : 'Confirm checkpoint complete'}</button></form>` : '<p class="hint">The host performs the checkpoint. Staff can record an explicit intervention below.</p>'}</section>` : ''}${receiptView(row.result)}${row.status === 'failed' && !row.result ? `<section class="sigil-notice"><p>The server clock has expired. The outcome still needs a confirmed server command.</p>${!manage && row.canCancel ? `<button type="button" data-action="sigil-confirm-timeout" ${disabled(!connected() || Boolean(pending))}>Confirm expired result</button>` : '<p>Staff can record an intervention to confirm the expired outcome.</p>'}</section>` : ''}${!manage ? `<div class="actions sigil-run-actions">${row.canPause ? '<button type="button" data-action="sigil-pause" data-sigil-player-control="canPause">Pause sequence</button>' : ''}${row.canResume ? '<button type="button" class="primary" data-action="sigil-resume" data-sigil-player-control="canResume">Resume sequence</button>' : ''}${row.canCancel ? '<button type="button" data-action="sigil-cancel" data-sigil-player-control="canCancel">Cancel sequence</button>' : ''}<button type="button" data-action="sigil-refresh" ${disabled(Boolean(pending) || !connected())}>Refresh server state</button></div>` : row.canOperate ? `<section class="sigil-staff"><h3>Staff intervention</h3><p class="hint">A success override still checks and consumes the host’s required components. Final outcomes cannot be repeated.</p>${decision ? `<form id="sigil-operation-form">${err}<p><strong>${esc({ pause: 'Pause this sequence', resume: 'Resume this sequence', advance: 'Advance one checkpoint', succeed: 'Complete successfully', fail: 'Record failure', cancel: 'Cancel this sequence' }[decision.operation])}</strong></p>${decision.stale ? '<p class="sigil-notice">This session changed. Refresh and select the intervention again.</p>' : ''}<label>Reason for this intervention<textarea name="reason" rows="3" minlength="1" maxlength="2000" required ${disabled(Boolean(pending))}>${esc(decision.reason)}</textarea></label><div class="actions"><button type="submit" class="primary" ${disabled(!runWritable() || decision.stale)}>Confirm staff intervention</button><button type="button" data-action="sigil-close-operation" ${disabled(Boolean(pending))}>Back</button></div></form>` : `<div class="actions">${['pause', 'resume', 'advance', 'succeed', 'fail', 'cancel'].map(operation => `<button type="button" data-action="sigil-operation" data-operation="${operation}" data-sigil-staff-control ${disabled(!runWritable())}>${esc({ pause: 'Pause', resume: 'Resume', advance: 'Advance checkpoint', succeed: 'Success override', fail: 'Record failure', cancel: 'Cancel' }[operation])}</button>`).join('')}</div>`}</section>` : ''}<details class="sigil-section"><summary>Group and components</summary><ul>${(row.roles || []).map(item => `<li><strong>${esc(item.performer)}</strong> · ${esc(item.name || item.roleName || item.roleId || item.id)}</li>`).join('')}</ul>${componentList(row.components, row.character?.name)}<p class="hint">Published revision ${row.publishedVersion} · Session revision ${row.version}</p></details><details class="sigil-section"><summary>Checkpoint and intervention history · ${row.history?.length || 0}</summary><ol class="sigil-history">${(row.history || []).map(item => `<li><strong>${esc(item.label || item.action?.replaceAll('_', ' ') || item.type || 'Sequence updated')}</strong>${item.reason ? `<p class="sigil-copy">${esc(item.reason)}</p>` : ''}<span class="hint">${esc(date(item.at || item.createdAt))}</span></li>`).join('')}</ol>${row.completedCheckpoints?.length ? `<h4>Completed checkpoints</h4><ol>${row.completedCheckpoints.map(item => `<li>${esc(item.title)}</li>`).join('')}</ol>` : ''}</details></article>`;
  }
  function render() {
    ensureAccount(); if (state.view !== 'sigil' || !state.session?.user) return;
    const priorEditor = document.querySelector('#sigil-editor-form');
    const disclosures = priorEditor && editor && priorEditor.dataset.editorKey === editor.key ? [...priorEditor.querySelectorAll('details')].map(row => row.open) : null;
    const openRunSections = run && document.querySelector('#sigil-run-title') ? [...document.querySelectorAll('.sigil-run > details')].map(row => row.open) : null;
    if (!dashboard || dashboard.event?.id !== state.event?.id) { shell(`<section class="sigil-workspace"><button type="button" class="quiet" data-action="sigil-event">← Event briefing</button><h1 class="mt">SIGIL</h1><p role="status">${loading ? 'Loading cooperative challenges…' : 'Open or refresh this event to load SIGIL.'}</p>${feedbackView()}<button type="button" data-action="sigil-refresh" ${disabled(!connected() || loading)}>Refresh</button></section>`); return; }
    const detail = editor ? editorView() : run ? runView() : challenge ? challengeView() : `<section class="panel sigil-empty"><p class="eyebrow">SIGIL</p><h2>${manage ? 'Prepare a shared challenge.' : 'One device. A group effort.'}</h2><p>${manage ? 'Assign roles, order the checkpoints, and choose the component requirements and outcomes. Publish when ready, then print the prop label.' : 'Identify a challenge prop, choose your in-person roles, and work through its checkpoints together.'}</p><p class="hint">The server keeps the active timer and records each final outcome once. Pause before leaving the device.</p></section>`;
    shell(`<section class="sigil-workspace"><div class="actions"><button type="button" class="quiet" data-action="sigil-event">← Event briefing</button>${dashboard.canOperate || dashboard.canManage ? `<button type="button" class="quiet" data-action="${manage ? 'sigil-open' : 'sigil-manage'}">${manage ? 'Play as my character' : 'Manage challenges'}</button>` : ''}</div><header class="page-head mt"><div><p class="eyebrow">${esc(dashboard.event.name)} · SIGIL${manage ? ' · Organizer tools' : ''}</p><h1>Cooperative sequences</h1><p class="muted">Assign the roles. Complete the steps. Shape the outcome.</p></div><button type="button" data-action="sigil-refresh" ${disabled(!connected() || Boolean(pending) || loading)}>Refresh</button></header>${!effects.active ? pendingBanner() + feedbackView() : ''}${characterPicker()}${!manage && dashboard.readOnly ? `<p class="sigil-notice">${esc(dashboard.message || 'Starting and advancing require SIGIL to be enabled during live play or rehearsal.')}</p>` : ''}<div class="sigil-layout">${listView()}<section class="sigil-detail" aria-label="Challenge details">${detail}</section></div></section>${poster ? `<section class="sigil-poster-view"><div class="actions sigil-print-controls"><button type="button" data-action="sigil-close-label">Close label</button><button type="button" class="primary" data-action="sigil-print">Print prop label</button></div><article id="sigil-prop-label"><p class="eyebrow">${esc(dashboard.event.name)} · ORACLE / SIGIL</p><h1>${esc(poster.title)}</h1><p>Cooperative challenge · LARP Field Kit</p><div id="sigil-label-qr"></div><p class="sigil-printed-code">${esc(poster.code.match(/.{1,4}/g)?.join('-') || poster.code)}</p><p>Scan with ORACLE or enter this code in SIGIL.</p></article></section>` : ''}`);
    if (poster) { try { const canvas = renderBadgeQR(document.querySelector('#sigil-label-qr'), `${location.origin}/#sigil/${eventId}/${poster.code}`); canvas.setAttribute('aria-label', 'SIGIL challenge prop QR code'); } catch { const el = document.querySelector('#sigil-label-qr'); if (el) el.textContent = 'QR drawing unavailable. The printed code works in SIGIL.'; } }
    if (disclosures) [...document.querySelectorAll('#sigil-editor-form details')].forEach((row, index) => { if (disclosures[index] !== undefined) row.open = disclosures[index]; });
    if (openRunSections) [...document.querySelectorAll('.sigil-run > details')].forEach((row, index) => { if (openRunSections[index] !== undefined) row.open = openRunSections[index]; });
    ensureTimers();
  }
  function confirmDiscard(destination) {
    capture(); if (destination === 'modal') { if (scanDirty && !window.confirm('Discard this unsubmitted prop code?')) return false; return true; }
    if (pending?.sending) { toast('Wait for the current SIGIL request before leaving.'); return false; }
    if (pending && !window.confirm('This action has no confirmed response. Retry can recover it without a second outcome or charge. Leave and discard this tab’s retry information?')) return false;
    if (dirty() && !window.confirm('Discard your unsaved SIGIL entries?')) return false;
    if (pending) pending = null; if (editor && draftDirty()) editor = null; startDraft = null; challenge = null; answer = ''; decision = null; scanDirty = false;
    effects.exit(); cleanupModal(); return true;
  }
  async function lookupInput(value, expectedModalEpoch) {
    let token = expectedModalEpoch;
    const validModal = () => token === undefined || token === modalEpoch;
    if (!validModal()) return;
    const parsed = parseInstrumentInput(String(value), location.origin, 'sigil', state.event?.id);
    if (!parsed.eventId) throw new Error('Open an event before entering a printed SIGIL code.');
    if (state.event?.id !== parsed.eventId) {
      const who = state.session?.user?.id;
      await loadEvent(parsed.eventId);
      // Event loading deliberately resets private modules. Continue only in the
      // requested event and account, using a new scope after that reset.
      if (state.session?.user?.id !== who || state.event?.id !== parsed.eventId) return;
      await open(); token = expectedModalEpoch === undefined ? undefined : modalEpoch;
    }
    else if (!dashboard || manage || state.view !== 'sigil') await open();
    if (!validModal()) return; if (!dashboard?.character) throw new Error('Choose an approved character assigned to you before identifying this challenge.');
    const context = scope(); const result = await api(`${base()}/lookup`, 'POST', { characterId, code: parsed.code });
    if (!current(context) || !validModal()) return;
    capture(); if (contentDirty() && !window.confirm('Replace your unsubmitted SIGIL entries with this challenge?')) return;
    editor = null; run = null; answer = ''; decision = null; challenge = result.challenge; challengeCode = parsed.code; startDraft = { roles: challenge.roles.map(row => ({ roleId: row.id, performer: '' })), bindings: challenge.components.filter(row => row.kind === 'item').map(row => ({ componentId: row.id, itemId: '' })), consent: false }; feedback = ''; stale = false; effects.exit(); scanDirty = false; closeModal(true); render(); document.querySelector('#sigil-start-form input')?.focus();
  }
  function scanModal() {
    cleanupModal(); openModal('Identify a SIGIL challenge', `<p class="hint">Scan the prop’s QR code, choose a photo, or enter its printed code. Your character’s access is checked before the challenge opens.</p>${err}<div class="sigil-scanner"><video id="sigil-scanner-video" muted playsinline hidden></video><p id="sigil-scanner-status" class="hint" role="status">The camera stays off until you choose Start camera.</p><div class="actions"><button type="button" data-action="sigil-camera">Start camera</button><button type="button" data-action="sigil-camera-stop" hidden>Stop camera</button></div><label>Read a QR image<input id="sigil-scan-file" type="file" accept="image/png,image/jpeg,image/webp"></label><form id="sigil-scan-form">${err}<label>Prop code or ORACLE SIGIL link<input name="code" required maxlength="500" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"></label><button type="submit" class="primary">Identify challenge</button></form></div>`);
  }
  function scannerError(error) { const node = document.querySelector('#sigil-scanner-status'); if (node) node.textContent = error.message || 'The prop could not be read.'; else toast(error.message || 'The prop could not be read.'); }
  async function camera() {
    if (scannerController || scanBusy) return; const token = modalEpoch, video = document.querySelector('#sigil-scanner-video'); if (!video) return;
    const controller = new AbortController(); scannerController = controller; video.hidden = false; document.querySelector('#sigil-scanner-status').textContent = 'Requesting camera access…'; document.querySelector('[data-action="sigil-camera"]').hidden = true; document.querySelector('[data-action="sigil-camera-stop"]').hidden = false;
    const stop = await startScanner(video, value => { if (token !== modalEpoch) return; stopCamera(); if (scanBusy) return; scanBusy = true; document.querySelector('#sigil-scanner-status').textContent = 'Checking the current challenge…'; void lookupInput(value, token).catch(error => { if (token === modalEpoch) scannerError(error); }).finally(() => { if (token === modalEpoch) scanBusy = false; }); }, error => { if (token === modalEpoch) { stopCamera(); scannerError(error); } }, { signal: controller.signal });
    if (controller.signal.aborted || token !== modalEpoch) { stop(); return; } scannerStop = stop; const node = document.querySelector('#sigil-scanner-status'); if (node) node.textContent = 'Point the camera at the SIGIL QR code.';
  }
  async function handleHash() {
    if (!location.hash.startsWith('#sigil/') || !state.session?.user) return false;
    if (!confirmDiscard()) { history.replaceState(null, '', `${location.pathname}${location.search}`); return true; }
    try { await lookupInput(`${location.origin}/${location.hash}`); } catch (error) { toast(error.message || 'This challenge could not be opened.'); }
    if (state.session?.user) history.replaceState(null, '', `${location.pathname}${location.search}`); return true;
  }
  async function action(button) {
    const name = button.dataset.action; if (!name?.startsWith('sigil-')) return false; ensureAccount(); capture();
    if (name === 'sigil-open' || name === 'sigil-manage') await open({ manage: name === 'sigil-manage', characterId: button.dataset.characterId });
    else if (name === 'sigil-event') { if (confirmDiscard()) { epoch++; stopTimers(); await loadEvent(state.event.id); } }
    else if (name === 'sigil-refresh') await refresh();
    else if (name === 'sigil-retry') await mutate(null, null, null, null, true);
    else if (name === 'sigil-confirm-timeout') { if (!manage && run?.status === 'failed' && !run.result && run.canCancel && connected() && !pending) await mutate(`${base()}/runs/${run.id}/heartbeat`, 'POST', { characterId, sequence: ++heartbeatSequence }, 'confirm-timeout'); }
    else if (name === 'sigil-run') await selectRun(button.dataset.id);
    else if (name === 'sigil-scan') { if (connected() && !pending && dashboard?.character) scanModal(); }
    else if (name === 'sigil-camera') void camera().catch(scannerError);
    else if (name === 'sigil-camera-stop') { modalEpoch++; stopCamera(); const node = document.querySelector('#sigil-scanner-status'); if (node) node.textContent = 'Camera stopped. Enter a code or choose a QR image.'; }
    else if (name === 'sigil-prop') { if (!manage && run) { effects.enter('sigil'); render(); } }
    else if (name === 'sigil-prop-exit') { effects.exit(); render(); }
    else if (name === 'sigil-fullscreen') { try { await effects.fullscreen(); } catch { toast('Full screen is unavailable. Prop mode remains active.'); } }
    else if (name === 'sigil-sound') { await effects.toggleSound(); render(); }
    else if (name === 'sigil-journal') { if (ctx.openJournal && confirmDiscard()) { epoch++; stopTimers(); await ctx.openJournal(characterId); } }
    else if (name === 'sigil-new') { if (editable() && confirmDiscard()) { beginEditor(); render(); } }
    else if (name === 'sigil-edit') { const row = dashboard?.entries?.find(item => item.id === button.dataset.id); if (row?.document && dashboard.canManage && confirmDiscard()) { beginEditor(row); render(); } }
    else if (name === 'sigil-close-editor') { if (confirmDiscard()) { editor = null; render(); } }
    else if (name === 'sigil-use-latest') { if (editor?.latest && window.confirm('Replace your retained edits with the latest saved draft?')) { beginEditor(editor.latest); feedback = 'Latest draft loaded.'; feedbackError = false; render(); } }
    else if (name === 'sigil-keep-draft') { if (editor?.latest) { editor.version = editor.latest.version; editor.baseline = canonical(editor.latest.document); editor.conflict = false; editor.latest = null; feedback = 'Your edits target the reviewed revision. Save and publish separately when ready.'; feedbackError = false; render(); } }
    else if (['sigil-publish', 'sigil-withdraw'].includes(name)) {
      const row = dashboard?.entries?.find(item => item.id === button.dataset.id); if (!row || !editable() || !confirmDiscard()) return true;
      const operation = name === 'sigil-publish' ? 'publish' : 'withdraw';
      if (!window.confirm(operation === 'publish' ? `Publish the saved draft of “${row.document?.title || row.title || 'this challenge'}”? Existing sessions keep their original version.` : 'Withdraw this challenge and pause any running sessions?')) return true;
      editor = null; await mutate(`${base()}/entries/${row.id}/${operation}`, 'POST', { version: row.version }, operation);
    } else if (name === 'sigil-label') { const row = dashboard?.entries?.find(item => item.id === button.dataset.id); if (manage && row?.code) { poster = { title: row.published?.title || row.document?.title || row.title || 'SIGIL challenge', code: row.code }; render(); } }
    else if (name === 'sigil-close-label') { poster = null; render(); }
    else if (name === 'sigil-print') { if (poster) window.print(); }
    else if (name === 'sigil-operation') { if (manage && run?.canOperate && runWritable() && ['pause', 'resume', 'advance', 'succeed', 'fail', 'cancel'].includes(button.dataset.operation)) { decision = { operation: button.dataset.operation, version: run.version, reason: '', stale: false }; render(); document.querySelector('#sigil-operation-form textarea')?.focus(); } }
    else if (name === 'sigil-close-operation') { if (!decision?.reason || window.confirm('Discard this unsubmitted intervention reason?')) { decision = null; render(); } }
    else if (['sigil-pause', 'sigil-resume', 'sigil-cancel'].includes(name)) {
      const operation = name.slice(6), permission = { pause: 'canPause', resume: 'canResume', cancel: 'canCancel' }[operation];
      if (!manage && runWritable() && run?.[permission]) { if (operation === 'cancel' && !window.confirm('Cancel this sequence? No components will be consumed and no outcome flags will be set.')) return true; await mutate(`${base()}/runs/${run.id}/${operation}`, 'POST', { characterId, version: run.version }, operation); }
    } else if (editor && editable()) {
      const doc = editor.document, index = Number(button.dataset.index), valid = rows => Number.isInteger(index) && index >= 0 && index < rows.length;
      if (name === 'sigil-add-role' && doc.roles.length < 6) doc.roles.push({ id: newId('role'), name: '', instructions: '' });
      else if (name === 'sigil-remove-role' && valid(doc.roles) && doc.roles.length > 1) { const [removed] = doc.roles.splice(index, 1); for (const step of doc.checkpoints) if (step.roleId === removed.id) step.roleId = ''; }
      else if (name === 'sigil-add-component' && doc.components.length < 10) doc.components.push({ id: newId('component'), name: '', kind: 'item', itemName: '', resourceId: null, quantity: 1, consume: false });
      else if (name === 'sigil-remove-component' && valid(doc.components)) doc.components.splice(index, 1);
      else if (name === 'sigil-add-checkpoint' && doc.checkpoints.length < 12) doc.checkpoints.push({ id: newId('step'), title: '', instructions: '', roleId: doc.roles[0]?.id || '', minimumSeconds: 0, answer: null });
      else if (name === 'sigil-remove-checkpoint' && valid(doc.checkpoints) && doc.checkpoints.length > 1) doc.checkpoints.splice(index, 1);
      else if (name === 'sigil-step-up' && valid(doc.checkpoints) && index > 0) [doc.checkpoints[index - 1], doc.checkpoints[index]] = [doc.checkpoints[index], doc.checkpoints[index - 1]];
      else if (name === 'sigil-step-down' && valid(doc.checkpoints) && index < doc.checkpoints.length - 1) [doc.checkpoints[index + 1], doc.checkpoints[index]] = [doc.checkpoints[index], doc.checkpoints[index + 1]];
      else return true;
      render();
    }
    return true;
  }
  async function submit(form) {
    if (!form.id?.startsWith('sigil-')) return false;
    if (form.id === 'sigil-character-form') { await open({ characterId: String(new FormData(form).get('characterId') || '') }); return true; }
    if (form.id === 'sigil-scan-form') { if (scanBusy) throw new Error('Wait for the current prop lookup to finish.'); stopCamera(); scanBusy = true; const token = modalEpoch; try { await lookupInput(new FormData(form).get('code'), token); } finally { if (token === modalEpoch) scanBusy = false; } return true; }
    capture(); if (!form.reportValidity()) return true;
    if (form.id === 'sigil-editor-form') {
      if (!editor || !editable() || editor.conflict) return true;
      await mutate(`${base()}/entries${editor.id ? `/${editor.id}` : ''}`, editor.id ? 'PUT' : 'POST', { ...(editor.id ? { version: editor.version } : {}), document: clone(editor.document) }, 'save');
    } else if (form.id === 'sigil-start-form') {
      if (manage || !challenge?.available || !startDraft?.consent || pending || !connected() || dashboard.readOnly) return true;
      await mutate(`${base()}/start`, 'POST', { characterId, entryId: challenge.id, publishedVersion: challenge.publishedVersion, code: challengeCode, roles: clone(startDraft.roles), bindings: clone(startDraft.bindings) }, 'start');
    } else if (form.id === 'sigil-checkpoint-form') {
      if (manage || !runWritable() || !run?.canAdvance || clock().checkpoint > 0 || !run.currentCheckpoint) return true;
      await mutate(`${base()}/runs/${run.id}/checkpoint`, 'POST', { characterId, version: run.version, checkpointId: run.currentCheckpoint.id, roleId: run.currentCheckpoint.roleId, answer }, 'checkpoint');
    } else if (form.id === 'sigil-operation-form') {
      if (!manage || !runWritable() || !run?.canOperate || !decision || decision.stale || decision.version !== run.version) return true;
      await mutate(`${base()}/runs/${run.id}/operate`, 'POST', { version: decision.version, operation: decision.operation, reason: decision.reason.trim() }, 'operate');
    }
    return true;
  }
  function changed(event) {
    if (state.view !== 'sigil') return;
    if (event.target.closest('#sigil-scan-form')) scanDirty = true;
    if (!event.target.closest('#sigil-editor-form, #sigil-start-form, #sigil-checkpoint-form, #sigil-operation-form')) return;
    capture(); const indicator = document.querySelector('#sigil-save-state'); if (indicator) indicator.textContent = editor?.conflict ? 'Review required' : draftDirty() ? 'Unsaved changes · held in this tab' : 'Saved draft loaded';
    if (event.type === 'change' && event.target.dataset.component === 'kind' && editor) render();
  }
  document.addEventListener('input', changed);
  document.addEventListener('change', event => {
    changed(event); if (state.view !== 'sigil' || event.target.id !== 'sigil-scan-file') return;
    const file = event.target.files?.[0]; if (!file || scanBusy) return;
    const token = modalEpoch; stopCamera(); scanBusy = true; const node = document.querySelector('#sigil-scanner-status'); if (node) node.textContent = 'Reading the QR image…';
    void scanImage(file).then(value => { if (token === modalEpoch) return lookupInput(value, token); }).catch(error => { if (token === modalEpoch) scannerError(error); }).finally(() => { if (token === modalEpoch) scanBusy = false; });
  });
  function loseVisibility() {
    stopCamera(); effects.cleanup();
    if (state.view !== 'sigil') return; capture();
    if (!manage && run?.status === 'running' && !pending && connected()) {
      // Best effort only. The server lease still freezes time if this request cannot complete.
      const context = scope(), id = run.id, version = run.version; const body = { requestId: crypto.randomUUID(), characterId, version };
      void api(`${base()}/runs/${id}/pause`, 'POST', body).then(result => { if (current(context) && run?.id === id && !pending && run.version === version) { applyRun(result.run); stale = true; } }).catch(() => {});
    }
    stale = Boolean(run); updateClock();
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) loseVisibility(); else if (state.view === 'sigil') { capture(); if (run) { stale = true; feedback = 'The device was hidden. Refresh the server state, then resume explicitly if paused.'; feedbackError = false; } render(); } });
  window.addEventListener('offline', () => { if (state.view === 'sigil') { capture(); stale = true; stopCamera(); effects.cleanup(); render(); } });
  window.addEventListener('online', () => { if (state.view === 'sigil') { feedback = 'Connection restored. Refresh the server state before continuing.'; feedbackError = false; render(); } });
  window.addEventListener('pagehide', loseVisibility);
  window.addEventListener('beforeunload', event => { capture(); if (dirty() || pending) { event.preventDefault(); event.returnValue = ''; } });
  return { open, render, action, submit, confirmDiscard, isDirty: () => { capture(); return dirty() || Boolean(pending); }, reset, cleanupModal, handleHash };
}
