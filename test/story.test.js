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
import { defaultStoryDocument, normalizeStoryAudience, validateStoryConditions } from '../public/story-model.js';
import { canShareWhisper, filterStoryJournal, copyStory, resetStory } from '../src/story.js';
let database, pool, server, origin;
const users = {};
async function request(path, method = 'GET', data, who = users.owner) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...(who?.cookie ? { Cookie: who.cookie } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.data)); return res.data; };
const path = (f, suffix = 'play') => `/api/events/${f.event.id}/story/${suffix}`;
const reqId = () => ({ requestId: randomUUID() });
const document = (extra = {}) => ({ ...defaultStoryDocument(), title: 'Uncertain witness', body: 'The courier left through the east gate.', truth: 'ORGANIZER_ONLY_SECRET', topic: 'HIDDEN_TOPIC', sourceLabel: 'A witness', ...extra });
async function fixture() {
  const setup = defaultSetup('fantasy'); setup.rules.expertise = [{ id: 'investigation', name: 'Investigation' }]; setup.enabledInstruments = ['briefing', 'whisper', 'broadside', 'trace', 'relic'];
  const event = ok(await request('/api/events', 'POST', { name: 'Story integration', setup }), 201).event;
  const characters = {};
  for (const name of ['one', 'two', 'staff']) {
    await pool.query('INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,$3)', [event.id, users[name].id, name === 'staff' ? 'staff' : 'player']);
    if (name === 'staff') continue;
    const profile = { ...defaultCharacterProfile(setup.rules), name: `Story ${name}` };
    characters[name] = ok(await request(`/api/events/${event.id}/characters`, 'POST', { profile }, users[name]), 201).character;
    await pool.query("UPDATE characters SET status='approved',inventory_initialized=true WHERE id=$1", [characters[name].id]);
  }
  const node = defaultAdventureNode('relic', 'proof', 'AAAAAAAAAAAAAAAAAAAA');
  const definition = { ...defaultAdventure(), flags: [{ id: 'discovered', name: 'Discovered' }], nodes: [node] };
  ok(await request(`/api/events/${event.id}/adventure/manage`, 'PUT', { version: 0, definition }));
  await pool.query("UPDATE events SET status='rehearsal' WHERE id=$1", [event.id]);
  return { event: { ...event, status: 'rehearsal', setup }, characters, definition };
}
async function create(f, extra = {}, kind = 'rumor', who = users.owner) { return ok(await request(path(f, 'entries'), 'POST', { ...reqId(), kind, document: document(extra) }, who), 201).entry; }
async function publish(f, entry, who = users.owner) { return ok(await request(path(f, `entries/${entry.id}/publish`), 'POST', { ...reqId(), version: entry.version }, who)).entry; }
async function update(f, entry, extra) { return ok(await request(path(f, `entries/${entry.id}`), 'PUT', { ...reqId(), version: entry.version, document: { ...entry.document, ...extra } })).entry; }
const collectInput = (f, entry, who = 'one') => ({ ...reqId(), characterId: f.characters[who].id, entryId: entry.id, publicationVersion: entry.publishedVersion });
const play = async (f, who = 'one') => ok(await request(path(f), 'GET', undefined, users[who]));
before(async () => {
  database = await testDatabase(); pool = database.pool; await migrate(pool);
  let handler; server = createServer((req, res) => handler(req, res)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  handler = createApp({ pool, config: { ...readConfig({ DATABASE_URL: 'postgres://unused', PORT: '3000' }), origin }, logger: entry => console.error(entry) });
  for (const name of ['owner', 'one', 'two', 'staff', 'outsider']) { const response = await request('/api/auth/register', 'POST', { displayName: `Story ${name}`, email: `${name}@story.example.test`, password: 'Story integration passphrase!' }, null); users[name] = { ...ok(response, 201).user, cookie: response.cookie }; }
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); if (database) await database.close(); });

