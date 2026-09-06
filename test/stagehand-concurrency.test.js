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

let database, pool, server, origin;
const users = {};
const onlyTCP = 'Independent PostgreSQL TCP connections are required to prove simultaneous STAGEHAND contention.';
const base = f => `/api/events/${f.event.id}`;
const ops = f => `${base(f)}/stagehand`;
const command = extra => ({ requestId: randomUUID(), ...extra });
async function request(path, method = 'GET', data, who = users.manager) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...(who?.cookie ? { Cookie: who.cookie } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  const raw = await response.text();
  return { status: response.status, data: raw ? JSON.parse(raw) : null, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
function ok(response, status = 200) { assert.equal(response.status, status, JSON.stringify(response.data)); return response.data; }
async function manage(f) { return ok(await request(`${ops(f)}/manage`)); }
function target(data, collection) { const row = data[collection].find(row => row.id === data.outcome.targetId); assert.ok(row, `Missing ${collection} command target`); return row; }
const partyIn = (data, id) => { const party = data.parties.find(row => row.id === id); assert.ok(party); return party; };
const encounterIn = (data, id) => { const encounter = data.encounters.find(row => row.id === id); assert.ok(encounter); return encounter; };

async function fixture({ capacity = 3, legacyAttendance = false } = {}) {
  const setup = defaultSetup(); setup.enabledInstruments = ['briefing', 'wayfinder', 'stagehand', 'broadside'];
  const event = ok(await request('/api/events', 'POST', { name: 'STAGEHAND independent contention', setup }), 201).event;
  await pool.query("UPDATE events SET status='rehearsal' WHERE id=$1", [event.id]);
  const f = { event, characters: {}, encounters: [] };
  for (const who of ['alice', 'bob', 'legacy', 'replacement', 'staff']) {
    await pool.query('INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,$3)', [event.id, users[who].id, who === 'staff' ? 'staff' : 'player']);
    if (['replacement', 'staff'].includes(who)) continue;
    f.characters[who] = ok(await request(`${base(f)}/characters`, 'POST', { profile: { ...defaultCharacterProfile(setup.rules), name: `Captured ${who}`, privateObjectives: `PRIVATE character objective ${who}` } }, users[who]), 201).character;
    await pool.query("UPDATE characters SET status='approved',inventory_initialized=true WHERE id=$1", [f.characters[who].id]);
  }
  const nodes = ['first-scene', 'second-scene'].map((id, index) => ({ ...defaultAdventureNode('wayfinder', id, index ? 'BBBBBBBBBBBBBBBBBBBB' : 'AAAAAAAAAAAAAAAAAAAA'), title: `Public ${id}`, location: `Meeting ${index + 1}`, maxPlayers: capacity }));
  await pool.query('INSERT INTO event_adventures(event_id,definition) VALUES($1,$2)', [event.id, JSON.stringify({ ...defaultAdventure(), nodes })]);
  if (legacyAttendance) await pool.query('INSERT INTO adventure_attendance(event_id,node_id,character_id) VALUES($1,$2,$3)', [event.id, nodes[0].id, f.characters.legacy.id]);
  for (const node of nodes) {
    const document = { title: `Operations ${node.id}`, nodeId: node.id, publicMessage: 'Check in for your confirmed scene.', staffNotes: `PRIVATE notes ${node.id}`, capacity, staffUserIds: [users.staff.id], checks: [{ id: 'performer', label: 'PRIVATE performer identity', kind: 'performer' }], returnMinutes: 30 };
    let encounter = target(ok(await request(`${ops(f)}/encounters`, 'POST', command({ document })), 201), 'encounters');
    encounter = target(ok(await request(`${ops(f)}/encounters/${encounter.id}/check`, 'POST', command({ version: encounter.version, checkId: 'performer', ready: true, reason: 'The assigned performer has checked in.' }), users.staff)), 'encounters');
    encounter = target(ok(await request(`${ops(f)}/encounters/${encounter.id}/state`, 'POST', command({ version: encounter.version, state: 'open', reason: 'Staff and scene are ready.' }), users.staff)), 'encounters');
    f.encounters.push(encounter);
  }
  return f;
}
async function acceptedParty(f, names = ['alice'], encounter = f.encounters[0]) {
  let party = target(ok(await request(`${ops(f)}/parties`, 'POST', command({ encounterId: encounter.id, name: `PRIVATE party ${names.join(' ')}`, characterIds: names.map(name => f.characters[name].id), returnMinutes: 30 }), users.staff), 201), 'parties');
  const acceptances = {};
  for (const who of names) {
    const payload = command({ version: party.version, characterId: f.characters[who].id, response: 'accepted' });
    const response = ok(await request(`${ops(f)}/parties/${party.id}/respond`, 'POST', payload, users[who]));
    assert.ok(!JSON.stringify(response).includes('PRIVATE notes')); assert.ok(!JSON.stringify(response).includes('PRIVATE performer identity'));
    acceptances[who] = payload;
    party = partyIn(await manage(f), party.id);
  }
  return { party, acceptances };
}
const dispatchPayload = party => command({ version: party.version, reason: 'All captured players accepted this exact assignment.' });
async function join(f, who, nodeId = 'first-scene') {
  return request(`${base(f)}/adventure/action`, 'POST', command({ version: 1, characterId: f.characters[who].id, nodeId, kind: 'join' }), users[who]);
}
async function attendance(f) { return (await pool.query('SELECT node_id,character_id FROM adventure_attendance WHERE event_id=$1 ORDER BY node_id,character_id', [f.event.id])).rows; }
async function gameplayEffects(f) {
  const journals = (await pool.query('SELECT id,character_id,node_id,text FROM adventure_journal WHERE event_id=$1 ORDER BY id', [f.event.id])).rows;
  const runs = (await pool.query('SELECT character_id,progress,flags FROM adventure_runs WHERE event_id=$1 ORDER BY character_id', [f.event.id])).rows;
  const transactions = (await pool.query('SELECT id FROM economy_transactions WHERE event_id=$1 ORDER BY id', [f.event.id])).rows;
  return { journals, runs, transactions };
}

// The held event row forces genuinely independent HTTP connections to queue
// before either authoritative mutation can inspect current state. PostgreSQL
// caches statistics within transactions, so every observer poll clears them.
// Ordered mode first proves one waiter exists before starting the competing
// request: a restrictive mutation therefore owns the first row-lock position.
async function contend(eventId, operations, { ordered = false } = {}) {
  const blocker = await pool.connect(); const pending = []; let observed = false;
  const waitFor = async expected => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await blocker.query('SELECT pg_stat_clear_snapshot()');
      const waiting = (await blocker.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM events WHERE id=$1 FOR UPDATE%' AND pid<>pg_backend_pid()")).rows;
      if (waiting.length >= expected) return true;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return false;
  };
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM events WHERE id=$1 FOR UPDATE', [eventId]);
    if (ordered) {
      for (const operation of operations) {
        pending.push(operation());
        observed = await waitFor(pending.length);
        if (!observed) break;
      }
    } else {
      pending.push(...operations.map(operation => operation()));
      observed = await waitFor(operations.length);
    }
    await blocker.query('COMMIT');
    const results = await Promise.all(pending);
    assert.ok(observed && pending.length === operations.length, 'Every independent HTTP mutation must be observed waiting on the held event mutex.');
    return results;
  } finally {
    await blocker.query('ROLLBACK').catch(() => {}); blocker.release(); await Promise.allSettled(pending);
  }
}

before(async () => {
  if (!process.env.TEST_DATABASE_URL) return;
  database = await testDatabase(); pool = database.pool; await migrate(pool);
  let handler; server = createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  handler = createApp({ pool, config: { ...readConfig({ DATABASE_URL: 'postgres://unused' }), origin }, logger: entry => console.error(entry) });
  for (const name of ['manager', 'alice', 'bob', 'legacy', 'replacement', 'staff']) {
    const response = await request('/api/auth/register', 'POST', { displayName: `Stagehand ${name}`, email: `${name}@stagehand-contention.example.test`, password: 'Independent STAGEHAND contention passphrase' }, null);
    users[name] = { ...ok(response, 201).user, cookie: response.cookie };
  }
  console.log(`STAGEHAND contention database: ${database.kind}`);
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); if (database) await database.close(); });

