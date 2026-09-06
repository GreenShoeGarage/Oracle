import { randomUUID, createHash } from 'node:crypto';
import { oathUUID, validateOathRequest } from '../public/oath-model.js';
import { transferEconomyAssets } from './economy.js';

const managers = new Set(['owner', 'organizer', 'superuser']);
const playable = event => ['live', 'rehearsal'].includes(event.status);
const eventProjection = event => ({ id: event.id, name: event.name, status: event.status, role: event.role });
const pending = row => ['proposed', 'active'].includes(row.status);
const expired = (row, now) => row.expires_at !== null && new Date(row.expires_at) <= new Date(now);
const canonical = value => JSON.stringify(value, (_, entry) => entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
export async function resetOaths(db, eventId) {
  for (const table of ['oath_requests', 'oath_history', 'oath_participants', 'oath_agreements']) await db.query(`DELETE FROM ${table} WHERE event_id=$1`, [eventId]);
}

export function createOathHandler({ pool, helpers }) {
  const { body, send, fail, membership, transaction, audit } = helpers;
  const missing = () => fail(404, 'Agreement not found.');
  const lostCharacter = () => fail(404, 'Character not found or not assigned to you.');
  const requireManager = event => { if (!managers.has(event.role)) fail(403, 'Only an organizer can adjudicate agreements.'); };
  const requireOpen = event => {
    if (event.status === 'archived') fail(409, 'Archived events are read-only.');
    if (!event.setup.enabledInstruments.includes('oathbook')) fail(403, 'OATHBOOK is not enabled for this event.');
  };
  const clock = async db => (await db.query('SELECT clock_timestamp() AS time')).rows[0].time;
  const resources = async (db, eventId) => (await db.query('SELECT id,name FROM economy_resources WHERE event_id=$1 ORDER BY id', [eventId])).rows;
  async function directory(db, eventId) {
    return (await db.query(`SELECT c.id,c.user_id,c.profile,c.status FROM characters c JOIN users u ON u.id=c.user_id WHERE c.event_id=$1 AND c.status='approved' AND NOT u.is_disabled AND (u.is_superuser OR EXISTS(SELECT 1 FROM memberships m WHERE m.event_id=c.event_id AND m.user_id=c.user_id)) ORDER BY c.created_at,c.id`, [eventId])).rows;
  }
  async function ownCharacter(db, event, user, id = null) {
    const selected = id === null ? null : oathUUID(id, 'Character');
    const row = (await db.query(`SELECT c.* FROM characters c JOIN users u ON u.id=c.user_id WHERE c.event_id=$1 AND c.user_id=$2 AND ($3::uuid IS NULL OR c.id=$3) AND c.status='approved' AND NOT u.is_disabled AND (u.is_superuser OR EXISTS(SELECT 1 FROM memberships m WHERE m.event_id=c.event_id AND m.user_id=c.user_id)) ORDER BY c.created_at,c.id LIMIT 1`, [event.id, user.id, selected])).rows[0];
    if (selected && !row) lostCharacter();
    return row || null;
  }
  async function getRow(db, eventId, id, lock = false) {
    const row = (await db.query(`SELECT * FROM oath_agreements WHERE event_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`, [eventId, id])).rows[0];
    if (!row) missing(); return row;
  }
  async function parties(db, row) {
    return (await db.query(`SELECT p.*,c.user_id AS current_user_id,c.status AS current_status,NOT u.is_disabled AND (u.is_superuser OR EXISTS(SELECT 1 FROM memberships m WHERE m.event_id=p.event_id AND m.user_id=p.owner_user_id)) AS enabled FROM oath_participants p LEFT JOIN characters c ON c.event_id=p.event_id AND c.id=p.character_id LEFT JOIN users u ON u.id=p.owner_user_id WHERE p.event_id=$1 AND p.agreement_id=$2 ORDER BY p.kind,p.character_id`, [row.event_id, row.id])).rows.map(p => ({ ...p, eligible: p.current_user_id === p.owner_user_id && p.current_status === 'approved' && p.enabled === true }));
  }
  function ownParty(list, user, character) { return character ? list.find(p => p.owner_user_id === user.id && p.character_id === character.id && p.eligible) : null; }
  function requireAccess(event, list, user, character, allowManager = true) {
    if (allowManager && managers.has(event.role)) return;
    if (!ownParty(list, user, character)) missing();
  }
  function requireEligible(list) {
    if (list.filter(p => p.kind === 'participant').some(p => !p.eligible)) fail(409, 'A participant is no longer eligible. Every participant must still own their approved character and have event access.');
  }
  function requireUnexpired(row, now) { if (expired(row, now)) fail(409, 'This agreement has expired.'); }
  function requireVersion(input, row) { if (input.version !== row.version) fail(409, 'This agreement changed. Reload and review the current terms before continuing.'); }
  const publicParty = p => ({ characterId: p.character_id, name: p.name });
  function document(row, list) {
    return { title: row.title, terms: row.terms, participantIds: list.filter(p => p.kind === 'participant').map(p => p.character_id).sort(), witnessIds: list.filter(p => p.kind === 'witness').map(p => p.character_id).sort(), expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null, settlement: row.settlement.map(({ fromCharacterId, toCharacterId, resourceId, quantity }) => ({ fromCharacterId, toCharacterId, resourceId, quantity })) };
  }
  function snapshot(row, list) {
    return { ...document(row, list), participants: list.filter(p => p.kind === 'participant').map(publicParty), witnesses: list.filter(p => p.kind === 'witness').map(publicParty), settlement: row.settlement, termsVersion: row.terms_version };
  }
  async function history(db, event, user, row, action, character = null, details = {}) {
    if ((await db.query('SELECT count(*)::int AS n FROM oath_history WHERE event_id=$1 AND agreement_id=$2', [event.id, row.id])).rows[0].n >= 512) fail(429, 'This agreement has reached its history limit. Its existing evidence is preserved.');
    const audienceUserIds = [...new Set((await parties(db, row)).map(p => p.owner_user_id))].sort();
    await db.query('INSERT INTO oath_history(id,event_id,agreement_id,actor_user_id,character_id,character_name,action,terms_version,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [randomUUID(), event.id, row.id, user.id, character?.id || null, character?.profile.name || null, action, row.terms_version, JSON.stringify({ ...details, audienceUserIds })]);
    await audit(db, event.id, user.id, `oath.${action}`, { agreementId: row.id, termsVersion: row.terms_version, ...(character ? { characterId: character.id } : {}), ...(details.outcome ? { outcome: details.outcome } : {}) });
  }
  async function project(db, event, user, character, row, list = null, { metadataOnly = false } = {}) {
    list ||= await parties(db, row); requireAccess(event, list, user, character);
    const now = await clock(db), own = ownParty(list, user, character), principal = own?.kind === 'participant', enabled = event.setup.enabledInstruments.includes('oathbook');
    const eligible = list.filter(p => p.kind === 'participant').every(p => p.eligible), timedOut = expired(row, now);
    let status = row.status, blockedReason = null;
    if (pending(row) && timedOut) { status = 'expired'; blockedReason = 'This agreement has expired.'; }
    else if (pending(row) && !eligible) { status = 'unavailable'; blockedReason = 'A participant no longer owns their approved character or has event access.'; }
    if (!enabled) blockedReason ||= 'OATHBOOK is not enabled for this event.';
    if (!playable(event)) blockedReason ||= event.status === 'archived' ? 'Archived events are read-only.' : 'Player actions require a live event or rehearsal.';
    const writable = playable(event) && enabled, actionable = writable && !timedOut && eligible;
    const isCreator = own?.character_id === row.creator_character_id && user.id === row.creator_user_id;
    const manager = managers.has(event.role);
    const records = metadataOnly ? [] : (await db.query("SELECT id,action,created_at,character_name,terms_version,details FROM oath_history WHERE event_id=$1 AND agreement_id=$2 AND ($3::boolean OR (details->'audienceUserIds') ? $4::text) ORDER BY created_at,id", [event.id, row.id, manager, user.id])).rows;
    const visibleHistory = records.map(h => {
      const { audienceUserIds, priorSnapshot, ...details } = h.details;
      void audienceUserIds;
      return { id: h.id, action: h.action, at: h.created_at, ...(h.character_name ? { characterName: h.character_name } : {}), termsVersion: h.terms_version, ...details, ...(manager && priorSnapshot ? { priorSnapshot } : {}) };
    });
    const allAccepted = list.filter(p => p.kind === 'participant').every(p => p.accepted_terms_version === row.terms_version);
    return { id: row.id, title: row.title, terms: row.terms, version: row.version, termsVersion: row.terms_version, status, expiresAt: row.expires_at, createdAt: row.created_at, creatorCharacterId: row.creator_character_id,
      participants: list.filter(p => p.kind === 'participant').map(p => ({ ...publicParty(p), accepted: p.accepted_terms_version === row.terms_version, acceptedAt: p.accepted_at, acceptedTermsVersion: p.accepted_terms_version, settlementConfirmed: p.settlement_terms_version === row.terms_version })),
      witnesses: list.filter(p => p.kind === 'witness').map(p => ({ ...publicParty(p), witnessed: p.witnessed_terms_version === row.terms_version, witnessedAt: p.witnessed_at, termsVersion: p.witnessed_terms_version })),
      settlement: row.settlement, history: visibleHistory, receipt: metadataOnly ? null : row.receipt,
      canEdit: Boolean(isCreator && row.status === 'proposed' && actionable), canAccept: Boolean(principal && row.status === 'proposed' && actionable && own.accepted_terms_version !== row.terms_version),
      canWitness: Boolean(own?.kind === 'witness' && ['proposed', 'active'].includes(row.status) && actionable && own.witnessed_terms_version !== row.terms_version),
      canSettle: Boolean(principal && row.status === 'active' && actionable && allAccepted && own.settlement_terms_version !== row.terms_version),
      canDispute: Boolean(principal && ['active', 'fulfilled'].includes(row.status) && writable), canCancel: Boolean(isCreator && row.status === 'proposed' && actionable),
      canAdjudicate: Boolean(managers.has(event.role) && ['active', 'disputed'].includes(row.status) && event.status !== 'archived' && enabled),
      readOnly: !writable || ['fulfilled', 'cancelled', 'adjudicated', 'expired', 'unavailable'].includes(status), blockedReason };
  }
  async function overview(db, event, user, character, manage = false) {
    if (manage) requireManager(event);
    const available = await directory(db, event.id), list = character || manage ? (await db.query(`SELECT a.id,a.event_id,a.creator_user_id,a.creator_character_id,a.title,a.status,a.version,a.terms_version,a.expires_at,a.created_at,a.updated_at FROM oath_agreements a WHERE a.event_id=$1 AND ($2::boolean OR EXISTS(SELECT 1 FROM oath_participants p JOIN characters c ON c.event_id=p.event_id AND c.id=p.character_id WHERE p.event_id=a.event_id AND p.agreement_id=a.id AND p.owner_user_id=$3 AND p.character_id=$4 AND c.user_id=p.owner_user_id)) ORDER BY a.updated_at DESC,a.id DESC LIMIT 200`, [event.id, manage, user.id, character?.id || null])).rows : [];
    const agreements = [];
    for (const row of list) {
      const dto = await project(db, event, user, character, row, null, { metadataOnly: true });
      agreements.push({ id: dto.id, title: dto.title, status: dto.status, version: dto.version, termsVersion: dto.termsVersion, expiresAt: dto.expiresAt, createdAt: dto.createdAt, creatorCharacterId: dto.creatorCharacterId, participants: dto.participants, witnesses: dto.witnesses, blockedReason: dto.blockedReason });
    }
    return { event: eventProjection(event), character: character ? { id: character.id, name: character.profile.name } : null, characters: available.filter(c => c.user_id === user.id).map(c => ({ id: c.id, name: c.profile.name })), participants: available.map(c => ({ id: c.id, name: c.profile.name })), resources: await resources(db, event.id), agreements, canManage: managers.has(event.role), readOnly: !playable(event) || !event.setup.enabledInstruments.includes('oathbook') || !character, ...(character || manage ? {} : { message: 'Choose an approved character to create or accept an agreement.' }) };
  }
  async function validateDocument(db, event, input, creatorId, now, existingId = null) {
    if (!input.participantIds.includes(creatorId)) fail(400, 'The creator must remain a participant.');
    if (input.expiresAt && (new Date(input.expiresAt) <= new Date(now) || new Date(input.expiresAt) - new Date(now) > 365 * 24 * 60 * 60 * 1000)) fail(400, 'Choose a future expiration within one year.');
    const available = await directory(db, event.id), ids = [...input.participantIds, ...input.witnessIds], selected = ids.map(id => available.find(c => c.id === id));
    if (selected.some(c => !c)) fail(400, 'Every participant and witness must own an approved character with current event access.');
    if (new Set(selected.map(c => c.user_id)).size !== selected.length) fail(400, 'Participants and witnesses must use separate player accounts.');
    const catalog = await resources(db, event.id), settlement = input.settlement.map(entry => {
      const resource = catalog.find(r => r.id === entry.resourceId); if (!resource) fail(400, 'Choose settlement resources from this event.');
      return { ...entry, resourceName: resource.name };
    });
    for (const id of ids) {
      const count = (await db.query("SELECT count(*)::int AS n FROM oath_agreements a JOIN oath_participants p ON p.event_id=a.event_id AND p.agreement_id=a.id WHERE a.event_id=$1 AND p.character_id=$2 AND a.status IN('proposed','active','disputed') AND (a.expires_at IS NULL OR a.expires_at>clock_timestamp()) AND ($3::uuid IS NULL OR a.id<>$3)", [event.id, id, existingId])).rows[0].n;
      if (count >= 50) fail(429, 'A participant or witness already has fifty active agreements.');
    }
    return { selected, settlement };
  }
  async function installParties(db, row, input, selected) {
    for (const character of selected) await db.query('INSERT INTO oath_participants(event_id,agreement_id,character_id,owner_user_id,name,kind) VALUES($1,$2,$3,$4,$5,$6)', [row.event_id, row.id, character.id, character.user_id, character.profile.name, input.participantIds.includes(character.id) ? 'participant' : 'witness']);
  }
  async function settle(db, event, user, row, list) {
    if (row.settled_at) return row.receipt;
    requireEligible(list); requireUnexpired(row, await clock(db));
    const participants = list.filter(p => p.kind === 'participant');
    if (!participants.every(p => p.accepted_terms_version === row.terms_version)) fail(409, 'Every participant must accept these exact settlement terms.');
    const groups = new Map();
    for (const line of row.settlement) {
      const key = `${line.fromCharacterId}:${line.toCharacterId}`;
      if (!groups.has(key)) groups.set(key, { fromCharacterId: line.fromCharacterId, toCharacterId: line.toCharacterId, items: [], resources: [] });
      groups.get(key).resources.push({ resourceId: line.resourceId, quantity: line.quantity });
    }
    const receipt = await transferEconomyAssets(db, event, { kind: 'oath', actorUserId: user.id, referenceId: row.id, participants: participants.map(p => ({ characterId: p.character_id, userId: p.owner_user_id, name: p.name })), transfers: [...groups.values()] });
    // An empty narrative settlement is still final and may never be retried as a spend.
    await db.query('UPDATE oath_agreements SET settled_at=clock_timestamp(),receipt=$3 WHERE event_id=$1 AND id=$2', [event.id, row.id, receipt ? JSON.stringify(receipt) : null]);
    return receipt;
  }

  return async function handleOaths({ req, res, path, url, method, user }) {
    const route = /^\/api\/events\/([^/]+)\/oaths(?:\/([^/]+))?(?:\/(accept|witness|settle|cancel|dispute|adjudicate))?$/.exec(path);
    if (!route) return false;
    if (!user) fail(401, 'Sign in to continue.');
    const eventId = oathUUID(route[1], 'Event'), target = route[2] ? oathUUID(route[2], 'Agreement') : null;
    if (method === 'GET') {
      if (route[3]) fail(405, 'Method not allowed.');
      const event = await membership(pool, eventId, user.id), character = await ownCharacter(pool, event, user, url.searchParams.get('characterId'));
      if (target) send(res, 200, { agreement: await project(pool, event, user, character, await getRow(pool, eventId, target)) });
      else send(res, 200, await overview(pool, event, user, character, url.searchParams.get('manage') === 'true'));
      return true;
    }
    const action = target ? route[3] || 'edit' : 'create';
    if ((action === 'edit' ? method !== 'PUT' : method !== 'POST') || (!target && route[3])) fail(405, 'Method not allowed.');
    const input = validateOathRequest(await body(req), action), hash = createHash('sha256').update(canonical({ action, target, input })).digest('hex');
    let created = false;
    const result = await transaction(pool, async db => {
      let event = await membership(db, eventId, user.id, true);
      const prior = (await db.query('SELECT * FROM oath_requests WHERE event_id=$1 AND actor_user_id=$2 AND request_id=$3', [eventId, user.id, input.requestId])).rows[0];
      if (prior && prior.payload_hash !== hash) fail(409, 'This request identifier was already used for different agreement terms.');
      let row = target || prior ? await getRow(db, eventId, target || prior.agreement_id, true) : null, list = row ? await parties(db, row) : [];
      const proposedIds = ['create', 'edit'].includes(action) ? [...input.participantIds, ...input.witnessIds] : [];
      const proposedOwners = proposedIds.length ? (await db.query('SELECT user_id FROM characters WHERE event_id=$1 AND id=ANY($2::uuid[])', [eventId, proposedIds])).rows.map(c => c.user_id) : [];
      const userIds = [...new Set([user.id, ...list.map(p => p.owner_user_id), ...proposedOwners].filter(Boolean))].sort();
      await db.query('SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE', [userIds]);
      event = await membership(db, eventId, user.id);
      const character = action === 'adjudicate' ? null : await ownCharacter(db, event, user, input.characterId);
      if (action !== 'adjudicate' && !character) lostCharacter();
      if (action === 'adjudicate') requireManager(event);
      if (row) { list = await parties(db, row); requireAccess(event, list, user, character, action === 'adjudicate'); }
      if (prior) return { agreement: await project(db, event, user, character, row, list), outcome: { replayed: true } };
      if ((await db.query('SELECT count(*)::int AS n FROM oath_requests WHERE event_id=$1 AND actor_user_id=$2', [eventId, user.id])).rows[0].n >= 10000) fail(429, 'Agreement request history is full for this account and event.');
      requireOpen(event);
      if (action !== 'adjudicate' && !playable(event)) fail(409, 'Player actions require a live event or rehearsal.');
      if (row) requireVersion(input, row);
      const now = await clock(db);
      if (action === 'create') {
        const validated = await validateDocument(db, event, input, character.id, now);
        const id = randomUUID();
        await db.query('INSERT INTO oath_agreements(id,event_id,creator_user_id,creator_character_id,title,terms,settlement,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, eventId, user.id, character.id, input.title, input.terms, JSON.stringify(validated.settlement), input.expiresAt]);
        row = await getRow(db, eventId, id); await installParties(db, row, input, validated.selected); list = await parties(db, row);
        await history(db, event, user, row, 'created', character, { snapshot: snapshot(row, list) }); created = true;
      } else {
        const own = ownParty(list, user, character), principal = own?.kind === 'participant';
        if (action === 'edit' || action === 'cancel') {
          if (row.creator_user_id !== user.id || row.creator_character_id !== character.id) fail(403, 'Only the agreement creator can revise or cancel a proposal.');
          if (row.status !== 'proposed') fail(409, 'Only proposed agreements can be revised or cancelled.');
          requireUnexpired(row, now);
          if (action === 'edit') {
            const validated = await validateDocument(db, event, input, character.id, now, row.id);
            const candidate = Object.fromEntries(['title', 'terms', 'participantIds', 'witnessIds', 'expiresAt', 'settlement'].map(key => [key, input[key]]));
            if (canonical(document(row, list)) !== canonical(candidate)) {
              const priorSnapshot = snapshot(row, list);
              await db.query('UPDATE oath_agreements SET title=$3,terms=$4,settlement=$5,expires_at=$6,version=version+1,terms_version=terms_version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2', [eventId, row.id, input.title, input.terms, JSON.stringify(validated.settlement), input.expiresAt]);
              await db.query('DELETE FROM oath_participants WHERE event_id=$1 AND agreement_id=$2', [eventId, row.id]);
              row = await getRow(db, eventId, row.id); await installParties(db, row, input, validated.selected); list = await parties(db, row);
              await history(db, event, user, row, 'revised', character, { priorSnapshot, snapshot: snapshot(row, list) });
            }
          } else {
            await db.query("UPDATE oath_agreements SET status='cancelled',version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2", [eventId, row.id]);
            await history(db, event, user, row, 'cancelled', character);
          }
        } else if (action === 'accept' || action === 'witness') {
          if (action === 'accept' ? !principal : own?.kind !== 'witness') fail(403, action === 'accept' ? 'Only a named participant can accept these terms.' : 'Only a named witness can attest these terms.');
          if (action === 'accept' ? row.status !== 'proposed' : !['proposed', 'active'].includes(row.status)) fail(409, 'This agreement is no longer awaiting that signature.');
          requireEligible(list); requireUnexpired(row, now);
          const field = action === 'accept' ? 'accepted_terms_version' : 'witnessed_terms_version', timestamp = action === 'accept' ? 'accepted_at' : 'witnessed_at';
          if (own[field] !== row.terms_version) {
            await db.query(`UPDATE oath_participants SET ${field}=$4,${timestamp}=clock_timestamp() WHERE event_id=$1 AND agreement_id=$2 AND character_id=$3`, [eventId, row.id, character.id, row.terms_version]);
            list = await parties(db, row);
            const active = list.filter(p => p.kind === 'participant').every(p => p.accepted_terms_version === row.terms_version);
            await db.query('UPDATE oath_agreements SET status=$3,version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2', [eventId, row.id, active ? 'active' : 'proposed']);
            await history(db, event, user, row, action === 'accept' ? 'accepted' : 'witnessed', character);
          }
        } else if (action === 'settle') {
          if (!principal) fail(403, 'Only a participant can confirm fulfillment and settlement.');
          if (row.status !== 'active') fail(409, 'Only an active agreement can be settled.');
          requireEligible(list); requireUnexpired(row, now);
          if (own.settlement_terms_version !== row.terms_version) {
            await db.query('UPDATE oath_participants SET settlement_terms_version=$4,settlement_confirmed_at=clock_timestamp() WHERE event_id=$1 AND agreement_id=$2 AND character_id=$3', [eventId, row.id, character.id, row.terms_version]);
            list = await parties(db, row);
            const final = list.filter(p => p.kind === 'participant').every(p => p.settlement_terms_version === row.terms_version);
            if (final) await settle(db, event, user, row, list);
            await db.query('UPDATE oath_agreements SET status=$3,version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2', [eventId, row.id, final ? 'fulfilled' : 'active']);
            await history(db, event, user, row, final ? 'fulfilled' : 'settlement_confirmed', character);
          }
        } else if (action === 'dispute') {
          if (!principal) fail(403, 'Only a participant can dispute this agreement.');
          if (!['active', 'fulfilled'].includes(row.status)) fail(409, 'Only active or fulfilled agreements can be disputed.');
          await db.query("UPDATE oath_agreements SET status='disputed',version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2", [eventId, row.id]);
          await history(db, event, user, row, 'disputed', character, { reason: input.reason });
        } else if (action === 'adjudicate') {
          if (!['active', 'disputed'].includes(row.status)) fail(409, 'Only active or disputed agreements can be adjudicated.');
          if (input.settle && !row.settled_at) {
            if (!playable(event)) fail(409, 'Settlement requires a live event or rehearsal.');
            await settle(db, event, user, row, list);
          }
          await db.query("UPDATE oath_agreements SET status='adjudicated',version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2", [eventId, row.id]);
          await history(db, event, user, row, 'adjudicated', null, { reason: input.reason, outcome: input.outcome, settled: input.settle && !row.settled_at });
        }
        row = await getRow(db, eventId, row.id); list = await parties(db, row);
      }
      await db.query('INSERT INTO oath_requests(event_id,actor_user_id,request_id,payload_hash,agreement_id) VALUES($1,$2,$3,$4,$5)', [eventId, user.id, input.requestId, hash, row.id]);
      return { agreement: await project(db, event, user, character, row, list), outcome: { replayed: false } };
    });
    send(res, created ? 201 : 200, result); return true;
  };
}
