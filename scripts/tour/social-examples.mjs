import { JSDOM } from 'jsdom';
import { createExchangeUI } from '../../public/exchanges-ui.js';
import { createStoryUI } from '../../public/story-ui.js';
import { createTraceUI } from '../../public/trace-ui.js';
import { createEconomyUI } from '../../public/economy-ui.js';
import { createOathUI } from '../../public/oath-ui.js';

// Fictional, read-only fixtures rendered by the shipped components. No user,
// event, badge, invitation, or API credentials are read from a running service.
const AT = '2026-06-21T16:20:00.000Z';
const EVENT = {
  id: 'tour-morrow-vale', name: 'Morrow Vale · The Last Lantern',
  status: 'live', role: 'player', theme: 'fantasy',
  setup: { enabledInstruments: ['whisper', 'broadside', 'trace', 'bazaar', 'oathbook'], rules: { expertise: [{ id: 'lore', name: 'Ancient lore' }] } },
};
const ROWAN = { id: 'tour-rowan', name: 'Rowan Ash', status: 'approved', profile: { name: 'Rowan Ash', pronouns: 'they/them', faction: { id: 'lantern-keepers', name: 'Lantern Keepers' }, biography: 'A pathfinder searching for the lost beacon of Morrow Vale.', skills: ['lore'] } };
const TAMSIN = { id: 'tour-tamsin', name: 'Tamsin Reed', status: 'approved', profile: { name: 'Tamsin Reed', pronouns: 'she/her', faction: { id: 'river-guild', name: 'River Guild' }, biography: 'A river courier who remembers every crossing and almost every promise.' } };
const CROWNS = { id: 'crowns', name: 'Crowns' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

async function renderFixture(createUI, routes, open, prepare = () => {}) {
  const dom = new JSDOM('<!doctype html><html><body><main id="tour-content"></main><dialog id="modal"></dialog></body></html>', { url: 'https://oracle.example/' });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, location: dom.window.location, history: dom.window.history, FormData: dom.window.FormData };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let ui;
  const state = { session: { user: { id: 'tour-fictional-viewer' } }, event: structuredClone(EVENT), view: '' };
  const reads = [];
  const ctx = {
    state, esc, err: '', isManager: () => false,
    shell: html => { document.querySelector('#tour-content').innerHTML = html; },
    api: async (path, method = 'GET') => {
      if (method !== 'GET') throw new Error(`Tour fixtures may only read: ${method} ${path}`);
      const route = new URL(path, 'https://oracle.example/').pathname;
      if (!(route in routes)) throw new Error(`No fictional fixture for ${route}`);
      reads.push(route);
      return structuredClone(routes[route]);
    },
    loadEvent: async () => {}, openJournal: async () => {}, openExchanges: async () => {},
    toast: message => { throw new Error(`Unexpected tour message: ${message}`); },
    openModal: (title, html) => { document.querySelector('#modal').innerHTML = `<h2>${esc(title)}</h2>${html}`; },
    closeModal: () => {},
  };
  try {
    ui = createUI(ctx);
    await open(ui, state);
    await prepare(ui, dom.window.document);
    if (!reads.length) throw new Error('Tour example did not read its fixture.');
    if (document.querySelector('.error, [role="alert"]')) throw new Error(`Tour example displayed an error: ${document.querySelector('.error, [role="alert"]').textContent}`);
    return document.querySelector('#tour-content').innerHTML;
  } finally {
    ui?.reset();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

const expand = selector => (_ui, document) => { document.querySelectorAll(selector).forEach(element => { element.open = true; }); };
const base = path => `/api/events/${EVENT.id}/${path}`;
const source = (file, actions) => `${file}; ${actions}; fictional local GET fixtures; no live records`;

export async function examples() {
  const output = [];
  const exchangeDashboard = {
    event: EVENT, character: ROWAN, characters: [ROWAN], readOnly: false,
    sessions: [{ id: 'tour-exchange-complete', status: 'completed', partner: TAMSIN, updatedAt: AT, ownConfirmed: true, partnerConfirmed: true }],
    contacts: [{ character: TAMSIN, metAt: AT }],
    readings: [{ id: 'tour-old-beacon', title: 'The old beacon inscription', type: 'relic', shareable: true }],
    inventory: [{ id: 'tour-map', name: 'River crossing map', quantity: 1, version: 1 }],
    resources: [CROWNS], balances: [{ resourceId: 'crowns', quantity: 28 }],
  };
  const completed = {
    id: 'tour-exchange-complete', event: EVENT, character: ROWAN, version: 4,
    status: 'completed', serverTime: AT, readOnly: true,
    own: { character: ROWAN, offered: [{ id: 'tour-old-beacon', title: 'The old beacon inscription' }], assets: { items: [], resources: [{ resourceId: 'crowns', name: 'Crowns', quantity: 2 }] }, confirmed: true },
    partner: { character: TAMSIN, offered: [{ id: 'tour-river-sign', title: 'A ferryman’s warning' }], assets: { items: [{ itemId: 'tour-map', name: 'River crossing map', quantity: 1 }], resources: [] }, confirmed: true },
    receipt: {
      completedAt: AT, introduced: true, partnerName: TAMSIN.name,
      sent: [{ id: 'tour-old-beacon', title: 'The old beacon inscription' }],
      received: [{ id: 'tour-river-sign', title: 'A ferryman’s warning', text: 'The river has fallen, but the eastern stepping stones still disappear at dusk. Follow the three white lanterns to the western crossing.', alreadyKnown: false }],
      assets: { transactionId: 'fictional-tour-trade', sent: { resources: [{ name: 'Crowns', quantity: 2 }], items: [] }, received: { items: [{ name: 'River crossing map', quantity: 1 }], resources: [] } },
    },
  };
  const exchangeRoutes = { [base('exchanges')]: exchangeDashboard, [base('exchanges/tour-exchange-complete')]: { exchange: completed } };
  output.push({ id: 'exchanges', title: 'Meet, share, and trade', theme: 'fantasy', description: 'Start a temporary QR invitation or scan another player. Completed introductions become contacts, while sharing and trading require both players to confirm.', source: source('public/exchanges-ui.js', 'createExchangeUI.open; Recent exchanges and Contacts expanded'), html: await renderFixture(createExchangeUI, exchangeRoutes, ui => ui.open(), expand('.exchange-section, .exchange-contact')) });
  output.push({ id: 'exchange-receipt', title: 'An exchange both players confirmed', theme: 'fantasy', description: 'A completed exchange preserves shared readings in the journal and records the exact items and fictional resources transferred.', source: source('public/exchanges-ui.js', 'createExchangeUI.open with exchangeId; sent-readings disclosure expanded'), html: await renderFixture(createExchangeUI, exchangeRoutes, ui => ui.open({ characterId: ROWAN.id, exchangeId: completed.id }), expand('.exchange-receipt-sent')) });

  const story = {
    event: EVENT, character: ROWAN, characters: [ROWAN], readOnly: false,
    rumors: [
      { id: 'tour-rumor-beacon', title: 'Someone lit the old beacon', sourceLabel: 'Overheard at the River Guild', collected: true },
      { id: 'tour-rumor-bell', title: 'The bell rang before dawn', sourceLabel: 'A watchkeeper’s account', collected: false },
    ],
    bulletins: [{ id: 'tour-bulletin', title: 'Lantern muster at the western crossing', sourceLabel: 'Notice from the Lantern Keepers', body: 'All pathfinders are asked to gather at the western crossing before the evening bell. Bring a lantern and report any signs of the missing courier to the watchkeeper.', publicationVersion: 1, publishedAt: AT }],
    readings: [{ id: 'tour-rumor-reading', type: 'whisper', title: 'Someone lit the old beacon', text: '“Three nights dark, then a pale flame over the tower. I saw it myself,” says a River Guild boatkeeper. Another traveler insists it was only moonlight on the broken glass.', createdAt: AT }],
  };
  output.push({ id: 'story', title: 'Rumors and event news', theme: 'fantasy', description: 'WHISPER lets characters collect conflicting accounts. BROADSIDE publishes organizer-reviewed news, printable notices, and player reports.', source: source('public/story-ui.js', 'createStoryUI.open; collected account expanded'), html: await renderFixture(createStoryUI, { [base('story/play')]: story }, ui => ui.open(), expand('.story-reading')) });

  const theory = {
    id: 'tour-theory', title: 'The missing courier followed the beacon', kind: 'theory',
    notes: 'The courier left before the bell, and Tamsin saw a lantern on the ridge. Could the beacon have been a meeting signal? Ask the watchkeeper who held the tower key.',
    owner: ROWAN, isOwner: true, audience: { type: 'faction', ids: ['lantern-keepers'] },
    sources: [{ id: 'tour-rumor-reading', title: 'Someone lit the old beacon', type: 'whisper' }],
    links: [{ recordId: 'tour-place', title: 'The western crossing', label: 'Last confirmed route' }, { recordId: 'tour-person', title: 'Tamsin Reed', label: 'Saw a lantern on the ridge' }],
    updatedAt: AT, version: 1,
  };
  const trace = {
    event: EVENT, character: ROWAN, characters: [ROWAN], readOnly: false,
    records: [theory,
      { id: 'tour-place', title: 'The western crossing', kind: 'place', notes: 'Three white lanterns mark the path.', isOwner: true, owner: ROWAN, audience: { type: 'private', ids: [] }, sources: [], links: [], updatedAt: AT },
      { id: 'tour-person', title: 'Tamsin Reed', kind: 'person', notes: 'River Guild courier. Knows the safe crossing.', isOwner: true, owner: ROWAN, audience: { type: 'private', ids: [] }, sources: [], links: [], updatedAt: AT },
      { id: 'tour-evidence', title: 'The broken beacon lens', kind: 'evidence', notes: 'Old brass around a fractured green lens.', isOwner: false, owner: TAMSIN, audience: { type: 'public', ids: [] }, sources: [], links: [], updatedAt: AT },
    ],
    sources: theory.sources, audiences: { factions: [{ id: 'lantern-keepers', name: 'Lantern Keepers' }], groups: [], characters: [ROWAN, TAMSIN] },
  };
  output.push({ id: 'trace', title: 'Follow the connections', theme: 'fantasy', description: 'TRACE connects evidence, people, places, and theories. Choose who can read a record, and cite journal readings without copying private source text.', source: source('public/trace-ui.js', 'createTraceUI.open then trace-select; citations and connections expanded'), html: await renderFixture(createTraceUI, { [base('trace')]: trace }, ui => ui.open(), async (ui, document) => { await ui.action({ dataset: { action: 'trace-select', id: theory.id } }); document.querySelectorAll('.trace-related').forEach(element => { element.open = true; }); }) });

  const bazaar = {
    event: EVENT, character: ROWAN, characters: [ROWAN], readOnly: false, canManage: false,
    resources: [CROWNS], balances: [{ resourceId: 'crowns', quantity: 28 }],
    inventory: [{ id: 'tour-lantern', name: 'Storm lantern', quantity: 1 }, { id: 'tour-map', name: 'River crossing map', quantity: 1 }],
    shops: [{ id: 'tour-shop', name: 'The Lantern & Thistle', description: 'Supplies for a long night in Morrow Vale.', enabled: true, stock: [
      { id: 'tour-oil', name: 'Lantern oil', description: 'A sealed flask with the guild’s blue mark.', resourceId: 'crowns', unitPrice: 3, quantity: 12, version: 1 },
      { id: 'tour-rope', name: 'Pathfinder’s rope', description: 'Useful for an uncertain crossing.', resourceId: 'crowns', unitPrice: 5, quantity: 6, version: 1 },
    ] }],
    receipts: [{ id: 'fictional-tour-purchase', kind: 'purchase', createdAt: AT, purchase: { name: 'Storm lantern', shopName: 'The Lantern & Thistle', quantity: 1, total: 8, unitPrice: 8, resourceId: 'crowns' } }],
  };
  output.push({ id: 'bazaar', title: 'An economy for the story', theme: 'fantasy', description: 'BAZAAR keeps fictional balances, shop stock, character inventory, and transaction receipts together. Players review purchases and agree trades using game resources.', source: source('public/economy-ui.js', 'createEconomyUI.open; transaction receipts expanded'), html: await renderFixture(createEconomyUI, { [base('bazaar')]: bazaar }, (ui, state) => ui.open(state.event), expand('.bazaar-section, .bazaar-receipt')) });

  const agreement = {
    id: 'tour-oath', title: 'Safe passage for the lantern caravan', status: 'active', termsVersion: 1, version: 4,
    terms: 'Rowan Ash will guide the Lantern Keepers’ caravan from the western crossing to the old beacon before the evening bell. Tamsin Reed will provide the crossing map and pay Rowan five Crowns once both confirm the caravan arrived.',
    expiresAt: null,
    participants: [{ characterId: ROWAN.id, name: ROWAN.name, accepted: true, acceptedTermsVersion: 1, acceptedAt: AT, settlementConfirmed: false }, { characterId: TAMSIN.id, name: TAMSIN.name, accepted: true, acceptedTermsVersion: 1, acceptedAt: AT, settlementConfirmed: false }],
    witnesses: [{ characterId: 'tour-witness', name: 'Elowen Pike', witnessed: true, termsVersion: 1, witnessedAt: AT }],
    settlement: [{ fromCharacterId: TAMSIN.id, toCharacterId: ROWAN.id, resourceId: 'crowns', resourceName: 'Crowns', quantity: 5 }],
    canSettle: true, canDispute: true, canEdit: false,
    history: [{ action: 'created', at: AT, characterName: ROWAN.name, termsVersion: 1 }, { action: 'accepted', at: AT, characterName: TAMSIN.name, termsVersion: 1 }, { action: 'witnessed', at: AT, characterName: 'Elowen Pike', termsVersion: 1 }],
  };
  const oaths = { event: EVENT, character: ROWAN, characters: [ROWAN], participants: [ROWAN, TAMSIN], resources: [CROWNS], readOnly: false, canManage: false, agreements: [agreement, { id: 'tour-oath-complete', title: 'Return the watchkeeper’s compass', status: 'fulfilled', termsVersion: 1 }] };
  output.push({ id: 'oathbook', title: 'Put a promise on record', theme: 'fantasy', description: 'OATHBOOK records exact terms, participant acceptance, witnesses, disputes, and fulfillment. Agreed resource transfers wait for the required confirmations.', source: source('public/oath-ui.js', 'createOathUI.open then oath-select'), html: await renderFixture(createOathUI, { [base('oaths')]: oaths, [base(`oaths/${agreement.id}`)]: { agreement } }, ui => ui.open(), ui => ui.action({ dataset: { action: 'oath-select', id: agreement.id } })) });

  for (const example of output) {
    if (!example.html.includes('<h1>') || /undefined|NaN|No fictional fixture|No user/.test(example.html)) throw new Error(`Incomplete ${example.id} tour rendering.`);
  }
  return output;
}