test('audience and condition validators reject inherited, executable, duplicate, unknown and oversized data', () => {
  assert.throws(() => normalizeStoryAudience(Object.create({ type: 'public', ids: [] })));
  assert.throws(() => normalizeStoryAudience({ type: 'constructor', ids: [] }));
  assert.throws(() => normalizeStoryAudience({ type: 'public', ids: [randomUUID()] }));
  const id = randomUUID(); assert.throws(() => normalizeStoryAudience({ type: 'private', ids: [id, id] }));
  assert.throws(() => normalizeStoryAudience({ type: 'private', ids: Array.from({ length: 21 }, randomUUID) }));
  let ran = false; const value = { ids: [] }; Object.defineProperty(value, 'type', { enumerable: true, get() { ran = true; return 'public'; } }); assert.throws(() => normalizeStoryAudience(value)); assert.equal(ran, false);
  assert.deepEqual(normalizeStoryAudience({ type: 'private', ids: [id.toUpperCase()] }), { type: 'private', ids: [id] });
  assert.throws(() => validateStoryConditions({ completed: ['unknown'], flags: [], skills: [], statuses: [] }));
});

test('staff author and submit, organizer publishes, and player routes never expose truth or unpublished bodies', async () => {
  const f = await fixture(); let entry = await create(f, {}, 'rumor', users.staff);
  assert.equal((await request(path(f, 'manage'), 'GET', undefined, users.one)).status, 403);
  assert.equal((await request(path(f, 'manage'), 'GET', undefined, users.outsider)).status, 404);
  assert.equal((await request(path(f, 'entries'), 'POST', { ...reqId(), kind: 'rumor', document: document() }, users.one)).status, 403);
  assert.equal((await request(path(f, `entries/${entry.id}/publish`), 'POST', { ...reqId(), version: entry.version }, users.staff)).status, 403);
  assert.equal((await play(f)).rumors.length, 0);
  entry = ok(await request(path(f, `entries/${entry.id}/submit`), 'POST', { ...reqId(), version: entry.version }, users.staff)).entry;
  assert.equal(entry.status, 'submitted'); entry = await publish(f, entry);
  const visible = await play(f); assert.equal(visible.rumors.length, 1);
  for (const secret of ['ORGANIZER_ONLY_SECRET', 'HIDDEN_TOPIC', document().body, 'conditions', 'privateObjectives', users.one.id, users.one.email]) assert.ok(!JSON.stringify(visible).includes(secret), secret);
  const collected = ok(await request(path(f, 'collect'), 'POST', collectInput(f, entry), users.one)); assert.match(collected.reading.text, /Unverified account/); assert.match(collected.reading.text, /east gate/); assert.ok(!JSON.stringify(collected).includes('ORGANIZER_ONLY_SECRET'));
  assert.equal(ok(await request(path(f, 'manage'))).entries[0].document.truth, 'ORGANIZER_ONLY_SECRET');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM adventure_runs WHERE event_id=$1', [f.event.id])).rows[0].n, 0);
});

test('private, faction and group audiences enforce current membership without hidden IDs or counts', async () => {
  const f = await fixture(); const factionId = randomUUID(); await pool.query("INSERT INTO factions(id,event_id,name) VALUES($1,$2,'Witnesses')", [factionId, f.event.id]);
  await pool.query("UPDATE characters SET profile=jsonb_set(profile,'{factionId}',$2::jsonb) WHERE id=$1", [f.characters.one.id, JSON.stringify(factionId)]);
  const group = ok(await request(path(f, 'groups'), 'POST', { ...reqId(), name: 'Inner circle', characterIds: [f.characters.one.id] }), 201).group;
  const entries = [];
  for (const audience of [{ type: 'private', ids: [f.characters.one.id] }, { type: 'faction', ids: [factionId] }, { type: 'group', ids: [group.id] }]) entries.push(await publish(f, await create(f, { audience })));
  assert.equal((await play(f)).rumors.length, 3); const other = await play(f, 'two'); assert.equal(other.rumors.length, 0); assert.equal(other.audiences.groups.length, 0);
  for (const entry of entries) { assert.ok(!JSON.stringify(other).includes(entry.id)); assert.equal((await request(path(f, 'collect'), 'POST', collectInput(f, entry, 'two'), users.two)).status, 404); }
  ok(await request(path(f, `groups/${group.id}`), 'PUT', { ...reqId(), version: group.version, name: group.name, characterIds: [] }));
  await pool.query("UPDATE characters SET profile=jsonb_set(profile,'{factionId}','null'::jsonb) WHERE id=$1", [f.characters.one.id]);
  assert.equal((await play(f)).rumors.length, 1);
  assert.equal((await request(path(f, `play?characterId=${f.characters.one.id}`))).status, 404, 'Organizer cannot proxy a player character');
  await pool.query('UPDATE users SET is_disabled=true WHERE id=$1', [users.one.id]);
  assert.equal((await request(path(f), 'GET', undefined, users.one)).status, 401);
  assert.ok(!(await play(f, 'two')).audiences.characters.some(row => row.id === f.characters.one.id));
  await pool.query('UPDATE users SET is_disabled=false WHERE id=$1', [users.one.id]);
  await pool.query('DELETE FROM memberships WHERE event_id=$1 AND user_id=$2', [f.event.id, users.one.id]); assert.equal((await request(path(f), 'GET', undefined, users.one)).status, 404);
});

