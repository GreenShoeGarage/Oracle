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
import { defaultStagehandDocument } from '../public/stagehand-model.js';

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
  for (const name of ['owner', 'a', 'b', 'c', 'staff', 'otherstaff', 'outsider']) { const response = await request('/api/auth/register', 'POST', { displayName: `Party ${name}`, email: `${name}@stagehand-parties.example.test`, password: 'Stagehand party test passphrase!' }, null); users[name] = { ...ok(response, 201).user, cookie: response.cookie }; }
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); if (database) await database.close(); });

test('parties require independent captured consent while player dashboards omit other identities and operational details', async () => {
  const f = await fixture(); await open(f); let party = await createParty(f);
  assert.equal(party.status, 'waiting'); assert.equal(party.acceptedCount, 0); assert.equal((await manage(f)).encounters[0].attendanceCount, 0);
  assert.equal((await request(`${base(f)}/parties/${party.id}/dispatch`, 'POST', { ...reqId(), version: party.version, reason: 'Premature dispatch' }, users.staff)).status, 409);
  const one = await respond(f, party, 'a'); assert.equal(one.response, 'accepted'); assert.equal(one.acceptedCount, 1);
  for (const secret of [users.a.id, users.b.id, f.characters.b.id, 'Party b', 'PRIVATE_STAFF_NOTE', 'PRIVATE_a_OBJECTIVE', 'members', 'activity', 'staffUserIds']) assert.ok(!JSON.stringify(one).includes(secret), secret);
  party = await getParty(f, party.id); const version = party.version, terms = party.termsVersion;
  party = await respond(f, party, 'b'); assert.equal(party.acceptedCount, 2); assert.equal(party.termsVersion, terms); assert.equal(party.version, version + 1);
  const manager = await getParty(f, party.id); assert.ok(manager.members.every(member => member.response === 'accepted')); assert.ok(!JSON.stringify(manager).includes(users.a.id));
  assert.equal((await request(`${base(f)}/parties/${party.id}/respond`, 'POST', { ...reqId(), version: party.version, characterId: f.characters.a.id, response: 'accepted' }, users.owner)).status, 404);
  const before = (await pool.query('SELECT * FROM adventure_runs WHERE event_id=$1', [f.event.id])).rows;
  party = await operate(f, manager, 'dispatch'); assert.equal(party.status, 'dispatched'); assert.equal((await manage(f)).encounters.find(row => row.id === party.encounterId).attendanceCount, 2);
  assert.deepEqual((await pool.query('SELECT * FROM adventure_runs WHERE event_id=$1', [f.event.id])).rows, before, 'Dispatch has no progression effects');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM adventure_attendance WHERE event_id=$1', [f.event.id])).rows[0].n, 0, 'Dispatch reserves seats without automatically joining a scene');
});

test('whole-party redirect from a cancelled scene checks both staff scopes and clears every assent', async () => {
  const f = await fixture(); await open(f); await open(f, 1); let party = await acceptAll(f, await createParty(f));
  ok(await request(`${base(f)}/encounters/${f.encounters[0].id}/state`, 'POST', { ...reqId(), version: f.encounters[0].version, state: 'cancelled', reason: 'This scene cannot run; redirect its whole waiting party.' }));
  assert.equal((await getParty(f, party.id)).status, 'waiting', 'Scene cancellation retains waiting parties for explicit redirect');
  assert.equal((await request(`${base(f)}/parties/${party.id}/respond`, 'POST', { ...reqId(), version: party.version, characterId: f.characters.a.id, response: 'accepted' }, users.a)).status, 409);
  const edit = { ...createInput(f, ['a', 'b'], 1), version: party.version, name: 'Redirected group', returnMinutes: 25 };
  assert.equal((await request(`${base(f)}/parties/${party.id}`, 'PUT', edit, users.staff)).status, 403);
  assert.equal((await request(`${base(f)}/parties/${party.id}`, 'PUT', edit, users.otherstaff)).status, 403);
  assert.equal((await getParty(f, party.id)).acceptedCount, 2);
  const terms = party.termsVersion; party = rowFrom(ok(await request(`${base(f)}/parties/${party.id}`, 'PUT', edit)));
  assert.equal(party.encounterId, f.encounters[1].id); assert.equal(party.members.length, 2); assert.equal(party.acceptedCount, 0); assert.equal(party.termsVersion, terms + 1); assert.ok(party.members.every(member => member.response === null));
  assert.equal((await request(`${base(f)}/parties/${party.id}/dispatch`, 'POST', { ...reqId(), version: party.version, reason: 'Old consent cannot move' }, users.otherstaff)).status, 409);
  assert.equal((await request(`${base(f)}/parties/${party.id}`, 'PUT', { ...edit, ...reqId(), version: party.version, characterIds: [randomUUID()] })).status, 400);
  assert.equal((await getParty(f, party.id)).members.length, 2);
  party = await acceptAll(f, party); party = await operate(f, party, 'dispatch', 'otherstaff');
  assert.equal((await request(`${base(f)}/parties/${party.id}`, 'PUT', { ...edit, ...reqId(), version: party.version })).status, 409, 'Dispatched parties cannot silently change destination');
});

