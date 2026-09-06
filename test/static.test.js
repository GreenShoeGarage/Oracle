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
import { defaultAdventure, defaultAdventureConditions, defaultAdventureNode } from '../public/adventure-model.js';
import { defaultStaticDocument, staticCode, validateStaticDocument } from '../public/static-model.js';
import { copyStatic, resetStatic, seedStatic } from '../src/static.js';
import { filterStoryJournal } from '../src/story.js';

let database, pool, server, origin;
const users = {};
const requestId = () => ({ requestId: randomUUID() });
const ok = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.data)); return response.data; };
const path = (fixture, suffix = '') => `/api/events/${fixture.event.id}/static${suffix ? `/${suffix}` : ''}`;
async function request(route, method = 'GET', value, user = users.owner) {
  const response = await fetch(`${origin}${route}`, { method, headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...(user?.cookie ? { Cookie: user.cookie } : {}) }, body: value === undefined ? undefined : JSON.stringify(value) });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
function document(extra = {}) {
  return { ...defaultStaticDocument(), title: 'Chamber resonance', summary: 'A fictional prop reading.', organizerNotes: 'ORGANIZER_SECRET_READINGS', zoneLabel: 'Inner chamber', states: [{ id: 'unsettled', label: 'Unsettled', text: 'The fictional resonance is scattered.', level: 20, tone: 'alert' }, { id: 'restored', label: 'Restored', text: 'HIDDEN_FUTURE_STATE: the fictional resonance is steady.', level: 90, tone: 'calm' }], rules: [{ id: 'restored-rule', conditions: { ...defaultAdventureConditions(), flags: ['cooperation-complete'] }, stateId: 'restored' }], ...extra };
}
async function fixture(theme = 'fantasy') {
  const setup = defaultSetup(theme); setup.enabledInstruments = ['briefing', 'static', 'trace', 'relic']; setup.rules.expertise = [{ id: 'investigation', name: 'Investigation' }];
  const event = ok(await request('/api/events', 'POST', { name: `STATIC ${theme}`, setup }), 201).event;
  const characters = {};
  for (const name of ['one', 'two', 'staff']) {
    await pool.query('INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,$3)', [event.id, users[name].id, name === 'staff' ? 'staff' : 'player']);
    if (name === 'staff') continue;
    const profile = { ...defaultCharacterProfile(setup.rules), name: `Reading ${name}` };
    characters[name] = ok(await request(`/api/events/${event.id}/characters`, 'POST', { profile }, users[name]), 201).character;
    await pool.query("UPDATE characters SET status='approved',inventory_initialized=true WHERE id=$1", [characters[name].id]);
  }
  const definition = { ...defaultAdventure(), flags: [{ id: 'cooperation-complete', name: 'Cooperation complete' }], nodes: [defaultAdventureNode('relic', 'evidence-core', 'AAAAAAAAAAAAAAAAAAAA')] };
  ok(await request(`/api/events/${event.id}/adventure/manage`, 'PUT', { version: 0, definition }));
  await pool.query("UPDATE events SET status='rehearsal' WHERE id=$1", [event.id]);
  return { event: { ...event, status: 'rehearsal', setup }, characters, definition };
}
async function create(f, extra = {}) { return ok(await request(path(f, 'entries'), 'POST', { ...requestId(), document: document(extra) }), 201).entry; }
async function publish(f, entry) { return ok(await request(path(f, `entries/${entry.id}/publish`), 'POST', { ...requestId(), version: entry.version })).entry; }
async function lookup(f, entry, who = 'one') { return ok(await request(path(f, 'lookup'), 'POST', { characterId: f.characters[who].id, code: entry.code }, users[who])).signal; }
const collectInput = (f, entry, signal, who = 'one') => ({ ...requestId(), characterId: f.characters[who].id, entryId: entry.id, code: entry.code, publicationVersion: signal.publicationVersion, readingKey: signal.readingKey });
async function collect(f, input, who = 'one') { return ok(await request(path(f, 'collect'), 'POST', input, users[who])); }
async function override(f, entry, stateId, who = 'staff') { return ok(await request(path(f, `entries/${entry.id}/state`), 'POST', { ...requestId(), version: entry.override.version, stateId, reason: 'PRIVATE_STAFF_REASON: scene intervention' }, users[who])).entry; }