test('draft edits remain separate until correction publication, withdraw blocks fresh reads and exact collection retries', async () => {
  const f = await fixture(); let entry = await publish(f, await create(f, { shareable: true })); const input = collectInput(f, entry);
  const original = ok(await request(path(f, 'collect'), 'POST', input, users.one)).reading;
  entry = await update(f, entry, { body: 'Corrected account: the west gate.' });
  assert.equal(entry.hasPublication, true); assert.equal(entry.status, 'draft'); assert.equal((await play(f, 'two')).rumors[0].publicationVersion, 1);
  assert.equal((await request(path(f, `entries/${entry.id}/publish`), 'POST', { ...reqId(), version: entry.version })).status, 400);
  entry = await update(f, entry, { correctionNote: 'The witness corrected the gate.' }); entry = await publish(f, entry);
  assert.equal(entry.publishedVersion, 2); assert.equal((await request(path(f, 'collect'), 'POST', input, users.one)).status, 409);
  const corrected = ok(await request(path(f, 'collect'), 'POST', collectInput(f, entry), users.one)).reading; assert.match(corrected.text, /west gate/); assert.match(corrected.text, /Correction:/);
  assert.deepEqual((await play(f)).readings.map(row => row.id), [original.id, corrected.id]);
  assert.equal(await canShareWhisper(pool, f.event, `whisper:${entry.id}`), true);
  entry = ok(await request(path(f, `entries/${entry.id}/withdraw`), 'POST', { ...reqId(), version: entry.version })).entry;
  assert.equal((await play(f)).rumors.length, 0); assert.equal((await play(f)).readings.length, 2); assert.equal((await request(path(f, 'collect'), 'POST', { ...input, publicationVersion: 2 }, users.one)).status, 409);
  assert.equal((await request(path(f, 'collect'), 'POST', collectInput(f, entry), users.one)).status, 404); assert.equal(await canShareWhisper(pool, f.event, `whisper:${entry.id}`), false);
});

test('current conditions gate discovery and fail closed when adventure references disappear', async () => {
  const f = await fixture(), skill = f.event.setup.rules.expertise[0].id;
  const entry = await publish(f, await create(f, { conditions: { completed: ['proof'], flags: ['discovered'], skills: [skill], statuses: ['rehearsal'] } }));
  assert.equal((await play(f)).rumors.length, 0);
  await pool.query("UPDATE characters SET profile=jsonb_set(profile,'{skills}',$2::jsonb) WHERE id=$1", [f.characters.one.id, JSON.stringify([skill])]);
  await pool.query('INSERT INTO adventure_runs(event_id,character_id,progress,flags) VALUES($1,$2,$3,$4)', [f.event.id, f.characters.one.id, JSON.stringify({ proof: { completed: true } }), JSON.stringify({ discovered: true })]);
  assert.equal((await play(f)).rumors.length, 1); const before = (await pool.query('SELECT * FROM adventure_runs WHERE event_id=$1', [f.event.id])).rows;
  ok(await request(path(f, 'collect'), 'POST', collectInput(f, entry), users.one)); assert.deepEqual((await pool.query('SELECT * FROM adventure_runs WHERE event_id=$1', [f.event.id])).rows, before);
  await pool.query("UPDATE event_adventures SET definition=jsonb_set(definition,'{flags}','[]'::jsonb) WHERE event_id=$1", [f.event.id]); assert.equal((await play(f)).rumors.length, 0); assert.equal((await request(path(f, 'collect'), 'POST', collectInput(f, entry), users.one)).status, 404);
});