test('distinct legacy attendance and dispatched seats enforce all-or-none capacity and preserve pre-dispatch attendance on return', async () => {
  const f = await fixture(); await open(f);
  await pool.query('INSERT INTO adventure_attendance(event_id,node_id,character_id) VALUES($1,$2,$3)', [f.event.id, f.nodes[0].id, f.characters.c.id]);
  let party = await acceptAll(f, await createParty(f));
  assert.equal((await request(`${base(f)}/parties/${party.id}/dispatch`, 'POST', { ...reqId(), version: party.version, reason: 'No room for both members' }, users.staff)).status, 409);
  assert.equal((await getParty(f, party.id)).status, 'waiting'); assert.equal((await manage(f)).encounters.find(row => row.id === party.encounterId).attendanceCount, 1);
  await pool.query('DELETE FROM adventure_attendance WHERE event_id=$1', [f.event.id]);
  await pool.query('INSERT INTO adventure_attendance(event_id,node_id,character_id) VALUES($1,$2,$3)', [f.event.id, f.nodes[0].id, f.characters.a.id]);
  party = await operate(f, party, 'dispatch'); assert.equal((await manage(f)).encounters.find(row => row.id === party.encounterId).attendanceCount, 2);
  const captured = (await pool.query('SELECT members FROM stagehand_parties WHERE id=$1', [party.id])).rows[0].members;
  assert.equal(captured.find(member => member.characterId === f.characters.a.id).attendedBefore, true); assert.equal(captured.find(member => member.characterId === f.characters.b.id).attendedBefore, false);
  ok(await join(f, 'a')); ok(await join(f, 'b')); assert.equal((await join(f, 'c')).status, 409);
  assert.equal((await manage(f)).encounters.find(row => row.id === party.encounterId).attendanceCount, 2, 'Joining a reserved scene does not consume a second seat');
  party = await operate(f, party, 'return'); assert.equal(party.status, 'returned');
  assert.deepEqual((await pool.query('SELECT character_id FROM adventure_attendance WHERE event_id=$1 ORDER BY character_id', [f.event.id])).rows.map(row => row.character_id), [f.characters.a.id]);
  assert.equal((await manage(f)).encounters.find(row => row.id === party.encounterId).attendanceCount, 1);
});

test('scene readiness and event pause block admission while due windows remain absolute and overdue seats require explicit release', async () => {
  const f = await fixture({ checks: [{ id: 'marshal', label: 'Marshal checked in', kind: 'staff' }], status: 'live' }); await open(f);
  let party = await acceptAll(f, await createParty(f)), encounter = f.encounters[0];
  encounter = rowFrom(ok(await request(`${base(f)}/encounters/${encounter.id}/check`, 'POST', { ...reqId(), version: encounter.version, checkId: 'marshal', ready: false, reason: 'Marshal stepped away.' })), 'encounters');
  assert.equal((await request(`${base(f)}/parties/${party.id}/dispatch`, 'POST', { ...reqId(), version: party.version, reason: 'Missing readiness' }, users.staff)).status, 409);
  await open(f); party = await operate(f, party, 'dispatch'); const returnBy = party.returnBy;
  let event = ok(await request(`/api/events/${f.event.id}`)).event; event = ok(await request(`/api/events/${f.event.id}`, 'PATCH', { version: event.version, status: 'paused' })).event;
  assert.equal((await getParty(f, party.id)).returnBy, returnBy);
  assert.equal((await request(`${base(f)}/queue`, 'POST', { ...reqId(), encounterId: encounter.id, characterId: f.characters.c.id }, users.c)).status, 409);
  await pool.query("UPDATE stagehand_parties SET return_by=clock_timestamp()-interval '1 minute' WHERE id=$1", [party.id]);
  const before = (await pool.query('SELECT status,version FROM stagehand_parties WHERE id=$1', [party.id])).rows;
  const overdue = await getParty(f, party.id); assert.equal(overdue.overdue, true); assert.equal((await manage(f)).encounters.find(row => row.id === encounter.id).attendanceCount, 2);
  assert.deepEqual((await pool.query('SELECT status,version FROM stagehand_parties WHERE id=$1', [party.id])).rows, before, 'Reading overdue state must not release seats');
  await pool.query("UPDATE events SET setup=jsonb_set(setup,'{enabledInstruments}','[\"briefing\",\"wayfinder\"]'::jsonb) WHERE id=$1", [f.event.id]);
  party = await operate(f, overdue, 'return'); assert.equal(party.status, 'returned');
  await pool.query('UPDATE events SET setup=$2 WHERE id=$1', [f.event.id, JSON.stringify(event.setup)]);
  event = ok(await request(`/api/events/${f.event.id}`, 'PATCH', { version: event.version, status: 'live' })).event;
  let waiting = await acceptAll(f, await createParty(f, ['c']), ['c']); waiting = await operate(f, waiting, 'dispatch');
  event = ok(await request(`/api/events/${f.event.id}`, 'PATCH', { version: event.version, status: 'ended' })).event;
  assert.equal((await getParty(f, waiting.id)).status, 'cancelled'); assert.equal((await manage(f)).encounters.find(row => row.id === encounter.id).attendanceCount, 0);
});