before(async () => {
  database = await testDatabase(); pool = database.pool; await migrate(pool);
  let handler; server = createServer((req, res) => handler(req, res)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  handler = createApp({ pool, config: { ...readConfig({ DATABASE_URL: 'postgres://unused', PORT: '3000' }), origin }, logger: entry => console.error(entry) });
  for (const name of ['owner', 'one', 'two', 'staff', 'outsider']) { const response = await request('/api/auth/register', 'POST', { displayName: `STATIC ${name}`, email: `${name}@static.example.test`, password: 'Static integration passphrase!' }, null); users[name] = { ...ok(response, 201).user, cookie: response.cookie }; }
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); if (database) await database.close(); });

test('STATIC document validation rejects hidden executable data, malformed states and unknown condition references', () => {
  const definition = { nodes: [], flags: [{ id: 'cooperation-complete', name: 'Done' }] }, rules = { expertise: [] }, valid = document();
  assert.equal(validateStaticDocument(valid, definition, rules).states.length, 2);
  assert.throws(() => validateStaticDocument(Object.create(valid), definition, rules));
  let executed = false; const getter = { ...valid }; Object.defineProperty(getter, 'title', { enumerable: true, get() { executed = true; return 'Bad'; } });
  assert.throws(() => validateStaticDocument(getter, definition, rules)); assert.equal(executed, false);
  const prototypeStates = [...valid.states]; Object.setPrototypeOf(prototypeStates, { map() { executed = true; return []; } });
  assert.throws(() => validateStaticDocument({ ...valid, states: prototypeStates }, definition, rules)); assert.equal(executed, false);
  const sparse = [valid.states[0], , valid.states[1]];
  for (const extra of [{ title: '<img>' }, { states: [] }, { states: sparse }, { states: [valid.states[0], valid.states[0]] }, { states: [{ ...valid.states[0], level: 101 }] }, { states: [{ ...valid.states[0], tone: 'constructor' }] }, { states: [{ ...valid.states[0], id: 'constructor' }] }, { defaultStateId: 'missing' }, { rules: [...valid.rules, ...valid.rules] }, { conditions: { ...defaultAdventureConditions(), flags: ['missing'] } }, { unexpected: true }]) assert.throws(() => validateStaticDocument({ ...valid, ...extra }, definition, rules));
  assert.equal(staticCode('AAAAAAAAAAAAAAAAAAAA'), 'AAAAAAAAAAAAAAAAAAAA');
  for (const code of ['IIIIIIIIIIIIIIIIIIII', 'AAAAAAAAAAAAAAAAAAA', 'https://foreign.test/#static/id/code']) assert.throws(() => staticCode(code));
});

test('published STATIC projects only the current fictional state and authoring stays organizer-only', async () => {
  const f = await fixture(); let entry = await create(f);
  assert.match(entry.code, /^[A-HJ-NP-Z2-9]{20}$/);
  assert.equal(ok(await request(path(f), 'GET', undefined, users.one)).signals.length, 0);
  for (const user of [users.one, users.staff]) assert.equal((await request(path(f, 'entries'), 'POST', { ...requestId(), document: document() }, user)).status, 403);
  assert.equal((await request(path(f, 'manage'), 'GET', undefined, users.one)).status, 403);
  assert.equal((await request(path(f, 'manage'), 'GET', undefined, users.outsider)).status, 404);
  entry = await publish(f, entry);
  const overview = ok(await request(path(f), 'GET', undefined, users.one)); assert.equal(overview.signals.length, 1);
  for (const secret of ['ORGANIZER_SECRET_READINGS', 'HIDDEN_FUTURE_STATE', entry.code, users.one.id, users.one.email]) assert.ok(!JSON.stringify(overview).includes(secret), secret);
  const signal = await lookup(f, entry); assert.equal(signal.state.id, 'unsettled'); assert.equal(signal.fictional, true); assert.equal(signal.label, 'Fictional event reading'); assert.equal(signal.source, 'prepared');
  for (const secret of ['ORGANIZER_SECRET_READINGS', 'HIDDEN_FUTURE_STATE', 'rules', 'conditions', 'organizerNotes', users.one.id]) assert.ok(!JSON.stringify(signal).includes(secret), secret);
  const staff = ok(await request(path(f, 'manage'), 'GET', undefined, users.staff)); assert.equal(staff.canManage, false); assert.equal(staff.canOperate, true); assert.ok(!JSON.stringify(staff).includes('ORGANIZER_SECRET_READINGS')); assert.equal(staff.entries[0].document.states.length, 2);
  assert.equal((await request(path(f, `entries/${entry.id}?characterId=${f.characters.one.id}`), 'GET', undefined, users.one)).status, 400);
  assert.equal(ok(await request(path(f, `entries/${entry.id}?characterId=${f.characters.one.id}&code=${entry.code}`), 'GET', undefined, users.one)).signal.state.id, 'unsettled');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM static_requests WHERE event_id=$1', [f.event.id])).rows[0].n, 2, 'Read lookups never write request history');
});