test('forced TCP final STAGEHAND seat admits one whole party and retains legacy attendance', { timeout: 25000 }, async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip(onlyTCP);
  const f = await fixture({ capacity: 2, legacyAttendance: true });
  const parties = [await acceptedParty(f, ['alice']), await acceptedParty(f, ['bob'])].map(row => row.party);
  const payloads = parties.map(dispatchPayload), before = await gameplayEffects(f);
  const results = await contend(f.event.id, parties.map((party, index) => () => request(`${ops(f)}/parties/${party.id}/dispatch`, 'POST', payloads[index], users.staff)));
  assert.deepEqual(results.map(row => row.status).sort(), [200, 409]);
  const winner = results.findIndex(row => row.status === 200), loser = 1 - winner, names = ['alice', 'bob'];
  let dashboard = await manage(f), winningParty = partyIn(dashboard, parties[winner].id);
  assert.equal(winningParty.status, 'dispatched'); assert.equal(partyIn(dashboard, parties[loser].id).status, 'waiting');
  assert.equal(encounterIn(dashboard, f.encounters[0].id).attendanceCount, 2);
  assert.equal((await attendance(f)).length, 1, 'Dispatch reserves capacity without joining WAYFINDER.');
  assert.deepEqual(await gameplayEffects(f), before, 'Operations cannot grant journals, flags or economy effects.');
  const replay = ok(await request(`${ops(f)}/parties/${winningParty.id}/dispatch`, 'POST', payloads[winner], users.staff));
  assert.equal(replay.outcome.replayed, true); assert.equal(partyIn(replay, winningParty.id).returnBy, winningParty.returnBy);
  assert.equal((await join(f, names[loser])).status, 409); ok(await join(f, names[winner]));
  dashboard = await manage(f); assert.equal(encounterIn(dashboard, f.encounters[0].id).attendanceCount, 2, 'One dispatched and joined character consumes one seat.');
  winningParty = partyIn(dashboard, winningParty.id);
  ok(await request(`${ops(f)}/parties/${winningParty.id}/return`, 'POST', command({ version: winningParty.version, reason: 'The whole party checked back in.' }), users.staff));
  assert.deepEqual(await attendance(f), [{ node_id: 'first-scene', character_id: f.characters.legacy.id }]);
  assert.equal(encounterIn(await manage(f), f.encounters[0].id).attendanceCount, 1);
});

