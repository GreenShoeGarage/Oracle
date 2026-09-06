import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './database.js';
import { migrate } from '../src/db.js';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { defaultSetup } from '../public/kit.js';
import { defaultCharacterProfile } from '../public/characters-model.js';
import { defaultAdventure, defaultAdventureNode } from '../public/adventure-model.js';
import { defaultStagehandDocument, validateStagehandDocument, validateStagehandRequest } from '../public/stagehand-model.js';
import { copyStagehand, resetStagehand, stagehandWayfinderState } from '../src/stagehand-core.js';

let database, pool, server, origin;
const users = {};
const reqId = () => ({ requestId: randomUUID() });
const ok = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.data)); return response.data; };
const base = fixture => `/api/events/${fixture.event.id}/stagehand`;
async function request(path, method = 'GET', value, user = users.owner) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...(user?.cookie ? { Cookie: user.cookie } : {}) }, body: value === undefined ? undefined : JSON.stringify(value) });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const rowFrom = (dashboard, key = 'parties') => { const row = dashboard[key].find(row => row.id === dashboard.outcome.targetId); assert.ok(row, JSON.stringify(dashboard)); return row; };
async function manage(f, who = 'owner') { return ok(await request(`${base(f)}/manage`, 'GET', undefined, users[who])); }
async function fixture({ capacity = 2, checks = [], status = 'rehearsal' } = {}) {
  const setup = defaultSetup('fantasy'); setup.enabledInstruments = ['briefing', 'wayfinder', 'stagehand', 'broadside'];
  const event = ok(await request('/api/events', 'POST', { name: 'STAGEHAND party integration', setup }), 201).event;
  const characters = {};
  for (const name of ['a', 'b', 'c', 'staff', 'otherstaff']) {
    await pool.query('INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,$3)', [event.id, users[name].id, name.includes('staff') ? 'staff' : 'player']);
    if (name.includes('staff')) continue;
    const profile = { ...defaultCharacterProfile(setup.rules), name: `Party ${name}`, privateObjectives: `PRIVATE_${name}_OBJECTIVE` };
    characters[name] = ok(await request(`/api/events/${event.id}/characters`, 'POST', { profile }, users[name]), 201).character;
    await pool.query("UPDATE characters SET status='approved',inventory_initialized=true WHERE id=$1", [characters[name].id]);
  }
  const nodes = ['a', 'b'].map((name, index) => ({ ...defaultAdventureNode('wayfinder', `scene-${name}`, (index ? 'B' : 'A').repeat(20)), title: `Scene ${name}`, location: `Field ${name}`, maxPlayers: capacity }));
  const definition = { ...defaultAdventure(), flags: [{ id: 'scene-unlocked', name: 'Scene unlocked' }], nodes };
  ok(await request(`/api/events/${event.id}/adventure/manage`, 'PUT', { version: 0, definition }));
  await pool.query('UPDATE events SET status=$2 WHERE id=$1', [event.id, status]);
  const f = { event, characters, nodes, definition, encounters: [] };
  for (let index = 0; index < nodes.length; index++) {
    const document = { ...defaultStagehandDocument(), title: `Encounter ${index + 1}`, nodeId: nodes[index].id, publicMessage: 'Please check in with the scene marshal.', staffNotes: `PRIVATE_STAFF_NOTE_${index}`, capacity, staffUserIds: [index ? users.otherstaff.id : users.staff.id], checks, returnMinutes: 15 };
    const response = ok(await request(`${base(f)}/encounters`, 'POST', { ...reqId(), document }), 201);
    f.encounters.push(rowFrom(response, 'encounters'));
  }
  return f;
}
async function open(f, index = 0) {
  let encounter = (await manage(f)).encounters.find(row => row.id === f.encounters[index].id);
  for (const check of encounter.document.checks) encounter = rowFrom(ok(await request(`${base(f)}/encounters/${encounter.id}/check`, 'POST', { ...reqId(), version: encounter.version, checkId: check.id, ready: true, reason: 'Checked at the scene.' })), 'encounters');
  encounter = rowFrom(ok(await request(`${base(f)}/encounters/${encounter.id}/state`, 'POST', { ...reqId(), version: encounter.version, state: 'open', reason: 'The scene is ready.' })), 'encounters');
  f.encounters[index] = encounter; return encounter;
}
function createInput(f, names = ['a', 'b'], index = 0) { return { ...reqId(), encounterId: f.encounters[index].id, name: 'Field party', characterIds: names.map(name => f.characters[name].id), returnMinutes: 15 }; }
async function createParty(f, names = ['a', 'b'], index = 0, who = 'owner') { return rowFrom(ok(await request(`${base(f)}/parties`, 'POST', createInput(f, names, index), users[who]), 201)); }
async function getParty(f, id) { return (await manage(f)).parties.find(row => row.id === id); }
async function respond(f, party, name, response = 'accepted') { return rowFrom(ok(await request(`${base(f)}/parties/${party.id}/respond`, 'POST', { ...reqId(), version: party.version, characterId: f.characters[name].id, response }, users[name]))); }
async function acceptAll(f, party, names = ['a', 'b']) { for (const name of names) { await respond(f, party, name); party = await getParty(f, party.id); } return party; }
async function operate(f, party, action, who = 'staff', extra = {}) { return rowFrom(ok(await request(`${base(f)}/parties/${party.id}/${action}`, 'POST', { ...reqId(), version: party.version, reason: 'Checked the whole party at the scene.', ...extra }, users[who]))); }
async function join(f, name, kind = 'join', index = 0) {
  const version = (await pool.query('SELECT version FROM event_adventures WHERE event_id=$1', [f.event.id])).rows[0].version;
  return request(`/api/events/${f.event.id}/adventure/action`, 'POST', { ...reqId(), version, characterId: f.characters[name].id, nodeId: f.nodes[index].id, kind }, users[name]);
}

