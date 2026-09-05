import { randomUUID, randomInt } from "node:crypto";
import { characterRecord, characterText, characterInteger, defaultCharacterSettings, defaultCharacterProfile, validateCharacterProfile, validateCharacterSettings, projectCharacter } from "../public/characters-model.js";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const badgeCode = () => Array.from({ length: 20 }, () => alphabet[randomInt(alphabet.length)]).join("");
// membership supplies the current global role after acquiring the event lock;
// do not reuse a stale superuser flag from the initial session lookup.
const manager = (event) => ["owner", "organizer", "superuser"].includes(event.role);
const settingsProjection = (row) => row ? ({ allowPlayerCreation: row.allow_player_creation, requireApproval: row.require_approval, maxPerPlayer: row.max_per_player, publicFields: row.public_fields, version: row.version }) : defaultCharacterSettings();
const factionProjection = (row) => ({ id: row.id, name: row.name, description: row.description, version: row.version });
const inventoryProjection = (row) => ({ id: row.id, characterId: row.character_id, name: row.name, quantity: row.quantity, notes: row.notes, version: row.version });

export function createCharacterHandler({ pool, config, helpers }) {
  const { body, send, fail, identifier, membership, audit, transaction } = helpers;
  const requireManager = (event, user) => { if (!manager(event, user)) fail(403, "Only an organizer can make this change."); };
  const editableEvent = (event) => { if (event.status === "archived") fail(409, "Archived events are read-only."); };
  const owned = (character, event, user) => manager(event, user) || character.user_id === user.id;
  const requireOwned = (character, event, user) => { if (!owned(character, event, user)) fail(403, "Only the assigned player or an organizer can change this character."); };
  const expectVersion = (value, current, label = "Character") => { if (!Number.isInteger(value) || value !== current) fail(409, `${label} changed. Refresh and try again.`); };
  const activeCharacter = (character) => { if (character.status === "retired") fail(409, "Retired characters are read-only. Copy this identity to create a new draft."); };
  async function settings(db, id) { return settingsProjection((await db.query("SELECT * FROM event_character_settings WHERE event_id=$1", [id])).rows[0]); }
  async function factions(db, id) { return (await db.query("SELECT * FROM factions WHERE event_id=$1 ORDER BY name,id", [id])).rows.map(factionProjection); }
  async function inventory(db, id) { return (await db.query("SELECT * FROM character_inventory WHERE character_id=$1 ORDER BY name,id", [id])).rows.map(inventoryProjection); }
  async function getCharacter(db, eventId, id, lock = false) {
    const result = (await db.query(`SELECT * FROM characters WHERE id=$1 AND event_id=$2${lock ? " FOR UPDATE" : ""}`, [id, eventId])).rows[0];
    if (!result) fail(404, "Character not found.");
    return result;
  }
  async function capacity(db, event, userId, characterSettings, excluding = null) {
    if (userId === null) return;
    const member = (await db.query("SELECT user_id FROM memberships WHERE event_id=$1 AND user_id=$2", [event.id, userId])).rows[0];
    if (!member) fail(400, "Assign a current member of this event.");
    const count = (await db.query("SELECT count(*)::int AS n FROM characters WHERE event_id=$1 AND user_id=$2 AND status<>'retired' AND ($3::uuid IS NULL OR id<>$3)", [event.id, userId, excluding])).rows[0].n;
    if (count >= characterSettings.maxPerPlayer) fail(409, `This player already has the maximum of ${characterSettings.maxPerPlayer} active characters for this event.`);
  }
  async function create(db, event, user, input, characterSettings, eventFactions) {
    if (!manager(event, user) && !characterSettings.allowPlayerCreation) fail(403, "Player-created characters are disabled for this event. Ask an organizer to assign a character.");
    let assignedId = user.id;
    if (Object.hasOwn(input, "userId")) {
      requireManager(event, user);
      assignedId = input.userId === null ? null : identifier(input.userId);
    }
    await capacity(db, event, assignedId, characterSettings);
    const count = (await db.query("SELECT count(*)::int AS n FROM characters WHERE event_id=$1", [event.id])).rows[0].n;
    if (count >= 2000) fail(409, "This event has reached its character record limit.");
    const profile = validateCharacterProfile(input.profile, event.setup, eventFactions);
    const row = (await db.query("INSERT INTO characters(id,event_id,user_id,profile,badge_code) VALUES($1,$2,$3,$4,$5) RETURNING *", [randomUUID(), event.id, assignedId, JSON.stringify(profile), badgeCode()])).rows[0];
    await audit(db, event.id, user.id, "character.created", { characterId: row.id, prewritten: assignedId === null });
    return row;
  }
  async function approve(db, event, row, user) {
    validateCharacterProfile(row.profile, event.setup, await factions(db, event.id));
    if (!row.inventory_initialized) {
      const existing = (await db.query("SELECT count(*)::int AS n FROM character_inventory WHERE character_id=$1", [row.id])).rows[0].n;
      if (existing + row.profile.startingEquipment.length > 100) fail(409, "Approval would exceed the 100-item inventory limit.");
      for (const item of row.profile.startingEquipment) await db.query("INSERT INTO character_inventory(id,event_id,character_id,name,quantity,notes) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), event.id, row.id, item.name, item.quantity, item.notes]);
    }
    const changed = (await db.query("UPDATE characters SET status='approved',inventory_initialized=true,review_notes='',version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [row.id])).rows[0];
    await audit(db, event.id, user.id, "character.approved", { characterId: row.id });
    return changed;
  }
  function itemInput(input, withVersion = false) {
    characterRecord(input, withVersion ? ["version", "name", "quantity", "notes"] : ["name", "quantity", "notes"], "Inventory item");
    return { name: characterText(input.name, "Item name", 1, 100), quantity: characterInteger(input.quantity, "Item quantity", 0, 9999), notes: characterText(input.notes, "Item notes", 0, 500) };
  }

  return async function handleCharacters({ req, res, path, method, user }) {
    const badgeMatch = /^\/api\/badges\/([^/]+)$/.exec(path);
    const match = /^\/api\/events\/([^/]+)\/(character-settings|factions|characters)(?:\/([^/]+))?(?:\/(submit|review|assign|retire|copy|badge|inventory))?(?:\/([^/]+))?$/.exec(path);
    if (!badgeMatch && !match) return false;
    if (!user) fail(401, "Sign in to continue.");
    if (badgeMatch) {
      if (method !== "GET") fail(405, "Method not allowed.");
      const code = badgeMatch[1];
      if (!/^[A-HJ-NP-Z2-9]{20}$/.test(code)) fail(404, "Badge not found.");
      const row = (await pool.query("SELECT * FROM characters WHERE badge_code=$1 AND status='approved'", [code])).rows[0];
      if (!row) fail(404, "Badge not found or character is not approved.");
      const event = await membership(pool, row.event_id, user.id);
      const publicCharacter = projectCharacter(row, await settings(pool, event.id), "public", await factions(pool, event.id));
      send(res, 200, { character: publicCharacter, event: { id: event.id, name: event.name, theme: event.setup.theme, skills: event.setup.rules.expertise.map(({ id, name }) => ({ id, name })) } });
      return true;
    }
    const [, rawEventId, section, rawTarget, action, rawItemId] = match;
    const eventId = identifier(rawEventId), targetId = rawTarget ? identifier(rawTarget) : null, itemId = rawItemId ? identifier(rawItemId) : null;
    if ((section !== "characters" && action) || (itemId && action !== "inventory")) fail(404, "Not found.");
    if (method === "GET") {
      const event = await membership(pool, eventId, user.id);
      const characterSettings = await settings(pool, eventId), eventFactions = await factions(pool, eventId);
      if (section === "character-settings" && !targetId) send(res, 200, { settings: characterSettings });
      else if (section === "factions" && !targetId) send(res, 200, { factions: eventFactions });
      else if (section === "characters" && !targetId) {
        const rows = (await pool.query("SELECT * FROM characters WHERE event_id=$1 AND ($2::boolean OR user_id=$3 OR status='approved') ORDER BY created_at,id", [eventId, manager(event, user), user.id])).rows;
        send(res, 200, { characters: rows.map((row) => projectCharacter(row, characterSettings, owned(row, event, user) ? "private" : "public", eventFactions)), settings: characterSettings, factions: eventFactions });
      } else if (section === "characters" && targetId && (!action || action === "inventory") && !itemId) {
        const row = await getCharacter(pool, eventId, targetId);
        const isPrivate = owned(row, event, user);
        if (!isPrivate && (row.status !== "approved" || action === "inventory")) fail(404, "Character not found.");
        if (action === "inventory") send(res, 200, { inventory: await inventory(pool, row.id) });
        else send(res, 200, { character: projectCharacter(row, characterSettings, isPrivate ? "private" : "public", eventFactions), ...(isPrivate ? { inventory: await inventory(pool, row.id) } : {}) });
      } else fail(404, "Not found.");
      return true;
    }
    const input = await body(req, 524288);
    // Copies lock both event rows in a stable order before locking the source
    // character. Opposite-direction copies cannot deadlock each other.
    const result = await transaction(pool, async (db) => {
      let event;
      let copyTarget;
      if (section === "characters" && action === "copy" && method === "POST" && targetId) {
        characterRecord(input, ["targetEventId"], "Character copy");
        const destination = identifier(input.targetEventId);
        if (destination === eventId) fail(400, "Choose a different destination event.");
        const eventRows = new Map();
        for (const id of [eventId, destination].sort()) eventRows.set(id, await membership(db, id, user.id, true));
        event = eventRows.get(eventId); copyTarget = eventRows.get(destination);
      } else event = await membership(db, eventId, user.id, true);
      editableEvent(copyTarget || event);
      const characterSettings = await settings(db, eventId), eventFactions = await factions(db, eventId);
      if (section === "character-settings" && !targetId && method === "PUT") {
        requireManager(event, user);
        const changed = validateCharacterSettings(input);
        expectVersion(changed.version, characterSettings.version, "Character settings");
        const row = (await db.query("INSERT INTO event_character_settings(event_id,allow_player_creation,require_approval,max_per_player,public_fields,version) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(event_id) DO UPDATE SET allow_player_creation=EXCLUDED.allow_player_creation,require_approval=EXCLUDED.require_approval,max_per_player=EXCLUDED.max_per_player,public_fields=EXCLUDED.public_fields,version=EXCLUDED.version RETURNING *", [eventId, changed.allowPlayerCreation, changed.requireApproval, changed.maxPerPlayer, JSON.stringify(changed.publicFields), changed.version + 1])).rows[0];
        await audit(db, eventId, user.id, "character.settings_updated");
        return { settings: settingsProjection(row) };
      }
      if (section === "factions") {
        requireManager(event, user);
        if (!targetId && method === "POST") {
          characterRecord(input, ["name", "description"], "Faction");
          if ((await db.query("SELECT count(*)::int AS n FROM factions WHERE event_id=$1", [eventId])).rows[0].n >= 50) fail(409, "An event can have at most 50 factions.");
          const row = (await db.query("INSERT INTO factions(id,event_id,name,description) VALUES($1,$2,$3,$4) RETURNING *", [randomUUID(), eventId, characterText(input.name, "Faction name", 1, 80), characterText(input.description, "Faction description", 0, 2000)])).rows[0];
          await audit(db, eventId, user.id, "faction.created", { factionId: row.id });
          return { faction: factionProjection(row) };
        }
        if (targetId && ["PATCH", "DELETE"].includes(method)) {
          const row = (await db.query("SELECT * FROM factions WHERE id=$1 AND event_id=$2 FOR UPDATE", [targetId, eventId])).rows[0];
          if (!row) fail(404, "Faction not found.");
          characterRecord(input, method === "DELETE" ? ["version"] : ["version", "name", "description"], "Faction change");
          expectVersion(input.version, row.version, "Faction");
          if (method === "DELETE") {
            if ((await db.query("SELECT id FROM characters WHERE event_id=$1 AND profile->>'factionId'=$2 LIMIT 1", [eventId, targetId])).rows[0]) fail(409, "This faction is used by a character. Change their faction before deleting it.");
            await db.query("DELETE FROM factions WHERE id=$1 AND event_id=$2", [targetId, eventId]);
            await audit(db, eventId, user.id, "faction.deleted", { factionId: targetId });
            return { ok: true };
          }
          const changed = (await db.query("UPDATE factions SET name=$1,description=$2,version=version+1 WHERE id=$3 AND event_id=$4 RETURNING *", [characterText(input.name, "Faction name", 1, 80), characterText(input.description, "Faction description", 0, 2000), targetId, eventId])).rows[0];
          await audit(db, eventId, user.id, "faction.updated", { factionId: targetId });
          return { faction: factionProjection(changed) };
        }
      }
      if (section !== "characters") fail(404, "Not found.");
      if (!targetId && method === "POST") {
        characterRecord(input, ["profile", "userId"], "Character creation", ["profile"]);
        const created = await create(db, event, user, input, characterSettings, eventFactions);
        return { character: projectCharacter(created, characterSettings, "private", eventFactions) };
      }
      if (!targetId) fail(404, "Not found.");
      let row = await getCharacter(db, eventId, targetId, true);
      if (action === "copy" && method === "POST") {
        requireOwned(row, event, user);
        const destinationSettings = await settings(db, copyTarget.id);
        const profile = defaultCharacterProfile(copyTarget.setup.rules);
        for (const field of ["name", "portrait", "pronouns", "biography"]) profile[field] = row.profile[field];
        profile.skills = row.profile.skills.filter((id) => copyTarget.setup.rules.expertise.some((skill) => skill.id === id));
        const created = await create(db, copyTarget, user, { profile }, destinationSettings, await factions(db, copyTarget.id));
        await audit(db, copyTarget.id, user.id, "character.copied", { characterId: created.id });
        return { character: projectCharacter(created, destinationSettings, "private"), warnings: ["Copied as a new draft using the destination event's attribute defaults and supported skills. Review and submit it under the destination rules.", "Faction, private objectives, starting equipment, inventory, approval, and event progress were not copied."] };
      }
      if (action === "inventory") {
        requireManager(event, user); activeCharacter(row);
        if (!itemId && method === "POST") {
          const item = itemInput(input);
          if ((await db.query("SELECT count(*)::int AS n FROM character_inventory WHERE character_id=$1", [row.id])).rows[0].n >= 100) fail(409, "A character can have at most 100 inventory entries.");
          const added = (await db.query("INSERT INTO character_inventory(id,event_id,character_id,name,quantity,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING *", [randomUUID(), eventId, row.id, item.name, item.quantity, item.notes])).rows[0];
          await audit(db, eventId, user.id, "character.inventory_added", { characterId: row.id, itemId: added.id, quantity: added.quantity });
          return { item: inventoryProjection(added), inventory: await inventory(db, row.id) };
        }
        if (itemId && ["PATCH", "DELETE"].includes(method)) {
          const item = (await db.query("SELECT * FROM character_inventory WHERE id=$1 AND character_id=$2 AND event_id=$3 FOR UPDATE", [itemId, row.id, eventId])).rows[0];
          if (!item) fail(404, "Inventory item not found.");
          expectVersion(input.version, item.version, "Inventory item");
          if (method === "DELETE") {
            characterRecord(input, ["version"], "Inventory deletion");
            await db.query("DELETE FROM character_inventory WHERE id=$1", [item.id]);
            await audit(db, eventId, user.id, "character.inventory_deleted", { characterId: row.id, itemId: item.id });
            return { inventory: await inventory(db, row.id) };
          }
          const data = itemInput(input, true);
          const changed = (await db.query("UPDATE character_inventory SET name=$1,quantity=$2,notes=$3,version=version+1 WHERE id=$4 RETURNING *", [data.name, data.quantity, data.notes, item.id])).rows[0];
          await audit(db, eventId, user.id, "character.inventory_updated", { characterId: row.id, itemId: item.id, quantity: changed.quantity });
          return { item: inventoryProjection(changed), inventory: await inventory(db, row.id) };
        }
        fail(404, "Not found.");
      }
      if (action === "assign") requireManager(event, user);
      else if (action === "review") requireManager(event, user);
      else requireOwned(row, event, user);
      activeCharacter(row);
      expectVersion(input.version, row.version);
      if (!action && method === "PATCH") {
        characterRecord(input, ["version", "profile"], "Character update");
        const profile = validateCharacterProfile(input.profile, event.setup, eventFactions);
        row = (await db.query("UPDATE characters SET profile=$1,status='draft',review_notes='',version=version+1,updated_at=now() WHERE id=$2 RETURNING *", [JSON.stringify(profile), row.id])).rows[0];
        await audit(db, eventId, user.id, "character.updated", { characterId: row.id });
      } else if (action === "submit" && method === "POST") {
        characterRecord(input, ["version"], "Character submission");
        if (!["draft", "changes_requested"].includes(row.status)) fail(409, "Only a draft or a character needing changes can be submitted.");
        validateCharacterProfile(row.profile, event.setup, eventFactions);
        if (!characterSettings.requireApproval) row = await approve(db, event, row, user);
        else {
          row = (await db.query("UPDATE characters SET status='pending',review_notes='',version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [row.id])).rows[0];
          await audit(db, eventId, user.id, "character.submitted", { characterId: row.id });
        }
      } else if (action === "review" && method === "POST") {
        characterRecord(input, ["version", "decision", "feedback"], "Character review");
        if (row.status !== "pending") fail(409, "Only a submitted character can be reviewed.");
        const feedback = characterText(input.feedback, "Review feedback", 0, 2000);
        if (input.decision === "approve") row = await approve(db, event, row, user);
        else if (input.decision === "request_changes") {
          if (!feedback) fail(400, "Explain what the player needs to change.");
          row = (await db.query("UPDATE characters SET status='changes_requested',review_notes=$1,version=version+1,updated_at=now() WHERE id=$2 RETURNING *", [feedback, row.id])).rows[0];
          await audit(db, eventId, user.id, "character.changes_requested", { characterId: row.id });
        } else fail(400, "Choose approve or request_changes.");
      } else if (action === "assign" && method === "POST") {
        characterRecord(input, ["version", "userId"], "Character assignment");
        const userId = input.userId === null ? null : identifier(input.userId);
        await capacity(db, event, userId, characterSettings, row.id);
        row = (await db.query("UPDATE characters SET user_id=$1,version=version+1,updated_at=now() WHERE id=$2 RETURNING *", [userId, row.id])).rows[0];
        await audit(db, eventId, user.id, "character.assigned", { characterId: row.id, userId });
      } else if (action === "retire" && method === "POST") {
        characterRecord(input, ["version"], "Character retirement");
        row = (await db.query("UPDATE characters SET status='retired',version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [row.id])).rows[0];
        await audit(db, eventId, user.id, "character.retired", { characterId: row.id });
      } else if (action === "badge" && method === "POST") {
        characterRecord(input, ["version"], "Badge rotation");
        row = (await db.query("UPDATE characters SET badge_code=$1,version=version+1,updated_at=now() WHERE id=$2 RETURNING *", [badgeCode(), row.id])).rows[0];
        await audit(db, eventId, user.id, "character.badge_rotated", { characterId: row.id });
      } else fail(404, "Not found.");
      return { character: projectCharacter(row, characterSettings, "private", eventFactions) };
    });
    send(res, method === "POST" && (!targetId || action === "copy" || (action === "inventory" && !itemId)) ? 201 : 200, result);
    return true;
  };
}
