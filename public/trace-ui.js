const KINDS = [['evidence', 'Evidence'], ['person', 'Person'], ['place', 'Place'], ['theory', 'Theory']];
const TYPE_NAMES = { relic: 'Relic reading', dead_drop: 'Message', cipherbox: 'Cipher reading', wayfinder: 'Scene reading', shared_reading: 'Shared reading', whisper: 'Rumor reading' };
const clone = value => JSON.parse(JSON.stringify(value));
const blank = kind => ({ kind, title: '', notes: '', audience: { type: 'private', ids: [] }, sources: [], links: [] });
const kindName = value => KINDS.find(([id]) => id === value)?.[1] || 'Record';
// PostgreSQL JSONB may reorder object keys. Checkbox choices are sets, so their
// display order must not turn an unchanged saved record into an unsaved draft.
const documentFingerprint = value => JSON.stringify({
  kind: value.kind, title: value.title, notes: value.notes,
  audience: { type: value.audience.type, ids: [...value.audience.ids].sort() },
  sources: [...value.sources].sort(),
  links: value.links.map(link => ({ recordId: link.recordId, label: link.label })).sort((a, b) => a.recordId.localeCompare(b.recordId)),
});

export function createTraceUI(ctx) {
  const { state, api, shell, esc, loadEvent, toast, err } = ctx;
  let board = null, accountId = null, selectedCharacterId = null, selectedRecordId = null;
  let editor = null, pending = null, epoch = 0, feedback = '', query = '', kindFilter = '', ownerFilter = '';
  const connected = () => navigator.onLine !== false;
  const eventId = () => board?.event.id || state.event?.id;
  const base = (id = eventId()) => `/api/events/${id}/trace`;
  const current = context => context.epoch === epoch && context.accountId && context.accountId === state.session?.user?.id && context.eventId === state.event?.id;
  const context = () => ({ epoch, accountId, eventId: eventId() });
  const editable = () => Boolean(board?.character && !board.readOnly && connected() && !pending);
  const selected = () => board?.records.find(record => record.id === selectedRecordId);
  const dirty = () => Boolean(editor && documentFingerprint(editor.document) !== editor.baseline);
  const displayDate = value => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
  function reset() {
    epoch++; board = null; accountId = null; selectedCharacterId = null; selectedRecordId = null;
    editor = null; pending = null; feedback = ''; query = ''; kindFilter = ''; ownerFilter = '';
  }
  function ensureAccount() {
    const who = state.session?.user?.id || null;
    if (who !== accountId) { reset(); accountId = who; }
    return who;
  }
  function recordDocument(record) {
    return { kind: record.kind, title: record.title, notes: record.notes, audience: clone(record.audience || { type: 'private', ids: [] }), sources: record.sources.map(source => source.id), links: record.links.map(link => ({ recordId: link.recordId, label: link.label })) };
  }
  function beginEdit(record, kind = 'evidence') {
    const document = record ? recordDocument(record) : blank(kind);
    editor = { id: record?.id || null, version: record?.version || null, document, audienceChoice: document.audience.type === 'private' && !document.audience.ids.length ? 'owner' : document.audience.type, baseline: documentFingerprint(document), conflict: false, reviewed: false, latest: null };
    selectedRecordId = record?.id || null; feedback = ''; render();
  }
  function capture() {
    if (!editor || pending || state.view !== 'trace') return;
    const form = document.querySelector('#trace-record-form');
    if (!form || form.querySelector('fieldset')?.disabled) return;
    const data = new FormData(form), previous = editor.document;
    const audienceKind = data.get('audienceType') || editor.audienceChoice;
    editor.audienceChoice = audienceKind;
    editor.document = {
      kind: String(data.get('kind') || previous.kind), title: String(data.get('title') ?? previous.title), notes: String(data.get('notes') ?? previous.notes),
      audience: { type: audienceKind === 'owner' ? 'private' : audienceKind, ids: audienceKind === 'owner' || audienceKind === 'public' ? [] : data.getAll('audienceIds').map(String) },
      sources: data.getAll('sourceIds').map(String),
      links: data.getAll('linkIds').map(String).map(id => ({ recordId: id, label: String([...form.querySelectorAll('[data-link-label]')].find(input => input.dataset.linkLabel === id)?.value || '') })),
    };
  }
  function applyBoard(value) {
    board = value; selectedCharacterId = value.character?.id || null;
    if (state.event?.id === value.event.id) state.event.status = value.event.status;
    if (editor?.id) {
      const latest = value.records.find(record => record.id === editor.id && record.isOwner);
      if (!latest || latest.version !== editor.version) { editor.conflict = true; editor.reviewed = false; editor.latest = latest || null; }
    }
    if (selectedRecordId && !value.records.some(record => record.id === selectedRecordId) && !editor) selectedRecordId = null;
  }
  async function fetchBoard(scope, characterId) {
    const value = await api(`${base(scope.eventId)}${characterId ? `?${new URLSearchParams({ characterId })}` : ''}`);
    if (!current(scope)) return false;
    applyBoard(value); return true;
  }
  async function open(options = {}) {
    ensureAccount();
    const id = state.event?.id;
    if (!id) throw new Error('Open an event before opening TRACE.');
    if (board?.event.id !== id) { board = null; editor = null; selectedRecordId = null; pending = null; selectedCharacterId = null; }
    const characterId = options.characterId || selectedCharacterId;
    if (pending && pending.characterId !== characterId) throw new Error('Retry the pending TRACE action before switching characters.');
    if (editor && characterId !== selectedCharacterId && !confirmDiscard()) return;
    epoch++; state.view = 'trace'; feedback = '';
    const scope = { epoch, accountId, eventId: id };
    if (characterId !== selectedCharacterId) { board = null; editor = null; selectedRecordId = null; }
    render();
    try { if (await fetchBoard(scope, characterId)) render(); }
    catch (error) { if (current(scope)) { feedback = error.message || 'TRACE could not be loaded. Reconnect and try again.'; render(); } throw error; }
  }
  async function refresh({ review = false } = {}) {
    if (pending) throw new Error('Retry the pending action before refreshing your notebook.');
    if (!connected()) throw new Error('Reconnect to refresh TRACE.');
    capture(); epoch++;
    const scope = context();
    try {
      if (!await fetchBoard(scope, selectedCharacterId)) return;
      if (editor?.conflict && review) { editor.reviewed = true; editor.latest = board.records.find(record => record.id === editor.id && record.isOwner) || null; }
      feedback = editor?.conflict ? 'Your draft is retained. Review the latest saved record before saving again.' : 'Notebook refreshed.'; render();
    } catch (error) {
      if (current(scope)) { feedback = 'Could not refresh. Your draft is retained.'; render(); }
      throw error;
    }
  }
  function audienceName(audience) {
    if (!audience || audience.type === 'private' && !audience.ids.length) return 'Only me';
    if (audience.type === 'public') return 'All approved characters in this event';
    const choices = audience.type === 'faction' ? board.audiences.factions : audience.type === 'group' ? board.audiences.groups : board.audiences.characters;
    const names = audience.ids.map(id => choices.find(choice => choice.id === id)?.name).filter(Boolean);
    return names.length ? names.join(', ') : 'Selected recipients';
  }
  function characterPicker() {
    const characters = board.characters || [];
    if (!characters.length) return `<section class="empty"><h2>An approved character is needed.</h2><p>${esc(board.message || 'Choose a character assigned to you before keeping an investigation notebook.')}</p><button type="button" data-action="character-open">Open characters</button></section>`;
    return `<form id="trace-character-form" class="trace-character-picker"><label>Investigating as<select name="characterId" ${pending ? 'disabled' : ''}>${characters.map(character => `<option value="${esc(character.id)}" ${selectedCharacterId === character.id ? 'selected' : ''}>${esc(character.name)}</option>`).join('')}</select></label><button type="submit" ${pending ? 'disabled' : ''}>Use character</button></form>`;
  }
  function pendingBanner() {
    if (!pending) return '';
    return `<section class="trace-notice" role="status"><h2>${pending.sending ? 'Saving your notebook…' : 'This action has no confirmed response yet.'}</h2><p>${pending.sending ? 'Wait for ORACLE to confirm the result.' : 'Retry sends the same action and recovers its result without creating a duplicate record. Your draft is retained.'}</p>${pending.sending ? '' : `<button type="button" class="primary mt" data-action="trace-retry" ${!connected() ? 'disabled' : ''}>Retry pending action</button>`}</section>`;
  }
  function matchingRecords() {
    const text = query.trim().toLocaleLowerCase();
    return board.records.filter(record => (!kindFilter || record.kind === kindFilter) && (!ownerFilter || (ownerFilter === 'own' ? record.isOwner : !record.isOwner)) && (!text || [record.title, record.notes, record.owner?.name].some(value => String(value || '').toLocaleLowerCase().includes(text))));
  }
  function recordList() {
    const records = matchingRecords();
    return `<p class="hint trace-result-count" role="status">${records.length} ${records.length === 1 ? 'record' : 'records'} shown</p>${records.length ? `<div class="trace-record-list">${records.map(record => `<button type="button" class="trace-record-card ${record.id === selectedRecordId ? 'selected' : ''}" data-action="trace-select" data-id="${esc(record.id)}" aria-pressed="${record.id === selectedRecordId}"><span class="trace-record-kind">${esc(kindName(record.kind))}</span><strong>${esc(record.title)}</strong><span class="hint">${record.isOwner ? `Your record · ${esc(audienceName(record.audience))}` : `Shared by ${esc(record.owner?.name || 'another character')}`}</span></button>`).join('')}</div>` : `<p class="hint">${board.records.length ? 'No records match these filters.' : 'Start with something you found, someone you met, a place, or a theory. New records are private.'}</p>`}`;
  }
  function updateList() {
    const element = document.querySelector('#trace-record-list'); if (element) element.innerHTML = recordList();
  }
  function notebook() {
    return `<div class="trace-layout"><aside class="panel trace-notebook" aria-label="Investigation records"><h2>Your investigation</h2><div class="trace-new-actions">${KINDS.map(([kind, name]) => `<button type="button" data-action="trace-new" data-kind="${kind}" ${!editable() ? 'disabled' : ''}>+ ${name}</button>`).join('')}</div><div class="trace-filters"><label>Search records<input id="trace-search" type="search" value="${esc(query)}" placeholder="Title, notes, or character" maxlength="200"></label><div class="trace-filter-pair"><label>Kind<select id="trace-kind-filter"><option value="">All kinds</option>${KINDS.map(([kind, name]) => `<option value="${kind}" ${kindFilter === kind ? 'selected' : ''}>${name}</option>`).join('')}</select></label><label>Ownership<select id="trace-owner-filter"><option value="">All visible</option><option value="own" ${ownerFilter === 'own' ? 'selected' : ''}>My records</option><option value="shared" ${ownerFilter === 'shared' ? 'selected' : ''}>Shared with me</option></select></label></div></div><div id="trace-record-list">${recordList()}</div><p class="hint mt">Up to ${board.limits?.perCharacter || 300} active records per character. Only records currently available to this character appear.</p></aside><section class="trace-detail" aria-label="Selected investigation record">${editor ? editorView() : selected() ? recordView(selected()) : '<section class="panel trace-empty"><p class="eyebrow">TRACE · Investigation notebook</p><h2>Follow the connections.</h2><p>Select a record to read it, or add evidence, a person, a place, or a theory.</p><p class="hint mt">These are player observations and ideas. A connection does not establish a fact or complete an adventure.</p></section>'}</section></div>`;
  }
  function citations(sources) {
    return sources.length ? `<ul class="trace-citations">${sources.map(source => `<li><strong>${esc(source.title)}</strong><span class="hint">${esc(TYPE_NAMES[source.type] || 'Journal reading')}</span></li>`).join('')}</ul>` : '<p class="hint">No citations available to this character.</p>';
  }
  function connections(links) {
    return links.length ? `<ul class="trace-connections">${links.map(link => `<li><button type="button" data-action="trace-select" data-id="${esc(link.recordId)}">${esc(link.title)}</button>${link.label ? `<span class="hint">${esc(link.label)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="hint">No connected records available to this character.</p>';
  }
  function recordView(record) {
    return `<article class="panel trace-reading"><p class="eyebrow">${esc(kindName(record.kind))} · Player ${record.kind === 'theory' ? 'speculation' : 'observation'}</p><h2>${esc(record.title)}</h2><p class="hint">${record.isOwner ? `Your record · ${esc(audienceName(record.audience))}` : `Shared by ${esc(record.owner?.name || 'another character')} · Read-only`}</p><p class="trace-notes prose">${esc(record.notes || 'No notes added.')}</p><p class="hint">${record.kind === 'theory' ? 'A theory is an idea to investigate, not a verified finding.' : 'This is a player-authored record. Its label does not verify its contents.'}</p><details class="trace-related"><summary>Citations · ${record.sources.length}</summary>${citations(record.sources)}<p class="hint">Citations refer to readings already in your own journal. Private source text is never copied into this record.</p><button type="button" class="quiet mt" data-action="trace-journal">Open my journal</button></details><details class="trace-related"><summary>Connections · ${record.links.length}</summary>${connections(record.links)}<p class="hint">Only connected records you can currently read appear here.</p></details><div class="actions mt">${record.isOwner ? `<button type="button" class="primary" data-action="trace-edit" ${!editable() ? 'disabled' : ''}>Edit record</button><button type="button" class="quiet danger" data-action="trace-archive" ${!editable() ? 'disabled' : ''}>Archive record</button>` : '<span class="hint">Only its author can edit this record.</span>'}</div><p class="hint mt">Updated ${esc(displayDate(record.updatedAt))}</p></article>`;
  }
  function audienceFields() {
    const audience = editor.document.audience, value = editor.audienceChoice;
    const choices = value === 'faction' ? board.audiences.factions : value === 'group' ? board.audiences.groups : value === 'private' ? board.audiences.characters.filter(character => character.id !== selectedCharacterId) : [];
    return `<label>Who can read this record?<select name="audienceType"><option value="owner" ${value === 'owner' ? 'selected' : ''}>Only me · private</option><option value="public" ${value === 'public' ? 'selected' : ''}>All approved characters in this event</option><option value="faction" ${value === 'faction' ? 'selected' : ''}>Selected factions</option><option value="group" ${value === 'group' ? 'selected' : ''}>Selected groups</option><option value="private" ${value === 'private' ? 'selected' : ''}>Selected characters</option></select></label><div id="trace-audience-choices">${['faction', 'group', 'private'].includes(value) ? `<div class="trace-checklist">${choices.length ? choices.map(choice => `<label class="trace-checkbox"><input type="checkbox" name="audienceIds" value="${esc(choice.id)}" ${audience.ids.includes(choice.id) ? 'checked' : ''}><span>${esc(choice.name)}</span></label>`).join('') : '<p class="hint">No eligible recipients of this kind are currently available.</p>'}</div><p class="hint">Choose up to 20 recipients. Your own record always remains available to you.</p>` : ''}</div><p class="hint trace-sharing-explanation">${value === 'owner' ? 'Only your character can read this record. Organizers do not have access to your private notes.' : 'Saving shares your title, notes, and record kind with the chosen audience. Private citations and private connected records stay hidden; sharing them does not copy their text. People may remember notes after you change access.'}</p>`;
  }
  function sourceOptions() {
    const sources = [...board.sources];
    const record = selected();
    for (const source of record?.sources || []) if (!sources.some(item => item.id === source.id)) sources.push(source);
    return sources.length ? `${board.sourcesTruncated ? '<p class="hint">The 2,000 most recent journal readings are available here, along with this record’s existing citations.</p>' : ''}<div class="trace-checklist">${sources.map(source => `<label class="trace-checkbox"><input type="checkbox" name="sourceIds" value="${esc(source.id)}" ${editor.document.sources.includes(source.id) ? 'checked' : ''}><span><strong>${esc(source.title)}</strong><span class="hint">${esc(TYPE_NAMES[source.type] || 'Journal reading')}</span></span></label>`).join('')}</div>` : '<p class="hint">Discover or receive a reading to cite it here.</p>';
  }
  function linkOptions() {
    const records = board.records.filter(record => record.id !== editor.id);
    return records.length ? `<div class="trace-checklist">${records.map(record => { const linked = editor.document.links.find(link => link.recordId === record.id); return `<div class="trace-link-option"><label class="trace-checkbox"><input type="checkbox" name="linkIds" value="${esc(record.id)}" ${linked ? 'checked' : ''}><span>${esc(record.title)}<span class="hint">${esc(kindName(record.kind))}</span></span></label><label><span class="trace-sr-only">Connection to ${esc(record.title)}</span><input data-link-label="${esc(record.id)}" value="${esc(linked?.label || '')}" maxlength="120" placeholder="Connection label (optional)" ${linked ? '' : 'disabled'}></label></div>`; }).join('')}</div>` : '<p class="hint">Add another record to make a connection.</p>';
  }
  function conflictView() {
    if (!editor.conflict) return '';
    return `<section class="trace-notice" role="alert"><h3>The saved record has changed.</h3><p>Your draft remains below. Reload and review the latest saved record before deciding what to save.</p><button type="button" data-action="trace-review" ${pending ? 'disabled' : ''}>Reload and review</button>${editor.reviewed ? editor.latest ? `<details class="mt" open><summary>Latest saved record</summary><h3 class="mt">${esc(editor.latest.title)}</h3><p class="hint">${esc(kindName(editor.latest.kind))} · ${esc(audienceName(editor.latest.audience))}</p><p class="trace-notes prose">${esc(editor.latest.notes || 'No notes added.')}</p><p class="hint">${editor.latest.sources.length} citations · ${editor.latest.links.length} connections</p></details><button type="button" class="mt" data-action="trace-rebase">Use my draft for this revision</button>` : '<p class="mt">This record is no longer available to edit. Your draft is retained here for review.</p>' : ''}</section>`;
  }
  function editorView() {
    const value = editor.document, locked = !editable(), changed = dirty();
    return `<section class="panel trace-editor"><div class="panel-head"><h2>${editor.id ? 'Edit record' : `New ${kindName(value.kind).toLocaleLowerCase()}`}</h2><span id="trace-save-status" class="save-status" role="status">${pending ? 'Awaiting confirmation' : changed ? 'Unsaved changes' : editor.id ? 'Saved to notebook' : 'Private draft · not saved'}</span></div>${conflictView()}<form id="trace-record-form">${err}<fieldset ${locked ? 'disabled' : ''}><legend class="trace-sr-only">Investigation record</legend><div class="trace-editor-heading"><label>Kind<select name="kind">${KINDS.map(([kind, name]) => `<option value="${kind}" ${kind === value.kind ? 'selected' : ''}>${name}</option>`).join('')}</select></label><label>Title<input name="title" value="${esc(value.title)}" maxlength="120" required placeholder="Give this record a useful name"></label></div><label>Notes<textarea name="notes" rows="8" maxlength="6000" placeholder="What did you observe? What do you suspect?">${esc(value.notes)}</textarea></label><p class="hint">Record your character’s observations and ideas. TRACE does not verify a theory or grant story progress.</p><section class="trace-audience" aria-label="Record sharing">${audienceFields()}</section><details class="trace-related" data-trace-disclosure="sources"><summary>Cite journal readings · <span id="trace-source-count">${value.sources.length}</span> of 10</summary><p class="hint">References only. Other players see a citation only when they already have the same original reading. Use Exchanges to deliberately share permitted readings.</p>${sourceOptions()}</details><details class="trace-related" data-trace-disclosure="links"><summary>Connect records · <span id="trace-link-count">${value.links.length}</span> of 10</summary><p class="hint">Choose records currently visible to this character. A connection is your observation; it does not reveal a private destination.</p>${linkOptions()}</details></fieldset><div class="actions mt"><button type="submit" class="primary" ${locked || editor.conflict || !changed ? 'disabled' : ''}>${editor.id ? 'Save changes' : 'Save record'}</button><button type="button" class="quiet" data-action="trace-cancel-edit" ${pending ? 'disabled' : ''}>${editor.id ? 'Cancel editing' : 'Discard draft'}</button></div></form></section>`;
  }
  function render() {
    ensureAccount();
    if (state.view !== 'trace') return;
    if (!board || board.event.id !== state.event?.id) {
      shell(`<section class="trace-workspace"><button type="button" class="quiet" data-action="trace-back">← Event briefing</button><h1 class="mt">TRACE</h1><p role="status">${esc(feedback || 'Opening your investigation notebook…')}</p>${feedback ? '<button type="button" class="mt" data-action="trace-open">Try again</button>' : ''}</section>`); return;
    }
    const disclosures = new Map([...document.querySelectorAll('[data-trace-disclosure]')].map(element => [element.dataset.traceDisclosure, element.open]));
    shell(`<section class="trace-workspace"><button type="button" class="quiet" data-action="trace-back">← Event briefing</button><header class="page-head mt"><div><p class="eyebrow">${esc(board.event.name)} · TRACE</p><h1>Investigation notebook</h1><p class="muted">Collect observations, keep your theories, and connect what you know.</p></div><div class="actions"><button type="button" data-action="trace-refresh" ${pending || !connected() ? 'disabled' : ''}>Refresh</button><button type="button" class="quiet" data-action="trace-journal" ${!board.character || pending ? 'disabled' : ''}>My journal</button><button type="button" class="quiet" data-action="trace-exchanges" ${!board.character || pending ? 'disabled' : ''}>Exchanges</button></div></header>${pendingBanner()}${feedback ? `<p class="trace-feedback" role="status">${esc(feedback)}</p>` : ''}${!connected() ? '<p class="trace-notice" role="status">Reconnect to view current sharing permissions and save records. This notebook is kept in memory only; it is not saved for offline use.</p>' : ''}${characterPicker()}${board.character ? `${board.readOnly ? `<p class="trace-notice">${esc(board.message || 'This notebook is read-only. Saving requires an approved character while TRACE is enabled in live play or rehearsal.')}</p>` : ''}${notebook()}` : ''}</section>`);
    for (const element of document.querySelectorAll('[data-trace-disclosure]')) if (disclosures.has(element.dataset.traceDisclosure)) element.open = disclosures.get(element.dataset.traceDisclosure);
  }
  function confirmDiscard(scope) {
    if (scope === 'modal') return true;
    capture();
    if (pending?.sending) { toast('Wait for the TRACE action to finish.'); return false; }
    if (pending) { toast('Retry the pending TRACE action before leaving this notebook.'); return false; }
    if (dirty() && !window.confirm('Discard your unsaved investigation notes?')) return false;
    editor = null; return true;
  }
  async function runMutation(path, method, body, kind, retry = false) {
    ensureAccount();
    if (!connected()) throw new Error('Reconnect before saving investigation records.');
    if (pending && !retry) throw new Error('Retry the pending action before making another change.');
    const item = retry ? pending : { path, method, body: clone({ requestId: crypto.randomUUID(), ...body }), kind, eventId: eventId(), characterId: selectedCharacterId, sending: false };
    if (!item || item.sending) return;
    epoch++; const scope = context(); item.sending = true; pending = item; feedback = ''; render();
    try {
      const result = await api(item.path, item.method, item.body);
      if (!current(scope)) return;
      pending = null; editor = null;
      const record = result.record;
      if (record) {
        board.records = board.records.filter(saved => saved.id !== record.id);
        if (!record.archived) board.records.unshift(record);
        selectedRecordId = record.archived ? null : record.id;
      }
      feedback = item.kind === 'archive' ? 'Record archived.' : 'Record saved to your notebook.';
      try { await fetchBoard(scope, item.characterId); }
      catch { if (current(scope)) feedback = `${item.kind === 'archive' ? 'Your archive action' : 'Your save'} was confirmed. Refresh to update the notebook list.`; }
      if (current(scope)) { render(); toast(item.kind === 'archive' ? 'Record archived.' : 'Investigation record saved.'); }
    } catch (error) {
      if (!current(scope)) return;
      item.sending = false;
      if (error.status >= 400 && error.status < 500) {
        pending = null; feedback = error.message || 'This record could not be saved. Your draft is retained.';
        if (error.status === 409 && editor?.id) { editor.conflict = true; editor.reviewed = false; editor.latest = null; }
      } else feedback = 'The connection did not confirm this action. Retry the pending action to recover its result.';
      render();
    } finally {
      item.sending = false;
      if (pending === item && current(scope)) render();
    }
  }
  function validateDocument() {
    if (!editor.document.title.trim()) throw new Error('Give this record a title.');
    const value = editor.document;
    if (value.sources.length > 10 || value.links.length > 10) throw new Error('Choose no more than 10 citations and 10 connections.');
    if (value.audience.ids.length > 20) throw new Error('Choose no more than 20 recipients.');
    if (['private', 'faction', 'group'].includes(editor.audienceChoice) && !value.audience.ids.length) throw new Error('Choose at least one recipient, or select Only me to keep this record private.');
  }
  async function action(button) {
    const name = button.dataset.action;
    if (!name?.startsWith('trace-')) return false;
    ensureAccount();
    switch (name) {
      case 'trace-open': await open(); break;
      case 'trace-back': if (confirmDiscard()) { epoch++; await loadEvent(state.event.id); } break;
      case 'trace-refresh': await refresh(); break;
      case 'trace-select': {
        if (!board?.records.some(record => record.id === button.dataset.id)) throw new Error('This connected record is no longer available. Refresh the notebook.');
        if (confirmDiscard()) { selectedRecordId = button.dataset.id; feedback = ''; render(); }
        break;
      }
      case 'trace-new': if (!editable()) throw new Error('Saving is available during live play or rehearsal with an approved character.'); else if (confirmDiscard()) beginEdit(null, KINDS.some(([kind]) => kind === button.dataset.kind) ? button.dataset.kind : 'evidence'); break;
      case 'trace-edit': if (!editable() || !selected()?.isOwner) throw new Error('Only your own records can be edited.'); else if (confirmDiscard()) beginEdit(selected()); break;
      case 'trace-cancel-edit': if (confirmDiscard()) { feedback = ''; render(); } break;
      case 'trace-review': await refresh({ review: true }); break;
      case 'trace-rebase':
        if (!editor?.conflict || !editor.reviewed || !editor.latest || pending) throw new Error('Reload and review the saved record first.');
        capture(); editor.version = editor.latest.version; editor.baseline = documentFingerprint(recordDocument(editor.latest)); editor.conflict = false; editor.reviewed = false; editor.latest = null; feedback = 'Your draft is ready to save against the reviewed revision.'; render(); break;
      case 'trace-archive': {
        const record = selected();
        if (!editable() || !record?.isOwner) throw new Error('Only your own records can be archived.');
        if (window.confirm('Archive this record? It will leave your notebook and no longer be shared with other characters.')) await runMutation(`${base()}/${record.id}/archive`, 'POST', { characterId: selectedCharacterId, version: record.version }, 'archive');
        break;
      }
      case 'trace-retry': if (pending) await runMutation(pending.path, pending.method, pending.body, pending.kind, true); break;
      case 'trace-journal': if (confirmDiscard()) { epoch++; await ctx.openJournal(selectedCharacterId); } break;
      case 'trace-exchanges': if (confirmDiscard()) { epoch++; await ctx.openExchanges(selectedCharacterId); } break;
      default: return false;
    }
    return true;
  }
  async function submit(form) {
    if (form.id === 'trace-character-form') {
      const id = new FormData(form).get('characterId');
      if (confirmDiscard()) { editor = null; selectedRecordId = null; await open({ characterId: id }); }
      return true;
    }
    if (form.id !== 'trace-record-form') return false;
    if (!editable() || !editor || editor.conflict) throw new Error('Review the latest record and reconnect before saving.');
    capture(); validateDocument();
    if (!dirty()) return true;
    await runMutation(editor.id ? `${base()}/${editor.id}` : base(), editor.id ? 'PUT' : 'POST', { characterId: selectedCharacterId, ...(editor.id ? { version: editor.version } : {}), document: editor.document }, 'save');
    return true;
  }
  function updateDraftIndicator() {
    const label = document.querySelector('#trace-save-status'); if (label) label.textContent = dirty() ? 'Unsaved changes' : editor?.id ? 'Saved to notebook' : 'Private draft · not saved';
    const save = document.querySelector('#trace-record-form button[type="submit"]'); if (save) save.disabled = !editable() || editor?.conflict || !dirty();
    const sourceCount = document.querySelector('#trace-source-count'); if (sourceCount) sourceCount.textContent = editor.document.sources.length;
    const linkCount = document.querySelector('#trace-link-count'); if (linkCount) linkCount.textContent = editor.document.links.length;
  }
  document.addEventListener('input', event => {
    if (state.view !== 'trace') return;
    if (event.target.id === 'trace-search') { query = event.target.value; updateList(); return; }
    if (!event.target.closest('#trace-record-form') || pending) return;
    capture(); updateDraftIndicator();
  });
  document.addEventListener('change', event => {
    if (state.view !== 'trace') return;
    if (event.target.id === 'trace-kind-filter') { kindFilter = event.target.value; updateList(); return; }
    if (event.target.id === 'trace-owner-filter') { ownerFilter = event.target.value; updateList(); return; }
    if (!event.target.closest('#trace-record-form') || pending) return;
    capture();
    if (event.target.name === 'audienceType') {
      editor.document.audience.ids = [];
      const section = document.querySelector('.trace-audience'); section.innerHTML = audienceFields(); section.querySelector('select')?.focus();
    }
    if (event.target.name === 'linkIds') {
      const label = event.target.closest('.trace-link-option')?.querySelector('[data-link-label]'); if (label) label.disabled = !event.target.checked;
    }
    updateDraftIndicator();
  });
  window.addEventListener('beforeunload', event => { capture(); if (dirty() || pending) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('online', () => { if (state.view === 'trace' && board) { capture(); render(); } });
  window.addEventListener('offline', () => { if (state.view === 'trace' && board) { capture(); render(); } });
  return { open, render, action, submit, confirmDiscard, isDirty: () => { capture(); return dirty() || Boolean(pending); }, reset, cleanupModal() {} };
}