before(async () => {
  database = await testDatabase(); pool = database.pool; await migrate(pool);
  let handler; server = createServer((req, res) => handler(req, res)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  handler = createApp({ pool, config: { ...readConfig({ DATABASE_URL: 'postgres://unused', PORT: '3000' }), origin }, logger: entry => console.error(entry) });
  for (const name of ['owner', 'a', 'b', 'c', 'staff', 'otherstaff', 'outsider']) { const response = await request('/api/auth/register', 'POST', { displayName: `Party ${name}`, email: `${name}@stagehand-core.example.test`, password: 'Stagehand party test passphrase!' }, null); users[name] = { ...ok(response, 201).user, cookie: response.cookie }; }
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); if (database) await database.close(); });

test('operations schema rejects forged data, sparse checks, duplicate staff, impossible values and prototype actions', () => {
  const value = { ...defaultStagehandDocument(), title: 'Scene', nodeId: 's'.repeat(48) };
  assert.equal(validateStagehandDocument(value).nodeId.length, 48);
  for (const mutate of [doc => { doc.state = 'open'; }, doc => { doc.capacity = '2'; }, doc => { doc.capacity = 101; }, doc => { doc.returnMinutes = 0; }, doc => { const id = randomUUID(); doc.staffUserIds = [id, id]; }, doc => { doc.checks = [{ id: 'prop', label: 'Prop', kind: 'prop' }, { id: 'prop', label: 'Again', kind: 'prop' }]; }, doc => { doc.checks = new Array(1); }, doc => { doc.checks = [{ id: 'prop', label: 'Prop', kind: 'prop', ready: true }]; }]) { const candidate = structuredClone(value); mutate(candidate); assert.throws(() => validateStagehandDocument(candidate), { status: 400 }); }
  for (const action of ['__proto__', 'constructor', 'toString']) assert.throws(() => validateStagehandRequest({}, action), { status: 400 });
  assert.throws(() => validateStagehandRequest({ ...reqId(), version: 1, checkId: 'prop', ready: true, reason: 'Checked', actorId: randomUUID() }, 'check'), { status: 400 });
});