test('self queue is private and requires explicit acceptance; only the sole waiting owner can cancel without staff', async () => {
  const f = await fixture(); await open(f);
  const input = { ...reqId(), encounterId: f.encounters[0].id, characterId: f.characters.a.id };
  let dashboard = ok(await request(`${base(f)}/queue`, 'POST', input, users.a), 201), party = rowFrom(dashboard);
  assert.equal(party.response, null); assert.equal(party.returnMinutes, 15); assert.equal(party.canCancel, true);
  assert.equal(ok(await request(`${base(f)}/queue`, 'POST', input, users.a)).outcome.replayed, true);
  assert.equal((await request(`${base(f)}/queue`, 'POST', { ...input, ...reqId(), characterId: f.characters.b.id }, users.a)).status, 404);
  assert.equal((await request(`${base(f)}/parties`, 'POST', createInput(f, ['a']), users.a)).status, 403);
  assert.equal((await request(`${base(f)}/queue`, 'POST', { ...input, ...reqId() }, users.a)).status, 409, 'No overlapping active assignments');
  await pool.query("UPDATE events SET status='paused',setup=jsonb_set(setup,'{enabledInstruments}','[\"briefing\",\"wayfinder\"]'::jsonb) WHERE id=$1", [f.event.id]);
  assert.equal((await request(`${base(f)}/parties/${party.id}/respond`, 'POST', { ...reqId(), version: party.version, characterId: f.characters.a.id, response: 'accepted' }, users.a)).status, 409);
  dashboard = ok(await request(`${base(f)}/parties/${party.id}/cancel`, 'POST', { ...reqId(), version: party.version, reason: 'I am leaving this waiting queue.' }, users.a)); assert.equal(rowFrom(dashboard).status, 'cancelled'); assert.ok(!Object.hasOwn(dashboard, 'activity'));
});

test('request replay remains current, changed payloads cannot reuse consent, and released assignments cannot transition twice', async () => {
  const f = await fixture(); await open(f); const creation = createInput(f, ['a']);
  const created = ok(await request(`${base(f)}/parties`, 'POST', creation), 201); let party = rowFrom(created);
  assert.equal(rowFrom(ok(await request(`${base(f)}/parties`, 'POST', creation))).id, party.id);
  assert.equal((await request(`${base(f)}/parties`, 'POST', { ...creation, name: 'Different party' })).status, 409);
  const consent = { ...reqId(), version: party.version, characterId: f.characters.a.id, response: 'accepted' };
  party = rowFrom(ok(await request(`${base(f)}/parties/${party.id}/respond`, 'POST', consent, users.a)));
  assert.equal(ok(await request(`${base(f)}/parties/${party.id}/respond`, 'POST', consent, users.a)).outcome.replayed, true);
  assert.equal((await request(`${base(f)}/parties/${party.id}/respond`, 'POST', { ...consent, response: 'declined' }, users.a)).status, 409);
  const dispatch = { ...reqId(), version: party.version, reason: 'Send the accepted member.' };
  party = rowFrom(ok(await request(`${base(f)}/parties/${party.id}/dispatch`, 'POST', dispatch, users.staff)));
  assert.equal(rowFrom(ok(await request(`${base(f)}/parties/${party.id}/dispatch`, 'POST', dispatch, users.staff))).version, party.version);
  assert.equal((await request(`${base(f)}/parties/${party.id}/cancel`, 'POST', { ...reqId(), version: party.version, reason: 'Player cannot release a dispatched reservation.' }, users.a)).status, 403);
  const release = { ...reqId(), version: party.version, reason: 'Member returned.' }; party = rowFrom(ok(await request(`${base(f)}/parties/${party.id}/return`, 'POST', release, users.staff)));
  assert.equal(ok(await request(`${base(f)}/parties/${party.id}/return`, 'POST', release, users.staff)).outcome.replayed, true);
  assert.equal((await request(`${base(f)}/parties/${party.id}/return`, 'POST', { ...release, ...reqId(), version: party.version }, users.staff)).status, 409);
  await pool.query("UPDATE memberships SET role='player' WHERE event_id=$1 AND user_id=$2", [f.event.id, users.staff.id]);
  assert.equal((await request(`${base(f)}/parties/${party.id}/return`, 'POST', release, users.staff)).status, 403, 'Old operational receipt cannot restore removed staff authority');
});

