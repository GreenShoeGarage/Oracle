import { createHash, randomInt, randomUUID } from 'node:crypto';
import { characterInteger, characterRecord, characterText } from '../public/characters-model.js';
import { defaultAdventureConditions } from '../public/adventure-model.js';
import { storyUUID } from '../public/story-model.js';
import { defaultStaticDocument, staticCode, staticSlug, validateStaticDocument } from '../public/static-model.js';
import { ownStoryCharacter, storyConditionsPass, storyContext } from './story.js';

const managers = new Set(['owner', 'organizer', 'superuser']);
const operators = new Set([...managers, 'staff']);
const playable = event => ['live', 'rehearsal'].includes(event.status);
const enabled = event => event.setup.enabledInstruments.includes('static');
const reject = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const code = () => Array.from({ length: 20 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join('');
const eventDTO = event => ({ id: event.id, name: event.name, status: event.status, role: event.role });
const characterDTO = row => ({ id: row.id, name: row.profile.name });
const readingDTO = row => ({ id: row.id, nodeId: row.node_id, entryKey: row.entry_key, title: row.title, text: row.text, audio: row.audio, type: row.type, createdAt: row.created_at });
const overrideDTO = row => ({ version: row?.override_version || 0, stateId: row?.state_id || null, reason: row?.override_reason || '' });
const safePublication = document => document ? { title: document.title, summary: document.summary, zoneLabel: document.zoneLabel, states: document.states.map(state => ({ ...state })), defaultStateId: document.defaultStateId } : null;
const entryDTO = (row, canManage) => ({ id: row.id, version: row.version, publishedVersion: row.published_version, status: canManage ? row.status : row.status === 'withdrawn' ? 'withdrawn' : 'published', code: row.code, document: canManage ? row.document : safePublication(row.published), published: canManage ? row.published : safePublication(row.published), override: overrideDTO(row) });
const entrySelect = 'SELECT e.*,o.version AS override_version,o.state_id,o.reason AS override_reason FROM static_entries e LEFT JOIN static_overrides o ON o.event_id=e.event_id AND o.entry_id=e.id';
const entriesFor = async (db, eventId) => (await db.query(`${entrySelect} WHERE e.event_id=$1 ORDER BY e.created_at,e.id`, [eventId])).rows;
const entryFor = async (db, eventId, id) => (await db.query(`${entrySelect} WHERE e.event_id=$1 AND e.id=$2`, [eventId, id])).rows[0];
const runFor = async (db, eventId, characterId) => (await db.query('SELECT progress,flags FROM adventure_runs WHERE event_id=$1 AND character_id=$2', [eventId, characterId])).rows[0] || { progress: {}, flags: {} };

function availability(entry, event, character, run, context) {
  if (!enabled(event)) return 'STATIC is not enabled in this event.';
  if (!entry?.published || entry.status === 'withdrawn') return 'This reading is not published.';
  if (!character) return 'Choose an approved character assigned to you.';
  // Validate every prepared rule before choosing even the default. Removing a
  // referenced discovery must never accidentally expose a fallback reading.
  try { validateStaticDocument(entry.published, context.definition, event.setup.rules); }
  catch { return 'The organizer needs to review this reading’s conditions.'; }
  if (!storyConditionsPass(entry.published.conditions, character, event, run, context)) return 'This character has not met the conditions for this reading.';
  return null;
}
function signalDTO(entry, event, character, run, context) {
  const blockedReason = availability(entry, event, character, run, context);
  if (blockedReason) reject(404, 'This reading is not available to this character.');
  const document = entry.published;
  let stateId = document.defaultStateId, source = 'prepared';
  const rule = document.rules.find(rule => storyConditionsPass(rule.conditions, character, event, run, context));
  if (rule) { stateId = rule.stateId; source = 'conditions'; }
  if (entry.state_id) {
    if (!document.states.some(state => state.id === entry.state_id)) reject(404, 'This reading is not available to this character.');
    stateId = entry.state_id; source = 'organizer';
  }
  const state = document.states.find(state => state.id === stateId);
  if (!state) reject(404, 'This reading is not available to this character.');
  return { id: entry.id, title: document.title, zoneLabel: document.zoneLabel, publicationVersion: entry.published_version, readingKey: digest({ entryId: entry.id, publicationVersion: entry.published_version, stateId, source, overrideVersion: entry.override_version || 0 }), state: { ...state }, fictional: true, label: 'Fictional event reading', source, serverTime: new Date().toISOString(), canCollect: playable(event), readOnly: !playable(event), blockedReason: playable(event) ? null : 'This event must be live or in rehearsal to save a reading.' };
}

export async function resetStatic(db, eventId) {
  for (const table of ['static_requests', 'static_history', 'static_readings', 'static_overrides']) await db.query(`DELETE FROM ${table} WHERE event_id=$1`, [eventId]);
}
export async function copyStatic(db, sourceEventId, eventId, actorId) {
  const source = typeof sourceEventId === 'string' ? sourceEventId : sourceEventId.id;
  const target = typeof eventId === 'string' ? eventId : eventId.id;
  for (const entry of (await db.query('SELECT * FROM static_entries WHERE event_id=$1 ORDER BY created_at,id', [source])).rows) {
    await db.query('INSERT INTO static_entries(id,event_id,code,document,status,published,published_version,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), target, code(), JSON.stringify(entry.document), entry.status, entry.published ? JSON.stringify(entry.published) : null, entry.published ? 1 : null, actorId]);
  }
}
export async function seedStatic(db, event, actorId) {
  if ((await db.query('SELECT id FROM static_entries WHERE event_id=$1 LIMIT 1', [event.id])).rows.length) return;
  const context = await storyContext(db, event);
  const theme = event.setup.theme?.id || event.setup.themeId || 'fantasy';
  const themeCopy = theme === 'cyberpunk'
    ? ['Relay diagnostic', 'Relay chamber', 'Relay instability', 'The fictional relay spectrum is fragmented. Complete the cooperative relay procedure to align the signal.', 'Relay synchronized', 'The fictional relay reports a coherent carrier after the cooperative procedure.']
    : theme === 'wasteland'
      ? ['Pump diagnostic', 'Water station', 'Pump instability', 'The fictional pump reading is uneven. Complete the cooperative repair to restore the flow.', 'Flow restored', 'The fictional station reports a steady flow after the cooperative repair.']
      : ['Resonance reading', 'Relic sanctuary', 'Unsettled resonance', 'The fictional resonance is scattered. Complete the cooperative ritual to steady the pattern.', 'Resonance restored', 'The fictional sanctuary resonates steadily after the cooperative ritual.'];
  const document = validateStaticDocument({ ...defaultStaticDocument(), title: themeCopy[0], summary: 'Read this prop’s fictional event state and save a journal copy.', organizerNotes: 'This is fictional game information, not a real-world sensor. The default reading changes when the cooperative SIGIL challenge sets cooperation-complete. Staff may select a prepared state for the scene, then restore automatic conditions.', zoneLabel: themeCopy[1], states: [{ id: 'unsettled', label: themeCopy[2], text: themeCopy[3], level: 25, tone: 'alert' }, { id: 'restored', label: themeCopy[4], text: themeCopy[5], level: 85, tone: 'calm' }], rules: context.definition.flags.some(flag => flag.id === 'cooperation-complete') ? [{ id: 'cooperation-restored', conditions: { ...defaultAdventureConditions(), flags: ['cooperation-complete'] }, stateId: 'restored' }] : [] }, context.definition, event.setup.rules);
  await db.query("INSERT INTO static_entries(id,event_id,code,document,status,published,published_version,created_by) VALUES($1,$2,$3,$4,'published',$4,1,$5)", [randomUUID(), event.id, code(), JSON.stringify(document), actorId]);
}

export function createStaticHandler({ pool, helpers }) {
  const { body, send, fail, membership, transaction, audit } = helpers;
  const lookupRates = new Map();
  const requireManager = event => { if (!managers.has(event.role)) fail(403, 'Only an organizer can author, publish, or withdraw STATIC readings.'); };
  const requireOperator = event => { if (!operators.has(event.role)) fail(403, 'Only current event staff can operate STATIC readings.'); };
  const requirePlayable = event => { if (!playable(event)) fail(409, 'This event must be live or in rehearsal.'); if (!enabled(event)) fail(404, 'STATIC is not enabled in this event.'); };
  const requireVersion = (value, current) => { if (value !== current) fail(409, 'This STATIC record changed. Reload and review before continuing.'); };
  function limitLookup(eventId, userId) {
    const now = Date.now(), key = `${eventId}:${userId}`;
    for (const [id, state] of lookupRates) if (state.until <= now) lookupRates.delete(id);
    const state = lookupRates.get(key) || { count: 0, until: now + 60000 };
    if (state.count >= 40 || (!lookupRates.has(key) && lookupRates.size >= 10000)) fail(429, 'Too many prop lookups. Wait a minute before trying again.');
    state.count++; lookupRates.set(key, state);
  }
  async function manage(db, event) {
    const context = await storyContext(db, event), canManage = managers.has(event.role);
    const entries = (await entriesFor(db, event.id)).filter(entry => canManage || entry.published).map(entry => entryDTO(entry, canManage));
    return { event: eventDTO(event), entries, context: { nodes: context.definition.nodes.map(node => ({ id: node.id, title: node.title })), flags: context.definition.flags.map(flag => ({ id: flag.id, name: flag.name })), skills: event.setup.rules.expertise.map(skill => ({ id: skill.id, name: skill.name })) }, canManage, canOperate: operators.has(event.role), readOnly: event.status === 'archived' };
  }
  async function overview(db, event, user, character) {
    const context = await storyContext(db, event), run = character ? await runFor(db, event.id, character.id) : { progress: {}, flags: {} };
    const signals = (await entriesFor(db, event.id)).filter(entry => entry.published && entry.status !== 'withdrawn').map(entry => { const blockedReason = availability(entry, event, character, run, context); return { id: entry.id, title: entry.published.title, summary: entry.published.summary, zoneLabel: entry.published.zoneLabel, publishedVersion: entry.published_version, available: !blockedReason, blockedReason }; });
    const readings = character ? (await db.query('SELECT j.id,j.node_id,j.title,j.type,j.created_at,r.entry_id,r.publication_version,r.reading_key FROM static_readings r JOIN adventure_journal j ON j.id=r.journal_id AND j.event_id=r.event_id WHERE r.event_id=$1 AND r.owner_user_id=$2 AND r.character_id=$3 ORDER BY r.created_at DESC,r.id DESC LIMIT 100', [event.id, user.id, character.id])).rows.map(row => ({ id: row.id, nodeId: row.node_id, title: row.title, type: row.type, createdAt: row.created_at, entryId: row.entry_id, publicationVersion: row.publication_version, readingKey: row.reading_key })) : [];
    return { event: eventDTO(event), character: character ? characterDTO(character) : null, characters: context.characters.filter(row => row.user_id === user.id).map(characterDTO), signals, readings, canManage: managers.has(event.role), canOperate: operators.has(event.role), readOnly: !character || !playable(event) || !enabled(event) };
  }
  async function lookup(db, event, user, characterId, propCode, target = null) {
    const character = await ownStoryCharacter(db, event, user, characterId);
    if (!character) fail(409, 'Choose an approved character assigned to you.');
    const entry = target ? await entryFor(db, event.id, target) : (await db.query(`${entrySelect} WHERE e.event_id=$1 AND e.code=$2`, [event.id, propCode])).rows[0];
    if (!entry || entry.code !== propCode) fail(404, 'This reading is not available to this character.');
    const context = await storyContext(db, event), run = await runFor(db, event.id, character.id);
    return { signal: signalDTO(entry, event, character, run, context), character, entry };
  }
  async function recordRequest(db, event, user, input, hash, action, targetId) {
    await db.query('INSERT INTO static_requests(event_id,actor_user_id,request_id,payload_hash,action,target_id) VALUES($1,$2,$3,$4,$5,$6)', [event.id, user.id, input.requestId, hash, action, targetId]);
  }
  async function history(db, event, user, entry, action, reason = '', details = {}) {
    const atCapacity = (await db.query('SELECT count(*)::int AS n FROM static_history WHERE event_id=$1 AND entry_id=$2', [event.id, entry.id])).rows[0].n >= 512;
    if (atCapacity && action !== 'withdraw') fail(429, 'This STATIC entry has reached its change history limit. It can still be withdrawn.');
    if (!atCapacity) await db.query('INSERT INTO static_history(id,event_id,entry_id,actor_user_id,action,version,reason,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), event.id, entry.id, user.id, action, entry.version, reason, JSON.stringify(details)]);
    await audit(db, event.id, user.id, `static.${action}`, { entryId: entry.id, version: entry.version, ...(reason ? { reason } : {}), ...details });
  }
  return async function handleStatic({ req, res, path, url, method, user }) {
    const route = /^\/api\/events\/([^/]+)\/static(?:\/(manage|lookup|collect|entries)(?:\/([^/]+))?(?:\/(publish|withdraw|state))?)?$/.exec(path);
    if (!route) return false;
    if (!user) fail(401, 'Sign in to continue.');
    const eventId = storyUUID(route[1], 'Event'), section = route[2] || null, target = route[3] ? storyUUID(route[3]) : null, verb = route[4] || null;
    if (method === 'GET') {
      if (verb || (!section && target) || (section === 'manage' && target) || ![null, 'manage', 'entries'].includes(section) || (section === 'entries' && !target)) fail(405, 'Method not allowed.');
      const event = await membership(pool, eventId, user.id);
      if (section === 'manage') { requireOperator(event); send(res, 200, await manage(pool, event)); }
      else if (section === 'entries') {
        limitLookup(eventId, user.id);
        const { signal } = await lookup(pool, event, user, storyUUID(url.searchParams.get('characterId'), 'Character'), staticCode(url.searchParams.get('code')), target);
        send(res, 200, { signal });
      } else send(res, 200, await overview(pool, event, user, await ownStoryCharacter(pool, event, user, url.searchParams.get('characterId'))));
      return true;
    }
    const validRoute = (['lookup', 'collect'].includes(section) && method === 'POST' && !target && !verb) || (section === 'entries' && ((!target && method === 'POST' && !verb) || (target && method === 'PUT' && !verb) || (target && method === 'POST' && verb)));
    if (!validRoute) fail(405, 'Method not allowed.');
    const input = await body(req, 262144);
    const keys = section === 'lookup' ? ['characterId', 'code'] : section === 'collect' ? ['requestId', 'characterId', 'entryId', 'code', 'publicationVersion', 'readingKey'] : verb === 'state' ? ['requestId', 'version', 'stateId', 'reason'] : verb ? ['requestId', 'version'] : target ? ['requestId', 'version', 'document'] : ['requestId', 'document'];
    characterRecord(input, keys, 'STATIC request');
    if (section === 'lookup') {
      const event = await membership(pool, eventId, user.id);
      limitLookup(eventId, user.id);
      const { signal } = await lookup(pool, event, user, storyUUID(input.characterId, 'Character'), staticCode(input.code));
      send(res, 200, { signal }); return true;
    }
    input.requestId = storyUUID(input.requestId, 'Request');
    if (Object.hasOwn(input, 'version')) input.version = characterInteger(input.version, 'Version', verb === 'state' ? 0 : 1, 2147483647);
    if (section === 'collect') {
      input.characterId = storyUUID(input.characterId, 'Character'); input.entryId = storyUUID(input.entryId, 'Entry'); input.code = staticCode(input.code);
      input.publicationVersion = characterInteger(input.publicationVersion, 'Publication version', 1, 2147483647);
      if (typeof input.readingKey !== 'string' || !/^[0-9a-f]{64}$/.test(input.readingKey)) fail(400, 'Use the current fictional reading before saving it.');
    }
    if (verb === 'state') { input.stateId = input.stateId === null ? null : staticSlug(input.stateId, 'State'); input.reason = characterText(input.reason, 'Override reason', 1, 2000); }
    const action = section === 'collect' ? 'collect' : verb || (target ? 'updated' : 'created'), hash = digest({ action, target, input });
    const result = await transaction(pool, async db => {
      let event = await membership(db, eventId, user.id, true);
      await db.query('SELECT id FROM users WHERE id=$1 FOR SHARE', [user.id]);
      event = await membership(db, eventId, user.id);
      if (section === 'entries') (verb === 'state' ? requireOperator : requireManager)(event);
      const prior = (await db.query('SELECT * FROM static_requests WHERE event_id=$1 AND actor_user_id=$2 AND request_id=$3', [event.id, user.id, input.requestId])).rows[0];
      if (prior && prior.payload_hash !== hash) fail(409, 'This request identifier was already used for a different action.');
      // A receipt acknowledges a committed capture even after the live scene
      // changes. It never grants a fresh reading or transfers a former owner's
      // copy; current membership and current character assignment still apply.
      if (prior && section === 'collect') {
        const character = await ownStoryCharacter(db, event, user, input.characterId);
        if (!character) fail(404, 'Character not found or not assigned to you.');
        const reading = (await db.query('SELECT j.* FROM static_readings r JOIN adventure_journal j ON j.id=r.journal_id AND j.event_id=r.event_id WHERE r.event_id=$1 AND r.owner_user_id=$2 AND r.character_id=$3 AND r.entry_id=$4 AND r.reading_key=$5', [event.id, user.id, character.id, input.entryId, input.readingKey])).rows[0];
        if (!reading) fail(404, 'The captured reading is no longer available.');
        let signal = null;
        try { signal = (await lookup(db, event, user, input.characterId, input.code, input.entryId)).signal; }
        catch (error) { if (error.status !== 404) throw error; }
        return { reading: readingDTO(reading), signal, outcome: { replayed: true, alreadyCollected: true } };
      }
      if (event.status === 'archived') fail(409, 'Archived events cannot change STATIC records.');
      if (section === 'collect' || verb === 'state') requirePlayable(event);
      if (!prior && (await db.query('SELECT count(*)::int AS n FROM static_requests WHERE event_id=$1 AND actor_user_id=$2', [event.id, user.id])).rows[0].n >= 10000) fail(429, 'STATIC request history is full for this account and event.');
      if (section === 'collect') {
        const { signal, character, entry } = await lookup(db, event, user, input.characterId, input.code, input.entryId);
        if (signal.publicationVersion !== input.publicationVersion || signal.readingKey !== input.readingKey) fail(409, 'The fictional reading changed. Refresh and review it before saving.');
        let reading = (await db.query('SELECT j.* FROM static_readings r JOIN adventure_journal j ON j.id=r.journal_id AND j.event_id=r.event_id WHERE r.event_id=$1 AND r.owner_user_id=$2 AND r.character_id=$3 AND r.entry_id=$4 AND r.reading_key=$5', [event.id, user.id, character.id, entry.id, signal.readingKey])).rows[0];
        const alreadyCollected = Boolean(reading);
        if (!reading) {
          if ((await db.query('SELECT count(*)::int AS n FROM static_readings WHERE event_id=$1 AND character_id=$2', [event.id, character.id])).rows[0].n >= 2000) fail(429, 'This character has reached the STATIC reading limit.');
          const journalId = randomUUID(), text = `Fictional event reading${signal.zoneLabel ? ` · ${signal.zoneLabel}` : ''}\n\n${signal.state.label} · ${signal.state.level}/100\n\n${signal.state.text}`;
          reading = (await db.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,type) VALUES($1,$2,$3,$4,$5,$6,$7,'static') RETURNING *", [journalId, event.id, character.id, `static:${entry.id}`, `static:${entry.id}:${signal.readingKey}:${journalId}`, signal.title, text])).rows[0];
          await db.query('INSERT INTO static_readings(id,event_id,entry_id,owner_user_id,character_id,publication_version,reading_key,state_id,source,journal_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [randomUUID(), event.id, entry.id, user.id, character.id, entry.published_version, signal.readingKey, signal.state.id, signal.source, journalId]);
          await audit(db, event.id, user.id, 'static.collected', { entryId: entry.id, characterId: character.id, publicationVersion: entry.published_version, journalId });
        }
        if (!prior) await recordRequest(db, event, user, input, hash, action, entry.id);
        return { reading: readingDTO(reading), signal, outcome: { replayed: Boolean(prior), alreadyCollected } };
      }
      let entry = target || prior ? await entryFor(db, event.id, target || prior.target_id) : null;
      if ((target || prior) && !entry) fail(404, 'STATIC entry not found.');
      if (verb === 'state' && (!entry.published || entry.status === 'withdrawn')) fail(409, 'Publish this reading before operating its state.');
      if (prior) return { entry: entryDTO(entry, managers.has(event.role)), outcome: { replayed: true } };
      if (!target) {
        if ((await db.query('SELECT count(*)::int AS n FROM static_entries WHERE event_id=$1', [event.id])).rows[0].n >= 40) fail(429, 'This event has reached its forty STATIC entry limit.');
        const context = await storyContext(db, event), document = validateStaticDocument(input.document, context.definition, event.setup.rules);
        const id = randomUUID();
        await db.query('INSERT INTO static_entries(id,event_id,code,document,created_by) VALUES($1,$2,$3,$4,$5)', [id, event.id, code(), JSON.stringify(document), user.id]);
        entry = await entryFor(db, event.id, id);
      } else if (verb === 'state') {
        requireVersion(input.version, entry.override_version || 0);
        const context = await storyContext(db, event);
        validateStaticDocument(entry.published, context.definition, event.setup.rules);
        if (input.stateId !== null && !entry.published.states.some(state => state.id === input.stateId)) fail(400, 'Choose a currently published reading state.');
        await db.query('INSERT INTO static_overrides(event_id,entry_id,version,state_id,reason,actor_user_id) VALUES($1,$2,1,$3,$4,$5) ON CONFLICT(event_id,entry_id) DO UPDATE SET version=static_overrides.version+1,state_id=EXCLUDED.state_id,reason=EXCLUDED.reason,actor_user_id=EXCLUDED.actor_user_id,updated_at=clock_timestamp()', [event.id, entry.id, input.stateId, input.reason, user.id]);
        entry = await entryFor(db, event.id, entry.id);
      } else {
        requireVersion(input.version, entry.version);
        if (!verb) {
          const context = await storyContext(db, event), document = validateStaticDocument(input.document, context.definition, event.setup.rules);
          await db.query("UPDATE static_entries SET document=$3,version=version+1,status=CASE WHEN status='withdrawn' THEN 'withdrawn' ELSE 'draft' END,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2", [event.id, entry.id, JSON.stringify(document)]);
        } else if (verb === 'publish') {
          const context = await storyContext(db, event), document = validateStaticDocument(entry.document, context.definition, event.setup.rules);
          await db.query("UPDATE static_entries SET published=$3,published_version=COALESCE(published_version,0)+1,status='published',version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2", [event.id, entry.id, JSON.stringify(document)]);
          // Preserve override revision monotonicity while returning to the new
          // publication's conditions; stale staff tabs cannot resurrect it.
          await db.query("UPDATE static_overrides SET version=version+1,state_id=NULL,reason='Publication replaced; automatic conditions restored.',actor_user_id=$3,updated_at=clock_timestamp() WHERE event_id=$1 AND entry_id=$2", [event.id, entry.id, user.id]);
        } else {
          if (!entry.published) fail(409, 'This entry has no publication to withdraw.');
          await db.query("UPDATE static_entries SET status='withdrawn',version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2", [event.id, entry.id]);
        }
        entry = await entryFor(db, event.id, entry.id);
      }
      await history(db, event, user, entry, action, verb === 'state' ? input.reason : '', verb === 'state' ? { stateId: input.stateId, overrideVersion: entry.override_version } : {});
      await recordRequest(db, event, user, input, hash, action, entry.id);
      return { entry: entryDTO(entry, managers.has(event.role)), outcome: { replayed: false } };
    });
    send(res, section === 'entries' && !target && !result.outcome.replayed ? 201 : 200, result); return true;
  };
}