test('staff scope filters operational encounters, hidden scene directory and activity while players receive only safe unlocked metadata', async () => {
  const f = await fixture({ checks: [{ id: 'prop', label: 'PRIVATE_PROP_REQUIREMENT', kind: 'prop' }] });
  const staff = await manage(f, 'staff'); assert.equal(staff.encounters.length, 1); assert.equal(staff.context.nodes.length, 1); assert.equal(staff.context.nodes[0].id, 'scene-a'); assert.equal(staff.context.staff.length, 1);
  await pool.query("UPDATE memberships SET role='staff' WHERE event_id=$1 AND user_id=$2", [f.event.id, users.c.id]);
  const unassigned = await manage(f, 'c'); assert.equal(unassigned.encounters.length, 0); assert.equal(unassigned.activity.length, 0); assert.deepEqual(unassigned.context, { nodes: [], staff: [], characters: [] });
  const player = ok(await request(`${base(f)}?characterId=${f.characters.a.id}`, 'GET', undefined, users.a));
  for (const secret of ['PRIVATE_STAFF_NOTE', 'PRIVATE_PROP_REQUIREMENT', users.staff.id, 'staffUserIds', 'checks', 'activity', 'Party b', users.b.id, 'PRIVATE_a_OBJECTIVE']) assert.ok(!JSON.stringify(player).includes(secret), secret);
  assert.equal(player.encounters.length, 2); assert.equal(player.encounters[0].canQueue, true);
  const changed = structuredClone(f.definition); changed.nodes[1].conditions.flags = ['scene-unlocked'];
  ok(await request(`/api/events/${f.event.id}/adventure/manage`, 'PUT', { version: 1, definition: changed }));
  const locked = ok(await request(`${base(f)}?characterId=${f.characters.a.id}`, 'GET', undefined, users.a)); assert.equal(locked.encounters.length, 1); assert.ok(!JSON.stringify(locked).includes('Scene b'));
});

test('readiness is acknowledged by actual current staff; loss of permission blocks admission and reopening is explicit', async () => {
  const f = await fixture({ checks: [{ id: 'prop', label: 'Prop checked', kind: 'prop' }] }); let encounter = f.encounters[0];
  assert.equal((await request(`${base(f)}/encounters/${encounter.id}/state`, 'POST', { ...reqId(), version: encounter.version, state: 'open', reason: 'Not yet checked.' }, users.staff)).status, 409);
  const check = { ...reqId(), version: encounter.version, checkId: 'prop', ready: true, reason: 'Prop inspected on site.' };
  encounter = rowFrom(ok(await request(`${base(f)}/encounters/${encounter.id}/check`, 'POST', check, users.staff)), 'encounters');
  assert.equal(encounter.readiness[0].actorName, users.staff.displayName); assert.equal(encounter.readiness[0].ready, true);
  assert.equal(ok(await request(`${base(f)}/encounters/${encounter.id}/check`, 'POST', check, users.staff)).outcome.replayed, true);
  encounter = rowFrom(ok(await request(`${base(f)}/encounters/${encounter.id}/state`, 'POST', { ...reqId(), version: encounter.version, state: 'open', reason: 'All checks ready.' }, users.staff)), 'encounters');
  await pool.query('UPDATE users SET is_disabled=true WHERE id=$1', [users.staff.id]);
  encounter = (await manage(f)).encounters.find(row => row.id === encounter.id); assert.equal(encounter.available, false); assert.equal(encounter.readiness[0].ready, false);
  await pool.query('UPDATE users SET is_disabled=false WHERE id=$1', [users.staff.id]);
  encounter = rowFrom(ok(await request(`${base(f)}/encounters/${encounter.id}/check`, 'POST', { ...reqId(), version: encounter.version, checkId: 'prop', ready: false, reason: 'Prop needs repair.' }, users.staff)), 'encounters');
  assert.equal(encounter.state, 'paused');
  encounter = rowFrom(ok(await request(`${base(f)}/encounters/${encounter.id}/check`, 'POST', { ...reqId(), version: encounter.version, checkId: 'prop', ready: true, reason: 'Repair checked.' }, users.staff)), 'encounters');
  assert.equal(encounter.state, 'paused'); assert.equal(encounter.canOpen, true);
});