test('draft changes remain separate and republish clears manual state without losing immutable copies', async () => {
  const f = await fixture(); let entry = await publish(f, await create(f)); const originalSignal = await lookup(f, entry), input = collectInput(f, entry, originalSignal), original = (await collect(f, input)).reading;
  entry = await override(f, entry, 'restored');
  const changed = { ...entry.document, title: 'NEW_DRAFT_SECRET', states: [{ id: 'unsettled', label: 'Quiet', text: 'Revised fictional reading.', level: 10, tone: 'calm' }], rules: [] };
  // Staff responses intentionally omit authoring-only fields; fetch organizer draft.
  const manager = ok(await request(path(f, 'manage'))).entries.find(row => row.id === entry.id);
  entry = ok(await request(path(f, `entries/${entry.id}`), 'PUT', { ...requestId(), version: manager.version, document: { ...manager.document, ...changed, organizerNotes: manager.document.organizerNotes, conditions: manager.document.conditions } })).entry;
  assert.equal((await lookup(f, entry)).title, 'Chamber resonance');
  assert.ok(!JSON.stringify(ok(await request(path(f, 'manage'), 'GET', undefined, users.staff))).includes('NEW_DRAFT_SECRET'));
  const oldOverrideVersion = entry.override.version;
  entry = await publish(f, entry); assert.equal(entry.publishedVersion, 2); assert.equal(entry.override.stateId, null); assert.equal(entry.override.version, oldOverrideVersion + 1);
  assert.equal((await collect(f, input)).reading.id, original.id, 'Exact committed retry preserves its receipt after publication changes');
  assert.equal((await request(path(f, 'collect'), 'POST', { ...input, ...requestId() }, users.one)).status, 409);
  const revised = await lookup(f, entry); assert.equal(revised.title, 'NEW_DRAFT_SECRET'); assert.equal(revised.source, 'prepared');
  const copy = (await collect(f, collectInput(f, entry, revised))).reading; assert.notEqual(copy.id, original.id);
  assert.equal((await pool.query('SELECT text FROM adventure_journal WHERE id=$1', [original.id])).rows[0].text, original.text);
  entry = ok(await request(path(f, `entries/${entry.id}/withdraw`), 'POST', { ...requestId(), version: entry.version })).entry;
  assert.equal(ok(await request(path(f), 'GET', undefined, users.one)).signals.length, 0);
  assert.equal(ok(await request(path(f), 'GET', undefined, users.one)).readings.length, 2);
  assert.equal((await request(path(f, 'lookup'), 'POST', { characterId: f.characters.one.id, code: entry.code }, users.one)).status, 404);
});

test('conditional readings follow current game state, fail closed for any removed reference, and never change progression', async () => {
  const f = await fixture(), entry = await publish(f, await create(f));
  assert.equal((await lookup(f, entry)).state.id, 'unsettled');
  await pool.query('INSERT INTO adventure_runs(event_id,character_id,progress,flags) VALUES($1,$2,$3,$4)', [f.event.id, f.characters.one.id, JSON.stringify({ 'evidence-core': { completed: true } }), JSON.stringify({ 'cooperation-complete': true })]);
  const signal = await lookup(f, entry); assert.equal(signal.source, 'conditions'); assert.equal(signal.state.id, 'restored');
  const before = (await pool.query('SELECT * FROM adventure_runs WHERE event_id=$1', [f.event.id])).rows;
  await collect(f, collectInput(f, entry, signal)); assert.deepEqual((await pool.query('SELECT * FROM adventure_runs WHERE event_id=$1', [f.event.id])).rows, before);
  await pool.query("UPDATE event_adventures SET definition=jsonb_set(definition,'{flags}','[]'::jsonb) WHERE event_id=$1", [f.event.id]);
  const unavailable = ok(await request(path(f), 'GET', undefined, users.two)); assert.equal(unavailable.signals[0].available, false);
  assert.equal((await request(path(f, 'lookup'), 'POST', { characterId: f.characters.two.id, code: entry.code }, users.two)).status, 404, 'Missing rule reference must not fall through to default');
  assert.equal((await request(path(f, 'collect'), 'POST', collectInput(f, entry, signal), users.one)).status, 404);
});

