const OPTIONS = [
  ['shareable', 'Shareable'],
  ['restricted', 'Restricted · personal discovery'],
  ['organizer_only', 'Organizer only'],
];
const TYPE_NAMES = { relic: 'Relic', dead_drop: 'Dead drop', cipherbox: 'Cipherbox', wayfinder: 'Wayfinder' };

export function createSharingUI(ctx) {
  const { state, api, shell, esc, loadEvent, toast, isManager, err } = ctx;
  let record = null, draft = new Map(), eventId = null, accountId = null;
  let dirty = false, saving = false, conflict = false, epoch = 0, feedback = '';
  const path = id => `/api/events/${id}/sharing`;
  const scope = () => ({ epoch, eventId: state.event?.id, accountId: state.session?.user?.id });
  const current = value => value.epoch === epoch && value.eventId === state.event?.id && value.accountId === state.session?.user?.id && state.view === 'sharing';
  const editable = () => isManager() && state.event?.status !== 'archived';
  function useRecord(value) {
    record = value;
    draft = new Map(value.nodes.map(node => [node.id, node.policy]));
    dirty = false; conflict = false; feedback = 'Saved to event';
  }
  function capture() {
    if (!record || saving || state.view !== 'sharing') return;
    for (const select of document.querySelectorAll('#sharing-form select[data-node-id]')) draft.set(select.dataset.nodeId, select.value);
    dirty = record.nodes.some(node => draft.get(node.id) !== node.policy);
  }
  function render() {
    if (!record || eventId !== state.event?.id || accountId !== state.session?.user?.id) { shell('<p role="status">Loading sharing permissions…</p>'); return; }
    const locked = !editable() || saving;
    shell(`<div class="actions"><button class="quiet" data-action="sharing-back">← Event briefing</button></div><header class="page-head mt"><div><p class="eyebrow">${esc(state.event.name)} · Organizer tools</p><h1>Sharing permissions.</h1><p class="muted">Choose which discoveries players can pass to each other.</p></div></header><section class="panel sharing-explanation"><p><strong>Shareable</strong> lets players offer a reading they have already discovered. Both players must confirm the exchange.</p><p><strong>Restricted</strong> allows personal discovery, but prevents exchanging the reading.</p><p><strong>Organizer only</strong> hides the instrument from new player discoveries and prevents organizer overrides from releasing it. Organizer authoring and read-only previews remain available.</p><p class="hint">Earlier readings remain in players’ journals. Changing a permission cannot retract information already received. Changes clear both players’ confirmations on pending exchanges, so they must review and confirm again. Sharing a reading does not complete an instrument or grant story progress.</p></section><section class="panel mt"><form id="sharing-form">${err}<div class="panel-head"><h2>Adventure instruments</h2><span id="sharing-save-state" class="save-status" role="status">${esc(saving ? 'Saving…' : feedback || (dirty ? 'Unsaved changes' : 'Saved to event'))}</span></div>${state.event.status === 'archived' ? '<p class="preview-banner">This event is archived. Its sharing permissions are read-only.</p>' : ''}${conflict ? '<p class="preview-banner" role="alert">Another organizer saved permissions. Your choices are retained below. Reload the saved permissions and review them before making further changes.</p>' : ''}<fieldset class="sharing-fields" ${locked ? 'disabled' : ''}><legend>Permission for each instrument</legend>${record.nodes.length ? `<ul class="sharing-list">${record.nodes.map(node => `<li><div><strong>${esc(node.title)}</strong><p class="hint">${esc(TYPE_NAMES[node.type] || node.type)}</p></div><label><span class="sr-only">Permission for ${esc(node.title)}</span><select data-node-id="${esc(node.id)}" name="sharing-${esc(node.id)}">${OPTIONS.map(([value, label]) => `<option value="${value}" ${draft.get(node.id) === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></li>`).join('')}</ul>` : '<p class="hint">Save instruments in the adventure builder to choose their permissions. New instruments start as restricted.</p>'}</fieldset><div class="actions mt"><button type="submit" class="primary" ${locked || conflict || !dirty ? 'disabled' : ''}>Save permissions</button><button type="button" class="quiet" data-action="sharing-reload" ${saving ? 'disabled' : ''}>Reload saved permissions</button></div></form></section>`);
  }
  async function open() {
    if (!isManager()) throw new Error('Only an organizer can manage sharing permissions.');
    if (record && eventId === state.event?.id && accountId === state.session?.user?.id && dirty) { state.view = 'sharing'; render(); return; }
    epoch++;
    state.view = 'sharing';
    const context = scope();
    record = null; render();
    const value = await api(path(context.eventId));
    if (!current(context)) return;
    eventId = context.eventId; accountId = context.accountId; useRecord(value); render();
  }
  function confirmDiscard() {
    if (saving) { toast('Wait for the permissions save to finish.'); return false; }
    capture();
    if (dirty && !window.confirm('Discard unsaved sharing permissions?')) return false;
    if (record) useRecord(record);
    return true;
  }
  async function action(button) {
    const name = button.dataset.action;
    if (!name?.startsWith('sharing-')) return false;
    if (name === 'sharing-open') await open();
    else if (name === 'sharing-back') { if (confirmDiscard()) { epoch++; await loadEvent(state.event.id); } }
    else if (name === 'sharing-reload') { if (confirmDiscard()) { record = null; await open(); } }
    else return false;
    return true;
  }
  async function submit(form) {
    if (form.id !== 'sharing-form') return false;
    if (!editable() || saving || conflict) throw new Error(conflict ? 'Reload saved permissions before editing again.' : 'Sharing permissions are not available for editing.');
    capture();
    if (!dirty) return true;
    const context = scope(), input = { version: record.version, policies: record.nodes.map(node => ({ nodeId: node.id, policy: draft.get(node.id) })) };
    saving = true; feedback = 'Saving…'; render();
    try {
      const value = await api(path(context.eventId), 'PUT', input);
      if (!current(context)) return true;
      saving = false; useRecord(value); render(); toast('Sharing permissions saved.');
    } catch (error) {
      if (!current(context)) return true;
      saving = false; conflict = error.status === 409; feedback = conflict ? 'Not saved · review current permissions' : 'Save not confirmed · choices retained';
      render(); throw error;
    }
    return true;
  }
  function reset() { epoch++; record = null; draft = new Map(); eventId = null; accountId = null; dirty = false; saving = false; conflict = false; feedback = ''; }
  document.addEventListener('change', event => {
    if (!event.target.closest('#sharing-form') || state.view !== 'sharing') return;
    capture(); feedback = dirty ? 'Unsaved changes' : 'Saved to event';
    const status = document.querySelector('#sharing-save-state'); if (status) status.textContent = feedback;
    const save = document.querySelector('#sharing-form button[type="submit"]'); if (save) save.disabled = !dirty || !editable() || saving || conflict;
  });
  window.addEventListener('beforeunload', event => { if (dirty || saving) { event.preventDefault(); event.returnValue = ''; } });
  return { open, render, action, submit, confirmDiscard, isDirty: () => dirty || saving, reset, cleanupModal() {} };
}
