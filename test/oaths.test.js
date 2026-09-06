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
import { validateOathRequest } from '../public/oath-model.js';
let database, pool, server, origin;
const users = {};
async function request(path, method = 'GET', data, who = users.owner) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...(who?.cookie ? { Cookie: who.cookie } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  const text = await response.text(); return { status: response.status, data: text ? JSON.parse(text) : null, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
function ok(result, status = 200) { assert.equal(result.status, status, JSON.stringify(result.data)); return result.data; }
const base = f => `/api/events/${f.event.id}/oaths`;
const command = (f, who, row, extra = {}) => ({ requestId: randomUUID(), characterId: f.characters[who].id, version: row.version, ...extra });
function proposal(f, extra = {}) { return { requestId: randomUUID(), characterId: f.characters.a.id, title: 'Escort the caravan', terms: 'PRIVATE AGREEMENT: deliver the sealed parcel to the old gate.', participantIds: [f.characters.a.id, f.characters.b.id], witnessIds: [f.characters.witness.id], expiresAt: null, settlement: [], ...extra }; }
async function create(f, extra = {}) { return ok(await request(base(f), 'POST', proposal(f, extra), users.a), 201).agreement; }
async function act(f, row, action, who, extra = {}) { return ok(await request(`${base(f)}/${row.id}/${action}`, 'POST', command(f, who, row, extra), users[who])).agreement; }
async function view(f, row, who = 'a') { return ok(await request(`${base(f)}/${row.id}?characterId=${f.characters[who].id}`, 'GET', undefined, users[who])).agreement; }
async function active(f, extra = {}) { let row = await create(f, extra); row = await act(f, row, 'accept', 'a'); return act(f, row, 'accept', 'b'); }
async function balances(f) { return (await pool.query('SELECT character_id,resource_id,quantity,version FROM economy_balances WHERE event_id=$1 ORDER BY character_id,resource_id', [f.event.id])).rows; }
async function fixture() {
  const setup = defaultSetup(); setup.enabledInstruments = ['briefing', 'oathbook', 'bazaar'];
  const event = ok(await request('/api/events', 'POST', { name: 'Oath rehearsal', setup }), 201).event;
  await pool.query("UPDATE events SET status='rehearsal' WHERE id=$1", [event.id]);
  const characters = {};
  for (const name of ['a', 'b', 'witness', 'outsider']) {
    await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'player')", [event.id, users[name].id]);
    characters[name] = ok(await request(`/api/events/${event.id}/characters`, 'POST', { profile: { ...defaultCharacterProfile(setup.rules), name: `Oath ${name}`, privateObjectives: 'PRIVATE OBJECTIVE' } }, users[name]), 201).character;
    await pool.query("UPDATE characters SET status='approved',inventory_initialized=true WHERE id=$1", [characters[name].id]);
  }
  await pool.query("INSERT INTO economy_resources(event_id,id,name) VALUES($1,'marks','Caravan marks')", [event.id]);
  for (const name of ['a', 'b']) await pool.query("INSERT INTO economy_balances(event_id,character_id,resource_id,quantity) VALUES($1,$2,'marks',$3)", [event.id, characters[name].id, name === 'a' ? 20 : 0]);
  return { event, characters };
}
before(async () => {
  database = await testDatabase(); pool = database.pool; await migrate(pool);
  let handler; server = createServer((req, res) => handler(req, res)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  handler = createApp({ pool, config: { ...readConfig({ DATABASE_URL: 'postgres://unused', PORT: '3000' }), origin }, logger: entry => console.error(entry) });
  for (const name of ['owner', 'a', 'b', 'witness', 'outsider']) { const result = await request('/api/auth/register', 'POST', { displayName: `Oath ${name}`, email: `${name}@oath.example.test`, password: 'Agreement integration passphrase!' }, null); users[name] = { ...ok(result, 201).user, cookie: result.cookie }; }
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); if (database) await database.close(); });

test('agreement request validation rejects forged fields, prototype actions, sparse arrays and invalid settlements', () => {
  const a = randomUUID(), b = randomUUID(), valid = { requestId: randomUUID(), characterId: a, title: 'A promise', terms: 'Carry the parcel.', participantIds: [a, b], witnessIds: [], expiresAt: null, settlement: [{ fromCharacterId: a, toCharacterId: b, resourceId: 'marks', quantity: 2 }] };
  assert.equal(validateOathRequest(valid, 'create').settlement[0].quantity, 2);
  for (const action of ['__proto__', 'constructor', 'toString']) assert.throws(() => validateOathRequest(valid, action), { status: 400 });
  for (const mutate of [v => { v.accepted = true; }, v => { v.participantIds = [a, a]; }, v => { v.witnessIds = [a]; }, v => { delete v.participantIds[0]; }, v => { v.settlement[0].quantity = '2'; }, v => { v.settlement[0].quantity = -1; }, v => { v.settlement[0].quantity = 0.5; }, v => { v.settlement[0].toCharacterId = a; }, v => { v.settlement.push(v.settlement[0]); }, v => { v.expiresAt = '2027-02-30T00:00:00Z'; }]) { const copy = structuredClone(valid); mutate(copy); assert.throws(() => validateOathRequest(copy, 'create'), { status: 400 }); }
});

test('exact terms require independent participant acceptance; revisions clear every acceptance and witness', async () => {
  const f = await fixture(); let row = await create(f); assert.equal(row.status, 'proposed'); assert.ok(row.participants.every(p => !p.accepted));
  row = await act(f, row, 'accept', 'a'); row = await act(f, row, 'witness', 'witness');
  assert.equal(row.witnesses[0].witnessed, true); assert.equal(row.participants.filter(p => p.accepted).length, 1);
  const unchanged = proposal(f, { version: row.version }); const oldVersion = row.version;
  row = ok(await request(`${base(f)}/${row.id}`, 'PUT', unchanged, users.a)).agreement;
  assert.equal(row.version, oldVersion); assert.equal(row.witnesses[0].witnessed, true);
  const updated = { ...unchanged, requestId: randomUUID(), terms: 'Revised terms: carry the sealed parcel before dawn.' };
  row = ok(await request(`${base(f)}/${row.id}`, 'PUT', updated, users.a)).agreement;
  assert.equal(row.termsVersion, 2); assert.ok(row.participants.every(p => !p.accepted)); assert.ok(row.witnesses.every(p => !p.witnessed));
  const revision = row.history.find(h => h.action === 'revised'); assert.equal(revision.priorSnapshot, undefined); assert.equal(revision.snapshot.terms, updated.terms);
  assert.equal(row.history.find(h => h.action === 'created').snapshot.terms, unchanged.terms);
  const manager = ok(await request(`${base(f)}/${row.id}`)).agreement; assert.equal(manager.history.find(h => h.action === 'revised').priorSnapshot.terms, unchanged.terms);
  assert.ok(row.history.some(h => h.action === 'accepted' && h.termsVersion === 1));
  assert.equal((await request(`${base(f)}/${row.id}/accept`, 'POST', command(f, 'b', { version: oldVersion }), users.b)).status, 409);
  row = await act(f, row, 'accept', 'a'); row = await act(f, row, 'accept', 'b'); assert.equal(row.status, 'active');
  assert.ok(row.participants.every(p => p.acceptedTermsVersion === 2));
});

test('agreements are private to captured participants and witnesses; organizers cannot sign as players', async () => {
  const f = await fixture(), row = await create(f);
  assert.equal((await request(`${base(f)}/${row.id}?characterId=${f.characters.outsider.id}`, 'GET', undefined, users.outsider)).status, 404);
  assert.equal(ok(await request(`${base(f)}?characterId=${f.characters.outsider.id}`, 'GET', undefined, users.outsider)).agreements.length, 0);
  assert.equal((await request(`${base(f)}?manage=true`, 'GET', undefined, users.outsider)).status, 403);
  assert.equal(ok(await request(`${base(f)}?manage=true`)).agreements.length, 1);
  assert.equal((await request(`${base(f)}/${row.id}/accept`, 'POST', command(f, 'a', row), users.owner)).status, 404);
  assert.equal((await request(`${base(f)}/${row.id}/accept`, 'POST', command(f, 'witness', row), users.witness)).status, 403);
  const visible = JSON.stringify(await view(f, row, 'witness'));
  for (const privateValue of ['PRIVATE OBJECTIVE', users.a.id, users.b.id, users.a.email, 'password_hash']) assert.ok(!visible.includes(privateValue));
});

test('resource settlement is atomic, requires every participant, and retries create one immutable receipt', async () => {
  const f = await fixture(); let row = await active(f, { settlement: [{ fromCharacterId: f.characters.a.id, toCharacterId: f.characters.b.id, resourceId: 'marks', quantity: 7 }] });
  const before = await balances(f); row = await act(f, row, 'settle', 'a'); assert.deepEqual(await balances(f), before); assert.equal(row.status, 'active');
  assert.equal((await request(`${base(f)}/${row.id}/settle`, 'POST', command(f, 'witness', row), users.witness)).status, 403);
  const final = command(f, 'b', row); const first = ok(await request(`${base(f)}/${row.id}/settle`, 'POST', final, users.b)); row = first.agreement;
  assert.equal(row.status, 'fulfilled'); assert.equal(row.receipt.kind, 'oath'); assert.equal(row.receipt.transfers[0].resources[0].quantity, 7);
  const duplicate = ok(await request(`${base(f)}/${row.id}/settle`, 'POST', final, users.b)); assert.equal(duplicate.outcome.replayed, true); assert.deepEqual(duplicate.agreement.receipt, row.receipt);
  const after = await balances(f); assert.equal(after.find(b => b.character_id === f.characters.a.id).quantity, 13); assert.equal(after.find(b => b.character_id === f.characters.b.id).quantity, 7);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM economy_transactions WHERE event_id=$1 AND kind='oath'", [f.event.id])).rows[0].n, 1);
  assert.equal((await request(`${base(f)}/${row.id}/settle`, 'POST', { ...final, version: row.version }, users.b)).status, 409);
});

test('failed aggregate settlement rolls back final assent, every balance, history and transaction', async () => {
  const f = await fixture(); let row = await active(f, { witnessIds: [], participantIds: [f.characters.a.id, f.characters.b.id, f.characters.witness.id], settlement: [{ fromCharacterId: f.characters.a.id, toCharacterId: f.characters.b.id, resourceId: 'marks', quantity: 11 }, { fromCharacterId: f.characters.a.id, toCharacterId: f.characters.witness.id, resourceId: 'marks', quantity: 11 }] });
  assert.equal(row.status, 'proposed'); row = await act(f, row, 'accept', 'witness');
  row = await act(f, row, 'settle', 'a'); row = await act(f, row, 'settle', 'b');
  const before = await balances(f), final = command(f, 'witness', row), history = row.history;
  assert.equal((await request(`${base(f)}/${row.id}/settle`, 'POST', final, users.witness)).status, 409);
  assert.deepEqual(await balances(f), before); row = await view(f, row); assert.deepEqual(row.history, history); assert.equal(row.participants.find(p => p.characterId === f.characters.witness.id).settlementConfirmed, false);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM economy_transactions WHERE event_id=$1 AND kind='oath'", [f.event.id])).rows[0].n, 0);
  await pool.query("UPDATE economy_balances SET quantity=22,version=version+1 WHERE event_id=$1 AND character_id=$2 AND resource_id='marks'", [f.event.id, f.characters.a.id]);
  assert.equal(ok(await request(`${base(f)}/${row.id}/settle`, 'POST', final, users.witness)).agreement.status, 'fulfilled');
});

test('disputes preserve settlement and organizer rulings cannot execute a second transfer', async () => {
  const f = await fixture(); let row = await active(f, { settlement: [{ fromCharacterId: f.characters.a.id, toCharacterId: f.characters.b.id, resourceId: 'marks', quantity: 5 }] });
  row = await act(f, row, 'settle', 'a'); row = await act(f, row, 'settle', 'b'); const receipt = row.receipt, money = await balances(f);
  row = await act(f, row, 'dispute', 'a', { reason: 'The parcel seal was damaged.' }); assert.equal(row.status, 'disputed'); assert.deepEqual(await balances(f), money);
  const ruling = { requestId: randomUUID(), version: row.version, outcome: 'fulfilled', reason: 'Witness evidence confirms delivery. Original payment stands.', settle: true };
  assert.equal((await request(`${base(f)}/${row.id}/adjudicate`, 'POST', ruling, users.a)).status, 403);
  row = ok(await request(`${base(f)}/${row.id}/adjudicate`, 'POST', ruling)).agreement;
  assert.equal(row.status, 'adjudicated'); assert.deepEqual(row.receipt, receipt); assert.deepEqual(await balances(f), money);
  assert.equal(row.history.at(-1).reason, ruling.reason); assert.equal(row.history.at(-1).outcome, 'fulfilled');
  assert.ok((await pool.query("SELECT action FROM audit_entries WHERE event_id=$1 AND action='oath.adjudicated'", [f.event.id])).rows.length);
  assert.equal(ok(await request(`${base(f)}/${row.id}/adjudicate`, 'POST', ruling)).outcome.replayed, true);
  assert.equal((await request(`${base(f)}/${row.id}/adjudicate`, 'POST', { ...ruling, requestId: randomUUID(), version: row.version })).status, 409);
});

test('expired agreements block signatures and spending but preserve history for narrative adjudication', async () => {
  const f = await fixture(); let row = await active(f, { settlement: [{ fromCharacterId: f.characters.a.id, toCharacterId: f.characters.b.id, resourceId: 'marks', quantity: 5 }] });
  await pool.query("UPDATE oath_agreements SET expires_at=clock_timestamp()-interval '1 second' WHERE event_id=$1 AND id=$2", [f.event.id, row.id]);
  row = await view(f, row); assert.equal(row.status, 'expired'); assert.equal(row.canSettle, false);
  assert.equal((await request(`${base(f)}/${row.id}/settle`, 'POST', command(f, 'a', row), users.a)).status, 409);
  const ruling = { requestId: randomUUID(), version: row.version, outcome: 'fulfilled', reason: 'Delivery was acknowledged after the deadline.', settle: true }, before = await balances(f);
  assert.equal((await request(`${base(f)}/${row.id}/adjudicate`, 'POST', ruling)).status, 409);
  row = ok(await request(`${base(f)}/${row.id}/adjudicate`, 'POST', { ...ruling, settle: false })).agreement;
  assert.equal(row.status, 'adjudicated'); assert.equal(row.receipt, null); assert.deepEqual(await balances(f), before);
  assert.equal((await request(base(f), 'POST', proposal(f, { expiresAt: new Date(Date.now() - 10000).toISOString() }), users.a)).status, 400);
});

test('reassignment blocks old and new owners, leaves peer evidence and prevents retry access', async () => {
  const f = await fixture(), creation = proposal(f); let row = ok(await request(base(f), 'POST', creation, users.a), 201).agreement;
  await pool.query('UPDATE characters SET user_id=$3,version=version+1 WHERE event_id=$1 AND id=$2', [f.event.id, f.characters.a.id, users.outsider.id]);
  assert.equal((await request(`${base(f)}/${row.id}?characterId=${f.characters.a.id}`, 'GET', undefined, users.a)).status, 404);
  assert.equal((await request(`${base(f)}/${row.id}?characterId=${f.characters.a.id}`, 'GET', undefined, users.outsider)).status, 404);
  assert.equal((await request(base(f), 'POST', creation, users.a)).status, 404);
  row = await view(f, row, 'b'); assert.equal(row.status, 'unavailable'); assert.match(row.blockedReason, /participant/i);
  assert.equal((await request(`${base(f)}/${row.id}/accept`, 'POST', command(f, 'b', row), users.b)).status, 409);
});

test('membership removal, disabled instruments and archives block new actions without changing assets', async () => {
  const f = await fixture(); let row = await active(f); const before = await balances(f);
  await pool.query('DELETE FROM memberships WHERE event_id=$1 AND user_id=$2', [f.event.id, users.b.id]);
  assert.equal((await request(`${base(f)}/${row.id}/settle`, 'POST', command(f, 'a', row), users.a)).status, 409);
  await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'player')", [f.event.id, users.b.id]);
  await pool.query('UPDATE users SET is_disabled=true WHERE id=$1', [users.b.id]);
  assert.equal((await request(`${base(f)}/${row.id}/settle`, 'POST', command(f, 'a', row), users.a)).status, 409);
  await pool.query('UPDATE users SET is_disabled=false WHERE id=$1', [users.b.id]);
  await pool.query("UPDATE events SET setup=jsonb_set(setup,'{enabledInstruments}','[\"briefing\",\"bazaar\"]') WHERE id=$1", [f.event.id]);
  assert.equal((await request(`${base(f)}/${row.id}/settle`, 'POST', command(f, 'a', row), users.a)).status, 403);
  await pool.query("UPDATE events SET status='archived',setup=jsonb_set(setup,'{enabledInstruments}','[\"briefing\",\"bazaar\",\"oathbook\"]') WHERE id=$1", [f.event.id]);
  assert.equal((await request(`${base(f)}/${row.id}/dispute`, 'POST', command(f, 'a', row, { reason: 'Needs review.' }), users.a)).status, 409);
  assert.deepEqual(await balances(f), before); assert.equal((await view(f, row)).readOnly, true);
});