test('forced TCP redirect versus dispatch cannot apply old consent to changed party terms', { timeout: 25000 }, async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip(onlyTCP);
  const f = await fixture(), { party } = await acceptedParty(f, ['alice', 'bob']);
  const revised = command({ version: party.version, encounterId: f.encounters[1].id, name: party.name, characterIds: ['alice', 'bob'].map(who => f.characters[who].id), returnMinutes: 45 });
  const before = await gameplayEffects(f);
  const results = await contend(f.event.id, [() => request(`${ops(f)}/parties/${party.id}`, 'PUT', revised, users.staff), () => request(`${ops(f)}/parties/${party.id}/dispatch`, 'POST', dispatchPayload(party), users.staff)]);
  assert.deepEqual(results.map(row => row.status).sort(), [200, 409]);
  const redirected = results[0].status === 200, dashboard = await manage(f), current = partyIn(dashboard, party.id);
  assert.equal(current.encounterId, f.encounters[redirected ? 1 : 0].id); assert.equal(current.status, redirected ? 'waiting' : 'dispatched');
  assert.equal(current.returnMinutes, redirected ? 45 : 30);
  assert.equal(encounterIn(dashboard, f.encounters[0].id).attendanceCount, redirected ? 0 : 2);
  assert.equal(encounterIn(dashboard, f.encounters[1].id).attendanceCount, 0);
  if (redirected) {
    for (const who of ['alice', 'bob']) {
      const own = partyIn(ok(await request(`${ops(f)}?characterId=${f.characters[who].id}`, 'GET', undefined, users[who])), party.id);
      assert.notEqual(own.response, 'accepted'); assert.equal(own.acceptedCount, 0);
    }
    assert.equal((await request(`${ops(f)}/parties/${party.id}/dispatch`, 'POST', dispatchPayload(current), users.staff)).status, 409);
  }
  assert.deepEqual(await gameplayEffects(f), before); assert.deepEqual(await attendance(f), []);
});

