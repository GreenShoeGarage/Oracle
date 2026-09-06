import { randomUUID, createHash } from 'node:crypto';
import { characterRecord, characterText } from '../public/characters-model.js';
import { defaultAdventure, ADVENTURE_EVENT_STATUSES } from '../public/adventure-model.js';
import { defaultStoryDocument, normalizeStoryAudience, validateStoryDocument, validateStoryConditions, storyUUID, storyList } from '../public/story-model.js';
const reject = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const managers = new Set(['owner', 'organizer', 'superuser']);
const authors = new Set([...managers, 'staff']);
const playable = event => ['live', 'rehearsal'].includes(event.status);
const publicCharacter = row => ({ id: row.id, name: row.profile.name });
const publicGroup = row => ({ id: row.id, name: row.name, characterIds: row.character_ids, version: row.version });
const eventProjection = event => ({ id: event.id, name: event.name, status: event.status, role: event.role });
const readingProjection = row => ({ id: row.id, nodeId: row.node_id, entryKey: row.entry_key, title: row.title, text: row.text, audio: row.audio, type: row.type, createdAt: row.created_at });
const managerEntry = row => ({ id: row.id, kind: row.kind, document: row.document, status: row.status, version: row.version, publishedVersion: row.published_version, hasPublication: Boolean(row.published) && row.status !== 'withdrawn', published: row.published, updatedAt: row.updated_at });
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hashRequest = (action, target, input) => createHash('sha256').update(JSON.stringify(stable({ action, target, input }))).digest('hex');

