// A view of current, authorized facts. This module does not fetch or save data,
// mark tasks complete, or perform game actions. Existing action handlers own all
// navigation and recheck the server's permissions when a destination is opened.
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const link = (action, label, extra = {}) => ({ action, label, ...extra });

function actionButton(action, primary = false) {
  if (!action) return '';
  return `<button type="button" class="${primary ? 'primary' : 'quiet'}" data-action="${escapeHTML(action.action)}"${action.mode ? ` data-mode="${escapeHTML(action.mode)}"` : ''}>${escapeHTML(action.label)}</button>`;
}

export function renderWelcomeGuide({ eventCount = 0 } = {}) {
  return `<section class="oracle-guide guide-welcome" aria-labelledby="guide-welcome-title"><div class="guide-intro"><h2 id="guide-welcome-title">${eventCount > 0 ? 'Joining another story?' : 'How will you take part?'}</h2><p>ORACLE holds your event briefing, characters, and the discoveries you make during play.</p></div><div class="guide-entry-grid"><article><p class="eyebrow">For players</p><h3>Join an event</h3><p>Enter the invitation code from your organizer. Then create or choose your character.</p>${actionButton(link('join', 'Enter invitation code'), true)}</article><article><p class="eyebrow">For organizers</p><h3>Organize an event</h3><p>Choose a Fantasy, Cyberpunk, or Wasteland starter adventure, then make it your own.</p>${actionButton(link('advedit-starter', 'Choose a starter adventure'), true)}</article></div><details class="guide-more"><summary>Other ways to start</summary><p>Build a blank event around your own story, or import a briefing pack you already have.</p><div class="actions">${actionButton(link('create', 'Create a blank event'))}${actionButton(link('kit-import', 'Import briefing pack'))}</div></details></section>`;
}

function currentCharacters({ event, accountId, characterSnapshot }) {
  if (!accountId || characterSnapshot?.accountId !== accountId || characterSnapshot?.eventId !== event.id || !Array.isArray(characterSnapshot.characters)) return null;
  // Managers may receive the whole roster. A player guide must still only use
  // the current account's own sheets, never another player's private status.
  return characterSnapshot.characters.filter((character) => character?.eventId === event.id && character.userId === accountId && character.visibility === 'private' && character.status !== 'retired');
}

function playerCharacterStep(options) {
  const characters = currentCharacters(options);
  const snapshot = characters === null ? null : options.characterSnapshot;
  const approved = characters?.some((character) => character.status === 'approved');
  if (approved) return { title: 'Your character is approved', state: 'Checked', description: 'Open your sheet to read your private goals or show your public badge.', action: link('character-open', 'View your characters') };
  if (characters?.some((character) => character.status === 'changes_requested')) return { title: 'Review the organizer’s feedback', state: 'Next', description: 'Open your character sheet, make the requested changes, and submit it again.', action: link('character-open', 'Review your character') };
  if (characters?.some((character) => character.status === 'draft')) return { title: 'Finish your character', state: 'Next', description: snapshot.settings?.requireApproval === false ? 'Open your saved draft. Review it, then choose Activate character from the sheet.' : 'Open your saved draft. Review it, then submit it for organizer approval.', action: link('character-open', 'Finish your character') };
  if (characters?.some((character) => character.status === 'pending')) return { title: 'Your character is awaiting approval', state: 'Waiting', description: 'Your organizer needs to approve the sheet before it can take part in play. You can review the event briefing while you wait.', action: link('character-open', 'Check approval') };
  if (characters?.length === 0) return { title: snapshot.settings?.allowPlayerCreation === false ? 'Get your assigned character' : 'Choose your character', state: 'Next', description: snapshot.settings?.allowPlayerCreation === false ? 'Your organizer assigns the characters for this event. Ask them to assign one, then open Characters.' : 'Open Characters to create a sheet or check whether your organizer has assigned one to you.', action: link('character-open', 'Open characters') };
  return { title: 'Check your character', state: 'Start here', description: 'Open Characters to create or choose your sheet and check its approval. An approved character is needed for play.', action: link('character-open', 'Open characters') };
}

function playerGuide(options) {
  const { event } = options;
  const character = playerCharacterStep(options);
  const playing = ['rehearsal', 'live'].includes(event.status);
  const finished = ['ended', 'archived'].includes(event.status);
  const paused = event.status === 'paused';
  const adventure = {
    title: finished ? 'Read your discoveries' : paused ? 'Keep your discoveries at hand' : 'Explore the adventure',
    state: playing ? 'During play' : 'Read only',
    description: playing ? 'Choose your approved character, then scan a prop or enter its printed code. Available discoveries appear in your journal.' : finished ? 'The event has finished. Open your adventure to review the discoveries already recorded for your character.' : paused ? 'Play is paused. Existing discoveries remain readable; new game actions wait until the organizer resumes play.' : 'Your organizer is preparing this event. Read the briefing now; game actions open in rehearsal or live play.',
    action: link('adv-open', finished || paused ? 'Read discoveries' : 'Open adventure'),
  };
  const exchange = {
    title: 'Meet and exchange information', state: 'When ready',
    description: 'A character badge shows a public identity. To share readings, open Exchanges and review exactly what you choose to offer.',
    action: link('exchange-open', 'Open exchanges'),
  };
  const next = finished || (paused && character.state === 'Checked') || (playing && character.state === 'Checked') ? adventure : character;
  return { title: finished ? 'Your event record' : 'Your next step', next, steps: [character, adventure, exchange], mode: 'player' };
}

