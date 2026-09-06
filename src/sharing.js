import { characterRecord } from "../public/characters-model.js";

const policies = new Set(["shareable", "restricted", "organizer_only"]);
const managers = new Set(["owner", "organizer", "superuser"]);

export function sharingPolicyFor(settings, nodeId) {
  const descriptor = settings?.policies && Object.getOwnPropertyDescriptor(settings.policies, nodeId);
  return descriptor && Object.hasOwn(descriptor, "value") && policies.has(descriptor.value) ? descriptor.value : "restricted";
}

export async function readSharing(db, eventId) {
  const row = (await db.query("SELECT version,policies FROM event_sharing_settings WHERE event_id=$1", [eventId])).rows[0];
  return row || { version: 0, policies: {} };
}

export async function seedSharing(db, eventId, definition) {
  const values = Object.fromEntries(definition.nodes.map(node => [node.id, ["relic", "dead_drop"].includes(node.type) ? "shareable" : "restricted"]));
  // Factory use only: never overwrite policies on an existing adventure.
  await db.query("INSERT INTO event_sharing_settings(event_id,policies) VALUES($1,$2) ON CONFLICT(event_id) DO NOTHING", [eventId, JSON.stringify(values)]);
}

export async function copySharing(db, sourceEventId, newEventId) {
  const source = await readSharing(db, sourceEventId);
  if (!source.version) return;
  const values = Object.fromEntries(Object.keys(source.policies).filter(id => /^[a-z][a-z0-9-]{0,47}$/.test(id)).map(id => [id, sharingPolicyFor(source, id)]));
  await db.query("INSERT INTO event_sharing_settings(event_id,version,policies) VALUES($1,1,$2)", [newEventId, JSON.stringify(values)]);
}

export function createSharingHandler({ pool, helpers }) {
  const { body, send, fail, identifier, membership, audit, transaction } = helpers;
  const requireManager = event => { if (!managers.has(event.role)) fail(403, "Only an organizer can manage sharing permissions."); };
  const nodesFor = async (db, eventId) => (await db.query("SELECT definition FROM event_adventures WHERE event_id=$1", [eventId])).rows[0]?.definition.nodes || [];
  const project = (settings, nodes) => ({ version: settings.version, nodes: nodes.map(node => ({ id: node.id, type: node.type, title: node.title, policy: sharingPolicyFor(settings, node.id) })) });

  return async function handleSharing({ req, res, path, method, user }) {
    const route = /^\/api\/events\/([^/]+)\/sharing$/.exec(path);
    if (!route) return false;
    if (!user) fail(401, "Sign in to continue.");
    const eventId = identifier(route[1]);
    if (method === "GET") {
      requireManager(await membership(pool, eventId, user.id));
      send(res, 200, project(await readSharing(pool, eventId), await nodesFor(pool, eventId)));
      return true;
    }
    if (method !== "PUT") fail(405, "Method not allowed.");
    const input = await body(req, 16384);
    const result = await transaction(pool, async db => {
      const event = await membership(db, eventId, user.id, true);
      requireManager(event);
      if (event.status === "archived") fail(409, "Sharing permissions cannot change on an archived event.");
      characterRecord(input, ["version", "policies"], "Sharing permissions");
      const current = await readSharing(db, eventId), nodes = await nodesFor(db, eventId);
      if (!Number.isInteger(input.version) || input.version !== current.version) fail(409, "Sharing permissions changed. Reload and review them before saving.");
      if (!Array.isArray(input.policies) || input.policies.length > 50) fail(400, "Provide at most 50 instrument permissions.");
      const known = new Set(nodes.map(node => node.id)), values = new Map();
      for (const item of input.policies) {
        characterRecord(item, ["nodeId", "policy"], "Instrument permission");
        if (!known.has(item.nodeId) || values.has(item.nodeId)) fail(400, "Choose each known instrument only once.");
        if (!policies.has(item.policy)) fail(400, "Choose shareable, restricted, or organizer-only permission.");
        values.set(item.nodeId, item.policy);
      }
      const next = { version: current.version + 1, policies: Object.fromEntries(nodes.map(node => [node.id, values.get(node.id) || "restricted"])) };
      const changed = nodes.some(node => sharingPolicyFor(current, node.id) !== sharingPolicyFor(next, node.id));
      await db.query("INSERT INTO event_sharing_settings(event_id,version,policies) VALUES($1,$2,$3) ON CONFLICT(event_id) DO UPDATE SET version=EXCLUDED.version,policies=EXCLUDED.policies", [eventId, next.version, JSON.stringify(next.policies)]);
      if (changed) await db.query("UPDATE exchange_sessions SET version=version+1,initiator_confirmed_version=NULL,recipient_confirmed_version=NULL,updated_at=clock_timestamp() WHERE event_id=$1 AND status IN('waiting','negotiating') AND expires_at>clock_timestamp()", [eventId]);
      await audit(db, eventId, user.id, "sharing.updated", { version: next.version, changed });
      return project(next, nodes);
    });
    send(res, 200, result);
    return true;
  };
}