export async function storyContext(db, event) {
  const groups = (await db.query('SELECT * FROM story_groups WHERE event_id=$1 ORDER BY name,id', [event.id])).rows;
  const factions = (await db.query('SELECT * FROM factions WHERE event_id=$1 ORDER BY name,id', [event.id])).rows;
  const allCharacters = (await db.query(`SELECT c.*,u.is_disabled,u.is_superuser,(c.status='approved' AND c.user_id IS NOT NULL AND NOT COALESCE(u.is_disabled,true) AND (COALESCE(u.is_superuser,false) OR EXISTS(SELECT 1 FROM memberships m WHERE m.event_id=c.event_id AND m.user_id=c.user_id))) AS active FROM characters c LEFT JOIN users u ON u.id=c.user_id WHERE c.event_id=$1 ORDER BY c.created_at,c.id`, [event.id])).rows;
  const definition = (await db.query('SELECT definition FROM event_adventures WHERE event_id=$1', [event.id])).rows[0]?.definition || defaultAdventure();
  return { groups, factions, allCharacters, characters: allCharacters.filter(row => row.active), definition };
}
export async function ownStoryCharacter(db, event, user, characterId = null) {
  const id = characterId === null ? null : storyUUID(characterId, 'Character');
  const row = (await db.query(`SELECT c.* FROM characters c JOIN users u ON u.id=c.user_id WHERE c.event_id=$1 AND c.user_id=$2 AND ($3::uuid IS NULL OR c.id=$3) AND c.status='approved' AND NOT u.is_disabled AND (u.is_superuser OR EXISTS(SELECT 1 FROM memberships m WHERE m.event_id=c.event_id AND m.user_id=c.user_id)) ORDER BY c.created_at,c.id LIMIT 1`, [event.id, user.id, id])).rows[0];
  if (id && !row) reject(404, 'Character not found or not assigned to you.');
  return row || null;
}
export async function validateStoryAudience(db, event, audience, { allowOwnerOnly = false } = {}) {
  const result = normalizeStoryAudience(audience);
  // Empty private audiences are safe drafts and TRACE's explicit owner-only mode.
  // Publication applies its separate nonempty-private requirement.
  void allowOwnerOnly;
  if (result.type === 'public' || !result.ids.length) return result;
  const table = result.type === 'faction' ? 'factions' : result.type === 'group' ? 'story_groups' : 'characters';
  const rows = (await db.query(`SELECT id FROM ${table} WHERE event_id=$1 AND id=ANY($2::uuid[])`, [event.id, result.ids])).rows;
  if (rows.length !== result.ids.length) reject(400, 'Choose audience members from this event.');
  return result;
}
export function canReadStoryAudience(audience, character, context) {
  if (!character || !context.characters.some(row => row.id === character.id && row.user_id === character.user_id)) return false;
  if (audience.type === 'public') return true;
  if (audience.type === 'private') return audience.ids.includes(character.id);
  if (audience.type === 'faction') return context.factions.some(faction => faction.id === character.profile.factionId && audience.ids.includes(faction.id));
  if (audience.type === 'group') return context.groups.some(group => audience.ids.includes(group.id) && group.character_ids.includes(character.id));
  return false;
}
export function storyConditionsPass(conditions, character, event, run, context) {
  try { validateStoryConditions(conditions, context.definition, event.setup.rules); } catch { return false; }
  return conditions.completed.every(id => Object.hasOwn(run?.progress || {}, id) && run.progress[id]?.completed === true) && conditions.flags.every(id => Object.hasOwn(run?.flags || {}, id) && run.flags[id] === true) && conditions.skills.every(id => character.profile.skills.includes(id)) && (!conditions.statuses.length || conditions.statuses.includes(event.status));
}
export async function canShareWhisper(db, event, nodeId) {
  if (!event.setup.enabledInstruments.includes('whisper') || typeof nodeId !== 'string' || !/^whisper:[0-9a-f-]{36}$/.test(nodeId)) return false;
  let id; try { id = storyUUID(nodeId.slice(8)); } catch { return false; }
  const row = (await db.query("SELECT published,status FROM story_entries WHERE event_id=$1 AND id=$2 AND kind='rumor'", [event.id, id])).rows[0];
  return Boolean(row?.published && row.status !== 'withdrawn' && row.published.shareable === true);
}
// Account-bound WHISPER and exchange-receipt provenance govern the journal, QR offers,
// and TRACE citations. Captured recipient ownership preserves a legitimate copy
// even when the original reader later leaves; assignment cannot transfer it.
export async function filterStoryJournal(db, eventId, userId, rows) {
  if (!rows.length) return rows;
  const ids = rows.map(row => row.id);
  const allowed = (await db.query(`SELECT j.id FROM adventure_journal j
    LEFT JOIN story_readings r ON r.journal_id=j.id AND r.event_id=j.event_id
    LEFT JOIN exchange_copies c ON c.journal_id=j.id AND c.event_id=j.event_id
    LEFT JOIN adventure_journal original ON original.id=c.origin_journal_id
    WHERE j.event_id=$1 AND j.id=ANY($3::uuid[]) AND (
      ((j.type='whisper' OR original.type='whisper') AND (r.owner_user_id=$2 OR EXISTS(
        SELECT 1 FROM exchange_receipts receipt JOIN exchange_sessions session ON session.event_id=receipt.event_id AND session.id=receipt.exchange_id
        WHERE receipt.event_id=j.event_id AND receipt.owner_user_id=$2 AND receipt.owner_character_id=j.character_id AND session.status='completed'
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(receipt.receipt->'received')='array' THEN receipt.receipt->'received' ELSE '[]'::jsonb END) reading WHERE reading->>'id'=j.id::text)
      ))) OR
      (j.type='exchange_receipt' AND EXISTS(
        SELECT 1 FROM exchange_receipts receipt JOIN exchange_sessions session ON session.event_id=receipt.event_id AND session.id=receipt.exchange_id
        WHERE receipt.event_id=j.event_id AND receipt.owner_user_id=$2 AND receipt.owner_character_id=j.character_id
        AND session.status='completed' AND j.entry_key='exchange-receipt:' || receipt.exchange_id::text
      )) OR
      (j.type NOT IN('whisper','exchange_receipt') AND COALESCE(original.type,'')<>'whisper' AND j.node_id NOT LIKE 'whisper:%')
    )`, [eventId, userId, ids])).rows;
  const visible = new Set(allowed.map(row => row.id));
  return rows.filter(row => visible.has(row.id));
}
export async function resetStory(db, eventId) {
  for (const table of ['trace_requests', 'trace_records', 'story_requests', 'story_readings']) await db.query(`DELETE FROM ${table} WHERE event_id=$1`, [eventId]);
}
export async function copyStory(db, sourceEvent, newEvent, { characterMap, factionMap }, actorId) {
  const sourceId = typeof sourceEvent === 'string' ? sourceEvent : sourceEvent.id, targetId = typeof newEvent === 'string' ? newEvent : newEvent.id;
  const remap = (map, id) => map instanceof Map ? map.get(id) : map?.[id];
  const groupMap = new Map();
  for (const group of (await db.query('SELECT * FROM story_groups WHERE event_id=$1 ORDER BY created_at,id', [sourceId])).rows) {
    const id = randomUUID(); groupMap.set(group.id, id);
    await db.query('INSERT INTO story_groups(id,event_id,name,character_ids) VALUES($1,$2,$3,$4)', [id, targetId, group.name, JSON.stringify(group.character_ids.map(value => remap(characterMap, value)).filter(Boolean))]);
  }
  const mappedDocument = input => {
    if (!input) return null;
    const result = structuredClone(input), audience = result.audience;
    if (audience.type !== 'public') {
      const map = audience.type === 'faction' ? factionMap : audience.type === 'group' ? groupMap : characterMap;
      audience.ids = audience.ids.map(id => remap(map, id)).filter(Boolean);
      if (!audience.ids.length) result.audience = { type: 'private', ids: [] };
    }
    return result;
  };
  for (const entry of (await db.query('SELECT * FROM story_entries WHERE event_id=$1 ORDER BY created_at,id', [sourceId])).rows) {
    await db.query('INSERT INTO story_entries(id,event_id,kind,document,status,published,published_version,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), targetId, entry.kind, JSON.stringify(mappedDocument(entry.document)), entry.status, entry.published ? JSON.stringify(mappedDocument(entry.published)) : null, entry.published ? 1 : null, actorId]);
  }
}
export async function seedStory(db, event, userId) {
  if ((await db.query('SELECT id FROM story_entries WHERE event_id=$1 LIMIT 1', [event.id])).rows.length) return;
  const context = await storyContext(db, event), characters = context.allCharacters;
  const themed = event.setup.theme?.id || event.setup.themeId || 'fantasy';
  const subject = themed === 'cyberpunk' ? 'the missing relay' : themed === 'wasteland' ? 'the sealed water cache' : 'the missing relic';
  const documents = [
    { kind: 'rumor', document: { ...defaultStoryDocument(), title: 'A courier’s account', body: `A courier claims ${subject} was moved before dawn. They saw a familiar symbol on the container. This account has not been verified.`, sourceLabel: 'An anxious courier', topic: 'Two accounts of one disappearance', truth: 'These are deliberately conflicting accounts. Compare physical evidence before deciding which details to trust.', audience: characters[0] ? { type: 'private', ids: [characters[0].id] } : { type: 'private', ids: [] }, shareable: true } },
    { kind: 'rumor', document: { ...defaultStoryDocument(), title: 'A witness’s account', body: `A witness insists ${subject} never left the meeting place. They heard voices after the courier departed. This account has not been verified.`, sourceLabel: 'A reluctant witness', topic: 'Two accounts of one disappearance', truth: 'Both accounts are clues, not automatic proof. The organizer decides their role in the adventure.', audience: characters[1] ? { type: 'private', ids: [characters[1].id] } : { type: 'private', ids: [] }, shareable: true } },
    { kind: 'bulletin', document: { ...defaultStoryDocument(), title: 'Witnesses requested', body: `Anyone with information about ${subject} should compare accounts and bring their findings to the organizer.`, sourceLabel: 'Event dispatch', conditions: { ...defaultStoryDocument().conditions, completed: context.definition.nodes.some(node => node.id === 'evidence-core') ? ['evidence-core'] : [] }, truth: 'Review the two rumor audiences and publish them when ready. This bulletin is an organizer draft.' } }
  ];
  for (const entry of documents) await db.query('INSERT INTO story_entries(id,event_id,kind,document,created_by) VALUES($1,$2,$3,$4,$5)', [randomUUID(), event.id, entry.kind, JSON.stringify(entry.document), userId]);
}

export function createStoryHandler({ pool, helpers }) {
  const { body, send, fail, membership, transaction, audit } = helpers;
  const requireAuthor = event => { if (!authors.has(event.role)) fail(403, 'Only event staff can author or review story entries.'); };
  const requireManager = event => { if (!managers.has(event.role)) fail(403, 'Only an organizer can publish, withdraw, or manage groups.'); };
  const requirePlayable = event => { if (!playable(event)) fail(409, 'This event must be live or in rehearsal.'); };
  const requireVersion = (value, current) => { if (!Number.isInteger(value) || value !== current) fail(409, 'This story entry changed. Reload and review before continuing.'); };
  const entryFor = async (db, eventId, id) => (await db.query('SELECT * FROM story_entries WHERE event_id=$1 AND id=$2', [eventId, id])).rows[0];
  const runFor = async (db, eventId, characterId) => (await db.query('SELECT progress,flags FROM adventure_runs WHERE event_id=$1 AND character_id=$2', [eventId, characterId])).rows[0] || { progress: {}, flags: {} };
  const eligible = (entry, character, event, run, context) => Boolean(entry.published && entry.status !== 'withdrawn' && event.setup.enabledInstruments.includes(entry.kind === 'rumor' ? 'whisper' : 'broadside') && canReadStoryAudience(entry.published.audience, character, context) && storyConditionsPass(entry.published.conditions, character, event, run, context));
  const publication = entry => ({ id: entry.id, title: entry.published.title, body: entry.published.body, sourceLabel: entry.published.sourceLabel, correctionNote: entry.published.correctionNote, publicationVersion: entry.published_version, publishedAt: entry.published.publishedAt });
  async function manage(db, event) {
    const context = await storyContext(db, event);
    return { event: eventProjection(event), entries: (await db.query('SELECT * FROM story_entries WHERE event_id=$1 ORDER BY created_at,id', [event.id])).rows.map(managerEntry), groups: context.groups.map(publicGroup), factions: context.factions.map(row => ({ id: row.id, name: row.name })), characters: context.allCharacters.map(publicCharacter), nodes: context.definition.nodes.map(row => ({ id: row.id, title: row.title })), flags: context.definition.flags, skills: event.setup.rules.expertise, statuses: ADVENTURE_EVENT_STATUSES.map(id => ({ id, name: id })), activity: (await db.query('SELECT id,entry_id,action,version,created_at FROM story_activity WHERE event_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100', [event.id])).rows.map(row => ({ id: row.id, entryId: row.entry_id, action: row.action, version: row.version, createdAt: row.created_at })) };
  }
  async function play(db, event, user, character) {
    const context = await storyContext(db, event);
    const result = { event: eventProjection(event), character: character ? publicCharacter(character) : null, characters: context.characters.filter(row => row.user_id === user.id).map(publicCharacter), rumors: [], bulletins: [], readings: [], audiences: { factions: context.factions.map(row => ({ id: row.id, name: row.name })), groups: context.groups.filter(row => character && row.character_ids.includes(character.id)).map(row => ({ id: row.id, name: row.name })), characters: context.characters.map(publicCharacter) }, readOnly: !playable(event) || !character };
    if (!character) return result;
    const run = await runFor(db, event.id, character.id);
    result.readings = (await filterStoryJournal(db, event.id, user.id, (await db.query("SELECT j.* FROM adventure_journal j WHERE j.event_id=$1 AND j.character_id=$2 AND (j.type='whisper' OR (j.type='shared_reading' AND j.node_id LIKE 'whisper:%')) ORDER BY j.created_at,j.id", [event.id, character.id])).rows)).map(readingProjection);
    const collected = (await db.query('SELECT entry_id,publication_version FROM story_readings WHERE event_id=$1 AND character_id=$2 AND owner_user_id=$3', [event.id, character.id, user.id])).rows;
    for (const entry of (await db.query("SELECT * FROM story_entries WHERE event_id=$1 AND published IS NOT NULL AND status<>'withdrawn' ORDER BY created_at,id", [event.id])).rows) {
      if (!eligible(entry, character, event, run, context)) continue;
      if (entry.kind === 'rumor') result.rumors.push({ id: entry.id, title: entry.published.title, sourceLabel: entry.published.sourceLabel, publicationVersion: entry.published_version, collected: collected.some(row => row.entry_id === entry.id && row.publication_version === entry.published_version) });
      else result.bulletins.push(publication(entry));
    }
    return result;
  }
  async function recordRequest(db, event, user, requestId, hash, action, targetId) {
    await db.query('INSERT INTO story_requests(event_id,actor_user_id,request_id,payload_hash,action,target_id) VALUES($1,$2,$3,$4,$5,$6)', [event.id, user.id, requestId, hash, action, targetId]);
  }
  async function activity(db, event, user, entry, action) {
    await db.query('INSERT INTO story_activity(id,event_id,entry_id,actor_id,action,version) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), event.id, entry?.id || null, user.id, action, entry?.version || 1]);
    await audit(db, event.id, user.id, `story.${action}`, entry ? { entryId: entry.id, version: entry.version } : {});
  }
  const invalidateExchanges = (db, eventId) => db.query("UPDATE exchange_sessions SET version=version+1,initiator_confirmed_version=NULL,recipient_confirmed_version=NULL,updated_at=clock_timestamp() WHERE event_id=$1 AND status IN('waiting','negotiating') AND expires_at>clock_timestamp()", [eventId]);
  async function documentFor(db, event, value) {
    const context = await storyContext(db, event), document = validateStoryDocument(value, context.definition, event.setup.rules);
    document.audience = await validateStoryAudience(db, event, document.audience);
    return document;
  }
  return async function handleStory({ req, res, path, url, method, user }) {
    const route = /^\/api\/events\/([^/]+)\/story\/(manage|play|collect|proposals|entries|groups)(?:\/([^/]+))?(?:\/(submit|publish|withdraw))?$/.exec(path);
    if (!route) return false;
    if (!user) fail(401, 'Sign in to continue.');
    const eventId = storyUUID(route[1]), section = route[2], target = route[3] ? storyUUID(route[3]) : null, verb = route[4] || null;
    if (method === 'GET') {
      if (target || verb || !['manage', 'play'].includes(section)) fail(405, 'Method not allowed.');
      const event = await membership(pool, eventId, user.id);
      if (section === 'manage') { requireAuthor(event); send(res, 200, await manage(pool, event)); }
      else send(res, 200, await play(pool, event, user, await ownStoryCharacter(pool, event, user, url.searchParams.get('characterId'))));
      return true;
    }
    const validRoute = (section === 'entries' && ((!target && method === 'POST' && !verb) || (target && method === 'PUT' && !verb) || (target && method === 'POST' && verb))) || (section === 'groups' && !verb && (target ? method === 'PUT' : method === 'POST')) || (['collect', 'proposals'].includes(section) && !target && !verb && method === 'POST');
    if (!validRoute) fail(405, 'Method not allowed.');
    const input = await body(req, 30000);
    const action = `${section}:${verb || (target ? 'update' : 'create')}`;
    const result = await transaction(pool, async db => {
      let event = await membership(db, eventId, user.id, true);
      await db.query('SELECT id FROM users WHERE id=$1 FOR SHARE', [user.id]);
      event = await membership(db, eventId, user.id);
      if (event.status === 'archived') fail(409, 'Archived events cannot change story records.');
      if (['entries', 'groups'].includes(section)) requireAuthor(event);
      if (section === 'groups' || ['publish', 'withdraw'].includes(verb)) requireManager(event);
      if (['collect', 'proposals'].includes(section) || verb === 'publish') requirePlayable(event);
      const keys = section === 'collect' ? ['requestId', 'characterId', 'entryId', 'publicationVersion'] : section === 'proposals' ? ['requestId', 'characterId', 'title', 'body', 'sourceJournalId', 'audience'] : section === 'groups' ? ['requestId', ...(target ? ['version'] : []), 'name', 'characterIds'] : verb ? ['requestId', 'version'] : target ? ['requestId', 'version', 'document'] : ['requestId', 'kind', 'document'];
      characterRecord(input, keys, 'Story request');
      const requestId = storyUUID(input.requestId, 'Request'), hash = hashRequest(action, target, input);
      const prior = (await db.query('SELECT * FROM story_requests WHERE event_id=$1 AND actor_user_id=$2 AND request_id=$3', [event.id, user.id, requestId])).rows[0];
      if (prior && prior.payload_hash !== hash) fail(409, 'This request identifier was already used for another action.');
      if (!prior && (await db.query('SELECT count(*)::int AS n FROM story_requests WHERE event_id=$1 AND actor_user_id=$2', [event.id, user.id])).rows[0].n >= 5000) fail(429, 'Story request limit reached for this event.');
      if (section === 'collect') {
        const character = await ownStoryCharacter(db, event, user, input.characterId), entry = await entryFor(db, event.id, storyUUID(input.entryId));
        if (!character) fail(409, 'Choose an approved character.');
        const context = await storyContext(db, event), run = await runFor(db, event.id, character.id);
        if (!entry || entry.kind !== 'rumor' || !eligible(entry, character, event, run, context)) fail(404, 'This account is not available to this character.');
        requireVersion(input.publicationVersion, entry.published_version);
        let reading = (await db.query('SELECT j.* FROM story_readings r JOIN adventure_journal j ON j.id=r.journal_id WHERE r.event_id=$1 AND r.character_id=$2 AND r.owner_user_id=$3 AND r.entry_id=$4 AND r.publication_version=$5', [event.id, character.id, user.id, entry.id, entry.published_version])).rows[0];
        if (!reading) {
          if ((await db.query('SELECT count(*)::int AS n FROM story_readings WHERE event_id=$1 AND character_id=$2', [event.id, character.id])).rows[0].n >= 2000) fail(429, 'This character has reached the rumor reading limit.');
          const text = `Unverified account${entry.published.sourceLabel ? ` · ${entry.published.sourceLabel}` : ''}\n\n${entry.published.body}${entry.published.correctionNote ? `\n\nCorrection: ${entry.published.correctionNote}` : ''}`;
          const journalId = randomUUID();
          reading = (await db.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,type) VALUES($1,$2,$3,$4,$5,$6,$7,'whisper') RETURNING *", [journalId, event.id, character.id, `whisper:${entry.id}`, `whisper:${entry.id}:${entry.published_version}:${journalId}`, entry.published.title, text])).rows[0];
          await db.query('INSERT INTO story_readings(id,event_id,entry_id,owner_user_id,character_id,publication_version,journal_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), event.id, entry.id, user.id, character.id, entry.published_version, journalId]);
        }
        if (!prior) await recordRequest(db, event, user, requestId, hash, action, entry.id);
        return { reading: readingProjection(reading), outcome: { replayed: Boolean(prior) } };
      }
      if (section === 'proposals') {
        if (!event.setup.enabledInstruments.includes('broadside')) fail(404, 'BROADSIDE is not available in this event.');
        const character = await ownStoryCharacter(db, event, user, input.characterId);
        if (!character) fail(409, 'Choose an approved character.');
        if (input.sourceJournalId !== null) {
          const source = (await db.query("SELECT id FROM adventure_journal WHERE event_id=$1 AND character_id=$2 AND id=$3 AND type<>'exchange_receipt'", [event.id, character.id, storyUUID(input.sourceJournalId)])).rows[0];
          if (!source || !(await filterStoryJournal(db, event.id, user.id, [source])).length) fail(404, 'Source reading is not in this character’s journal.');
        }
        const proposedAudience = normalizeStoryAudience(input.audience), context = await storyContext(db, event);
        if (proposedAudience.type === 'group' && proposedAudience.ids.some(id => !context.groups.some(group => group.id === id && group.character_ids.includes(character.id)))) fail(400, 'Choose one of this character’s groups.');
        if (proposedAudience.type === 'private' && proposedAudience.ids.some(id => !context.characters.some(row => row.id === id))) fail(400, 'Choose an available character from this event.');
        const audience = await validateStoryAudience(db, event, proposedAudience);
        const document = { ...defaultStoryDocument(), title: characterText(input.title, 'Proposal title', 1, 120), body: characterText(input.body, 'Proposal body', 1, 6000), sourceLabel: 'Player proposal', audience };
        let entry = prior ? await entryFor(db, event.id, prior.target_id) : null;
        if (prior && !entry) fail(404, 'Proposal is no longer available.');
        if (!prior) {
          if ((await db.query('SELECT count(*)::int AS n FROM story_entries WHERE event_id=$1', [event.id])).rows[0].n >= 200) fail(429, 'This event has reached its story entry limit.');
          entry = (await db.query("INSERT INTO story_entries(id,event_id,kind,document,status,created_by) VALUES($1,$2,'bulletin',$3,'submitted',$4) RETURNING *", [randomUUID(), event.id, JSON.stringify(document), user.id])).rows[0];
          await recordRequest(db, event, user, requestId, hash, action, entry.id); await activity(db, event, user, entry, 'proposed');
        }
        // A proposal receipt is always the submitted authoring acknowledgement;
        // it never exposes subsequent organizer edits, truth, or hidden audience.
        return { entry: { id: entry.id, title: document.title, status: 'submitted', version: 1 } };
      }
      if (section === 'groups') {
        const name = characterText(input.name, 'Group name', 1, 120), characterIds = storyList(input.characterIds, 100, 'Group members').map(id => storyUUID(id));
        if (new Set(characterIds).size !== characterIds.length) fail(400, 'Choose each group member once.');
        const known = (await db.query('SELECT id FROM characters WHERE event_id=$1 AND id=ANY($2::uuid[])', [event.id, characterIds])).rows;
        if (known.length !== characterIds.length) fail(400, 'Choose group members from this event.');
        let group = target || prior ? (await db.query('SELECT * FROM story_groups WHERE event_id=$1 AND id=$2', [event.id, target || prior.target_id])).rows[0] : null;
        if ((target || prior) && !group) fail(404, 'Group not found.');
        if (prior) return { group: publicGroup(group) };
        if (target) { requireVersion(input.version, group.version); group = (await db.query('UPDATE story_groups SET name=$3,character_ids=$4,version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2 RETURNING *', [event.id, target, name, JSON.stringify(characterIds)])).rows[0]; }
        else {
          if ((await db.query('SELECT count(*)::int AS n FROM story_groups WHERE event_id=$1', [event.id])).rows[0].n >= 50) fail(429, 'This event has reached its group limit.');
          group = (await db.query('INSERT INTO story_groups(id,event_id,name,character_ids) VALUES($1,$2,$3,$4) RETURNING *', [randomUUID(), event.id, name, JSON.stringify(characterIds)])).rows[0];
        }
        await recordRequest(db, event, user, requestId, hash, action, group.id); await activity(db, event, user, null, 'group_updated');
        return { group: publicGroup(group) };
      }
      let entry = target || prior ? await entryFor(db, event.id, target || prior.target_id) : null;
      if ((target || prior) && !entry) fail(404, 'Story entry not found.');
      if (prior) return { entry: managerEntry(entry) };
      if (!target) {
        if (!['rumor', 'bulletin'].includes(input.kind)) fail(400, 'Choose rumor or bulletin.');
        if ((await db.query('SELECT count(*)::int AS n FROM story_entries WHERE event_id=$1', [event.id])).rows[0].n >= 200) fail(429, 'This event has reached its story entry limit.');
        const document = await documentFor(db, event, input.document);
        entry = (await db.query('INSERT INTO story_entries(id,event_id,kind,document,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *', [randomUUID(), event.id, input.kind, JSON.stringify(document), user.id])).rows[0];
      } else {
        requireVersion(input.version, entry.version);
        if (!verb) {
          const document = await documentFor(db, event, input.document);
          entry = (await db.query("UPDATE story_entries SET document=$3,version=version+1,status=CASE WHEN status='withdrawn' THEN 'withdrawn' ELSE 'draft' END,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2 RETURNING *", [event.id, entry.id, JSON.stringify(document)])).rows[0];
        } else if (verb === 'publish') {
          const document = await documentFor(db, event, entry.document);
          if (document.audience.type === 'private' && !document.audience.ids.length) fail(400, 'Select a private audience before publication.');
          if (entry.published && !document.correctionNote) fail(400, 'Describe the correction before replacing a publication.');
          entry = (await db.query("UPDATE story_entries SET published=$3,published_version=COALESCE(published_version,0)+1,status='published',version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2 RETURNING *", [event.id, entry.id, JSON.stringify({ ...document, publishedAt: new Date().toISOString() })])).rows[0];
          await invalidateExchanges(db, event.id);
        } else {
          if (verb === 'withdraw' && !entry.published) fail(409, 'This entry has no publication to withdraw.');
          entry = (await db.query('UPDATE story_entries SET status=$3,version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2 RETURNING *', [event.id, entry.id, verb === 'submit' ? (entry.status === 'withdrawn' ? 'withdrawn' : 'submitted') : 'withdrawn'])).rows[0];
          if (verb === 'withdraw') await invalidateExchanges(db, event.id);
        }
      }
      await recordRequest(db, event, user, requestId, hash, action, entry.id); await activity(db, event, user, entry, verb || (target ? 'updated' : 'created'));
      return { entry: managerEntry(entry) };
    });
    send(res, !target && ['entries', 'groups', 'proposals'].includes(section) ? 201 : 200, result); return true;
  };
}
