import { randomUUID, randomInt, createHash } from "node:crypto";
import { defaultAdventure, validateAdventure, ADVENTURE_CODE } from "../public/adventure-model.js";
import { characterRecord, characterText, characterInteger, validateCharacterProfile, defaultCharacterProfile } from "../public/characters-model.js";
import { validateSetup } from "../public/kit.js";
import { ADVENTURE_TEMPLATES, buildAdventureTemplate } from "./adventure-templates.js";
import { readSharing, sharingPolicyFor, seedSharing, copySharing } from "./sharing.js";
import { seedStory, copyStory, resetStory, filterStoryJournal } from "./story.js";
import { seedEconomy, copyEconomy, captureEconomyBaseline, resetEconomy } from "./economy.js";
import { resetOaths } from "./oaths.js";
import { seedSigil, copySigil, resetSigil } from "./sigil.js";
import { seedStatic, copyStatic, resetStatic } from "./static.js";
import { seedStagehand, copyStagehand, resetStagehand, stagehandWayfinderState } from "./stagehand-core.js";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = () => Array.from({ length: 20 }, () => alphabet[randomInt(alphabet.length)]).join("");
const managers = new Set(["owner", "organizer", "superuser"]);
const allowedStatus = new Set(["live", "rehearsal"]);
const instrumentId = (type) => type === "dead_drop" ? "dead-drop" : type;
const emptyProgress = () => ({ completed: false, failed: false, attempts: 0, hints: [], examinations: [], lastAttemptAt: null });
const progressFor = (run, id) => Object.hasOwn(run.progress, id) ? run.progress[id] : emptyProgress();
const matches = (conditions, character, run, event) => conditions.completed.every((id) => progressFor(run, id).completed === true) && conditions.skills.every((id) => character.profile.skills.includes(id)) && conditions.flags.every((id) => run.flags[id] === true) && (!conditions.statuses.length || conditions.statuses.includes(event.status));
const journalProjection = (row) => ({ id: row.id, nodeId: row.node_id, entryKey: row.entry_key, title: row.title, text: row.text, audio: row.audio, type: row.type, createdAt: row.created_at });
const publicCharacter = (row) => ({ id: row.id, name: row.profile.name });
const fold = (value) => value.normalize("NFKC").trim().toLocaleLowerCase("en-US");

