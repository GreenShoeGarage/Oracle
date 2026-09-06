import { scanImage, startScanner, renderBadgeQR } from './qr.js';
import { parseInstrumentInput } from './instrument-code.js';
import { createPropEffects } from './prop-effects.js';
import { defaultStaticDocument } from './static-model.js';

const clone = value => structuredClone(value);
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const emptyConditions = () => ({ completed: [], flags: [], skills: [], statuses: [] });
const slug = kind => `${kind}-${crypto.randomUUID().slice(0, 8)}`;

export function createStaticUI(ctx) {
  const { state, api, shell, esc, loadEvent, toast, openModal, closeModal } = ctx;
  const effects = createPropEffects();
  let dashboard = null, signal = null, signalCode = null, editor = null, decision = null, pending = null;
  let accountId = null, eventId = null, characterId = null, manage = false, epoch = 0, loading = false, feedback = '', feedbackError = false, stale = false;
  let modalEpoch = 0, scannerController = null, scannerStop = null, scanBusy = false, scanDirty = false, labelLink = null;
  const connected = () => navigator.onLine !== false;
  const base = (id = eventId) => `/api/events/${id}/static`;
  const scope = () => ({ epoch, accountId, eventId, manage });
  const current = value => value.epoch === epoch && value.accountId && value.accountId === state.session?.user?.id && value.eventId === state.event?.id && value.manage === manage && state.view === 'static';
  const disabled = value => value ? 'disabled' : '';
  const date = value => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const canWrite = () => connected() && !pending && Boolean(dashboard?.canManage) && dashboard.event.status !== 'archived';
  const canOperate = () => connected() && !pending && Boolean(dashboard?.canOperate) && ['live', 'rehearsal'].includes(dashboard.event.status) && state.event?.setup?.enabledInstruments?.includes('static') !== false;
  const isCollected = () => Boolean(signal && dashboard?.readings?.some(row => row.entryId === signal.id && row.readingKey === signal.readingKey));
  const dirtyDraft = () => Boolean(editor && canonical(editor.document) !== editor.baseline);
  const dirtyDecision = () => Boolean(decision && (decision.reason || decision.stateId !== decision.originalStateId));
  function reset() {
    epoch++; cleanupModal(); effects.cleanup(); dashboard = null; signal = null; signalCode = null; editor = null; decision = null; pending = null;
    accountId = null; eventId = null; characterId = null; manage = false; loading = false; feedback = ''; feedbackError = false; stale = false;
  }
  function ensureAccount() {
    const who = state.session?.user?.id || null;
    if (who !== accountId) { reset(); accountId = who; }
    return who;
  }
  function applyDashboard(result) {
    dashboard = result; eventId = result.event.id;
    if (!manage) characterId = result.character?.id || null;
    if (state.event?.id === eventId) { state.event.status = result.event.status; if (result.event.role) state.event.role = result.event.role; }
    if (editor?.id) {
      const latest = result.entries?.find(row => row.id === editor.id);
      if (latest && latest.version !== editor.version) { editor.conflict = true; editor.latest = latest; }
    }
    if (decision) {
      const latest = result.entries?.find(row => row.id === decision.entryId);
      if (!latest || latest.override?.version !== decision.version || latest.publishedVersion !== decision.publicationVersion) { decision.stale = true; decision.latest = latest || null; }
    }
  }
  async function fetchDashboard(context) {
    return api(`${base(context.eventId)}${context.manage ? '/manage' : characterId ? `?${new URLSearchParams({ characterId })}` : ''}`);
  }
  function readError(error) {
    stale = true; feedback = error.message || 'The current reading could not be confirmed. Reconnect and refresh.'; feedbackError = true;
    if ([401, 403, 404].includes(error.status)) {
      signal = null; signalCode = null; effects.exit();
      if (manage || error.status === 401 || /Event not found|Character not found/.test(error.message || '')) { dashboard = null; editor = null; decision = null; }
    }
  }
  async function open(options = {}) {
    ensureAccount(); if (state.view === 'static' && !confirmDiscard()) return;
    const id = state.event?.id; if (!id) throw new Error('Open an event before opening STATIC.');
    const chosen = options.characterId || (!options.manage && id === eventId ? characterId : null);
    epoch++; cleanupModal(); effects.exit(); eventId = id; manage = Boolean(options.manage); characterId = chosen; dashboard = null; signal = null; signalCode = null; editor = null; decision = null; pending = null; loading = true; stale = false; feedback = ''; feedbackError = false; state.view = 'static';
    const context = scope(); render();
    try { const result = await fetchDashboard(context); if (!current(context)) return; applyDashboard(result); loading = false; render(); }
    catch (error) { if (!current(context)) return; loading = false; readError(error); render(); }
  }
  function captureConditions(form, prefix) {
    const data = new FormData(form);
    return { completed: data.getAll(`${prefix}-completed`).map(String), flags: data.getAll(`${prefix}-flags`).map(String), skills: data.getAll(`${prefix}-skills`).map(String), statuses: data.getAll(`${prefix}-statuses`).map(String) };
  }
  function capture() {
    if (pending || state.view !== 'static') return;
    const form = document.querySelector('#static-editor-form');
    if (editor && form?.dataset.editorKey === editor.key && !form.querySelector('fieldset')?.disabled) {
      const data = new FormData(form);
      editor.document = { ...editor.document, title: String(data.get('title') || ''), summary: String(data.get('summary') || ''), organizerNotes: String(data.get('organizerNotes') || ''), zoneLabel: String(data.get('zoneLabel') || ''), defaultStateId: String(data.get('defaultStateId') || ''), conditions: captureConditions(form, 'base'), states: [...form.querySelectorAll('[data-static-state]')].map(row => ({ id: row.dataset.staticState, label: row.querySelector('[data-state-field="label"]').value, text: row.querySelector('[data-state-field="text"]').value, level: Number(row.querySelector('[data-state-field="level"]').value), tone: row.querySelector('[data-state-field="tone"]').value })), rules: [...form.querySelectorAll('[data-static-rule]')].map(row => ({ id: row.dataset.staticRule, stateId: row.querySelector('[data-rule-state]').value, conditions: captureConditions(form, `rule-${row.dataset.staticRule}`) })) };
    }
    const control = document.querySelector('#static-state-form');
    if (decision && control && !control.querySelector('fieldset')?.disabled) {
      const data = new FormData(control); decision.stateId = String(data.get('stateId') || ''); decision.reason = String(data.get('reason') || '');
    }
  }
  function beginEditor(row = null) {
    const document = row ? clone(row.document) : defaultStaticDocument();
    editor = { id: row?.id || null, version: row?.version || null, key: row?.id || crypto.randomUUID(), document, baseline: canonical(document), conflict: false, latest: null };
    decision = null; feedback = ''; feedbackError = false;
  }
  async function refresh() {
    capture(); if (pending) { toast('Retry the pending action before refreshing.'); return; }
    if (!connected()) { toast('Reconnect to confirm the current reading.'); return; }
    epoch++; const context = scope(), selected = signal?.id, code = signalCode;
    try {
      const result = await fetchDashboard(context); if (!current(context)) return; applyDashboard(result);
      if (!manage && selected && code && characterId) {
        const latest = await api(`${base()}/entries/${selected}?${new URLSearchParams({ characterId, code })}`); if (!current(context)) return;
        const changed = signal?.readingKey !== latest.signal.readingKey; signal = latest.signal; if (changed) effects.cue('reading');
      }
      stale = false; feedback = editor?.conflict || decision?.stale ? 'The saved configuration changed. Your draft is retained; review the latest version before continuing.' : 'Current event state confirmed.'; feedbackError = false; render();
    } catch (error) { if (!current(context)) return; readError(error); render(); }
  }
  function pendingView() {
    return pending ? `<section class="static-notice" role="status"><strong>${pending.sending ? 'Waiting for ORACLE to confirm…' : 'This action has no confirmed response yet.'}</strong><p>${pending.sending ? 'Keep this view open while the result is checked.' : 'The action may have completed. Retry recovers the same request without collecting or changing state twice.'}</p>${pending.sending ? '' : `<button type="button" class="primary mt" data-action="static-retry" ${disabled(!connected())}>Retry pending action</button>`}</section>` : '';
  }
  function characterPicker() {
    const rows = dashboard.characters || [];
    if (!rows.length) return '<section class="empty"><h2>An approved character is needed.</h2><p>Choose a character assigned to you before identifying a fictional signal.</p><button type="button" data-action="character-open">Open characters</button></section>';
    return `<form id="static-character-form" class="static-character-picker"><label>Reading as<select name="characterId" ${disabled(Boolean(pending))}>${rows.map(row => `<option value="${esc(row.id)}" ${row.id === characterId ? 'selected' : ''}>${esc(row.name)}</option>`).join('')}</select></label><button type="submit" ${disabled(Boolean(pending))}>Use character</button></form>`;
  }
  function propControls() {
    return effects.active ? `<div class="instrument-prop-controls"><button type="button" class="primary" data-action="static-prop-exit">Exit prop mode</button><button type="button" data-action="static-fullscreen">Full screen</button><button type="button" data-action="static-sound" aria-pressed="${effects.soundEnabled}">Sound ${effects.soundEnabled ? 'on' : 'off'}</button></div><p class="hint">Sound is optional. Every reading is also shown as text and a visual level.</p>` : `<div class="actions mt"><button type="button" data-action="static-prop" ${disabled(stale || !connected())}>Enter prop mode</button></div>${dashboard?.canOperate ? '<p class="hint mt">Use a player account for an unattended prop. Prop mode changes the display; this account keeps its existing staff permissions.</p>' : ''}`;
  }
  function signalView() {
    if (!signal) return '<section class="panel static-empty"><p class="eyebrow">STATIC</p><h2>A world that answers back.</h2><p>Identify a marked prop or zone to reveal the fictional reading prepared for your character.</p><p class="static-fiction-label">Fictional event readings · no real sensor measurements</p></section>';
    const level = Math.min(100, Math.max(0, Number(signal.state.level) || 0));
    return `<article class="panel static-reading instrument-prop-surface" data-tone="${esc(signal.state.tone)}"><p class="eyebrow">STATIC${signal.zoneLabel ? ` · ${esc(signal.zoneLabel)}` : ''}</p><p class="static-fiction-label">Fictional event reading</p><h2 id="static-reading-title" tabindex="-1">${esc(signal.title)}</h2>${stale || !connected() ? '<p class="instrument-prop-status" role="alert">Connection lost or reading unconfirmed. This is the last displayed reading; reconnect and refresh before collecting.</p>' : ''}<section class="static-gauge" aria-label="Fictional signal intensity"><strong>${level}<span> / 100</span></strong><meter min="0" max="100" value="${level}" aria-label="Fictional signal intensity">${level} out of 100</meter><p>${esc(({ calm: 'Calm', alert: 'Alert', critical: 'Critical' })[signal.state.tone] || 'Prepared state')} · ${esc(signal.state.label)}</p></section><p class="instrument-copy static-copy">${esc(signal.state.text)}</p><p class="hint">${esc(({ prepared: 'Prepared event state', conditions: 'Event story state', organizer: 'Organizer selected state' })[signal.source] || 'Prepared event state')} · Confirmed ${esc(date(signal.serverTime))}</p>${signal.blockedReason ? `<p class="static-notice" role="status">${esc(signal.blockedReason)}</p>` : ''}${pendingView()}${effects.active && feedback ? `<p role="${feedbackError ? 'alert' : 'status'}">${esc(feedback)}</p>` : ''}<div class="actions mt"><button type="button" class="primary" data-action="static-collect" ${disabled(Boolean(pending) || stale || !connected() || !signal.canCollect || isCollected())}>${isCollected() ? 'Collected in journal' : 'Collect in journal'}</button><button type="button" data-action="static-refresh" ${disabled(Boolean(pending) || !connected())}>Refresh reading</button></div>${propControls()}</article>`;
  }
  function catalogView() {
    return `<aside class="panel static-list"><div class="panel-head"><h2>Props & zones</h2><button type="button" class="primary" data-action="static-scan" ${disabled(Boolean(pending) || !connected() || !characterId)}>Identify a signal</button></div><div class="static-cards">${(dashboard.signals || []).map(row => `<article class="static-card"><h3>${esc(row.title)}</h3>${row.zoneLabel ? `<p class="hint">${esc(row.zoneLabel)}</p>` : ''}<p>${esc(row.summary || '')}</p><p class="hint">${esc(row.blockedReason || (row.available ? 'Find the printed code at this prop or zone.' : 'Not available to this character yet.'))}</p></article>`).join('') || '<p class="hint">No signals have been published for this event yet.</p>'}</div><details class="mt" data-static-disclosure="collected"><summary>Collected readings · ${dashboard.readings?.length || 0}</summary><ul class="static-receipts">${(dashboard.readings || []).map(row => `<li><strong>${esc(row.title || 'Fictional reading')}</strong><span class="hint">${esc(date(row.createdAt || row.created_at || row.at))}</span></li>`).join('') || '<li class="hint">Your confirmed readings will appear here.</li>'}</ul>${ctx.openJournal ? '<button type="button" class="mt" data-action="static-journal">Open journal</button>' : ''}</details></aside>`;
  }
  function options(rows, value, placeholder = null) {
    const choices = [...rows]; if (value && !choices.some(row => row.id === value)) choices.push({ id: value, name: 'Unavailable choice · select another' });
    return `${placeholder !== null ? `<option value="">${esc(placeholder)}</option>` : ''}${choices.map(row => `<option value="${esc(row.id)}" ${row.id === value ? 'selected' : ''}>${esc(row.name || row.label || row.title)}</option>`).join('')}`;
  }
  function conditionChoices(prefix, value) {
    const context = dashboard.context || {};
    return `<div class="static-condition-groups">${[['completed', 'Discoveries completed', context.nodes || []], ['flags', 'Story flags set', context.flags || []], ['skills', 'Character expertise', context.skills || []], ['statuses', 'Event status', ['draft', 'rehearsal', 'live', 'paused', 'ended', 'archived'].map(id => ({ id, name: id[0].toUpperCase() + id.slice(1) }))]].map(([field, label, available]) => {
      const selected = value[field] || [], rows = [...available]; for (const id of selected) if (!rows.some(row => row.id === id)) rows.push({ id, name: 'Unavailable choice · remove before saving' });
      return `<details><summary>${label}${selected.length ? ` · ${selected.length} selected` : ''}</summary>${rows.length ? `<div class="static-checklist">${rows.map(row => `<label class="check-line"><input type="checkbox" name="${esc(prefix)}-${field}" value="${esc(row.id)}" ${selected.includes(row.id) ? 'checked' : ''}><span>${esc(row.name || row.title || row.label || row.id)}</span></label>`).join('')}</div>` : '<p class="hint">No choices are configured yet.</p>'}</details>`;
    }).join('')}</div>`;
  }
  function conditionSummary(value) {
    const context = dashboard.context || {}, groups = [['completed', 'Discoveries', context.nodes || []], ['flags', 'Story flags', context.flags || []], ['skills', 'Expertise', context.skills || []], ['statuses', 'Event status', []]];
    const parts = groups.filter(([field]) => value[field]?.length).map(([field, label, choices]) => `${label}: ${value[field].map(id => { const row = choices.find(item => item.id === id); return row?.name || row?.title || (field === 'statuses' ? id : 'Unavailable reference'); }).join(', ')}`);
    return esc(parts.join(' · ') || 'No additional requirements.');
  }
  function documentReview(doc) {
    return `<details><summary>Review latest saved configuration</summary><p><strong>Zone:</strong> ${esc(doc.zoneLabel || 'None')}</p><p class="static-copy">${esc(doc.summary)}</p><p><strong>Access:</strong> ${conditionSummary(doc.conditions)}</p>${doc.states.map(row => `<article class="static-card"><h4>${esc(row.label)} · ${row.level}/100 · ${esc(row.tone)}${row.id === doc.defaultStateId ? ' · Default' : ''}</h4><p class="static-copy">${esc(row.text)}</p></article>`).join('')}<h4 class="mt">Rules in order</h4>${doc.rules.length ? `<ol>${doc.rules.map(row => `<li>${conditionSummary(row.conditions)} → ${esc(doc.states.find(item => item.id === row.stateId)?.label || 'Unavailable state')}</li>`).join('')}</ol>` : '<p>No story rules.</p>'}${doc.organizerNotes ? `<h4 class="mt">Private organizer notes</h4><p class="static-copy">${esc(doc.organizerNotes)}</p>` : ''}</details>`;
  }
  function editorView() {
    const doc = editor.document;
    return `<section class="panel static-editor"><div class="panel-head"><h2>${editor.id ? 'Edit signal draft' : 'Create a signal'}</h2><span id="static-save-state" class="save-status" role="status">${pending ? 'Awaiting confirmation' : dirtyDraft() ? 'Unsaved changes · held in this tab' : editor.id ? 'Saved draft' : 'New signal · held in this tab'}</span></div><p class="hint">Save a draft, then publish when it is ready. Players see only the current published reading that their character is allowed to access.</p>${editor.conflict ? `<section class="static-notice" role="alert"><h3>The saved signal changed.</h3><p>Your draft is retained. Review the latest saved version before continuing.</p>${editor.latest ? `<p><strong>${esc(editor.latest.document.title)}</strong> · Revision ${editor.latest.version}</p>${documentReview(editor.latest.document)}<div class="actions mt"><button type="button" data-action="static-use-latest">Use latest saved draft</button><button type="button" data-action="static-keep-draft">Keep my draft for this revision</button></div>` : '<button type="button" data-action="static-refresh">Load latest draft</button>'}</section>` : ''}<form id="static-editor-form" data-editor-key="${esc(editor.key)}"><fieldset class="static-fields" ${disabled(!canWrite())}><legend>Signal configuration</legend><label>Title<input name="title" value="${esc(doc.title)}" maxlength="120" required></label><label>Zone or prop label<input name="zoneLabel" value="${esc(doc.zoneLabel)}" maxlength="100"></label><label>Catalog summary<textarea name="summary" rows="3" maxlength="2000">${esc(doc.summary)}</textarea></label><details><summary>Access requirements</summary><p class="hint">A character needs all selected discoveries, flags, and expertise. If event statuses are selected, the event must match one of them. No selections means every eligible event character.</p>${conditionChoices('base', doc.conditions)}</details><section><h3>Prepared reading states · ${doc.states.length} of 12</h3><p class="hint">The level is an invented value from 0 to 100. Include all information players need in the state text; color and sound are optional presentation.</p><div class="static-editor-rows">${doc.states.map((row, index) => `<fieldset data-static-state="${esc(row.id)}"><legend>State ${index + 1}</legend><label>Label<input data-state-field="label" value="${esc(row.label)}" maxlength="80" required></label><label>Reading text<textarea data-state-field="text" rows="4" maxlength="3000" required>${esc(row.text)}</textarea></label><div class="static-two-fields"><label>Fictional level<input data-state-field="level" type="number" min="0" max="100" step="1" value="${Number(row.level)}" required></label><label>Visual tone<select data-state-field="tone">${['calm', 'alert', 'critical'].map(tone => `<option value="${tone}" ${row.tone === tone ? 'selected' : ''}>${tone[0].toUpperCase() + tone.slice(1)}</option>`).join('')}</select></label></div><button type="button" class="quiet mt" data-action="static-remove-state" data-id="${esc(row.id)}" ${disabled(doc.states.length <= 1 || doc.defaultStateId === row.id || doc.rules.some(rule => rule.stateId === row.id))}>Remove state ${index + 1}</button>${doc.defaultStateId === row.id || doc.rules.some(rule => rule.stateId === row.id) ? '<p class="hint">Change its default or rule references before removing this state.</p>' : ''}</fieldset>`).join('')}</div><button type="button" class="mt" data-action="static-add-state" ${disabled(doc.states.length >= 12)}>Add reading state</button></section><label>Default reading<select name="defaultStateId" required>${options(doc.states, doc.defaultStateId)}</select></label><section><h3>Story driven readings · ${doc.rules.length} of 12</h3><p class="hint">Rules run from top to bottom. The first rule whose requirements are all met selects a reading; otherwise the default is used. A staff selection takes precedence until cleared.</p><div class="static-editor-rows">${doc.rules.map((row, index) => `<fieldset data-static-rule="${esc(row.id)}"><legend>Rule ${index + 1}</legend><label>Show this state<select data-rule-state required>${options(doc.states, row.stateId)}</select></label>${conditionChoices(`rule-${row.id}`, row.conditions)}<div class="actions mt"><button type="button" class="quiet" data-action="static-rule-up" data-index="${index}" ${disabled(index === 0)}>Move earlier</button><button type="button" class="quiet" data-action="static-rule-down" data-index="${index}" ${disabled(index === doc.rules.length - 1)}>Move later</button><button type="button" class="quiet" data-action="static-remove-rule" data-index="${index}">Remove rule</button></div></fieldset>`).join('')}</div><button type="button" class="mt" data-action="static-add-rule" ${disabled(doc.rules.length >= 12)}>Add story rule</button></section><details><summary>Private organizer notes</summary><label>Preparation and running notes<textarea name="organizerNotes" rows="5" maxlength="6000">${esc(doc.organizerNotes)}</textarea></label></details></fieldset><div class="actions mt"><button type="submit" class="primary" ${disabled(!canWrite() || editor.conflict)}>Save draft</button><button type="button" class="quiet" data-action="static-close-editor" ${disabled(Boolean(pending?.sending))}>Close editor</button></div></form></section>`;
  }
  function decisionView() {
    const entry = dashboard.entries?.find(row => row.id === decision.entryId), states = entry?.published?.states || entry?.document?.states || [];
    return `<section class="panel static-control"><h2>Set event reading · ${esc(entry?.published?.title || entry?.document?.title || 'Signal')}</h2><p class="hint">Choose a prepared state, or restore the story rules. Character access requirements still apply. This changes future reads; collected journal copies remain unchanged.</p>${decision.stale ? '<p class="static-notice" role="alert">The published signal or staff selection changed. Close this form and review the latest entry before making a new selection. Your reason remains here for review.</p>' : ''}<form id="static-state-form"><fieldset class="static-fields" ${disabled(!canOperate() || decision.stale)}><legend>Staff control</legend><label>Reading state<select name="stateId">${options(states, decision.stateId, 'Use default and story rules')}</select></label><label>Reason for this change<textarea name="reason" maxlength="2000" rows="4" required>${esc(decision.reason)}</textarea></label><p class="hint">The reason stays in the staff history. Player readings use only the published state text.</p></fieldset><div class="actions mt"><button type="submit" class="primary" ${disabled(!canOperate() || decision.stale)}>Confirm state change</button><button type="button" class="quiet" data-action="static-close-decision" ${disabled(Boolean(pending?.sending))}>Close control</button></div></form></section>`;
  }
  function managerView() {
    return `<div class="static-layout"><aside class="panel static-list"><div class="panel-head"><h2>Event signals</h2>${dashboard.canManage ? `<button type="button" class="primary" data-action="static-new" ${disabled(!canWrite())}>Create signal</button>` : ''}</div><p class="hint">${dashboard.canManage ? 'Draft edits do not change player readings until you publish.' : 'Staff can select published reading states during live play or rehearsal.'}</p><div class="static-cards">${(dashboard.entries || []).map(row => {
      const published = row.published, doc = row.document || published, title = doc?.title || 'Untitled signal';
      return `<article class="static-card"><h3>${esc(title)}</h3><p class="hint">${esc(row.status || 'draft')}${row.publishedVersion ? ` · Published revision ${row.publishedVersion}` : ''} · Draft revision ${row.version}</p>${published?.zoneLabel ? `<p>${esc(published.zoneLabel)}</p>` : ''}${row.override?.stateId ? `<p class="static-notice">Staff selection: ${esc(published?.states?.find(item => item.id === row.override.stateId)?.label || 'Unavailable state')}</p>` : '<p class="hint">Using default and story rules.</p>'}<div class="actions mt">${dashboard.canManage ? `<button type="button" data-action="static-edit" data-id="${esc(row.id)}" ${disabled(!canWrite())}>Edit draft</button><button type="button" data-action="static-publish" data-id="${esc(row.id)}" ${disabled(!canWrite())}>Publish draft</button>${row.published && row.status !== 'withdrawn' ? `<button type="button" class="quiet" data-action="static-withdraw" data-id="${esc(row.id)}" ${disabled(!canWrite())}>Withdraw</button>` : ''}` : ''}${published && row.published && row.status !== 'withdrawn' ? `<button type="button" data-action="static-control" data-id="${esc(row.id)}" ${disabled(!canOperate())}>Set reading</button>` : ''}${row.code ? `<button type="button" class="quiet" data-action="static-label" data-id="${esc(row.id)}" ${disabled(Boolean(pending))}>Prop label</button>` : ''}</div>${row.override?.reason ? `<details class="mt"><summary>Last staff reason</summary><p class="static-copy">${esc(row.override.reason)}</p></details>` : ''}</article>`;
    }).join('') || '<p class="hint">No signals have been prepared yet.</p>'}</div></aside>${editor ? editorView() : decision ? decisionView() : '<section class="panel static-empty"><p class="eyebrow">STATIC · Event preparation</p><h2>Make the world respond.</h2><p>Prepare reading states, connect them to story discoveries or flags, and place a printed code at the prop or zone. Staff can choose a prepared state as the event unfolds.</p><p class="static-fiction-label">All readings are fictional event content.</p></section>'}</div>`;
  }
  function render() {
    ensureAccount(); if (state.view !== 'static') return;
    if (!dashboard || dashboard.event.id !== state.event?.id) { shell(`<section class="static-workspace"><button type="button" class="quiet" data-action="static-event">← Event briefing</button><h1 class="mt">STATIC</h1><p role="${feedbackError ? 'alert' : 'status'}">${esc(feedback || (loading ? 'Loading event readings…' : 'Open the event to load STATIC.'))}</p>${feedback ? '<button type="button" class="mt" data-action="static-refresh">Try again</button>' : ''}</section>`); return; }
    const disclosures = new Map([...document.querySelectorAll('[data-static-disclosure]')].map(element => [element.dataset.staticDisclosure, element.open]));
    shell(`<section class="static-workspace"><div class="actions"><button type="button" class="quiet" data-action="static-event">← Event briefing</button>${dashboard.canOperate || dashboard.canManage ? `<button type="button" class="quiet" data-action="${manage ? 'static-open' : 'static-manage'}">${manage ? 'Read as my character' : 'Prepare & control signals'}</button>` : ''}</div><header class="page-head mt"><div><p class="eyebrow">${esc(dashboard.event.name)} · STATIC${manage ? ' · Staff tools' : ''}</p><h1>Signals from your world</h1><p class="muted">Fictional readings from props, zones, and the unfolding story.</p></div><button type="button" data-action="static-refresh" ${disabled(Boolean(pending) || !connected())}>Refresh</button></header>${signal && !manage ? '' : pendingView()}${feedback && !effects.active ? `<p class="static-feedback ${feedbackError ? 'error' : ''}" role="${feedbackError ? 'alert' : 'status'}">${esc(feedback)}</p>` : ''}${!connected() ? '<p class="static-notice" role="alert">Offline. Current readings and staff controls need a connection; drafts stay in this tab.</p>' : ''}${manage ? managerView() : `${characterPicker()}${dashboard.readOnly ? '<p class="static-notice">Collecting readings requires STATIC to be enabled during live play or rehearsal.</p>' : ''}${dashboard.character ? `<div class="static-layout">${catalogView()}${signalView()}</div>` : ''}`}</section>`);
    for (const element of document.querySelectorAll('[data-static-disclosure]')) if (disclosures.has(element.dataset.staticDisclosure)) element.open = disclosures.get(element.dataset.staticDisclosure);
  }
  async function mutate(path, method, body, kind, retry = false) {
    ensureAccount(); capture(); if (!connected()) { toast('Reconnect before recording this action.'); return; }
    if (pending && !retry) { toast('Retry the pending action before starting another.'); return; }
    const request = retry ? pending : { path, method, body: { ...clone(body), requestId: crypto.randomUUID() }, kind, sending: false };
    if (!request || request.sending) return;
    epoch++; const context = scope(); pending = request; request.sending = true; feedback = ''; feedbackError = false; render();
    try {
      const result = await api(request.path, request.method, request.body); if (!current(context)) return;
      pending = null; editor = null; decision = null;
      if (Object.hasOwn(result, 'signal')) { signal = result.signal; stale = false; if (!signal) { signalCode = null; effects.exit(); } }
      const confirmed = ({ collect: 'Fictional reading collected in your journal.', create: 'Signal draft saved. Publish it when ready.', edit: 'Signal draft saved. Publish to update player readings.', publish: 'Signal published. Players see the current applicable reading.', withdraw: 'Signal withdrawn from player access.', state: 'Event reading selection confirmed.' })[request.kind] || 'Signal updated.';
      feedback = confirmed; feedbackError = false; if (request.kind === 'collect') effects.cue('reading');
      try { const latest = await fetchDashboard(context); if (!current(context)) return; applyDashboard(latest); }
      catch (error) { if (!current(context)) return; if ([401, 403, 404].includes(error.status)) readError(error); else { feedback = `${confirmed} Refresh to load the latest list.`; feedbackError = true; } }
      if (current(context)) { render(); toast(confirmed); }
    } catch (error) {
      if (!current(context)) return; request.sending = false;
      if (error.status >= 400 && error.status < 500) pending = null;
      if (!pending && [401, 403, 404].includes(error.status)) readError(error);
      else {
        feedback = pending ? 'The response was interrupted. Retry the pending action to recover its result.' : `${error.message || 'The action could not be confirmed.'}${editor ? ' Your draft is retained.' : ''}`; feedbackError = true;
        if (error.status === 409) { if (editor?.id) { editor.conflict = true; editor.latest = null; } if (decision) decision.stale = true; if (request.kind === 'collect') { stale = true; feedback += ' Refresh the reading, then review it before collecting again.'; } }
      }
      render();
    }
  }
  function confirmDiscard(destination) {
    capture();
    if (destination === 'modal') {
      if (scanDirty && !window.confirm('Discard the unsubmitted signal code?')) return false;
      scanDirty = false; return true;
    }
    if (pending?.sending) { toast('Wait for the STATIC action to finish.'); return false; }
    if (pending && !window.confirm('This action may already be recorded. Leave and discard its retry information and any unsaved changes?')) return false;
    if (!pending && (dirtyDraft() || dirtyDecision() || scanDirty) && !window.confirm('Discard your unsaved signal changes?')) return false;
    editor = null; decision = null; pending = null; cleanupModal(); effects.exit(); return true;
  }
  function stopCamera() {
    scannerController?.abort(); scannerController = null; scannerStop?.(); scannerStop = null;
    const video = document.querySelector('#static-scanner-video'); if (video) video.hidden = true;
    const start = document.querySelector('[data-action="static-camera"]'), stop = document.querySelector('[data-action="static-camera-stop"]'); if (start) start.hidden = false; if (stop) stop.hidden = true;
  }
  function cleanupModal() { modalEpoch++; stopCamera(); scanBusy = false; scanDirty = false; labelLink = null; document.body.classList.remove('instrument-printing'); }
  function scanStatus(message) { const label = document.querySelector('#static-scanner-status'); if (label) label.textContent = message; else toast(message); }
  function scanModal() {
    cleanupModal();
    openModal('Identify a STATIC prop or zone', `<p class="hint">Scan its QR code, choose a photo, or enter the printed code. The image is read locally. Character access is checked before a fictional reading is revealed.</p><div class="static-scanner"><video id="static-scanner-video" muted playsinline hidden></video><p id="static-scanner-status" class="hint" role="status">The camera stays off until you choose Start camera.</p><div class="actions"><button type="button" data-action="static-camera">Start camera</button><button type="button" data-action="static-camera-stop" hidden>Stop camera</button></div><label>Read a QR image<input id="static-scan-file" type="file" accept="image/png,image/jpeg,image/webp"></label><form id="static-scan-form"><p class="error" role="alert"></p><label>STATIC code or ORACLE link<input name="code" required maxlength="1024" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"></label><button type="submit" class="primary">Read signal</button></form></div>`);
  }
  async function lookupInput(value, expectedModal = null) {
    ensureAccount(); if (!connected()) throw new Error('Reconnect before identifying a signal.');
    const parsed = parseInstrumentInput(value, location.origin, 'static', state.event?.id || null);
    if (!parsed.eventId) throw new Error('Open an event before entering a printed code.');
    if (expectedModal !== null && expectedModal !== modalEpoch) return;
    if (state.event?.id !== parsed.eventId) {
      if (!confirmDiscard()) return;
      const who = state.session?.user?.id; await loadEvent(parsed.eventId); if (state.session?.user?.id !== who || state.event?.id !== parsed.eventId) return;
      await open(); expectedModal = null;
    } else if (state.view !== 'static' || manage || !dashboard) { await open(); expectedModal = null; }
    if (!dashboard?.character) throw new Error('Choose an approved character assigned to you, then identify this signal again.');
    const context = scope();
    const result = await api(`${base()}/lookup`, 'POST', { characterId, code: parsed.code });
    if (!current(context) || expectedModal !== null && expectedModal !== modalEpoch) return;
    signal = result.signal; signalCode = parsed.code; stale = false; feedback = ''; feedbackError = false; scanDirty = false; closeModal(true); render(); effects.cue('reading'); document.querySelector('#static-reading-title')?.focus();
  }
  async function camera() {
    if (scannerController || scanBusy) return;
    const expected = modalEpoch, video = document.querySelector('#static-scanner-video'); if (!video) return;
    const controller = new AbortController(); scannerController = controller; video.hidden = false; scanStatus('Requesting camera access…');
    const start = document.querySelector('[data-action="static-camera"]'), stop = document.querySelector('[data-action="static-camera-stop"]'); start.hidden = true; stop.hidden = false;
    const finish = await startScanner(video, value => {
      if (expected !== modalEpoch) return; stopCamera(); if (scanBusy) return; scanBusy = true; scanStatus('Checking this character’s access…');
      void lookupInput(value, expected).catch(error => { if (expected === modalEpoch) scanStatus(error.message); }).finally(() => { if (expected === modalEpoch) scanBusy = false; });
    }, error => { if (expected === modalEpoch) { stopCamera(); scanStatus(error.message); } }, { signal: controller.signal });
    if (expected !== modalEpoch || controller.signal.aborted) { finish(); return; }
    scannerStop = finish; scanStatus('Point the camera at the STATIC QR code.');
  }
  function showLabel(row) {
    cleanupModal(); const doc = row.published || row.document, link = `${location.origin}/#static/${eventId}/${row.code}`;
    openModal('STATIC prop label', `<p class="hint">Place this label at the fictional prop or zone. Reading access still depends on event membership and character requirements.</p><article class="instrument-label"><p class="eyebrow">ORACLE · LARP Field Kit</p><p>${esc(dashboard.event.name)}</p><h2>${esc(doc.title)}</h2>${doc.zoneLabel ? `<p>${esc(doc.zoneLabel)}</p>` : ''}<p class="static-fiction-label">Fictional event reading</p><div id="static-label-qr" class="instrument-qr" aria-label="QR code for this fictional prop reading"></div><p class="instrument-label-code">${esc(row.code.match(/.{1,4}/g).join('-'))}</p><p>STATIC · Scan in ORACLE</p></article><div class="actions mt"><button type="button" class="primary" data-action="static-print">Print label</button><button type="button" data-action="static-copy-link">Copy link</button><button type="button" data-action="close">Done</button></div>`);
    labelLink = link; renderBadgeQR(document.querySelector('#static-label-qr'), link, 256);
  }
  async function action(button) {
    const name = button.dataset.action; if (!name?.startsWith('static-')) return false;
    ensureAccount(); capture();
    if (name === 'static-open' || name === 'static-manage') await open({ manage: name === 'static-manage', characterId: button.dataset.characterId });
    else if (name === 'static-event') { if (confirmDiscard()) { epoch++; await loadEvent(state.event.id); } }
    else if (name === 'static-refresh') await refresh();
    else if (name === 'static-retry') await mutate(null, null, null, null, true);
    else if (name === 'static-new') { if (canWrite() && confirmDiscard()) { beginEditor(); render(); document.querySelector('#static-editor-form input')?.focus(); } }
    else if (name === 'static-edit') { const row = dashboard?.entries?.find(item => item.id === button.dataset.id); if (row && canWrite() && confirmDiscard()) { beginEditor(row); render(); } }
    else if (name === 'static-close-editor' || name === 'static-close-decision') { if (confirmDiscard()) render(); }
    else if (name === 'static-add-state') { if (editor && canWrite() && editor.document.states.length < 12) { editor.document.states.push({ id: slug('state'), label: '', text: '', level: 50, tone: 'alert' }); render(); } }
    else if (name === 'static-remove-state') { if (editor && canWrite() && editor.document.states.length > 1 && editor.document.defaultStateId !== button.dataset.id && !editor.document.rules.some(row => row.stateId === button.dataset.id)) { editor.document.states = editor.document.states.filter(row => row.id !== button.dataset.id); render(); } }
    else if (name === 'static-add-rule') { if (editor && canWrite() && editor.document.rules.length < 12) { editor.document.rules.push({ id: slug('rule'), conditions: emptyConditions(), stateId: editor.document.defaultStateId }); render(); } }
    else if (['static-remove-rule', 'static-rule-up', 'static-rule-down'].includes(name)) {
      if (editor && canWrite()) { const index = Number(button.dataset.index), rows = editor.document.rules; if (Number.isInteger(index) && index >= 0 && index < rows.length) { if (name === 'static-remove-rule') rows.splice(index, 1); else { const next = index + (name === 'static-rule-up' ? -1 : 1); if (next >= 0 && next < rows.length) [rows[index], rows[next]] = [rows[next], rows[index]]; } render(); } }
    } else if (name === 'static-use-latest') { if (editor?.latest && canWrite()) { beginEditor(editor.latest); render(); } }
    else if (name === 'static-keep-draft') { if (editor?.latest && canWrite()) { editor.version = editor.latest.version; editor.baseline = canonical(editor.latest.document); editor.conflict = false; editor.latest = null; feedback = 'Your draft now targets the reviewed revision. Save it when ready.'; feedbackError = false; render(); } }
    else if (name === 'static-publish' || name === 'static-withdraw') {
      const row = dashboard?.entries?.find(item => item.id === button.dataset.id), verb = name.slice(7);
      if (row && canWrite() && confirmDiscard() && window.confirm(verb === 'publish' ? `Publish the saved draft of “${row.document.title}” for future player readings?` : `Withdraw “${row.document.title}” from player access? Collected journal readings remain.`)) await mutate(`${base()}/entries/${row.id}/${verb}`, 'POST', { version: row.version }, verb);
    } else if (name === 'static-control') {
      const row = dashboard?.entries?.find(item => item.id === button.dataset.id);
      if (row?.published && canOperate() && confirmDiscard()) { decision = { entryId: row.id, version: row.override?.version || 0, publicationVersion: row.publishedVersion, stateId: row.override?.stateId || '', originalStateId: row.override?.stateId || '', reason: '', stale: false }; feedback = ''; feedbackError = false; render(); }
    } else if (name === 'static-label') { const row = dashboard?.entries?.find(item => item.id === button.dataset.id); if (row?.code && !pending) showLabel(row); }
    else if (name === 'static-print') { if (labelLink) { document.body.classList.add('instrument-printing'); window.print(); } }
    else if (name === 'static-copy-link') { if (labelLink) { try { await navigator.clipboard.writeText(labelLink); toast('Prop link copied.'); } catch { toast('Link copying is unavailable. Use the printed code or QR label.'); } } }
    else if (name === 'static-scan') { if (connected() && !pending && characterId) scanModal(); }
    else if (name === 'static-camera') void camera().catch(error => scanStatus(error.message));
    else if (name === 'static-camera-stop') { modalEpoch++; stopCamera(); scanBusy = false; scanStatus('Camera stopped. Enter a code or choose a QR image.'); }
    else if (name === 'static-collect') { if (!manage && signal?.canCollect && !isCollected() && characterId && signalCode && !stale && !pending && connected()) await mutate(`${base()}/collect`, 'POST', { characterId, entryId: signal.id, code: signalCode, publicationVersion: signal.publicationVersion, readingKey: signal.readingKey }, 'collect'); }
    else if (name === 'static-prop') { if (!manage && signal && !stale && connected()) { effects.enter('static'); render(); document.querySelector('[data-action="static-prop-exit"]')?.focus(); } }
    else if (name === 'static-prop-exit') { effects.exit(); render(); document.querySelector('[data-action="static-prop"]')?.focus(); }
    else if (name === 'static-fullscreen') { if (!await effects.fullscreen()) toast('Full screen is unavailable here. Prop mode is still active.'); }
    else if (name === 'static-sound') { const enabled = await effects.toggleSound(); if (state.view === 'static') { render(); if (!enabled) toast('Sound is off. Every signal remains visible as text.'); } }
    else if (name === 'static-journal') { if (ctx.openJournal && characterId && confirmDiscard()) { const chosen = characterId; reset(); await ctx.openJournal(chosen); } }
    else return false;
    return true;
  }
  async function submit(form) {
    if (form.id === 'static-character-form') { await open({ characterId: String(new FormData(form).get('characterId') || '') }); return true; }
    if (form.id === 'static-scan-form') {
      if (scanBusy) { toast('Wait for the current signal lookup to finish.'); return true; }
      const expected = modalEpoch; stopCamera(); scanBusy = true;
      try { await lookupInput(String(new FormData(form).get('code') || ''), expected); }
      catch (error) { if (expected === modalEpoch) { const label = form.querySelector('.error'); if (label) label.textContent = error.message; } }
      finally { if (expected === modalEpoch) scanBusy = false; }
      return true;
    }
    if (!['static-editor-form', 'static-state-form'].includes(form.id)) return false;
    capture(); if (!form.reportValidity()) return true;
    if (form.id === 'static-editor-form') {
      if (!editor || !canWrite() || editor.conflict) return true;
      await mutate(`${base()}/entries${editor.id ? `/${editor.id}` : ''}`, editor.id ? 'PUT' : 'POST', { document: clone(editor.document), ...(editor.id ? { version: editor.version } : {}) }, editor.id ? 'edit' : 'create');
    } else if (decision && !decision.stale && canOperate()) await mutate(`${base()}/entries/${decision.entryId}/state`, 'POST', { version: decision.version, stateId: decision.stateId || null, reason: decision.reason }, 'state');
    return true;
  }
  async function handleHash() {
    if (!location.hash.startsWith('#static/') || !state.session?.user) return false;
    if (!confirmDiscard()) { history.replaceState(null, '', `${location.pathname}${location.search}`); return true; }
    try { await lookupInput(`${location.origin}/${location.hash}`); } catch (error) { toast(error.message || 'This fictional signal could not be opened.'); }
    if (state.session?.user) history.replaceState(null, '', `${location.pathname}${location.search}`); return true;
  }
  function changed(event) {
    if (state.view !== 'static') return;
    if (event.target.closest('#static-scan-form')) scanDirty = true;
    if (!event.target.closest('#static-editor-form, #static-state-form')) return;
    capture(); const label = document.querySelector('#static-save-state'); if (label) label.textContent = dirtyDraft() ? 'Unsaved changes · held in this tab' : editor?.id ? 'Saved draft' : 'New signal · held in this tab';
    // Update dependent choices in place so a blur never removes the next clicked button.
    if (editor && (event.target.name === 'defaultStateId' || event.target.matches('[data-rule-state]') || event.target.dataset.stateField === 'label')) {
      for (const option of document.querySelectorAll('[name="defaultStateId"] option, [data-rule-state] option')) { const row = editor.document.states.find(item => item.id === option.value); if (row) option.textContent = row.label || 'Untitled state'; }
      for (const button of document.querySelectorAll('[data-action="static-remove-state"]')) button.disabled = !canWrite() || editor.document.states.length <= 1 || editor.document.defaultStateId === button.dataset.id || editor.document.rules.some(row => row.stateId === button.dataset.id);
    }
  }
  document.addEventListener('input', changed);
  document.addEventListener('change', event => {
    changed(event); if (event.target.id !== 'static-scan-file' || state.view !== 'static') return;
    const file = event.target.files?.[0]; if (!file || scanBusy) return;
    const expected = modalEpoch; stopCamera(); scanBusy = true; scanStatus('Reading the QR image…');
    void scanImage(file).then(value => { if (expected === modalEpoch) return lookupInput(value, expected); }).catch(error => { if (expected === modalEpoch) scanStatus(error.message); }).finally(() => { if (expected === modalEpoch) scanBusy = false; });
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { modalEpoch++; stopCamera(); scanBusy = false; } else if (state.view === 'static' && effects.active) { const button = document.querySelector('[data-action="static-sound"]'); if (button) { button.textContent = 'Sound off'; button.setAttribute('aria-pressed', 'false'); } } });
  window.addEventListener('beforeunload', event => { capture(); if (dirtyDraft() || dirtyDecision() || pending || scanDirty) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('afterprint', () => document.body.classList.remove('instrument-printing'));
  window.addEventListener('offline', () => { if (state.view === 'static') { capture(); stale = true; stopCamera(); render(); } });
  window.addEventListener('online', () => { if (state.view === 'static') { capture(); feedback = 'Connection restored. Refresh to confirm the current reading before collecting.'; feedbackError = false; render(); } });
  return { open, render, action, submit, handleHash, confirmDiscard, isDirty: () => { capture(); return dirtyDraft() || dirtyDecision() || Boolean(pending) || scanDirty; }, reset, cleanupModal };
}