test('idempotent create and collect serialize concurrent requests, reject changed payloads and stale drafts', async () => {
  const f = await fixture(), createInput = { ...reqId(), kind: 'rumor', document: document() };
  const creations = await Promise.all([request(path(f, 'entries'), 'POST', createInput), request(path(f, 'entries'), 'POST', createInput)]); const a = ok(creations[0], 201).entry, b = ok(creations[1], 201).entry; assert.equal(a.id, b.id);
  assert.equal((await request(path(f, 'entries'), 'POST', { ...createInput, document: document({ title: 'Changed' }) })).status, 409);
  const entry = await publish(f, a), input = collectInput(f, entry);
  const collects = await Promise.all([request(path(f, 'collect'), 'POST', input, users.one), request(path(f, 'collect'), 'POST', input, users.one)]); assert.equal(ok(collects[0]).reading.id, ok(collects[1]).reading.id); assert.deepEqual(collects.map(row => row.data.outcome.replayed).sort(), [false, true]);
  assert.equal(ok(await request(path(f, 'collect'), 'POST', { ...input, requestId: randomUUID() }, users.one)).reading.id, collects[0].data.reading.id);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM story_readings WHERE event_id=$1', [f.event.id])).rows[0].n, 1);
  await update(f, entry, { title: 'Current title' }); assert.equal((await request(path(f, `entries/${entry.id}`), 'PUT', { ...reqId(), version: entry.version, document: entry.document })).status, 409);
});

test('player proposals require own source, explicit organizer review and safe acknowledgements after secret edits', async () => {
  const f = await fixture(), rumor = await publish(f, await create(f, { audience: { type: 'private', ids: [f.characters.one.id] } }));
  const reading = ok(await request(path(f, 'collect'), 'POST', collectInput(f, rumor), users.one)).reading;
  const proposal = { ...reqId(), characterId: f.characters.one.id, title: 'Player-authored report', body: 'I think the courier was mistaken.', sourceJournalId: reading.id, audience: { type: 'private', ids: [f.characters.two.id] } };
  const receipt = ok(await request(path(f, 'proposals'), 'POST', proposal, users.one), 201);
  assert.equal((await play(f, 'two')).bulletins.length, 0);
  assert.equal((await request(path(f, 'proposals'), 'POST', { ...proposal, requestId: randomUUID(), characterId: f.characters.two.id }, users.two)).status, 404);
  let entry = ok(await request(path(f, 'manage'))).entries.find(row => row.id === receipt.entry.id); assert.equal(entry.document.truth, ''); assert.equal(entry.document.sourceLabel, 'Player proposal');
  entry = await update(f, entry, { truth: 'SECRET_AFTER_REVIEW', sourceLabel: 'Reviewed dispatch' }); entry = await publish(f, entry);
  const recipient = await play(f, 'two'); assert.equal(recipient.bulletins.length, 1); assert.equal((await play(f)).bulletins.length, 0);
  assert.ok(!JSON.stringify(recipient).includes(reading.id)); assert.ok(!JSON.stringify(recipient).includes('SECRET_AFTER_REVIEW'));
  assert.deepEqual(ok(await request(path(f, 'proposals'), 'POST', proposal, users.one), 201), receipt);
});