test('configuration enforces staff and scene references, clears readiness and cannot silently relink active party consent', async () => {
  const f = await fixture({ checks: [{ id: 'staff', label: 'Staff ready', kind: 'staff' }] }); let encounter = await open(f);
  const changed = { ...encounter.document, publicMessage: 'Updated public instructions' };
  encounter = rowFrom(ok(await request(`${base(f)}/encounters/${encounter.id}`, 'PUT', { ...reqId(), version: encounter.version, document: changed })), 'encounters');
  assert.equal(encounter.state, 'paused'); assert.equal(encounter.readiness[0].ready, false);
  assert.equal((await request(`${base(f)}/encounters/${encounter.id}`, 'PUT', { ...reqId(), version: encounter.version, document: { ...changed, staffUserIds: [users.a.id] } })).status, 400);
  assert.equal((await request(`${base(f)}/encounters/${encounter.id}`, 'PUT', { ...reqId(), version: encounter.version, document: { ...changed, capacity: 3 } })).status, 400);
  await createParty(f, ['a']);
  assert.equal((await request(`${base(f)}/encounters/${encounter.id}`, 'PUT', { ...reqId(), version: encounter.version, document: { ...changed, nodeId: null } })).status, 409);
  await pool.query('INSERT INTO adventure_attendance(event_id,node_id,character_id) VALUES($1,$2,$3),($1,$2,$4)', [f.event.id, f.nodes[0].id, f.characters.a.id, f.characters.b.id]);
  assert.equal((await request(`${base(f)}/encounters/${encounter.id}`, 'PUT', { ...reqId(), version: encounter.version, document: { ...changed, capacity: 1 } })).status, 409);
});

test('encounter cancellation retains the whole waiting queue for explicit redirect and cannot silently reopen', async () => {
  const f = await fixture(); await open(f); await open(f, 1); let party = await acceptAll(f, await createParty(f));
  let encounter = (await manage(f)).encounters.find(row => row.id === f.encounters[0].id);
  encounter = rowFrom(ok(await request(`${base(f)}/encounters/${encounter.id}/state`, 'POST', { ...reqId(), version: encounter.version, state: 'cancelled', reason: 'Scene performer unavailable; redirect its queue.' }, users.staff)), 'encounters');
  party = await getParty(f, party.id); assert.equal(party.status, 'waiting'); assert.equal(party.canDispatch, false);
  const player = ok(await request(`${base(f)}?characterId=${f.characters.a.id}`, 'GET', undefined, users.a)); assert.equal(player.parties[0].canRespond, false);
  assert.equal((await request(`${base(f)}/encounters/${encounter.id}/state`, 'POST', { ...reqId(), version: encounter.version, state: 'open', reason: 'Cannot revive terminal encounter.' })).status, 409);
  party = rowFrom(ok(await request(`${base(f)}/parties/${party.id}`, 'PUT', { ...createInput(f, ['a', 'b'], 1), version: party.version })));
  assert.equal(party.encounterId, f.encounters[1].id); assert.equal(party.acceptedCount, 0); assert.equal(party.members.length, 2);
});

