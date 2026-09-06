import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './database.js';
import { migrate, transaction } from '../src/db.js';
import { inspectSigilComponents, consumeSigilComponents } from '../src/sigil-components.js';
import { resetEconomy } from '../src/economy.js';
import { defaultSetup } from '../public/kit.js';
let database, pool;
before(async () => { database = await testDatabase(); pool = database.pool; await migrate(pool); });
after(async () => { await database?.close(); });
async function fixture() {
  const user = randomUUID(), event = randomUUID(), character = randomUUID(), item = randomUUID();
  await pool.query('INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,\'Component host\',\'unused-test-hash\')', [user, `${user}@components.example.test`]);
  await pool.query('INSERT INTO events(id,owner_user_id,name,status,setup) VALUES($1,$2,\'Component rehearsal\',\'rehearsal\',$3)', [event, user, JSON.stringify(defaultSetup())]);
  await pool.query('INSERT INTO characters(id,event_id,user_id,status,profile,badge_code) VALUES($1,$2,$3,\'approved\',$4,$5)', [character, event, user, JSON.stringify({ name: 'Host' }), randomUUID().replaceAll('-', '').slice(0, 20).replace(/[01]/g, 'A').toUpperCase()]);
  await pool.query('INSERT INTO event_adventures(event_id,definition,is_rehearsal) VALUES($1,\'{}\',true)', [event]);
  await pool.query('INSERT INTO character_inventory(id,event_id,character_id,name,quantity,notes) VALUES($1,$2,$3,\'Ritual token\',3,\'PRIVATE component notes\')', [item, event, character]);
  await pool.query('INSERT INTO economy_resources(event_id,id,name) VALUES($1,\'power\',\'Power\')', [event]);
  await pool.query('INSERT INTO economy_balances(event_id,character_id,resource_id,quantity) VALUES($1,$2,\'power\',5)', [event, character]);
  const components = [{ id: 'token', name: 'Token', kind: 'item', itemName: 'Ritual token', resourceId: null, quantity: 2, consume: true }, { id: 'power', name: 'Power', kind: 'resource', itemName: null, resourceId: 'power', quantity: 5, consume: false }];
  return { user, event, character, item, components, bindings: [{ componentId: 'token', itemId: item }] };
}
async function snapshot(f) {
  return { inventory: (await pool.query('SELECT * FROM character_inventory WHERE event_id=$1 ORDER BY id', [f.event])).rows, balances: (await pool.query('SELECT * FROM economy_balances WHERE event_id=$1', [f.event])).rows, baseline: (await pool.query('SELECT * FROM economy_baselines WHERE event_id=$1', [f.event])).rows };
}
async function consume(f, components = f.components, bindings = f.bindings) {
  return transaction(pool, async db => { await db.query('SELECT id FROM events WHERE id=$1 FOR UPDATE', [f.event]); await db.query('SELECT id FROM users WHERE id=$1 FOR SHARE', [f.user]); return consumeSigilComponents(db, f.event, f.character, components, bindings); });
}

test('SIGIL final planning rejects missing nonconsuming resources, renamed or foreign bindings without any asset or baseline writes', async () => {
  const f = await fixture(), before = await snapshot(f);
  await assert.rejects(() => consume(f, f.components.map(c => c.kind === 'resource' ? { ...c, quantity: 6 } : c)), { status: 409 });
  assert.deepEqual(await snapshot(f), before);
  await assert.rejects(() => consume(f, f.components.map(c => c.kind === 'item' ? { ...c, itemName: 'Renamed token' } : c)), { status: 409 });
  await assert.rejects(() => consume(f, f.components, [{ componentId: 'token', itemId: randomUUID() }]), { status: 409 });
  const duplicated = [...f.components, { ...f.components[0], id: 'second-token', quantity: 2, consume: false }];
  await assert.rejects(() => consume(f, duplicated, [...f.bindings, { componentId: 'second-token', itemId: f.item }]), { status: 409 });
  assert.deepEqual(await snapshot(f), before);
});

test('SIGIL consumes only opted-in host quantities, strips notes from its plan and restores the rehearsal starting inventory', async () => {
  const f = await fixture(), before = await snapshot(f);
  const inspected = await inspectSigilComponents(pool, f.event, f.character, f.components, f.bindings);
  assert.deepEqual(await snapshot(f), before);
  assert.ok(!JSON.stringify(inspected).includes('PRIVATE'));
  const receipt = await consume(f);
  assert.equal(receipt.items[0].consumed, 2); assert.equal(receipt.resources[0].consumed, 0);
  const after = await snapshot(f);
  assert.equal(after.inventory[0].quantity, 1); assert.equal(after.inventory[0].version, 2); assert.equal(after.inventory[0].notes, before.inventory[0].notes);
  assert.deepEqual(after.balances, before.balances); assert.equal(after.baseline.length, 1);
  await transaction(pool, db => resetEconomy(db, f.event));
  assert.deepEqual((await snapshot(f)).inventory, before.inventory);
});
