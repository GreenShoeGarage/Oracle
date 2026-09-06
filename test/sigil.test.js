import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './database.js';
import { migrate } from '../src/db.js';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { defaultSetup } from '../public/kit.js';
import { defaultAdventure } from '../public/adventure-model.js';
import { defaultCharacterProfile } from '../public/characters-model.js';
import { defaultSigilDocument, validateSigilDocument, validateSigilRequest } from '../public/sigil-model.js';
import { projectSigilClock } from '../src/sigil.js';
let database, pool, server, origin;
const users = {};
async function request(path, method = 'GET', data, who = users.owner) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...(who?.cookie ? { Cookie: who.cookie } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  const text = await response.text(); return { status: response.status, data: text ? JSON.parse(text) : null, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
function ok(result, status = 200) { assert.equal(result.status, status, JSON.stringify(result.data)); return result.data; }
const base = f => `/api/events/${f.event.id}/sigil`;
const command = (f, run, extra = {}) => ({ requestId: randomUUID(), characterId: f.character.id, version: run.version, ...extra });
async function fixture(extra = {}) {
  const setup = defaultSetup(); setup.enabledInstruments = ['briefing', 'sigil', 'static', 'bazaar'];
  const event = ok(await request('/api/events', 'POST', { name: 'SIGIL testing', setup }), 201).event;
  await pool.query("UPDATE events SET status='rehearsal' WHERE id=$1", [event.id]);
  for (const name of ['a', 'b', 'staff']) await pool.query('INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,$3)', [event.id, users[name].id, name === 'staff' ? 'staff' : 'player']);
  const character = ok(await request(`/api/events/${event.id}/characters`, 'POST', { profile: { ...defaultCharacterProfile(setup.rules), name: 'Host character', privateObjectives: 'PRIVATE HOST OBJECTIVES' } }, users.a), 201).character;
  await pool.query("UPDATE characters SET status='approved',inventory_initialized=true WHERE id=$1", [character.id]);
  const definition = { ...defaultAdventure(), flags: [{ id: 'restored', name: 'Restored' }, { id: 'failed', name: 'Failed' }] };
  await pool.query('INSERT INTO event_adventures(event_id,definition) VALUES($1,$2)', [event.id, JSON.stringify(definition)]);
  await pool.query("INSERT INTO economy_resources(event_id,id,name) VALUES($1,'marks','Marks')", [event.id]);
  await pool.query("INSERT INTO economy_balances(event_id,character_id,resource_id,quantity) VALUES($1,$2,'marks',10)", [event.id, character.id]);
  const itemId = randomUUID(); await pool.query("INSERT INTO character_inventory(id,event_id,character_id,name,quantity,notes) VALUES($1,$2,$3,'Token',3,'PRIVATE ITEM NOTES')", [itemId, event.id, character.id]);
  const document = { ...defaultSigilDocument(), title: 'Restore the relay', organizerNotes: 'PRIVATE ORGANIZER NOTES', success: { text: 'The relay is restored.', flags: ['restored'] }, failure: { text: 'The relay went dark.', flags: ['failed'] }, ...extra };
  const f = { event, character, definition, document, itemId };
  f.entry = ok(await request(`${base(f)}/entries`, 'POST', { requestId: randomUUID(), document }), 201).entry;
  f.entry = ok(await request(`${base(f)}/entries/${f.entry.id}/publish`, 'POST', { requestId: randomUUID(), version: f.entry.version })).entry;
  return f;
}
function startInput(f, extra = {}) { return { requestId: randomUUID(), characterId: f.character.id, entryId: f.entry.id, publishedVersion: f.entry.publishedVersion, code: f.entry.code, roles: f.document.roles.map(role => ({ roleId: role.id, performer: `Human ${role.name}` })), bindings: f.document.components.filter(component => component.kind === 'item').map(component => ({ componentId: component.id, itemId: f.itemId })), ...extra }; }
async function start(f, input = startInput(f)) { return ok(await request(`${base(f)}/start`, 'POST', input, users.a), 201).run; }
async function view(f, run, who = users.a) { return ok(await request(`${base(f)}/runs/${run.id}?characterId=${f.character.id}`, 'GET', undefined, who)).run; }
async function act(f, run, action, extra = {}) { return ok(await request(`${base(f)}/runs/${run.id}/${action}`, 'POST', command(f, run, extra), users.a)).run; }
function stepInput(f, run, extra = {}) { return command(f, run, { checkpointId: run.currentCheckpoint.id, roleId: run.currentCheckpoint.roleId, answer: '', ...extra }); }
const components = [{ id: 'token', name: 'Relay token', kind: 'item', itemName: 'Token', resourceId: null, quantity: 2, consume: true }, { id: 'fuel', name: 'Fuel budget', kind: 'resource', itemName: null, resourceId: 'marks', quantity: 4, consume: true }];
before(async () => {
  database = await testDatabase(); pool = database.pool; await migrate(pool);
  let handler; server = createServer((req, res) => handler(req, res)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  handler = createApp({ pool, config: { ...readConfig({ DATABASE_URL: 'postgres://unused', PORT: '3000' }), origin }, logger: entry => console.error(entry) });
  for (const name of ['owner', 'a', 'b', 'staff']) { const result = await request('/api/auth/register', 'POST', { displayName: `SIGIL ${name}`, email: `${name}@sigil.example.test`, password: 'Cooperative testing passphrase!' }, null); users[name] = { ...ok(result, 201).user, cookie: result.cookie }; }
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); if (database) await database.close(); });

test('SIGIL validates strict documents, roles, components, durations and command data', () => {
  const document = { ...defaultSigilDocument(), title: 'Test' };
  assert.equal(validateSigilDocument(document).title, 'Test');
  for (const change of [d => { d.result = 'succeeded'; }, d => { d.roles.push(d.roles[0]); }, d => { delete d.checkpoints[0]; }, d => { d.checkpoints[0].roleId = 'unknown'; }, d => { d.checkpoints[0].minimumSeconds = d.durationSeconds; }, d => { d.components = [{ ...components[0], resourceId: 'marks' }]; }, d => { d.components = [components[1]]; }, d => { d.success.flags = ['unknown']; }]) { const candidate = structuredClone(document); change(candidate); assert.throws(() => validateSigilDocument(candidate), { status: 400 }); }
  for (const action of ['__proto__', 'constructor', 'toString']) assert.throws(() => validateSigilRequest({}, action), { status: 400 });
  assert.throws(() => validateSigilRequest({ characterId: randomUUID(), sequence: 1, version: 1 }, 'heartbeat'), { status: 400 });
});

test('clock projection bounds offline active time, honors crossed deadlines and freezes paused elapsed time', () => {
  const row = { status: 'running', pause_reason: null, remaining_ms: 60_000, deadline_at: new Date(60_000), lease_expires_at: new Date(20_000), checkpoint_started_at: new Date(0), checkpoint_elapsed_ms: 3000 };
  assert.deepEqual(projectSigilClock(row, 90_000), { status: 'paused', pauseReason: 'connection', remainingMs: 40_000, checkpointElapsedMs: 23_000 });
  assert.equal(projectSigilClock({ ...row, deadline_at: new Date(10_000) }, 90_000).status, 'failed');
  assert.deepEqual(projectSigilClock({ ...row, status: 'paused' }, 90_000), { status: 'paused', pauseReason: null, remainingMs: 60_000, checkpointElapsedMs: 3000 });
});

test('published challenge and player DTO never disclose drafts, answers, future steps or host private data', async () => {
  const f = await fixture({ checkpoints: [{ ...defaultSigilDocument().checkpoints[0], answer: 'SECRET ANSWER' }, { id: 'later', title: 'Later', instructions: 'HIDDEN FUTURE STEP', roleId: 'lead', minimumSeconds: 0, answer: 'LATER ANSWER' }] });
  const run = await start(f);
  const lookup = ok(await request(`${base(f)}/lookup`, 'POST', { characterId: f.character.id, code: f.entry.code }, users.a));
  const overview = ok(await request(`${base(f)}?characterId=${f.character.id}`, 'GET', undefined, users.a));
  const staff = ok(await request(`${base(f)}/manage`, 'GET', undefined, users.staff));
  for (const value of ['PRIVATE ORGANIZER NOTES', 'PRIVATE HOST OBJECTIVES', 'PRIVATE ITEM NOTES', 'SECRET ANSWER', 'LATER ANSWER', 'HIDDEN FUTURE STEP', users.a.id, users.a.email]) for (const data of [run, lookup, overview, staff]) assert.ok(!JSON.stringify(data).includes(value), value);
  const changed = { ...f.document, title: 'Unpublished draft' };
  f.entry = ok(await request(`${base(f)}/entries/${f.entry.id}`, 'PUT', { requestId: randomUUID(), version: f.entry.version, document: changed })).entry;
  assert.equal(ok(await request(`${base(f)}/lookup`, 'POST', { characterId: f.character.id, code: f.entry.code }, users.a)).challenge.title, f.document.title);
  assert.equal((await request(`${base(f)}/entries`, 'POST', { requestId: randomUUID(), document: changed }, users.staff)).status, 403);
  assert.equal((await request(`${base(f)}/runs/${run.id}/operate`, 'POST', { requestId: randomUUID(), version: run.version, operation: 'succeed', reason: 'Forged authority.' }, users.a)).status, 403);
});

test('final checkpoint atomically consumes host components, merges flags and records exactly one outcome', async () => {
  const f = await fixture({ components }), initial = startInput(f); let run = await start(f, initial);
  assert.equal(ok(await request(`${base(f)}/start`, 'POST', initial, users.a)).outcome.replayed, true);
  const final = stepInput(f, run), result = ok(await request(`${base(f)}/runs/${run.id}/checkpoint`, 'POST', final, users.a)); run = result.run;
  assert.equal(run.status, 'succeeded'); assert.equal(run.result.consumption.items[0].consumed, 2); assert.equal(run.result.consumption.resources[0].consumed, 4);
  assert.equal((await pool.query('SELECT quantity FROM character_inventory WHERE id=$1', [f.itemId])).rows[0].quantity, 1);
  assert.equal((await pool.query('SELECT quantity FROM economy_balances WHERE event_id=$1', [f.event.id])).rows[0].quantity, 6);
  assert.equal((await pool.query('SELECT flags FROM adventure_runs WHERE event_id=$1', [f.event.id])).rows[0].flags.restored, true);
  assert.equal(ok(await request(`${base(f)}/runs/${run.id}/checkpoint`, 'POST', final, users.a)).outcome.replayed, true);
  assert.equal((await request(`${base(f)}/runs/${run.id}/checkpoint`, 'POST', { ...final, requestId: randomUUID(), version: run.version }, users.a)).status, 409);
  assert.equal((await request(`${base(f)}/start`, 'POST', startInput(f), users.a)).status, 409);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM sigil_outcomes WHERE event_id=$1', [f.event.id])).rows[0].n, 1);
});

test('insufficient final stock rolls back last checkpoint, every charge, flags and outcome; exact request can recover', async () => {
  const f = await fixture({ components }); let run = await start(f); const final = stepInput(f, run);
  await pool.query('UPDATE economy_balances SET quantity=0 WHERE event_id=$1', [f.event.id]);
  assert.equal((await request(`${base(f)}/runs/${run.id}/checkpoint`, 'POST', final, users.a)).status, 409);
  const after = await view(f, run); assert.equal(after.version, run.version); assert.equal(after.currentCheckpoint.id, run.currentCheckpoint.id); assert.equal(after.result, null);
  assert.equal((await pool.query('SELECT quantity FROM character_inventory WHERE id=$1', [f.itemId])).rows[0].quantity, 3);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM adventure_journal WHERE event_id=$1', [f.event.id])).rows[0].n, 0);
  await pool.query('UPDATE economy_balances SET quantity=10 WHERE event_id=$1', [f.event.id]);
  run = ok(await request(`${base(f)}/runs/${run.id}/checkpoint`, 'POST', final, users.a)).run; assert.equal(run.status, 'succeeded');
});

test('minimum time and answers are server-authoritative; wrong answer request is durable without exposing expected text', async () => {
  const f = await fixture({ checkpoints: [{ ...defaultSigilDocument().checkpoints[0], minimumSeconds: 5, answer: 'ÅLPHA' }] }); let run = await start(f);
  assert.equal((await request(`${base(f)}/runs/${run.id}/checkpoint`, 'POST', stepInput(f, run, { answer: 'åLPHA' }), users.a)).status, 409);
  await pool.query("UPDATE sigil_runs SET checkpoint_started_at=clock_timestamp()-interval '6 seconds' WHERE id=$1", [run.id]);
  const wrong = stepInput(f, run, { answer: 'wrong' });
  const result = ok(await request(`${base(f)}/runs/${run.id}/checkpoint`, 'POST', wrong, users.a)); assert.equal(result.outcome.accepted, false); assert.equal(result.run.version, run.version);
  assert.equal(ok(await request(`${base(f)}/runs/${run.id}/checkpoint`, 'POST', wrong, users.a)).outcome.replayed, true);
  assert.equal((await request(`${base(f)}/runs/${run.id}/checkpoint`, 'POST', { ...wrong, answer: 'åLPHA' }, users.a)).status, 409);
  run = ok(await request(`${base(f)}/runs/${run.id}/checkpoint`, 'POST', stepInput(f, run, { answer: 'åLPHA' }), users.a)).run; assert.equal(run.status, 'succeeded');
});

test('heartbeats have no gameplay version or history churn, cannot revive expired leases, and explicit resume preserves progress', async () => {
  const f = await fixture(); let run = await start(f);
  const beat = { characterId: f.character.id, sequence: 1 };
  const first = ok(await request(`${base(f)}/runs/${run.id}/heartbeat`, 'POST', beat, users.a)).run;
  const second = ok(await request(`${base(f)}/runs/${run.id}/heartbeat`, 'POST', beat, users.a)).run;
  assert.equal(first.leaseExpiresAt, second.leaseExpiresAt); assert.equal(first.version, run.version); assert.equal(first.history.length, 1);
  await pool.query("UPDATE sigil_runs SET lease_expires_at=clock_timestamp()-interval '30 seconds',deadline_at=clock_timestamp()+interval '40 seconds',checkpoint_started_at=clock_timestamp()-interval '40 seconds' WHERE id=$1", [run.id]);
  const before = await pool.query('SELECT status,version FROM sigil_runs WHERE id=$1', [run.id]);
  run = await view(f, run); assert.equal(run.status, 'paused'); assert.equal(run.pauseReason, 'connection'); assert.ok(run.remainingMs >= 69_000 && run.remainingMs <= 71_000);
  assert.deepEqual((await pool.query('SELECT status,version FROM sigil_runs WHERE id=$1', [run.id])).rows, before.rows);
  run = ok(await request(`${base(f)}/runs/${run.id}/heartbeat`, 'POST', { ...beat, sequence: 2 }, users.a)).run; assert.equal(run.status, 'paused'); assert.equal(run.heartbeatSequence, 1);
  const remaining = run.remainingMs; run = await act(f, run, 'resume'); assert.equal(run.status, 'running'); assert.ok(run.remainingMs <= remaining && run.remainingMs > remaining - 1000);
  run = await act(f, run, 'pause'); const paused = await view(f, run); assert.equal(paused.remainingMs, run.remainingMs); assert.equal(paused.checkpointRemainingMs, run.checkpointRemainingMs);
});

test('crossed deadline GET is read-only; next heartbeat commits failure once and retries cannot revive it', async () => {
  const f = await fixture({ components }); let run = await start(f);
  await pool.query("UPDATE sigil_runs SET deadline_at=clock_timestamp()-interval '2 seconds',lease_expires_at=clock_timestamp()+interval '10 seconds' WHERE id=$1", [run.id]);
  run = await view(f, run); assert.equal(run.status, 'failed'); assert.equal(run.result, null);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM sigil_outcomes WHERE run_id=$1', [run.id])).rows[0].n, 0);
  run = ok(await request(`${base(f)}/runs/${run.id}/heartbeat`, 'POST', { characterId: f.character.id, sequence: 1 }, users.a)).run;
  assert.equal(run.status, 'failed'); assert.equal(run.result.status, 'failed'); assert.equal(run.result.consumption.items.length, 0);
  assert.equal((await pool.query('SELECT quantity FROM character_inventory WHERE id=$1', [f.itemId])).rows[0].quantity, 3);
  assert.equal((await request(`${base(f)}/runs/${run.id}/resume`, 'POST', command(f, run), users.a)).status, 409);
  const retry = await start(f); assert.notEqual(retry.id, run.id);
});

test('event pause, instrument disable, withdrawal and end freeze or cancel clocks without automatic resume', async () => {
  const f = await fixture(); await pool.query("UPDATE events SET status='live' WHERE id=$1", [f.event.id]); let run = await start(f);
  let event = ok(await request(`/api/events/${f.event.id}`)).event;
  event = ok(await request(`/api/events/${f.event.id}`, 'PATCH', { status: 'paused', version: event.version })).event;
  run = await view(f, run); assert.equal(run.status, 'paused'); assert.equal(run.pauseReason, 'event');
  event = ok(await request(`/api/events/${f.event.id}`, 'PATCH', { status: 'live', version: event.version })).event;
  assert.equal((await view(f, run)).status, 'paused'); run = await act(f, run, 'resume');
  const disabledSetup = { ...event.setup, enabledInstruments: event.setup.enabledInstruments.filter(id => id !== 'sigil') };
  event = ok(await request(`/api/events/${f.event.id}`, 'PATCH', { setup: disabledSetup, version: event.version })).event;
  run = await view(f, run); assert.equal(run.status, 'paused'); assert.equal(run.pauseReason, 'instrument');
  event = ok(await request(`/api/events/${f.event.id}`, 'PATCH', { setup: { ...event.setup, enabledInstruments: [...event.setup.enabledInstruments, 'sigil'] }, version: event.version })).event;
  assert.equal((await view(f, run)).status, 'paused'); run = await act(f, run, 'resume');
  f.entry = ok(await request(`${base(f)}/entries/${f.entry.id}/withdraw`, 'POST', { requestId: randomUUID(), version: f.entry.version })).entry;
  run = await view(f, run); assert.equal(run.status, 'paused'); assert.equal(run.pauseReason, 'withdrawn'); assert.equal(run.canResume, false);
  f.entry = ok(await request(`${base(f)}/entries/${f.entry.id}/publish`, 'POST', { requestId: randomUUID(), version: f.entry.version })).entry;
  assert.equal((await view(f, run)).status, 'paused'); run = await act(f, run, 'resume');
  event = ok(await request(`/api/events/${f.event.id}`, 'PATCH', { status: 'ended', version: event.version })).event;
  run = await view(f, run); assert.equal(run.status, 'cancelled'); assert.equal(run.result, null);
});

test('staff overrides require current authority and a reason, consume components and never repeat a terminal outcome', async () => {
  const f = await fixture({ components }); let run = await start(f);
  const operation = { requestId: randomUUID(), version: run.version, operation: 'succeed', reason: 'Physical prop failed; all performers completed the sequence.' };
  assert.equal((await request(`${base(f)}/runs/${run.id}/operate`, 'POST', { ...operation, reason: '' }, users.staff)).status, 400);
  run = ok(await request(`${base(f)}/runs/${run.id}/operate`, 'POST', operation, users.staff)).run;
  assert.equal(run.status, 'succeeded'); assert.equal(run.result.consumption.resources[0].consumed, 4); assert.equal(run.history.at(-1).reason, operation.reason);
  assert.equal(ok(await request(`${base(f)}/runs/${run.id}/operate`, 'POST', operation, users.staff)).outcome.replayed, true);
  assert.equal((await request(`${base(f)}/runs/${run.id}/operate`, 'POST', { ...operation, requestId: randomUUID(), version: run.version }, users.staff)).status, 409);
});

test('captured ownership prevents reassignment from transferring runs or journal receipts and staff can cancel unavailable attempts', async () => {
  const f = await fixture(); let run = await start(f);
  await pool.query('UPDATE characters SET user_id=$2 WHERE id=$1', [f.character.id, users.b.id]);
  assert.equal((await request(`${base(f)}/runs/${run.id}?characterId=${f.character.id}`, 'GET', undefined, users.a)).status, 404);
  assert.equal((await request(`${base(f)}/runs/${run.id}?characterId=${f.character.id}`, 'GET', undefined, users.b)).status, 404);
  const manager = ok(await request(`${base(f)}/runs/${run.id}`)).run; assert.equal(manager.status, 'unavailable');
  assert.equal((await request(`${base(f)}/runs/${run.id}/operate`, 'POST', { requestId: randomUUID(), version: run.version, operation: 'succeed', reason: 'Cannot charge reassigned host.' })).status, 409);
  run = ok(await request(`${base(f)}/runs/${run.id}/operate`, 'POST', { requestId: randomUUID(), version: run.version, operation: 'cancel', reason: 'Host reassigned.' })).run; assert.equal(run.status, 'cancelled');
});

test('publication changes preserve running snapshots and request history rejects payload reuse', async () => {
  const f = await fixture(); const run = await start(f);
  const edit = { requestId: randomUUID(), version: f.entry.version, document: { ...f.document, title: 'Revised procedure', success: { text: 'NEW OUTCOME', flags: [] } } };
  f.entry = ok(await request(`${base(f)}/entries/${f.entry.id}`, 'PUT', edit)).entry;
  assert.equal(ok(await request(`${base(f)}/entries/${f.entry.id}`, 'PUT', edit)).outcome.replayed, true);
  assert.equal((await request(`${base(f)}/entries/${f.entry.id}`, 'PUT', { ...edit, document: f.document })).status, 409);
  f.entry = ok(await request(`${base(f)}/entries/${f.entry.id}/publish`, 'POST', { requestId: randomUUID(), version: f.entry.version })).entry;
  const final = ok(await request(`${base(f)}/runs/${run.id}/checkpoint`, 'POST', stepInput(f, run), users.a)).run;
  assert.equal(final.title, f.document.title); assert.equal(final.result.text, f.document.success.text); assert.equal(final.publishedVersion, 1);
});

test('removed current prerequisites prevent final success and staff success without spending components', async () => {
  const f = await fixture({ components });
  const conditions = { ...f.document.conditions, flags: ['failed'] };
  await pool.query('INSERT INTO adventure_runs(event_id,character_id,flags) VALUES($1,$2,$3)', [f.event.id, f.character.id, JSON.stringify({ failed: true })]);
  f.document = { ...f.document, conditions };
  f.entry = ok(await request(`${base(f)}/entries/${f.entry.id}`, 'PUT', { requestId: randomUUID(), version: f.entry.version, document: f.document })).entry;
  f.entry = ok(await request(`${base(f)}/entries/${f.entry.id}/publish`, 'POST', { requestId: randomUUID(), version: f.entry.version })).entry;
  const run = await start(f); await pool.query("UPDATE adventure_runs SET flags='{}' WHERE event_id=$1", [f.event.id]);
  assert.equal((await request(`${base(f)}/runs/${run.id}/checkpoint`, 'POST', stepInput(f, run), users.a)).status, 409);
  assert.equal((await request(`${base(f)}/runs/${run.id}/operate`, 'POST', { requestId: randomUUID(), version: run.version, operation: 'succeed', reason: 'Cannot waive requirements.' }, users.staff)).status, 409);
  assert.equal((await pool.query('SELECT quantity FROM character_inventory WHERE id=$1', [f.itemId])).rows[0].quantity, 3);
  assert.equal((await view(f, run)).result, null);
});

test('bounded run history still permits event pause and archive cancellation while retaining every existing record', async () => {
  const f = await fixture(); await pool.query("UPDATE events SET status='live' WHERE id=$1", [f.event.id]); let run = await start(f);
  const ids = Array.from({ length: 511 }, () => randomUUID());
  await pool.query("INSERT INTO sigil_history(id,event_id,run_id,actor_user_id,action) SELECT id,$2,$3,$4,'checkpoint' FROM unnest($1::uuid[]) id", [ids, f.event.id, run.id, users.a.id]);
  assert.equal((await request(`${base(f)}/runs/${run.id}/checkpoint`, 'POST', stepInput(f, run), users.a)).status, 429);
  let event = ok(await request(`/api/events/${f.event.id}`)).event;
  event = ok(await request(`/api/events/${f.event.id}`, 'PATCH', { status: 'paused', version: event.version })).event;
  run = await view(f, run); assert.equal(run.status, 'paused'); assert.equal(run.history.length, 512);
  event = ok(await request(`/api/events/${f.event.id}`, 'PATCH', { status: 'ended', version: event.version })).event;
  event = ok(await request(`/api/events/${f.event.id}`, 'PATCH', { status: 'archived', version: event.version })).event;
  run = await view(f, run); assert.equal(run.status, 'cancelled'); assert.equal(run.history.length, 512); assert.equal(run.result, null);
  assert.ok((await pool.query("SELECT id FROM audit_entries WHERE event_id=$1 AND action='sigil.cancelled'", [f.event.id])).rows.length);
});

test('deadline reconciliation commits before stale checkpoint rejection, and deleted references cancel safely', async () => {
  const f = await fixture(); let run = await start(f); const stale = stepInput(f, run);
  await pool.query("UPDATE sigil_runs SET deadline_at=clock_timestamp()-interval '2 seconds',lease_expires_at=clock_timestamp()+interval '10 seconds' WHERE id=$1", [run.id]);
  const response = ok(await request(`${base(f)}/runs/${run.id}/checkpoint`, 'POST', stale, users.a));
  assert.equal(response.run.status, 'failed'); assert.equal(response.outcome.interrupted, true); assert.equal(response.run.result.status, 'failed');
  assert.equal(ok(await request(`${base(f)}/runs/${run.id}/checkpoint`, 'POST', stale, users.a)).outcome.replayed, true);
  run = await start(f);
  await pool.query("UPDATE event_adventures SET definition=jsonb_set(definition,'{flags}','[]') WHERE event_id=$1", [f.event.id]);
  await pool.query("UPDATE sigil_runs SET deadline_at=clock_timestamp()-interval '2 seconds',lease_expires_at=clock_timestamp()+interval '10 seconds' WHERE id=$1", [run.id]);
  run = ok(await request(`${base(f)}/runs/${run.id}/heartbeat`, 'POST', { characterId: f.character.id, sequence: 1 }, users.a)).run;
  assert.equal(run.status, 'cancelled'); assert.equal(run.result, null); assert.match(run.history.at(-1).reason, /references were unavailable/);
});

test('an invalid resume cannot roll back the server connection pause', async () => {
  const f = await fixture(); let run = await start(f);
  await pool.query("UPDATE sigil_runs SET lease_expires_at=clock_timestamp()-interval '2 seconds' WHERE id=$1", [run.id]);
  await pool.query("UPDATE event_adventures SET definition=jsonb_set(definition,'{flags}','[]') WHERE event_id=$1", [f.event.id]);
  const resume = command(f, run);
  const response = ok(await request(`${base(f)}/runs/${run.id}/resume`, 'POST', resume, users.a));
  assert.equal(response.run.status, 'paused'); assert.equal(response.outcome.interrupted, true);
  assert.equal((await pool.query('SELECT status FROM sigil_runs WHERE id=$1', [run.id])).rows[0].status, 'paused');
  await pool.query('UPDATE event_adventures SET definition=$2 WHERE event_id=$1', [f.event.id, JSON.stringify(f.definition)]);
  const replay = ok(await request(`${base(f)}/runs/${run.id}/resume`, 'POST', resume, users.a));
  assert.equal(replay.run.status, 'paused'); assert.equal(replay.outcome.replayed, true); assert.equal(replay.outcome.interrupted, true);
});
