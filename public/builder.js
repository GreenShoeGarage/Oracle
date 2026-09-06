import { THEMES, TEMPLATES, INSTRUMENTS, defaultSetup, validateSetup, validateEventPack, projectSetup } from './kit.js';

const clone = (value) => structuredClone(value);
const icons = { sigil: '✦', chip: '◈', compass: '✥' };
const fonts = { serif: 'Georgia, Cambria, serif', sans: 'system-ui, sans-serif', mono: 'ui-monospace, SFMono-Regular, Consolas, monospace' };
const readPreference = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
const savePreference = (key, value) => { try { localStorage.setItem(key, value); } catch {} };

export function createKitUI(ctx) {
  const { state, api, shell, esc, openModal, closeModal, loadEvent, toast, isManager, err } = ctx;
  let draft = null, step = 0, editing = false, dirty = false, importPack = null, preview = null;
  let eventId = null, mode = 'organizer';
  const preferences = { display: readPreference('oracle-display', 'dark'), motion: readPreference('oracle-motion', 'system'), collapsed: readPreference('oracle-controls', 'open') };
  const root = document.documentElement;

  function applyTheme(theme) {
    const t = theme?.tokens || THEMES[0].tokens;
    for (const [key, token] of Object.entries({ bg: 'background', panel: 'panel', text: 'text', muted: 'muted', accent: 'accent' })) root.style.setProperty(`--${key}`, t[token]);
    root.style.setProperty('--heading-font', fonts[t.font] || fonts.sans);
    root.dataset.texture = t.texture;
    root.dataset.display = preferences.display;
    root.dataset.motion = preferences.motion;
    root.dataset.controls = preferences.collapsed;
    root.dataset.prop = String(state.view === 'detail' && mode === 'prop');
    document.querySelector('meta[name="theme-color"]').content = preferences.display === 'outdoor' ? '#ffffff' : t.background;
  }
  function apply() { applyTheme(['detail', 'characters', 'adventure', 'adventure-manage', 'exchanges', 'sharing', 'story', 'trace', 'bazaar', 'oaths'].includes(state.view) ? state.event?.setup?.theme : THEMES[0]); document.querySelector('[data-action="kit-collapse"]')?.setAttribute("aria-expanded", String(preferences.collapsed === "open")); }
  function controls() {
    return `<details class="display-controls"><summary>Reading settings</summary><div class="reading-options"><label>Display<select data-preference="display"><option value="dark" ${preferences.display === 'dark' ? 'selected' : ''}>Dark</option><option value="outdoor" ${preferences.display === 'outdoor' ? 'selected' : ''}>Outdoor · high contrast</option></select></label><label>Motion<select data-preference="motion"><option value="system" ${preferences.motion === 'system' ? 'selected' : ''}>Follow device</option><option value="reduce" ${preferences.motion === 'reduce' ? 'selected' : ''}>Reduce motion</option></select></label></div></details>`;
  }
  function toolbar() {
    return `<div class="kit-toolbar"><div class="view-switch" aria-label="Event view">${isManager() ? `<button data-action="kit-view" data-mode="organizer" aria-pressed="${mode === 'organizer'}">Organizer</button>` : ''}<button data-action="kit-view" data-mode="player" aria-pressed="${mode === 'player'}">${isManager() ? 'Player preview' : 'Player'}</button><button data-action="kit-view" data-mode="prop" aria-pressed="${mode === 'prop'}">Prop display</button></div><span class="save-status" role="status"><span class="save-dot"></span>Saved to event</span></div>`;
  }
  function rulesSummary(rules, theme) {
    const list = (items, ranged) => items.length ? `<ul class="rule-list">${items.map(x => `<li><strong>${esc(x.name)}</strong><span>${ranged ? `${x.min}–${x.max} · starts at ${x.default}` : esc(x.description || '')}</span></li>`).join('')}</ul>` : '<p class="hint">None defined.</p>';
    return `<details class="panel rules-panel"><summary>Rules profile</summary><p class="hint">These are the event’s definitions. Character values use these definitions. Adventure examinations can require an expertise.</p><div class="rule-columns"><section><h3>Attributes</h3>${list(rules.attributes, true)}</section><section><h3>${esc(theme.terms.expertise)}</h3>${list(rules.expertise, false)}</section><section><h3>${esc(theme.terms.resources)}</h3>${list(rules.resources, true)}</section><section><h3>Challenge outcomes</h3>${list(rules.outcomes, false)}</section></div></details>`;
  }
  function contentCards(setup, audience) {
    if (!setup.enabledInstruments.includes('briefing')) return '<section class="panel"><h2>Briefing is turned off</h2><p class="hint">Open Adventure to use the available field instruments.</p></section>';
    const items = projectSetup(setup, audience).content;
    return items.length ? items.map(x => `<article class="panel reading-card"><p class="eyebrow">${esc(setup.theme.terms.briefing)}${audience === 'organizer' ? (x.visibility === 'organizer' ? ' · Organizer only' : ' · Player material') : ''}${audience === 'organizer' && x.prop ? ' · Prop display' : ''}</p><h2>${esc(x.title)}</h2><p class="prose">${esc(x.body)}</p></article>`).join('') : `<section class="panel"><h2>${audience === 'prop' ? 'No prop material published yet.' : 'Your briefing is being prepared.'}</h2><p class="hint">${audience === 'prop' ? 'Your organizer can mark player material for the prop display.' : 'Return here when your organizer adds material.'}</p></section>`;
  }
  function enhanceOrganizer() {
    const workspace = document.querySelector('.workspace');
    workspace.querySelector('.topbar').insertAdjacentHTML('afterend', toolbar());
    const ev = state.event, setup = ev.setup || defaultSetup();
    const panel = `<section class="panel kit-overview"><div class="panel-head"><div><p class="eyebrow">${esc(setup.theme.name)} field kit</p><h2><span aria-hidden="true">${icons[setup.theme.tokens.icon] || '✦'}</span> Build the world your players will see.</h2></div>${ev.status !== 'archived' ? '<button class="primary" data-action="kit-edit">Edit field kit</button>' : ''}</div><p class="hint">${setup.content.length} material records · ${setup.enabledInstruments.length} enabled instrument${setup.enabledInstruments.length === 1 ? '' : 's'}. Theme changes preserve your rules and records.</p><div class="actions mt"><button data-action="kit-theme">Change theme</button><button data-action="kit-export" data-audience="organizer">Export organizer briefing pack</button><button data-action="kit-export" data-audience="player">Export player material</button></div><p class="hint">A briefing pack contains event setup and briefing text. Adventure puzzles, characters, inventory, discoveries, and account records stay in this event. Use a rehearsal copy to practice an adventure.</p></section>`;
    workspace.querySelector('.detail-grid').insertAdjacentHTML('beforebegin', panel);
    workspace.insertAdjacentHTML('beforeend', `<details class="panel authored-material"><summary>Authored material · ${setup.content.length}</summary><div class="stack mt">${contentCards(setup, 'organizer')}</div></details>${rulesSummary(setup.rules, setup.theme)}`);
    if (ev.status === 'archived') workspace.querySelector('[data-action="kit-theme"]').disabled = true;
  }
  function renderPlayer() {
    const ev = preview || state.event, setup = ev.setup || defaultSetup();
    const prop = mode === 'prop';
    const people = !isManager() ? `<details class="panel"><summary>${esc(setup.theme.terms.people)} · ${state.members.length}</summary><ul class="member-list">${state.members.map(m => `<li><span>${esc(m.display_name)} <span class="role">${esc(m.role)}</span></span>${m.user_id === state.session.user.id && m.role !== 'owner' ? `<button class="quiet" data-action="remove-member" data-id="${esc(m.user_id)}">Leave event</button>` : ''}</li>`).join('')}</ul></details>` : '';
    const content = `${toolbar()}${prop ? '<div class="actions prop-actions"><button data-action="kit-fullscreen">Toggle fullscreen</button><button data-action="kit-view" data-mode="player">Exit prop display</button></div>' : '<button class="quiet" data-action="events">← My events</button>'}<header class="world-header"><span class="world-icon" aria-hidden="true">${icons[setup.theme.tokens.icon] || '✦'}</span><p class="eyebrow">${esc(setup.theme.name)} · ${esc(ev.status)}</p><h1>${esc(ev.name)}</h1><p class="prose">${esc(ev.description)}</p>${!prop ? `<p class="hint">${esc(ev.location || 'Location to be announced')}${ev.starts_at ? ' · ' + esc(new Date(ev.starts_at).toLocaleString()) : ''}</p>` : ''}</header>${isManager() ? `<p class="preview-banner">${prop ? 'Prop' : 'Player'} preview · organizer-only material is excluded.</p>` : ''}<div class="reading-stack">${contentCards(setup, prop ? 'prop' : 'player')}</div>${!prop ? `${rulesSummary(setup.rules, setup.theme)}${people}<div class="actions mt"><button data-action="kit-export" data-audience="player">Download player material</button><button data-action="kit-refresh">Refresh briefing</button>${setup.theme.sounds.enabled ? '<button data-action="kit-sound">Play theme cue</button>' : ''}</div>` : ''}`;
    shell(content);
  }
  function enterEvent(ev) {
    if (eventId !== ev.id) { mode = ['owner', 'organizer', 'superuser'].includes(ev.role) ? 'organizer' : 'player'; eventId = ev.id; }
    if (!['owner', 'organizer', 'superuser'].includes(ev.role) && mode === 'organizer') mode = 'player';
    preview = null;
  }
  function saveIndicator(label = 'Unsaved changes', saving = false) {
    const el = document.querySelector('#kit-save');
    if (el) { el.textContent = label; el.dataset.saving = String(saving); }
  }
  function resetDraft() { draft = null; importPack = null; dirty = false; step = 0; apply(); }
  function confirmDiscard() {
    if (dirty && !window.confirm('Discard your unsaved field kit changes?')) return false;
    resetDraft(); return true;
  }
  function startBuilder(edit = false) {
    editing = edit; step = 0; dirty = false;
    draft = edit ? { name: state.event.name, description: state.event.description, location: state.event.location, startsAt: state.event.starts_at, setup: clone(state.event.setup), version: state.event.version } : { name: '', description: '', location: '', startsAt: null, setup: defaultSetup() };
    showStep();
  }
  function choice(value, selected) { return value === selected ? 'selected' : ''; }
  function field(name, label, value, extra = '') { return `<label>${label}<input name="${esc(name)}" value="${esc(value)}" ${extra}></label>`; }
  function showStep() {
    const s = draft.setup;
    const steps = ['World', 'Event', 'Material & rules', 'Review'];
    const themeTiles = THEMES.map(t => `<label class="theme-choice" data-theme-tile="${esc(t.id)}"><input type="radio" name="themeId" value="${esc(t.id)}" ${t.id === s.theme.id ? 'checked' : ''}><span class="theme-icon" aria-hidden="true">${icons[t.tokens.icon]}</span><strong>${esc(t.name)}</strong><span class="hint">${esc(t.terms.briefing)} · ${esc(t.terms.people)}</span></label>`).join('');
    let content;
    if (step === 0) content = `<fieldset><legend>Choose the world’s appearance</legend><div class="theme-choices">${themeTiles}${!THEMES.some(t => t.id === s.theme.id) ? `<label class="theme-choice"><input type="radio" name="themeId" value="${esc(s.theme.id)}" checked><strong>${esc(s.theme.name)}</strong><span class="hint">Imported theme</span></label>` : ''}</div></fieldset><p class="hint">Your theme changes the look and language. Rules and authored records stay the same.</p>${!editing ? `<label>Starting template<select name="templateId">${TEMPLATES.map(t => `<option value="${esc(t.id)}" ${choice(t.id, s.templateId)}>${esc(t.name)}</option>`).join('')}</select></label><p class="hint">Templates provide a small briefing to edit. They are starting points, not complete adventures.</p>` : `<p class="hint">Template: ${esc(s.templateId)}. Edit the existing content in the next steps.</p>`}<label class="check-line"><input type="checkbox" name="themeSound" ${s.theme.sounds.enabled ? 'checked' : ''}> Offer a theme sound cue button <span class="hint">(plays only when tapped)</span></label>`;
    else if (step === 1) {
      const local = draft.startsAt ? new Date(new Date(draft.startsAt).getTime() - new Date(draft.startsAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
      content = `${field('name', 'Event name', draft.name, 'required minlength="2" maxlength="100" placeholder="The Last Signal"')}<label>Public event briefing<textarea name="description" maxlength="2000">${esc(draft.description)}</textarea></label>${field('location', 'Location', draft.location, 'maxlength="200"')}${field('startsAt', 'Starts · your local time', local, 'type="datetime-local"')}<p class="hint">These details are visible to every event member.</p>`;
    } else if (step === 2) content = `<fieldset><legend>Available instruments</legend>${INSTRUMENTS.filter(i => i.available).map(i => `<label class="check-line"><input type="checkbox" name="instrument" value="${esc(i.id)}" ${s.enabledInstruments.includes(i.id) ? 'checked' : ''}>${esc(i.name)}</label>`).join('')}<p class="hint">More instruments arrive in later releases. You can prepare their story material here now.</p></fieldset><div class="panel-head"><h3>Authored material</h3><button type="button" data-action="kit-add-content" ${s.content.length >= 20 ? 'disabled' : ''}>+ Add material</button></div>${s.content.map((x, i) => `<details class="content-editor" open><summary>Material ${i + 1} · ${esc(x.title || 'Untitled')}</summary><div class="editor-fields" data-content="${i}">${field(`content-title-${i}`, 'Title', x.title, 'required maxlength="120"')}<label>Text<textarea name="content-body-${i}" maxlength="6000">${esc(x.body)}</textarea></label><div class="two-fields"><label>Who can read it?<select name="content-visibility-${i}"><option value="player" ${choice(x.visibility, 'player')}>Players and organizers</option><option value="organizer" ${choice(x.visibility, 'organizer')}>Organizer only</option></select></label><label class="check-line"><input type="checkbox" name="content-prop-${i}" ${x.prop ? 'checked' : ''} ${x.visibility === 'organizer' ? 'disabled' : ''}> Include in prop display</label></div><button type="button" class="quiet danger" data-action="kit-remove-content" data-index="${i}">Remove material ${i + 1}</button></div></details>`).join('')}<p class="hint">Material and rule labels use plain text. HTML and angle brackets are not accepted.</p>${ruleEditor(s.rules)}`;
    else content = `<section class="review-summary"><p class="eyebrow">${esc(s.theme.name)} · ${editing ? 'Update event' : 'New draft event'}</p><h3>${esc(draft.name)}</h3><p class="prose">${esc(draft.description)}</p><p class="hint">${s.content.filter(x => x.visibility === 'player').length} player records · ${s.content.filter(x => x.visibility === 'organizer').length} organizer-only records · ${s.enabledInstruments.length} enabled instruments</p></section><details class="panel" open><summary>Preview player material</summary><div class="stack mt">${contentCards(s, 'player')}</div></details>${rulesSummary(s.rules, s.theme)}<p class="hint">${editing ? 'Saving keeps this event’s identity, memberships, invitations, and activity history.' : 'Create adds a new draft event owned by you. Invite people when you are ready.'}</p>`;
    openModal(editing ? 'Edit your field kit' : 'Build an event', `<div class="wizard-progress" aria-label="Setup progress">${steps.map((x, i) => `<span ${step === i ? 'aria-current="step"' : ''}>${i + 1}. ${x}</span>`).join('')}</div><form id="kit-form">${err}<span id="kit-save" class="save-status" role="status">${dirty ? 'Unsaved changes' : 'Draft · not saved yet'}</span>${content}<div class="wizard-actions">${step ? '<button type="button" data-action="kit-back">← Back</button>' : '<button type="button" class="quiet" data-action="close">Cancel</button>'}<button class="primary" type="submit">${step === 3 ? (editing ? 'Save field kit' : 'Create event') : 'Continue →'}</button></div></form>`);
    document.querySelector('#modal').classList.add('wide-modal');
    applyTheme(s.theme);
  }
  function ruleEditor(rules) {
    return `<details class="rules-editor"><summary>Edit rules profile</summary><p class="hint">Define starting ranges and named expertise. These are bounded definitions; they do not execute code or automatically resolve challenges.</p>${['attributes', 'expertise', 'resources', 'outcomes'].map(group => `<section class="rule-group"><div class="panel-head"><h3>${group[0].toUpperCase() + group.slice(1)}</h3><button type="button" data-action="kit-add-rule" data-group="${group}" ${rules[group].length >= (group === 'expertise' ? 24 : 12) ? 'disabled' : ''}>+ Add</button></div>${rules[group].map((r, i) => `<div class="rule-editor-row" data-rule="${group}-${i}"><span class="hint rule-id">ID: ${esc(r.id)}</span>${field(`${group}-name-${i}`, 'Name', r.name, 'required maxlength="60"')}${['attributes', 'resources'].includes(group) ? `<div class="three-fields">${['min', 'max', 'default'].map(k => field(`${group}-${k}-${i}`, { min: 'Minimum', max: 'Maximum', default: 'Starting value' }[k], r[k], 'type="number" required min="-1000000" max="1000000" step="any"')).join('')}</div>` : group === 'outcomes' ? `<label>Description<textarea name="${group}-description-${i}" maxlength="1000">${esc(r.description)}</textarea></label>` : ''}<button type="button" class="quiet danger" data-action="kit-remove-rule" data-group="${group}" data-index="${i}">Remove ${esc(r.name || group.slice(0, -1))}</button></div>`).join('')}</section>`).join('')}</details>`;
  }
  function capture() {
    const form = document.querySelector('#kit-form'); if (!form) return;
    const data = new FormData(form), s = draft.setup;
    if (step === 0) {
      const themeId = data.get('themeId') || s.theme.id;
      const templateId = data.get('templateId') || s.templateId;
      if (!editing && templateId !== s.templateId) {
        const hasMaterial = s.content.length || Object.values(s.rules).some(v => Array.isArray(v) && v.length);
        if (hasMaterial && !window.confirm('Replace your draft material and rules with this template?')) { form.elements.templateId.value = s.templateId; return false; }
        draft.setup = defaultSetup(themeId, templateId);
      }
      else if (themeId !== s.theme.id) draft.setup.theme = clone(THEMES.find(t => t.id === themeId));
      draft.setup.theme.sounds.enabled = data.has('themeSound');
    } else if (step === 1) {
      for (const key of ['name', 'description', 'location']) draft[key] = String(data.get(key) || '');
      draft.startsAt = data.get('startsAt') ? new Date(data.get('startsAt')).toISOString() : null;
    } else if (step === 2) {
      s.enabledInstruments = data.getAll('instrument');
      s.content.forEach((x, i) => { x.title = String(data.get(`content-title-${i}`) || ''); x.body = String(data.get(`content-body-${i}`) || ''); const beforeVisibility = x.visibility; x.visibility = data.get(`content-visibility-${i}`); x.prop = x.visibility === 'organizer' && beforeVisibility === 'organizer' ? x.prop : x.visibility === 'player' && data.has(`content-prop-${i}`); });
      for (const group of ['attributes', 'expertise', 'resources', 'outcomes']) s.rules[group].forEach((r, i) => { r.name = String(data.get(`${group}-name-${i}`) || ''); if (['attributes', 'resources'].includes(group)) for (const k of ['min', 'max', 'default']) r[k] = Number(data.get(`${group}-${k}-${i}`)); if (group === 'outcomes') r.description = String(data.get(`${group}-description-${i}`) || ''); });
    }
  }
  async function submit(form) {
    if (form.id === 'kit-form') {
      if (capture() === false) return true; dirty = true;
      if (step < 3) { if (step === 2) draft.setup = validateSetup(draft.setup); step++; showStep(); return true; }
      draft.setup = validateSetup(draft.setup);
      saveIndicator('Saving…', true);
      try {
        const result = await api(editing ? `/api/events/${state.event.id}` : '/api/events', editing ? 'PATCH' : 'POST', draft);
        resetDraft(); closeModal(true); await loadEvent(result.event.id); toast(editing ? 'Field kit saved.' : 'Your event is ready. Preview it, then invite your players.');
      } catch (error) { saveIndicator('Not saved · your draft is still here'); throw error; }
      return true;
    }
    if (form.id === 'kit-import-form') {
      if (!importPack) throw new Error('Choose and validate an event pack first.');
      const { event } = await api('/api/events/import', 'POST', { pack: importPack });
      resetDraft(); closeModal(true); await loadEvent(event.id); toast('Imported as a new draft event.'); return true;
    }
    if (form.id === 'kit-theme-form') {
      const selected = new FormData(form).get('themeId');
      const theme = THEMES.find(t => t.id === selected);
      if (!theme) throw new Error('Choose a theme.');
      await api(`/api/events/${state.event.id}`, 'PATCH', { version: state.event.version, theme });
      closeModal(true); await loadEvent(state.event.id); toast('Theme changed. Rules and records preserved.'); return true;
    }
    return false;
  }
  async function action(button) {
    const name = button.dataset.action;
    if (!name.startsWith('kit-')) return false;
    if (name === 'kit-create' || name === 'kit-edit') startBuilder(name === 'kit-edit');
    else if (name === 'kit-back') { capture(); step--; showStep(); }
    else if (name === 'kit-add-content' || name === 'kit-remove-content') { capture(); if (name === 'kit-add-content' && draft.setup.content.length < 20) draft.setup.content.push({ id: `material-${crypto.randomUUID()}`, title: '', body: '', visibility: 'player', prop: false }); else if (name === 'kit-remove-content') draft.setup.content.splice(Number(button.dataset.index), 1); dirty = true; showStep(); }
    else if (name === 'kit-add-rule' || name === 'kit-remove-rule') { capture(); const group = button.dataset.group; const rows = draft.setup.rules[group]; if (name === 'kit-remove-rule') rows.splice(Number(button.dataset.index), 1); else if (rows.length < (group === 'expertise' ? 24 : 12)) { const row = { id: `r-${crypto.randomUUID()}`, name: '' }; if (['attributes', 'resources'].includes(group)) Object.assign(row, { min: 0, max: 5, default: 0 }); if (group === 'outcomes') row.description = ''; rows.push(row); } dirty = true; showStep(); document.querySelector('.rules-editor').open = true; }
    else if (name === 'kit-view') { mode = button.dataset.mode; if (mode === 'organizer' && !isManager()) mode = 'player'; preview = mode === 'organizer' ? null : (await api(`/api/events/${state.event.id}/preview?audience=${mode}`)).event; ctx.render(); }
    else if (name === 'kit-refresh') { await loadEvent(state.event.id); toast('Briefing refreshed.'); }
    else if (name === 'kit-theme') openModal('Change event theme', `<form id="kit-theme-form">${err}<p>Change appearance and terminology while preserving all rules, content, and memberships.</p><label>Theme<select name="themeId">${THEMES.map(t => `<option value="${esc(t.id)}" ${choice(t.id, state.event.setup.theme.id)}>${esc(t.name)}</option>`).join('')}</select></label><button class="primary" type="submit">Apply theme</button></form>`);
    else if (name === 'kit-export') {
      const audience = button.dataset.audience;
      if (audience === 'organizer' && !window.confirm('Download an organizer backup containing private story material? Keep this file private.')) return true;
      const result = await api(`/api/events/${state.event.id}/pack?audience=${audience}`);
      const pack = result.pack || result;
      const url = URL.createObjectURL(new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `ORACLE-${audience}-${state.event.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast(audience === 'organizer' ? 'Organizer backup downloaded. Keep it private.' : 'Player material downloaded. Organizer notes are excluded.');
    } else if (name === 'kit-import') { importPack = null; openModal('Import an event pack', `<form id="kit-import-form">${err}<p>Import creates a new draft event owned by you. Existing events stay intact.</p><label>Event pack JSON<input id="kit-pack-file" type="file" accept=".json,application/json" required></label><p class="hint">Up to 200 kB of validated event data. ORACLE validates the format, rules, theme, and material before import.</p><div id="kit-import-preview" role="status"></div><button class="primary" type="submit" disabled>Create from pack</button></form>`); }
    else if (name === 'kit-collapse') { preferences.collapsed = preferences.collapsed === 'open' ? 'closed' : 'open'; savePreference('oracle-controls', preferences.collapsed); apply(); button.setAttribute('aria-expanded', String(preferences.collapsed === 'open')); }
    else if (name === 'kit-fullscreen') { if (document.fullscreenElement) await document.exitFullscreen(); else { try { await document.documentElement.requestFullscreen(); } catch { toast('Fullscreen is unavailable. Prop display still fills the page.'); } } }
    else if (name === 'kit-sound') {
      const theme = state.event.setup.theme; if (!theme.sounds.enabled) return true;
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) { toast('Sound cues are not supported on this device.'); return true; }
      const audio = new Audio(); await audio.resume(); const oscillator = audio.createOscillator(), gain = audio.createGain(); oscillator.type = theme.sounds.cue === 'pulse' ? 'triangle' : 'sine'; oscillator.frequency.value = { bell: 660, pulse: 220, click: 440 }[theme.sounds.cue]; gain.gain.setValueAtTime(0.08, audio.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.3); oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + 0.32); oscillator.onended = () => audio.close();
    }
    return true;
  }
  document.addEventListener('input', e => { if (e.target.closest('#kit-form')) { dirty = true; saveIndicator(); } });
  document.addEventListener('change', async e => {
    if (e.target.dataset.preference) { const key = e.target.dataset.preference; preferences[key] = e.target.value; savePreference(`oracle-${key}`, e.target.value); apply(); }
    if (e.target.name?.startsWith('content-visibility-')) { const i = e.target.name.split('-').pop(); const prop = document.querySelector(`[name="content-prop-${i}"]`); prop.disabled = e.target.value === 'organizer'; if (prop.disabled) prop.checked = false; }
    if (e.target.name === 'themeId' && e.target.closest('#kit-form')) { const t = THEMES.find(t => t.id === e.target.value); if (t) applyTheme(t); }
    if (e.target.id === 'kit-pack-file') {
      const form = e.target.form, submitButton = form.querySelector('[type="submit"]'), area = document.querySelector('#kit-import-preview');
      importPack = null; submitButton.disabled = true; area.textContent = ''; form.querySelector('.error').textContent = '';
      try {
        const file = e.target.files[0]; if (!file) return; if (file.size > 262144) throw new Error('This file is too large. Choose a pack below 256 KiB.');
        importPack = validateEventPack(JSON.parse(await file.text()));
        area.innerHTML = `<section class="panel"><h3>${esc(importPack.event.name)}</h3><p>${esc(importPack.setup.theme.name)} · ${importPack.setup.content.length} records</p><p class="hint">${importPack.audience === 'organizer' ? 'Organizer backup: includes private story material.' : 'Player material: contains only player-safe records.'}</p><p class="hint">Ready to create a new draft. Members and invitation codes are not imported.</p></section>`;
        submitButton.disabled = false;
      } catch (error) { importPack = null; form.querySelector('.error').textContent = `Cannot import: ${error.message}`; }
    }
  });
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  return { apply, controls, enhanceOrganizer, renderPlayer, enterEvent, isOrganizerView: () => mode === 'organizer', action, submit, startBuilder, confirmDiscard, isDirty: () => dirty, resetDraft };
}
