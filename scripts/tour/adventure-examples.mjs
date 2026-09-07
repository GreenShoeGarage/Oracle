/**
 * Public-tour examples rendered by the shipped UI components.
 * All API replies are fictional, in-memory GET fixtures. This module neither
 * reads production data nor creates events, accounts, discoveries, or badges.
 * The reserved .invalid origin makes the example badge intentionally unusable.
 */
import { deflateSync } from 'node:zlib';
import { JSDOM } from 'jsdom';
import { createCharacterUI } from '../../public/characters-ui.js';
import { defaultCharacterProfile, defaultCharacterSettings } from '../../public/characters-model.js';
import { createAdventurePlayer } from '../../public/adventure-player.js';
import { createAdventureOrganizer } from '../../public/adventure-organizer.js';
import { defaultAdventure, defaultAdventureNode, validateAdventure } from '../../public/adventure-model.js';
import { createKitUI } from '../../public/builder.js';
import { defaultSetup } from '../../public/kit.js';

const ORIGIN = 'https://oracle.example.invalid';
const EVENT_ID = '00000000-0000-4000-8000-000000000101';
const CHARACTER_ID = '00000000-0000-4000-8000-000000000102';
const PLAYER_ID = '00000000-0000-4000-8000-000000000103';
const FACTION_ID = '00000000-0000-4000-8000-000000000104';
const BADGE_CODE = 'AAAAAAAAAAAAAAAAAAAA';
const FIXTURE_DATE = '2026-10-10T17:20:00.000Z';
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const clone = value => structuredClone(value);