test('announcements require explicit organizer approval and become unavailable after encounter revision or disabled linkage', async () => {
  const f = await fixture(); const encounter = await open(f);
  const input = { ...reqId(), version: encounter.version, title: 'The scene is ready', body: 'Please report to the scene marshal with your accepted party.' };
  const response = ok(await request(`${base(f)}/encounters/${encounter.id}/announcement`, 'POST', input, users.staff));
  const announcement = rowFrom(response, 'encounters').announcement; assert.equal(announcement.status, 'submitted');
  assert.equal(ok(await request(`${base(f)}/encounters/${encounter.id}/announcement`, 'POST', input, users.staff)).outcome.replayed, true);
  const storyBase = `/api/events/${f.event.id}/story`;
  let entry = ok(await request(`${storyBase}/manage`)).entries.find(row => row.id === announcement.storyEntryId);
  assert.equal(entry.document.truth, ''); assert.ok(!JSON.stringify(entry.document).includes('PRIVATE_STAFF_NOTE'));
  assert.equal((await request(`${storyBase}/entries/${entry.id}/publish`, 'POST', { ...reqId(), version: entry.version }, users.staff)).status, 403);
  assert.equal(ok(await request(`${storyBase}/play?characterId=${f.characters.a.id}`, 'GET', undefined, users.a)).bulletins.length, 0);
  entry = ok(await request(`${storyBase}/entries/${entry.id}/publish`, 'POST', { ...reqId(), version: entry.version })).entry;
  assert.equal(ok(await request(`${storyBase}/play?characterId=${f.characters.a.id}`, 'GET', undefined, users.a)).bulletins.length, 1);
  await pool.query("UPDATE events SET setup=jsonb_set(setup,'{enabledInstruments}','[\"briefing\",\"stagehand\",\"broadside\"]') WHERE id=$1", [f.event.id]);
  assert.equal(ok(await request(`${storyBase}/play?characterId=${f.characters.a.id}`, 'GET', undefined, users.a)).bulletins.length, 0);
  await pool.query("UPDATE events SET setup=jsonb_set(setup,'{enabledInstruments}','[\"briefing\",\"wayfinder\",\"stagehand\",\"broadside\"]') WHERE id=$1", [f.event.id]);
  await request(`${base(f)}/encounters/${encounter.id}/state`, 'POST', { ...reqId(), version: encounter.version, state: 'paused', reason: 'Scene paused; previous availability no longer current.' }, users.staff);
  assert.equal(ok(await request(`${storyBase}/play?characterId=${f.characters.a.id}`, 'GET', undefined, users.a)).bulletins.length, 0);
  assert.equal((await request(`${storyBase}/entries/${entry.id}/publish`, 'POST', { ...reqId(), version: entry.version })).status, 409);
});

test('operational GETs never mutate overdue parties or current reservations; scene upper bounds remain authoritative', async () => {
  const f = await fixture(); await open(f); let party = await operate(f, await acceptAll(f, await createParty(f)), 'dispatch');
  await pool.query("UPDATE stagehand_parties SET return_by=clock_timestamp()-interval '5 minutes' WHERE id=$1", [party.id]);
  const before = (await pool.query('SELECT * FROM stagehand_parties WHERE event_id=$1 ORDER BY id', [f.event.id])).rows;
  const dashboard = await manage(f); party = dashboard.parties.find(row => row.id === party.id); assert.equal(party.overdue, true); assert.equal(dashboard.encounters[0].attendanceCount, 2);
  await request(`${base(f)}?characterId=${f.characters.a.id}`, 'GET', undefined, users.a);
  assert.deepEqual((await pool.query('SELECT * FROM stagehand_parties WHERE event_id=$1 ORDER BY id', [f.event.id])).rows, before);
  const definition = structuredClone(f.definition); definition.nodes[0].availability = 'closed';
  ok(await request(`/api/events/${f.event.id}/adventure/manage`, 'PUT', { version: 1, definition }));
  assert.equal((await join(f, 'a')).status, 409);
  const event = (await pool.query('SELECT * FROM events WHERE id=$1', [f.event.id])).rows[0];
  const host = (await pool.query('SELECT * FROM characters WHERE id=$1', [f.characters.a.id])).rows[0];
  assert.equal((await stagehandWayfinderState(pool, event, definition.nodes[0], host)).canJoin, false);
});

test('whole-event end closes waiting and dispatched parties, preserves inherited legacy attendance and archives all writes', async () => {
  const f = await fixture({ status: 'live' }); await open(f); await open(f, 1);
  await pool.query('INSERT INTO adventure_attendance(event_id,node_id,character_id) VALUES($1,$2,$3)', [f.event.id, f.nodes[0].id, f.characters.a.id]);
  const party = await operate(f, await acceptAll(f, await createParty(f)), 'dispatch'); await join(f, 'b'); await createParty(f, ['c'], 1);
  let event = ok(await request(`/api/events/${f.event.id}`)).event;
  event = ok(await request(`/api/events/${f.event.id}`, 'PATCH', { version: event.version, status: 'paused' })).event;
  assert.equal((await getParty(f, party.id)).status, 'dispatched');
  event = ok(await request(`/api/events/${f.event.id}`, 'PATCH', { version: event.version, status: 'ended' })).event;
  const dashboard = await manage(f); assert.ok(dashboard.parties.every(row => row.status === 'cancelled')); assert.ok(dashboard.encounters.every(row => row.state === 'ended'));
  const attendance = (await pool.query('SELECT character_id FROM adventure_attendance WHERE event_id=$1', [f.event.id])).rows;
  assert.deepEqual(attendance.map(row => row.character_id), [f.characters.a.id]);
  event = ok(await request(`/api/events/${f.event.id}`, 'PATCH', { version: event.version, status: 'archived' })).event;
  assert.equal((await request(`${base(f)}/encounters`, 'POST', { ...reqId(), document: { ...defaultStagehandDocument(), title: 'Late scene' } })).status, 409);
});

