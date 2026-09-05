import { defaultAdventure, defaultAdventureNode, validateAdventure, ADVENTURE_EVENT_STATUSES } from './adventure-model.js';
import { renderBadgeQR } from './qr.js';

const TYPES = { relic: 'Relic · examinations', dead_drop: 'Dead drop · messages', cipherbox: 'Cipherbox · puzzle', wayfinder: 'Wayfinder · scene' };
const STATUS_NAMES = Object.fromEntries(ADVENTURE_EVENT_STATUSES.map(status => [status, status[0].toUpperCase() + status.slice(1)]));
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const clone = value => structuredClone(value);
const newId = prefix => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const newCode = () => [...crypto.getRandomValues(new Uint8Array(20))].map(byte => ALPHABET[byte % 32]).join('');

export function createAdventureOrganizer(ctx) {
  const { state, api, shell, esc, openModal, closeModal, loadEvent, toast, err } = ctx;
  let record = null, draft = defaultAdventure(), saved = clone(draft), eventId = null;
  let dirty = false, nodeDraft = null, editingId = null, dialogDirty = false, audioBusy = false, modalEpoch = 0;
  let templates = [], progressCharacter = '';
  const base = () => `/api/events/${state.event.id}/adventure`;
  const field = (name, label, value = '', attrs = '') => `<label>${esc(label)}<input name="${esc(name)}" value="${esc(value)}" ${attrs}></label>`;
  const area = (name, label, value = '', max = 6000) => `<label>${esc(label)}<textarea name="${esc(name)}" maxlength="${max}">${esc(value)}</textarea></label>`;
  const checked = value => value ? 'checked' : '';
  const selected = value => value ? 'selected' : '';
  const disabled = value => value ? 'disabled' : '';
  const progressExists = () => Boolean(record?.hasProgress ?? record?.progress?.length);
  const editable = () => ['draft', 'rehearsal'].includes(state.event?.status) && !progressExists();
  const approvedCharacters = () => (record?.characters || []).filter(character => character.status === 'approved');
  const dateInput = value => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  const toDate = value => value ? new Date(value).toISOString() : null;
  const idList = (data, name) => data.getAll(name).map(String);
  const markDirty = () => { dirty = true; const target = document.querySelector('#advedit-save-state'); if (target) { target.textContent = 'Unsaved changes'; target.dataset.saving = 'false'; } const discard = document.querySelector('[data-action="advedit-discard"]'); if (discard) discard.disabled = false; };
  function captureMain() {
    const form = document.querySelector('#advedit-main-form');
    if (!form || !editable()) return;
    const data = new FormData(form);
    draft.title = String(data.get('title') || '').trim();
    draft.summary = String(data.get('summary') || '').trim();
    draft.organizerNotes = String(data.get('organizerNotes') || '').trim();
    draft.flags = draft.flags.map(flag => ({ ...flag, name: String(data.get(`flag-${flag.id}`) || '').trim() }));
  }
  function useRecord(result) {
    record = result; saved = clone(result.definition || defaultAdventure()); draft = clone(saved); dirty = false;
    if (!approvedCharacters().some(character => character.id === progressCharacter)) progressCharacter = approvedCharacters()[0]?.id || '';
  }
  async function open() {
    if (dirty && eventId === state.event?.id) { state.view = 'adventure-manage'; render(); return; }
    const result = await api(`${base()}/manage`);
    eventId = state.event.id; useRecord(result); state.view = 'adventure-manage'; render();
  }
  function characterOptions(value = progressCharacter) {
    return approvedCharacters().map(character => `<option value="${esc(character.id)}" ${selected(character.id === value)}>${esc(character.name)}${character.userId ? '' : ' · unassigned'}</option>`).join('');
  }
  function render() {
    if (!record || eventId !== state.event?.id) { shell('<p role="status">Loading adventure tools…</p>'); return; }
    const locked = !editable(), characters = approvedCharacters(), playable = ['live', 'rehearsal'].includes(state.event.status);
    shell(`<div class="actions"><button class="quiet" data-action="advedit-back">← Event briefing</button></div><header class="page-head mt"><div><p class="eyebrow">${esc(state.event.name)} · Organizer tools</p><h1>Build the adventure.</h1><p class="muted">Write discoveries, link their conditions, and prepare the props your players will find.</p></div><div class="actions"><button data-action="advedit-labels" ${disabled(!saved.nodes.length)}>Print prop labels</button><button data-action="advedit-rehearsal" ${disabled(!record.version)}>Make rehearsal copy</button></div></header>${record.isRehearsal ? '<p class="preview-banner">Dedicated rehearsal copy · progress here is separate from the original event.</p>' : ''}${locked ? `<p class="preview-banner">${progressExists() ? 'Play has begun. Adventure editing is locked to preserve player discoveries. Make a rehearsal copy to try changes.' : 'Adventure editing is available while the event is a draft or in rehearsal.'}</p>` : ''}<div class="advedit-layout"><section class="panel"><form id="advedit-main-form">${err}<div class="panel-head"><h2>Adventure overview</h2><span id="advedit-save-state" class="save-status" role="status">${dirty ? 'Unsaved changes' : record.version ? 'Saved to event' : 'New adventure · not saved'}</span></div><fieldset class="advedit-fields" ${disabled(locked)}><legend>Story and preparation</legend>${field('title', 'Adventure title', draft.title, 'required maxlength="120"')}${area('summary', 'Player introduction', draft.summary, 4000)}${area('organizerNotes', 'Organizer notes · private', draft.organizerNotes, 12000)}<p class="hint">Keep solutions and running instructions here. Players receive only the introduction and the discoveries they unlock.</p><details class="advedit-conditions"><summary>Story flags · ${draft.flags.length}</summary><p class="hint">Flags remember story outcomes. Add a named flag, set it when a discovery succeeds, then require it on a later instrument.</p>${draft.flags.map(flag => `<div class="advedit-flag-row">${field(`flag-${flag.id}`, 'Flag name', flag.name, 'required maxlength="80"')}<button type="button" class="quiet danger" data-action="advedit-flag-remove" data-id="${esc(flag.id)}">Remove</button></div>`).join('')}<button type="button" data-action="advedit-flag-add" ${disabled(draft.flags.length >= 30)}>+ Add story flag</button></details></fieldset><div class="actions mt"><button type="submit" class="primary" ${disabled(locked)}>Save adventure</button><button type="button" class="quiet" data-action="advedit-discard" ${disabled(!dirty)}>Discard changes</button></div></form></section><section class="panel"><div class="panel-head"><h2>Instruments</h2><span class="hint">${draft.nodes.length} / 50</span></div><p class="hint">Give each instrument a printed label. Players scan it using their approved character.</p><ol class="advedit-node-list">${draft.nodes.map((node, index) => `<li><div><span class="eyebrow">${index + 1} / ${esc(TYPES[node.type])}</span><h3>${esc(node.title || 'Untitled instrument')}</h3><p class="hint">${esc(node.summary || 'No introduction yet.')}</p><p class="hint">${node.conditions.completed.length + node.conditions.skills.length + node.conditions.flags.length + node.conditions.statuses.length} access conditions</p></div><div class="actions"><button data-action="advedit-node-edit" data-id="${esc(node.id)}">${locked ? 'View details' : 'Edit instrument'}</button>${!locked ? `<button class="quiet danger" data-action="advedit-node-remove" data-id="${esc(node.id)}">Remove</button>` : ''}</div></li>`).join('')}</ol>${!draft.nodes.length ? '<p class="hint mt">Add your first relic, message, puzzle, or scene.</p>' : ''}<div class="actions mt">${Object.entries(TYPES).map(([type, label]) => `<button data-action="advedit-node-add" data-type="${type}" ${disabled(locked || draft.nodes.length >= 50)}>+ ${esc(label.split(' · ')[0])}</button>`).join('')}</div></section></div><section class="panel mt"><div class="panel-head"><h2>Preview and progress</h2><span class="hint">${(record.progress || []).length} character records</span></div>${characters.length ? `<div class="advedit-preview"><label>Approved character<select id="advedit-character">${characterOptions()}</select></label><div class="actions"><button data-action="advedit-preview">Preview as this character</button><button data-action="advedit-refresh">Refresh progress</button></div></div><p class="hint">Preview is read-only. Use an explicit organizer override below to change a character’s progress.</p><details class="advedit-conditions"><summary>Organizer overrides</summary><p class="hint">Overrides require a live event or rehearsal and are recorded in the event activity log. Release a discovery, solve a puzzle, or clear a failed puzzle’s attempts.</p><div class="advedit-override-list">${saved.nodes.map(node => `<div><strong>${esc(node.title)}</strong><div class="actions"><button data-action="advedit-override" data-kind="release" data-id="${esc(node.id)}" ${disabled(!playable)}>Release discovery</button>${node.type === 'cipherbox' ? `<button data-action="advedit-override" data-kind="solve" data-id="${esc(node.id)}" ${disabled(!playable)}>Solve puzzle</button><button data-action="advedit-override" data-kind="reset_attempts" data-id="${esc(node.id)}" ${disabled(!playable)}>Reset failed attempts</button>` : ''}</div></div>`).join('')}</div></details>` : '<p class="hint">Assign and approve a character to preview its adventure. Approved unassigned characters can also be previewed.</p>'}<ul class="member-list">${(record.progress || []).map(progress => `<li><div><strong>${esc(progress.name)}</strong><p class="hint">${Number(progress.completed) || 0} completed · ${Number(progress.failed) || 0} failed · ${Number(progress.journalEntries) || 0} journal entries</p>${progress.flags?.length ? `<p class="hint">Flags: ${progress.flags.map(id => esc(saved.flags.find(flag => flag.id === id)?.name || id)).join(', ')}</p>` : ''}</div></li>`).join('')}</ul>${record.isRehearsal && state.event.status === 'rehearsal' ? '<div class="actions mt"><button class="quiet danger" data-action="advedit-reset">Reset rehearsal progress</button></div><p class="hint">Reset clears this rehearsal copy’s discoveries, attempts, journal entries, and scene attendance. The original event is preserved.</p>' : ''}</section>`);
  }
  function choices(name, values, options) {
    return options.length ? `<div class="advedit-checks">${options.map(option => `<label class="check-line"><input type="checkbox" name="${esc(name)}" value="${esc(option.id)}" ${checked(values.includes(option.id))}>${esc(option.name)}</label>`).join('')}</div>` : '<p class="hint">None defined yet.</p>';
  }
  function conditionFields(prefix, conditions) {
    return `<details class="advedit-conditions"><summary>Access conditions</summary><p class="hint">Require every selected discovery, skill, and flag. If event statuses are selected, any selected status qualifies.</p><fieldset><legend>Completed discoveries</legend>${choices(`${prefix}-completed`, conditions.completed, draft.nodes.filter(node => node.id !== nodeDraft.id).map(node => ({ id: node.id, name: node.title })))}</fieldset><fieldset><legend>Character skills</legend>${choices(`${prefix}-skills`, conditions.skills, state.event.setup.rules.expertise)}</fieldset><fieldset><legend>Story flags</legend>${choices(`${prefix}-flags`, conditions.flags, draft.flags)}</fieldset><fieldset><legend>Event status</legend>${choices(`${prefix}-statuses`, conditions.statuses, Object.entries(STATUS_NAMES).map(([id, name]) => ({ id, name })))}</fieldset></details>`;
  }
  function actionFields(prefix, actions) {
    return `<details class="advedit-conditions"><summary>Story outcomes</summary><p class="hint">Selected flags are set once when this discovery succeeds or its puzzle attempts are exhausted.</p><fieldset><legend>On success</legend>${choices(`${prefix}-success`, actions.success, draft.flags)}</fieldset><fieldset><legend>On failure</legend>${choices(`${prefix}-failure`, actions.failure, draft.flags)}</fieldset></details>`;
  }
  function conditionsFrom(data, prefix) {
    return Object.fromEntries(['completed', 'skills', 'flags', 'statuses'].map(key => [key, idList(data, `${prefix}-${key}`)]));
  }
  function captureNode() {
    const form = document.querySelector('#advedit-node-form');
    if (!form || !nodeDraft) return;
    const data = new FormData(form), node = nodeDraft;
    for (const key of ['title', 'summary']) node[key] = String(data.get(key) || '').trim();
    node.conditions = conditionsFrom(data, 'node');
    node.actions = { success: idList(data, 'node-success'), failure: idList(data, 'node-failure') };
    if (node.type === 'relic') node.examinations = node.examinations.map(exam => ({ id: exam.id, label: String(data.get(`exam-${exam.id}-label`) || '').trim(), text: String(data.get(`exam-${exam.id}-text`) || '').trim(), conditions: conditionsFrom(data, `exam-${exam.id}`), actions: idList(data, `exam-${exam.id}-actions`) }));
    if (node.type === 'dead_drop') { node.body = String(data.get('body') || '').trim(); node.releaseCode = String(data.get('releaseCode') || '').trim() || null; }
    if (node.type === 'cipherbox') {
      for (const key of ['prompt', 'answer', 'successText', 'failureText']) node[key] = String(data.get(key) || '').trim();
      node.match = String(data.get('match')); node.maxAttempts = Number(data.get('maxAttempts'));
      node.hints = node.hints.map((hint, index) => ({ text: String(data.get(`hint-${index}-text`) || '').trim(), afterAttempts: Number(data.get(`hint-${index}-attempts`)) }));
    }
    if (node.type === 'wayfinder') {
      for (const key of ['body', 'location', 'playStyle', 'availability']) node[key] = String(data.get(key) || '').trim();
      for (const key of ['durationMinutes', 'minPlayers', 'maxPlayers']) node[key] = Number(data.get(key));
      node.startsAt = toDate(data.get('startsAt')); node.endsAt = toDate(data.get('endsAt'));
    }
  }
  function showNode() {
    const node = nodeDraft, locked = !editable();
    let content = '';
    if (node.type === 'relic') content = `<section><div class="panel-head"><h3>Examinations</h3><button type="button" data-action="advedit-exam-add" ${disabled(node.examinations.length >= 8)}>+ Add examination</button></div><p class="hint">Players choose how to examine this prop. Each permitted reading is recorded in their journal once.</p>${node.examinations.map(exam => `<details class="advedit-examination" open><summary>${esc(exam.label || 'New examination')}</summary>${field(`exam-${exam.id}-label`, 'Examination choice', exam.label, 'required maxlength="120"')}${area(`exam-${exam.id}-text`, 'What the character discovers', exam.text, 6000)}${conditionFields(`exam-${exam.id}`, exam.conditions)}<details class="advedit-conditions"><summary>Flags set by this examination</summary>${choices(`exam-${exam.id}-actions`, exam.actions, draft.flags)}</details><button type="button" class="quiet danger" data-action="advedit-exam-remove" data-id="${esc(exam.id)}" ${disabled(node.examinations.length <= 1)}>Remove examination</button></details>`).join('')}</section>`;
    if (node.type === 'dead_drop') content = `${area('body', 'Message or transcript · revealed after opening', node.body, 12000)}${field('releaseCode', 'Optional release phrase · keep private', node.releaseCode || '', 'maxlength="80" autocomplete="off"')}<section class="advedit-audio"><label>Optional recording<input id="advedit-audio-file" type="file" accept=".mp3,.ogg,.wav,audio/mpeg,audio/ogg,audio/wav"></label><p class="hint">Choose a small MP3, Ogg, or WAV file. Recordings are stored with the adventure; no external audio links are used. Keep the transcript in the message above.</p>${node.audio ? `<audio controls preload="none" src="${esc(node.audio)}"></audio><button type="button" class="quiet danger" data-action="advedit-audio-remove">Remove recording</button>` : '<p class="hint">No recording attached.</p>'}<p id="advedit-audio-status" class="hint" role="status">${audioBusy ? 'Reading recording…' : ''}</p></section>`;
    if (node.type === 'cipherbox') content = `${area('prompt', 'Puzzle presented to the player', node.prompt, 6000)}<div class="two-fields">${field('answer', 'Correct answer · organizer only', node.answer, 'required maxlength="80" autocomplete="off"')}<label>Answer matching<select name="match"><option value="fold" ${selected(node.match === 'fold')}>Ignore letter case and surrounding spaces</option><option value="exact" ${selected(node.match === 'exact')}>Exact match</option></select></label></div>${field('maxAttempts', 'Maximum attempts per character', node.maxAttempts, 'type="number" min="1" max="20" required')}${area('successText', 'Discovery after solving', node.successText, 6000)}${area('failureText', 'Outcome after attempts are exhausted', node.failureText, 6000)}<section><div class="panel-head"><h3>Hints</h3><button type="button" data-action="advedit-hint-add" ${disabled(node.hints.length >= 5)}>+ Add hint</button></div>${node.hints.map((hint, index) => `<div class="advedit-hint">${area(`hint-${index}-text`, `Hint ${index + 1}`, hint.text, 2000)}${field(`hint-${index}-attempts`, 'Available after this many attempts', hint.afterAttempts, 'type="number" min="0" max="20" required')}<button type="button" class="quiet danger" data-action="advedit-hint-remove" data-index="${index}">Remove hint</button></div>`).join('')}</section>`;
    if (node.type === 'wayfinder') content = `${area('body', 'Scene briefing · revealed when unlocked', node.body, 12000)}${field('location', 'Meeting place', node.location, 'maxlength="200"')}<div class="two-fields"><label>Play style<select name="playStyle">${['social', 'investigation', 'physical', 'mixed'].map(style => `<option value="${style}" ${selected(node.playStyle === style)}>${style[0].toUpperCase() + style.slice(1)}</option>`).join('')}</select></label><label>Availability<select name="availability"><option value="open" ${selected(node.availability === 'open')}>Open for sign-ups</option><option value="closed" ${selected(node.availability === 'closed')}>Closed</option></select></label></div><div class="advedit-three-fields">${field('durationMinutes', 'Duration · minutes', node.durationMinutes, 'type="number" min="1" max="240" required')}${field('minPlayers', 'Minimum players', node.minPlayers, 'type="number" min="1" max="100" required')}${field('maxPlayers', 'Maximum players', node.maxPlayers, 'type="number" min="1" max="100" required')}</div><div class="two-fields">${field('startsAt', 'Opens · optional, local time', dateInput(node.startsAt), 'type="datetime-local"')}${field('endsAt', 'Closes · optional, local time', dateInput(node.endsAt), 'type="datetime-local"')}</div>`;
    openModal(`${locked ? 'View' : editingId ? 'Edit' : 'Add'} ${TYPES[node.type].split(' · ')[0]}`, `<form id="advedit-node-form">${err}<p class="hint">Apply changes to the adventure draft, then choose Save adventure to publish them.</p><fieldset class="advedit-fields" ${disabled(locked)}><legend>Instrument details</legend>${field('title', 'Instrument title', node.title, 'required maxlength="120"')}${area('summary', 'Public introduction · no hidden discoveries', node.summary, 2000)}${conditionFields('node', node.conditions)}${content}${actionFields('node', node.actions)}</fieldset><p class="hint">Printed prop code: <span class="advedit-code">${esc(node.code)}</span></p><div class="actions"><button type="submit" class="primary" ${disabled(locked || audioBusy)}>Apply to adventure draft</button><button type="button" class="quiet" data-action="close">${locked ? 'Done' : 'Cancel'}</button></div></form>`);
    document.querySelector('#modal').classList.add('wide-modal');
  }
  function referencedFlag(id) {
    return draft.nodes.some(node => node.conditions.flags.includes(id) || node.actions.success.includes(id) || node.actions.failure.includes(id) || (node.examinations || []).some(exam => exam.conditions.flags.includes(id) || exam.actions.includes(id)));
  }
  function requireSaved() {
    captureMain();
    if (dirty || !record?.version) throw new Error('Save your adventure before using this tool.');
  }
  function selectedCharacter() {
    progressCharacter = document.querySelector('#advedit-character')?.value || progressCharacter;
    if (!approvedCharacters().some(character => character.id === progressCharacter)) throw new Error('Choose an approved character first.');
    return progressCharacter;
  }
  async function starter() {
    templates = (await api('/api/adventure-templates')).templates;
    openModal('Start a ready-to-play adventure', `<p>Choose a world. ORACLE creates a new draft event with linked instruments, organizer instructions, and two prepared characters.</p><form id="advedit-starter-form">${err}<fieldset class="advedit-template-options"><legend>Choose your world</legend>${templates.map((template, index) => `<label class="advedit-template"><input type="radio" name="templateId" value="${esc(template.id)}" ${checked(index === 0)} required><span><span class="eyebrow">${esc(template.id)}</span><strong>${esc(template.title)}</strong><span class="hint">${esc(template.summary)}</span><span class="hint">${esc(template.durationMinutes)} minutes · ${esc(template.players)}</span></span></label>`).join('')}</fieldset>${field('name', 'Event name · optional', '', 'maxlength="100" placeholder="Use the adventure title"')}<div class="actions"><button type="submit" class="primary" ${disabled(!templates.length)}>Create adventure event</button><button type="button" data-action="close">Cancel</button></div></form>`);
  }
  function confirmation(operation, title, description, fields = {}) {
    openModal(title, `<p class="muted">${esc(description)}</p><form id="advedit-confirm-form" data-operation="${operation}" ${Object.entries(fields).map(([key, value]) => `data-${key}="${esc(value)}"`).join(' ')}>${err}<div class="actions"><button type="submit" class="${operation === 'reset' ? 'danger' : 'primary'}">${esc(title)}</button><button type="button" class="quiet" data-action="close">Cancel</button></div></form>`);
  }
  function labels() {
    requireSaved();
    openModal('Print prop labels', `<p class="hint advedit-no-print">Place each label on its matching prop. Labels contain only the event, title, instrument type, and lookup code.</p><div id="advedit-print-labels" class="advedit-labels">${saved.nodes.map(node => `<article class="advedit-prop-label"><p class="eyebrow">ORACLE · LARP Field Kit</p><p>${esc(state.event.name)}</p><h3>${esc(node.title)}</h3><p class="hint">${esc(TYPES[node.type].split(' · ')[0])}</p><div class="advedit-prop-qr" data-code="${esc(node.code)}"></div><p class="advedit-code">${esc(node.code.match(/.{1,4}/g).join('-'))}</p><p class="hint">Scan in ORACLE · Event members only</p></article>`).join('')}</div><div class="actions mt advedit-no-print"><button data-action="advedit-print" class="primary">Print labels</button><button data-action="close">Done</button></div>`);
    document.querySelector('#modal').classList.add('wide-modal');
    document.querySelectorAll('.advedit-prop-qr').forEach(target => renderBadgeQR(target, `${location.origin}/#prop/${state.event.id}/${target.dataset.code}`, 224));
  }
  async function action(button) {
    const name = button.dataset.action;
    if (!name?.startsWith('advedit-')) return false;
    captureMain();
    if (name === 'advedit-starter') { if (confirmDiscard()) await starter(); }
    else if (name === 'advedit-open') await open();
    else if (name === 'advedit-back') { if (confirmDiscard()) await loadEvent(state.event.id); }
    else if (name === 'advedit-discard') { if (confirmDiscard()) render(); }
    else if (name === 'advedit-node-add') { if (!editable()) throw new Error('This adventure is locked for editing.'); editingId = null; nodeDraft = defaultAdventureNode(button.dataset.type, newId(button.dataset.type.replace('_', '-')), newCode()); dialogDirty = false; showNode(); }
    else if (name === 'advedit-node-edit') { editingId = button.dataset.id; nodeDraft = clone(draft.nodes.find(node => node.id === editingId)); dialogDirty = false; showNode(); }
    else if (name === 'advedit-node-remove') {
      if (!editable()) throw new Error('This adventure is locked for editing.');
      const id = button.dataset.id;
      if (draft.nodes.some(node => node.id !== id && (node.conditions.completed.includes(id) || (node.examinations || []).some(exam => exam.conditions.completed.includes(id))))) throw new Error('Another instrument depends on this discovery. Remove that access condition first.');
      if (window.confirm('Remove this instrument from the adventure draft?')) { draft.nodes = draft.nodes.filter(node => node.id !== id); markDirty(); render(); }
    }
    else if (name === 'advedit-flag-add') { if (!editable()) throw new Error('This adventure is locked for editing.'); draft.flags.push({ id: newId('flag'), name: 'New story flag' }); markDirty(); render(); }
    else if (name === 'advedit-flag-remove') { if (referencedFlag(button.dataset.id)) throw new Error('This flag is used by an instrument. Remove its conditions and outcomes first.'); draft.flags = draft.flags.filter(flag => flag.id !== button.dataset.id); markDirty(); render(); }
    else if (name === 'advedit-exam-add') { captureNode(); nodeDraft.examinations.push({ id: newId('reading'), label: '', text: '', conditions: { completed: [], skills: [], flags: [], statuses: [] }, actions: [] }); dialogDirty = true; showNode(); }
    else if (name === 'advedit-exam-remove') { captureNode(); nodeDraft.examinations = nodeDraft.examinations.filter(exam => exam.id !== button.dataset.id); dialogDirty = true; showNode(); }
    else if (name === 'advedit-hint-add') { captureNode(); nodeDraft.hints.push({ text: '', afterAttempts: 0 }); dialogDirty = true; showNode(); }
    else if (name === 'advedit-hint-remove') { captureNode(); nodeDraft.hints.splice(Number(button.dataset.index), 1); dialogDirty = true; showNode(); }
    else if (name === 'advedit-audio-remove') { captureNode(); nodeDraft.audio = null; dialogDirty = true; showNode(); }
    else if (name === 'advedit-preview') { requireSaved(); const characterId = selectedCharacter(); await ctx.openPlayer({ preview: true, characterId }); }
    else if (name === 'advedit-refresh') { requireSaved(); useRecord(await api(`${base()}/manage`)); render(); toast('Adventure progress refreshed.'); }
    else if (name === 'advedit-labels') labels();
    else if (name === 'advedit-print') { document.body.classList.add('advedit-printing'); window.print(); }
    else if (name === 'advedit-rehearsal') { requireSaved(); confirmation('rehearsal', 'Create rehearsal copy', 'Create a separate rehearsal event with fresh character identities and starting inventory. No discoveries, invitations, attempts, or attendance are copied.'); }
    else if (name === 'advedit-reset') { requireSaved(); confirmation('reset', 'Reset rehearsal progress', 'Are you sure? This clears every character’s discoveries, attempts, journal, and scene attendance in this dedicated rehearsal copy. The adventure and characters remain.'); }
    else if (name === 'advedit-override') { requireSaved(); const characterId = selectedCharacter(), node = saved.nodes.find(entry => entry.id === button.dataset.id), character = approvedCharacters().find(entry => entry.id === characterId); confirmation('override', { release: 'Release discovery', solve: 'Solve puzzle', reset_attempts: 'Reset failed attempts' }[button.dataset.kind], `Apply this organizer override to ${character.name} for “${node.title}”? This action is recorded in the event activity log.`, { character: characterId, node: node.id, kind: button.dataset.kind }); }
    else return false;
    return true;
  }
  async function submit(form) {
    if (!form.id.startsWith('advedit-')) return false;
    if (form.id === 'advedit-main-form') {
      if (!editable()) throw new Error('This adventure is locked for editing.');
      captureMain(); validateAdventure(draft, state.event.setup);
      const target = document.querySelector('#advedit-save-state'); if (target) { target.textContent = 'Saving…'; target.dataset.saving = 'true'; }
      try { useRecord(await api(`${base()}/manage`, 'PUT', { version: record.version, definition: draft })); render(); toast('Adventure saved to event.'); }
      catch (error) { if (target) { target.textContent = 'Not saved · changes retained'; target.dataset.saving = 'false'; } throw error; }
    } else if (form.id === 'advedit-node-form') {
      if (audioBusy) throw new Error('Wait for the recording to finish loading.');
      captureNode(); const next = clone(draft); next.nodes = editingId ? next.nodes.map(node => node.id === editingId ? clone(nodeDraft) : node) : [...next.nodes, clone(nodeDraft)];
      validateAdventure(next, state.event.setup); draft = next; dialogDirty = false; markDirty(); closeModal(true); cleanupModal(); render(); toast('Instrument saved to draft. Choose Save adventure to publish it.');
    } else if (form.id === 'advedit-starter-form') {
      const data = new FormData(form), id = String(data.get('templateId'));
      if (!templates.some(template => template.id === id)) throw new Error('Choose one of the available adventures.');
      const name = String(data.get('name') || '').trim();
      const result = await api(`/api/adventure-templates/${encodeURIComponent(id)}`, 'POST', name ? { name } : {});
      closeModal(true); await loadEvent(result.event.id); await open(); toast('Adventure event created. Read the organizer notes, then assign your characters.');
    } else if (form.id === 'advedit-confirm-form') {
      const operation = form.dataset.operation;
      if (operation === 'rehearsal') { const result = await api(`${base()}/rehearsal`, 'POST', {}); closeModal(true); await loadEvent(result.event.id); await open(); toast('Your separate rehearsal copy is ready.'); }
      else if (operation === 'reset') { await api(`${base()}/reset`, 'POST', { version: record.version, confirm: true }); closeModal(true); useRecord(await api(`${base()}/manage`)); render(); toast('Rehearsal progress reset.'); }
      else if (operation === 'override') { await api(`${base()}/override`, 'POST', { requestId: crypto.randomUUID(), version: record.version, characterId: form.dataset.character, nodeId: form.dataset.node, kind: form.dataset.kind }); closeModal(true); useRecord(await api(`${base()}/manage`)); render(); toast('Organizer override recorded.'); }
      else return false;
    } else return false;
    return true;
  }
  function cleanupModal() { modalEpoch++; nodeDraft = null; editingId = null; dialogDirty = false; audioBusy = false; document.body.classList.remove('advedit-printing'); }
  function reset() { cleanupModal(); record = null; draft = defaultAdventure(); saved = clone(draft); eventId = null; dirty = false; templates = []; progressCharacter = ''; }
  function confirmDiscard(scope = 'all') {
    const hasChanges = dialogDirty || audioBusy || (scope !== 'modal' && dirty);
    if (hasChanges && !window.confirm(scope === 'modal' ? 'Discard the unsaved changes to this instrument?' : 'Discard your unsaved adventure changes?')) return false;
    if (scope !== 'modal' && hasChanges) { draft = clone(saved); dirty = false; }
    if (hasChanges) cleanupModal();
    return true;
  }
  document.addEventListener('input', event => {
    if (event.target.closest('#advedit-main-form')) markDirty();
    if (event.target.closest('#advedit-node-form')) dialogDirty = true;
  });
  document.addEventListener('change', async event => {
    if (event.target.id === 'advedit-character') progressCharacter = event.target.value;
    if (event.target.closest('#advedit-node-form')) dialogDirty = true;
    if (event.target.id !== 'advedit-audio-file' || !nodeDraft) return;
    const file = event.target.files?.[0]; if (!file) return;
    const epoch = modalEpoch, target = document.querySelector('#advedit-node-form .error');
    try {
      captureNode(); audioBusy = true;
      const status = document.querySelector('#advedit-audio-status'); if (status) status.textContent = 'Reading recording…';
      if (file.size > 740000) throw new Error('Choose a recording smaller than 740 kB. Short, compressed MP3 or Ogg clips work well.');
      const extension = file.name.split('.').at(-1).toLowerCase();
      const mime = ({ mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav' })[extension] || file.type;
      if (!['audio/mpeg', 'audio/ogg', 'audio/wav'].includes(mime)) throw new Error('Choose an MP3, Ogg, or WAV recording.');
      const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      if (epoch !== modalEpoch || !nodeDraft) return;
      const next = clone(nodeDraft); next.audio = `data:${mime};base64,${btoa(binary)}`;
      const candidate = clone(draft); candidate.nodes = editingId ? candidate.nodes.map(node => node.id === editingId ? next : node) : [...candidate.nodes, next];
      validateAdventure(candidate, state.event.setup); nodeDraft.audio = next.audio; audioBusy = false; dialogDirty = true; showNode();
    } catch (error) { if (epoch === modalEpoch) { if (target) target.textContent = error.message; const status = document.querySelector('#advedit-audio-status'); if (status) status.textContent = 'Recording not attached.'; } }
    finally { if (epoch === modalEpoch) audioBusy = false; }
  });
  window.addEventListener('beforeunload', event => { if (dirty || dialogDirty || audioBusy) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('afterprint', () => document.body.classList.remove('advedit-printing'));
  return { open, render, action, submit, cleanupModal, confirmDiscard, reset, isDirty: () => dirty || dialogDirty || audioBusy };
}
