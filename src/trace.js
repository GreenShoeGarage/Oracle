import { randomUUID, createHash } from 'node:crypto';
import { validateTraceRequest, TRACE_LIMITS } from '../public/trace-model.js';
import { storyContext, ownStoryCharacter, validateStoryAudience, canReadStoryAudience, filterStoryJournal } from './story.js';

const playable = event => ['live', 'rehearsal'].includes(event.status);
const enabled = event => event.setup.enabledInstruments.includes('trace');
const brief = character => ({ id: character.id, name: character.profile.name });

export function createTraceHandler({ pool, helpers }) {
  const { body, send, fail, identifier, membership, audit, transaction } = helpers;
  const lostCharacter = () => fail(404, 'Character not found or not assigned to you.');
  const notFound = () => fail(404, 'Investigation record not found.');

  // The event lock serializes publication, group, and character changes. Share
  // locks also protect current enabled status against account administration.
  // FOR SHARE remains compatible with foreign-key reads in admin audit writes.
  async function lockOwners(db, eventId, userId) {
    const rows = (await db.query('SELECT DISTINCT user_id FROM characters WHERE event_id=$1 AND user_id IS NOT NULL', [eventId])).rows;
    const ids = [...new Set([userId, ...rows.map(row => row.user_id)])].sort();
    await db.query('SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE', [ids]);
  }
  const ownerFor = (row, context) => context.characters.find(character => character.id === row.character_id && character.user_id === row.owner_user_id);
  const isOwner = (row, character, user) => row.character_id === character.id && row.owner_user_id === user.id;
  function visible(row, character, user, context) {
    if (row.archived || !ownerFor(row, context)) return false;
    return isOwner(row, character, user) || canReadStoryAudience(row.document.audience, character, context);
  }
  async function records(db, eventId) {
    return (await db.query('SELECT * FROM trace_records WHERE event_id=$1 AND NOT archived ORDER BY updated_at DESC,id DESC LIMIT 2000', [eventId])).rows;
  }
  async function getRecord(db, eventId, recordId) {
    const row = (await db.query('SELECT * FROM trace_records WHERE event_id=$1 AND id=$2', [eventId, recordId])).rows[0];
    if (!row) notFound(); return row;
  }
  function audienceChoices(character, context) {
    return { factions: context.factions.map(row => ({ id: row.id, name: row.name })), groups: context.groups.filter(row => row.character_ids.includes(character.id)).map(row => ({ id: row.id, name: row.name })), characters: context.characters.map(brief) };
  }
  async function sourceRows(db, eventId, ids) {
    if (!ids.length) return [];
    return (await db.query("SELECT j.id,j.character_id,j.title,j.type,COALESCE(c.origin_journal_id,j.id) AS origin_id FROM adventure_journal j LEFT JOIN exchange_copies c ON c.event_id=j.event_id AND c.journal_id=j.id WHERE j.event_id=$1 AND j.id=ANY($2::uuid[]) AND j.type<>'exchange_receipt'", [eventId, ids])).rows;
  }
  async function project(db, event, user, character, rows, context, allRows) {
    const sourceIds = [...new Set(rows.flatMap(row => row.document.sources))];
    const candidates = await sourceRows(db, event.id, sourceIds), citations = [];
    const characterOwners = new Map(rows.map(row => [row.character_id, row.owner_user_id]));
    for (const ownerId of new Set(characterOwners.values())) citations.push(...await filterStoryJournal(db, event.id, ownerId, candidates.filter(row => characterOwners.get(row.character_id) === ownerId)));
    const citationMap = new Map(citations.map(row => [row.id, row]));
    const origins = [...new Set(citations.map(row => row.origin_id))];
    const independentlyOwned = origins.length ? await filterStoryJournal(db, event.id, user.id, (await db.query("SELECT j.id,j.title,j.type,COALESCE(c.origin_journal_id,j.id) AS origin_id FROM adventure_journal j LEFT JOIN exchange_copies c ON c.event_id=j.event_id AND c.journal_id=j.id WHERE j.event_id=$1 AND j.character_id=$2 AND j.type<>'exchange_receipt' AND COALESCE(c.origin_journal_id,j.id)=ANY($3::uuid[])", [event.id, character.id, origins])).rows) : [];
    const ownOrigins = new Map(independentlyOwned.map(row => [row.origin_id, row]));
    const destinations = new Map(allRows.filter(row => visible(row, character, user, context)).map(row => [row.id, row]));
    const sourceMetadata = row => ({ id: row.id, title: row.title, type: row.type });
    return rows.map(row => {
      const mine = isOwner(row, character, user), owner = ownerFor(row, context);
      const sources = row.document.sources.flatMap(id => {
        const source = citationMap.get(id);
        if (!source || source.character_id !== row.character_id) return [];
        const permitted = mine ? source : ownOrigins.get(source.origin_id);
        return permitted ? [sourceMetadata(permitted)] : [];
      });
      const links = row.document.links.flatMap(link => {
        const destination = destinations.get(link.recordId);
        return destination ? [{ recordId: destination.id, label: link.label, title: destination.document.title }] : [];
      });
      return { id: row.id, kind: row.document.kind, title: row.document.title, notes: row.document.notes, version: row.version, owner: { characterId: owner.id, name: owner.profile.name }, isOwner: mine, ...(mine ? { audience: row.document.audience } : {}), sources, links, archived: row.archived, updatedAt: row.updated_at };
    });
  }
  async function overview(db, event, user, character, context) {
    const result = { event: { id: event.id, name: event.name, status: event.status }, character: character ? brief(character) : null, characters: context.characters.filter(row => row.user_id === user.id).map(brief), records: [], sources: [], audiences: { factions: [], groups: [], characters: [] }, readOnly: !character || !playable(event) || !enabled(event), limits: TRACE_LIMITS, sourcesTruncated: false };
    if (!character) return { ...result, message: 'Choose an approved character before opening an investigation.' };
    if (!enabled(event)) return { ...result, message: 'TRACE is not enabled for this event.' };
    const allRows = await records(db, event.id);
    result.records = await project(db, event, user, character, allRows.filter(row => visible(row, character, user, context)), context, allRows);
    const sources = (await db.query("SELECT id,title,type FROM adventure_journal WHERE event_id=$1 AND character_id=$2 AND type<>'exchange_receipt' ORDER BY created_at DESC,id DESC LIMIT 2001", [event.id, character.id])).rows;
    result.sources = await filterStoryJournal(db, event.id, user.id, sources.slice(0, 2000)); result.sourcesTruncated = sources.length > 2000;
    result.audiences = audienceChoices(character, context);
    return result;
  }
  async function validateReferences(db, event, character, user, document, recordId, context, allRows) {
    if (document.audience.type === 'group' && document.audience.ids.some(id => !context.groups.some(group => group.id === id && group.character_ids.includes(character.id)))) fail(400, 'Choose a group that includes your character.');
    if (document.audience.type === 'private' && document.audience.ids.some(id => !context.characters.some(row => row.id === id))) fail(400, 'Choose recipients from the approved character list.');
    document.audience = await validateStoryAudience(db, event, document.audience, { allowOwnerOnly: true });
    const sources = await filterStoryJournal(db, event.id, user.id, await sourceRows(db, event.id, document.sources));
    if (sources.length !== document.sources.length || sources.some(row => row.character_id !== character.id)) fail(404, 'A source was not found in this character’s journal.');
    for (const link of document.links) {
      const destination = allRows.find(row => row.id === link.recordId);
      if (link.recordId === recordId) fail(400, 'A record cannot link to itself.');
      if (!destination || !visible(destination, character, user, context)) fail(404, 'A linked investigation record is unavailable.');
    }
    return document;
  }

  return async function handleTrace({ req, res, path, url, method, user }) {
    const match = /^\/api\/events\/([^/]+)\/trace(?:\/([^/]+))?(?:\/(archive))?$/.exec(path);
    if (!match) return false;
    if (!user) fail(401, 'Sign in to continue.');
    const eventId = identifier(match[1]).toLowerCase(), recordId = match[2] ? identifier(match[2]).toLowerCase() : null;
    if (method === 'GET') {
      if (recordId) fail(405, 'Method not allowed.');
      const result = await transaction(pool, async db => {
        let event = await membership(db, eventId, user.id, true);
        await lockOwners(db, eventId, user.id); event = await membership(db, eventId, user.id);
        const character = await ownStoryCharacter(db, event, user, url.searchParams.get('characterId'));
        return await overview(db, event, user, character, await storyContext(db, event));
      });
      send(res, 200, result); return true;
    }
    const action = match[3] ? 'archive' : recordId ? 'update' : 'create';
    if (method !== (action === 'update' ? 'PUT' : 'POST')) fail(405, 'Method not allowed.');
    const input = validateTraceRequest(await body(req, 64_000), action);
    const hash = createHash('sha256').update(JSON.stringify({ action, recordId, input })).digest('hex');
    let created = false;
    const result = await transaction(pool, async db => {
      let event = await membership(db, eventId, user.id, true);
      await lockOwners(db, eventId, user.id); event = await membership(db, eventId, user.id);
      const character = await ownStoryCharacter(db, event, user, input.characterId); if (!character) lostCharacter();
      const context = await storyContext(db, event);
      if (!enabled(event)) fail(403, 'TRACE is not enabled for this event.');
      const previous = (await db.query('SELECT payload_hash,record_id FROM trace_requests WHERE event_id=$1 AND actor_user_id=$2 AND request_id=$3', [eventId, user.id, input.requestId])).rows[0];
      let row = previous ? await getRecord(db, eventId, previous.record_id) : recordId ? await getRecord(db, eventId, recordId) : null;
      if (row && (!isOwner(row, character, user) || !ownerFor(row, context))) notFound();
      const allRows = await records(db, eventId);
      if (previous) {
        if (previous.payload_hash !== hash) fail(409, 'This request identifier was already used for different changes.');
        return { record: (await project(db, event, user, character, [row], context, allRows))[0], outcome: { replayed: true, message: row.archived ? 'Record archived.' : 'Record saved.' } };
      }
      if (!playable(event)) fail(409, 'Investigation records can change only while the event is live or in rehearsal.');
      const requestCount = (await db.query('SELECT count(*)::int AS count FROM trace_requests WHERE event_id=$1 AND actor_user_id=$2', [eventId, user.id])).rows[0].count;
      if (requestCount >= 20000) fail(429, 'The investigation change limit has been reached for this event.');
      if (row?.archived) notFound();
      if (row && row.version !== input.version) fail(409, 'This record has changed. Reload and review it before saving your draft.');
      if (input.document) await validateReferences(db, event, character, user, input.document, recordId, context, allRows);
      if (action === 'create') {
        const counts = (await db.query('SELECT count(*)::int AS total,count(*) FILTER(WHERE character_id=$2)::int AS own FROM trace_records WHERE event_id=$1', [eventId, character.id])).rows[0];
        if (counts.own >= TRACE_LIMITS.perCharacter || counts.total >= TRACE_LIMITS.perEvent) fail(429, 'The investigation record limit has been reached. Edit an existing record.');
        row = (await db.query('INSERT INTO trace_records(id,event_id,owner_user_id,character_id,document) VALUES($1,$2,$3,$4,$5) RETURNING *', [randomUUID(), eventId, user.id, character.id, JSON.stringify(input.document)])).rows[0]; created = true;
      } else if (action === 'update') {
        row = (await db.query('UPDATE trace_records SET document=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *', [row.id, JSON.stringify(input.document)])).rows[0];
      } else {
        row = (await db.query('UPDATE trace_records SET archived=true,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *', [row.id])).rows[0];
      }
      await db.query('INSERT INTO trace_requests(event_id,actor_user_id,request_id,payload_hash,record_id) VALUES($1,$2,$3,$4,$5)', [eventId, user.id, input.requestId, hash, row.id]);
      // Retain request identities at the bound, so even a very old create retry
      // reconciles current state instead of producing a duplicate private note.
      await audit(db, eventId, user.id, `trace.${action === 'archive' ? 'archived' : action === 'create' ? 'created' : 'updated'}`, { recordId: row.id, version: row.version });
      const currentRows = allRows.filter(entry => entry.id !== row.id); if (!row.archived) currentRows.unshift(row);
      return { record: (await project(db, event, user, character, [row], context, currentRows))[0], outcome: { replayed: false, message: row.archived ? 'Record archived.' : 'Record saved.' } };
    });
    send(res, created ? 201 : 200, result); return true;
  };
}