test('strict routes and lifecycle reject malformed, archived, foreign-reference and hidden-group requests', async () => {
  const f = await fixture();
  for (const extra of [{ audience: { type: 'private', ids: [randomUUID()] } }, { body: '<script>bad</script>' }, { truth: 'x'.repeat(6001) }, { conditions: { completed: [], skills: [], flags: [], statuses: ['constructor'] } }]) assert.equal((await request(path(f, 'entries'), 'POST', { ...reqId(), kind: 'rumor', document: document(extra) })).status, 400);
  const empty = await create(f, { audience: { type: 'private', ids: [] } }); assert.equal((await request(path(f, `entries/${empty.id}/publish`), 'POST', { ...reqId(), version: empty.version })).status, 400);
  assert.equal((await request(path(f, 'groups'), 'POST', { ...reqId(), name: 'Staff group', characterIds: [] }, users.staff)).status, 403);
  const group = ok(await request(path(f, 'groups'), 'POST', { ...reqId(), name: 'Hidden group', characterIds: [f.characters.two.id] }), 201).group;
  assert.equal((await request(path(f, 'proposals'), 'POST', { ...reqId(), characterId: f.characters.one.id, title: 'Guess group', body: 'Some text', sourceJournalId: null, audience: { type: 'group', ids: [group.id] } }, users.one)).status, 400);
  const entry = await publish(f, await create(f));
  for (const status of ['draft', 'paused', 'ended', 'archived']) { await pool.query('UPDATE events SET status=$2 WHERE id=$1', [f.event.id, status]); assert.equal((await request(path(f, 'collect'), 'POST', collectInput(f, entry), users.one)).status, 409); assert.equal((await play(f)).readOnly, true); }
  assert.equal((await request(path(f, 'entries'), 'POST', { ...reqId(), kind: 'rumor', document: document() })).status, 409);
});

test('account-bound readings stay hidden after reassignment, new owner can explicitly recollect and revoked owner cannot replay', async () => {
  const f = await fixture(), entry = await publish(f, await create(f, { shareable: true })), input = collectInput(f, entry);
  const first = ok(await request(path(f, 'collect'), 'POST', input, users.one)).reading;
  await pool.query('UPDATE characters SET user_id=$2 WHERE id=$1', [f.characters.one.id, users.two.id]);
  assert.equal((await request(path(f, 'collect'), 'POST', input, users.one)).status, 404);
  const before = ok(await request(path(f, `play?characterId=${f.characters.one.id}`), 'GET', undefined, users.two)); assert.equal(before.readings.length, 0);
  assert.deepEqual(await filterStoryJournal(pool, f.event.id, users.two.id, [{ id: first.id, title: first.title }]), []);
  const generalJournal = ok(await request(`/api/events/${f.event.id}/adventure/play?characterId=${f.characters.one.id}`, 'GET', undefined, users.two)); assert.ok(!generalJournal.journal.some(row => row.id === first.id));
  const offers = ok(await request(`/api/events/${f.event.id}/exchanges?characterId=${f.characters.one.id}`, 'GET', undefined, users.two)); assert.ok(!offers.readings.some(row => row.id === first.id));
  const second = ok(await request(path(f, 'collect'), 'POST', { ...input, requestId: randomUUID() }, users.two)).reading; assert.notEqual(second.id, first.id);
  assert.ok(!second.entryKey.includes(users.two.id));
  const after = ok(await request(path(f, `play?characterId=${f.characters.one.id}`), 'GET', undefined, users.two)); assert.deepEqual(after.readings.map(row => row.id), [second.id]);
  await pool.query("UPDATE characters SET status='retired' WHERE id=$1", [f.characters.one.id]); assert.equal((await request(path(f, 'collect'), 'POST', { ...input, requestId: randomUUID() }, users.two)).status, 404);
});

test('publishing and withdrawal clear both outstanding exchange confirmations but draft edits do not', async () => {
  const f = await fixture(), sessionId = randomUUID();
  await pool.query("INSERT INTO exchange_sessions(id,event_id,code,status,version,initiator_user_id,initiator_character_id,recipient_user_id,recipient_character_id,initiator_confirmed_version,recipient_confirmed_version) VALUES($1,$2,'AAAAAAAAAAAA','negotiating',4,$3,$4,$5,$6,4,4)", [sessionId, f.event.id, users.one.id, f.characters.one.id, users.two.id, f.characters.two.id]);
  let entry = await create(f); entry = await update(f, entry, { body: 'Draft edits' }); assert.equal((await pool.query('SELECT version FROM exchange_sessions WHERE id=$1', [sessionId])).rows[0].version, 4);
  entry = await publish(f, entry); let session = (await pool.query('SELECT * FROM exchange_sessions WHERE id=$1', [sessionId])).rows[0]; assert.equal(session.version, 5); assert.equal(session.initiator_confirmed_version, null); assert.equal(session.recipient_confirmed_version, null);
  ok(await request(path(f, `entries/${entry.id}/withdraw`), 'POST', { ...reqId(), version: entry.version })); session = (await pool.query('SELECT * FROM exchange_sessions WHERE id=$1', [sessionId])).rows[0]; assert.equal(session.version, 6);
});

