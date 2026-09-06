const clone = value => structuredClone(value);
// JSONB can reorder object keys. These editors contain only unordered selection
// arrays, so compare their values rather than transport ordering.
const comparable = value => JSON.stringify(value, (_key, item) => {
  if (Array.isArray(item)) return item.every(entry => typeof entry === 'string') ? [...item].sort() : item;
  return item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
});
const CONDITION_KEYS = ['completed', 'flags', 'skills', 'statuses'];
const STATUS_NAMES = { draft: 'Draft', submitted: 'Awaiting review', published: 'Published', withdrawn: 'Withdrawn' };
const EMPTY_CONDITIONS = () => ({ completed: [], flags: [], skills: [], statuses: [] });
const EMPTY_DOCUMENT = () => ({ title: '', body: '', sourceLabel: '', topic: '', truth: '', audience: { type: 'private', ids: [] }, conditions: EMPTY_CONDITIONS(), shareable: false, correctionNote: '' });
const nameOf = value => value?.name || value?.profile?.name || 'Character';

export function createStoryUI(ctx) {
  const { state, api, shell, esc, loadEvent, toast, isManager, err } = ctx;
  let dashboard = null, accountId = null, eventId = null, characterId = null, manage = false, epoch = 0;
  let editor = null, savedEditor = null, dirty = false, pending = null, conflict = false, latest = null;
  let feedback = '', feedbackError = false, loading = false, filter = 'all', poster = null;
  const connected = () => navigator.onLine !== false;
  const base = (id = eventId || state.event?.id) => `/api/events/${id}/story`;
  const authored = () => isManager() || state.event?.role === 'staff';
  const instrumentEnabled = id => state.event?.setup?.enabledInstruments?.includes(id) ?? true;
  const playable = () => ['live', 'rehearsal'].includes(dashboard?.event?.status || state.event?.status);
  const canEdit = () => connected() && !pending && (manage ? authored() && state.event?.status !== 'archived' : dashboard?.character && !dashboard.readOnly);
  const canPropose = () => !manage && canEdit() && instrumentEnabled('broadside');
  const scope = () => ({ epoch, accountId, eventId, manage, characterId });
  const current = value => value.epoch === epoch && value.accountId && value.accountId === state.session?.user?.id && value.eventId === state.event?.id && value.manage === manage && value.characterId === characterId && state.view === 'story';
  const date = value => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const disabled = value => value ? 'disabled' : '';
  const field = (name, label, value = '', max = 120, required = false) => `<label>${esc(label)}<input name="${esc(name)}" value="${esc(value)}" maxlength="${max}" ${required ? 'required' : ''}></label>`;
  const area = (name, label, value = '', max = 6000, required = false) => `<label>${esc(label)}<textarea name="${esc(name)}" maxlength="${max}" ${required ? 'required' : ''}>${esc(value)}</textarea></label>`;
  function reset() {
    epoch++; dashboard = null; accountId = null; eventId = null; characterId = null; manage = false;
    editor = null; savedEditor = null; dirty = false; pending = null; conflict = false; latest = null; feedback = ''; feedbackError = false; loading = false; filter = 'all'; poster = null;
  }
  function ensureAccount() {
    const who = state.session?.user?.id || null;
    if (who !== accountId) { reset(); accountId = who; }
    return who;
  }
  function setEditor(value) { editor = value ? clone(value) : null; savedEditor = value ? clone(value) : null; dirty = false; conflict = false; latest = null; feedback = ''; feedbackError = false; }
  function capture() {
    if (!editor || pending || state.view !== 'story') return;
    const form = document.querySelector('#story-entry-form, #story-proposal-form, #story-group-form');
    if (!form || form.dataset.editorKey !== editor.key || form.querySelector('fieldset')?.disabled) return;
    const data = new FormData(form);
    if (editor.type === 'group') {
      editor.name = String(data.get('name') || '');
      editor.characterIds = data.getAll('characterIds').map(String);
    } else {
      const doc = editor.document;
      for (const key of editor.type === 'proposal' ? ['title', 'body'] : ['title', 'body', 'sourceLabel', 'topic', 'truth', 'correctionNote']) doc[key] = String(data.get(key) || '');
      const type = String(data.get('audienceType') || 'private');
      doc.audience = { type, ids: type === 'public' ? [] : data.getAll(`audience-${type}`).map(String) };
      if (editor.type === 'proposal') editor.sourceJournalId = String(data.get('sourceJournalId') || '') || null;
      else {
        doc.shareable = editor.kind === 'rumor' && data.get('shareable') === 'on';
        doc.conditions = Object.fromEntries(CONDITION_KEYS.map(key => [key, data.getAll(`condition-${key}`).map(String)]));
      }
    }
    dirty = comparable(editor) !== comparable(savedEditor);
  }
  function choices(name, selected, options, empty = 'No choices available.') {
    const rows = [...(options || [])];
    for (const id of selected || []) if (!rows.some(row => row.id === id)) rows.push({ id, name: 'Unavailable choice · remove before saving' });
    return rows.length ? `<div class="story-checks">${rows.map(row => `<label class="check-line"><input type="checkbox" name="${esc(name)}" value="${esc(row.id)}" ${(selected || []).includes(row.id) ? 'checked' : ''}><span>${esc(row.name || row.title || 'Unnamed choice')}</span></label>`).join('')}</div>` : `<p class="hint">${esc(empty)}</p>`;
  }
  function audienceFields(audience, proposal = false) {
    const context = manage ? dashboard : dashboard.audiences || {};
    const types = [['public', 'Everyone in this event'], ['faction', 'Selected factions'], ['group', 'Selected groups'], ['private', 'Selected characters']];
    const options = audience.type === 'faction' ? context.factions : audience.type === 'group' ? context.groups : context.characters;
    return `<details class="story-options" data-disclosure="audience" ${audience.type === 'private' && !audience.ids.length ? 'open' : ''}><summary>${proposal ? 'Proposed audience' : 'Who can read this?'} · ${esc(types.find(([type]) => type === audience.type)?.[1] || 'Selected characters')}</summary><label>Audience<select name="audienceType">${types.map(([value, label]) => `<option value="${value}" ${audience.type === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${audience.type === 'public' ? '<p class="hint">Available to approved characters in this event when its conditions pass.</p>' : `<fieldset class="story-choice-group"><legend>${audience.type === 'faction' ? 'Factions' : audience.type === 'group' ? 'Groups' : 'Characters'} · choose up to 20</legend>${choices(`audience-${audience.type}`, audience.ids, options)}${!audience.ids.length ? '<p class="hint">Nobody is selected. A draft can stay private until you choose its readers.</p>' : ''}</fieldset>`}${proposal ? '<p class="hint">Organizers review this audience before publishing your proposal.</p>' : ''}</details>`;
  }
  function conditionsFields(conditions) {
    const config = [['completed', 'Completed discoveries', dashboard.nodes], ['flags', 'Story flags', dashboard.flags], ['skills', 'Character skills', dashboard.skills], ['statuses', 'Event status', dashboard.statuses || ['draft', 'rehearsal', 'live', 'paused', 'ended', 'archived'].map(id => ({ id, name: id[0].toUpperCase() + id.slice(1) }))]];
    const count = CONDITION_KEYS.reduce((sum, key) => sum + (conditions[key]?.length || 0), 0);
    return `<details class="story-options" data-disclosure="conditions"><summary>Discovery conditions · ${count || 'none'}</summary><p class="hint">Every selected discovery, flag, and skill must be present. Any selected event status qualifies. Conditions can reveal an already published account; they never publish a draft automatically.</p>${config.map(([key, label, options]) => `<fieldset class="story-choice-group"><legend>${label} · up to 10</legend>${choices(`condition-${key}`, conditions[key] || [], options)}</fieldset>`).join('')}</details>`;
  }
  function pendingBanner() {
    if (!pending) return '';
    return `<section class="story-banner" role="status"><strong>${pending.sending ? 'Waiting for confirmation…' : 'This action has no confirmed response yet.'}</strong><p>${pending.sending ? 'Your draft is held here while ORACLE checks the result.' : 'Retry sends the same action and recovers its result without creating a second copy.'}</p>${!pending.sending ? `<button type="button" class="primary mt" data-action="story-retry" ${disabled(!connected())}>Retry pending action</button>` : ''}</section>`;
  }
  function saveStatus() { return `<span id="story-save-state" class="save-status" role="status">${pending ? pending.sending ? 'Saving…' : 'Save not confirmed · retry available' : conflict ? 'Not saved · review latest revision' : dirty ? 'Unsaved changes · held in this tab' : editor && !editor.id ? 'New draft · held in this tab' : 'Saved to event'}</span>`; }
  function snapshot(doc, label, open = false) {
    const context = dashboard || {};
    const names = (ids, rows) => ids.map(id => (rows || []).find(row => row.id === id)?.name || (rows || []).find(row => row.id === id)?.title || 'Unavailable choice').map(esc).join(', ') || 'None';
    const audienceRows = doc.audience?.type === 'faction' ? context.factions : doc.audience?.type === 'group' ? context.groups : context.characters;
    const review = open ? `<dl class="story-draft-review"><dt>Audience</dt><dd>${doc.audience?.type === 'public' ? 'Everyone in this event' : names(doc.audience?.ids || [], audienceRows)}</dd><dt>Completed discoveries</dt><dd>${names(doc.conditions?.completed || [], context.nodes)}</dd><dt>Story flags</dt><dd>${names(doc.conditions?.flags || [], context.flags)}</dd><dt>Character skills</dt><dd>${names(doc.conditions?.skills || [], context.skills)}</dd><dt>Event statuses</dt><dd>${names(doc.conditions?.statuses || [], context.statuses)}</dd><dt>Sharing collected readings</dt><dd>${doc.shareable ? 'Allowed' : 'Not allowed'}</dd><dt>Organizer topic</dt><dd>${esc(doc.topic || 'None')}</dd><dt>Organizer truth and notes</dt><dd class="story-copy">${esc(doc.truth || 'None')}</dd></dl>` : '';
    return `<details class="story-options story-snapshot" data-disclosure="${open ? 'conflict' : 'publication'}" ${open ? 'open' : ''}><summary>${esc(label)}</summary><h3>${esc(doc.title)}</h3>${doc.sourceLabel ? `<p class="hint">${esc(doc.sourceLabel)}</p>` : ''}<p class="prose story-copy">${esc(doc.body)}</p>${doc.correctionNote ? `<p class="story-correction"><strong>Correction:</strong> ${esc(doc.correctionNote)}</p>` : ''}${review}</details>`;
  }
  function conflictPanel() {
    if (!conflict) return '';
    return `<section class="story-banner" role="alert"><p>The saved revision changed. Your text is retained. Load the latest revision and review it before saving again.</p>${latest ? `${latest.document ? snapshot(latest.document, 'Latest saved draft · review before replacing', true) : `<p><strong>${esc(latest.name)}</strong> · ${latest.characterIds?.length || 0} characters</p><p>${(latest.characterIds || []).map(id => esc(dashboard.characters.find(character => character.id === id)?.name || 'Unavailable character')).join(', ') || 'No characters selected.'}</p>`}<div class="actions mt"><button type="button" data-action="story-keep-draft">Keep my text for this revision</button><button type="button" class="quiet" data-action="story-use-latest">Use the latest saved ${editor.type === 'group' ? 'group' : 'draft'}</button></div>` : `<button type="button" class="mt" data-action="story-review-conflict" ${disabled(!connected() || pending)}>Load latest for review</button>`}</section>`;
  }
  function entryStatus(entry) {
    const live = entry.hasPublication && entry.status !== 'withdrawn';
    return `<span class="badge">${esc(STATUS_NAMES[entry.status] || 'Draft')}</span>${live && entry.status !== 'published' ? '<span class="badge">Earlier publication remains live</span>' : ''}`;
  }
  function entryEditor() {
    const doc = editor.document, locked = !canEdit(), saved = editor.id ? dashboard.entries.find(entry => entry.id === editor.id) : null;
    const live = saved?.hasPublication && saved.status !== 'withdrawn';
    const hasHistory = Boolean(saved?.published || saved?.publishedVersion || saved?.hasPublication);
    return `<section class="panel story-editor"><form id="story-entry-form" data-editor-key="${esc(editor.key)}">${err}<div class="panel-head"><div><p class="eyebrow">${editor.kind === 'rumor' ? 'WHISPER · unverified account' : 'BROADSIDE · organizer publication'}</p><h2>${editor.id ? 'Edit account' : 'Write an account'}</h2></div>${saveStatus()}</div>${saved ? `<div class="actions mt">${entryStatus(saved)}</div>` : '<p class="hint">This draft is not visible to players.</p>'}${live ? '<p class="story-banner">Players can still read the last publication. Saving changes here prepares a separate draft; Publish makes the reviewed changes visible.</p>' : saved?.status === 'withdrawn' ? '<p class="story-banner">This account is withdrawn. Earlier collected rumors remain in their owners’ journals.</p>' : ''}${conflictPanel()}<fieldset class="story-fields" ${disabled(locked)}><legend>Account draft</legend>${field('title', 'Title', doc.title, 120, true)}${area('body', editor.kind === 'rumor' ? 'The account players hear' : 'The bulletin players read', doc.body, 6000, true)}${field('sourceLabel', 'In-world source · optional', doc.sourceLabel)}${audienceFields(doc.audience)}${conditionsFields(doc.conditions)}${editor.kind === 'rumor' ? `<label class="check-line story-share-choice"><input type="checkbox" name="shareable" ${doc.shareable ? 'checked' : ''}><span>Allow collected readings to be shared through Exchanges</span></label><p class="hint">A shared reading can reach another approved character through an exchange both players confirm, even if that character was outside this publication’s original audience. It remains an unverified account and does not grant story progress.</p>` : ''}<details class="story-options" data-disclosure="truth"><summary>Organizer notes · hidden from players</summary>${field('topic', 'Topic · connect alternate accounts', doc.topic)}${area('truth', 'Underlying truth and running notes', doc.truth)}<p class="hint">Only event staff and organizers can read these fields. They are excluded from player publications and collected readings.</p></details>${hasHistory ? `${area('correctionNote', 'Correction note · required to publish a new revision', doc.correctionNote, 1000)}<p class="hint">The correction note is visible with the new publication. Earlier journal copies keep the text originally collected.</p>` : '<input type="hidden" name="correctionNote" value="">'}</fieldset><div class="actions mt"><button type="submit" class="primary" ${disabled(locked || conflict)}>Save draft</button><button type="button" class="quiet" data-action="story-close-editor" ${disabled(Boolean(pending?.sending))}>Close editor</button></div></form>${saved ? `<section class="story-publish-actions"><h3>Review and publish</h3><p class="hint">${dirty ? 'Save your draft before submitting or publishing it.' : !playable() ? 'You can prepare drafts now. Publication is available while the event is live or in rehearsal.' : isManager() ? 'Review the audience, conditions, and visible text before publishing.' : 'Submit your saved draft for an organizer to review and publish.'}</p><div class="actions mt"><button type="button" data-action="story-submit-entry" ${disabled(locked || dirty || conflict || saved.status === 'submitted')}>Submit for review</button>${isManager() ? `<button type="button" class="primary" data-action="story-publish" ${disabled(locked || dirty || conflict || !playable())}>${hasHistory ? 'Publish corrected revision' : 'Publish'}</button>${live ? `<button type="button" class="quiet danger" data-action="story-withdraw" ${disabled(locked || dirty || conflict)}>Withdraw publication</button>` : ''}` : ''}${editor.kind === 'rumor' ? `<button type="button" class="quiet" data-action="story-alternate" ${disabled(locked || dirty || conflict)}>Write another account</button>` : ''}</div></section>${saved.published ? snapshot(saved.published, `${live ? 'Currently published' : 'Previous publication'} · revision ${saved.publishedVersion}`) : ''}` : ''}</section>`;
  }
  function groupEditor() {
    return `<section class="panel story-editor"><form id="story-group-form" data-editor-key="${esc(editor.key)}">${err}<div class="panel-head"><h2>${editor.id ? 'Edit audience group' : 'New audience group'}</h2>${saveStatus()}</div>${conflictPanel()}<fieldset class="story-fields" ${disabled(!canEdit() || !isManager())}><legend>Audience group</legend>${field('name', 'Group name', editor.name, 120, true)}<fieldset class="story-choice-group"><legend>Characters · up to 100</legend>${choices('characterIds', editor.characterIds, dashboard.characters)}</fieldset><p class="hint">Membership controls who can read group publications and shared investigations. Saving an empty group removes its audience. It does not retract earlier journal copies.</p></fieldset><div class="actions mt"><button type="submit" class="primary" ${disabled(!canEdit() || !isManager() || conflict)}>Save group</button><button type="button" class="quiet" data-action="story-close-editor" ${disabled(Boolean(pending?.sending))}>Close editor</button></div></form></section>`;
  }
  function managerView() {
    const entries = (dashboard.entries || []).filter(entry => filter === 'all' || (filter === 'review' ? entry.status === 'submitted' : entry.kind === filter));
    const list = `<section class="panel story-library"><div class="panel-head"><h2>Accounts and publications</h2><span class="hint">${dashboard.entries.length} / 200</span></div><div class="actions mt"><button type="button" class="primary" data-action="story-new-rumor" ${disabled(!canEdit() || dashboard.entries.length >= 200)}>Write rumor</button><button type="button" data-action="story-new-bulletin" ${disabled(!canEdit() || dashboard.entries.length >= 200)}>Write bulletin</button></div><label class="mt">Show<select id="story-filter"><option value="all" ${filter === 'all' ? 'selected' : ''}>All accounts</option><option value="review" ${filter === 'review' ? 'selected' : ''}>Awaiting review</option><option value="rumor" ${filter === 'rumor' ? 'selected' : ''}>Rumors</option><option value="bulletin" ${filter === 'bulletin' ? 'selected' : ''}>Bulletins</option></select></label><div class="story-entry-list">${entries.length ? entries.map(entry => `<button type="button" class="story-entry-card ${editor?.id === entry.id ? 'selected' : ''}" data-action="story-edit" data-id="${esc(entry.id)}"><span class="eyebrow">${entry.kind === 'rumor' ? 'Rumor' : 'Bulletin'}</span><strong>${esc(entry.document.title)}</strong><span class="story-status-line">${entryStatus(entry)}</span>${entry.document.topic ? `<span class="hint">Topic: ${esc(entry.document.topic)}${entry.kind === 'rumor' && dashboard.entries.filter(other => other.kind === 'rumor' && other.document.topic === entry.document.topic).length > 1 ? ' · alternate accounts' : ''}</span>` : ''}</button>`).join('') : '<p class="hint">No accounts in this view. Write a rumor or bulletin to begin.</p>'}</div></section>`;
    const groups = isManager() ? `<details class="panel story-section" data-disclosure="groups"><summary>Audience groups · ${dashboard.groups.length}</summary><p class="hint">Use a group for a circle, team, or invitation-only audience.</p><div class="story-group-list">${dashboard.groups.map(group => `<button type="button" class="story-entry-card" data-action="story-edit-group" data-id="${esc(group.id)}"><strong>${esc(group.name)}</strong><span class="hint">${group.characterIds.length} characters</span></button>`).join('')}</div><button type="button" class="mt" data-action="story-new-group" ${disabled(!canEdit() || dashboard.groups.length >= 50)}>Create group</button></details>` : '';
    const activityNames = { create: 'Draft created', update: 'Draft saved', submit: 'Submitted for review', publish: 'Published', withdraw: 'Withdrawn', proposal: 'Player proposal submitted', collect: 'Rumor collected', group_create: 'Audience group created', group_update: 'Audience group updated', created: 'Draft created', updated: 'Draft saved', proposed: 'Player proposal submitted', group_updated: 'Audience group saved', reset: 'Rehearsal progress reset' };
    const activity = `<details class="panel story-section" data-disclosure="activity"><summary>Publication activity</summary><p class="hint">The latest recorded authoring and publication changes.</p><ol class="story-activity">${(dashboard.activity || []).map(item => { const entry = dashboard.entries.find(row => row.id === item.entryId); return `<li><strong>${esc(activityNames[item.action] || 'Story updated')}</strong>${entry ? ` · ${esc(entry.document.title)}` : ''}<span class="hint">${esc(date(item.createdAt))}${Number.isInteger(item.version) ? ` · revision ${item.version}` : ''}</span></li>`; }).join('') || '<li class="hint">No publication changes yet.</li>'}</ol></details>`;
    return `${state.event.status === 'archived' ? '<p class="story-banner">This event is archived. Authoring is read-only.</p>' : ''}<div class="story-manager-layout">${list}${editor ? editor.type === 'group' ? groupEditor() : entryEditor() : '<section class="panel story-empty-editor"><h2>Make room for different accounts.</h2><p>Write a rumor to let characters discover one version of events. Use a bulletin for a reviewed organizer publication.</p><p class="hint">Drafts remain hidden until an organizer publishes them. Audiences and conditions decide which characters can see each publication.</p></section>'}</div>${groups}${activity}`;
  }
  function characterPicker() {
    if (!dashboard.characters?.length) return '<section class="empty"><h2>Your character comes first.</h2><p>You need an approved character assigned to you to collect rumors and read event news.</p><button type="button" class="primary" data-action="character-open">Open characters</button></section>';
    return `<form id="story-character-form" class="story-character-picker">${err}<label>Reading as<select name="characterId">${dashboard.characters.map(character => `<option value="${esc(character.id)}" ${character.id === characterId ? 'selected' : ''}>${esc(nameOf(character))}</option>`).join('')}</select></label><button type="submit" ${disabled(Boolean(pending))}>Use character</button></form>`;
  }
  function proposalEditor() {
    return `<section class="panel story-editor story-section"><form id="story-proposal-form" data-editor-key="${esc(editor.key)}">${err}<div class="panel-head"><h2>Propose a bulletin</h2>${saveStatus()}</div><p class="story-banner">Your proposal goes to event staff and organizers for review. It is not published until an organizer approves it.</p><fieldset class="story-fields" ${disabled(!canPropose())}><legend>Player proposal</legend>${field('title', 'Proposed headline', editor.document.title, 120, true)}${area('body', 'What you want to report', editor.document.body, 6000, true)}${audienceFields(editor.document.audience, true)}<details class="story-options" data-disclosure="source"><summary>Supporting journal reading · optional</summary><label>Reference a reading<select name="sourceJournalId"><option value="">No supporting reading</option>${(dashboard.readings || []).filter(reading => reading.type !== 'exchange_receipt').map(reading => `<option value="${esc(reading.id)}" ${editor.sourceJournalId === reading.id ? 'selected' : ''}>${esc(reading.title)}</option>`).join('')}</select></label><p class="hint">This is a private reference for the proposal. No journal text is copied automatically. Write only the information you intend to submit in the report above.</p></details></fieldset><div class="actions mt"><button type="submit" class="primary" ${disabled(!canPropose() || conflict)}>Send for review</button><button type="button" class="quiet" data-action="story-close-editor" ${disabled(Boolean(pending?.sending))}>Cancel proposal</button></div></form></section>`;
  }
  function bulletinCard(item) {
    return `<article class="story-publication"><p class="eyebrow">BROADSIDE · organizer publication</p><h3>${esc(item.title)}</h3>${item.sourceLabel ? `<p class="hint">${esc(item.sourceLabel)}</p>` : ''}<p class="hint">Revision ${item.publicationVersion}${item.publishedAt ? ` · ${esc(date(item.publishedAt))}` : ''}</p><p class="prose story-copy">${esc(item.body)}</p>${item.correctionNote ? `<p class="story-correction"><strong>Correction:</strong> ${esc(item.correctionNote)}</p>` : ''}<button type="button" class="quiet mt" data-action="story-poster" data-id="${esc(item.id)}">Open poster</button></article>`;
  }
  function playerView() {
    const rumors = dashboard.rumors || [], bulletins = dashboard.bulletins || [], readings = dashboard.readings || [];
    const rumorPanel = instrumentEnabled('whisper') ? `<section class="panel"><div class="panel-head"><div><p class="eyebrow">WHISPER</p><h2>Rumors to discover</h2></div></div><p class="hint">These are unverified accounts. Collect one to hear it and keep a reading in your journal.</p><div class="story-rumors">${rumors.length ? rumors.map(item => `<article class="story-rumor"><div><h3>${esc(item.title)}</h3>${item.sourceLabel ? `<p class="hint">${esc(item.sourceLabel)}</p>` : ''}</div><button type="button" data-action="story-collect" data-id="${esc(item.id)}" ${disabled(!canEdit() || item.collected)}>${item.collected ? 'Saved to journal' : 'Collect rumor'}</button></article>`).join('') : '<p class="hint">No new rumors are available to your character right now.</p>'}</div></section>` : '';
    const newsPanel = instrumentEnabled('broadside') ? `<section class="panel"><div class="panel-head"><div><p class="eyebrow">BROADSIDE</p><h2>Event news</h2></div></div>${bulletins.length ? `<div class="story-bulletins">${bulletins.map(bulletinCard).join('')}</div>` : '<p class="hint mt">There are no published bulletins for your character right now.</p>'}<button type="button" class="mt" data-action="story-propose" ${disabled(!canPropose())}>Propose a bulletin</button></section>` : '';
    const history = readings.length || instrumentEnabled('whisper') ? `<section class="panel story-section"><div class="panel-head"><h2>Collected accounts</h2><button type="button" class="quiet" data-action="story-journal">Open full journal</button></div><p class="hint">Personal readings preserve what you heard at the time. They may conflict with later accounts and do not establish the underlying truth.</p><div class="story-readings">${readings.length ? readings.map(reading => `<details class="story-reading"><summary>${esc(reading.title)}</summary><p class="eyebrow mt">WHISPER · unverified account</p><p class="prose story-copy">${esc(reading.text)}</p>${reading.createdAt ? `<p class="hint">Collected ${esc(date(reading.createdAt))}</p>` : ''}</details>`).join('') : '<p class="hint mt">Collect a rumor to keep its account here.</p>'}</div><p class="hint mt">Use Exchanges to pass along a collected reading when its organizer allows sharing.</p><button type="button" class="quiet" data-action="story-exchanges">Open exchanges</button></section>` : '';
    return `${characterPicker()}${dashboard.character ? `${dashboard.readOnly ? '<p class="story-banner">Reading is available. Collecting and sending proposals require a live event or rehearsal.</p>' : ''}<div class="story-player-columns ${!rumorPanel || !newsPanel ? 'story-single-column' : ''}">${rumorPanel}${newsPanel}${!rumorPanel && !newsPanel ? '<p class="hint">Rumors and news are turned off for this event.</p>' : ''}</div>${editor?.type === 'proposal' ? proposalEditor() : ''}${history}` : ''}`;
  }
  function render() {
    ensureAccount();
    if (state.view !== 'story') return;
    if (!dashboard || dashboard.event?.id !== state.event?.id) { shell(`<section class="story-workspace"><button type="button" class="quiet" data-action="story-event">← Event briefing</button><p role="status" class="mt">${loading ? 'Loading rumors and news…' : 'Open the event to load rumors and news.'}</p>${feedback ? `<p role="alert">${esc(feedback)}</p><button type="button" data-action="story-refresh">Try again</button>` : ''}</section>`); return; }
    const disclosures = new Map([...document.querySelectorAll('.story-workspace details[data-disclosure]')].map(element => [element.dataset.disclosure, element.open]));
    const content = connected() ? manage ? managerView() : playerView() : '<section class="empty"><h2>Reconnect for current rumors and news.</h2><p>Publication audiences and availability are checked when you connect. Collected adventure readings remain available in your saved journal.</p><button type="button" data-action="offline-open">Open saved readings</button></section>';
    shell(`<section class="story-workspace"><div class="actions"><button type="button" class="quiet" data-action="story-event">← Event briefing</button>${authored() ? `<button type="button" class="quiet" data-action="${manage ? 'story-open' : 'story-manage'}">${manage ? 'Read as my character' : 'Manage rumors and news'}</button>` : ''}</div><header class="page-head mt"><div><p class="eyebrow">${esc(dashboard.event.name)}${manage ? ' · Organizer tools' : ''}</p><h1>${manage ? 'Shape the accounts.' : 'Rumors & news'}</h1><p class="muted">${manage ? 'Prepare conflicting accounts, review reports, and publish to the right audience.' : 'Hear what is circulating. Read what has been published.'}</p></div><button type="button" data-action="story-refresh" ${disabled(!connected() || Boolean(pending))}>Refresh</button></header>${pendingBanner()}${feedback ? `<p class="story-feedback ${feedbackError ? 'error' : ''}" role="${feedbackError ? 'alert' : 'status'}">${esc(feedback)}</p>` : ''}${content}</section>${poster ? `<section class="story-poster-view"><div class="actions story-print-controls"><button type="button" data-action="story-close-poster">Close poster</button><button type="button" class="primary" data-action="story-print">Print poster</button></div><article id="story-poster"><p class="eyebrow">${esc(dashboard.event.name)} · BROADSIDE</p><h1>${esc(poster.title)}</h1>${poster.sourceLabel ? `<p class="hint">${esc(poster.sourceLabel)}</p>` : ''}<p class="prose story-copy">${esc(poster.body)}</p>${poster.correctionNote ? `<p class="story-correction"><strong>Correction:</strong> ${esc(poster.correctionNote)}</p>` : ''}<p class="hint mt">Organizer publication · revision ${poster.publicationVersion}</p></article></section>` : ''}`);
    for (const element of document.querySelectorAll('.story-workspace details[data-disclosure]')) if (disclosures.has(element.dataset.disclosure)) element.open = disclosures.get(element.dataset.disclosure);
    if (poster) document.querySelector('#story-poster')?.scrollIntoView?.({ block: 'start' });
  }
  async function fetchDashboard(context) {
    return api(`${base(context.eventId)}/${context.manage ? 'manage' : `play${context.characterId ? `?${new URLSearchParams({ characterId: context.characterId })}` : ''}`}`);
  }
  function useDashboard(result) {
    dashboard = result; eventId = result.event.id;
    if (!manage) characterId = result.character?.id || null;
    if (state.event?.id === result.event.id && result.event.status) state.event.status = result.event.status;
  }
  function clearAuthorRevocation(error, confirmedMessage = '') {
    if (!manage || error.status !== 403 || error.message !== 'Only event staff can author or review story entries.') return false;
    epoch++; dashboard = null; setEditor(null); pending = null; poster = null; loading = false;
    feedback = `${confirmedMessage ? `${confirmedMessage} ` : ''}Your event role no longer gives access to publication tools. Return to the event briefing to continue.`;
    feedbackError = true; render(); return true;
  }
  async function open(options = {}) {
    ensureAccount();
    if (state.view === 'story' && !confirmDiscard()) return;
    const id = state.event?.id; if (!id) throw new Error('Open an event before reading rumors and news.');
    if (options.manage && !authored()) throw new Error('Only event staff and organizers can manage publications.');
    epoch++; eventId = id; manage = Boolean(options.manage); characterId = options.characterId || (!manage && dashboard?.event.id === id ? characterId : null);
    setEditor(null); dashboard = null; pending = null; poster = null; loading = true; state.view = 'story';
    const context = scope(); render();
    try { const result = await fetchDashboard(context); if (!current(context)) return; useDashboard(result); loading = false; render(); }
    catch (error) { if (!current(context)) return; loading = false; feedback = error.message; feedbackError = true; render(); }
  }
  async function refresh() {
    capture();
    if (pending) { toast('Resolve the pending action before refreshing.'); return; }
    epoch++; const context = scope();
    try {
      const result = await fetchDashboard(context); if (!current(context)) return;
      useDashboard(result);
      if (editor?.id) {
        const found = (editor.type === 'group' ? dashboard.groups : dashboard.entries).find(row => row.id === editor.id);
        if (!found) { editor = null; savedEditor = null; dirty = false; feedback = 'This saved item is no longer available.'; }
        else if (found.version !== editor.version) {
          if (dirty) { conflict = true; latest = found; feedback = 'The saved revision changed. Your draft is retained for review.'; }
          else setEditor(editor.type === 'group' ? groupDraft(found) : entryDraft(found));
        }
      }
      feedback ||= 'Rumors and news refreshed.'; feedbackError = false; poster = null; render();
    } catch (error) {
      if (!current(context)) return;
      if (clearAuthorRevocation(error)) return;
      if ([401, 403, 404].includes(error.status)) { dashboard = null; setEditor(null); }
      feedback = error.message; feedbackError = true; render();
    }
  }
  function entryDraft(entry) { return { type: 'entry', key: entry.id, id: entry.id, kind: entry.kind, version: entry.version, document: clone(entry.document) }; }
  function groupDraft(group) { return { type: 'group', key: group.id, id: group.id, version: group.version, name: group.name, characterIds: clone(group.characterIds) }; }
  function confirmedResult(record, result) {
    if (record.kind === 'entry' || record.kind === 'entry-action') {
      if (result.entry) {
        const index = dashboard.entries.findIndex(entry => entry.id === result.entry.id);
        if (index < 0) dashboard.entries.unshift(result.entry); else dashboard.entries[index] = result.entry;
        setEditor(entryDraft(result.entry));
      }
      feedback = record.action === 'publish' ? 'Publication confirmed.' : record.action === 'withdraw' ? 'Publication withdrawn. Earlier collected accounts remain in their journals.' : record.action === 'submit' ? 'Submitted for organizer review.' : 'Draft saved. Publication is a separate step.';
    } else if (record.kind === 'group') {
      if (result.group) {
        const index = dashboard.groups.findIndex(group => group.id === result.group.id);
        if (index < 0) dashboard.groups.push(result.group); else dashboard.groups[index] = result.group;
        setEditor(groupDraft(result.group));
      }
      feedback = 'Audience group saved.';
    } else if (record.kind === 'collect') {
      if (result.reading && !dashboard.readings.some(reading => reading.id === result.reading.id)) dashboard.readings.unshift(result.reading);
      const rumor = dashboard.rumors.find(item => item.id === record.body.entryId); if (rumor) rumor.collected = true;
      feedback = 'Rumor collected and saved to your journal. It remains an unverified account.';
    } else if (record.kind === 'proposal') { setEditor(null); feedback = 'Your bulletin was submitted for organizer review. It has not been published.'; }
    feedbackError = false;
  }
  async function mutate(path, method, body, options = {}) {
    ensureAccount(); capture();
    if (!connected()) { feedback = 'Reconnect before saving or collecting.'; feedbackError = true; render(); return; }
    if (pending && !options.retry) { toast('Retry the pending action before starting another.'); return; }
    const request = options.retry ? pending : { path, method, body: { ...clone(body), requestId: crypto.randomUUID() }, kind: options.kind, action: options.action, sending: false };
    if (!request || request.sending) return;
    epoch++; const context = scope(); request.sending = true; pending = request; feedback = ''; feedbackError = false; render();
    try {
      const result = await api(request.path, request.method, request.body); if (!current(context)) return;
      pending = null; confirmedResult(request, result);
      const confirmedMessage = feedback;
      try { const refreshed = await fetchDashboard(context); if (!current(context)) return; useDashboard(refreshed); }
      catch (error) {
        if (!current(context)) return;
        if (clearAuthorRevocation(error, confirmedMessage)) return;
        if ([401, 403, 404].includes(error.status)) { dashboard = null; setEditor(null); }
        feedback = `${confirmedMessage} Refresh to load the latest view.`;
      }
      if (current(context)) { render(); toast(confirmedMessage); }
    } catch (error) {
      if (!current(context)) return;
      if (clearAuthorRevocation(error)) return;
      request.sending = false;
      if (error.status >= 400 && error.status < 500) { pending = null; conflict = error.status === 409 && Boolean(editor?.id); latest = null; }
      feedback = pending ? 'The response was interrupted. Your text is retained; retry the same action to check its result.' : `${error.message}${editor ? ' Your draft is retained.' : ''}`;
      feedbackError = true; render();
    }
  }
  function confirmDiscard(scopeName) {
    if (scopeName === 'modal') return true;
    capture();
    if (pending?.sending) { toast('Wait for the current action to finish.'); return false; }
    if (pending && !window.confirm('This action may already have saved. Leave and discard its retry information and any unsaved draft?')) return false;
    if (!pending && dirty && !window.confirm('Discard your unsaved story draft?')) return false;
    if (pending || dirty) { pending = null; if (savedEditor) editor = clone(savedEditor); else editor = null; dirty = false; conflict = false; latest = null; }
    return true;
  }
  async function reviewConflict() {
    if (!editor?.id || pending) return;
    epoch++; const context = scope();
    try {
      const result = await fetchDashboard(context); if (!current(context)) return;
      useDashboard(result); latest = (editor.type === 'group' ? dashboard.groups : dashboard.entries).find(item => item.id === editor.id) || null;
      if (!latest) { feedback = 'This item is no longer available. Your draft is retained until you leave this editor.'; feedbackError = true; }
      render();
    } catch (error) { if (current(context) && !clearAuthorRevocation(error)) { feedback = error.message; feedbackError = true; render(); } }
  }
  async function action(button) {
    const name = button.dataset.action; if (!name?.startsWith('story-')) return false;
    capture();
    if (name === 'story-open' || name === 'story-manage') await open({ manage: name === 'story-manage', characterId: button.dataset.characterId });
    else if (name === 'story-event') { if (confirmDiscard()) { epoch++; await loadEvent(state.event.id); } }
    else if (name === 'story-refresh') await refresh();
    else if (name === 'story-retry') await mutate(null, null, null, { retry: true });
    else if (name === 'story-close-editor') { if (confirmDiscard()) { setEditor(null); render(); } }
    else if (name === 'story-new-rumor' || name === 'story-new-bulletin') {
      if (canEdit() && manage && confirmDiscard()) { setEditor({ type: 'entry', key: crypto.randomUUID(), id: null, kind: name === 'story-new-rumor' ? 'rumor' : 'bulletin', version: null, document: EMPTY_DOCUMENT() }); render(); }
    } else if (name === 'story-edit') {
      const entry = dashboard?.entries?.find(item => item.id === button.dataset.id);
      if (entry && confirmDiscard()) { setEditor(entryDraft(entry)); render(); }
    } else if (name === 'story-alternate') {
      if (editor?.kind === 'rumor' && canEdit() && confirmDiscard()) { const document = clone(editor.document); document.title = ''; document.correctionNote = ''; setEditor({ type: 'entry', key: crypto.randomUUID(), id: null, kind: 'rumor', version: null, document }); render(); }
    } else if (name === 'story-new-group') {
      if (manage && isManager() && canEdit() && confirmDiscard()) { setEditor({ type: 'group', key: crypto.randomUUID(), id: null, version: null, name: '', characterIds: [] }); render(); }
    } else if (name === 'story-edit-group') {
      const group = dashboard?.groups?.find(item => item.id === button.dataset.id);
      if (group && isManager() && confirmDiscard()) { setEditor(groupDraft(group)); render(); }
    } else if (name === 'story-propose') {
      if (canPropose() && confirmDiscard()) { const document = EMPTY_DOCUMENT(); document.audience.ids = [characterId]; setEditor({ type: 'proposal', key: crypto.randomUUID(), id: null, document, sourceJournalId: null }); render(); documentQueryFocus('#story-proposal-form input[name="title"]'); }
    } else if (name === 'story-collect') {
      const rumor = dashboard?.rumors?.find(item => item.id === button.dataset.id);
      if (rumor && !rumor.collected && canEdit()) await mutate(`${base()}/collect`, 'POST', { characterId, entryId: rumor.id, publicationVersion: rumor.publicationVersion }, { kind: 'collect' });
    } else if (['story-submit-entry', 'story-publish', 'story-withdraw'].includes(name)) {
      if (!editor?.id || !canEdit() || dirty || conflict) { feedback = 'Save and review your draft before this step.'; feedbackError = true; render(); return true; }
      const verb = name === 'story-submit-entry' ? 'submit' : name === 'story-publish' ? 'publish' : 'withdraw';
      if (verb !== 'submit' && !isManager()) return true;
      if (verb === 'withdraw' && !window.confirm('Withdraw this publication from future reading and collection? Earlier collected readings will remain in players’ journals.')) return true;
      await mutate(`${base()}/entries/${editor.id}/${verb}`, 'POST', { version: editor.version }, { kind: 'entry-action', action: verb });
    } else if (name === 'story-review-conflict') await reviewConflict();
    else if (name === 'story-keep-draft' && latest && editor) {
      const draft = clone(editor); const latestDraft = editor.type === 'group' ? groupDraft(latest) : entryDraft(latest);
      draft.version = latest.version; savedEditor = latestDraft; editor = draft; conflict = false; latest = null; dirty = comparable(editor) !== comparable(savedEditor); feedback = 'Your draft now targets the reviewed revision. Save when you are ready.'; feedbackError = false; render();
    } else if (name === 'story-use-latest' && latest && editor) { setEditor(editor.type === 'group' ? groupDraft(latest) : entryDraft(latest)); render(); }
    else if (name === 'story-journal') { if (confirmDiscard()) { epoch++; await ctx.openJournal(characterId); } }
    else if (name === 'story-exchanges') { if (confirmDiscard()) { epoch++; await ctx.openExchanges(characterId); } }
    else if (name === 'story-poster') { const bulletin = dashboard?.bulletins?.find(item => item.id === button.dataset.id); if (bulletin && !manage) { poster = clone(bulletin); render(); } }
    else if (name === 'story-close-poster') { poster = null; render(); }
    else if (name === 'story-print') { if (poster && !manage) window.print(); }
    else return false;
    return true;
  }
  async function submit(form) {
    if (form.id === 'story-character-form') { const selected = String(new FormData(form).get('characterId') || ''); if (confirmDiscard()) await open({ characterId: selected }); return true; }
    if (!['story-entry-form', 'story-group-form', 'story-proposal-form'].includes(form.id)) return false;
    capture(); if (!editor || !canEdit() || conflict) return true;
    if (editor.type === 'entry') await mutate(`${base()}/entries${editor.id ? `/${editor.id}` : ''}`, editor.id ? 'PUT' : 'POST', editor.id ? { version: editor.version, document: clone(editor.document) } : { kind: editor.kind, document: clone(editor.document) }, { kind: 'entry' });
    else if (editor.type === 'group' && isManager()) await mutate(`${base()}/groups${editor.id ? `/${editor.id}` : ''}`, editor.id ? 'PUT' : 'POST', { ...(editor.id ? { version: editor.version } : {}), name: editor.name, characterIds: clone(editor.characterIds) }, { kind: 'group' });
    else if (editor.type === 'proposal' && canPropose()) await mutate(`${base()}/proposals`, 'POST', { characterId, title: editor.document.title, body: editor.document.body, sourceJournalId: editor.sourceJournalId, audience: clone(editor.document.audience) }, { kind: 'proposal' });
    return true;
  }
  function documentQueryFocus(selector) { document.querySelector(selector)?.focus(); }
  function changed(event) {
    if (state.view !== 'story' || !event.target.closest('#story-entry-form, #story-proposal-form, #story-group-form')) return;
    capture();
    const indicator = document.querySelector('#story-save-state'); if (indicator) indicator.textContent = dirty ? 'Unsaved changes · held in this tab' : editor?.id ? 'Saved to event' : 'New draft · held in this tab';
    if (event.type === 'change' && event.target.name === 'audienceType') { render(); documentQueryFocus('select[name="audienceType"]'); }
    for (const button of document.querySelectorAll('[data-action="story-submit-entry"], [data-action="story-publish"], [data-action="story-withdraw"], [data-action="story-alternate"]')) {
      const saved = dashboard?.entries?.find(entry => entry.id === editor?.id);
      button.disabled = !canEdit() || dirty || conflict || button.dataset.action === 'story-publish' && !playable() || button.dataset.action === 'story-submit-entry' && saved?.status === 'submitted';
    }
  }
  document.addEventListener('input', changed);
  document.addEventListener('change', event => { changed(event); if (event.target.id === 'story-filter' && state.view === 'story') { capture(); filter = event.target.value; render(); } });
  window.addEventListener('beforeunload', event => { capture(); if (dirty || pending) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('offline', () => { if (state.view === 'story') { capture(); poster = null; render(); } });
  window.addEventListener('online', () => { if (state.view === 'story') render(); });
  return { open, render, action, submit, confirmDiscard, isDirty: () => { capture(); return dirty || Boolean(pending); }, reset, cleanupModal() {} };
}
