import { defaultCharacterProfile, defaultCharacterSettings, validateCharacterProfile, PUBLIC_CHARACTER_FIELDS } from './characters-model.js';
import { renderBadgeQR, scanImage, startScanner, parseBadgeInput } from './qr.js';

const statusNames = { draft: 'Draft', pending: 'Awaiting approval', approved: 'Approved', changes_requested: 'Changes requested', retired: 'Retired' };
const fieldNames = { portrait: 'Portrait', pronouns: 'Pronouns', biography: 'Biography', faction: 'Faction', skills: 'Skills' };
const clone = (value) => structuredClone(value);

export function createCharacterUI(ctx) {
  const { state, api, shell, esc, openModal, closeModal, loadEvent, toast, isManager, err } = ctx;
  let characters = [], factions = [], settings = defaultCharacterSettings(), loadedEventId = null;
  let selected = null, inventory = [], draft = null, step = 0, dirty = false, portraitBusy = false;
  let scannerStop = null, scannerController = null, modalEpoch = 0, shownBadge = null;
  const base = () => `/api/events/${state.event.id}`;
  const path = (id) => `${base()}/characters/${id}`;
  const rules = () => state.event?.setup?.rules || { attributes: [], expertise: [] };
  const mutable = () => state.event?.status !== 'archived';
  const mine = (character) => character.userId === state.session.user.id;
  const factionName = (id) => factions.find((item) => item.id === id)?.name || 'No faction';
  const memberName = (id) => id ? (state.members.find((member) => member.user_id === id)?.display_name || 'Event member') : 'Unassigned';
  const skillName = (id) => rules().expertise.find((item) => item.id === id)?.name || id;
  const status = (value) => `<span class="badge character-status ${esc(value)}">${esc(statusNames[value] || value)}</span>`;
  const avatar = (profile, small = false) => profile.portrait ? `<img class="character-avatar ${small ? 'small' : ''}" src="${esc(profile.portrait)}" alt="Portrait of ${esc(profile.name)}">` : `<span class="character-avatar ${small ? 'small' : ''}" aria-hidden="true">${esc((profile.name || '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase())}</span>`;
  const field = (name, label, value, attrs = '') => `<label>${esc(label)}<input name="${esc(name)}" value="${esc(value)}" ${attrs}></label>`;
  function wideModal(title, content) { cleanupModal(false); openModal(title, content); document.querySelector('#modal').classList.add('wide-modal'); }
  function markDirty() { dirty = true; saveIndicator('Unsaved changes'); }
  function saveIndicator(label, saving = false) {
    const element = document.querySelector('#character-save');
    if (element) { element.textContent = label; element.dataset.saving = String(saving); }
  }
  async function refresh() {
    const result = await api(`${base()}/characters`);
    characters = result.characters; settings = result.settings; factions = result.factions; loadedEventId = state.event.id;
  }
  async function open() { await refresh(); state.view = 'characters'; render(); }
  function card(character) {
    const full = character.visibility === 'private', p = character.profile;
    return `<button class="character-card" data-action="character-sheet" data-id="${esc(character.id)}">${avatar(p, true)}<span class="character-card-body"><strong>${esc(p.name)}</strong><span class="hint">${esc(full ? factionName(p.factionId) : (p.faction?.name || ''))}</span>${full ? `<span class="hint">${mine(character) ? 'Your character' : esc(memberName(character.userId))}</span>` : ''}</span>${status(character.status)}</button>`;
  }
  function render() {
    if (loadedEventId !== state.event?.id) { shell('<p role="status">Loading characters…</p>'); return; }
    const privateCharacters = characters.filter((character) => character.visibility === 'private');
    const publicCharacters = characters.filter((character) => character.visibility === 'public');
    const activeOwned = privateCharacters.filter((character) => mine(character) && character.status !== 'retired').length;
    const canCreate = mutable() && (isManager() || (settings.allowPlayerCreation && activeOwned < settings.maxPerPlayer));
    shell(`<div class="actions"><button class="quiet" data-action="character-back-event">← Event briefing</button></div><header class="page-head mt"><div><p class="eyebrow">${esc(state.event.name)}</p><h1>Characters</h1><p class="muted">Build your place in the story. Meet the people behind the other badges.</p></div><div class="actions"><button data-action="character-scan">Scan a badge</button><button data-action="character-refresh">Refresh</button>${canCreate ? '<button class="primary" data-action="character-create">+ Create character</button>' : ''}</div></header>${!mutable() ? '<p class="preview-banner">This archived event is read-only.</p>' : ''}<section class="character-section"><div class="panel-head"><h2>${isManager() ? 'Character sheets' : 'Your characters'}</h2><span class="hint">${privateCharacters.length}</span></div><p class="hint">${isManager() ? 'Private sheets, review notes, and inventory are visible to the assigned player and event managers.' : `Your full sheet is private to you and event managers. Up to ${settings.maxPerPlayer} active character${settings.maxPerPlayer === 1 ? '' : 's'} per player.`}</p>${privateCharacters.length ? `<div class="character-grid mt">${privateCharacters.map(card).join('')}</div>` : `<div class="empty mt"><h3>${isManager() ? 'Give this world its characters.' : 'Your story starts here.'}</h3><p>${canCreate ? 'Create a character, or ask your organizer to assign one to you.' : 'Your organizer can assign a character to you.'}</p>${canCreate ? '<button class="primary" data-action="character-create">Create a character</button>' : ''}</div>`}${!settings.allowPlayerCreation && !isManager() ? '<p class="hint mt">Your organizer is assigning characters for this event.</p>' : ''}</section><section class="character-section"><div class="panel-head"><h2>Meet the cast</h2><span class="hint">Approved public identities</span></div><p class="hint">Only the fields chosen by your organizer appear on public cards. Badge links require membership in this event.</p>${publicCharacters.length ? `<div class="character-grid mt">${publicCharacters.map(card).join('')}</div>` : `<p class="hint mt">${isManager() ? 'Open an approved sheet and choose Public badge to see its public identity.' : 'Other approved characters will appear here.'}</p>`}</section>${isManager() ? management() : ''}`);
  }
  function management() {
    const disabled = mutable() ? '' : 'disabled';
    return `<details class="panel character-management"><summary>Character settings & factions</summary><div class="character-management-grid mt"><section><h3>Creation and visibility</h3><form id="character-settings-form" class="mt">${err}<fieldset ${disabled}><legend>Character creation</legend><label class="check-line"><input type="checkbox" name="allowPlayerCreation" ${settings.allowPlayerCreation ? 'checked' : ''}>Players can create characters</label><label class="check-line"><input type="checkbox" name="requireApproval" ${settings.requireApproval ? 'checked' : ''}>Organizer approval required</label>${field('maxPerPlayer', 'Active characters per player', settings.maxPerPlayer, 'type="number" min="1" max="10" required')}</fieldset><fieldset ${disabled}><legend>Public identity</legend><p class="hint">Character name is always public after approval. Choose any additional fields.</p>${PUBLIC_CHARACTER_FIELDS.map((name) => `<label class="check-line"><input type="checkbox" name="publicFields" value="${name}" ${settings.publicFields.includes(name) ? 'checked' : ''}>${fieldNames[name]}</label>`).join('')}</fieldset><p class="hint">Private objectives, attributes, equipment, inventory, and player account details are always excluded.</p><button type="submit" class="primary" ${disabled}>Save character settings</button></form></section><section><div class="panel-head"><h3>Factions</h3><button data-action="character-faction-new" ${disabled}>+ Add faction</button></div>${factions.length ? `<ul class="member-list">${factions.map((faction) => `<li><div><strong>${esc(faction.name)}</strong><p class="hint">${esc(faction.description)}</p></div><button data-action="character-faction-edit" data-id="${esc(faction.id)}" ${disabled}>Edit</button></li>`).join('')}</ul>` : '<p class="hint">Add the groups, houses, or crews in your world. Characters can also remain unaffiliated.</p>'}</section></div></details>`;
  }
  function startEditor(character = null, prewritten = false) {
    selected = character; step = 0; dirty = false;
    const currentMember = state.members.some((member) => member.user_id === state.session.user.id);
    draft = { profile: character ? clone(character.profile) : defaultCharacterProfile(rules()), userId: character ? character.userId : (prewritten || !currentMember ? null : state.session.user.id) };
    showStep();
  }
  function capture() {
    const form = document.querySelector('#character-editor-form'); if (!form || !draft) return;
    const data = new FormData(form), p = draft.profile;
    if (step === 0) { for (const name of ['name', 'pronouns', 'biography']) p[name] = String(data.get(name) || ''); p.factionId = data.get('factionId') || null; if (isManager() && !selected) draft.userId = data.get('userId') || null; }
    if (step === 1) { p.attributes = Object.fromEntries(rules().attributes.map((rule) => [rule.id, Number(data.get(`attribute-${rule.id}`))])); p.skills = data.getAll('skills'); }
    if (step === 2) { p.privateObjectives = String(data.get('privateObjectives') || ''); p.startingEquipment = p.startingEquipment.map((item, index) => ({ name: String(data.get(`equipment-name-${index}`) || ''), quantity: Number(data.get(`equipment-quantity-${index}`)), notes: String(data.get(`equipment-notes-${index}`) || '') })); }
  }
  function showStep() {
    const p = draft.profile, steps = ['Identity', 'Abilities', 'Kit & goals', 'Review'];
    let content = '';
    if (step === 0) content = `<div class="character-portrait-editor"><div id="character-portrait-preview">${avatar(p)}</div><div><label>Portrait <span class="muted">(optional)</span><input type="file" id="character-portrait-file" accept="image/jpeg,image/png,image/webp"></label><p class="hint">Choose a JPEG, PNG, or WebP up to 8 MB. ORACLE resizes it for your character sheet.</p>${p.portrait ? '<button type="button" class="quiet" data-action="character-portrait-remove">Remove portrait</button>' : ''}</div></div>${field('name', 'Character name', p.name, 'required maxlength="80" autocomplete="off"')}${field('pronouns', 'Pronouns · optional', p.pronouns, 'maxlength="50"')}<label>Biography · optional<textarea name="biography" maxlength="4000">${esc(p.biography)}</textarea></label><label>Faction<select name="factionId"><option value="">No faction</option>${factions.map((faction) => `<option value="${esc(faction.id)}" ${p.factionId === faction.id ? 'selected' : ''}>${esc(faction.name)}</option>`).join('')}</select></label>${isManager() && !selected ? `<label>Assign to<select name="userId"><option value="">Unassigned · prewritten character</option>${state.members.map((member) => `<option value="${esc(member.user_id)}" ${draft.userId === member.user_id ? 'selected' : ''}>${esc(member.display_name)}${member.user_id === state.session.user.id ? ' (you)' : ''}</option>`).join('')}</select></label>` : ''}`;
    if (step === 1) content = `<fieldset><legend>Attributes</legend>${rules().attributes.length ? `<div class="character-attributes">${rules().attributes.map((rule) => field(`attribute-${rule.id}`, `${rule.name} · ${rule.min} to ${rule.max}`, p.attributes[rule.id], `type="number" min="${rule.min}" max="${rule.max}" step="any" required`)).join('')}</div>` : '<p class="hint">This event has no character attributes.</p>'}</fieldset><fieldset><legend>${esc(state.event.setup?.theme?.terms?.expertise || 'Skills')}</legend>${rules().expertise.length ? rules().expertise.map((skill) => `<label class="check-line"><input type="checkbox" name="skills" value="${esc(skill.id)}" ${p.skills.includes(skill.id) ? 'checked' : ''}>${esc(skill.name)}</label>`).join('') : '<p class="hint">This event has no named skills.</p>'}</fieldset><p class="hint">The organizer defines the available attributes and skills for this event.</p>`;
    if (step === 2) content = `<label>Private objectives · optional<textarea name="privateObjectives" maxlength="4000" placeholder="What are you trying to accomplish?">${esc(p.privateObjectives)}</textarea></label><p class="hint">Only you and event managers can read your objectives. They never appear on your badge.</p><div class="panel-head"><h3>Starting equipment</h3><button type="button" data-action="character-equipment-add" ${p.startingEquipment.length >= 50 ? 'disabled' : ''}>+ Add item</button></div>${selected?.inventoryInitialized ? '<p class="hint">Starting equipment is already recorded in inventory. Editing this list will not add or remove inventory items; an organizer can update the inventory separately.</p>' : '<p class="hint">Approved starting equipment becomes your initial inventory once. Ask your organizer about later inventory changes.</p>'}${p.startingEquipment.map((item, index) => `<div class="character-equipment-row">${field(`equipment-name-${index}`, 'Item name', item.name, 'required maxlength="100"')}${field(`equipment-quantity-${index}`, 'Quantity', item.quantity, 'type="number" min="1" max="9999" required')}${field(`equipment-notes-${index}`, 'Notes · optional', item.notes, 'maxlength="500"')}<button type="button" class="quiet danger" data-action="character-equipment-remove" data-index="${index}">Remove item</button></div>`).join('')}`;
    if (step === 3) content = `${profileSummary(p, true)}<p class="preview-banner">${settings.requireApproval ? 'Save your draft, then submit it for organizer approval from your sheet.' : 'Save your draft, then activate it from your sheet.'} ${selected?.status === 'approved' ? 'Editing an approved character may require a fresh approval.' : ''}</p><p class="hint">Public identity: name${settings.publicFields.length ? `, ${settings.publicFields.map((name) => fieldNames[name].toLowerCase()).join(', ')}` : ''}. Everything else stays on your private sheet.</p>`;
    wideModal(selected ? 'Edit character' : 'Create a character', `<div class="wizard-progress" aria-label="Character creation progress">${steps.map((name, index) => `<span ${step === index ? 'aria-current="step"' : ''}>${index + 1}. ${name}</span>`).join('')}</div><form id="character-editor-form">${err}<span id="character-save" class="save-status" role="status">${dirty ? 'Unsaved changes' : selected ? 'Draft loaded · no unsaved changes' : 'New draft · not saved yet'}</span>${content}<div class="wizard-actions">${step ? '<button type="button" data-action="character-step-back">← Back</button>' : '<button type="button" class="quiet" data-action="close">Cancel</button>'}<div class="actions">${step < 3 ? '<button type="button" data-action="character-save-draft">Save draft</button>' : ''}<button type="submit" class="primary">${step === 3 ? 'Save character' : 'Continue →'}</button></div></div></form>`);
  }
  function profileSummary(p, privateView) {
    return `<div class="character-identity">${avatar(p)}<div><h2>${esc(p.name || 'Unnamed character')}</h2>${p.pronouns ? `<p class="hint">${esc(p.pronouns)}</p>` : ''}<p class="hint">${esc(privateView ? factionName(p.factionId) : (p.faction?.name || ''))}</p></div></div>${p.biography ? `<section class="character-block"><h3>Biography</h3><p class="prose">${esc(p.biography)}</p></section>` : ''}${privateView && rules().attributes.length ? `<dl class="character-stat-list">${rules().attributes.map((rule) => `<div><dt>${esc(rule.name)}</dt><dd>${esc(p.attributes[rule.id])}</dd></div>`).join('')}</dl>` : ''}${p.skills?.length ? `<section class="character-block"><h3>Skills</h3><div class="character-tags">${p.skills.map((id) => `<span>${esc(skillName(id))}</span>`).join('')}</div></section>` : ''}${privateView ? `<section class="character-block character-private"><h3>Private objectives</h3><p class="prose">${esc(p.privateObjectives || 'No objectives written yet.')}</p><p class="hint">Visible only to the assigned player and event managers.</p></section>${p.startingEquipment.length ? `<details class="character-block"><summary>Starting equipment · ${p.startingEquipment.length}</summary><ul class="character-item-list">${p.startingEquipment.map((item) => `<li><strong>${item.quantity} × ${esc(item.name)}</strong>${item.notes ? `<p class="hint">${esc(item.notes)}</p>` : ''}</li>`).join('')}</ul></details>` : ''}` : ''}`;
  }
  async function saveDraft() {
    if (portraitBusy) throw new Error('Wait for the portrait to finish processing.');
    capture(); validateCharacterProfile(draft.profile, rules(), factions); saveIndicator('Saving…', true);
    const body = { profile: draft.profile };
    if (selected) body.version = selected.version;
    else if (isManager()) body.userId = draft.userId;
    let result;
    try { result = await api(selected ? path(selected.id) : `${base()}/characters`, selected ? 'PATCH' : 'POST', body); }
    catch (error) { saveIndicator('Not saved · your changes are still here'); throw error; }
    selected = result.character; draft = { profile: clone(selected.profile), userId: selected.userId }; dirty = false;
    saveIndicator('Saved to event');
    try { await refresh(); render(); await showSheet(selected.id); draft = null; toast('Character saved.'); }
    catch { throw new Error('Your character was saved, but the updated sheet could not be loaded. Your saved draft is safe. Close this dialog and choose Refresh when your connection returns.'); }
  }
  async function showSheet(id) {
    const result = await api(path(id)); selected = result.character; inventory = result.inventory || [];
    const character = selected, full = character.visibility === 'private', editable = full && mutable() && character.status !== 'retired';
    const feedback = full && character.reviewNotes ? `<section class="character-block character-feedback"><h3>Organizer feedback</h3><p class="prose">${esc(character.reviewNotes)}</p></section>` : '';
    wideModal(full ? 'Character sheet' : 'Public character card', `<div class="character-sheet">${err}<div class="character-sheet-meta">${status(character.status)}<span class="save-status"><span class="save-dot"></span>Saved to event</span>${full ? `<span class="hint">${esc(memberName(character.userId))}</span>` : '<span class="hint">Public identity</span>'}</div>${profileSummary(character.profile, full)}${feedback}<div class="actions character-sheet-actions">${editable ? '<button class="primary" data-action="character-edit">Edit character</button>' : ''}${editable && ['draft', 'changes_requested'].includes(character.status) ? `<button data-action="character-submit">${settings.requireApproval ? 'Submit for approval' : 'Activate character'}</button>` : ''}${full && character.status === 'approved' ? '<button data-action="character-badge">Public badge & QR</button>' : ''}${full ? '<button data-action="character-copy">Copy to another event</button>' : ''}</div>${full ? inventorySection() : ''}${full && mutable() && character.status !== 'retired' ? `<details class="character-block character-manager-tools"><summary>${isManager() ? 'Organizer controls' : 'Character actions'}</summary><div class="actions mt">${isManager() && character.status === 'pending' ? '<button class="primary" data-action="character-review" data-decision="approve">Approve character</button><button data-action="character-review" data-decision="request_changes">Request changes</button>' : ''}${isManager() ? `<button data-action="character-assign">${character.userId ? 'Change assignment' : 'Assign to a player'}</button>` : ''}<button class="quiet danger" data-action="character-retire">Retire character</button>${character.status === 'approved' ? '<button class="quiet" data-action="character-rotate-badge">Replace badge code</button>' : ''}</div><p class="hint">Replacing a badge code immediately invalidates the previous QR code and link.</p></details>` : ''}</div>`);
  }
  function inventorySection() {
    return `<section class="character-block"><div class="panel-head"><h3>Inventory</h3>${isManager() && mutable() && selected.status !== 'retired' ? '<button data-action="character-inventory-new">+ Add item</button>' : ''}</div>${inventory.length ? `<ul class="character-inventory">${inventory.map((item) => `<li><div><strong>${item.quantity} × ${esc(item.name)}</strong>${item.notes ? `<p class="hint">${esc(item.notes)}</p>` : ''}</div>${isManager() && mutable() && selected.status !== 'retired' ? `<button data-action="character-inventory-edit" data-id="${esc(item.id)}">Edit</button>` : ''}</li>`).join('')}</ul>` : `<p class="hint">${selected.inventoryInitialized ? 'No items in inventory.' : 'Starting equipment will appear here after the first approval.'}</p>`}<p class="hint">Inventory changes are managed by organizers. Items are private and are not shared by scanning a badge.</p></section>`;
  }
  function reviewModal(decision) {
    wideModal(decision === 'approve' ? 'Approve character' : 'Request character changes', `<p class="hint">${esc(selected.profile.name)} · ${esc(memberName(selected.userId))}</p><form id="character-review-form" data-decision="${decision}">${err}<label>${decision === 'approve' ? 'Feedback · optional' : 'What should the player change?'}<textarea name="feedback" maxlength="2000" ${decision === 'request_changes' ? 'required' : ''}></textarea></label><button type="submit" class="primary">${decision === 'approve' ? 'Approve character' : 'Send change request'}</button></form>`);
  }
  function assignModal() {
    wideModal('Assign character', `<p class="hint">The assigned player can read the complete sheet, including private objectives and inventory.</p><form id="character-assign-form">${err}<label>Player<select name="userId"><option value="">Unassigned · keep as prewritten</option>${state.members.map((member) => `<option value="${esc(member.user_id)}" ${member.user_id === selected.userId ? 'selected' : ''}>${esc(member.display_name)}</option>`).join('')}</select></label><button type="submit" class="primary">Save assignment</button></form>`);
  }
  function copyModal() {
    const events = state.events.filter((event) => event.id !== state.event.id && event.status !== 'archived');
    wideModal('Copy character to another event', `${events.length ? `<form id="character-copy-form">${err}<label>Destination event<select name="targetEventId">${events.map((event) => `<option value="${esc(event.id)}">${esc(event.name)}</option>`).join('')}</select></label><p class="hint">Creates a new draft assigned to you. The destination event’s character limits and rules apply. Attribute values use its defaults; only matching skills remain.</p><p class="hint">Faction, private objectives, starting equipment, and inventory are cleared. Review the new draft before submitting it.</p><button type="submit" class="primary">Create a copy</button></form>` : '<p class="hint">Join or create another active event before copying a character.</p>'}`);
  }
  function inventoryModal(item = null) {
    wideModal(item ? 'Edit inventory item' : 'Add inventory item', `<form id="character-inventory-form" data-id="${esc(item?.id || '')}" data-version="${item?.version || ''}">${err}${field('name', 'Item name', item?.name || '', 'required maxlength="100"')}${field('quantity', 'Quantity', item?.quantity ?? 1, 'type="number" min="0" max="9999" required')}<label>Notes · optional<textarea name="notes" maxlength="500">${esc(item?.notes || '')}</textarea></label><div class="actions"><button type="submit" class="primary">Save item</button>${item ? `<button type="button" class="quiet danger" data-action="character-inventory-delete" data-id="${esc(item.id)}" data-version="${item.version}">Remove item</button>` : ''}<button type="button" data-action="character-sheet-return">Back to sheet</button></div></form>`);
  }
  function factionModal(faction = null) {
    wideModal(faction ? 'Edit faction' : 'Add faction', `<form id="character-faction-form" data-id="${esc(faction?.id || '')}" data-version="${faction?.version || ''}">${err}${field('name', 'Faction name', faction?.name || '', 'required maxlength="80"')}<label>Description<textarea name="description" maxlength="2000">${esc(faction?.description || '')}</textarea></label><div class="actions"><button type="submit" class="primary">Save faction</button>${faction ? `<button type="button" class="quiet danger" data-action="character-faction-delete" data-id="${esc(faction.id)}" data-version="${faction.version}">Delete faction</button>` : ''}</div></form>`);
  }
  async function showBadge(code) {
    const result = await api(`/api/badges/${encodeURIComponent(code)}`), p = result.character.profile;
    const badgeUrl = `${location.origin}/#badge/${code}`;
    const badgeSkillName = (id) => result.event.skills?.find((skill) => skill.id === id)?.name || id;
    shownBadge = { code, url: badgeUrl };
    wideModal('Public character badge', `<p class="hint character-no-print">This is the identity other event members see. Private objectives and inventory are excluded.</p>${err}<article id="character-print-badge" class="character-public-badge"><p class="character-badge-brand">ORACLE · LARP Field Kit</p><p class="character-badge-event">${esc(result.event.name)}</p>${avatar(p)}<h2>${esc(p.name)}</h2>${p.pronouns ? `<p>${esc(p.pronouns)}</p>` : ''}${p.faction ? `<p>${esc(p.faction.name)}</p>` : ''}${p.biography ? `<p class="prose">${esc(p.biography)}</p>` : ''}${p.skills?.length ? `<p>${p.skills.map((id) => esc(badgeSkillName(id))).join(' · ')}</p>` : ''}<div id="character-badge-qr" class="character-qr" aria-label="QR code for this public character identity"></div><p class="character-badge-code">${esc(code.match(/.{1,4}/g).join('-'))}</p><p class="character-badge-footer">Scan in ORACLE · Event members only</p></article><div class="actions mt character-no-print"><button class="primary" data-action="character-print">Print badge</button><button data-action="character-copy-badge">Copy badge link</button><button data-action="close">Done</button></div>`);
    renderBadgeQR(document.querySelector('#character-badge-qr'), badgeUrl, 256);
  }
  function scanModal() {
    wideModal('Scan a character badge', `<p class="hint">Scan a QR code or enter the printed badge code. You must belong to the character’s event.</p>${err}<div class="character-scan"><video id="character-scanner" muted playsinline hidden></video><p id="character-scan-status" class="hint" role="status">Your camera stays off until you choose Start camera.</p><div class="actions"><button data-action="character-camera">Start camera</button><button data-action="character-camera-stop" hidden>Stop camera</button></div><label>Read a QR image<input id="character-scan-file" type="file" accept="image/png,image/jpeg,image/webp"></label><form id="character-scan-form">${err}<label>Badge code or ORACLE badge link<input name="code" required autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="500" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"></label><button type="submit" class="primary">Open public identity</button></form></div>`);
  }
  async function scanResult(value) { const code = parseBadgeInput(value, location.origin); await showBadge(code); }
  async function camera() {
    const epoch = modalEpoch, video = document.querySelector('#character-scanner'), label = document.querySelector('#character-scan-status');
    label.textContent = 'Requesting camera access…'; video.hidden = false;
    document.querySelector('[data-action="character-camera"]').hidden = true; document.querySelector('[data-action="character-camera-stop"]').hidden = false;
    const controller = new AbortController(); scannerController = controller; let cameraFailed = false;
    const stop = await startScanner(video, async (value) => { if (epoch !== modalEpoch) return; try { await scanResult(value); } catch (error) { if (epoch === modalEpoch) { stopCamera(); label.textContent = error.message; } } }, (error) => { cameraFailed = true; if (epoch === modalEpoch) { stopCamera(); label.textContent = error.message || String(error); } }, { signal: controller.signal });
    if (epoch !== modalEpoch || controller.signal.aborted) { stop(); return; }
    if (cameraFailed) { stop(); video.hidden = true; return; }
    scannerStop = stop; label.textContent = 'Point the camera at an ORACLE badge QR code.';
    document.querySelector('[data-action="character-camera"]').hidden = true; document.querySelector('[data-action="character-camera-stop"]').hidden = false;
  }
  function stopCamera() {
    scannerController?.abort(); scannerController = null;
    if (scannerStop) scannerStop(); scannerStop = null;
    const video = document.querySelector('#character-scanner'); if (video) video.hidden = true;
    const start = document.querySelector('[data-action="character-camera"]'), stop = document.querySelector('[data-action="character-camera-stop"]');
    if (start) start.hidden = false; if (stop) stop.hidden = true;
    const label = document.querySelector('#character-scan-status'); if (label) label.textContent = 'Camera stopped. You can enter a code or choose a QR image.';
  }
  function cleanupModal(reset = true) { modalEpoch++; stopCamera(); document.body.classList.remove('character-printing'); if (reset) { draft = null; dirty = false; portraitBusy = false; } }
  function confirmDiscard() { if ((dirty || portraitBusy) && !window.confirm('Discard your unsaved character changes?')) return false; cleanupModal(); return true; }
  async function handleHash() {
    if (!location.hash.startsWith('#badge/') || !state.session?.user) return false;
    if (!confirmDiscard()) { history.replaceState(null, '', `${location.pathname}${location.search}`); return true; }
    try { await scanResult(`${location.origin}/${location.hash}`); }
    catch (error) { toast(error.message || 'This badge could not be opened. Check your event membership and try again.'); }
    if (state.session?.user) history.replaceState(null, '', `${location.pathname}${location.search}`);
    return true;
  }
  async function action(button) {
    const name = button.dataset.action; if (!name?.startsWith('character-')) return false;
    if (portraitBusy && ['character-step-back', 'character-save-draft', 'character-equipment-add', 'character-equipment-remove', 'character-portrait-remove'].includes(name)) throw new Error('Wait for your portrait to finish processing before continuing.');
    switch (name) {
      case 'character-open': await open(); break;
      case 'character-back-event': await loadEvent(state.event.id); break;
      case 'character-refresh': await open(); toast('Characters refreshed.'); break;
      case 'character-create': startEditor(); break;
      case 'character-sheet': await showSheet(button.dataset.id); break;
      case 'character-sheet-return': await showSheet(selected.id); break;
      case 'character-edit': startEditor(selected); break;
      case 'character-step-back': capture(); step--; showStep(); break;
      case 'character-save-draft': { const form = document.querySelector('#character-editor-form'); if (form.reportValidity()) await saveDraft(); break; }
      case 'character-equipment-add': capture(); draft.profile.startingEquipment.push({ name: '', quantity: 1, notes: '' }); markDirty(); showStep(); break;
      case 'character-equipment-remove': capture(); draft.profile.startingEquipment.splice(Number(button.dataset.index), 1); markDirty(); showStep(); break;
      case 'character-portrait-remove': capture(); draft.profile.portrait = null; markDirty(); showStep(); break;
      case 'character-submit': await api(`${path(selected.id)}/submit`, 'POST', { version: selected.version }); await refresh(); render(); await showSheet(selected.id); toast(settings.requireApproval ? 'Character sent for approval.' : 'Character activated.'); break;
      case 'character-review': reviewModal(button.dataset.decision); break;
      case 'character-assign': assignModal(); break;
      case 'character-copy': copyModal(); break;
      case 'character-retire': if (window.confirm(`Retire ${selected.profile.name}? Its badge will stop working and the character will become read-only.`)) { await api(`${path(selected.id)}/retire`, 'POST', { version: selected.version }); await refresh(); render(); await showSheet(selected.id); toast('Character retired.'); } break;
      case 'character-badge': await showBadge(selected.badgeCode); break;
      case 'character-rotate-badge': if (window.confirm('Replace this character’s badge code? Existing QR codes and printed badges will stop working.')) { const result = await api(`${path(selected.id)}/badge`, 'POST', { version: selected.version }); selected = result.character; await showBadge(selected.badgeCode); toast('New badge code created.'); } break;
      case 'character-copy-badge': try { await navigator.clipboard.writeText(shownBadge.url); toast('Badge link copied.'); } catch { const code = document.querySelector('.character-badge-code'); const range = document.createRange(); range.selectNodeContents(code); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); toast('Copy the selected badge code manually.'); } break;
      case 'character-print': document.body.classList.add('character-printing'); window.print(); break;
      case 'character-scan': scanModal(); break;
      case 'character-camera': void camera().catch((error) => { stopCamera(); const label = document.querySelector('#character-scan-status'); if (label) label.textContent = error.message || 'Camera could not start. Enter a code or choose an image.'; }); break;
      case 'character-camera-stop': modalEpoch++; stopCamera(); break;
      case 'character-inventory-new': inventoryModal(); break;
      case 'character-inventory-edit': inventoryModal(inventory.find((item) => item.id === button.dataset.id)); break;
      case 'character-inventory-delete': if (window.confirm('Remove this inventory item?')) { await api(`${path(selected.id)}/inventory/${button.dataset.id}`, 'DELETE', { version: Number(button.dataset.version) }); await showSheet(selected.id); toast('Inventory item removed.'); } break;
      case 'character-faction-new': factionModal(); break;
      case 'character-faction-edit': factionModal(factions.find((faction) => faction.id === button.dataset.id)); break;
      case 'character-faction-delete': if (window.confirm('Delete this faction? Characters using it must be reassigned first.')) { await api(`${base()}/factions/${button.dataset.id}`, 'DELETE', { version: Number(button.dataset.version) }); closeModal(true); await open(); toast('Faction deleted.'); } break;
    }
    return true;
  }
  async function submit(form) {
    if (!form.id.startsWith('character-')) return false;
    const data = new FormData(form);
    switch (form.id) {
      case 'character-editor-form': if (portraitBusy) throw new Error('Wait for your portrait to finish processing before continuing.'); capture(); if (step < 3) { step++; showStep(); } else await saveDraft(); break;
      case 'character-settings-form': await api(`${base()}/character-settings`, 'PUT', { allowPlayerCreation: data.has('allowPlayerCreation'), requireApproval: data.has('requireApproval'), maxPerPlayer: Number(data.get('maxPerPlayer')), publicFields: data.getAll('publicFields'), version: settings.version }); await open(); toast('Character settings saved.'); break;
      case 'character-review-form': await api(`${path(selected.id)}/review`, 'POST', { version: selected.version, decision: form.dataset.decision, feedback: String(data.get('feedback') || '') }); await refresh(); render(); await showSheet(selected.id); toast(form.dataset.decision === 'approve' ? 'Character approved.' : 'Changes requested.'); break;
      case 'character-assign-form': await api(`${path(selected.id)}/assign`, 'POST', { version: selected.version, userId: data.get('userId') || null }); await refresh(); render(); await showSheet(selected.id); toast('Character assignment saved.'); break;
      case 'character-copy-form': { const result = await api(`${path(selected.id)}/copy`, 'POST', { targetEventId: data.get('targetEventId') }); closeModal(true); await loadEvent(result.character.eventId); await open(); await showSheet(result.character.id); toast(result.warnings?.length ? `Draft copied. ${result.warnings.join(' ')}` : 'Character copied as a new draft. Review it before submitting.'); break; }
      case 'character-inventory-form': { const body = { name: data.get('name'), quantity: Number(data.get('quantity')), notes: data.get('notes') }; if (form.dataset.id) body.version = Number(form.dataset.version); await api(`${path(selected.id)}/inventory${form.dataset.id ? `/${form.dataset.id}` : ''}`, form.dataset.id ? 'PATCH' : 'POST', body); await showSheet(selected.id); toast('Inventory saved.'); break; }
      case 'character-faction-form': { const body = { name: data.get('name'), description: data.get('description') }; if (form.dataset.id) body.version = Number(form.dataset.version); await api(`${base()}/factions${form.dataset.id ? `/${form.dataset.id}` : ''}`, form.dataset.id ? 'PATCH' : 'POST', body); closeModal(true); await open(); toast('Faction saved.'); break; }
      case 'character-scan-form': await scanResult(data.get('code')); break;
    }
    return true;
  }
  document.addEventListener('input', (event) => { if (event.target.closest('#character-editor-form') && draft) markDirty(); });
  document.addEventListener('change', async (event) => {
    if (event.target.closest('#character-editor-form') && draft) markDirty();
    if (!['character-portrait-file', 'character-scan-file'].includes(event.target.id)) return;
    const file = event.target.files?.[0]; if (!file) return;
    const epoch = modalEpoch;
    try {
      if (event.target.id === 'character-scan-file') { const result = await scanImage(file); if (epoch === modalEpoch) await scanResult(result); }
      else {
        portraitBusy = true; saveIndicator('Preparing portrait…', true); const portrait = await preparePortrait(file);
        if (epoch !== modalEpoch || !draft) return;
        capture(); draft.profile.portrait = portrait; markDirty(); portraitBusy = false; showStep();
      }
    } catch (error) {
      if (epoch === modalEpoch) { const target = document.querySelector('#modal-content .error'); if (target) target.textContent = error.message; saveIndicator('Portrait not saved · choose another image'); }
    } finally { if (epoch === modalEpoch) portraitBusy = false; }
  });
  window.addEventListener('pagehide', () => { modalEpoch++; stopCamera(); });
  window.addEventListener('beforeunload', (event) => { if (dirty || portraitBusy) { event.preventDefault(); event.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
  window.addEventListener('afterprint', () => document.body.classList.remove('character-printing'));
  return { render, action, submit, open, handleHash, confirmDiscard, cleanupModal, isDirty: () => dirty || portraitBusy };
}

async function preparePortrait(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('Choose a JPEG, PNG, or WebP portrait no larger than 8 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height) throw new Error('This image could not be read.');
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.88, 0.75, 0.6, 0.45]) { const data = canvas.toDataURL('image/jpeg', quality); if ((data.length - data.indexOf(',') - 1) * 3 / 4 <= 150000) return data; }
    throw new Error('This portrait is too detailed to store. Choose a smaller image.');
  } finally { bitmap.close(); }
}