test('copy carries authored encounter configuration only and reset removes actual operations and announcement state', async () => {
  const f = await fixture({ checks: [{ id: 'staff', label: 'Ready staff', kind: 'staff' }] }); const encounter = await open(f); await createParty(f, ['a']);
  const response = ok(await request(`${base(f)}/encounters/${encounter.id}/announcement`, 'POST', { ...reqId(), version: encounter.version, title: 'Rehearsal dispatch', body: 'The rehearsal scene is ready.' }));
  const storyId = rowFrom(response, 'encounters').announcement.storyEntryId;
  const setup = defaultSetup(); const target = ok(await request('/api/events', 'POST', { name: 'Operations copy', setup }), 201).event;
  await copyStagehand(pool, f.event.id, target.id, users.owner.id);
  const copied = (await pool.query('SELECT * FROM stagehand_encounters WHERE event_id=$1 ORDER BY id', [target.id])).rows;
  assert.equal(copied.length, 2); assert.ok(copied.every(row => row.state === 'planning' && !row.document.staffUserIds.length && Object.keys(row.checks).length === 0)); assert.ok(copied.every(row => !f.encounters.some(old => old.id === row.id)));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM stagehand_parties WHERE event_id=$1', [target.id])).rows[0].n, 0);
  const sourceDocument = (await pool.query('SELECT document FROM stagehand_encounters WHERE id=$1', [encounter.id])).rows[0].document;
  await resetStagehand(pool, f.event.id);
  for (const table of ['stagehand_parties', 'stagehand_requests', 'stagehand_history', 'stagehand_announcements']) assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE event_id=$1`, [f.event.id])).rows[0].n, 0);
  assert.equal((await pool.query('SELECT id FROM story_entries WHERE id=$1', [storyId])).rows.length, 0);
  assert.deepEqual((await pool.query('SELECT document FROM stagehand_encounters WHERE id=$1', [encounter.id])).rows[0].document, sourceDocument);
});

test('direct managed WAYFINDER entry rechecks acknowledgment authority before granting attendance or journal progress', async () => {
  const f = await fixture({ checks: [{ id: 'marshal', label: 'Scene marshal ready', kind: 'staff' }] });
  let encounter = f.encounters[0];
  encounter = rowFrom(ok(await request(`${base(f)}/encounters/${encounter.id}/check`, 'POST', { ...reqId(), version: encounter.version, checkId: 'marshal', ready: true, reason: 'Marshal on station.' }, users.staff)), 'encounters');
  encounter = rowFrom(ok(await request(`${base(f)}/encounters/${encounter.id}/state`, 'POST', { ...reqId(), version: encounter.version, state: 'open', reason: 'Ready for dispatch.' }, users.staff)), 'encounters');
  await operate(f, await acceptAll(f, await createParty(f)), 'dispatch');
  await pool.query('UPDATE users SET is_disabled=true WHERE id=$1', [users.staff.id]);
  assert.equal((await join(f, 'a')).status, 409);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM adventure_journal WHERE event_id=$1', [f.event.id])).rows[0].n, 0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM adventure_attendance WHERE event_id=$1', [f.event.id])).rows[0].n, 0);
  await pool.query('UPDATE users SET is_disabled=false WHERE id=$1', [users.staff.id]);
  ok(await join(f, 'a'));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM adventure_attendance WHERE event_id=$1', [f.event.id])).rows[0].n, 1);
});
