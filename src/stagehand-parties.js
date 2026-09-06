import { randomUUID } from 'node:crypto';

const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const active = party => ['waiting', 'dispatched'].includes(party.status);
const partyFor = async (db, eventId, id) => (await db.query('SELECT * FROM stagehand_parties WHERE event_id=$1 AND id=$2', [eventId, id])).rows[0];
const requireVersion = (input, party) => { if (input.version !== party.version) fail(409, 'This party changed. Refresh and review its current members and destination.'); };
const requireWritable = event => { if (event.status === 'archived') fail(409, 'Archived events are read-only.'); };

// Called while the event mutex is held, before the handler acquires user locks.
// Include both captured identities and current assignments, so reassignment or
// account changes cannot transfer assent while a command waits for its locks.
export async function partyAffectedUsers(db, eventId, action, target, input) {
  const row = target ? await partyFor(db, eventId, target) : null;
  const captured = [...(row?.members || [])], operators = [];
  const attendanceIds = [];
  if (action === 'dispatch' && row) {
    // Readiness and the distinct capacity union also depend on other current
    // accounts. Freeze those users before the final authorized admission read.
    const encounter = (await db.query('SELECT document,checks FROM stagehand_encounters WHERE event_id=$1 AND id=$2', [eventId, row.encounter_id])).rows[0];
    if (encounter) {
      operators.push(...encounter.document.staffUserIds, ...Object.values(encounter.checks).map(check => check.actorId).filter(Boolean));
      for (const party of (await db.query("SELECT members FROM stagehand_parties WHERE event_id=$1 AND encounter_id=$2 AND status='dispatched'", [eventId, row.encounter_id])).rows) captured.push(...party.members);
      if (encounter.document.nodeId) attendanceIds.push(...(await db.query('SELECT character_id FROM adventure_attendance WHERE event_id=$1 AND node_id=$2', [eventId, encounter.document.nodeId])).rows.map(row => row.character_id));
    }
  }
  const ids = [...new Set([...captured.map(member => member.characterId), ...attendanceIds, ...(input.characterIds || []), ...(input.characterId ? [input.characterId] : [])])];
  const current = ids.length ? (await db.query('SELECT user_id FROM characters WHERE event_id=$1 AND id=ANY($2::uuid[]) AND user_id IS NOT NULL', [eventId, ids])).rows.map(character => character.user_id) : [];
  return [...new Set([...captured.map(member => member.ownerUserId), ...current, ...operators])].sort();
}