export function createAdventureHandler({ pool, config, helpers }) {
  const { body, send, fail, identifier, membership, audit, transaction, safeEvent } = helpers;
  const requireManager = (event) => { if (!managers.has(event.role)) fail(403, "Only an organizer can manage this adventure."); };
  const requirePlayable = (event) => { if (!allowedStatus.has(event.status)) fail(409, "This event must be live or in rehearsal to play."); };
  const requireVersion = (value, current) => { if (!Number.isInteger(value) || value !== current) fail(409, "This adventure changed. Reload it before continuing."); };
  async function adventure(db, eventId) { return (await db.query("SELECT * FROM event_adventures WHERE event_id=$1", [eventId])).rows[0] || { event_id: eventId, definition: defaultAdventure(), version: 0, is_rehearsal: false, source_event_id: null }; }
  async function runFor(db, eventId, characterId) { return (await db.query("SELECT * FROM adventure_runs WHERE event_id=$1 AND character_id=$2", [eventId, characterId])).rows[0] || { event_id: eventId, character_id: characterId, progress: {}, flags: {} }; }
  async function characterFor(db, event, user, requested, { preview = false, action = false } = {}) {
    if (preview) requireManager(event);
    const row = requested ? (await db.query("SELECT * FROM characters WHERE event_id=$1 AND id=$2", [event.id, identifier(requested)])).rows[0] : (await db.query("SELECT * FROM characters WHERE event_id=$1 AND user_id=$2 AND status='approved' ORDER BY created_at,id LIMIT 1", [event.id, user.id])).rows[0];
    if (requested && (!row || (!preview && row.user_id !== user.id))) fail(404, "Character not found or not assigned to you.");
    if (action && (!row || row.status !== "approved")) fail(409, "Choose an approved character before playing.");
    return row || null;
  }
  async function snapshot(db, event, user, record, character, preview = false) {
    const characters = (await db.query("SELECT id,profile FROM characters WHERE event_id=$1 AND ($3::boolean OR user_id=$2) AND status='approved' ORDER BY created_at,id", [event.id, user.id, preview])).rows.map(publicCharacter);
    const result = { adventure: { title: record.definition.title, summary: record.definition.summary, version: record.version, isRehearsal: record.is_rehearsal }, event: { id: event.id, name: event.name, status: event.status }, character: character ? publicCharacter(character) : null, characters, nodes: [], journal: [], readOnly: preview || !allowedStatus.has(event.status) || !character || character.status !== "approved", preview };
    if (!character) return { ...result, message: "Choose an approved character to explore this adventure. Ask an organizer if you need one assigned." };
    const run = await runFor(db, event.id, character.id);
    const attendance = (await db.query("SELECT a.node_id,count(*)::int AS count,bool_or(a.character_id=$2) AS joined FROM adventure_attendance a JOIN characters c ON c.event_id=a.event_id AND c.id=a.character_id JOIN users u ON u.id=c.user_id WHERE a.event_id=$1 AND c.status='approved' AND NOT u.is_disabled AND (u.is_superuser OR EXISTS(SELECT 1 FROM memberships m WHERE m.event_id=a.event_id AND m.user_id=c.user_id)) GROUP BY a.node_id", [event.id, character.id])).rows;
    const journalRows = (await db.query("SELECT * FROM adventure_journal WHERE event_id=$1 AND character_id=$2 ORDER BY created_at,id", [event.id, character.id])).rows;
    result.journal = (await filterStoryJournal(db, event.id, user.id, journalRows)).map(journalProjection);
    if (!preview && character.status !== "approved") return { ...result, message: "This character cannot make new discoveries. Previously saved readings remain in the journal." };
    const sharing = await readSharing(db, event.id);
    result.nodes = record.definition.nodes.filter((node) => event.setup.enabledInstruments.includes(instrumentId(node.type)) && (preview || sharingPolicyFor(sharing, node.id) !== "organizer_only")).map((node) => {
      const progress = progressFor(run, node.id), locked = !matches(node.conditions, character, run, event);
      const attending = attendance.find((entry) => entry.node_id === node.id);
      const common = { id: node.id, type: node.type, title: node.title, summary: node.summary, locked, lockReason: locked ? "Requirements are not met." : null, completed: progress.completed, failed: progress.failed, ...(node.type === "wayfinder" ? { joined: attending?.joined === true } : {}) };
      if (locked) return common;
      if (node.type === "relic") return { ...common, examinations: node.examinations.map((exam) => ({ id: exam.id, label: exam.label, available: matches(exam.conditions, character, run, event), completed: progress.examinations.includes(exam.id) })) };
      if (node.type === "dead_drop") return { ...common, requiresCode: node.releaseCode !== null };
      if (node.type === "cipherbox") return { ...common, prompt: node.prompt, attempts: progress.attempts, maxAttempts: node.maxAttempts, retryAfterMs: Math.max(0, 1000 - (Date.now() - Date.parse(progress.lastAttemptAt || "1970-01-01"))), hints: node.hints.map((hint, index) => ({ index, available: progress.attempts >= hint.afterAttempts, requested: progress.hints.includes(index), ...(progress.hints.includes(index) ? { text: hint.text } : {}) })) };
      return { ...common, body: node.body, location: node.location, playStyle: node.playStyle, durationMinutes: node.durationMinutes, minPlayers: node.minPlayers, maxPlayers: node.maxPlayers, availability: node.availability === "closed" || (node.endsAt && Date.parse(node.endsAt) <= Date.now()) ? "closed" : node.startsAt && Date.parse(node.startsAt) > Date.now() ? "scheduled" : "open", startsAt: node.startsAt, endsAt: node.endsAt, attendanceCount: attending?.count || 0 };
    });
    for (const shown of result.nodes) {
      if (shown.type !== "wayfinder" || shown.locked) continue;
      const node = record.definition.nodes.find(row => row.id === shown.id);
      const operation = await stagehandWayfinderState(db, event, node, character);
      if (operation) {
        shown.operations = operation;
        shown.attendanceCount = operation.attendanceCount;
        shown.maxPlayers = operation.capacity;
        if (!operation.canJoin) shown.availability = "closed";
      }
    }
    return result;
  }
  async function manageSnapshot(db, event, record) {
    const characters = (await db.query("SELECT id,user_id,status,profile FROM characters WHERE event_id=$1 ORDER BY created_at,id", [event.id])).rows.map((row) => ({ ...publicCharacter(row), userId: row.user_id, status: row.status }));
    const rows = (await db.query("SELECT r.*,c.profile,(SELECT count(*)::int FROM adventure_journal j WHERE j.event_id=r.event_id AND j.character_id=r.character_id) AS journal_count FROM adventure_runs r JOIN characters c ON c.event_id=r.event_id AND c.id=r.character_id WHERE r.event_id=$1 ORDER BY c.created_at,c.id", [event.id])).rows;
    return { definition: record.definition, version: record.version, isRehearsal: record.is_rehearsal, sourceEventId: record.source_event_id, characters, progress: rows.map((row) => ({ characterId: row.character_id, name: row.profile.name, completed: Object.values(row.progress).filter((node) => node.completed).length, failed: Object.values(row.progress).filter((node) => node.failed).length, journalEntries: row.journal_count, flags: Object.keys(row.flags).filter((id) => row.flags[id] === true) })) };
  }
  async function saveRun(db, run) { await db.query("INSERT INTO adventure_runs(event_id,character_id,progress,flags) VALUES($1,$2,$3,$4) ON CONFLICT(event_id,character_id) DO UPDATE SET progress=EXCLUDED.progress,flags=EXCLUDED.flags", [run.event_id, run.character_id, JSON.stringify(run.progress), JSON.stringify(run.flags)]); }
  async function journal(db, event, character, node, entryKey, title, text, audio = null, type = node.type) {
    await db.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,audio,type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(event_id,character_id,entry_key) DO NOTHING", [randomUUID(), event.id, character.id, node.id, entryKey, title, text, audio, type]);
  }
  const setFlags = (run, flags) => { for (const id of flags) run.flags[id] = true; };
  async function seedCharacters(db, event, profiles, factionRows = []) {
    const ids = [];
    for (const input of profiles) {
      const profile = validateCharacterProfile(input.profile, event.setup, factionRows);
      const id = randomUUID();
      ids.push(id);
      await db.query("INSERT INTO characters(id,event_id,user_id,status,profile,badge_code,inventory_initialized) VALUES($1,$2,NULL,'approved',$3,$4,true)", [id, event.id, JSON.stringify(profile), code()]);
      for (const item of profile.startingEquipment) await db.query("INSERT INTO character_inventory(id,event_id,character_id,name,quantity,notes) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), event.id, id, item.name, item.quantity, item.notes]);
    }
    return ids;
  }
  async function guardEventCreation(db, user) {
    if (!(await db.query("SELECT id FROM users WHERE id=$1 AND NOT is_disabled FOR UPDATE", [user.id])).rows[0]) fail(401, "Sign in to continue.");
    if ((await db.query("SELECT count(*)::int AS n FROM events WHERE owner_user_id=$1 AND created_at>now()-interval '1 hour'", [user.id])).rows[0].n >= 40) fail(429, "Event creation limit reached. Try again later.");
  }
  async function newEvent(db, user, name, description, setup, status = "draft") {
    const row = (await db.query("INSERT INTO events(id,owner_user_id,name,description,setup,status) VALUES($1,$2,$3,$4,$5,$6) RETURNING *", [randomUUID(), user.id, characterText(name, "Event name", 2, 100), characterText(description, "Event description", 0, 2000), JSON.stringify(validateSetup(setup)), status])).rows[0];
    await db.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'owner')", [row.id, user.id]);
    return { ...row, role: "owner" };
  }
  function actionInput(input, override) {
    const common = ["requestId", "version", "characterId", "nodeId", "kind"];
    const extras = override ? {} : { examine: ["examId", "code"], open: ["code"], attempt: ["answer"], hint: ["hintIndex"], join: [], leave: [] };
    const kinds = override ? ["release", "solve", "reset_attempts"] : Object.keys(extras);
    if (!kinds.includes(input.kind)) fail(400, "Choose a supported adventure action.");
    characterRecord(input, [...common, ...(extras[input.kind] || [])], "Adventure action", [...common, ...(!override && ["examine", "attempt", "hint"].includes(input.kind) ? extras[input.kind] : [])]);
    identifier(input.requestId); identifier(input.characterId);
    if (typeof input.nodeId !== "string" || !/^[a-z][a-z0-9-]{0,47}$/.test(input.nodeId)) fail(400, "Choose a valid instrument identifier.");
    if (!Number.isInteger(input.version) || input.version < 1) fail(400, "Provide the current adventure version.");
    const normalized = Object.fromEntries(Object.keys(input).sort().map((key) => [key, input[key]]));
    return createHash("sha256").update(JSON.stringify({ override, input: normalized })).digest("hex");
  }

  return async function handleAdventure({ req, res, path, url, method, user }) {
    const template = /^\/api\/adventure-templates(?:\/([^/]+))?$/.exec(path);
    const route = /^\/api\/events\/([^/]+)\/adventure\/(manage|rehearsal|reset|play|lookup|action|override)$/.exec(path);
    if (!template && !route) return false;
    if (!user) fail(401, "Sign in to continue.");
    if (template) {
      if (!template[1] && method === "GET") { send(res, 200, { templates: ADVENTURE_TEMPLATES }); return true; }
      if (!template[1] || method !== "POST") fail(404, "Adventure template not found.");
      const input = await body(req); characterRecord(input, ["name"], "Template creation", []);
      if (!ADVENTURE_TEMPLATES.some((entry) => entry.id === template[1])) fail(404, "Adventure template not found.");
      const pack = buildAdventureTemplate(template[1]);
      const setup = validateSetup(pack.setup), definition = validateAdventure(pack.definition, setup);
      const event = await transaction(pool, async (db) => {
        // Serialize factory creation by account, so templates cannot bypass the
        // existing practical event limit with concurrent requests.
        await guardEventCreation(db, user);
        const created = await newEvent(db, user, input.name === undefined ? pack.name : input.name, pack.description, setup);
        await db.query("INSERT INTO event_adventures(event_id,definition) VALUES($1,$2)", [created.id, JSON.stringify(definition)]);
        await seedSharing(db, created.id, definition);
        await seedCharacters(db, created, pack.characters);
        await seedStory(db, created, user.id);
        await seedEconomy(db, created, user.id);
        await seedSigil(db, created, user.id);
        await seedStatic(db, created, user.id);
        await seedStagehand(db, created, user.id);
        await audit(db, created.id, user.id, "adventure.template_created", { templateId: template[1] });
        return created;
      });
      send(res, 201, { event: safeEvent(event) }); return true;
    }
    const eventId = identifier(route[1]), action = route[2];
    if (method === "GET") {
      const event = await membership(pool, eventId, user.id), record = await adventure(pool, eventId);
      if (action === "manage") { requireManager(event); send(res, 200, await manageSnapshot(pool, event, record)); return true; }
      if (!["play", "lookup"].includes(action)) fail(405, "Method not allowed.");
      const previewValue = url.searchParams.get("preview");
      if (previewValue !== null && !["true", "false"].includes(previewValue)) fail(400, "Preview must be true or false.");
      const preview = previewValue === "true";
      const character = await characterFor(pool, event, user, url.searchParams.get("characterId"), { preview });
      const result = await snapshot(pool, event, user, record, character, preview);
      if (action === "lookup") {
        if (!character || character.status !== "approved") fail(409, "Choose an approved character before scanning a prop.");
        const propCode = url.searchParams.get("code");
        if (!ADVENTURE_CODE.test(propCode || "")) fail(400, "Enter a valid 20-character prop code.");
        const node = record.definition.nodes.find((node) => node.code === propCode && result.nodes.some(visible => visible.id === node.id));
        if (!node) fail(404, "This prop is not available in this event.");
        if (!matches(node.conditions, character, await runFor(pool, event.id, character.id), event)) fail(403, "This character has not unlocked this prop.");
        result.focusNodeId = node.id;
      }
      send(res, 200, result); return true;
    }
    const input = await body(req, action === "manage" ? 2_100_000 : 16384);
    const result = await transaction(pool, async (db) => {
      const event = await membership(db, eventId, user.id, true);
      let record = await adventure(db, eventId);
      if (action === "manage" && method === "PUT") {
        requireManager(event); characterRecord(input, ["version", "definition"], "Adventure update"); requireVersion(input.version, record.version);
        if (!["draft", "rehearsal"].includes(event.status)) fail(409, "Adventure authoring is available only in draft or rehearsal events.");
        if ((await db.query("SELECT character_id FROM adventure_runs WHERE event_id=$1 LIMIT 1", [eventId])).rows[0]) fail(409, "This adventure already has player progress. Make a rehearsal copy, or reset a dedicated rehearsal copy before editing.");
        const definition = validateAdventure(input.definition, event.setup);
        record = (await db.query("INSERT INTO event_adventures(event_id,definition,version) VALUES($1,$2,$3) ON CONFLICT(event_id) DO UPDATE SET definition=EXCLUDED.definition,version=EXCLUDED.version,updated_at=now() RETURNING *", [eventId, JSON.stringify(definition), record.version + 1])).rows[0];
        await audit(db, eventId, user.id, "adventure.updated", { version: record.version, instruments: definition.nodes.length });
        return await manageSnapshot(db, event, record);
      }
      if (action === "rehearsal" && method === "POST") {
        requireManager(event); characterRecord(input, [], "Rehearsal creation");
        if (!record.version) fail(409, "Save an adventure before creating a rehearsal copy.");
        validateAdventure(record.definition, event.setup);
        await guardEventCreation(db, user);
        const sourceProfiles = (await db.query("SELECT id,profile FROM characters WHERE event_id=$1 ORDER BY created_at,id LIMIT 101", [event.id])).rows;
        if (sourceProfiles.length > 100) fail(409, "A rehearsal copy supports at most 100 characters. Create a smaller rehearsal event for this adventure.");
        const copied = await newEvent(db, user, `${event.name.slice(0, 88)} rehearsal`, event.description, event.setup, "rehearsal");
        const definition = structuredClone(record.definition); for (const node of definition.nodes) node.code = code();
        await db.query("INSERT INTO event_adventures(event_id,definition,is_rehearsal,source_event_id) VALUES($1,$2,true,$3)", [copied.id, JSON.stringify(definition), event.id]);
        await copySharing(db, event.id, copied.id);
        const oldFactions = (await db.query("SELECT * FROM factions WHERE event_id=$1", [event.id])).rows;
        const mapped = new Map(), newFactions = [];
        for (const faction of oldFactions) { const id = randomUUID(); mapped.set(faction.id, id); newFactions.push({ id, name: faction.name, description: faction.description }); await db.query("INSERT INTO factions(id,event_id,name,description) VALUES($1,$2,$3,$4)", [id, copied.id, faction.name, faction.description]); }
        const profiles = sourceProfiles.map(({ profile: original }) => {
          const profile = structuredClone(original), defaults = defaultCharacterProfile(copied.setup.rules);
          profile.attributes = Object.fromEntries(copied.setup.rules.attributes.map((rule) => [rule.id, typeof profile.attributes[rule.id] === "number" && profile.attributes[rule.id] >= rule.min && profile.attributes[rule.id] <= rule.max ? profile.attributes[rule.id] : defaults.attributes[rule.id]]));
          profile.skills = profile.skills.filter((skill) => copied.setup.rules.expertise.some((rule) => rule.id === skill)); profile.factionId = mapped.get(profile.factionId) || null;
          return { profile };
        });
        const characterIds = await seedCharacters(db, copied, profiles, newFactions);
        const characterMap = new Map(sourceProfiles.map((profile, index) => [profile.id, characterIds[index]]));
        await copyStory(db, event, copied, { characterMap, factionMap: mapped }, user.id);
        await copyEconomy(db, event.id, copied.id, user.id);
        await copySigil(db, event.id, copied.id, user.id);
        await copyStatic(db, event.id, copied.id, user.id);
        await copyStagehand(db, event.id, copied.id, user.id);
        await captureEconomyBaseline(db, copied.id);
        const oldSettings = (await db.query("SELECT * FROM event_character_settings WHERE event_id=$1", [event.id])).rows[0];
        if (oldSettings) await db.query("INSERT INTO event_character_settings(event_id,allow_player_creation,require_approval,max_per_player,public_fields) VALUES($1,$2,$3,$4,$5)", [copied.id, oldSettings.allow_player_creation, oldSettings.require_approval, oldSettings.max_per_player, JSON.stringify(oldSettings.public_fields)]);
        await audit(db, copied.id, user.id, "adventure.rehearsal_created", { sourceEventId: event.id });
        return { event: safeEvent(copied) };
      }
      if (action === "reset" && method === "POST") {
        requireManager(event); characterRecord(input, ["version", "confirm"], "Rehearsal reset"); requireVersion(input.version, record.version);
        if (!record.is_rehearsal || event.status !== "rehearsal" || input.confirm !== true) fail(409, "Only a dedicated rehearsal copy in rehearsal mode can be reset with confirmation.");
        // Remove exchange provenance before the readings it references. These
        // tables belong only to this rehearsal; the source event is untouched.
        await resetStory(db, eventId);
        await resetOaths(db, eventId);
        await resetSigil(db, eventId);
        await resetStatic(db, eventId);
        await resetStagehand(db, eventId);
        await resetEconomy(db, eventId);
        for (const table of ["exchange_requests", "exchange_contacts", "exchange_receipts", "exchange_copies", "exchange_sessions", "adventure_attendance", "adventure_journal", "adventure_requests", "adventure_runs"]) await db.query(`DELETE FROM ${table} WHERE event_id=$1`, [eventId]);
        record = (await db.query("UPDATE event_adventures SET version=version+1,updated_at=now() WHERE event_id=$1 RETURNING *", [eventId])).rows[0];
        await audit(db, event.id, user.id, "adventure.rehearsal_reset", { version: record.version });
        return await manageSnapshot(db, event, record);
      }
      if (!["action", "override"].includes(action) || method !== "POST") fail(405, "Method not allowed.");
      const override = action === "override"; if (override) requireManager(event);
      requirePlayable(event);
      const hash = actionInput(input, override);
      const character = await characterFor(db, event, user, input.characterId, { preview: override, action: true });
      const sharing = await readSharing(db, eventId);
      const node = record.definition.nodes.find((node) => node.id === input.nodeId && event.setup.enabledInstruments.includes(instrumentId(node.type)) && sharingPolicyFor(sharing, node.id) !== "organizer_only");
      if (!node) fail(404, "Instrument not found or unavailable.");
      // Permissions and lifecycle are checked before every replay, including
      // cached requests whose original action happened before revocation.
      const prior = (await db.query("SELECT payload_hash,outcome FROM adventure_requests WHERE event_id=$1 AND character_id=$2 AND request_id=$3", [eventId, character.id, input.requestId])).rows[0];
      if (prior) {
        if (prior.payload_hash !== hash) fail(409, "This request identifier was already used for a different action.");
        return { ...(await snapshot(db, event, user, record, character, override)), outcome: { ...prior.outcome, replayed: true } };
      }
      requireVersion(input.version, record.version);
      const run = await runFor(db, eventId, character.id), progress = progressFor(run, node.id);
      if (!override && input.kind !== "leave" && !matches(node.conditions, character, run, event)) fail(403, "This character has not unlocked this instrument.");
      if ((await db.query("SELECT count(*)::int AS n FROM adventure_requests WHERE event_id=$1 AND character_id=$2", [eventId, character.id])).rows[0].n >= 5000) fail(429, "This character has reached the action request limit for this adventure.");
      let message = "Action recorded.", changed = false;
      const succeed = () => { if (!progress.completed) { progress.completed = true; progress.failed = false; setFlags(run, node.actions.success); changed = true; } };
      if (override && input.kind === "reset_attempts") {
        if (node.type !== "cipherbox" || !progress.failed || progress.completed) fail(409, "Only a failed, unsolved puzzle can have attempts reset.");
        progress.attempts = 0; progress.failed = false; progress.lastAttemptAt = null; changed = true;
        message = "Puzzle attempts reset. Previous discoveries and applied flags are preserved.";
      } else if (override) {
        if (input.kind === "solve" && node.type !== "cipherbox") fail(400, "Solve applies only to a puzzle.");
        if (input.kind === "release" && node.type === "cipherbox") fail(400, "Use solve to release a puzzle.");
        if (node.type === "relic") {
          const exam = node.examinations[0];
          await journal(db, event, character, node, `${node.id}:exam:${exam.id}`, `${node.title}: ${exam.label}`, exam.text);
          if (!progress.examinations.includes(exam.id)) { progress.examinations.push(exam.id); setFlags(run, exam.actions); }
        } else await journal(db, event, character, node, `${node.id}:success`, node.title, node.type === "cipherbox" ? node.successText : node.body, node.audio || null);
        succeed(); message = "Organizer outcome applied.";
      } else if (input.kind === "examine") {
        if (node.type !== "relic") fail(400, "Examine applies only to a relic.");
        if (input.code !== node.code) fail(400, "Scan this relic or enter its printed prop code.");
        const exam = node.examinations.find((exam) => exam.id === input.examId);
        if (!exam) fail(404, "Examination not found.");
        if (!matches(exam.conditions, character, run, event)) fail(403, "This character cannot perform that examination.");
        if (!progress.examinations.includes(exam.id)) { await journal(db, event, character, node, `${node.id}:exam:${exam.id}`, `${node.title}: ${exam.label}`, exam.text); progress.examinations.push(exam.id); setFlags(run, exam.actions); changed = true; }
        succeed(); message = "Reading saved to your journal.";
      } else if (input.kind === "open") {
        if (node.type !== "dead_drop") fail(400, "Open applies only to a dead drop.");
        if (node.releaseCode !== null && (!input.code || fold(characterText(input.code, "Release code", 1, 80)) !== fold(node.releaseCode))) fail(400, "The release code is incorrect.");
        if (!progress.completed) await journal(db, event, character, node, `${node.id}:success`, node.title, node.body, node.audio);
        succeed(); message = "Message saved to your journal.";
      } else if (input.kind === "attempt") {
        if (node.type !== "cipherbox") fail(400, "Answer attempts apply only to a puzzle.");
        const answer = characterText(input.answer, "Puzzle answer", 1, 80);
        if (progress.completed) message = "This puzzle is already solved.";
        else {
          if (progress.failed) fail(409, "This puzzle has no attempts remaining. Ask an organizer for help.");
          if (Date.now() - Date.parse(progress.lastAttemptAt || "1970-01-01") < 1000) fail(429, "Wait one second before trying another answer.");
          progress.attempts++; progress.lastAttemptAt = new Date().toISOString(); changed = true;
          const correct = node.match === "exact" ? answer === node.answer : fold(answer) === fold(node.answer);
          if (correct) { succeed(); await journal(db, event, character, node, `${node.id}:success`, node.title, node.successText); message = "Puzzle solved. The result is in your journal."; }
          else if (progress.attempts >= node.maxAttempts) { progress.failed = true; setFlags(run, node.actions.failure); await journal(db, event, character, node, `${node.id}:failure`, node.title, node.failureText); message = "No attempts remain. The result is in your journal."; }
          else message = "That answer did not unlock the puzzle.";
        }
      } else if (input.kind === "hint") {
        if (node.type !== "cipherbox") fail(400, "Hints apply only to a puzzle.");
        const index = characterInteger(input.hintIndex, "Hint number", 0, 4), hint = node.hints[index];
        if (!hint || progress.attempts < hint.afterAttempts) fail(403, "This hint is not available yet.");
        if (!progress.hints.includes(index)) { progress.hints.push(index); changed = true; await journal(db, event, character, node, `${node.id}:hint:${index}`, `${node.title}: hint ${index + 1}`, hint.text, null, "hint"); }
        message = "Hint saved to your journal.";
      } else if (input.kind === "join") {
        if (node.type !== "wayfinder") fail(400, "Join applies only to a scene.");
        const operation = await stagehandWayfinderState(db, event, node, character, { lock: true });
        if (operation && !operation.canJoin) fail(409, operation.reason || "Check STAGEHAND for your scene assignment.");
        const existing = (await db.query("SELECT character_id FROM adventure_attendance WHERE event_id=$1 AND node_id=$2 AND character_id=$3", [eventId, node.id, character.id])).rows[0];
        if (!existing) {
          if (node.availability !== "open" || (node.endsAt && Date.parse(node.endsAt) <= Date.now())) fail(409, "This scene is closed.");
          if (node.startsAt && Date.parse(node.startsAt) > Date.now()) fail(409, "This scene has not started yet.");
          // Remove abandoned reservations before allocating a freed seat. A
          // later reapproval or rejoin cannot resurrect an old reservation.
          await db.query("DELETE FROM adventure_attendance a WHERE a.event_id=$1 AND NOT EXISTS(SELECT 1 FROM characters c JOIN users u ON u.id=c.user_id WHERE c.event_id=a.event_id AND c.id=a.character_id AND c.status='approved' AND NOT u.is_disabled AND (u.is_superuser OR EXISTS(SELECT 1 FROM memberships m WHERE m.event_id=a.event_id AND m.user_id=c.user_id)))", [eventId]);
          const count = (await db.query("SELECT count(*)::int AS n FROM adventure_attendance WHERE event_id=$1 AND node_id=$2", [eventId, node.id])).rows[0].n;
          if (!operation && count >= node.maxPlayers) fail(409, "This scene is full.");
          await db.query("INSERT INTO adventure_attendance(event_id,node_id,character_id) VALUES($1,$2,$3)", [eventId, node.id, character.id]);
          changed = true;
        }
        if (!progress.completed) await journal(db, event, character, node, `${node.id}:success`, node.title, `${node.body}${node.location ? `\n\nLocation: ${node.location}` : ""}`);
        succeed(); message = "You have joined this scene.";
      } else if (input.kind === "leave") {
        if (node.type !== "wayfinder") fail(400, "Leave applies only to a scene.");
        await db.query("DELETE FROM adventure_attendance WHERE event_id=$1 AND node_id=$2 AND character_id=$3", [eventId, node.id, character.id]); changed = true; message = "You have left this scene.";
      }
      run.progress[node.id] = progress; await saveRun(db, run);
      const outcome = { kind: input.kind, message, replayed: false };
      await db.query("INSERT INTO adventure_requests(event_id,character_id,request_id,payload_hash,outcome) VALUES($1,$2,$3,$4,$5)", [eventId, character.id, input.requestId, hash, JSON.stringify(outcome)]);
      if (changed || override) await audit(db, eventId, user.id, override ? "adventure.override" : "adventure.action", { characterId: character.id, nodeId: node.id, kind: input.kind });
      return { ...(await snapshot(db, event, user, record, character, override)), outcome };
    });
    send(res, action === "rehearsal" ? 201 : 200, result); return true;
  };
}