test('staff overrides use published states and optimistic revisions, hide reasons and cannot bypass base conditions', async () => {
  const f = await fixture(); let entry = await publish(f, await create(f, { conditions: { ...defaultAdventureConditions(), completed: ['evidence-core'] } }));
  assert.equal((await request(path(f, `entries/${entry.id}/state`), 'POST', { ...requestId(), version: 0, stateId: 'restored', reason: 'Try control' }, users.one)).status, 403);
  for (const extra of [{ stateId: 'unknown' }, { stateId: 'constructor' }, { reason: '' }, { arbitraryLevel: 100 }]) assert.equal((await request(path(f, `entries/${entry.id}/state`), 'POST', { ...requestId(), version: 0, stateId: 'restored', reason: 'A reason', ...extra }, users.staff)).status, 400);
  entry = await override(f, entry, 'restored');
  assert.equal((await request(path(f, 'lookup'), 'POST', { characterId: f.characters.one.id, code: entry.code }, users.one)).status, 404, 'Staff state never bypasses base conditions');
  await pool.query('INSERT INTO adventure_runs(event_id,character_id,progress) VALUES($1,$2,$3)', [f.event.id, f.characters.one.id, JSON.stringify({ 'evidence-core': { completed: true } })]);
  const signal = await lookup(f, entry); assert.equal(signal.source, 'organizer'); assert.equal(signal.state.id, 'restored'); assert.ok(!JSON.stringify(signal).includes('PRIVATE_STAFF_REASON'));
  assert.equal((await request(path(f, `entries/${entry.id}/state`), 'POST', { ...requestId(), version: 0, stateId: null, reason: 'Stale staff tab' }, users.staff)).status, 409);
  entry = await override(f, entry, null); assert.equal((await lookup(f, entry)).source, 'prepared');
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM static_history WHERE event_id=$1 AND action='state'", [f.event.id])).rows[0].n, 2);
});

test('create, collection and staff interventions replay once; competing captures cannot duplicate a reading', async () => {
  const f = await fixture(), creation = { ...requestId(), document: document() };
  const first = ok(await request(path(f, 'entries'), 'POST', creation), 201), repeated = ok(await request(path(f, 'entries'), 'POST', creation)); assert.equal(first.entry.id, repeated.entry.id); assert.equal(repeated.outcome.replayed, true);
  assert.equal((await request(path(f, 'entries'), 'POST', { ...creation, document: document({ title: 'Different request' }) })).status, 409);
  let entry = await publish(f, first.entry); const signal = await lookup(f, entry), input = collectInput(f, entry, signal);
  const copies = await Promise.all([request(path(f, 'collect'), 'POST', input, users.one), request(path(f, 'collect'), 'POST', input, users.one)]);
  assert.equal(ok(copies[0]).reading.id, ok(copies[1]).reading.id); assert.deepEqual(copies.map(copy => copy.data.outcome.replayed).sort(), [false, true]);
  assert.equal((await collect(f, { ...input, ...requestId() })).reading.id, copies[0].data.reading.id);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM static_readings WHERE event_id=$1', [f.event.id])).rows[0].n, 1);
  const intervention = { ...requestId(), version: 0, stateId: 'restored', reason: 'Staff intervention' };
  entry = ok(await request(path(f, `entries/${entry.id}/state`), 'POST', intervention, users.staff)).entry;
  const repeat = ok(await request(path(f, `entries/${entry.id}/state`), 'POST', intervention, users.staff)); assert.equal(repeat.outcome.replayed, true); assert.equal(repeat.entry.override.version, 1);
  assert.equal((await collect(f, input)).reading.id, copies[0].data.reading.id, 'Committed capture remains acknowledged after staff changes');
  assert.equal((await request(path(f, 'collect'), 'POST', { ...input, ...requestId() }, users.one)).status, 409, 'A fresh capture of an old reading is stale after staff change');
  assert.equal((await request(path(f, `entries/${entry.id}/state`), 'POST', { ...intervention, stateId: null }, users.staff)).status, 409);
});