test('same-account counterparties are rejected and proposal cancellation is creator-only', async () => {
  const f = await fixture(); await pool.query('UPDATE characters SET user_id=$3 WHERE event_id=$1 AND id=$2', [f.event.id, f.characters.b.id, users.a.id]);
  assert.equal((await request(base(f), 'POST', proposal(f), users.a)).status, 400);
  await pool.query('UPDATE characters SET user_id=$3 WHERE event_id=$1 AND id=$2', [f.event.id, f.characters.b.id, users.b.id]);
  let row = await create(f); assert.equal((await request(`${base(f)}/${row.id}/cancel`, 'POST', command(f, 'b', row), users.b)).status, 403);
  row = await act(f, row, 'cancel', 'a'); assert.equal(row.status, 'cancelled');
  assert.equal((await request(`${base(f)}/${row.id}/accept`, 'POST', command(f, 'b', row), users.b)).status, 409);
});


test('newly invited accounts receive current terms without the prior private history', async () => {
  const f = await fixture(); let row = await create(f); row = await act(f, row, 'accept', 'a');
  const originalTerms = row.terms;
  const changed = proposal(f, { version: row.version, participantIds: [f.characters.a.id, f.characters.outsider.id], terms: 'New terms: the new courier carries a fresh parcel.' });
  row = ok(await request(`${base(f)}/${row.id}`, 'PUT', changed, users.a)).agreement;
  const newcomer = await view(f, row, 'outsider');
  assert.equal(newcomer.history.length, 1); assert.equal(newcomer.history[0].action, 'revised');
  assert.ok(!JSON.stringify(newcomer).includes(originalTerms)); assert.ok(!JSON.stringify(newcomer).includes('audienceUserIds'));
  assert.equal((await request(`${base(f)}/${row.id}?characterId=${f.characters.b.id}`, 'GET', undefined, users.b)).status, 404);
  assert.ok(row.history.some(h => h.action === 'accepted' && h.termsVersion === 1));
  const manager = ok(await request(`${base(f)}/${row.id}`)).agreement;
  assert.equal(manager.history.at(-1).priorSnapshot.terms, originalTerms); assert.ok(!JSON.stringify(manager).includes(users.a.id));
});


