import { captureEconomyBaseline } from './economy.js';

const reject = message => { const error = new Error(message); error.status = 409; throw error; };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The caller holds the event mutex and the current host's user lock. Both the
// initial inspection and final consumption resolve current assets, never prices,
// quantities, or ownership supplied by the browser. Nothing is reserved at start.
export async function inspectSigilComponents(db, eventId, characterId, components, bindings) {
  if (!Array.isArray(components) || components.length > 10 || !Array.isArray(bindings)) reject('Review the challenge components.');
  const itemComponents = components.filter(component => component?.kind === 'item');
  if (bindings.length !== itemComponents.length || Object.keys(bindings).length !== bindings.length) reject('Bind each required item exactly once.');
  const bound = new Map();
  for (const binding of bindings) {
    if (!binding || typeof binding.componentId !== 'string' || !uuid.test(binding.itemId || '') || bound.has(binding.componentId) || !itemComponents.some(component => component.id === binding.componentId)) reject('Bind each required item exactly once.');
    bound.set(binding.componentId, binding.itemId.toLowerCase());
  }
  const inventory = new Map((await db.query('SELECT id,name,quantity FROM character_inventory WHERE event_id=$1 AND character_id=$2', [eventId, characterId])).rows.map(row => [row.id, row]));
  const resources = new Map((await db.query('SELECT r.id,r.name,COALESCE(b.quantity,0) AS quantity FROM economy_resources r LEFT JOIN economy_balances b ON b.event_id=r.event_id AND b.resource_id=r.id AND b.character_id=$2 WHERE r.event_id=$1', [eventId, characterId])).rows.map(row => [row.id, row]));
  const itemPlan = new Map(), resourcePlan = new Map(), ids = new Set();
  for (const component of components) {
    if (!component || typeof component.id !== 'string' || ids.has(component.id) || !['item', 'resource'].includes(component.kind) || typeof component.consume !== 'boolean' || !Number.isInteger(component.quantity) || component.quantity < 1 || component.quantity > (component.kind === 'item' ? 9999 : 1_000_000_000)) reject('Review the challenge components.');
    ids.add(component.id);
    const isItem = component.kind === 'item', id = isItem ? bound.get(component.id) : component.resourceId;
    const row = (isItem ? inventory : resources).get(id);
    if (!row || (isItem && row.name !== component.itemName)) reject(`The host's required component “${component.name || component.id}” is no longer available.`);
    const plan = isItem ? itemPlan : resourcePlan;
    const entry = plan.get(id) || { ...(isItem ? { itemId: id } : { resourceId: id }), name: row.name, required: 0, consumed: 0, before: row.quantity, after: row.quantity };
    entry.required += component.quantity;
    if (component.consume) entry.consumed += component.quantity;
    if (!Number.isSafeInteger(entry.required) || entry.required > row.quantity) reject(`The host does not have enough ${row.name} to complete this challenge.`);
    entry.after = entry.before - entry.consumed;
    plan.set(id, entry);
  }
  return { items: [...itemPlan.values()], resources: [...resourcePlan.values()] };
}

// Terminal-run and request replay checks happen before this call. The caller
// writes the outcome, flags, last checkpoint and journal in this same transaction.
export async function consumeSigilComponents(db, eventId, characterId, components, bindings) {
  const plan = await inspectSigilComponents(db, eventId, characterId, components, bindings);
  if (!plan.items.some(item => item.consumed) && !plan.resources.some(resource => resource.consumed)) return plan;
  await captureEconomyBaseline(db, eventId);
  for (const item of plan.items) if (item.consumed) {
    await db.query('UPDATE character_inventory SET quantity=$4,version=version+1 WHERE event_id=$1 AND character_id=$2 AND id=$3', [eventId, characterId, item.itemId, item.after]);
  }
  for (const resource of plan.resources) if (resource.consumed) {
    await db.query('UPDATE economy_balances SET quantity=$4,version=version+1 WHERE event_id=$1 AND character_id=$2 AND resource_id=$3', [eventId, characterId, resource.resourceId, resource.after]);
  }
  return plan;
}