function organizerGuide(options) {
  const { event, members = [] } = options;
  const archived = event.status === 'archived';
  const finished = ['ended', 'archived'].includes(event.status);
  const otherMembers = members.filter((member) => member?.user_id && member.user_id !== options.accountId).length;
  const steps = [
    { title: 'Prepare the story', state: 'Review', description: 'Edit the adventure’s props, puzzles, and scenes. Open the player preview to check what each approved character can currently see.', action: link('advedit-open', archived ? 'Review adventure' : 'Prepare adventure') },
    { title: 'Bring in your players', state: otherMembers ? 'Members joined' : 'Next', description: otherMembers ? 'Review membership and invitation codes in this event workspace. Joining an event does not create or approve a character.' : 'Create an invitation code for your players. They use it to join this event with their own accounts.', action: link(finished ? 'invitations' : 'invite', finished ? 'Review invitation codes' : 'Invite players') },
    { title: 'Prepare characters', state: 'Review', description: 'Create or assign sheets and review approval requests. Character settings let you choose whether players can create their own.', action: link('character-open', 'Manage characters') },
    { title: finished ? 'Review the event record' : 'Rehearse before live play', state: event.status === 'rehearsal' ? 'Rehearsal open' : 'Review', description: finished ? 'Review the adventure and activity log. Keep any organizer exports private.' : 'Use Prepare adventure to create a separate rehearsal copy. Check the player journey there before using the event status controls to open live play.', action: link('advedit-open', finished ? 'Review adventure' : 'Open rehearsal tools') },
  ];
  let next = steps[0];
  if (event.status === 'rehearsal') next = steps[3];
  if (event.status === 'live' || event.status === 'paused') next = { title: event.status === 'paused' ? 'Play is paused' : 'Your event is live', description: 'Use the event status controls below to manage play. Character reviews and event operations remain available from their tools.', action: link('character-open', 'Manage characters') };
  if (finished) next = steps[3];
  return { title: finished ? 'Organizer review' : 'Organizer quick start', next, steps, mode: 'organizer' };
}

export function buildEventGuide(options = {}) {
  if (!options.event?.id || !options.accountId) return null;
  // Explicit preview mode must take precedence over the account's manager role.
  return options.isManager === true && options.audience === 'organizer' ? organizerGuide(options) : playerGuide(options);
}

export function renderEventGuide(options = {}) {
  const model = buildEventGuide(options);
  if (!model) return '';
  const theme = options.event.setup?.theme;
  const themeLabel = theme?.name ? `${theme.name} · ` : '';
  const briefing = theme?.terms?.briefing || 'Event briefing';
  const online = options.online !== false;
  return `<section class="oracle-guide guide-event" aria-labelledby="guide-event-title"><header class="guide-intro"><p class="eyebrow">${escapeHTML(themeLabel)}${escapeHTML(model.title)}</p><h2 id="guide-event-title">${escapeHTML(model.next.title)}</h2><p>${escapeHTML(model.next.description)}</p><div class="actions">${actionButton(model.next.action, true)}${actionButton(link('field-open', 'Field desk'))}</div>${online ? '' : '<p class="guide-connection" role="status">Offline: saved readings and Field desk notes stay on this device. Reconnect to check your character or take a live action.</p>'}</header><details class="guide-more"><summary>${model.mode === 'organizer' ? 'Setup and rehearsal steps' : 'See the player steps'}</summary><ol class="guide-steps">${model.steps.map((step) => `<li><div><span class="guide-step-state">${escapeHTML(step.state)}</span><h3>${escapeHTML(step.title)}</h3><p>${escapeHTML(step.description)}</p></div>${actionButton(step.action)}</li>`).join('')}</ol><p class="hint">${escapeHTML(briefing)} is this event’s briefing. Read the organizer’s instructions before taking part.</p></details><details class="guide-more"><summary>Which code should I use?</summary><dl class="guide-codes"><div><dt>Event invitation</dt><dd>Use Join an event on My events. It adds your account to the event.</dd></div><div><dt>Character badge</dt><dd>Use Scan a badge in Characters. It shows the approved public identity, without sharing private goals or inventory.</dd></div><div><dt>Prop code</dt><dd>Open Adventure, choose your character, then select Scan a prop. You can type the printed code instead of using a camera.</dd></div><div><dt>Exchange invitation</dt><dd>Open Exchanges to join another player’s exchange. Review the selected readings or trade terms before confirming.</dd></div></dl><div class="actions">${actionButton(link('character-open', 'Open characters'))}${actionButton(link('adv-open', 'Open adventure'))}${actionButton(link('exchange-open', 'Open exchanges'))}</div></details></section>`;
}