test('current assignment and account eligibility protect collected copies and managers cannot proxy player capture', async () => {
  const f = await fixture(), entry = await publish(f, await create(f)), signal = await lookup(f, entry), input = collectInput(f, entry, signal), first = (await collect(f, input)).reading;
  assert.equal((await request(path(f, 'collect'), 'POST', { ...input, ...requestId() })).status, 404);
  await pool.query('UPDATE characters SET user_id=$2 WHERE id=$1', [f.characters.one.id, users.two.id]);
  assert.equal((await request(path(f, 'collect'), 'POST', input, users.one)).status, 404);
  const inherited = ok(await request(path(f, `?characterId=${f.characters.one.id}`).replace('/static/?', '/static?'), 'GET', undefined, users.two)); assert.equal(inherited.readings.length, 0);
  assert.deepEqual(await filterStoryJournal(pool, f.event.id, users.two.id, [{ id: first.id }]), []);
  const second = ok(await request(path(f, 'collect'), 'POST', { ...input, ...requestId() }, users.two)).reading; assert.notEqual(second.id, first.id); assert.ok(!second.entryKey.includes(users.two.id));
  const general = ok(await request(`/api/events/${f.event.id}/adventure/play?characterId=${f.characters.one.id}`, 'GET', undefined, users.two)); assert.ok(!general.journal.some(row => row.id === first.id)); assert.ok(general.journal.some(row => row.id === second.id));
  await pool.query('UPDATE users SET is_disabled=true WHERE id=$1', [users.two.id]); assert.equal((await request(path(f, 'collect'), 'POST', { ...input, ...requestId() }, users.two)).status, 401); await pool.query('UPDATE users SET is_disabled=false WHERE id=$1', [users.two.id]);
  await pool.query("UPDATE characters SET status='retired' WHERE id=$1", [f.characters.one.id]); assert.equal((await request(path(f, 'collect'), 'POST', { ...input, ...requestId() }, users.two)).status, 404);
  await pool.query('DELETE FROM memberships WHERE event_id=$1 AND user_id=$2', [f.event.id, users.staff.id]); assert.equal((await request(path(f, `entries/${entry.id}/state`), 'POST', { ...requestId(), version: 0, stateId: null, reason: 'Revoked staff' }, users.staff)).status, 404);
});

test('lifecycle, disabled instruments and strict route shapes block unsupported writes', async () => {
  const f = await fixture(), entry = await publish(f, await create(f)), signal = await lookup(f, entry);
  for (const status of ['draft', 'paused', 'ended', 'archived']) {
    await pool.query('UPDATE events SET status=$2 WHERE id=$1', [f.event.id, status]);
    assert.equal((await request(path(f, 'collect'), 'POST', collectInput(f, entry, signal), users.one)).status, 409);
    assert.equal((await request(path(f, `entries/${entry.id}/state`), 'POST', { ...requestId(), version: 0, stateId: 'restored', reason: 'Not playable' }, users.staff)).status, 409);
    assert.equal(ok(await request(path(f), 'GET', undefined, users.one)).readOnly, true);
  }
  assert.equal((await request(path(f, 'entries'), 'POST', { ...requestId(), document: document() })).status, 409);
  await pool.query("UPDATE events SET status='rehearsal',setup=jsonb_set(setup,'{enabledInstruments}','[\"briefing\"]'::jsonb) WHERE id=$1", [f.event.id]);
  assert.equal((await request(path(f, 'lookup'), 'POST', { characterId: f.characters.one.id, code: entry.code }, users.one)).status, 404);
  assert.equal((await request(path(f, 'collect'), 'POST', collectInput(f, entry, signal), users.one)).status, 404);
  for (const [suffix, method] of [['lookup', 'GET'], ['collect', 'PUT'], ['manage', 'POST'], ['entries', 'GET'], [`entries/${entry.id}/publish`, 'GET']]) assert.equal((await request(path(f, suffix), method, method === 'GET' ? undefined : {})).status, 405);
});