// Preserve the pixels produced by the real renderBadgeQR implementation when
// serializing a DOM. A browser canvas cannot retain its pixels in outerHTML.
function pngDataURL({ data, width, height }) {
  function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(type, bytes) {
    const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
    return Buffer.concat([length, name, bytes, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let row = 0; row < height; row++) Buffer.from(data.buffer, data.byteOffset + row * width * 4, width * 4).copy(scanlines, row * (width * 4 + 1) + 1);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function fixtureEvent(theme = 'fantasy') {
  const settings = {
    fantasy: { template: 'council', name: 'The Lantern Council', description: 'A gathering at dusk. A missing light. A story shaped by the people who answer the summons.', location: 'Old Council Hall · North clearing' },
    cyberpunk: { template: 'signal', name: 'The Missing Signal', description: 'Your neighborhood relay is silent. Assemble a crew, follow the signal, and decide who can be trusted.', location: 'Relay Nine · Community repair shop' },
    wasteland: { template: 'frontier', name: 'The Last Water Stop', description: 'The convoy is overdue. Supplies are running low. Every camp has something the settlement needs.', location: 'Dusthaven · Water tower' },
  }[theme];
  const setup = defaultSetup(theme, settings.template);
  setup.enabledInstruments = [...new Set([...setup.enabledInstruments, 'relic', 'dead-drop', 'cipherbox', 'wayfinder'])];
  return { id: EVENT_ID, name: settings.name, description: settings.description, location: settings.location, starts_at: null, status: 'live', role: 'player', version: 1, setup };
}

function fixtureCharacter(event) {
  return {
    id: CHARACTER_ID, userId: PLAYER_ID, status: 'approved', visibility: 'private', version: 1,
    badgeCode: BADGE_CODE, inventoryInitialized: true, reviewNotes: '',
    profile: {
      ...defaultCharacterProfile(event.setup.rules), name: 'Morrow Vale', pronouns: 'they / them',
      factionId: FACTION_ID, biography: 'A lantern keeper who knows the old paths and remembers the promises made along them.',
      attributes: { resolve: 4 }, skills: ['investigation'],
      privateObjectives: 'Discover why the northern lantern went dark. Bring the keeper’s message to the council before dusk.',
      startingEquipment: [{ name: 'Brass lantern', quantity: 1, notes: 'A family keepsake.' }, { name: 'Trail chalk', quantity: 3, notes: 'For marking the safe route.' }],
    },
  };
}

function fixtureAdventure(event) {
  const relic = { ...defaultAdventureNode('relic', 'lantern', 'BBBBBBBBBBBBBBBBBBBB'), title: 'The Unlit Lantern', summary: 'A brass lantern rests on the old boundary stone.' };
  relic.examinations = [
    { ...relic.examinations[0], id: 'inscription', label: 'Read the etched inscription', text: 'Three paths meet where the willow bends. Follow the blue stones to the keeper’s shelter.' },
    { ...clone(relic.examinations[0]), id: 'mechanism', label: 'Inspect the lantern mechanism', text: 'The wick is intact. Someone removed the crystal rather than letting the flame burn out.', conditions: { completed: [], skills: ['investigation'], flags: [], statuses: [] } },
  ];
  const drop = { ...defaultAdventureNode('dead_drop', 'message', 'CCCCCCCCCCCCCCCCCCCC'), title: 'The Keeper’s Letter', summary: 'A folded letter, sealed with the mark of the Lantern Keepers.', body: 'Morrow — the crystal is safe. Meet us at the willow shelter with two people you trust. Bring the lantern; it will show the council what happened.', releaseCode: 'WILLOW' };
  const cipher = { ...defaultAdventureNode('cipherbox', 'lockbox', 'DDDDDDDDDDDDDDDDDDDD'), title: 'The Council Lockbox', summary: 'Four engraved symbols guard a small wooden box.', prompt: 'I follow you in sunlight, vanish in darkness, and never leave a footprint. What am I?', answer: 'shadow', maxAttempts: 5, hints: [{ afterAttempts: 1, text: 'Think about something cast by the lantern, rather than carried inside it.' }], successText: 'The lock clicks open. Inside is the missing crystal.', failureText: 'The mechanism rests. Ask a council keeper for help.' };
  const scene = { ...defaultAdventureNode('wayfinder', 'willow', 'EEEEEEEEEEEEEEEEEEEE'), title: 'Council at the Willow', summary: 'Gather a small party for a conversation that changes the evening’s story.', body: 'The keeper is waiting under the willow. Bring your discoveries, hear each delegation, and decide together how to restore the border lantern.', location: 'Willow shelter · Blue trail markers', playStyle: 'social', durationMinutes: 20, minPlayers: 3, maxPlayers: 6 };
  const definition = {
    ...defaultAdventure(), title: 'The Lantern Trail',
    summary: 'Follow the missing light from the boundary stone to the council’s final decision.',
    organizerNotes: 'Place the lantern at the boundary stone and the sealed letter at the shelter. Brief the keeper before opening the scene. All names and clues in this public example are fictional.',
    flags: [{ id: 'keeper-found', name: 'Keeper found' }], nodes: [relic, drop, cipher, scene],
  };
  return validateAdventure(definition, event.setup);
}

function playerSnapshot(event, character, definition) {
  const nodes = definition.nodes.map(node => {
    const common = { id: node.id, type: node.type, title: node.title, summary: node.summary, locked: false, lockReason: null, completed: false, failed: false };
    if (node.type === 'relic') return { ...common, examinations: node.examinations.map((exam, index) => ({ id: exam.id, label: exam.label, available: true, completed: index === 0 })) };
    if (node.type === 'dead_drop') return { ...common, completed: true, requiresCode: true };
    if (node.type === 'cipherbox') return { ...common, prompt: node.prompt, attempts: 1, maxAttempts: node.maxAttempts, retryAfterMs: 0, hints: [{ index: 0, available: true, requested: true, text: node.hints[0].text }] };
    return { ...common, body: node.body, location: node.location, playStyle: node.playStyle, durationMinutes: node.durationMinutes, minPlayers: node.minPlayers, maxPlayers: node.maxPlayers, availability: 'open', startsAt: null, endsAt: null, attendanceCount: 3, joined: false };
  });
  return {
    adventure: { title: definition.title, summary: definition.summary, version: 1, isRehearsal: false },
    event: { id: event.id, name: event.name, status: event.status },
    character: { id: character.id, name: character.profile.name }, characters: [{ id: character.id, name: character.profile.name }],
    nodes, readOnly: false, preview: false,
    journal: [
      { id: 'fictional-reading-1', nodeId: 'lantern', title: 'The path beneath the inscription', text: definition.nodes[0].examinations[0].text, type: 'relic', createdAt: FIXTURE_DATE },
      { id: 'fictional-reading-2', nodeId: 'message', title: 'The Keeper’s Letter', text: definition.nodes[1].body, type: 'dead_drop', createdAt: '2026-10-10T17:25:00.000Z' },
    ],
  };
}

export async function examples() {
  const results = [], originals = new Map(), doms = [];
  const replaceGlobal = (name, value) => {
    if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  function mount(event, fixtureAPI, manager = false) {
    const dom = new JSDOM('<!doctype html><html><head><meta name="theme-color" content="#0d1211"></head><body><div id="app"></div><dialog id="modal"><div id="modal-content"></div></dialog></body></html>', { url: ORIGIN, pretendToBeVisual: true });
    doms.push(dom);
    for (const name of ['window', 'document', 'navigator', 'localStorage', 'location', 'history', 'FormData', 'HTMLElement']) replaceGlobal(name, name === 'window' ? dom.window : dom.window[name]);
    replaceGlobal('fetch', () => { throw new Error('Tour examples cannot make network requests.'); });
    dom.window.HTMLElement.prototype.scrollIntoView = function () {};
    dom.window.HTMLCanvasElement.prototype.getContext = function (kind) {
      if (kind !== '2d') throw new Error(`Unexpected tour canvas context: ${kind}`);
      const canvas = this;
      return { createImageData: (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }), putImageData: pixels => { canvas.fixturePixels = pixels; } };
    };
    const state = { session: { user: { id: PLAYER_ID, displayName: 'Sample player' } }, event, events: [event], view: 'detail', members: [{ user_id: PLAYER_ID, display_name: 'Sample player', role: 'player' }, { user_id: 'sample-organizer', display_name: 'Sample organizer', role: 'owner' }] };
    const ctx = {
      state, esc, err: '<p class="error" role="alert" hidden></p>', isManager: () => manager,
      api: async (path, method = 'GET') => { if (method !== 'GET') throw new Error(`Tour fixture rejected a mutation: ${method} ${path}`); return clone(await fixtureAPI(path)); },
      shell: html => { document.querySelector('#app').innerHTML = html; },
      openModal: (title, content) => { document.querySelector('#modal-content').innerHTML = `<div class="modal-head"><h2 id="modal-title" tabindex="-1">${esc(title)}</h2><button type="button" data-action="close" aria-label="Close dialog">×</button></div>${content}`; document.querySelector('#modal').open = true; },
      closeModal: () => { document.querySelector('#modal').open = false; },
      loadEvent: async () => { throw new Error('The static tour does not navigate to a live event.'); }, toast() {},
    };
    return ctx;
  }
  function capture(id, title, theme, description, source, selector = '#app') {
    const container = document.querySelector(selector);
    for (const canvas of container.querySelectorAll('canvas')) {
      if (!canvas.fixturePixels) throw new Error('An example canvas was not rendered.');
      const image = document.createElement('img');
      image.src = pngDataURL(canvas.fixturePixels); image.width = canvas.width; image.height = canvas.height;
      image.alt = 'Example character badge QR code — fictional and not usable at a live event'; image.style.cssText = canvas.style.cssText;
      canvas.replaceWith(image);
    }
    const html = container.innerHTML;
    if (!html.trim() || /\bundefined\b|\[object Object\]|<script\b/.test(html)) throw new Error(`Invalid rendered example: ${id}`);
    results.push({ id, title, theme, html, description, source, provenance: { renderer: source, data: 'Fictional in-memory GET fixtures', origin: ORIGIN }, stylesheets: ['style.css', 'themes.css', 'characters.css', 'adventure.css', 'adventure-organizer.css'] });
  }
  try {
    for (const theme of ['fantasy', 'cyberpunk', 'wasteland']) {
      const event = fixtureEvent(theme), ctx = mount(event, path => { throw new Error(`Unexpected briefing request: ${path}`); });
      const kit = createKitUI(ctx); kit.enterEvent(event); kit.renderPlayer(); kit.apply();
      capture(theme, `${event.setup.theme.name} event briefing`, theme, `${event.name} shows how the same field kit changes its colors, typography, symbols, and world language for a ${theme} event. Player briefing text is kept separate from organizer notes.`, 'public/builder.js:createKitUI.renderPlayer');
    }

    const event = fixtureEvent(), character = fixtureCharacter(event), faction = { id: FACTION_ID, name: 'Lantern Keepers', description: 'Tend the paths and the promises made along them.' };
    const characterAPI = path => {
      if (path === `/api/events/${EVENT_ID}/characters`) return { characters: [character], settings: defaultCharacterSettings(), factions: [faction] };
      if (path === `/api/events/${EVENT_ID}/characters/${CHARACTER_ID}`) return { character, inventory: [{ id: 'sample-lantern', name: 'Brass lantern', quantity: 1, notes: 'A family keepsake.' }, { id: 'sample-chalk', name: 'Trail chalk', quantity: 3, notes: 'For marking the safe route.' }] };
      if (path === `/api/badges/${BADGE_CODE}`) return { event: { name: event.name, skills: event.setup.rules.expertise }, character: { profile: { name: character.profile.name, portrait: null, pronouns: character.profile.pronouns, faction: { id: faction.id, name: faction.name } } } };
      throw new Error(`Unexpected character fixture request: ${path}`);
    };
    const characterCtx = mount(event, characterAPI), characters = createCharacterUI(characterCtx);
    await characters.open(); await characters.action({ dataset: { action: 'character-sheet', id: CHARACTER_ID } });
    capture('character', 'Create a place in the story', 'fantasy', 'Morrow Vale’s approved sheet brings together biography, faction, event-defined abilities, private objectives, and inventory. Players can create drafts and submit them for organizer approval.', 'public/characters-ui.js:createCharacterUI.action(character-sheet)', '#modal-content');
    await characters.action({ dataset: { action: 'character-badge' } });
    capture('badge', 'Share a public identity by QR', 'fantasy', 'The public badge shares only the identity fields allowed by the organizer. Private objectives and inventory stay off the badge. This fictional QR points to a reserved .invalid domain and cannot identify a real player.', 'public/characters-ui.js:createCharacterUI.action(character-badge) + public/qr.js:renderBadgeQR', '#modal-content');

    const definition = fixtureAdventure(event), snapshot = playerSnapshot(event, character, definition);
    const adventureAPI = path => {
      if (path.startsWith(`/api/events/${EVENT_ID}/adventure/play`)) return snapshot;
      if (path.startsWith(`/api/events/${EVENT_ID}/adventure/lookup?`)) return { ...snapshot, focusNodeId: 'lantern' };
      throw new Error(`Unexpected adventure fixture request: ${path}`);
    };
    const adventureCtx = mount(event, adventureAPI), player = createAdventurePlayer(adventureCtx);
    await player.open({ focusNodeId: 'lantern' });
    await player.action({ dataset: { action: 'adv-scan' } });
    document.querySelector('#adv-scan-form input[name="propCode"]').value = definition.nodes[0].code;
    await player.submit(document.querySelector('#adv-scan-form'));
    capture('relic', 'RELIC · examine a physical prop', 'fantasy', 'After identifying the lantern’s printed prop code, Morrow has recorded the inscription and can use Investigation to inspect its mechanism. Revealed readings stay in that character’s journal.', 'public/adventure-player.js:createAdventurePlayer.open + submit(adv-scan-form)');
    for (const view of [
      { id: 'dead-drop', node: 'message', title: 'DEAD DROP · receive a hidden message', description: 'A sealed letter has been opened for Morrow. Its contents now appear in their private discoveries. Organizers can require release codes and character access conditions.' },
      { id: 'cipherbox', node: 'lockbox', title: 'CIPHERBOX · work through a puzzle', description: 'The council lockbox tracks attempts for each character. One attempt has been used, a hint has been revealed, and the next answer can be submitted when the player is ready.' },
      { id: 'wayfinder', node: 'willow', title: 'WAYFINDER · gather for a scene', description: 'A conversation at the willow lists its location, play style, duration, and available places. Three players have joined a scene designed for three to six people.' },
    ]) {
      await player.open({ focusNodeId: view.node });
      if (view.id === 'cipherbox') document.querySelector('.adv-hints').open = true;
      capture(view.id, view.title, 'fantasy', view.description, 'public/adventure-player.js:createAdventurePlayer.open');
    }
    player.reset();

    const organizerEvent = { ...event, status: 'draft', role: 'owner' };
    const organizerCtx = mount(organizerEvent, path => {
      if (path === `/api/events/${EVENT_ID}/adventure/manage`) return { definition, version: 1, isRehearsal: false, hasProgress: false, progress: [], characters: [{ id: character.id, name: character.profile.name, userId: PLAYER_ID, status: 'approved' }] };
      throw new Error(`Unexpected organizer fixture request: ${path}`);
    }, true);
    const organizer = createAdventureOrganizer(organizerCtx); await organizer.open();
    capture('organizer', 'Prepare and rehearse the adventure', 'fantasy', 'The organizer writes a player introduction and private running notes, adds instruments and access conditions, prints prop labels, and creates a separate rehearsal copy before live play.', 'public/adventure-organizer.js:createAdventureOrganizer.open');
    organizer.reset();
    return results;
  } finally {
    for (const dom of doms) dom.window.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}