test('forced TCP readiness loss and event pause are rechecked before a queued dispatch', { timeout: 35000 }, async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip(onlyTCP);
  const f = await fixture(), { party } = await acceptedParty(f), before = await gameplayEffects(f);
  let encounter = f.encounters[0];
  const first = await contend(f.event.id, [
    () => request(`${ops(f)}/encounters/${encounter.id}/check`, 'POST', command({ version: encounter.version, checkId: 'performer', ready: false, reason: 'The performer is no longer at the scene.' }), users.staff),
    () => request(`${ops(f)}/parties/${party.id}/dispatch`, 'POST', dispatchPayload(party), users.staff),
  ], { ordered: true });
  assert.deepEqual(first.map(row => row.status), [200, 409]);
  let dashboard = await manage(f); encounter = encounterIn(dashboard, encounter.id);
  assert.equal(partyIn(dashboard, party.id).status, 'waiting'); assert.equal(encounter.attendanceCount, 0);
  assert.equal((await join(f, 'alice')).status, 409);
  encounter = target(ok(await request(`${ops(f)}/encounters/${encounter.id}/check`, 'POST', command({ version: encounter.version, checkId: 'performer', ready: true, reason: 'Replacement performer checked in.' }), users.staff)), 'encounters');
  if (encounter.state !== 'open') encounter = target(ok(await request(`${ops(f)}/encounters/${encounter.id}/state`, 'POST', command({ version: encounter.version, state: 'open', reason: 'Explicitly resume admission after restoring readiness.' }), users.staff)), 'encounters');
  const rehearsalVersion = (await pool.query('SELECT version FROM events WHERE id=$1', [f.event.id])).rows[0].version;
  const version = ok(await request(base(f), 'PATCH', { version: rehearsalVersion, status: 'live' })).event.version;
  const second = await contend(f.event.id, [
    () => request(base(f), 'PATCH', { version, status: 'paused' }),
    () => request(`${ops(f)}/parties/${party.id}/dispatch`, 'POST', dispatchPayload(party), users.staff),
  ], { ordered: true });
  assert.deepEqual(second.map(row => row.status), [200, 409]);
  dashboard = await manage(f); assert.equal(dashboard.event.status, 'paused'); assert.equal(partyIn(dashboard, party.id).status, 'waiting');
  assert.equal(encounterIn(dashboard, encounter.id).attendanceCount, 0); assert.deepEqual(await gameplayEffects(f), before);
  ok(await request(`${ops(f)}/parties/${party.id}/cancel`, 'POST', command({ version: partyIn(dashboard, party.id).version, reason: 'Release the waiting assignment during the event pause.' }), users.staff));
});

test('forced TCP character reassignment invalidates queued dispatch and captured private replays', { timeout: 25000 }, async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip(onlyTCP);
  const f = await fixture(), { party, acceptances } = await acceptedParty(f), before = await gameplayEffects(f);
  const character = ok(await request(`${base(f)}/characters/${f.characters.alice.id}`)).character;
  const results = await contend(f.event.id, [
    () => request(`${base(f)}/characters/${character.id}/assign`, 'POST', { version: character.version, userId: users.replacement.id }),
    () => request(`${ops(f)}/parties/${party.id}/dispatch`, 'POST', dispatchPayload(party), users.staff),
  ], { ordered: true });
  assert.deepEqual(results.map(row => row.status), [200, 409]);
  const dashboard = await manage(f);
  assert.equal(partyIn(dashboard, party.id).status, 'waiting'); assert.equal(encounterIn(dashboard, f.encounters[0].id).attendanceCount, 0);
  const oldRead = await request(`${ops(f)}?characterId=${character.id}`, 'GET', undefined, users.alice);
  assert.ok([403, 404].includes(oldRead.status), JSON.stringify(oldRead));
  const newRead = ok(await request(`${ops(f)}?characterId=${character.id}`, 'GET', undefined, users.replacement));
  assert.equal(newRead.parties.length, 0); assert.ok(!JSON.stringify(newRead).includes(party.name));
  for (const who of ['alice', 'replacement']) {
    const replay = await request(`${ops(f)}/parties/${party.id}/respond`, 'POST', acceptances.alice, users[who]);
    assert.ok([403, 404].includes(replay.status), `A ${who} request must not inherit captured assent: ${JSON.stringify(replay)}`);
  }
  assert.equal((await request(`${base(f)}/adventure/action`, 'POST', command({ version: 1, characterId: character.id, nodeId: 'first-scene', kind: 'join' }), users.replacement)).status, 409);
  assert.deepEqual(await attendance(f), []); assert.deepEqual(await gameplayEffects(f), before);
  ok(await request(`${ops(f)}/parties/${party.id}/cancel`, 'POST', command({ version: partyIn(dashboard, party.id).version, reason: 'Clear the obsolete captured assignment.' }), users.staff));
});