test('reassignment cannot inherit party consent or history and old release preserves attendance of the new owner', async () => {
  const f = await fixture(); await open(f); let party = await acceptAll(f, await createParty(f, ['a']), ['a']);
  const input = { ...reqId(), version: party.version, characterId: f.characters.a.id, response: 'accepted' };
  party = rowFrom(ok(await request(`${base(f)}/parties/${party.id}/respond`, 'POST', input, users.a))); party = await operate(f, party, 'dispatch'); ok(await join(f, 'a'));
  await pool.query('UPDATE characters SET user_id=$2 WHERE id=$1', [f.characters.a.id, users.b.id]);
  assert.equal((await request(`${base(f)}/parties/${party.id}/respond`, 'POST', input, users.a)).status, 404);
  const other = ok(await request(`${base(f)}?characterId=${f.characters.a.id}`, 'GET', undefined, users.b)); assert.ok(!other.parties.some(row => row.id === party.id));
  assert.equal((await request(`${base(f)}/queue`, 'POST', { ...reqId(), encounterId: f.encounters[0].id, characterId: f.characters.a.id }, users.b)).status, 409, 'Old active assignment must be released before assigning the character again');
  party = await operate(f, await getParty(f, party.id), 'cancel'); assert.equal(party.status, 'cancelled');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM adventure_attendance WHERE event_id=$1 AND character_id=$2', [f.event.id, f.characters.a.id])).rows[0].n, 1, 'Old-owner release must not remove current-owner attendance');
  const second = rowFrom(ok(await request(`${base(f)}/queue`, 'POST', { ...reqId(), encounterId: f.encounters[0].id, characterId: f.characters.a.id }, users.b), 201)); assert.notEqual(second.id, party.id); assert.equal(second.response, null);
});

test('dispatch rechecks current members, authored conditions and node references atomically', async () => {
  const f = await fixture(); await open(f); let party = await acceptAll(f, await createParty(f));
  await pool.query('UPDATE users SET is_disabled=true WHERE id=$1', [users.b.id]);
  assert.equal((await request(`${base(f)}/parties/${party.id}/dispatch`, 'POST', { ...reqId(), version: party.version, reason: 'Disabled participant' }, users.staff)).status, 409); await pool.query('UPDATE users SET is_disabled=false WHERE id=$1', [users.b.id]);
  const changed = structuredClone(f.definition); changed.nodes[0].conditions.flags = ['scene-unlocked'];
  await pool.query('UPDATE event_adventures SET definition=$2 WHERE event_id=$1', [f.event.id, JSON.stringify(changed)]);
  assert.equal((await request(`${base(f)}/parties/${party.id}/respond`, 'POST', { ...reqId(), version: party.version, characterId: f.characters.a.id, response: 'accepted' }, users.a)).status, 409, 'A new assent must recheck current scene requirements');
  assert.equal((await request(`${base(f)}/parties/${party.id}/dispatch`, 'POST', { ...reqId(), version: party.version, reason: 'New unmet scene requirement' }, users.staff)).status, 409);
  for (const name of ['a', 'b']) await pool.query('INSERT INTO adventure_runs(event_id,character_id,flags) VALUES($1,$2,$3)', [f.event.id, f.characters[name].id, JSON.stringify({ 'scene-unlocked': true })]);
  const before = (await pool.query('SELECT flags FROM adventure_runs WHERE event_id=$1 ORDER BY character_id', [f.event.id])).rows;
  party = await operate(f, party, 'dispatch'); assert.equal(party.status, 'dispatched'); assert.deepEqual((await pool.query('SELECT flags FROM adventure_runs WHERE event_id=$1 ORDER BY character_id', [f.event.id])).rows, before);
  party = await operate(f, party, 'return');
  const waiting = await acceptAll(f, await createParty(f)); changed.nodes = [];
  await pool.query('UPDATE event_adventures SET definition=$2 WHERE event_id=$1', [f.event.id, JSON.stringify(changed)]);
  assert.equal((await request(`${base(f)}/parties/${waiting.id}/dispatch`, 'POST', { ...reqId(), version: waiting.version, reason: 'Scene deleted' }, users.staff)).status, 409);
  assert.equal((await getParty(f, waiting.id)).status, 'waiting');
});

