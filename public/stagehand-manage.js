import { defaultStagehandDocument } from './stagehand-model.js';

const clone = value => structuredClone(value);
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const encounterFingerprint = value => canonical({ ...value, staffUserIds: [...value.staffUserIds].sort() });
const partyFingerprint = value => canonical({ ...value, characterIds: [...value.characterIds].sort() });
const stateLabel = value => ({ planning: 'Planning', open: 'Open', paused: 'Paused', cancelled: 'Cancelled', ended: 'Ended', waiting: 'Waiting for dispatch', dispatched: 'Dispatched', returned: 'Returned' })[value] || value || 'Unavailable';
const date = value => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not dispatched';

/** Manager presentation only. The main controller owns requests, retries and account scope. */
export function createStagehandManager(ctx) {
  const { esc, getDashboard, writable, mutate, render: redraw, toast, openStory } = ctx;
  let selectedId = null, editor = null, decision = null, filter = 'active', draftEpoch = 0, selectCreated = false;
  const dashboard = () => getDashboard() || {};
  const encounters = () => dashboard().encounters || [];
  const parties = () => dashboard().parties || [];
  const encounter = id => encounters().find(row => row.id === id);
  const selected = () => encounter(selectedId);
  const party = id => parties().find(row => row.id === id);
  const disabled = value => value ? 'disabled' : '';
  const canManage = () => Boolean(dashboard().canManage && writable());
  const canOperate = () => Boolean(dashboard().canOperate && writable());
  const canReview = () => writable() || dashboard().event?.status === 'archived';
  const activeParty = row => ['waiting', 'dispatched'].includes(row.status);
  const canEnqueue = row => Boolean(canOperate() && !dashboard().readOnly && row?.document.nodeId && !['ended', 'cancelled'].includes(row.state) && ['live', 'rehearsal'].includes(dashboard().event?.status));
  const targetOf = value => value?.target === 'party' ? party(value.id) : encounter(value?.id);
  const draftFingerprint = () => editor ? (editor.type === 'encounter' ? encounterFingerprint : partyFingerprint)(editor.document) : '';
  function reset() { selectedId = null; editor = null; decision = null; filter = 'active'; selectCreated = false; draftEpoch++; }
  function capture() {
    const form = document.querySelector('#sgm-editor-form');
    if (editor && form?.dataset.draftKey === editor.key && !form.querySelector('fieldset')?.disabled) {
      const values = new FormData(form);
      if (editor.type === 'encounter') editor.document = { title: String(values.get('title') || ''), nodeId: String(values.get('nodeId') || '') || null, publicMessage: String(values.get('publicMessage') || ''), staffNotes: String(values.get('staffNotes') || ''), capacity: Number(values.get('capacity')), returnMinutes: Number(values.get('returnMinutes')), staffUserIds: values.getAll('staffUserIds').map(String), checks: [...form.querySelectorAll('[data-sgm-check]')].map(row => ({ id: row.dataset.sgmCheck, label: row.querySelector('[data-check-field="label"]').value, kind: row.querySelector('[data-check-field="kind"]').value })) };
      else editor.document = { encounterId: String(values.get('encounterId') || ''), name: String(values.get('name') || ''), returnMinutes: Number(values.get('returnMinutes')), characterIds: values.getAll('characterIds').map(String) };
    }
    const control = document.querySelector('#sgm-decision-form');
    if (decision && control?.dataset.draftKey === decision.key && !control.querySelector('fieldset')?.disabled) {
      const values = new FormData(control);
      if (decision.kind === 'announcement') { decision.title = String(values.get('title') || ''); decision.body = String(values.get('body') || ''); }
      else decision.reason = String(values.get('reason') || '');
      decision.acknowledged = values.get('acknowledged') === 'on';
    }
  }
  function isDirty() { capture(); return Boolean(editor && draftFingerprint() !== editor.baseline || decision && (decision.kind === 'announcement' ? decision.title !== decision.originalTitle || Boolean(decision.body) : Boolean(decision.reason) || decision.acknowledged)); }
  function confirmDiscard() {
    if (isDirty() && !window.confirm('Discard your unsaved STAGEHAND configuration or staff action?')) return false;
    editor = null; decision = null; draftEpoch++; return true;
  }
  function applyDashboard(next) {
    capture();
    const rows = next.encounters || [], partyRows = next.parties || [];
    if (selectCreated && rows.some(row => row.id === next.outcome?.targetId)) selectedId = next.outcome.targetId;
    selectCreated = false;
    if (!rows.some(row => row.id === selectedId)) selectedId = rows[0]?.id || null;
    if (editor) {
      if (editor.type === 'encounter' && !next.canManage) editor = null;
      else if (editor.id) {
        const row = (editor.type === 'encounter' ? rows : partyRows).find(item => item.id === editor.id);
        if (!row) editor = null;
        else if (editor.conflict || row.version !== editor.version) { editor.conflict = true; editor.latest = clone(row); }
      } else if (editor.type === 'party' && !rows.some(row => row.id === editor.document.encounterId)) editor = null;
    }
    if (decision) {
      const row = (decision.target === 'party' ? partyRows : rows).find(item => item.id === decision.id);
      if (!row) decision = null;
      else if (decision.stale || row.version !== decision.version) { decision.stale = true; decision.latest = clone(row); decision.acknowledged = false; }
    }
  }
  function mutationSucceeded(kind) { selectCreated = kind === 'manager-encounter-create'; editor = null; decision = null; draftEpoch++; }
  function markConflict() { capture(); if (editor?.id) { editor.conflict = true; editor.latest = null; } if (decision) { decision.stale = true; decision.latest = null; decision.acknowledged = false; } }
  function beginEditor(type, row = null, destination = null) {
    let document;
    if (type === 'encounter') document = row ? clone(row.document) : defaultStagehandDocument();
    else document = row ? { encounterId: row.encounterId, name: row.name, returnMinutes: row.returnMinutes, characterIds: row.members.map(member => member.characterId) } : { encounterId: destination?.id || selectedId || '', name: '', returnMinutes: destination?.document.returnMinutes || 15, characterIds: [] };
    editor = { type, id: row?.id || null, key: `${++draftEpoch}-${crypto.randomUUID()}`, version: row?.version || null, document, baseline: (type === 'encounter' ? encounterFingerprint : partyFingerprint)(document), conflict: false, latest: null };
    decision = null;
  }
  function beginDecision(target, row, kind, extra = {}) {
    const title = kind === 'announcement' ? `${row.document.title}: scene update`.slice(0, 120) : '';
    decision = { target, id: row.id, version: row.version, key: `${++draftEpoch}-${crypto.randomUUID()}`, kind, reason: '', title, originalTitle: title, body: '', acknowledged: false, stale: false, latest: null, ...extra };
    editor = null;
  }
  function fieldOptions(rows, value, placeholder = null) {
    const choices = [...rows]; if (value && !choices.some(row => row.id === value)) choices.push({ id: value, name: 'Unavailable choice · select another' });
    return `${placeholder !== null ? `<option value="">${esc(placeholder)}</option>` : ''}${choices.map(row => `<option value="${esc(row.id)}" ${row.id === value ? 'selected' : ''}>${esc(row.name || row.title || row.id)}</option>`).join('')}`;
  }
  function namesFor(ids, rows) { return ids.map(id => rows.find(row => row.id === id)?.name || rows.find(row => row.id === id)?.title || 'Unavailable person').join(', ') || 'None assigned'; }
  function encounterReview(row) {
    const doc = row.document, node = dashboard().context?.nodes?.find(item => item.id === doc.nodeId);
    return `<section class="stagehand-manager-review"><h3>${esc(doc.title)} · Revision ${row.version}</h3><p><strong>Scene:</strong> ${esc(node?.title || (doc.nodeId ? 'Unavailable linked scene' : 'Not linked'))}</p><p><strong>State:</strong> ${esc(stateLabel(row.state))} · ${row.attendanceCount || 0} occupied seats / capacity ${row.capacity || doc.capacity} · Return window ${doc.returnMinutes} minutes</p><p><strong>Assigned staff:</strong> ${esc(namesFor(doc.staffUserIds, dashboard().context?.staff || []))}</p><p class="stagehand-copy">${esc(doc.publicMessage)}</p><details><summary>Readiness checks and staff notes</summary><ul>${doc.checks.map(check => `<li>${esc(check.kind)} · ${esc(check.label)}</li>`).join('') || '<li>No checks configured.</li>'}</ul><p class="stagehand-copy">${esc(doc.staffNotes || 'No staff notes.')}</p></details></section>`;
  }
  function partyReview(row) {
    return `<section class="stagehand-manager-review"><h3>${esc(row.name)} · Revision ${row.version}</h3><p>${esc(encounter(row.encounterId)?.document.title || 'Unavailable encounter')} · ${esc(stateLabel(row.status))} · Return window ${row.returnMinutes} minutes</p><p>Terms revision ${row.termsVersion || 1} · ${row.acceptedCount || 0} of ${row.memberCount || row.members?.length || 0} accepted</p>${memberList(row)}</section>`;
  }
  function conflictView() {
    if (!editor?.conflict) return '';
    const latest = editor.latest, editable = editor.type === 'encounter' ? latest?.canEdit : latest?.canRevise;
    return `<section class="stagehand-manager-notice" role="alert"><h3>The saved ${editor.type === 'encounter' ? 'encounter' : 'party'} changed.</h3><p>Your draft is retained. Review the current version before choosing how to continue.</p>${latest ? `${editor.type === 'encounter' ? encounterReview(latest) : partyReview(latest)}<div class="actions mt"><button type="button" data-action="stagehand-m-use-latest">Use latest saved version</button><button type="button" data-action="stagehand-m-keep-draft" ${disabled(!editable || !writable())}>Keep my draft for this revision</button></div>${!editable ? '<p class="hint">This record can no longer be revised in its current state.</p>' : ''}` : '<p class="hint">Refresh STAGEHAND to load the latest version for review.</p>'}</section>`;
  }
  function staffChoices(ids) {
    const rows = [...(dashboard().context?.staff || [])];
    for (const id of ids) if (!rows.some(row => row.id === id)) rows.push({ id, name: 'Unavailable staff member · remove before saving' });
    return rows.length ? `<div class="stagehand-member-choices">${rows.map(row => `<label class="check-line"><input type="checkbox" name="staffUserIds" value="${esc(row.id)}" ${ids.includes(row.id) ? 'checked' : ''}><span>${esc(row.name)}</span></label>`).join('')}</div>` : '<p class="hint">No staff members are available. Add staff or organizers through the event briefing.</p>';
  }
  function encounterEditor() {
    const doc = editor.document, nodes = dashboard().context?.nodes || [], linked = nodes.find(row => row.id === doc.nodeId), existing = editor.id ? encounter(editor.id) : null;
    const allowed = canManage() && (!existing || existing.canEdit);
    return `<section class="panel stagehand-manager-form"><div class="panel-head"><h2>${editor.id ? 'Configure encounter' : 'Create encounter'}</h2><span id="sgm-save-state" class="save-status" role="status">${isDirty() ? 'Unsaved changes · held in this tab' : editor.id ? 'Saved configuration' : 'New encounter'}</span></div><p class="stagehand-manager-notice">Linking a WAYFINDER scene puts STAGEHAND in charge of admission. Players need a dispatched party to join that scene. Existing attendance remains counted. Saving configuration clears readiness acknowledgments.</p>${conflictView()}<form id="sgm-editor-form" data-draft-key="${esc(editor.key)}"><fieldset class="stagehand-manager-fields" ${disabled(!allowed)}><legend>Encounter configuration</legend><label>Encounter title<input name="title" maxlength="120" value="${esc(doc.title)}" required></label><label>WAYFINDER scene<select name="nodeId">${fieldOptions(nodes, doc.nodeId, 'Not linked · prepare without changing admission')}</select></label><p id="sgm-node-limit" class="hint">${linked ? `${esc(linked.location || 'No location set')} · WAYFINDER maximum ${linked.maxPlayers} players. Its story conditions and time window still apply.` : 'Choose a scene to enable party dispatch. Unlinked preparation does not change the existing adventure route.'}</p><div class="stagehand-two-fields"><label>Encounter capacity<input name="capacity" type="number" min="1" max="${linked?.maxPlayers || 100}" step="1" value="${doc.capacity}" required></label><label>Default return window · minutes<input name="returnMinutes" type="number" min="1" max="480" step="1" value="${doc.returnMinutes}" required></label></div><label>Public scene message<textarea name="publicMessage" maxlength="1200" rows="3">${esc(doc.publicMessage)}</textarea></label><details open><summary>Assigned staff · up to 20</summary><p class="hint">Assigned staff can acknowledge checks, operate this encounter and its parties, and prepare announcements. Managers can operate every encounter.</p>${staffChoices(doc.staffUserIds)}</details><section><h3>Readiness checklist · ${doc.checks.length} of 20</h3><p class="hint">Every check must be acknowledged before opening. The staff member who performs the acknowledgment is recorded.</p><div class="stagehand-check-editor">${doc.checks.map((check, index) => `<fieldset data-sgm-check="${esc(check.id)}"><legend>Check ${index + 1}</legend><label>What must be ready?<input data-check-field="label" maxlength="120" value="${esc(check.label)}" required></label><label>Check kind<select data-check-field="kind">${[['performer', 'Performer'], ['prop', 'Prop'], ['staff', 'Staff / check-in']].map(([kind, label]) => `<option value="${kind}" ${check.kind === kind ? 'selected' : ''}>${label}</option>`).join('')}</select></label><button type="button" class="quiet" data-action="stagehand-m-remove-check" data-id="${esc(check.id)}">Remove check ${index + 1}</button></fieldset>`).join('')}</div><button type="button" class="mt" data-action="stagehand-m-add-check" ${disabled(doc.checks.length >= 20)}>Add readiness check</button></section><details><summary>Private operational notes</summary><label>Notes for managers and assigned staff<textarea name="staffNotes" rows="5" maxlength="3000">${esc(doc.staffNotes)}</textarea></label><p class="hint">These notes are never copied into a player view or announcement.</p></details></fieldset><div class="actions mt"><button type="submit" class="primary" ${disabled(!allowed || editor.conflict)}>Save configuration</button><button type="button" class="quiet" data-action="stagehand-m-close-editor">Close editor</button></div></form></section>`;
  }
  function characterChoices(ids) {
    const choices = [...(dashboard().context?.characters || [])];
    for (const id of ids) if (!choices.some(row => row.id === id)) choices.push({ id, name: 'Unavailable character · remove before saving', unavailable: true });
    return choices.length ? `<div class="stagehand-member-choices">${choices.map(row => {
      const other = parties().find(item => item.id !== editor.id && activeParty(item) && item.members?.some(member => member.characterId === row.id));
      return `<label class="check-line"><input type="checkbox" name="characterIds" value="${esc(row.id)}" ${ids.includes(row.id) ? 'checked' : ''} ${disabled(Boolean(other) && !ids.includes(row.id))}><span>${esc(row.name)}${other ? ` · Already ${esc(stateLabel(other.status).toLowerCase())}` : ''}</span></label>`;
    }).join('')}</div>` : '<p class="hint">No approved, assigned characters are available. Prepare characters from the event briefing.</p>';
  }
  function partyEditor() {
    const doc = editor.document, row = editor.id ? party(editor.id) : null, destinations = encounters().filter(item => item.document.nodeId && !['ended', 'cancelled'].includes(item.state));
    const allowed = canOperate() && !dashboard().readOnly && (!row || row.canRevise) && ['live', 'rehearsal'].includes(dashboard().event?.status);
    return `<section class="panel stagehand-manager-form"><div class="panel-head"><h2>${editor.id ? 'Revise or redirect party' : 'Create a waiting party'}</h2><span id="sgm-save-state" class="save-status" role="status">${isDirty() ? 'Unsaved changes · held in this tab' : editor.id ? 'Saved party' : 'New waiting party'}</span></div><p class="stagehand-manager-notice">${editor.id ? 'Revising the destination, name, members, or return window clears every member’s consent. The entire waiting party moves together; dispatched parties cannot be redirected.' : 'Queueing does not reserve seats. Each player must accept their current party details before staff can dispatch the whole group.'}</p>${conflictView()}<form id="sgm-editor-form" data-draft-key="${esc(editor.key)}"><fieldset class="stagehand-manager-fields" ${disabled(!allowed)}><legend>Party details</legend><label>Party name<input name="name" maxlength="120" value="${esc(doc.name)}" required></label><label>Destination encounter<select name="encounterId" required>${fieldOptions(destinations.map(item => ({ id: item.id, name: `${item.document.title} · ${stateLabel(item.state)}` })), doc.encounterId, 'Choose an encounter')}</select></label><label>Return window after dispatch · minutes<input name="returnMinutes" type="number" min="1" max="480" step="1" value="${doc.returnMinutes}" required></label><fieldset><legend>Party members · 1 to 20 characters</legend><p class="hint">Each character can have one waiting or dispatched assignment in this event. Players answer for their own characters.</p>${characterChoices(doc.characterIds)}</fieldset></fieldset><div class="actions mt"><button type="submit" class="primary" ${disabled(!allowed || editor.conflict)}>${editor.id ? 'Save revised party' : 'Create waiting party'}</button><button type="button" class="quiet" data-action="stagehand-m-close-editor">Close editor</button></div></form></section>`;
  }
  function memberList(row) {
    return `<ul class="stagehand-party-members">${(row.members || []).map(member => `<li><strong>${esc(member.name)}</strong><span class="hint">${member.eligible === false ? 'No longer eligible · resolve before dispatch' : member.response === 'accepted' && (!member.responseTermsVersion || member.responseTermsVersion === row.termsVersion) ? 'Accepted current terms' : member.response === 'declined' ? 'Declined' : 'Awaiting response'}${member.respondedAt ? ` · ${esc(date(member.respondedAt))}` : ''}</span></li>`).join('')}</ul>`;
  }
  function decisionAllowed(value = decision, row = targetOf(value)) {
    if (!value || !row || !canOperate()) return false;
    if (value.kind === 'check') return Boolean(row.canCheck);
    if (value.kind === 'announcement') return Boolean(row.canAnnounce);
    if (value.kind === 'state') return Boolean(row[({ open: 'canOpen', paused: 'canPause', cancelled: 'canCancel', ended: 'canEnd' })[value.state]]);
    return Boolean(row[({ dispatch: 'canDispatch', return: 'canReturn', cancel: 'canCancel' })[value.kind]]);
  }
  function decisionView() {
    if (!decision) return '';
    const row = targetOf(decision); if (!row) return '';
    const labels = { check: decision.ready ? 'Acknowledge readiness' : 'Mark check not ready', state: ({ open: 'Open encounter', paused: 'Pause encounter', cancelled: 'Cancel encounter', ended: 'End encounter' })[decision.state], dispatch: 'Dispatch whole party', return: 'Acknowledge party return', cancel: 'Cancel party assignment', announcement: 'Prepare public announcement' };
    const consequences = decision.kind === 'state' ? ({ open: 'Opening permits dispatch only while all checks, story conditions, event status, time window, and capacity allow it.', paused: 'Pausing closes admission. Dispatched parties keep their seats and absolute return times.', cancelled: 'Cancellation is terminal and closes admission. Waiting parties stay queued for staff to redirect or explicitly cancel. Dispatched seats remain occupied until staff acknowledge return or cancellation.', ended: 'Ending is terminal and closes admission. Waiting parties stay queued for staff to redirect or explicitly cancel. Dispatched seats remain occupied until staff acknowledge return or cancellation.' })[decision.state] : decision.kind === 'dispatch' ? 'This reserves seats for the entire party. The server checks every current acceptance, member’s eligibility, story conditions, and remaining capacity together.' : decision.kind === 'return' ? 'Confirm the group has returned. Its reserved seats are released; attendance that existed before dispatch is preserved.' : decision.kind === 'cancel' ? 'Confirm staff have accounted for this group. Cancelling releases this assignment’s reserved seats and preserves attendance that predated dispatch.' : decision.kind === 'check' ? `${decision.ready ? 'Record that this check is ready.' : 'Marking a check not ready closes admission without removing dispatched parties.'} This acknowledgment is attributed to your signed-in staff account.` : 'This creates a submitted BROADSIDE draft. An organizer must review and publish it. Later encounter changes make the linked announcement stale until a replacement is approved.';
    return `<section class="stagehand-manager-form stagehand-manager-decision"><h3>${esc(labels[decision.kind])}</h3><p class="stagehand-manager-notice">${esc(consequences)}</p>${decision.kind === 'check' ? `<p><strong>${esc(row.document.checks.find(check => check.id === decision.checkId)?.label || 'Unavailable check')}</strong></p>` : ''}${decision.target === 'party' ? partyReview(row) : `<p><strong>${esc(row.document.title)}</strong> · ${esc(stateLabel(row.state))} · Revision ${row.version}</p>`}${decision.stale ? `<section class="stagehand-manager-notice" role="alert"><h4>This record changed.</h4><p>Your ${decision.kind === 'announcement' ? 'announcement draft' : 'reason'} is retained. Review the current details before applying it to a newer revision.</p>${decision.latest ? `${decision.target === 'party' ? partyReview(decision.latest) : encounterReview(decision.latest)}<button type="button" class="mt" data-action="stagehand-m-review-current" ${disabled(!decisionAllowed(decision, decision.latest))}>Use this reviewed revision</button>` : '<p class="hint">Refresh STAGEHAND to load the latest version.</p>'}</section>` : ''}<form id="sgm-decision-form" data-draft-key="${esc(decision.key)}"><fieldset class="stagehand-manager-fields" ${disabled(!canOperate())}><legend>${decision.kind === 'announcement' ? 'Public announcement draft' : 'Staff confirmation'}</legend>${decision.kind === 'announcement' ? `<label>Public title<input name="title" maxlength="120" value="${esc(decision.title)}" required></label><label>Public announcement text<textarea name="body" maxlength="6000" rows="6" required>${esc(decision.body)}</textarea></label><p class="hint">Write only information intended for players. Private operational notes are kept separate.</p>` : `<label>Reason or staff observation<textarea name="reason" maxlength="2000" rows="3" required>${esc(decision.reason)}</textarea></label>`}<label class="check-line"><input type="checkbox" name="acknowledged" ${decision.acknowledged ? 'checked' : ''} required ${disabled(decision.stale)}><span>${decision.kind === 'announcement' ? 'I reviewed this text for public release and understand it needs organizer approval.' : 'I reviewed the current details and confirm this staff action.'}</span></label></fieldset><div class="actions mt"><button type="submit" class="primary" ${disabled(!decisionAllowed() || decision.stale)}>${decision.kind === 'announcement' ? 'Submit for organizer review' : 'Confirm staff action'}</button><button type="button" class="quiet" data-action="stagehand-m-close-decision">Close action</button></div></form></section>`;
  }
  function checkList(row) {
    return `<section class="stagehand-checklist"><h3>Readiness checks</h3>${row.document.checks.length ? row.document.checks.map(check => {
      const current = row.readiness?.find(item => item.checkId === check.id), ready = Boolean(current?.ready);
      return `<div class="stagehand-check-row"><div><strong>${esc(check.label)}</strong><span class="hint">${esc(({ performer: 'Performer', prop: 'Prop', staff: 'Staff / check-in' })[check.kind])} · ${ready ? 'Ready' : 'Not ready'}</span>${current?.actorName ? `<span class="hint">${esc(current.actorName)} · ${esc(date(current.at))}</span>` : ''}${current?.reason ? `<p class="stagehand-copy">${esc(current.reason)}</p>` : ''}</div><button type="button" data-action="stagehand-m-check" data-id="${esc(check.id)}" data-ready="${!ready}" ${disabled(!canOperate() || !row.canCheck)}>${ready ? 'Mark not ready' : 'Acknowledge ready'}</button></div>`;
    }).join('') : '<p class="hint">No readiness checks are configured. Managers can add performer, prop, and staff checks.</p>'}</section>`;
  }
  function sceneView(row) {
    if (!row) return '<section class="panel stagehand-scene"><h2>Prepare an encounter.</h2><p>Configure a scene, assign staff, and define the readiness checks before opening party dispatch.</p></section>';
    const doc = row.document, node = dashboard().context?.nodes?.find(item => item.id === doc.nodeId), checked = (row.readiness || []).filter(item => item.ready).length;
    return `<article class="panel stagehand-scene"><div class="panel-head"><div><p class="eyebrow">Encounter operations</p><h2>${esc(doc.title)}</h2></div><span class="badge">${esc(stateLabel(row.state))}</span></div><p>${esc(node?.title || (doc.nodeId ? 'Linked scene unavailable' : 'No WAYFINDER scene linked'))}${node?.location ? ` · ${esc(node.location)}` : ''}</p><div class="stagehand-scene-stats"><p><strong>${row.attendanceCount || 0} / ${row.capacity || doc.capacity}</strong><span class="hint"> occupied seats</span></p><p><strong>${checked} / ${doc.checks.length}</strong><span class="hint"> readiness checks acknowledged</span></p><p><strong>${doc.returnMinutes} min</strong><span class="hint"> default return window</span></p></div><p class="stagehand-manager-notice" role="status">${esc(row.reason || (row.available ? 'Admission is open, subject to each party’s eligibility and available space.' : 'Admission is currently closed.'))}</p>${doc.publicMessage ? `<p class="stagehand-copy">${esc(doc.publicMessage)}</p>` : ''}<div class="actions mt">${dashboard().canManage ? `<button type="button" data-action="stagehand-m-edit-encounter" ${disabled(!writable() || !row.canEdit)}>Configure encounter</button>` : ''}${[['open', 'Open', row.canOpen], ['paused', 'Pause', row.canPause], ['cancelled', 'Cancel encounter', row.canCancel], ['ended', 'End encounter', row.canEnd]].map(([state, label, permission]) => `<button type="button" class="${state === 'open' ? 'primary' : 'quiet'}" data-action="stagehand-m-state" data-state="${state}" ${disabled(!canOperate() || !permission)}>${label}</button>`).join('')}</div>${checkList(row)}<details class="mt" data-stagehand-disclosure="staff-${esc(row.id)}"><summary>Staff preparation</summary><p><strong>Assigned staff:</strong> ${esc(namesFor(doc.staffUserIds, dashboard().context?.staff || []))}</p><p class="stagehand-copy">${esc(doc.staffNotes || 'No private operational notes.')}</p></details><details class="mt" data-stagehand-disclosure="announcement-${esc(row.id)}"><summary>Public scene announcements</summary><p class="hint">Staff submit a BROADSIDE draft. Managers approve publication separately. A later encounter revision makes earlier linked announcements stale.</p>${row.announcement ? `<p><strong>${esc(row.announcement.title)}</strong> · ${esc(row.announcement.status)}${row.announcement.current ? ' · Matches current encounter revision' : ' · Out of date; prepare a replacement'}</p>` : '<p class="hint">No announcement has been prepared for this encounter.</p>'}<div class="actions mt"><button type="button" data-action="stagehand-m-announcement" ${disabled(!canOperate() || !row.canAnnounce)}>Prepare announcement</button>${dashboard().canManage && openStory ? '<button type="button" class="quiet" data-action="stagehand-m-story">Open BROADSIDE review</button>' : ''}</div></details>${decision?.target === 'encounter' ? decisionView() : ''}</article>`;
  }
  function partyCard(row) {
    return `<article class="stagehand-party-card" data-party-id="${esc(row.id)}"><div class="panel-head"><h3>${esc(row.name)}</h3><span class="badge">${esc(stateLabel(row.status))}</span></div><p class="hint">${esc(encounter(row.encounterId)?.document.title || 'Unavailable encounter')} · Terms revision ${row.termsVersion || 1}</p><p><strong>${row.acceptedCount || 0} / ${row.memberCount || row.members?.length || 0}</strong> accepted current party details</p>${row.dispatchedAt ? `<p>Dispatched ${esc(date(row.dispatchedAt))}</p><p class="${row.overdue && row.status === 'dispatched' ? 'stagehand-overdue' : ''}"><strong>${row.overdue && row.status === 'dispatched' ? 'Overdue · ' : ''}Return by ${esc(date(row.returnBy))}</strong></p>${row.status === 'dispatched' ? `<p data-stagehand-returnby="${esc(row.returnBy)}" class="hint">${row.overdue ? 'Return time has passed. Staff must acknowledge the return.' : 'Return window is active.'}</p><p class="hint">Seats stay reserved until staff acknowledge return or cancellation. The return time does not release seats automatically.</p>` : ''}` : `<p class="hint">Return window: ${row.returnMinutes} minutes after confirmed dispatch. Waiting does not reserve seats.</p>`}${row.blockedReason ? `<p class="stagehand-manager-notice">${esc(row.blockedReason)}</p>` : ''}<details data-stagehand-disclosure="party-${esc(row.id)}"><summary>Members and responses</summary>${memberList(row)}</details><div class="actions mt">${row.status === 'waiting' ? `<button type="button" data-action="stagehand-m-edit-party" data-id="${esc(row.id)}" ${disabled(!canOperate() || !row.canRevise)}>Revise / redirect</button><button type="button" class="primary" data-action="stagehand-m-party-action" data-id="${esc(row.id)}" data-operation="dispatch" ${disabled(!canOperate() || !row.canDispatch)}>Dispatch whole party</button>` : ''}${row.status === 'dispatched' ? `<button type="button" class="primary" data-action="stagehand-m-party-action" data-id="${esc(row.id)}" data-operation="return" ${disabled(!canOperate() || !row.canReturn)}>Acknowledge return</button>` : ''}${activeParty(row) ? `<button type="button" class="quiet" data-action="stagehand-m-party-action" data-id="${esc(row.id)}" data-operation="cancel" ${disabled(!canOperate() || !row.canCancel)}>Cancel assignment</button>` : ''}</div>${decision?.target === 'party' && decision.id === row.id ? decisionView() : ''}</article>`;
  }
  function queueView() {
    const row = selected(), visible = parties().filter(item => {
      if (filter === 'all') return true;
      if (filter === 'active') return activeParty(item);
      if (filter === 'overdue') return item.status === 'dispatched' && item.overdue;
      return item.status === filter;
    });
    return `<section class="panel stagehand-queue"><div class="panel-head"><h2>Party queue & returns</h2><button type="button" class="primary" data-action="stagehand-m-new-party" ${disabled(!canEnqueue(row))}>Create waiting party</button></div><p class="hint">${dashboard().canManage ? 'All event parties are shown.' : 'Parties for your assigned encounters are shown.'} New parties use the selected encounter. Redirecting always moves the whole waiting party.</p><label>Show parties<select id="sgm-party-filter">${[['active', 'Waiting and dispatched'], ['waiting', 'Waiting for dispatch'], ['dispatched', 'Dispatched'], ['overdue', 'Overdue'], ['all', 'All, including completed']].map(([value, label]) => `<option value="${value}" ${filter === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><div class="stagehand-party-list">${visible.map(partyCard).join('') || '<p class="hint mt">No parties match this view.</p>'}</div></section>`;
  }
  function activityView() {
    return `<details class="panel stagehand-activity mt" data-stagehand-disclosure="activity"><summary>Recent operational activity · ${dashboard().activity?.length || 0}</summary><ol>${(dashboard().activity || []).map(item => `<li><strong>${esc((item.action || 'Updated').replace(/^stagehand\./, '').replaceAll('_', ' ').replaceAll('.', ' · '))}</strong><span class="hint">${esc(item.actorName || 'Staff')} · ${esc(date(item.at))}${item.encounterId ? ` · ${esc(encounter(item.encounterId)?.document.title || 'Encounter')}` : ''}</span>${item.reason ? `<p class="stagehand-copy">${esc(item.reason)}</p>` : ''}</li>`).join('') || '<li class="hint">No operational actions have been recorded.</li>'}</ol></details>`;
  }
  function render() {
    const rows = encounters(); if (!selectedId && rows.length) selectedId = rows[0].id;
    return `<section class="stagehand-manager"><section class="panel stagehand-manager-selection"><div class="panel-head"><h2>${dashboard().canManage ? 'Event operations' : 'Assigned encounter operations'}</h2>${dashboard().canManage ? `<button type="button" class="primary" data-action="stagehand-m-new-encounter" ${disabled(!canManage() || rows.length >= 100)}>Create encounter</button>` : ''}</div>${rows.length ? `<label class="mt">Selected encounter<select id="sgm-encounter-select" ${disabled(!canReview())}>${fieldOptions(rows.map(row => ({ id: row.id, name: `${row.document.title} · ${stateLabel(row.state)}` })), selectedId)}</select></label>` : `<p class="hint">${dashboard().canManage ? 'Create an encounter to prepare readiness checks and party dispatch.' : 'No encounters are currently assigned to your staff account. Ask an organizer to assign you.'}</p>`}<p class="hint mt">${dashboard().canManage ? 'Managers configure encounters and can operate every scene.' : 'Your operations are limited to encounters assigned to you.'} Readiness and return acknowledgments record the signed-in staff member.</p></section><div class="stagehand-manage-grid">${editor ? editor.type === 'encounter' ? encounterEditor() : partyEditor() : sceneView(selected())}${queueView()}</div>${activityView()}</section>`;
  }
  async function action(button) {
    const name = button.dataset.action; if (!name?.startsWith('stagehand-m-')) return false;
    capture(); const row = selected();
    if (name === 'stagehand-m-new-encounter') { if (canManage() && encounters().length < 100 && confirmDiscard()) { beginEditor('encounter'); redraw(); } }
    else if (name === 'stagehand-m-edit-encounter') { if (canManage() && row?.canEdit && confirmDiscard()) { beginEditor('encounter', row); redraw(); } }
    else if (name === 'stagehand-m-close-editor' || name === 'stagehand-m-close-decision') { if (canReview() && confirmDiscard()) redraw(); }
    else if (name === 'stagehand-m-add-check') { if (editor?.type === 'encounter' && canManage() && editor.document.checks.length < 20) { editor.document.checks.push({ id: `check-${crypto.randomUUID().slice(0, 8)}`, label: '', kind: 'staff' }); redraw(); } }
    else if (name === 'stagehand-m-remove-check') { if (editor?.type === 'encounter' && canManage()) { editor.document.checks = editor.document.checks.filter(item => item.id !== button.dataset.id); redraw(); } }
    else if (name === 'stagehand-m-new-party') { if (canEnqueue(row) && confirmDiscard()) { beginEditor('party', null, row); redraw(); } }
    else if (name === 'stagehand-m-edit-party') { const target = party(button.dataset.id); if (canOperate() && target?.canRevise && confirmDiscard()) { beginEditor('party', target); redraw(); } }
    else if (name === 'stagehand-m-check') { const check = row?.document.checks.find(item => item.id === button.dataset.id); if (canOperate() && row?.canCheck && check && confirmDiscard()) { beginDecision('encounter', row, 'check', { checkId: check.id, ready: button.dataset.ready === 'true' }); redraw(); } }
    else if (name === 'stagehand-m-state') { const target = button.dataset.state, permission = ({ open: 'canOpen', paused: 'canPause', cancelled: 'canCancel', ended: 'canEnd' })[target]; if (canOperate() && permission && row?.[permission] && confirmDiscard()) { beginDecision('encounter', row, 'state', { state: target }); redraw(); } }
    else if (name === 'stagehand-m-party-action') { const target = party(button.dataset.id), operation = button.dataset.operation, permission = ({ dispatch: 'canDispatch', return: 'canReturn', cancel: 'canCancel' })[operation]; if (canOperate() && target?.[permission] && confirmDiscard()) { beginDecision('party', target, operation); redraw(); } }
    else if (name === 'stagehand-m-announcement') { if (canOperate() && row?.canAnnounce && confirmDiscard()) { beginDecision('encounter', row, 'announcement'); redraw(); } }
    else if (name === 'stagehand-m-story') { if (dashboard().canManage && openStory && confirmDiscard()) await openStory(); }
    else if (name === 'stagehand-m-use-latest') { if (editor?.latest && writable()) { const latest = editor.latest, type = editor.type; if (type === 'encounter' ? latest.canEdit : latest.canRevise) beginEditor(type, latest); else editor = null; redraw(); } }
    else if (name === 'stagehand-m-keep-draft') { const latest = editor?.latest; if (latest && writable() && (editor.type === 'encounter' ? latest.canEdit : latest.canRevise)) { editor.version = latest.version; editor.baseline = editor.type === 'encounter' ? encounterFingerprint(latest.document) : partyFingerprint({ encounterId: latest.encounterId, name: latest.name, returnMinutes: latest.returnMinutes, characterIds: latest.members.map(member => member.characterId) }); editor.latest = null; editor.conflict = false; redraw(); } }
    else if (name === 'stagehand-m-review-current') { if (decision?.latest && decisionAllowed(decision, decision.latest)) { decision.version = decision.latest.version; decision.latest = null; decision.stale = false; decision.acknowledged = false; redraw(); } }
    else return false;
    return true;
  }
  async function submit(form) {
    if (!['sgm-editor-form', 'sgm-decision-form'].includes(form.id)) return false;
    capture(); if (!writable() || !form.reportValidity()) return true;
    if (form.id === 'sgm-editor-form') {
      if (!editor || editor.conflict) return true;
      if (editor.type === 'encounter') {
        const target = editor.id ? encounter(editor.id) : null; if (!canManage() || target && !target.canEdit) return true;
        if (editor.document.staffUserIds.length > 20) { toast('Choose at most 20 assigned staff members.'); return true; }
        const linked = dashboard().context?.nodes?.find(row => row.id === editor.document.nodeId);
        if (linked && editor.document.capacity > linked.maxPlayers) { toast('Encounter capacity must fit the linked WAYFINDER scene.'); return true; }
        await mutate(`/encounters${editor.id ? `/${editor.id}` : ''}`, editor.id ? 'PUT' : 'POST', { document: clone(editor.document), ...(editor.id ? { version: editor.version } : {}) }, editor.id ? 'manager-encounter-update' : 'manager-encounter-create');
      } else {
        const target = editor.id ? party(editor.id) : null; if (!canOperate() || dashboard().readOnly || target && !target.canRevise) return true;
        if (!editor.document.characterIds.length || editor.document.characterIds.length > 20) { toast('Choose one to twenty party members.'); return true; }
        await mutate(`/parties${editor.id ? `/${editor.id}` : ''}`, editor.id ? 'PUT' : 'POST', { ...clone(editor.document), ...(editor.id ? { version: editor.version } : {}) }, editor.id ? 'manager-party-update' : 'manager-party-create');
      }
    } else {
      if (!decision || decision.stale || !decision.acknowledged || !decisionAllowed()) return true;
      const row = targetOf(decision); if (row.version !== decision.version) { decision.stale = true; decision.latest = clone(row); decision.acknowledged = false; redraw(); return true; }
      const path = decision.target === 'party' ? `/parties/${decision.id}/${decision.kind}` : `/encounters/${decision.id}/${decision.kind}`;
      const body = { version: decision.version, ...(decision.kind === 'announcement' ? { title: decision.title, body: decision.body } : { reason: decision.reason }), ...(decision.kind === 'check' ? { checkId: decision.checkId, ready: decision.ready } : {}), ...(decision.kind === 'state' ? { state: decision.state } : {}) };
      await mutate(path, 'POST', body, `manager-${decision.kind}`);
    }
    return true;
  }
  function changed(event) {
    if (!event.target.closest('#sgm-editor-form, #sgm-decision-form')) return;
    capture(); const indicator = document.querySelector('#sgm-save-state'); if (indicator) indicator.textContent = isDirty() ? 'Unsaved changes · held in this tab' : editor?.id ? 'Saved configuration' : 'New draft';
    if (event.target.name === 'nodeId' && editor?.type === 'encounter') {
      const node = dashboard().context?.nodes?.find(row => row.id === editor.document.nodeId), capacity = document.querySelector('#sgm-editor-form [name="capacity"]'), label = document.querySelector('#sgm-node-limit');
      if (capacity) capacity.max = String(node?.maxPlayers || 100);
      if (label) label.textContent = node ? `${node.location || 'No location set'} · WAYFINDER maximum ${node.maxPlayers} players. Its story conditions and time window still apply.` : 'Choose a scene to enable party dispatch. Unlinked preparation does not change the existing adventure route.';
    }
  }
  document.addEventListener('input', changed);
  document.addEventListener('change', event => {
    changed(event);
    if (event.target.id === 'sgm-encounter-select') { const previous = selectedId; if (canReview() && confirmDiscard()) { selectedId = event.target.value; redraw(); } else event.target.value = previous || ''; }
    if (event.target.id === 'sgm-party-filter') { capture(); filter = event.target.value; redraw(); }
  });
  return { render, action, submit, capture, isDirty, confirmDiscard, reset, applyDashboard, mutationSucceeded, markConflict };
}