test('rehearsal story copying remaps private and group audiences without copying player readings or exposing empty mappings', async () => {
  const source = await fixture(), target = await fixture(); const group = ok(await request(path(source, 'groups'), 'POST', { ...reqId(), name: 'Source group', characterIds: [source.characters.one.id] }), 201).group;
  const privateEntry = await publish(source, await create(source, { audience: { type: 'private', ids: [source.characters.one.id] } }));
  await publish(source, await create(source, { audience: { type: 'group', ids: [group.id] } })); ok(await request(path(source, 'collect'), 'POST', collectInput(source, privateEntry), users.one));
  await copyStory(pool, source.event, target.event, { characterMap: new Map([[source.characters.one.id, target.characters.one.id]]), factionMap: new Map() }, users.owner.id);
  const copied = ok(await request(path(target, 'manage'))); assert.equal(copied.entries.length, 2); assert.notEqual(copied.groups[0].id, group.id); assert.deepEqual(copied.groups[0].characterIds, [target.characters.one.id]); assert.equal((await play(target)).readings.length, 0); assert.equal((await play(target)).rumors.length, 2); assert.ok(!JSON.stringify(copied).includes(source.characters.one.id));
  const other = await fixture(); await copyStory(pool, source.event, other.event, { characterMap: new Map(), factionMap: new Map() }, users.owner.id); assert.equal((await play(other)).rumors.length, 0);
  await resetStory(pool, source.event.id); assert.equal((await pool.query('SELECT count(*)::int AS n FROM story_readings WHERE event_id=$1', [source.event.id])).rows[0].n, 0); assert.equal(ok(await request(path(source, 'manage'))).entries.length, 2);
});


test('received WHISPER grants survive original departure and require explicit new-account consent after reassignment', async () => {
  const f = await fixture(), entry = await publish(f, await create(f, { shareable: true }));
  const original = ok(await request(path(f, 'collect'), 'POST', collectInput(f, entry), users.one)).reading;
  const sessionId = randomUUID(), copyId = randomUUID();
  await pool.query("INSERT INTO exchange_sessions(id,event_id,code,status,initiator_user_id,initiator_character_id,recipient_user_id,recipient_character_id) VALUES($1,$2,'BBBBBBBBBBBB','completed',$3,$4,$5,$6)", [sessionId, f.event.id, users.one.id, f.characters.one.id, users.two.id, f.characters.two.id]);
  await pool.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,type) VALUES($1,$2,$3,$4,$5,$6,$7,'shared_reading')", [copyId, f.event.id, f.characters.two.id, original.nodeId, `exchange-reading:${original.id}`, original.title, original.text]);
  await pool.query('INSERT INTO exchange_copies(event_id,recipient_character_id,origin_journal_id,journal_id,exchange_id,sender_character_id) VALUES($1,$2,$3,$4,$5,$6)', [f.event.id, f.characters.two.id, original.id, copyId, sessionId, f.characters.one.id]);
  await pool.query('INSERT INTO exchange_receipts(exchange_id,event_id,owner_user_id,owner_character_id,receipt) VALUES($1,$2,$3,$4,$5)', [sessionId, f.event.id, users.two.id, f.characters.two.id, JSON.stringify({ received: [{ id: copyId }] })]);
  assert.deepEqual(await filterStoryJournal(pool, f.event.id, users.two.id, [{ id: copyId }]), [{ id: copyId }]);
  await pool.query('DELETE FROM memberships WHERE event_id=$1 AND user_id=$2', [f.event.id, users.one.id]);
  assert.deepEqual(await filterStoryJournal(pool, f.event.id, users.two.id, [{ id: copyId }]), [{ id: copyId }]);
  await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'player')", [f.event.id, users.outsider.id]);
  await pool.query('UPDATE characters SET user_id=$2 WHERE id=$1', [f.characters.two.id, users.outsider.id]);
  assert.deepEqual(await filterStoryJournal(pool, f.event.id, users.outsider.id, [{ id: copyId }]), []);
  const newSession = randomUUID();
  await pool.query("INSERT INTO exchange_sessions(id,event_id,code,status,initiator_user_id,initiator_character_id,recipient_user_id,recipient_character_id) VALUES($1,$2,'CCCCCCCCCCCC','completed',$3,$4,$5,$6)", [newSession, f.event.id, users.one.id, f.characters.one.id, users.outsider.id, f.characters.two.id]);
  await pool.query('INSERT INTO exchange_receipts(exchange_id,event_id,owner_user_id,owner_character_id,receipt) VALUES($1,$2,$3,$4,$5)', [newSession, f.event.id, users.outsider.id, f.characters.two.id, JSON.stringify({ received: [{ id: copyId }] })]);
  assert.deepEqual(await filterStoryJournal(pool, f.event.id, users.outsider.id, [{ id: copyId }]), [{ id: copyId }]);
  // A source character can explicitly reacquire its old immutable original via
  // a new receipt; source-user ownership itself is never rewritten.
  await pool.query('UPDATE characters SET user_id=$2 WHERE id=$1', [f.characters.one.id, users.two.id]);
  assert.deepEqual(await filterStoryJournal(pool, f.event.id, users.two.id, [{ id: original.id }]), []);
  const returned = randomUUID();
  await pool.query("INSERT INTO exchange_sessions(id,event_id,code,status,initiator_user_id,initiator_character_id,recipient_user_id,recipient_character_id) VALUES($1,$2,'DDDDDDDDDDDD','completed',$3,$4,$5,$6)", [returned, f.event.id, users.outsider.id, f.characters.two.id, users.two.id, f.characters.one.id]);
  await pool.query('INSERT INTO exchange_receipts(exchange_id,event_id,owner_user_id,owner_character_id,receipt) VALUES($1,$2,$3,$4,$5)', [returned, f.event.id, users.two.id, f.characters.one.id, JSON.stringify({ received: [{ id: original.id }] })]);
  assert.deepEqual(await filterStoryJournal(pool, f.event.id, users.two.id, [{ id: original.id }]), [{ id: original.id }]);
  assert.equal((await pool.query('SELECT owner_user_id FROM story_readings WHERE journal_id=$1', [original.id])).rows[0].owner_user_id, users.one.id);
});


