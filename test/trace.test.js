import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID, randomInt } from 'node:crypto';
import { testDatabase } from './database.js';
import { migrate } from '../src/db.js';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { defaultSetup } from '../public/kit.js';
import { defaultCharacterProfile } from '../public/characters-model.js';
import { defaultAdventure, defaultAdventureNode } from '../public/adventure-model.js';
import { defaultTraceDocument, validateTraceRequest } from '../public/trace-model.js';
import { defaultStoryDocument } from '../public/story-model.js';

let database, pool, server, origin;
const users = {}, password = 'TRACE integration passphrase!';
const privateNote = 'PRIVATE THEORY: the lantern keeper could be a decoy.';
const sourceSecret = 'PRIVATE SOURCE: the copper gate opens westward.';
const badge = () => Array.from({ length: 20 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join('');
async function request(path, method = 'GET', data, who = users.owner) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...(who?.cookie ? { Cookie: who.cookie } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  const raw = await response.text(); return { status: response.status, data: raw ? JSON.parse(raw) : null, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
function ok(response, status = 200) { assert.equal(response.status, status, JSON.stringify(response.data)); return response.data; }
const base = f => `/api/events/${f.event.id}/trace`;
const mutation = (f, name = 'one', data = {}) => ({ requestId: randomUUID(), characterId: f.characters[name].id, ...data });
const document = (changes = {}) => ({ ...defaultTraceDocument(), title: 'Lantern hypothesis', notes: privateNote, ...changes });
async function view(f, name = 'one') { return ok(await request(`${base(f)}?characterId=${f.characters[name].id}`, 'GET', undefined, users[name])); }
async function create(f, changes = {}, name = 'one') { return ok(await request(base(f), 'POST', mutation(f, name, { document: document(changes) }), users[name]), 201).record; }
async function update(f, record, changes = {}, name = 'one') { const value = { kind: record.kind, title: record.title, notes: record.notes, audience: record.audience, sources: record.sources.map(row => row.id), links: record.links.map(({ recordId, label }) => ({ recordId, label })), ...changes }; return ok(await request(`${base(f)}/${record.id}`, 'PUT', mutation(f, name, { version: record.version, document: value }), users[name])).record; }
async function fixture() {
  const setup = defaultSetup();
  const event = ok(await request('/api/events', 'POST', { name: 'TRACE rehearsal', setup }), 201).event;
  setup.enabledInstruments = ['briefing', 'trace', 'whisper', 'broadside', 'relic'];
  await pool.query("UPDATE events SET status='rehearsal',setup=$2 WHERE id=$1", [event.id, JSON.stringify(setup)]);
  for (const name of ['one', 'two', 'third']) await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'player')", [event.id, users[name].id]);
  const factions = { first: randomUUID(), second: randomUUID() };
  for (const [name, id] of Object.entries(factions)) await pool.query('INSERT INTO factions(id,event_id,name) VALUES($1,$2,$3)', [id, event.id, `Faction ${name}`]);
  const characters = {};
  for (const name of ['owner', 'one', 'two', 'third']) {
    const profile = { ...defaultCharacterProfile(setup.rules), name: `Investigator ${name}`, factionId: ['one', 'two'].includes(name) ? factions.first : factions.second, privateObjectives: 'PRIVATE character objective' };
    characters[name] = { id: randomUUID(), profile };
    await pool.query("INSERT INTO characters(id,event_id,user_id,status,profile,badge_code) VALUES($1,$2,$3,'approved',$4,$5)", [characters[name].id, event.id, users[name].id, JSON.stringify(profile), badge()]);
    await pool.query("INSERT INTO adventure_runs(event_id,character_id,progress,flags) VALUES($1,$2,'{}','{\"original\":true}')", [event.id, characters[name].id]);
  }
  const groups = { visible: randomUUID(), hidden: randomUUID() };
  await pool.query("INSERT INTO story_groups(id,event_id,name,character_ids) VALUES($1,$2,'Lantern group',$3),($4,$2,'HIDDEN group',$5)", [groups.visible, event.id, JSON.stringify([characters.one.id, characters.two.id]), groups.hidden, JSON.stringify([characters.third.id])]);
  const reading = randomUUID(), receipt = randomUUID();
  await pool.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,type) VALUES($1,$2,$3,'relic','relic:examine','Private source title',$4,'relic'),($5,$2,$3,'exchange','receipt','Private receipt title','Receipt body','exchange_receipt')", [reading, event.id, characters.one.id, sourceSecret, receipt]);
  const definition = { ...defaultAdventure(), nodes: [defaultAdventureNode('relic', 'relic', 'AAAAAAAAAAAAAAAAAAAA')] };
  await pool.query('INSERT INTO event_adventures(event_id,definition) VALUES($1,$2)', [event.id, JSON.stringify(definition)]);
  await pool.query("INSERT INTO event_sharing_settings(event_id,policies) VALUES($1,'{\"relic\":\"shareable\"}')", [event.id]);
  return { event, setup, characters, factions, groups, reading, receipt };
}
async function shareSource(f) {
  const path = `/api/events/${f.event.id}/exchanges`;
  let exchange = ok(await request(path, 'POST', mutation(f), users.one), 201).exchange;
  exchange = ok(await request(`${path}/join`, 'POST', mutation(f, 'two', { code: exchange.code }), users.two)).exchange;
  exchange = ok(await request(`${path}/${exchange.id}/offer`, 'PUT', mutation(f, 'one', { version: exchange.version, readingIds: [f.reading] }), users.one)).exchange;
  exchange = ok(await request(`${path}/${exchange.id}/confirm`, 'POST', mutation(f, 'one', { version: exchange.version }), users.one)).exchange;
  exchange = ok(await request(`${path}/${exchange.id}/confirm`, 'POST', mutation(f, 'two', { version: exchange.version }), users.two)).exchange;
  return exchange.receipt.received[0].id;
}
function noPrivate(value) { const serialized = JSON.stringify(value); for (const denied of [privateNote, sourceSecret, 'PRIVATE character objective', 'password_hash', 'owner_user_id', users.one.email]) assert.ok(!serialized.includes(denied), `Private data leaked: ${denied}`); }
before(async () => {
  database = await testDatabase(); pool = database.pool; await migrate(pool);
  let handler; server = createServer((req, res) => handler(req, res)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  handler = createApp({ pool, config: { ...readConfig({ DATABASE_URL: 'postgres://unused', PORT: '3000' }), origin }, logger: entry => console.error(entry) });
  for (const name of ['owner', 'one', 'two', 'third', 'outsider']) { const result = await request('/api/auth/register', 'POST', { displayName: `TRACE ${name}`, email: `${name}@trace.example.test`, password }, null); users[name] = { ...ok(result, 201).user, cookie: result.cookie }; }
  console.log(`TRACE integration database: ${database.kind}`);
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); if (database) await database.close(); });

test('TRACE defaults are private and strict requests cannot assert truth or forge source content', () => {
  assert.deepEqual(defaultTraceDocument().audience, { type: 'private', ids: [] });
  const payload = { requestId: randomUUID(), characterId: randomUUID(), document: document() };
  assert.deepEqual(validateTraceRequest(payload, 'create'), payload);
  for (const action of ['constructor', '__proto__', 'toString']) assert.throws(() => validateTraceRequest(payload, action), { status: 400 });
  for (const change of [p => { p.document.truth = 'verified'; }, p => { p.document.verified = true; }, p => { p.document.notes = '<script>'; }, p => { p.document.sources = [randomUUID(), 'foreign']; }, p => { p.document.sources = [payload.characterId, payload.characterId]; }, p => { p.document.links = [{ recordId: payload.characterId, label: '', notes: 'forged' }]; }, p => { p.document.audience = { type: 'public', ids: [payload.characterId] }; }, p => { p.document.notes = 'x'.repeat(6001); }, p => { p.document.sources = new Array(2); }]) {
    const copy = structuredClone(payload); change(copy); assert.throws(() => validateTraceRequest(copy, 'create'), { status: 400 });
  }
  const getter = structuredClone(payload); Object.defineProperty(getter.document, 'notes', { get() { throw new Error('must not execute'); }, enumerable: true }); assert.throws(() => validateTraceRequest(getter, 'create'), { status: 400 });
});

test('private theories are owner-only even for event organizers and superusers', async () => {
  const f = await fixture(), record = await create(f, { kind: 'theory' });
  assert.equal(record.isOwner, true); assert.equal(record.notes, privateNote); assert.equal((await view(f)).records[0].id, record.id);
  for (const name of ['two', 'third', 'owner']) { const response = await view(f, name); assert.deepEqual(response.records, []); noPrivate(response); }
  await pool.query('UPDATE users SET is_superuser=true WHERE id=$1', [users.owner.id]);
  try { assert.deepEqual((await view(f, 'owner')).records, []); assert.equal((await request(`${base(f)}?characterId=${f.characters.one.id}`, 'GET')).status, 404); }
  finally { await pool.query('UPDATE users SET is_superuser=false WHERE id=$1', [users.owner.id]); }
  assert.equal((await request(base(f), 'GET', undefined, users.outsider)).status, 404);
  assert.equal((await request(`${base(f)}/${record.id}`, 'PUT', mutation(f, 'two', { version: record.version, document: document() }), users.two)).status, 404);
  const audit = (await pool.query('SELECT details FROM audit_entries WHERE event_id=$1', [f.event.id])).rows; noPrivate(audit);
});

test('all explicit audiences honor current faction and group membership without hidden group metadata', async () => {
  const f = await fixture();
  let record = await create(f, { audience: { type: 'private', ids: [f.characters.two.id] } });
  assert.equal((await view(f, 'two')).records[0].id, record.id); assert.deepEqual((await view(f, 'third')).records, []);
  record = await update(f, record, { audience: { type: 'faction', ids: [f.factions.first] } });
  assert.equal((await view(f, 'two')).records.length, 1); assert.equal((await view(f, 'third')).records.length, 0);
  await pool.query("UPDATE characters SET profile=jsonb_set(profile,'{factionId}',to_jsonb($2::text)) WHERE id=$1", [f.characters.two.id, f.factions.second]);
  assert.deepEqual((await view(f, 'two')).records, []);
  record = await update(f, record, { audience: { type: 'group', ids: [f.groups.visible] } });
  assert.equal((await view(f, 'two')).records.length, 1); assert.equal((await view(f, 'third')).records.length, 0);
  const own = await view(f); assert.deepEqual(own.audiences.groups, [{ id: f.groups.visible, name: 'Lantern group' }]); assert.ok(!JSON.stringify(own).includes(f.groups.hidden));
  assert.ok(own.audiences.characters.every(character => Object.keys(character).sort().join(',') === 'id,name'));
  await pool.query("UPDATE story_groups SET character_ids='[]' WHERE id=$1", [f.groups.visible]);
  assert.deepEqual((await view(f, 'two')).records, []); assert.equal((await view(f)).records.length, 1);
  const denied = await request(base(f), 'POST', mutation(f, 'one', { document: document({ audience: { type: 'group', ids: [f.groups.hidden] } }) }), users.one);
  const absent = await request(base(f), 'POST', mutation(f, 'one', { document: document({ audience: { type: 'group', ids: [randomUUID()] } }) }), users.one);
  assert.equal(denied.status, 400); assert.equal(absent.status, 400); assert.equal(denied.data.error, absent.data.error);
  const unavailableRecipient = async id => request(base(f), 'POST', mutation(f, 'one', { document: document({ audience: { type: 'private', ids: [id] } }) }), users.one);
  const unknownRecipient = await unavailableRecipient(randomUUID()); assert.equal(unknownRecipient.status, 400);
  for (const status of ['draft', 'retired']) {
    await pool.query('UPDATE characters SET status=$2 WHERE id=$1', [f.characters.third.id, status]);
    const hidden = await unavailableRecipient(f.characters.third.id); assert.equal(hidden.status, 400); assert.equal(hidden.data.error, unknownRecipient.data.error);
  }
  await pool.query("UPDATE characters SET status='approved',user_id=NULL WHERE id=$1", [f.characters.third.id]);
  const unassigned = await unavailableRecipient(f.characters.third.id); assert.equal(unassigned.status, 400); assert.equal(unassigned.data.error, unknownRecipient.data.error);
  await pool.query('UPDATE characters SET user_id=$2 WHERE id=$1', [f.characters.third.id, users.third.id]);
  record = await update(f, record, { audience: { type: 'public', ids: [] } });
  for (const name of ['two', 'third', 'owner']) { const shared = (await view(f, name)).records[0]; assert.equal(shared.id, record.id); assert.equal(shared.audience, undefined); assert.equal(shared.isOwner, false); }
});

test('sources disclose only viewer-owned canonical readings and never automatically copy source text', async () => {
  const f = await fixture();
  const record = await create(f, { notes: 'I suspect the gate matters.', audience: { type: 'public', ids: [] }, sources: [f.reading] });
  assert.deepEqual(record.sources, [{ id: f.reading, title: 'Private source title', type: 'relic' }]); assert.ok(!JSON.stringify(record).includes(sourceSecret));
  let shared = (await view(f, 'two')).records[0]; assert.deepEqual(shared.sources, []); assert.ok(!JSON.stringify(shared).includes(f.reading)); assert.ok(!JSON.stringify(shared).includes('Private source title'));
  const copiedId = await shareSource(f); shared = (await view(f, 'two')).records[0];
  assert.deepEqual(shared.sources, [{ id: copiedId, title: 'Private source title', type: 'shared_reading' }]); assert.notEqual(copiedId, f.reading); assert.ok(!JSON.stringify(shared).includes(f.reading)); assert.ok(!JSON.stringify(shared).includes(sourceSecret));
  assert.deepEqual((await view(f, 'third')).records[0].sources, []);
  assert.ok((await view(f)).sources.every(source => source.id !== f.receipt));
  for (const [name, source] of [['two', f.reading], ['one', f.receipt]]) assert.equal((await request(base(f), 'POST', mutation(f, name, { document: document({ sources: [source] }) }), users[name])).status, 404);
  const other = await fixture(); assert.equal((await request(base(f), 'POST', mutation(f, 'one', { document: document({ sources: [other.reading] }) }), users.one)).status, 404);
});

test('links hide private destination identifiers and labels after audience changes or archive', async () => {
  const f = await fixture(); let destination = await create(f, { title: 'Hidden destination', notes: 'Private destination text' });
  const record = await create(f, { title: 'Public observation', notes: 'I saw a lantern.', audience: { type: 'public', ids: [] }, links: [{ recordId: destination.id, label: 'PRIVATE link label' }] });
  assert.equal(record.links[0].title, 'Hidden destination');
  let visible = (await view(f, 'two')).records.find(row => row.id === record.id); assert.deepEqual(visible.links, []); assert.ok(!JSON.stringify(visible).includes(destination.id)); assert.ok(!JSON.stringify(visible).includes('PRIVATE link label'));
  destination = await update(f, destination, { audience: { type: 'private', ids: [f.characters.two.id] } });
  assert.deepEqual((await view(f, 'two')).records.find(row => row.id === record.id).links, [{ recordId: destination.id, label: 'PRIVATE link label', title: 'Hidden destination' }]);
  destination = await update(f, destination, { audience: { type: 'private', ids: [] } }); assert.deepEqual((await view(f, 'two')).records.find(row => row.id === record.id).links, []);
  assert.equal((await request(`${base(f)}/${record.id}`, 'PUT', mutation(f, 'one', { version: record.version, document: document({ links: [{ recordId: record.id, label: 'Self' }] }) }), users.one)).status, 400);
  assert.equal((await request(base(f), 'POST', mutation(f, 'two', { document: document({ links: [{ recordId: destination.id, label: 'Guess' }] }) }), users.two)).status, 404);
  ok(await request(`${base(f)}/${destination.id}/archive`, 'POST', mutation(f, 'one', { version: destination.version }), users.one));
  assert.deepEqual((await view(f)).records.find(row => row.id === record.id).links, []);
});

test('reassigned characters cannot expose prior account WHISPER originals or copies through TRACE', async () => {
  const f = await fixture(), ordinaryReading = f.reading, storyPath = `/api/events/${f.event.id}/story`;
  const rumor = { ...defaultStoryDocument(), title: 'ACCOUNT BOUND rumor title', body: 'ACCOUNT BOUND rumor body', truth: 'ORGANIZER truth', shareable: true };
  let entry = ok(await request(`${storyPath}/entries`, 'POST', { requestId: randomUUID(), kind: 'rumor', document: rumor }), 201).entry;
  entry = ok(await request(`${storyPath}/entries/${entry.id}/publish`, 'POST', { requestId: randomUUID(), version: entry.version })).entry;
  const reading = ok(await request(`${storyPath}/collect`, 'POST', mutation(f, 'one', { entryId: entry.id, publicationVersion: entry.publishedVersion }), users.one)).reading;
  f.reading = reading.id;
  const note = await create(f, { notes: 'Investigate the witness account.', audience: { type: 'public', ids: [] }, sources: [reading.id] });
  const copy = await shareSource(f);
  assert.equal((await view(f, 'two')).records.find(row => row.id === note.id).sources[0].id, copy);
  await pool.query('UPDATE characters SET user_id=$2 WHERE id=$1', [f.characters.two.id, users.third.id]);
  let reassigned = ok(await request(`${base(f)}?characterId=${f.characters.two.id}`, 'GET', undefined, users.third));
  assert.deepEqual(reassigned.records.find(row => row.id === note.id).sources, []);
  assert.ok(!reassigned.sources.some(row => row.id === copy)); assert.ok(!JSON.stringify(reassigned).includes('ACCOUNT BOUND'));
  assert.equal((await request(base(f), 'POST', { requestId: randomUUID(), characterId: f.characters.two.id, document: document({ sources: [copy] }) }, users.third)).status, 404);
  await pool.query('UPDATE characters SET user_id=$2 WHERE id=$1', [f.characters.one.id, users.third.id]);
  reassigned = ok(await request(`${base(f)}?characterId=${f.characters.one.id}`, 'GET', undefined, users.third));
  assert.deepEqual(reassigned.records, []); assert.ok(!reassigned.sources.some(row => row.id === reading.id)); assert.ok(!JSON.stringify(reassigned).includes('ACCOUNT BOUND'));
  assert.ok(reassigned.sources.some(row => row.id === ordinaryReading), 'Ordinary prop journal ownership keeps its established character behavior.');
  assert.equal((await request(base(f), 'POST', { requestId: randomUUID(), characterId: f.characters.one.id, document: document({ sources: [reading.id] }) }, users.third)).status, 404);
});

test('versions, exact retries, and archive reconcile current state without duplicate records', async () => {
  const f = await fixture(), payload = mutation(f, 'one', { document: document() });
  let record = ok(await request(base(f), 'POST', payload, users.one), 201).record;
  record = await update(f, record, { notes: 'Newer notes' });
  const replay = ok(await request(base(f), 'POST', payload, users.one)); assert.equal(replay.outcome.replayed, true); assert.equal(replay.record.notes, 'Newer notes'); assert.equal(replay.record.version, 2);
  assert.equal((await request(base(f), 'POST', { ...payload, document: document({ notes: 'Changed request' }) }, users.one)).status, 409);
  assert.equal((await request(`${base(f)}/${record.id}`, 'PUT', mutation(f, 'one', { version: 1, document: document() }), users.one)).status, 409);
  const archive = mutation(f, 'one', { version: record.version });
  const archived = ok(await request(`${base(f)}/${record.id}/archive`, 'POST', archive, users.one)).record;
  assert.equal(archived.archived, true); assert.equal(archived.version, 3); assert.deepEqual((await view(f)).records, []);
  assert.equal(ok(await request(`${base(f)}/${record.id}/archive`, 'POST', archive, users.one)).outcome.replayed, true);
  assert.equal(ok(await request(base(f), 'POST', payload, users.one)).record.archived, true);
  assert.equal((await request(`${base(f)}/${record.id}`, 'PUT', mutation(f, 'one', { version: archived.version, document: document() }), users.one)).status, 404);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM trace_records WHERE event_id=$1', [f.event.id])).rows[0].count, 1);
});

test('owner approval, membership, enabled status and assignment are reevaluated for shared records and retries', async () => {
  const f = await fixture(), payload = mutation(f, 'one', { document: document({ audience: { type: 'public', ids: [] } }) });
  const record = ok(await request(base(f), 'POST', payload, users.one), 201).record;
  await pool.query("UPDATE characters SET status='pending' WHERE id=$1", [f.characters.one.id]); assert.deepEqual((await view(f, 'two')).records, []); assert.equal((await request(base(f), 'POST', payload, users.one)).status, 404);
  await pool.query("UPDATE characters SET status='approved' WHERE id=$1", [f.characters.one.id]);
  await pool.query('DELETE FROM memberships WHERE event_id=$1 AND user_id=$2', [f.event.id, users.one.id]); assert.deepEqual((await view(f, 'two')).records, []);
  await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'player')", [f.event.id, users.one.id]);
  await pool.query('UPDATE users SET is_disabled=true WHERE id=$1', [users.one.id]); assert.deepEqual((await view(f, 'two')).records, []);
  await pool.query('UPDATE users SET is_disabled=false WHERE id=$1', [users.one.id]); assert.equal((await view(f, 'two')).records.length, 1);
  await pool.query('UPDATE characters SET user_id=$2 WHERE id=$1', [f.characters.one.id, users.third.id]);
  assert.deepEqual((await view(f, 'two')).records, []);
  const lost = await request(base(f), 'POST', payload, users.one); assert.equal(lost.status, 404); assert.equal(lost.data.error, 'Character not found or not assigned to you.');
  assert.deepEqual(ok(await request(`${base(f)}?characterId=${f.characters.one.id}`, 'GET', undefined, users.third)).records, []);
  assert.equal((await request(`${base(f)}/${record.id}/archive`, 'POST', { requestId: randomUUID(), characterId: f.characters.one.id, version: record.version }, users.third)).status, 404);
});

test('paused or disabled instruments preserve safe read-only behavior and never change adventure state', async () => {
  const f = await fixture();
  const before = (await pool.query('SELECT * FROM adventure_runs WHERE event_id=$1 ORDER BY character_id', [f.event.id])).rows;
  const journal = (await pool.query('SELECT * FROM adventure_journal WHERE event_id=$1 ORDER BY id', [f.event.id])).rows;
  const record = await create(f); await pool.query("UPDATE events SET status='paused' WHERE id=$1", [f.event.id]);
  const paused = await view(f); assert.equal(paused.readOnly, true); assert.equal(paused.records[0].id, record.id);
  assert.equal((await request(base(f), 'POST', mutation(f, 'one', { document: document() }), users.one)).status, 409);
  await pool.query("UPDATE events SET setup=jsonb_set(setup,'{enabledInstruments}','[\"briefing\"]'::jsonb) WHERE id=$1", [f.event.id]);
  const disabled = await view(f); assert.equal(disabled.readOnly, true); assert.deepEqual(disabled.records, []); assert.deepEqual(disabled.sources, []);
  assert.equal((await request(`${base(f)}/${record.id}/archive`, 'POST', mutation(f, 'one', { version: record.version }), users.one)).status, 403);
  assert.deepEqual((await pool.query('SELECT * FROM adventure_runs WHERE event_id=$1 ORDER BY character_id', [f.event.id])).rows, before);
  assert.deepEqual((await pool.query('SELECT * FROM adventure_journal WHERE event_id=$1 ORDER BY id', [f.event.id])).rows, journal);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM character_inventory WHERE event_id=$1', [f.event.id])).rows[0].count, 0);
});

test('concurrent create retries and competing versioned edits serialize atomically', async () => {
  const f = await fixture(), payload = mutation(f, 'one', { document: document() });
  const created = await Promise.all([request(base(f), 'POST', payload, users.one), request(base(f), 'POST', payload, users.one)]);
  assert.deepEqual(created.map(row => row.status).sort(), [200, 201]); assert.equal(created[0].data.record.id, created[1].data.record.id);
  const record = created[0].data.record;
  const edited = await Promise.all(['First', 'Second'].map(notes => request(`${base(f)}/${record.id}`, 'PUT', mutation(f, 'one', { version: record.version, document: document({ notes }) }), users.one)));
  assert.deepEqual(edited.map(row => row.status).sort(), [200, 409]); assert.equal((await view(f)).records[0].version, 2);
});

test('request history remains bounded without expiring a create identity into duplicate creation', async () => {
  const f = await fixture(), payload = mutation(f, 'one', { document: document() });
  let record = ok(await request(base(f), 'POST', payload, users.one), 201).record;
  record = await update(f, record, { notes: 'Newest bounded-history notes' });
  await pool.query("INSERT INTO trace_requests(event_id,actor_user_id,request_id,payload_hash,record_id) SELECT $1,$2,gen_random_uuid(),'fixture',$3 FROM generate_series(1,19998)", [f.event.id, users.one.id, record.id]);
  assert.equal((await request(base(f), 'POST', mutation(f, 'one', { document: document() }), users.one)).status, 429);
  const replay = ok(await request(base(f), 'POST', payload, users.one)); assert.equal(replay.outcome.replayed, true); assert.equal(replay.record.id, record.id); assert.equal(replay.record.notes, 'Newest bounded-history notes');
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM trace_records WHERE event_id=$1', [f.event.id])).rows[0].count, 1);
});