test('agreement history capacity preserves every record and rolls back a signature at the limit', async () => {
  const f = await fixture(); const row = await create(f), ids = Array.from({ length: 511 }, () => randomUUID());
  await pool.query("INSERT INTO oath_history(id,event_id,agreement_id,actor_user_id,action,terms_version,details) SELECT id,$2,$3,$4,'accepted',1,'{}'::jsonb FROM unnest($1::uuid[]) id", [ids, f.event.id, row.id, users.a.id]);
  assert.equal((await request(`${base(f)}/${row.id}/accept`, 'POST', command(f, 'a', row), users.a)).status, 429);
  const unchanged = await view(f, row); assert.equal(unchanged.version, row.version); assert.ok(unchanged.participants.every(p => !p.accepted));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM oath_history WHERE event_id=$1 AND agreement_id=$2', [f.event.id, row.id])).rows[0].n, 512);
});

test('every invited character has an active agreement limit, including a busy counterparty', async () => {
  const f = await fixture(), ids = Array.from({ length: 50 }, () => randomUUID());
  await pool.query("INSERT INTO oath_agreements(id,event_id,creator_user_id,creator_character_id,title,terms) SELECT id,$2,$3,$4,'An existing promise','Existing private terms.' FROM unnest($1::uuid[]) id", [ids, f.event.id, users.b.id, f.characters.b.id]);
  for (const who of ['b', 'outsider']) await pool.query("INSERT INTO oath_participants(event_id,agreement_id,character_id,owner_user_id,name,kind) SELECT $2,id,$3,$4,$5,'participant' FROM unnest($1::uuid[]) id", [ids, f.event.id, f.characters[who].id, users[who].id, `Oath ${who}`]);
  assert.equal((await request(base(f), 'POST', proposal(f), users.a)).status, 429);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM oath_agreements WHERE event_id=$1', [f.event.id])).rows[0].n, 50);
});
