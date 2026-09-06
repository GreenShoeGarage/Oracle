import { createStagehandManager } from './stagehand-manage.js';

const clone = value => structuredClone(value);
const partyName = status => ({ waiting: 'Waiting for dispatch', dispatched: 'Dispatched', returned: 'Return acknowledged', cancelled: 'Cancelled' })[status] || status;
const responseName = response => ({ accepted: 'Accepted', declined: 'Declined' })[response] || 'Your response is needed';
const date = value => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
const activeParty = row => ['waiting', 'dispatched'].includes(row.status);

export function createStagehandUI(ctx) {
  const { state, api, shell, esc, toast, loadEvent, err = '' } = ctx;
  let dashboard = null, eventId = null, accountId = null, characterId = null, manage = false, epoch = 0;
  let pending = null, decision = null, selectedEncounterId = null, loading = false, stale = false, feedback = '', feedbackError = false;
  let refreshedAt = 0, serverAt = 0, refreshTimer = null, clockTimer = null, refreshing = false, focusMode = false;
  const connected = () => navigator.onLine !== false;
  const disabled = condition => condition ? 'disabled' : '';
  const base = (id = eventId) => `/api/events/${id}/stagehand`;
  const scope = () => ({ epoch, accountId, eventId, characterId, manage });
  const current = context => context.epoch === epoch && context.accountId && context.accountId === state.session?.user?.id && context.eventId === state.event?.id && context.manage === manage && state.view === 'stagehand';
  const writable = () => Boolean(connected() && !stale && !pending && !loading && dashboard && dashboard.event.status !== 'archived');
  const manager = createStagehandManager({ esc, err, getDashboard: () => dashboard, writable, mutate, render, toast, openStory });

  function stopTimers() { clearInterval(refreshTimer); clearInterval(clockTimer); refreshTimer = null; clockTimer = null; }
  function exitFocus() {
    const hadFocus = focusMode; focusMode = false; document.body.classList.remove('stagehand-focus');
    if (hadFocus && document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
  }
  function cleanupModal() { manager.cleanupModal?.(); }
  function reset() {
    epoch++; stopTimers(); exitFocus(); manager.reset(); cleanupModal(); dashboard = null; eventId = null; accountId = null; characterId = null; manage = false;
    pending = null; decision = null; selectedEncounterId = null; loading = false; stale = false; feedback = ''; feedbackError = false; refreshedAt = 0; serverAt = 0; refreshing = false;
  }
  function ensureAccount() { const who = state.session?.user?.id || null; if (who !== accountId) { reset(); accountId = who; } return who; }
  function capture() {
    if (state.view !== 'stagehand' || pending) return;
    manager.capture();
    const form = document.querySelector('#stagehand-response-form');
    if (decision && form?.dataset.partyId === decision.party.id) decision.acknowledged = Boolean(form.querySelector('[name="acknowledged"]')?.checked);
  }
  function dirty() { return Boolean(manager.isDirty() || decision); }
  function reviewing() { return dirty() || Boolean(document.activeElement?.closest('#sgm-editor-form, #sgm-decision-form, #stagehand-response-form')); }
  function applyDashboard(result) {
    dashboard = result; eventId = result.event.id; if (!manage) characterId = result.character?.id || null;
    serverAt = new Date(result.serverTime).getTime(); if (!Number.isFinite(serverAt)) serverAt = Date.now(); refreshedAt = performance.now(); stale = false;
    if (state.event?.id === eventId) { state.event.status = result.event.status; if (result.event.version) state.event.version = result.event.version; if (result.event.role) state.event.role = result.event.role; }
    if (decision) {
      const latest = result.parties?.find(row => row.id === decision.party.id);
      if (!latest || latest.version !== decision.party.version || !latest.canRespond) { decision.stale = true; decision.acknowledged = false; }
    }
    manager.applyDashboard(result);
  }
  async function readDashboard(context = scope()) { return api(`${base(context.eventId)}${context.manage ? '/manage' : context.characterId ? `?${new URLSearchParams({ characterId: context.characterId })}` : ''}`); }
  function readError(error) {
    stale = true; feedback = error.message || 'The current scene state could not be confirmed. Reconnect and refresh.'; feedbackError = true;
    if ([401, 403, 404].includes(error.status)) { dashboard = null; decision = null; manager.reset(); pending = null; exitFocus(); }
  }
  async function open(options = {}) {
    ensureAccount(); if (state.view === 'stagehand' && !confirmDiscard()) return;
    if (!state.event?.id) throw new Error('Open an event before opening STAGEHAND.');
    const id = state.event.id, chosen = options.characterId || (!options.manage && eventId === id ? characterId : null);
    stopTimers(); exitFocus(); cleanupModal(); manager.reset(); epoch++; eventId = id; characterId = chosen; manage = Boolean(options.manage); selectedEncounterId = options.encounterId || null;
    dashboard = null; pending = null; decision = null; loading = true; refreshing = false; stale = false; feedback = ''; feedbackError = false; state.view = 'stagehand';
    const context = scope(); render();
    try { const result = await readDashboard(context); if (!current(context)) return; applyDashboard(result); loading = false; render(); if (selectedEncounterId) document.querySelector(`[data-stagehand-scene="${selectedEncounterId}"]`)?.scrollIntoView?.({ block: 'nearest' }); }
    catch (error) { if (!current(context)) return; loading = false; readError(error); render(); }
  }
  async function refresh({ automatic = false } = {}) {
    capture();
    if (pending || refreshing || loading || !connected() || document.hidden) { if (!automatic && pending) toast('Recover the pending request before refreshing.'); return; }
    // A review is tied to its displayed revision. Keep the form and its focus
    // untouched until the person explicitly refreshes or submits it.
    if (automatic && reviewing()) { updateClocks(); return; }
    const context = scope(); refreshing = true;
    try {
      const result = await readDashboard(context); if (!current(context) || pending) return;
      capture(); applyDashboard(result);
      if (!automatic) { feedback = decision?.stale ? 'This assignment changed. Review the current assignment before responding.' : 'Current scene state loaded. Your unsaved entries remain in this tab.'; feedbackError = false; }
      render();
    } catch (error) { if (current(context) && !pending) { capture(); readError(error); render(); } }
    finally { if (current(context)) { refreshing = false; updateClocks(); } }
  }
  function pendingBanner() {
    if (!pending) return '';
    return `<section class="stagehand-notice" role="status"><strong>${pending.sending ? 'Waiting for server confirmation…' : 'This request has no confirmed response.'}</strong><p>${pending.sending ? 'Controls are locked while ORACLE checks the request.' : pending.kind === 'event-status' ? 'Retry checks the same event revision. If it already changed, ORACLE will load and show the current event state.' : 'It may have completed. Retry sends the exact same request to recover the result without creating a second party or dispatch.'}</p>${!pending.sending ? `<button type="button" class="primary mt" data-action="stagehand-retry" ${disabled(!connected())}>Retry pending request</button>` : ''}</section>`;
  }
  async function mutate(path, method, body, kind = 'operation', retry = false) {
    ensureAccount(); capture(); if (!connected()) throw new Error('Reconnect before changing scene operations.');
    if (pending && !retry) throw new Error('Recover the pending request before making another change.');
    if (!retry && !writable()) throw new Error('Refresh the current server state before making changes.');
    const record = retry ? pending : { path: kind === 'event-status' ? `/api/events/${eventId}` : `${base()}${path.startsWith('/') ? path : `/${path}`}`, method, body: kind === 'event-status' ? clone(body) : { ...clone(body), requestId: crypto.randomUUID() }, kind, sending: false };
    if (!record || record.sending) return;
    epoch++; refreshing = false; const context = scope(); pending = record; record.sending = true; feedback = ''; render();
    try {
      const result = await api(record.path, record.method, record.body); if (!current(context)) return;
      pending = null; decision = null; if (record.kind !== 'event-status') manager.mutationSucceeded(record.kind);
      if (record.kind === 'event-status') {
        if (result.event && state.event?.id === eventId) { state.event.status = result.event.status; state.event.version = result.event.version; }
        try { const fresh = await readDashboard(context); if (!current(context)) return; applyDashboard(fresh); feedback = `Event ${result.event?.status || record.body.status}. Scene assignments have been refreshed.`; feedbackError = false; }
        catch (error) { if (current(context)) { readError(error); feedback = `The event change was confirmed. ${feedback}`; } }
      } else {
        const matchesView = manage ? Boolean(result.context) : Object.hasOwn(result, 'character') && Array.isArray(result.characters);
        if (matchesView) applyDashboard(result);
        else {
          // A privileged person may operate their own character. Keep the
          // selected player/staff projection even for a shared cancel route.
          try { const fresh = await readDashboard(context); if (!current(context)) return; applyDashboard(fresh); }
          catch (error) { if (current(context)) { readError(error); feedback = `The operation was confirmed. ${feedback}`; } return; }
        }
        feedback = result.outcome?.message || (result.outcome?.replayed ? 'Earlier request recovered. No duplicate operation was recorded.' : 'Server confirmed the operation.'); feedbackError = false;
      }
    } catch (error) {
      if (!current(context)) return; record.sending = false;
      if (error.status >= 400 && error.status < 500) {
        pending = null; feedback = error.message; feedbackError = true;
        if ([401, 403, 404].includes(error.status)) readError(error);
        else if (error.status === 409) {
          stale = true; manager.markConflict(); if (decision) { decision.stale = true; decision.acknowledged = false; }
          if (record.kind === 'event-status') {
            try { const fresh = await readDashboard(context); if (!current(context)) return; applyDashboard(fresh); feedback = fresh.event.status === record.body.status ? `Current event state is ${fresh.event.status}. The original request was not acknowledged; the current state is now confirmed.` : `The event changed to ${fresh.event.status}. Review the current state before choosing another action.`; feedbackError = fresh.event.status !== record.body.status; }
            catch (readFailure) { if (current(context)) readError(readFailure); }
          } else feedback += ' Refresh and review the current revision. Your unsaved entries are retained.';
        }
      } else { stale = true; feedback = 'The connection did not confirm this request. Retry pending request to recover its result.'; feedbackError = true; }
    } finally { if (current(context)) { if (pending === record) record.sending = false; render(); } }
  }
  function freshness() {
    if (!connected()) return 'Offline · live scene details are unavailable.';
    if (stale) return 'State unconfirmed · refresh before acting.';
    if (pending) return 'Automatic refresh is paused until this request is confirmed.';
    if (reviewing()) return 'Automatic refresh is paused while you edit or review. Refresh keeps your entries.';
    if (refreshing) return 'Checking current scene state…';
    const seconds = Math.max(0, Math.floor((performance.now() - refreshedAt) / 1000));
    return `Server checked ${seconds < 2 ? 'just now' : `${seconds} seconds ago`} · refreshes every 10 seconds while visible.`;
  }
  function returnText(value) {
    const timestamp = new Date(value).getTime(), now = serverAt + Math.max(0, performance.now() - refreshedAt);
    if (!Number.isFinite(timestamp)) return '';
    if (timestamp <= now) return 'Return time has passed. Staff must acknowledge the return.';
    const minutes = Math.ceil((timestamp - now) / 60000); return `${minutes} minute${minutes === 1 ? '' : 's'} until the return time.`;
  }
  function updateClocks() {
    if (state.view !== 'stagehand' || accountId !== state.session?.user?.id || eventId !== state.event?.id) { stopTimers(); exitFocus(); return; }
    const label = document.querySelector('#stagehand-freshness'); if (label) label.textContent = freshness();
    for (const node of document.querySelectorAll('[data-stagehand-returnby]')) { node.textContent = returnText(node.dataset.stagehandReturnby); node.classList.toggle('stagehand-overdue', new Date(node.dataset.stagehandReturnby).getTime() <= serverAt + Math.max(0, performance.now() - refreshedAt)); }
  }
  function ensureTimers() { if (!refreshTimer) refreshTimer = setInterval(() => { void refresh({ automatic: true }); }, 10000); if (!clockTimer) clockTimer = setInterval(updateClocks, 1000); updateClocks(); }
  function feedbackView() { return feedback ? `<p class="stagehand-feedback ${feedbackError ? 'error' : ''}" role="${feedbackError ? 'alert' : 'status'}">${esc(feedback)}</p>` : ''; }
  function eventNotice() {
    const status = dashboard.event.status;
    if (status === 'paused') return '<section class="stagehand-notice"><strong>The event is paused.</strong><p>New queues, acceptance, and dispatch are paused. Existing return times continue. Staff can still acknowledge returns and cancellations.</p></section>';
    if (['ended', 'archived'].includes(status)) return `<section class="stagehand-notice"><strong>The event has ${status === 'ended' ? 'ended' : 'been archived'}.</strong><p>Active assignments are closed. ${status === 'archived' ? 'This event is read-only.' : 'Staff can review the recorded operations.'}</p></section>`;
    if (status === 'draft') return '<section class="stagehand-notice"><strong>The event is in preparation.</strong><p>Organizers can configure encounters. Player queues and dispatch begin during rehearsal or live play.</p></section>';
    if (dashboard.readOnly) return '<section class="stagehand-notice"><strong>Admission is unavailable.</strong><p>STAGEHAND and WAYFINDER must both be enabled. Existing dispatched groups still need staff to acknowledge return or cancellation.</p></section>';
    return '';
  }
  function characterPicker() {
    if (!dashboard.characters?.length) return `<section class="empty"><h2>An approved character is needed.</h2><p>${esc(dashboard.message || 'Choose a character assigned to you before requesting a scene or responding to a party assignment.')}</p><button type="button" data-action="character-open">Open characters</button></section>`;
    return `<form id="stagehand-character-form" class="stagehand-character-picker"><label>Acting as<select name="characterId" ${disabled(Boolean(pending))}>${dashboard.characters.map(row => `<option value="${esc(row.id)}" ${row.id === characterId ? 'selected' : ''}>${esc(row.name)}</option>`).join('')}</select></label><button type="submit" ${disabled(Boolean(pending))}>Use character</button></form>`;
  }
  function responseView(party) {
    if (!decision || decision.party.id !== party.id) return '';
    const reviewed = decision.party, encounter = decision.encounter;
    return `<section class="stagehand-consent"><h3>${decision.response === 'accepted' ? 'Review and accept this assignment' : 'Decline this assignment'}</h3><p><strong>${esc(reviewed.name)}</strong> · ${esc(encounter?.title || 'Assigned scene')} · ${reviewed.memberCount} participant${reviewed.memberCount === 1 ? '' : 's'}</p><p>The return window is ${reviewed.returnMinutes} minutes from dispatch. A place is reserved only when staff dispatches the whole party.</p>${decision.stale ? '<p class="stagehand-notice">The assignment changed after this review. Load its current details before responding.</p><button type="button" data-action="stagehand-review-current">Review current assignment</button>' : ''}<form id="stagehand-response-form" data-party-id="${esc(reviewed.id)}">${err}<label class="stagehand-check"><input type="checkbox" name="acknowledged" required ${decision.acknowledged ? 'checked' : ''} ${disabled(Boolean(pending) || decision.stale)}><span>${decision.response === 'accepted' ? 'I accept this destination and return window for my character.' : 'I understand this party cannot dispatch with my response declined.'}</span></label><div class="actions"><button type="submit" class="${decision.response === 'accepted' ? 'primary' : ''}" ${disabled(!writable() || decision.stale || !party.canRespond)}>${decision.response === 'accepted' ? 'Accept assignment' : 'Decline assignment'}</button><button type="button" class="quiet" data-action="stagehand-close-response" ${disabled(Boolean(pending))}>Back</button></div></form></section>`;
  }
  function partyView(row, historical = false) {
    const scene = dashboard.encounters?.find(item => item.id === row.encounterId);
    return `<article class="stagehand-party-card ${historical ? 'stagehand-party-history' : ''}" data-stagehand-party="${esc(row.id)}"><div class="stagehand-row-head"><div><p class="eyebrow">${historical ? 'Previous assignment' : 'Your party'}</p><h3>${esc(row.name)}</h3></div><span class="badge">${esc(partyName(row.status))}</span></div><p><strong>${esc(scene?.title || 'Assigned scene')}</strong>${scene?.location ? ` · ${esc(scene.location)}` : ''}</p>${row.blockedReason ? `<p class="stagehand-notice">${esc(row.blockedReason)}</p>` : ''}${row.status === 'waiting' ? `<p>${row.memberCount} participant${row.memberCount === 1 ? '' : 's'} · ${row.acceptedCount} accepted · <strong>${esc(responseName(row.response))}</strong></p><p class="hint">${row.returnMinutes}-minute return window from dispatch. Waiting parties do not reserve seats.</p>` : ''}${row.status === 'dispatched' ? `<section class="stagehand-return-window"><strong>Return by <time datetime="${esc(row.returnBy)}">${esc(date(row.returnBy))}</time></strong><p data-stagehand-returnby="${esc(row.returnBy)}">${esc(returnText(row.returnBy))}</p><p class="hint">Tell the scene staff when you return. Your seat remains reserved until staff acknowledges your return or cancellation. Event pauses do not extend this timestamp.</p></section>${scene?.nodeId && ctx.openAdventure ? `<button type="button" class="primary" data-action="stagehand-adventure" data-node="${esc(scene.nodeId)}" ${disabled(Boolean(pending))}>Open assigned scene</button>` : ''}` : ''}${historical && row.returnBy ? `<p class="hint">Recorded return time: ${esc(date(row.returnBy))}</p>` : ''}${!historical && row.canRespond && (!decision || decision.party.id !== row.id) ? `<div class="actions"><button type="button" class="primary" data-action="stagehand-respond" data-id="${esc(row.id)}" data-response="accepted" ${disabled(!writable())}>${row.response === 'accepted' ? 'Review acceptance' : 'Review and accept'}</button><button type="button" data-action="stagehand-respond" data-id="${esc(row.id)}" data-response="declined" ${disabled(!writable())}>Review decline</button></div>` : ''}${!historical ? responseView(row) : ''}${!historical && row.canCancel ? `<button type="button" class="quiet mt" data-action="stagehand-cancel" data-id="${esc(row.id)}" ${disabled(!writable())}>Leave my waiting party</button>` : ''}</article>`;
  }
  function playerView() {
    const currentParties = (dashboard.parties || []).filter(activeParty), past = (dashboard.parties || []).filter(row => !activeParty(row));
    const encounters = dashboard.encounters || [];
    return `${characterPicker()}${dashboard.character ? `<div class="stagehand-player-grid"><section class="stagehand-own-queue"><div class="panel-head"><h2>Your assignments</h2></div>${currentParties.length ? currentParties.map(row => partyView(row)).join('') : '<section class="panel stagehand-empty"><h3>No active assignment</h3><p>Request a place in an available scene, or wait for staff to assemble your party. You will review and accept the destination before dispatch.</p></section>'}${past.length ? `<details class="stagehand-history"><summary>Previous assignments · ${past.length}</summary>${past.map(row => partyView(row, true)).join('')}</details>` : ''}</section><section class="stagehand-player-scenes"><div class="panel-head"><h2>Scenes you can approach</h2><span class="hint">${encounters.length}</span></div>${!connected() || stale ? '<section class="stagehand-notice"><h3>Refresh for scene availability</h3><p>Admission and occupancy need a current server check. Your last recorded assignment is shown separately.</p></section>' : encounters.length ? `<div class="stagehand-scenes">${encounters.map(row => `<article class="panel stagehand-scene ${row.id === selectedEncounterId ? 'selected' : ''}" data-stagehand-scene="${esc(row.id)}"><div class="stagehand-row-head"><h3>${esc(row.title)}</h3><span class="badge">${esc({ open: 'Open', planning: 'Preparing', paused: 'Paused', closed: 'Closed', unavailable: 'Unavailable', full: 'Full', scheduled: 'Scheduled' }[row.availability] || row.state)}</span></div>${row.location ? `<p class="stagehand-location">${esc(row.location)}</p>` : ''}${row.publicMessage ? `<p class="stagehand-copy">${esc(row.publicMessage)}</p>` : ''}<p class="stagehand-capacity"><strong>${row.attendanceCount} / ${row.capacity}</strong> places occupied</p>${row.reason ? `<p class="hint">${esc(row.reason)}</p>` : ''}<button type="button" class="primary" data-action="stagehand-queue" data-id="${esc(row.id)}" ${disabled(!writable() || !row.canQueue)}>Request a place</button><p class="hint">Requests join the waiting queue. Staff dispatches an accepted party when the scene has room for everyone.</p></article>`).join('')}</div>` : '<section class="panel stagehand-empty"><h3>No linked scenes are available to your character.</h3><p>Discoveries, event conditions, or staff preparation may make scenes available later. Check your adventure or ask event staff.</p></section>'}</section></div>` : ''}`;
  }
  function eventControls() {
    if (!manage || !dashboard.canManage) return '';
    const status = dashboard.event.status;
    return `<details class="stagehand-event-controls"><summary>Whole-event controls · ${esc(status)}</summary><p class="hint">These controls affect every encounter and player in the event. Pausing preserves absolute return times. Ending closes active assignments.</p><div class="actions">${status === 'live' ? `<button type="button" data-action="stagehand-event-status" data-status="paused" ${disabled(!writable())}>Pause entire event</button>` : ''}${status === 'paused' ? `<button type="button" class="primary" data-action="stagehand-event-status" data-status="live" ${disabled(!writable())}>Resume live event</button>` : ''}${['live', 'paused'].includes(status) ? `<button type="button" class="danger" data-action="stagehand-event-status" data-status="ended" ${disabled(!writable())}>End entire event</button>` : '<p class="hint">Use the event briefing for preparation and lifecycle transitions.</p>'}</div></details>`;
  }
  function render() {
    ensureAccount(); if (state.view !== 'stagehand' || !state.session?.user) return;
    const disclosures = new Map([...document.querySelectorAll('.stagehand-workspace details')].map(row => [row.querySelector('summary')?.textContent.split(' · ')[0], row.open]));
    if (!dashboard || dashboard.event?.id !== state.event?.id) { shell(`<section class="stagehand-workspace"><button type="button" class="quiet" data-action="stagehand-event">← Event briefing</button><h1 class="mt">STAGEHAND</h1><p role="status">${loading ? 'Loading scene operations…' : 'Open or refresh this event to load scene operations.'}</p>${feedbackView()}<button type="button" data-action="stagehand-refresh" ${disabled(loading || !connected())}>Refresh</button></section>`); return; }
    const operationalContent = manage ? !connected() ? '<section class="empty"><h2>Reconnect for staff operations.</h2><p>Private staff details and live assignments are hidden while offline. Unsaved entries remain in this tab. Refresh after reconnecting before acting.</p></section>' : manager.render() : playerView();
    shell(`<section class="stagehand-workspace"><div class="actions stagehand-navigation"><button type="button" class="quiet" data-action="stagehand-event">← Event briefing</button>${dashboard.canManage || dashboard.canOperate ? `<button type="button" class="quiet" data-action="${manage ? 'stagehand-open' : 'stagehand-manage'}">${manage ? 'View my character’s assignment' : 'Open staff operations'}</button>` : ''}</div><section class="stagehand-focus-surface"><header class="page-head mt"><div><p class="eyebrow">${esc(dashboard.event.name)} · STAGEHAND${manage ? ' · Staff operations' : ''}</p><h1>${manage ? 'Keep the scenes moving.' : 'Your next scene'}</h1><p class="muted">${manage ? 'Prepare the encounter. Gather the party. Acknowledge its return.' : 'Review your assignment, wait for dispatch, and return to scene staff.'}</p></div><div class="actions">${focusMode ? '<button type="button" data-action="stagehand-focus-exit">Exit focus mode</button><button type="button" data-action="stagehand-fullscreen">Full screen</button>' : `<button type="button" data-action="stagehand-focus" ${disabled(!connected())}>${manage ? 'Tablet focus' : 'Focus view'}</button>`}<button type="button" data-action="stagehand-refresh" ${disabled(!connected() || Boolean(pending) || loading)}>Refresh</button></div></header><p id="stagehand-freshness" class="stagehand-freshness" role="status">${esc(freshness())}</p>${pendingBanner()}${feedbackView()}${eventNotice()}${manage ? '<p class="hint stagehand-session-hint">Staff tools use your current event permissions. Focus mode changes the display and keeps this signed-in account’s access.</p>' : ''}${operationalContent}${eventControls()}</section></section>`);
    for (const row of document.querySelectorAll('.stagehand-workspace details')) { const key = row.querySelector('summary')?.textContent.split(' · ')[0]; if (disclosures.has(key)) row.open = disclosures.get(key); }
    ensureTimers();
  }
  function confirmDiscard(destination) {
    capture(); if (destination === 'modal') return true;
    if (pending?.sending) { toast('Wait for the current STAGEHAND request before leaving.'); return false; }
    if (pending && !window.confirm('This operation has no confirmed response. Retry can recover it without a duplicate party or dispatch. Leave and discard this tab’s retry information?')) return false;
    if (decision && !window.confirm('Leave this unsubmitted assignment response?')) return false;
    if (!manager.confirmDiscard()) return false;
    pending = null; decision = null; exitFocus(); return true;
  }
  async function openStory() { if (ctx.openStory && confirmDiscard()) { reset(); await ctx.openStory(); } }
  async function action(button) {
    const name = button.dataset.action; if (!name?.startsWith('stagehand-')) return false; ensureAccount(); capture();
    if (name.startsWith('stagehand-m-')) { if (!manage || !dashboard) return true; return await manager.action(button); }
    if (name === 'stagehand-open' || name === 'stagehand-manage') await open({ manage: name === 'stagehand-manage', characterId: button.dataset.characterId || button.dataset.character, encounterId: button.dataset.encounterId || button.dataset.encounter });
    else if (name === 'stagehand-event') { if (confirmDiscard()) { const id = eventId || state.event?.id; reset(); await loadEvent(id); } }
    else if (name === 'stagehand-refresh') await refresh();
    else if (name === 'stagehand-retry') await mutate(null, null, null, null, true);
    else if (name === 'stagehand-focus') { if (connected() && dashboard) { focusMode = true; document.body.classList.add('stagehand-focus'); render(); } }
    else if (name === 'stagehand-focus-exit') { exitFocus(); render(); }
    else if (name === 'stagehand-fullscreen') { try { if (focusMode) await document.documentElement.requestFullscreen?.(); } catch { toast('Full screen is unavailable. Focus mode remains active.'); } }
    else if (name === 'stagehand-adventure') { if (ctx.openAdventure && confirmDiscard()) { const options = { characterId, focusNodeId: button.dataset.node }; reset(); await ctx.openAdventure(options); } }
    else if (name === 'stagehand-queue') {
      const encounter = dashboard?.encounters?.find(row => row.id === button.dataset.id);
      if (!manage && writable() && encounter?.canQueue && dashboard.character) { selectedEncounterId = encounter.id; await mutate('/queue', 'POST', { encounterId: encounter.id, characterId }, 'queue'); }
    } else if (name === 'stagehand-respond') {
      const party = dashboard?.parties?.find(row => row.id === button.dataset.id);
      if (!manage && writable() && party?.canRespond && ['accepted', 'declined'].includes(button.dataset.response)) {
        if (decision && !window.confirm('Replace this unsubmitted assignment response?')) return true;
        decision = { party: clone(party), encounter: clone(dashboard.encounters?.find(row => row.id === party.encounterId) || null), response: button.dataset.response, acknowledged: false, stale: false }; feedback = ''; render(); document.querySelector('#stagehand-response-form input')?.focus();
      }
    } else if (name === 'stagehand-close-response') { if (!decision?.acknowledged || window.confirm('Discard this unsubmitted assignment response?')) { decision = null; render(); } }
    else if (name === 'stagehand-review-current') {
      const party = dashboard?.parties?.find(row => row.id === decision?.party.id);
      if (decision && party?.canRespond && writable()) { decision = { ...decision, party: clone(party), encounter: clone(dashboard.encounters?.find(row => row.id === party.encounterId) || null), acknowledged: false, stale: false }; render(); }
    } else if (name === 'stagehand-cancel') {
      const party = dashboard?.parties?.find(row => row.id === button.dataset.id);
      if (!manage && writable() && party?.canCancel && window.confirm(`Leave “${party.name}”? Your one-person waiting assignment will be cancelled.`)) await mutate(`/parties/${party.id}/cancel`, 'POST', { version: party.version, reason: 'Player withdrew their own waiting assignment.' }, 'cancel');
    } else if (name === 'stagehand-event-status') {
      const status = button.dataset.status, before = dashboard?.event.status;
      const allowed = before === 'live' && ['paused', 'ended'].includes(status) || before === 'paused' && ['live', 'ended'].includes(status);
      if (manage && dashboard?.canManage && writable() && allowed && window.confirm(status === 'ended' ? 'End the entire event? All active party assignments will close. This affects every scene and player.' : status === 'paused' ? 'Pause the entire event? Dispatch and acceptance stop; absolute return times continue.' : 'Resume live play for the entire event? Encounter readiness and each group’s acceptance still apply.')) await mutate('', 'PATCH', { version: dashboard.event.version, status }, 'event-status');
    }
    return true;
  }
  async function submit(form) {
    if (form.id?.startsWith('sgm-')) { ensureAccount(); capture(); if (manage && dashboard) return await manager.submit(form); return true; }
    if (!form.id?.startsWith('stagehand-')) return false; ensureAccount(); capture();
    if (form.id === 'stagehand-character-form') { await open({ characterId: String(new FormData(form).get('characterId') || '') }); return true; }
    if (form.id === 'stagehand-response-form') {
      if (!decision || decision.stale || !decision.acknowledged || !writable() || !form.reportValidity()) return true;
      const latest = dashboard.parties.find(row => row.id === decision.party.id);
      if (!latest?.canRespond || latest.version !== decision.party.version) { decision.stale = true; decision.acknowledged = false; render(); return true; }
      await mutate(`/parties/${latest.id}/respond`, 'POST', { version: decision.party.version, characterId, response: decision.response }, 'respond');
    }
    return true;
  }
  document.addEventListener('input', event => { if (state.view === 'stagehand' && event.target.closest('#stagehand-response-form')) { capture(); updateClocks(); } });
  document.addEventListener('change', event => { if (state.view === 'stagehand' && event.target.closest('#stagehand-response-form')) { capture(); updateClocks(); } });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { exitFocus(); cleanupModal(); if (state.view === 'stagehand') { capture(); stale = true; updateClocks(); } }
    else if (state.view === 'stagehand') { render(); if (connected() && !pending && !dirty()) void refresh(); }
  });
  window.addEventListener('offline', () => { if (state.view === 'stagehand') { capture(); stale = true; exitFocus(); cleanupModal(); render(); } });
  window.addEventListener('online', () => { if (state.view === 'stagehand') { feedback = 'Connection restored. Refresh the server state before acting.'; feedbackError = false; render(); if (!pending && !dirty()) void refresh(); } });
  window.addEventListener('pagehide', () => { stopTimers(); exitFocus(); cleanupModal(); if (state.view === 'stagehand') stale = true; });
  window.addEventListener('beforeunload', event => { capture(); if (dirty() || pending) { event.preventDefault(); event.returnValue = ''; } });
  return { open, render, action, submit, reset, confirmDiscard, cleanupModal, isDirty: () => { capture(); return dirty() || Boolean(pending); } };
}
