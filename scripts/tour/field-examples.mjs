/**
 * Build read-only public examples with ORACLE's production UI components.
 * Every account, character, event, response, and stored reading below is fictional.
 * No server, credentials, network requests, or real browser stores are used.
 * JSDOM is a development dependency used only when generating these examples.
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { createSigilUI } from '../../public/sigil-ui.js';
import { createStaticUI } from '../../public/static-ui.js';
import { createStagehandUI } from '../../public/stagehand-ui.js';
import { createFieldUI } from '../../public/field-ui.js';
import { defaultSetup } from '../../public/kit.js';
import { defaultCharacterProfile } from '../../public/characters-model.js';
import { projectPreparation } from '../../public/preparation-model.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const at = '2026-09-07T14:00:00.000Z';
const ids = {
  account: '51000000-0000-4000-8000-000000000001',
  event: '51000000-0000-4000-8000-000000000002',
  character: '51000000-0000-4000-8000-000000000003',
  faction: '51000000-0000-4000-8000-000000000004',
};
const character = { id: ids.character, name: 'Morrow Vale' };
const event = { id: ids.event, name: 'The Lantern Accord', status: 'live', role: 'player', version: 1, setup: { enabledInstruments: ['sigil', 'static', 'stagehand', 'wayfinder'] } };
const copy = value => structuredClone(value);

async function renderExample({ create, dashboard, render, extra = {}, expect }) {
  const errors = [], virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<!doctype html><html><body><main id="tour-render"></main></body></html>', {
    url: 'https://oracle.example.test/', pretendToBeVisual: true, virtualConsole,
  });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    location: dom.window.location, history: dom.window.history, FormData: dom.window.FormData,
    localStorage: dom.window.localStorage };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.confirm = () => true;
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  const state = { session: { user: { id: ids.account, displayName: 'Example player' } }, event: copy(event), events: [copy(event)], view: 'events' };
  let ui;
  try {
    const responses = new Map();
    const api = async (path, method = 'GET') => {
      const response = responses.get(`${method} ${path}`);
      if (response === undefined) throw new Error(`Unexpected fixture request: ${method} ${path}`);
      return copy(response);
    };
    const ctx = { state, api, esc, err: '', shell: html => { dom.window.document.querySelector('#tour-render').innerHTML = html; },
      toast() {}, openModal() {}, closeModal() {}, loadEvent() { throw new Error('Example cannot load another event.'); },
      openJournal() {}, openAdventure() {}, openStory() {}, ...extra };
    ui = create(ctx);
    await render({ ui, state, responses, dom, dashboard: copy(dashboard) });
    const root = dom.window.document.querySelector('#tour-render');
    for (const text of expect) if (!root.textContent.includes(text)) throw new Error(`Example did not render ${JSON.stringify(text)}: ${root.textContent.slice(0, 600)}`);
    if (errors.length) throw new Error(errors.join('\n'));
    // Keep the real component's enabled/disabled styling. Inert prevents every
    // example control from submitting, taking focus, or requesting permissions.
    for (const child of root.children) child.setAttribute('inert', '');
    return root.innerHTML;
  } finally {
    ui?.reset();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

async function sigilExample() {
  const dashboard = { event, character, characters: [character], canManage: false, canOperate: false, readOnly: false,
    challenges: [{ id: 'lantern-sequence', title: 'Rekindle the Lantern', summary: 'Three travelers combine their craft to restore the watchlight.', available: true }],
    runs: [{ id: 'example-sigil-run', title: 'Rekindle the Lantern', status: 'running', character }],
  };
  const run = { id: 'example-sigil-run', title: 'Rekindle the Lantern', character, status: 'running', version: 3, publishedVersion: 1,
    serverTime: at, remainingMs: 284000, checkpointRemainingMs: 0, canAdvance: true, canPause: true, canCancel: true,
    completedCheckpoints: [{ id: 'gather', title: 'Gather at the watchlight' }],
    currentCheckpoint: { id: 'align', title: 'Align the three lantern lenses', instructions: 'The Keeper holds the frame steady. The Wayfinder points the lens toward the northern beacon. When the group agrees, the Speaker names the light you are protecting.', roleId: 'speaker', minimumSeconds: 0, requiresAnswer: false },
    roles: [{ roleId: 'keeper', name: 'Keeper', performer: 'Morrow Vale' }, { roleId: 'wayfinder', name: 'Wayfinder', performer: 'Ash Reed' }, { roleId: 'speaker', name: 'Speaker', performer: 'Fern Sol' }],
    components: [{ name: 'Lantern crystal', itemName: 'Lantern crystal', quantity: 1, kind: 'item', consume: false }],
    history: [{ label: 'Checkpoint completed: Gather at the watchlight', at }],
  };
  return { id: 'sigil', title: 'Solve a challenge together', theme: 'fantasy',
    description: 'SIGIL gives a group shared roles, a server-confirmed timer, and checkpoints on one device. This fictional session has reached its second step.',
    source: 'public/sigil-ui.js · createSigilUI.open() and action(sigil-run), using fictional dashboard and run responses.',
    html: await renderExample({ create: createSigilUI, dashboard, expect: ['Cooperative sequences', 'Align the three lantern lenses', 'Fern Sol', '4:44'],
      async render({ ui, responses, dashboard }) {
        responses.set(`GET /api/events/${ids.event}/sigil?characterId=${ids.character}`, dashboard);
        responses.set(`GET /api/events/${ids.event}/sigil/runs/example-sigil-run?characterId=${ids.character}`, { run });
        await ui.open({ characterId: ids.character });
        await ui.action({ dataset: { action: 'sigil-run', id: run.id } });
      },
    }),
  };
}

async function staticExample() {
  const dashboard = { event, character, characters: [character], readings: [], signals: [
    { id: 'relay', title: 'Lantern relay', zoneLabel: 'North relay / terminal 03', summary: 'A coded broadcast carries a fragment of the missing convoy log.', available: true },
    { id: 'shelter', title: 'Shelter perimeter', zoneLabel: 'Lantern Keepers camp', summary: 'The perimeter beacons respond to the event story.', available: true },
  ] };
  const signal = { id: 'relay', title: 'Lantern relay', zoneLabel: 'North relay / terminal 03', readingKey: 'relay:clear', source: 'conditions', serverTime: at, canCollect: true,
    state: { tone: 'alert', level: 72, label: 'Convoy transmission recovered', text: '“Lantern Keepers, this is Morrow Vale. The north route is clear. Meet us at the old transit shelter before the last beacon fades.”' },
  };
  return { id: 'static', title: 'Let the world answer back', theme: 'cyberpunk',
    description: 'STATIC turns a marked prop or zone into a fictional signal. Its text, intensity, and state can follow the story, and players can collect a permitted reading in their journal.',
    source: 'public/static-ui.js · createStaticUI.open() and handleHash(), with fictional lookup response; no camera or real sensor data.',
    html: await renderExample({ create: createStaticUI, dashboard, expect: ['Fictional event reading', 'Convoy transmission recovered', '72', 'Collect in journal'],
      async render({ ui, responses, dashboard, dom }) {
        responses.set(`GET /api/events/${ids.event}/static?characterId=${ids.character}`, dashboard);
        responses.set(`POST /api/events/${ids.event}/static/lookup`, { signal });
        await ui.open({ characterId: ids.character });
        dom.window.location.hash = `static/${ids.event}/AAAAAAAAAAAAAAAAAAAA`;
        await ui.handleHash();
      },
    }),
  };
}

const encounter = {
  id: 'lantern-shelter', state: 'open', version: 2, capacity: 8, attendanceCount: 3, available: true,
  canEdit: true, canCheck: true, canPause: true, canCancel: true, canEnd: true, canAnnounce: true,
  document: { title: 'The last watchlight', nodeId: 'watchlight-scene', capacity: 8, returnMinutes: 25,
    publicMessage: 'Meet the Lantern Keepers at the old shelter. Bring your account of the northern route.',
    staffUserIds: ['example-scene-staff'], staffNotes: 'Fictional example: place the lantern prop at the shelter entrance.',
    checks: [{ id: 'performer', kind: 'performer', label: 'Lantern Keeper performer briefed' }, { id: 'prop', kind: 'prop', label: 'Watchlight prop ready' }, { id: 'checkin', kind: 'staff', label: 'Scene check-in ready' }],
  },
  readiness: ['performer', 'prop', 'checkin'].map(checkId => ({ checkId, ready: true, version: 2, actorName: 'Scene staff', at })),
};
const party = { id: 'lantern-party', encounterId: encounter.id, name: 'Lantern Keepers', status: 'waiting', version: 1, termsVersion: 1,
  memberCount: 3, acceptedCount: 3, returnMinutes: 25, canDispatch: true, canRevise: true, canCancel: true,
  members: ['Morrow Vale', 'Ash Reed', 'Fern Sol'].map((name, index) => ({ id: `example-member-${index}`, name, response: 'accepted', responseTermsVersion: 1, respondedAt: at })),
};

async function stagehandStaffExample() {
  const dashboard = { event: { ...event, role: 'organizer' }, serverTime: at, canManage: true, canOperate: true, encounters: [encounter], parties: [party], activity: [],
    context: { nodes: [{ id: 'watchlight-scene', title: 'The last watchlight', location: 'Old transit shelter', maxPlayers: 8 }], staff: [{ id: 'example-scene-staff', name: 'Scene staff' }], characters: party.members },
  };
  return { id: 'stagehand', title: 'Keep scenes and parties moving', theme: 'wasteland',
    description: 'STAGEHAND gives staff readiness checks, scene capacity, a party queue, whole-party dispatch, and return acknowledgments. Here three Lantern Keepers have accepted their assignment.',
    source: 'public/stagehand-ui.js · createStagehandUI.open({ manage: true }), rendering public/stagehand-manage.js with fictional scene and party records.',
    html: await renderExample({ create: createStagehandUI, dashboard, expect: ['Keep the scenes moving.', 'The last watchlight', 'Dispatch whole party', 'Lantern Keepers', '3 / 3'],
      async render({ ui, responses, dashboard }) {
        responses.set(`GET /api/events/${ids.event}/stagehand/manage`, dashboard);
        await ui.open({ manage: true });
      },
    }),
  };
}

async function stagehandPlayerExample() {
  const scene = { id: encounter.id, title: encounter.document.title, nodeId: encounter.document.nodeId, location: 'Old transit shelter', availability: 'open', state: 'open', attendanceCount: 3, capacity: 8, publicMessage: encounter.document.publicMessage, canQueue: false };
  const assignment = { ...party, status: 'dispatched', dispatchedAt: at, returnBy: '2026-09-07T14:25:00.000Z', canCancel: false, canRespond: false };
  const dashboard = { event, serverTime: at, character, characters: [character], encounters: [scene], parties: [assignment] };
  return { id: 'stagehand-player', title: 'Know where your party goes next', theme: 'fantasy',
    description: 'Players see their own assignment, destination, and return window. Staff dispatch the party together and acknowledge its return; a timer alone never releases occupied places.',
    source: 'public/stagehand-ui.js · createStagehandUI.open(), using a fictional dispatched player assignment.',
    html: await renderExample({ create: createStagehandUI, dashboard, expect: ['Your next scene', 'Return by', '25 minutes until the return time.', 'Morrow Vale'],
      async render({ ui, responses, dashboard }) {
        responses.set(`GET /api/events/${ids.event}/stagehand?characterId=${ids.character}`, dashboard);
        await ui.open({ characterId: ids.character });
      },
    }),
  };
}

async function fieldExample() {
  const setup = defaultSetup('fantasy', 'council');
  setup.content = [{ id: 'lantern-briefing', title: 'Before you leave camp', body: 'The Lantern Keepers gather at the old shelter. Follow the marked route and return to scene staff when your party is finished.', visibility: 'player', prop: true }];
  const profile = { ...defaultCharacterProfile(setup.rules), name: character.name, pronouns: 'they / them', factionId: ids.faction,
    biography: 'A patient courier who knows the roads between the last watchlights.', privateObjectives: 'Recover the convoy log and learn who kept the northern beacon burning.',
    startingEquipment: [{ name: 'Weathered route map', quantity: 1, notes: 'Marked with the Lantern Keepers seal.' }],
  };
  const prep = projectPreparation({ event: { ...event, description: 'An evening of exploration, shared choices, and the last lights of a changing world.', location: 'Old transit shelter', startsAt: '2026-09-07T16:00:00.000Z' },
    setup, factions: [{ id: ids.faction, name: 'Lantern Keepers' }],
    characters: [{ id: ids.character, eventId: ids.event, userId: ids.account, status: 'approved', visibility: 'private', profile, inventory: [{ name: 'Lantern crystal', quantity: 1, notes: 'Carried by Morrow Vale.' }] }],
    journals: [{ characterId: ids.character, readingIds: ['example-watchlight-reading'], verifiedAt: at }], preparedAt: at,
  }, ids.account);
  const local = { accountId: ids.account, scope: { accountId: ids.account }, lastChecked: at,
    contexts: [{ event: { id: ids.event, name: event.name }, characters: [character], lastChecked: at, preparation: prep }],
    drafts: [{ eventId: ids.event, characterId: ids.character, text: 'The relay used the old Lantern Keepers greeting. Ask Fern about the missing convoy log when we return to camp.\n\nMeet Ash at the shelter before the next watch.', updatedAt: at, revision: 1 }],
    requests: [{ id: 'example-unsent-request', eventId: ids.event, characterId: ids.character, kind: 'create', state: 'pending', label: 'Invite Ash to exchange information', createdAt: at, expiresAt: '2026-09-08T14:00:00.000Z', payload: { characterId: ids.character } }],
  };
  const archive = { accountId: ids.account, records: [{ event: { id: ids.event, name: event.name }, character, lastChecked: at,
    journal: [{ id: 'example-watchlight-reading', title: 'A message at the watchlight', text: 'The northern beacon still burns. Someone is keeping watch.' }],
  }] };
  return { id: 'field-desk', title: 'Prepare before the signal disappears', theme: 'fantasy',
    description: 'The Field desk keeps prepared reference material, saved readings, local notes, and unsent information requests separate. This fictional kit is prepared; shared gameplay still requires a connection.',
    source: 'public/field-ui.js · createFieldUI.open(), using in-memory fictional stores and projectPreparation() validation from public/preparation-model.js.',
    html: await renderExample({ create: createFieldUI, dashboard: {}, expect: ['Prepare for the field', 'Saved reference material and journal copies are available.', 'Ask Fern', 'Saved · never transmitted'],
      extra: { store: { loadLocal: async () => copy(local), subscribe() { return () => {}; } },
        offline: { loadArchive: async () => copy(archive), subscribe() { return () => {}; } },
        sync: { busy: false, reset() {} }, checkOfflineShell: async () => true, isOfflineShellReady: () => true },
      async render({ ui, dom }) {
        await ui.open();
        // Opening an existing disclosure is a real UI state, not replacement markup.
        dom.window.document.querySelector('.field-prepared-event').open = true;
      },
    }),
  };
}

/** Run sequentially: UI controllers read browser globals while rendering. */
export async function examples() {
  const results = [];
  for (const build of [sigilExample, staticExample, stagehandStaffExample, stagehandPlayerExample, fieldExample]) results.push(await build());
  return results;
}