test('all three themes share conditional reading mechanics and rehearsal copies omit runtime state', async () => {
  const labels = [];
  for (const theme of ['fantasy', 'cyberpunk', 'wasteland']) {
    const f = await fixture(theme); await seedStatic(pool, f.event, users.owner.id); await seedStatic(pool, f.event, users.owner.id);
    let entry = ok(await request(path(f, 'manage'))).entries[0]; labels.push(entry.document.title); assert.equal(ok(await request(path(f, 'manage'))).entries.length, 1);
    assert.equal((await lookup(f, entry)).state.id, 'unsettled');
    await pool.query('INSERT INTO adventure_runs(event_id,character_id,flags) VALUES($1,$2,$3)', [f.event.id, f.characters.one.id, JSON.stringify({ 'cooperation-complete': true })]);
    const signal = await lookup(f, entry); assert.equal(signal.state.id, 'restored'); await collect(f, collectInput(f, entry, signal));
    entry = await override(f, entry, 'unsettled');
    const target = await fixture(theme); await copyStatic(pool, f.event.id, target.event.id, users.owner.id);
    const copy = ok(await request(path(target, 'manage'))).entries[0]; assert.notEqual(copy.id, entry.id); assert.notEqual(copy.code, entry.code); assert.equal(copy.override.version, 0);
    assert.equal(ok(await request(path(target), 'GET', undefined, users.one)).readings.length, 0);
    assert.equal((await lookup(target, copy)).state.id, 'unsettled');
    const authored = (await pool.query('SELECT document,published,code FROM static_entries WHERE event_id=$1', [f.event.id])).rows;
    await resetStatic(pool, f.event.id);
    for (const table of ['static_requests', 'static_history', 'static_readings', 'static_overrides']) assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE event_id=$1`, [f.event.id])).rows[0].n, 0);
    assert.deepEqual((await pool.query('SELECT document,published,code FROM static_entries WHERE event_id=$1', [f.event.id])).rows, authored);
  }
  assert.equal(new Set(labels).size, 3);
});

test('withdraw remains available with a full history and exact receipts survive withdrawal without new writes', async () => {
  const f = await fixture(); let entry = await publish(f, await create(f)), signal = await lookup(f, entry), input = collectInput(f, entry, signal);
  const reading = (await collect(f, input)).reading;
  const existing = (await pool.query('SELECT count(*)::int AS n FROM static_history WHERE event_id=$1', [f.event.id])).rows[0].n;
  await pool.query("INSERT INTO static_history(id,event_id,entry_id,actor_user_id,action,version) SELECT value::uuid,$1,$2,$3,'updated',1 FROM jsonb_array_elements_text($4::jsonb)", [f.event.id, entry.id, users.owner.id, JSON.stringify(Array.from({ length: 512 - existing }, randomUUID))]);
  const denied = await request(path(f, `entries/${entry.id}`), 'PUT', { ...requestId(), version: entry.version, document: document({ title: 'Cannot append' }) }); assert.equal(denied.status, 429);
  assert.equal((await pool.query('SELECT version FROM static_entries WHERE id=$1', [entry.id])).rows[0].version, entry.version, 'Failed capacity check rolls back draft edit');
  entry = ok(await request(path(f, `entries/${entry.id}/withdraw`), 'POST', { ...requestId(), version: entry.version })).entry; assert.equal(entry.status, 'withdrawn');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM static_history WHERE event_id=$1', [f.event.id])).rows[0].n, 512);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_entries WHERE event_id=$1 AND action='static.withdraw'", [f.event.id])).rows[0].n, 1);
  const before = (await pool.query('SELECT count(*)::int AS n FROM static_requests WHERE event_id=$1', [f.event.id])).rows[0].n;
  const receipt = await collect(f, input); assert.equal(receipt.reading.id, reading.id); assert.equal(receipt.signal, null); assert.equal(receipt.outcome.replayed, true);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM static_requests WHERE event_id=$1', [f.event.id])).rows[0].n, before);
  assert.equal((await request(path(f, 'collect'), 'POST', { ...input, ...requestId() }, users.one)).status, 404);
});

test('bounded authoring accepts a valid multilingual publication larger than ninety kilobytes', async () => {
  const f = await fixture(), states = Array.from({ length: 12 }, (_, index) => ({ id: `state-${index}`, label: `State ${index}`, text: '界'.repeat(3000), level: index, tone: 'calm' }));
  const large = document({ states, defaultStateId: states[0].id, organizerNotes: '界'.repeat(6000), summary: '界'.repeat(2000), rules: [] });
  assert.ok(Buffer.byteLength(JSON.stringify(large)) > 90000);
  const entry = await publish(f, await create(f, large)); assert.equal(entry.published.states.length, 12);
  const signal = await lookup(f, entry); assert.equal(signal.state.text.length, 3000); assert.ok(!Object.hasOwn(signal, 'states'));
});