test('trade receipt journal entries remain account-bound after a character is reassigned', async () => {
  const f = await fixture(), sessionId = randomUUID(), journalId = randomUUID();
  await pool.query("INSERT INTO exchange_sessions(id,event_id,code,status,initiator_user_id,initiator_character_id,recipient_user_id,recipient_character_id,expires_at,completed_at) VALUES($1,$2,'ZZZZZZZZZZZZ','completed',$3,$4,$5,$6,clock_timestamp()+interval '15 minutes',clock_timestamp())", [sessionId,f.event.id,users.one.id,f.characters.one.id,users.two.id,f.characters.two.id]);
  await pool.query('INSERT INTO exchange_receipts(exchange_id,event_id,owner_user_id,owner_character_id,receipt) VALUES($1,$2,$3,$4,$5)', [sessionId,f.event.id,users.one.id,f.characters.one.id,JSON.stringify({received:[],assets:{sent:{items:[{name:'Private negotiated item',quantity:1}]}}})]);
  await pool.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,type) VALUES($1,$2,$3,'exchange',$4,'Exchange receipt','Private negotiated item: one unit','exchange_receipt')", [journalId,f.event.id,f.characters.one.id,`exchange-receipt:${sessionId}`]);
  const playPath = `/api/events/${f.event.id}/adventure/play?characterId=${f.characters.one.id}`;
  assert.ok(ok(await request(playPath,'GET',undefined,users.one)).journal.some(row => row.id === journalId));
  await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'player')", [f.event.id,users.outsider.id]);
  await pool.query('UPDATE characters SET user_id=$2 WHERE id=$1', [f.characters.one.id,users.outsider.id]);
  const inherited = ok(await request(playPath,'GET',undefined,users.outsider));
  assert.ok(!inherited.journal.some(row => row.id === journalId));
  assert.ok(!JSON.stringify(inherited).includes('Private negotiated item'));
  assert.equal((await request(playPath,'GET',undefined,users.one)).status,404);
  assert.equal((await pool.query('SELECT text FROM adventure_journal WHERE id=$1',[journalId])).rows[0].text,'Private negotiated item: one unit');
});