export function createStagehandParties({ core }) {
  const { stagehandEncounter, stagehandContext, stagehandCanOperate, stagehandRequireOperator, stagehandRequirePlayable, stagehandEligibleMember, stagehandAssertAdmission, stagehandCapacity, stagehandReleaseParty, stagehandRecordHistory } = core;
  async function encounterFor(db, eventId, id) {
    const encounter = await stagehandEncounter(db, eventId, id);
    if (!encounter) fail(404, 'Encounter not found.');
    return encounter;
  }
  function ownMember(party, user, characterId, context) {
    return party.members.find(member => member.characterId === characterId && member.ownerUserId === user.id && stagehandEligibleMember(member, context)) || null;
  }
  function requireCurrentMembers(party, context) {
    if (party.members.some(member => !stagehandEligibleMember(member, context))) fail(409, 'Every party member must still own an approved character with current event access. Revise or cancel the party before continuing.');
    return party.members.map(member => context.characters.find(character => character.id === member.characterId));
  }
  function selectedCharacters(ids, context) {
    const selected = ids.map(id => context.characters.find(character => character.id === id));
    if (selected.some(character => !character)) fail(400, 'Choose approved characters currently assigned to players in this event.');
    return selected;
  }
  function captureMembers(characters) {
    return characters.map(character => ({ characterId: character.id, ownerUserId: character.user_id, name: character.profile.name, response: null, responseTermsVersion: null, respondedAt: null, attendedBefore: false }));
  }
  async function requireNoOtherAssignment(db, eventId, ids, currentId = null) {
    const occupied = (await db.query("SELECT p.id FROM stagehand_parties p WHERE p.event_id=$1 AND ($2::uuid IS NULL OR p.id<>$2) AND p.status IN('waiting','dispatched') AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.members) member WHERE member->>'characterId'=ANY($3::text[])) LIMIT 1", [eventId, currentId, ids])).rows[0];
    if (occupied) fail(409, 'A selected character already belongs to an active party. Staff must return, revise or cancel that assignment first.');
  }
  function requireQueueDestination(encounter) {
    if (['cancelled', 'ended'].includes(encounter.state)) fail(409, 'This encounter has ended. Choose another destination.');
    if (!encounter.document.nodeId) fail(409, 'Link this encounter to a WAYFINDER scene before creating a party.');
  }

  return async function handleParty({ db, event, user, action, target, input, prior }) {
    const context = await stagehandContext(db, event);
    let party = target || prior ? await partyFor(db, event.id, target || prior.target_id) : null;
    if ((target || prior) && !party) fail(404, 'Party not found.');
    let encounter = await encounterFor(db, event.id, party?.encounter_id || input.encounterId);
    let characterId = null, manage = !['queue', 'respond'].includes(action), member = null;

    // Replay is a current authorization check, not an old cached dashboard.
    if (action === 'respond') {
      member = ownMember(party, user, input.characterId, context);
      if (!member) fail(404, 'Party not found or this character is no longer assigned to you.');
      characterId = member.characterId;
    } else if (action === 'queue') {
      const character = context.characters.find(character => character.id === input.characterId && character.user_id === user.id);
      if (!character || (party && !ownMember(party, user, input.characterId, context))) fail(404, 'Character not found or no longer assigned to you.');
      characterId = character.id;
    } else if (action === 'cancel' && !stagehandCanOperate(event, user, encounter)) {
      member = party.members.length === 1 ? ownMember(party, user, party.members[0].characterId, context) : null;
      if (!member) fail(404, 'Party not found or not available for cancellation.');
      // The committed sole-member cancellation receipt remains readable after
      // its waiting party becomes terminal. A player cannot cancel dispatch.
      if (!prior && party.status !== 'waiting') fail(403, 'Ask encounter staff to acknowledge a dispatched party’s return or cancellation.');
      manage = false; characterId = member.characterId;
    } else stagehandRequireOperator(event, user, encounter);
    if (action === 'party-edit') {
      const destination = await encounterFor(db, event.id, input.encounterId);
      stagehandRequireOperator(event, user, destination);
    }
    if (prior) return { characterId, manage, targetId: party.id, message: 'The earlier party action is recorded.' };
    requireWritable(event);

    if (action === 'party-create' || action === 'queue') {
      stagehandRequirePlayable(event);
      requireQueueDestination(encounter);
      const characters = selectedCharacters(action === 'queue' ? [characterId] : input.characterIds, context);
      await stagehandAssertAdmission(db, event, encounter, characters, { requireOpen: false, context });
      await requireNoOtherAssignment(db, event.id, characters.map(character => character.id));
      if ((await db.query('SELECT count(*)::int AS n FROM stagehand_parties WHERE event_id=$1', [event.id])).rows[0].n >= 1000) fail(429, 'This event has reached its one thousand party limit. Existing parties can still return or cancel.');
      const id = randomUUID(), name = action === 'queue' ? `${characters[0].profile.name} — waiting party`.slice(0, 120) : input.name;
      const returnMinutes = action === 'queue' ? encounter.document.returnMinutes : input.returnMinutes;
      await db.query('INSERT INTO stagehand_parties(id,event_id,encounter_id,name,return_minutes,members,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, event.id, encounter.id, name, returnMinutes, JSON.stringify(captureMembers(characters)), user.id]);
      party = await partyFor(db, event.id, id);
      await stagehandRecordHistory(db, event, user.id, encounter.id, party.id, 'party.created', { name, characterIds: characters.map(character => character.id), returnMinutes, selfQueued: action === 'queue' });
      return { characterId, manage, targetId: party.id, message: action === 'queue' ? 'You joined the waiting queue. Review the destination and accept your party assignment.' : 'The whole party is waiting. Every member must accept before dispatch.' };
    }

    requireVersion(input, party);
    if (action === 'party-edit') {
      stagehandRequirePlayable(event);
      if (party.status !== 'waiting') fail(409, 'Only a waiting party can change destination, members or return window.');
      const destination = await encounterFor(db, event.id, input.encounterId);
      requireQueueDestination(destination);
      const characters = selectedCharacters(input.characterIds, context);
      await stagehandAssertAdmission(db, event, destination, characters, { requireOpen: false, context });
      await requireNoOtherAssignment(db, event.id, input.characterIds, party.id);
      const previous = { encounterId: party.encounter_id, name: party.name, characterIds: party.members.map(member => member.characterId), returnMinutes: party.return_minutes, termsVersion: party.terms_version };
      await db.query('UPDATE stagehand_parties SET encounter_id=$3,name=$4,return_minutes=$5,members=$6,terms_version=terms_version+1,version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2', [event.id, party.id, destination.id, input.name, input.returnMinutes, JSON.stringify(captureMembers(characters))]);
      await stagehandRecordHistory(db, event, user.id, encounter.id, party.id, 'party.revised', { previous, encounterId: destination.id, name: input.name, characterIds: input.characterIds, returnMinutes: input.returnMinutes });
      if (destination.id !== encounter.id) await stagehandRecordHistory(db, event, user.id, destination.id, party.id, 'party.redirected', { previousEncounterId: encounter.id, name: input.name, characterIds: input.characterIds });
      return { characterId, manage, targetId: party.id, message: 'The whole party was revised. Every member must review and accept the new assignment.' };
    }
    if (action === 'respond') {
      stagehandRequirePlayable(event);
      if (party.status !== 'waiting') fail(409, 'Only a waiting party can receive consent.');
      requireQueueDestination(encounter);
      await stagehandAssertAdmission(db, event, encounter, [context.characters.find(character => character.id === member.characterId)], { requireOpen: false, context });
      const now = (await db.query('SELECT clock_timestamp() AS time')).rows[0].time;
      const members = party.members.map(value => value.characterId === member.characterId ? { ...value, response: input.response, responseTermsVersion: party.terms_version, respondedAt: new Date(now).toISOString() } : value);
      await db.query('UPDATE stagehand_parties SET members=$3,version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2', [event.id, party.id, JSON.stringify(members)]);
      await stagehandRecordHistory(db, event, user.id, encounter.id, party.id, 'party.responded', { characterId, response: input.response, termsVersion: party.terms_version });
      return { characterId, manage: false, targetId: party.id, message: input.response === 'accepted' ? 'Your current party assignment is accepted.' : 'Your party assignment is declined. Staff can revise or cancel it.' };
    }
    if (action === 'dispatch') {
      stagehandRequirePlayable(event);
      if (party.status !== 'waiting') fail(409, 'Only a waiting party can be dispatched.');
      const characters = requireCurrentMembers(party, context);
      if (party.members.some(member => member.response !== 'accepted' || member.responseTermsVersion !== party.terms_version)) fail(409, 'Every current member must accept this exact party assignment before dispatch.');
      await requireNoOtherAssignment(db, event.id, party.members.map(member => member.characterId), party.id);
      await stagehandAssertAdmission(db, event, encounter, characters, { requireOpen: true, context });
      const capacity = await stagehandCapacity(db, event, encounter, context);
      const occupied = new Set([...capacity.characterIds, ...characters.map(character => character.id)]);
      if (occupied.size > capacity.capacity) fail(409, 'This encounter does not have room for the whole party. No members were dispatched.');
      const attendance = new Set((await db.query('SELECT character_id FROM adventure_attendance WHERE event_id=$1 AND node_id=$2 AND character_id=ANY($3::uuid[])', [event.id, encounter.document.nodeId, characters.map(character => character.id)])).rows.map(row => row.character_id));
      const members = party.members.map(member => ({ ...member, attendedBefore: attendance.has(member.characterId) }));
      const dispatchedAt = new Date((await db.query('SELECT clock_timestamp() AS time')).rows[0].time);
      const returnBy = new Date(dispatchedAt.getTime() + party.return_minutes * 60_000);
      await db.query("UPDATE stagehand_parties SET status='dispatched',members=$3,dispatched_at=$4,return_by=$5,dispatched_node_id=$6,version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2", [event.id, party.id, JSON.stringify(members), dispatchedAt.toISOString(), returnBy.toISOString(), encounter.document.nodeId]);
      await stagehandRecordHistory(db, event, user.id, encounter.id, party.id, 'party.dispatched', { characterIds: members.map(member => member.characterId), returnBy: returnBy.toISOString(), returnMinutes: party.return_minutes, termsVersion: party.terms_version });
      return { characterId, manage: true, targetId: party.id, message: 'The whole party is dispatched. Its seats remain reserved until staff acknowledge return or cancellation.' };
    }
    if (action === 'return' || action === 'cancel') {
      if (action === 'return' ? party.status !== 'dispatched' : !active(party)) fail(409, 'This party assignment has already ended.');
      await stagehandReleaseParty(db, event, party, user.id, action === 'return' ? 'returned' : 'cancelled', input.reason);
      return { characterId, manage, targetId: party.id, message: action === 'return' ? 'The whole party returned. Its dispatch reservations were released.' : 'The party assignment was cancelled and its dispatch reservations were released.' };
    }
    fail(400, 'Unsupported party action.');
  };
}
