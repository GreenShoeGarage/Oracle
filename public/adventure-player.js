import { scanImage, startScanner } from './qr.js';
import { parsePropInput } from './prop-code.js';

const instruments = {
  relic: { name: 'Relic', icon: '✦', purpose: 'Examine a prop and record what you discover.' },
  dead_drop: { name: 'Dead drop', icon: '▣', purpose: 'Open a message left for your character.' },
  cipherbox: { name: 'Cipherbox', icon: '⌘', purpose: 'Work through a puzzle, one answer at a time.' },
  wayfinder: { name: 'Wayfinder', icon: '⌖', purpose: 'Find a scene and join the other players.' },
};

export function createAdventurePlayer(ctx) {
  const { state, api, esc, shell, loadEvent, openModal, closeModal, toast, isManager, err } = ctx;
  let snapshot = null, accountId = null, focusNodeId = null, kiosk = false, preview = false;
  let inputDirty = false, scanDirty = false, epoch = 0, modalEpoch = 0, scannerStop = null, scannerController = null;
  let feedback = null, scanBusy = false;
  const drafts = new Map(), propCodes = new Map(), pendingActions = new Map(), cooldowns = new Map();
  const timers = new Set();
  const eventId = () => snapshot?.event.id || state.event?.id;
  const base = (id = eventId()) => `/api/events/${id}/adventure`;
  const scopeKey = () => `${eventId()}:${snapshot?.character?.id || ''}`;
  const draftKey = (nodeId, field) => `${scopeKey()}:${nodeId}:${field}`;
  const draftValue = (nodeId, field) => drafts.get(draftKey(nodeId, field)) || '';
  const pending = () => pendingActions.get(scopeKey());
  const connected = () => navigator.onLine !== false;
  const canAct = () => connected() && snapshot?.character && !snapshot.readOnly && !snapshot.preview && ['live', 'rehearsal'].includes(snapshot.event.status) && !pending();
  const formatDate = (value) => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not scheduled';
  const type = (node) => instruments[node.type] || { name: 'Instrument', icon: '◈', purpose: '' };
  function ensureAccount() {
    const current = state.session?.user?.id || null;
    if (current !== accountId) {
      accountId = current; snapshot = null; focusNodeId = null; kiosk = false; preview = false; feedback = null;
      inputDirty = false; scanDirty = false; drafts.clear(); propCodes.clear(); pendingActions.clear(); cooldowns.clear();
      epoch++; stopCamera();
      for (const timer of timers) clearTimeout(timer); timers.clear();
    }
    return current;
  }
  async function readScope() {
    try { return await ctx.offline?.captureReadScope?.(); } catch { return null; }
  }
  async function fetchSnapshot(path, method = 'GET', data) {
    const who = ensureAccount(), scope = await readScope();
    const result = await api(path, method, data);
    if (!who || state.session?.user?.id !== who) throw new Error('Your account changed. Open the event again.');
    if (!result.preview && result.character && scope) {
      try { await ctx.offline?.cacheJournal?.({ scope, accountId: who, event: result.event, character: result.character, adventure: result.adventure, journal: result.journal }); } catch { /* A device cache failure must not interrupt live play. */ }
    }
    if (state.session?.user?.id !== who) throw new Error('Your account changed. Open the event again.');
    return result;
  }
  function applySnapshot(result) {
    snapshot = result; preview = Boolean(result.preview);
    if (state.event?.id === result.event.id) state.event.status = result.event.status;
    if (focusNodeId && !result.nodes.some((node) => node.id === focusNodeId)) { focusNodeId = null; kiosk = false; }
    for (const node of result.nodes) if (node.type === 'cipherbox' && node.retryAfterMs) cooldowns.set(`${scopeKey()}:${node.id}`, Date.now() + node.retryAfterMs);
    state.view = 'adventure';
  }
  async function open(options = {}) {
    ensureAccount();
    const currentEpoch = ++epoch, id = state.event?.id;
    if (!id) throw new Error('Open an event first.');
    const characterId = options.characterId || (snapshot?.event.id === id && !options.preview ? snapshot.character?.id : null);
    const query = new URLSearchParams(); if (characterId) query.set('characterId', characterId); if (options.preview) query.set('preview', 'true');
    const result = await fetchSnapshot(`${base(id)}/play${query.size ? `?${query}` : ''}`);
    if (currentEpoch !== epoch) return;
    focusNodeId = options.focusNodeId || null; kiosk = Boolean(options.kiosk); feedback = null;
    applySnapshot(result); render();
  }
  async function refresh() {
    const options = { preview, characterId: snapshot?.character?.id, focusNodeId, kiosk };
    await open(options); toast('Adventure refreshed.');
  }
  function characterPicker() {
    const characters = [...(snapshot.characters || [])];
    if (snapshot.character && !characters.some((character) => character.id === snapshot.character.id)) characters.push({ ...snapshot.character, name: `${snapshot.character.name} · saved readings` });
    if (!characters.length) return `<section class="panel adv-empty-character"><h2>${preview ? 'Choose a character to preview.' : 'Your character is your way into the story.'}</h2><p class="hint">${esc(snapshot.message || 'Create a character or ask your organizer to assign one. Your character must be approved before you can play.')}</p><button class="primary mt" data-action="character-open">Open characters</button></section>`;
    return `<form id="adv-character-form" class="adv-character-picker">${err}<label>${preview ? 'Previewing character' : 'Playing as'}<select name="characterId">${characters.map((character) => `<option value="${esc(character.id)}" ${character.id === snapshot.character?.id ? 'selected' : ''}>${esc(character.name)}</option>`).join('')}</select></label><button type="submit">${preview ? 'Preview character' : 'Use character'}</button><p class="hint">${preview ? 'This shows what the selected character can currently access.' : 'Discoveries and puzzle attempts belong to the selected character.'}</p></form>`;
  }
  function readOnlyBanner() {
    if (!connected()) return '<p class="adv-state-banner" role="status">Offline · previously loaded readings only. Reconnect to scan props or take an action.</p>';
    if (snapshot.preview) return '<p class="adv-state-banner" role="status">Organizer preview · read-only. This view does not unlock content, spend attempts, or change character progress.</p>';
    if (snapshot.readOnly && snapshot.character) return `<p class="adv-state-banner" role="status">${esc(snapshot.event.status === 'paused' ? 'Play is paused. Your saved readings remain available.' : 'This event is not open for play. You can read your previous discoveries.')}</p>`;
    if (snapshot.adventure.isRehearsal) return '<p class="adv-state-banner">Rehearsal copy · progress here belongs to this practice event.</p>';
    return '';
  }
  function pendingBanner() {
    const request = pending(); if (!request) return '';
    return `<section class="adv-pending" role="status"><h3>${request.sending ? 'Recording your action…' : 'Your action has no confirmed response yet.'}</h3><p>${request.sending ? 'Please wait while ORACLE checks the result.' : 'Retry sends the same action. It will not spend a second attempt if the original request already arrived.'}</p>${!request.sending ? `<button class="primary mt" data-action="adv-retry" ${!connected() ? 'disabled' : ''}>Retry pending action</button>` : ''}</section>`;
  }
  function feedbackBanner() { return feedback ? `<p class="adv-feedback" role="status">${esc(feedback.message)}</p>` : ''; }
  function render() {
    ensureAccount(); if (!snapshot || snapshot.event.id !== state.event?.id) { shell('<p role="status">Open an event’s adventure to begin.</p>'); return; }
    const focused = snapshot.nodes.find((node) => node.id === focusNodeId);
    const content = !connected() ? journal() : !snapshot.character ? characterPicker() : focused ? nodePanel(focused) : `<section class="adv-instruments"><div class="panel-head"><h2>Your instruments</h2><span class="hint">${snapshot.nodes.length} places to explore</span></div>${snapshot.nodes.length ? `<div class="adv-grid">${snapshot.nodes.map(nodeCard).join('')}</div>` : '<div class="empty"><h3>Your organizer is preparing the adventure.</h3><p>Return here when the story is ready.</p></div>'}</section>${journal()}`;
    shell(`<section class="adventure-player ${kiosk && focused && connected() ? 'adv-kiosk' : ''}"><div class="adv-navigation actions">${focused ? '<button class="quiet" data-action="adv-all">← All instruments</button>' : '<button class="quiet" data-action="adv-event">← Event briefing</button>'}${isManager() ? '<button class="quiet" data-action="advedit-open">Organizer tools</button>' : ''}${kiosk ? '<button data-action="adv-kiosk-exit">Exit prop view</button>' : ''}</div><header class="page-head adv-page-head"><div><p class="eyebrow">${esc(snapshot.event.name)} · ${esc(snapshot.event.status)}</p><h1>${esc(kiosk && focused ? focused.title : snapshot.adventure.title || 'Your adventure')}</h1>${!kiosk && snapshot.adventure.summary ? `<p class="muted">${esc(snapshot.adventure.summary)}</p>` : ''}${kiosk && snapshot.character ? `<p class="hint">Playing as ${esc(snapshot.character.name)}</p>` : ''}</div><div class="actions">${snapshot.character && !preview && connected() ? '<button class="primary" data-action="adv-scan">Scan a prop</button>' : ''}<button data-action="adv-refresh" ${!connected() ? 'disabled' : ''}>Refresh</button></div></header>${readOnlyBanner()}${snapshot.character && !kiosk && connected() ? characterPicker() : ''}${pendingBanner()}${feedbackBanner()}${content}</section>`);
    scheduleCooldowns();
  }
  function nodeCard(node) {
    const instrument = type(node);
    return `<button class="adv-card ${node.locked ? 'adv-card-locked' : ''}" data-action="adv-focus" data-id="${esc(node.id)}"><span class="adv-card-top"><span class="adv-icon" aria-hidden="true">${instrument.icon}</span><span class="badge">${esc(node.failed ? 'Attempts exhausted' : node.completed ? 'Discovered' : node.locked ? 'Locked' : 'Available')}</span></span><span class="eyebrow">${instrument.name}</span><strong>${esc(node.title)}</strong><span class="hint">${esc(node.summary || instrument.purpose)}</span><span class="adv-card-foot">${node.locked ? 'View requirements' : 'Open instrument →'}</span></button>`;
  }
  function nodePanel(node) {
    let body;
    if (node.locked) body = `<p class="adv-state-banner">${esc(node.lockReason || 'Requirements are not met.')}</p>${node.type === 'wayfinder' && node.joined ? sceneLeave(node) : '<p class="hint">Continue exploring or ask your organizer for direction.</p>'}`;
    else if (node.type === 'relic') body = relic(node);
    else if (node.type === 'dead_drop') body = deadDrop(node);
    else if (node.type === 'cipherbox') body = cipherbox(node);
    else if (node.type === 'wayfinder') body = wayfinder(node);
    else body = '<p class="hint">This instrument is unavailable.</p>';
    return `<section class="panel adv-focused"><div class="panel-head"><div><p class="eyebrow">${type(node).name}</p>${!kiosk ? `<h2>${esc(node.title)}</h2>` : ''}</div><div class="actions">${!kiosk ? '<button data-action="adv-kiosk">Focus on this prop</button>' : '<button data-action="adv-fullscreen">Full screen</button>'}</div></div>${node.summary ? `<p class="prose adv-summary">${esc(node.summary)}</p>` : ''}${body}${nodeJournal(node)}</section>${!kiosk ? journal(true) : ''}`;
  }
  function relic(node) {
    const code = propCodes.get(`${eventId()}:${node.id}`), disabled = !canAct() || !code;
    return `${code ? '<p class="adv-prop-ready">Prop identified · choose an examination.</p>' : `<div class="adv-state-banner"><p>Scan this prop or enter its printed code before examining it.</p>${!preview ? '<button class="primary mt" data-action="adv-scan">Identify this prop</button>' : ''}</div>`}<div class="adv-examinations">${(node.examinations || []).map((exam) => `<form class="adv-action-form" id="adv-examine-${esc(exam.id)}" data-kind="examine" data-node="${esc(node.id)}" data-exam="${esc(exam.id)}">${err}<div><strong>${esc(exam.label)}</strong><p class="hint">${exam.completed ? 'This examination is recorded in your journal.' : exam.available ? 'Available to your character.' : 'Your character does not meet the requirements yet.'}</p></div><button type="submit" class="${exam.available && !exam.completed ? 'primary' : ''}" ${disabled || !exam.available || exam.completed ? 'disabled' : ''}>${exam.completed ? 'Recorded' : 'Examine'}</button></form>`).join('')}</div>`;
  }
  function deadDrop(node) {
    if (node.completed) return '<p class="adv-prop-ready">Message opened. Read it in your discoveries below.</p>';
    return `<form id="adv-open-form" class="adv-action-form" data-kind="open" data-node="${esc(node.id)}">${err}${node.requiresCode ? `<label>Release code<input name="code" value="${esc(draftValue(node.id, 'code'))}" required maxlength="80" autocomplete="off" spellcheck="false" ${!canAct() ? 'disabled' : ''}></label><p class="hint">Use the release code you discovered during play.</p>` : '<p class="hint">Open this drop to add its contents to your private journal.</p>'}<button type="submit" class="primary" ${!canAct() ? 'disabled' : ''}>Open message</button></form>`;
  }
  function cipherbox(node) {
    const exhausted = node.failed || node.attempts >= node.maxAttempts;
    const until = cooldowns.get(`${scopeKey()}:${node.id}`) || 0;
    return `<section class="adv-puzzle"><p class="prose">${esc(node.prompt)}</p><p class="adv-attempts">${Number(node.attempts) || 0} of ${Number(node.maxAttempts) || 0} attempts used</p>${node.completed ? '<p class="adv-prop-ready">Cipher solved. Your discovery is recorded below.</p>' : exhausted ? '<p class="adv-state-banner">Your attempts are exhausted. Read the result below or ask your organizer for help.</p>' : `<form id="adv-attempt-form" class="adv-action-form" data-kind="attempt" data-node="${esc(node.id)}">${err}<label>Your answer<input name="answer" value="${esc(draftValue(node.id, 'answer'))}" required maxlength="80" autocomplete="off" spellcheck="false" ${!canAct() ? 'disabled' : ''}></label><button type="submit" class="primary" data-adv-cooldown="${until}" ${!canAct() || until > Date.now() ? 'disabled' : ''}>${until > Date.now() ? 'Wait a moment…' : 'Submit answer'}</button><p class="hint">Each submitted answer uses one attempt. Take a moment to check it.</p></form>`}${node.hints?.length ? `<details class="adv-hints"><summary>Hints · ${node.hints.length}</summary><div class="stack mt">${node.hints.map((hint) => `<section>${hint.requested ? `<h3>Hint ${hint.index + 1}</h3><p class="prose">${esc(hint.text || '')}</p>` : `<form class="adv-action-form" id="adv-hint-${hint.index}" data-kind="hint" data-node="${esc(node.id)}" data-hint="${hint.index}">${err}<p class="hint">${hint.available ? `Hint ${hint.index + 1} is available.` : `Hint ${hint.index + 1} is not available yet.`}</p><button type="submit" ${!canAct() || !hint.available ? 'disabled' : ''}>Reveal hint ${hint.index + 1}</button></form>`}</section>`).join('')}</div></details>` : ''}</section>`;
  }
  function sceneLeave(node) { return `<form id="adv-leave-form" class="adv-action-form" data-kind="leave" data-node="${esc(node.id)}">${err}<p class="hint">You have joined this scene.</p><button type="submit" ${!canAct() ? 'disabled' : ''}>Leave scene</button></form>`; }
  function wayfinder(node) {
    const full = node.attendanceCount >= node.maxPlayers, closed = node.availability !== 'open', scheduled = node.availability === 'scheduled';
    return `<p class="prose">${esc(node.body)}</p><dl class="adv-scene-facts"><div><dt>Location</dt><dd>${esc(node.location || 'Ask your organizer')}</dd></div><div><dt>Play style</dt><dd>${esc(node.playStyle)}</dd></div><div><dt>Duration</dt><dd>${Number(node.durationMinutes)} minutes</dd></div><div><dt>Players</dt><dd>${Number(node.attendanceCount)} joined · ${Number(node.minPlayers)}–${Number(node.maxPlayers)} places</dd></div>${node.startsAt ? `<div><dt>Starts</dt><dd>${esc(formatDate(node.startsAt))}</dd></div>` : ''}${node.endsAt ? `<div><dt>Ends</dt><dd>${esc(formatDate(node.endsAt))}</dd></div>` : ''}</dl>${node.joined ? sceneLeave(node) : `<form id="adv-join-form" class="adv-action-form" data-kind="join" data-node="${esc(node.id)}">${err}<p class="hint">${scheduled ? 'This scene opens at its scheduled start time. Refresh then to join.' : closed ? 'This scene is closed.' : full ? 'This scene is full. Refresh later to check for a place.' : node.attendanceCount < node.minPlayers ? 'Gather the remaining players before starting the scene.' : 'There is room for your character.'}</p><button type="submit" class="primary" ${!canAct() || full || closed ? 'disabled' : ''}>Join scene</button></form>`}`;
  }
  function reading(entry) {
    return `<article class="adv-reading"><div class="adv-reading-heading"><h3>${esc(entry.title)}</h3><time datetime="${esc(entry.createdAt)}">${esc(formatDate(entry.createdAt))}</time></div><p class="prose">${esc(entry.text)}</p>${entry.audio ? `<audio controls preload="none" src="${esc(entry.audio)}" aria-label="Audio for ${esc(entry.title)}">Your browser does not support audio playback.</audio><p class="hint">The written reading remains available alongside the audio.</p>` : ''}</article>`;
  }
  function nodeJournal(node) {
    const entries = snapshot.journal.filter((entry) => entry.nodeId === node.id);
    return entries.length ? `<section class="adv-node-journal"><h3>Your discoveries here</h3>${entries.map(reading).join('')}</section>` : '';
  }
  function journal(collapsed = false) {
    const entries = snapshot.journal || [];
    return `<details class="panel adv-journal" ${collapsed ? '' : 'open'}><summary>Your journal · ${entries.length} ${entries.length === 1 ? 'reading' : 'readings'}</summary><p class="hint">${snapshot.character ? `Discoveries saved for ${esc(snapshot.character.name)}. ` : ''}${connected() ? 'Only readings already revealed to this character appear here.' : 'These readings were available when last loaded. Access cannot be checked while offline.'}</p>${entries.length ? `<div class="adv-readings">${[...entries].reverse().map(reading).join('')}</div>` : '<p class="hint mt">Examine props, open messages, and explore the adventure to begin your journal.</p>'}</details>`;
  }
  function scheduleCooldowns() {
    for (const timer of timers) clearTimeout(timer); timers.clear();
    document.querySelectorAll('[data-adv-cooldown]').forEach((button) => {
      const remaining = Number(button.dataset.advCooldown) - Date.now();
      if (remaining <= 0) return;
      const timer = setTimeout(() => { timers.delete(timer); if (button.isConnected) { button.disabled = !canAct(); button.textContent = 'Submit answer'; } }, remaining + 20); timers.add(timer);
    });
  }
  async function execute(payload, retry = false) {
    ensureAccount(); if (!snapshot?.character || snapshot.preview || snapshot.readOnly || !connected()) throw new Error('Reconnect during live play or rehearsal to take an action.');
    const key = scopeKey(), old = pendingActions.get(key);
    if (old && !retry) throw new Error('Retry your pending action before taking another action.');
    const request = retry ? old : { path: `${base()}/action`, payload: { requestId: crypto.randomUUID(), version: snapshot.adventure.version, characterId: snapshot.character.id, ...payload }, sending: false };
    if (!request) throw new Error('There is no pending action to retry.');
    if (request.sending) return;
    request.sending = true; pendingActions.set(key, request); feedback = null; render();
    try {
      const result = await fetchSnapshot(request.path, 'POST', request.payload);
      pendingActions.delete(key);
      for (const field of ['answer', 'code']) drafts.delete(`${key}:${request.payload.nodeId}:${field}`);
      inputDirty = [...drafts.values()].some(Boolean);
      if (scopeKey() === key) { applySnapshot(result); feedback = result.outcome; render(); }
    } catch (error) {
      request.sending = false;
      if (error.status >= 400 && error.status < 500) {
        pendingActions.delete(key);
        if ([409, 429].includes(error.status) && state.session?.user?.id === accountId && snapshot) {
          try { const query = new URLSearchParams({ characterId: snapshot.character.id }); const updated = await fetchSnapshot(`${base()}/play?${query}`); if (scopeKey() === key) applySnapshot(updated); } catch { /* Keep the original error and current readings. */ }
        }
        feedback = { message: error.message }; if (state.view === 'adventure') render();
      } else {
        feedback = { message: 'The connection did not confirm your action. Use Retry pending action when the connection returns.' };
        if (state.view === 'adventure') render();
      }
      if (error.status === 401 || !state.session?.user) ensureAccount();
    }
  }
  function captureForm(form) {
    const data = new FormData(form), kind = form.dataset.kind, nodeId = form.dataset.node;
    const payload = { nodeId, kind };
    if (kind === 'attempt') payload.answer = String(data.get('answer') || '');
    if (kind === 'open' && data.has('code')) payload.code = String(data.get('code') || '');
    if (kind === 'examine') { payload.examId = form.dataset.exam; payload.code = propCodes.get(`${eventId()}:${nodeId}`); if (!payload.code) throw new Error('Identify this prop before examining it.'); }
    if (kind === 'hint') payload.hintIndex = Number(form.dataset.hint);
    for (const field of ['answer', 'code']) if (data.has(field)) drafts.set(draftKey(nodeId, field), String(data.get(field) || ''));
    return payload;
  }
  function scanModal() {
    cleanupModal();
    openModal('Identify an adventure prop', `<p class="hint">Scan the prop’s QR code, choose a photo, or enter its printed code. Your character’s access is checked before anything is revealed.</p>${err}<div class="adv-scanner"><video id="adv-scanner-video" muted playsinline hidden></video><p class="hint" id="adv-scanner-status" role="status">The camera stays off until you choose Start camera.</p><div class="actions"><button data-action="adv-camera">Start camera</button><button data-action="adv-camera-stop" hidden>Stop camera</button></div><label>Read a QR image<input id="adv-scan-file" type="file" accept="image/png,image/jpeg,image/webp"></label><form id="adv-scan-form">${err}<label>Prop code or ORACLE prop link<input name="propCode" required maxlength="500" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"></label><button class="primary" type="submit">Open prop</button></form></div>`);
    document.querySelector('#modal').classList.add('wide-modal');
  }
  async function lookupInput(value, expectedModalEpoch) {
    const stillOpen = () => expectedModalEpoch === undefined || expectedModalEpoch === modalEpoch;
    if (!stillOpen()) return;
    const parsed = parsePropInput(value, location.origin, state.event?.id);
    if (!parsed.eventId) throw new Error('Open an event before entering a printed prop code.');
    if (state.event?.id !== parsed.eventId) { await loadEvent(parsed.eventId); if (!stillOpen()) return; await open(); }
    else if (!snapshot || snapshot.event.id !== parsed.eventId || preview) await open();
    if (!stillOpen()) return;
    if (!snapshot.character) throw new Error('An approved character assigned to you is needed to use this prop.');
    const query = new URLSearchParams({ code: parsed.code, characterId: snapshot.character.id });
    const result = await fetchSnapshot(`${base(parsed.eventId)}/lookup?${query}`);
    if (!stillOpen()) return;
    if (!result.focusNodeId) throw new Error('This prop is not available to your character.');
    propCodes.set(`${parsed.eventId}:${result.focusNodeId}`, parsed.code); focusNodeId = result.focusNodeId; kiosk = false; feedback = null;
    applySnapshot(result); scanDirty = false; closeModal(true); render();
  }
  function scannerError(error) { const label = document.querySelector('#adv-scanner-status'); if (label) label.textContent = error.message || String(error); else toast(error.message || 'This prop could not be read.'); }
  async function camera() {
    if (scannerController || scanBusy) return;
    const currentEpoch = modalEpoch, video = document.querySelector('#adv-scanner-video'), controller = new AbortController(); scannerController = controller;
    video.hidden = false; document.querySelector('#adv-scanner-status').textContent = 'Requesting camera access…';
    document.querySelector('[data-action="adv-camera"]').hidden = true; document.querySelector('[data-action="adv-camera-stop"]').hidden = false;
    const stop = await startScanner(video, (value) => {
      if (currentEpoch !== modalEpoch) return;
      stopCamera(); if (scanBusy) return; scanBusy = true;
      document.querySelector('#adv-scanner-status').textContent = 'Checking your character’s access…';
      void lookupInput(value, currentEpoch).catch((error) => { if (currentEpoch === modalEpoch) scannerError(error); }).finally(() => { if (currentEpoch === modalEpoch) scanBusy = false; });
    }, (error) => { if (currentEpoch === modalEpoch) { stopCamera(); scannerError(error); } }, { signal: controller.signal });
    if (controller.signal.aborted || currentEpoch !== modalEpoch) { stop(); return; }
    scannerStop = stop; document.querySelector('#adv-scanner-status').textContent = 'Point the camera at the prop’s QR code.';
  }
  function stopCamera() {
    scannerController?.abort(); scannerController = null; scannerStop?.(); scannerStop = null;
    const video = document.querySelector('#adv-scanner-video'); if (video) video.hidden = true;
    const start = document.querySelector('[data-action="adv-camera"]'), stop = document.querySelector('[data-action="adv-camera-stop"]');
    if (start) start.hidden = false; if (stop) stop.hidden = true;
  }
  function cleanupModal() { modalEpoch++; stopCamera(); scanDirty = false; scanBusy = false; if (state.session?.user?.id !== accountId) ensureAccount(); }
  function reset() {
    cleanupModal(); accountId = null; snapshot = null; focusNodeId = null; kiosk = false; preview = false; feedback = null;
    inputDirty = false; scanDirty = false; drafts.clear(); propCodes.clear(); pendingActions.clear(); cooldowns.clear(); epoch++;
    for (const timer of timers) clearTimeout(timer); timers.clear();
  }
  function confirmDiscard() {
    if ((inputDirty || scanDirty) && !window.confirm('Leave your unsubmitted answer or prop code?')) return false;
    if (pendingActions.size && !window.confirm('An action is waiting for a confirmed response. You can return to this character and retry it while this page remains open. Leave this view?')) return false;
    inputDirty = false; scanDirty = false; return true;
  }
  async function handleHash() {
    if (!location.hash.startsWith('#prop/') || !state.session?.user) return false;
    if (!confirmDiscard()) { history.replaceState(null, '', `${location.pathname}${location.search}`); return true; }
    try { await lookupInput(`${location.origin}/${location.hash}`); }
    catch (error) { toast(error.message || 'This prop could not be opened. Check your event membership and character.'); }
    if (state.session?.user) history.replaceState(null, '', `${location.pathname}${location.search}`);
    return true;
  }
  async function action(button) {
    const name = button.dataset.action; if (!name?.startsWith('adv-')) return false;
    ensureAccount();
    switch (name) {
      case 'adv-open': await open(); break;
      case 'adv-event': if (confirmDiscard()) await loadEvent(state.event.id); break;
      case 'adv-refresh': await refresh(); break;
      case 'adv-focus': focusNodeId = button.dataset.id; kiosk = false; feedback = null; render(); document.querySelector('.adv-focused')?.scrollIntoView({ block: 'start' }); break;
      case 'adv-all': focusNodeId = null; kiosk = false; feedback = null; render(); break;
      case 'adv-kiosk': kiosk = true; render(); break;
      case 'adv-kiosk-exit': kiosk = false; render(); break;
      case 'adv-fullscreen': try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.querySelector('.adventure-player').requestFullscreen(); } catch { toast('Full screen is unavailable. Prop view is still active.'); } break;
      case 'adv-scan': if (!connected()) throw new Error('Reconnect to identify a prop.'); scanModal(); break;
      case 'adv-camera': void camera().catch(scannerError); break;
      case 'adv-camera-stop': modalEpoch++; stopCamera(); document.querySelector('#adv-scanner-status').textContent = 'Camera stopped. Enter a code or choose a QR image.'; break;
      case 'adv-retry': await execute(null, true); break;
    }
    return true;
  }
  async function submit(form) {
    if (!form.id.startsWith('adv-')) return false;
    if (form.id === 'adv-character-form') { if (confirmDiscard()) { const characterId = new FormData(form).get('characterId'); await open({ characterId, preview }); } }
    else if (form.id === 'adv-scan-form') { if (scanBusy) throw new Error('Wait for the current prop lookup to finish.'); stopCamera(); scanBusy = true; const currentEpoch = modalEpoch; try { await lookupInput(new FormData(form).get('propCode'), currentEpoch); } finally { if (currentEpoch === modalEpoch) scanBusy = false; } }
    else if (form.classList.contains('adv-action-form')) await execute(captureForm(form));
    return true;
  }
  document.addEventListener('input', (event) => {
    const form = event.target.closest('.adv-action-form');
    if (form && ['answer', 'code'].includes(event.target.name)) { drafts.set(draftKey(form.dataset.node, event.target.name), event.target.value); inputDirty = [...drafts.values()].some(Boolean); }
    if (event.target.closest('#adv-scan-form')) scanDirty = true;
  });
  document.addEventListener('change', async (event) => {
    if (event.target.id !== 'adv-scan-file') return;
    const file = event.target.files?.[0]; if (!file || scanBusy) return;
    const currentEpoch = modalEpoch; stopCamera(); scanBusy = true;
    document.querySelector('#adv-scanner-status').textContent = 'Reading the QR image…';
    try { const value = await scanImage(file); if (currentEpoch === modalEpoch) await lookupInput(value, currentEpoch); }
    catch (error) { if (currentEpoch === modalEpoch) scannerError(error); }
    finally { if (currentEpoch === modalEpoch) scanBusy = false; }
  });
  window.addEventListener('pagehide', cleanupModal);
  window.addEventListener('beforeunload', (event) => { if (inputDirty || scanDirty || pendingActions.size) { event.preventDefault(); event.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
  return { open, render, action, submit, handleHash, cleanupModal, confirmDiscard, reset, isDirty: () => inputDirty || scanDirty || pendingActions.size > 0 };
}