test('party validation rejects missing, foreign, duplicate and malformed members or action data', async () => {
  const f = await fixture(), input = createInput(f);
  for (const changes of [{ characterIds: [] }, { characterIds: [f.characters.a.id, f.characters.a.id] }, { characterIds: [randomUUID()] }, { name: '<script>' }, { returnMinutes: 481 }, { ownerUserId: users.a.id }, { response: 'accepted' }]) assert.equal((await request(`${base(f)}/parties`, 'POST', { ...input, ...reqId(), ...changes })).status, 400);
  const party = await createParty(f);
  for (const response of ['constructor', 'yes', true]) assert.equal((await request(`${base(f)}/parties/${party.id}/respond`, 'POST', { ...reqId(), version: party.version, characterId: f.characters.a.id, response }, users.a)).status, 400);
  assert.equal((await request(`${base(f)}/parties/${party.id}/respond`, 'POST', { ...reqId(), version: party.version + 1, characterId: f.characters.a.id, response: 'accepted' }, users.a)).status, 409);
  assert.equal((await request(`${base(f)}/parties/${party.id}/cancel`, 'POST', { ...reqId(), version: party.version, reason: '' }, users.staff)).status, 400);
  assert.equal((await request(`${base(f)}/parties/${party.id}/cancel`, 'POST', { ...reqId(), version: party.version, reason: 'Cannot cancel another scene' }, users.otherstaff)).status, 404);
});

test('full request and activity histories still permit bounded, replayable release of dispatched capacity', async () => {
  const f = await fixture(); await open(f); let party = await acceptAll(f, await createParty(f, ['a']), ['a']); party = await operate(f, party, 'dispatch');
  const count = (await pool.query('SELECT count(*)::int AS n FROM stagehand_requests WHERE event_id=$1 AND actor_user_id=$2', [f.event.id, users.staff.id])).rows[0].n;
  await pool.query("INSERT INTO stagehand_requests(event_id,actor_user_id,request_id,payload_hash,action,target_id,manage,outcome) SELECT $1,$2,value::uuid,'seeded','dispatch',$3,true,'{}'::jsonb FROM jsonb_array_elements_text($4::jsonb)", [f.event.id, users.staff.id, party.id, JSON.stringify(Array.from({ length: 5000 - count }, randomUUID))]);
  const historyCount = (await pool.query('SELECT count(*)::int AS n FROM stagehand_history WHERE event_id=$1', [f.event.id])).rows[0].n;
  await pool.query("INSERT INTO stagehand_history(id,event_id,encounter_id,party_id,actor_user_id,action) SELECT value::uuid,$1,$2,$3,$4,'seeded' FROM jsonb_array_elements_text($5::jsonb)", [f.event.id, party.encounterId, party.id, users.staff.id, JSON.stringify(Array.from({ length: 10000 - historyCount }, randomUUID))]);
  const release = { ...reqId(), version: party.version, reason: 'Return must remain possible at bounded history limits.' };
  party = rowFrom(ok(await request(`${base(f)}/parties/${party.id}/return`, 'POST', release, users.staff))); assert.equal(party.status, 'returned');
  assert.equal(ok(await request(`${base(f)}/parties/${party.id}/return`, 'POST', release, users.staff)).outcome.replayed, true);
  assert.equal((await request(`${base(f)}/parties/${party.id}/return`, 'POST', { ...release, reason: 'Changed same request' }, users.staff)).status, 409);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM stagehand_requests WHERE event_id=$1 AND actor_user_id=$2', [f.event.id, users.staff.id])).rows[0].n, 5000);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM stagehand_history WHERE event_id=$1', [f.event.id])).rows[0].n, 10000);
  assert.equal((await manage(f)).encounters.find(row => row.id === party.encounterId).attendanceCount, 0);
});
