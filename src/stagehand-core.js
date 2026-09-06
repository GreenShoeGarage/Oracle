import { randomUUID } from 'node:crypto';
import { defaultAdventure } from '../public/adventure-model.js';
import { defaultStagehandDocument } from '../public/stagehand-model.js';
import { ownStoryCharacter, storyConditionsPass } from './story.js';
import { readSharing, sharingPolicyFor } from './sharing.js';

export const stagehandReject = (status, message) => { const error = new Error(message); error.status = status; throw error; };
export const stagehandManagers = new Set(['owner', 'organizer', 'superuser']);
const operators = new Set([...stagehandManagers, 'staff']);
const active = party => ['waiting', 'dispatched'].includes(party.status);
const playable = event => ['live', 'rehearsal'].includes(event.status);
const enabled = event => event.setup.enabledInstruments.includes('stagehand') && event.setup.enabledInstruments.includes('wayfinder');
const iso = value => value ? new Date(value).toISOString() : null;
// Only expected admission refusals are player-facing; database failures use the app's generic error response.
const operationalRefusal = error => { if (!(error?.status >= 400 && error.status < 500)) throw error; };
export const stagehandClock = async db => new Date((await db.query('SELECT clock_timestamp() AS time')).rows[0].time).getTime();
export const stagehandCanOperate = (event, user, encounter) => stagehandManagers.has(event.role) || event.role === 'staff' && encounter.document.staffUserIds.includes(user.id);
export const stagehandRequireOperator = (event, user, encounter) => { if (!encounter || !stagehandCanOperate(event, user, encounter)) stagehandReject(403, 'Only an organizer or staff assigned to this encounter can operate it.'); };
export const stagehandRequirePlayable = event => { if (!playable(event)) stagehandReject(409, 'Admission requires a live event or rehearsal.'); if (!enabled(event)) stagehandReject(403, 'Enable STAGEHAND and WAYFINDER before admitting parties.'); };
export async function stagehandEncounter(db, eventId, id) { const row = (await db.query('SELECT * FROM stagehand_encounters WHERE event_id=$1 AND id=$2', [eventId, id])).rows[0]; if (!row) stagehandReject(404, 'Encounter not found.'); return row; }
export async function stagehandContext(db, event) {
  const definition = (await db.query('SELECT definition FROM event_adventures WHERE event_id=$1', [event.id])).rows[0]?.definition || defaultAdventure();
  const characters = (await db.query(`SELECT c.* FROM characters c JOIN users u ON u.id=c.user_id WHERE c.event_id=$1 AND c.status='approved' AND NOT u.is_disabled AND (u.is_superuser OR EXISTS(SELECT 1 FROM memberships m WHERE m.event_id=c.event_id AND m.user_id=c.user_id)) ORDER BY c.created_at,c.id`, [event.id])).rows;
  const staff = (await db.query(`SELECT u.id,u.display_name AS name,(u.is_superuser OR EXISTS(SELECT 1 FROM memberships m WHERE m.event_id=$1 AND m.user_id=u.id AND m.role IN('owner','organizer'))) AS can_manage FROM users u WHERE NOT u.is_disabled AND (u.is_superuser OR EXISTS(SELECT 1 FROM memberships m WHERE m.event_id=$1 AND m.user_id=u.id AND m.role IN('owner','organizer','staff'))) ORDER BY u.display_name,u.id`, [event.id])).rows;
  return { definition, characters, staff, sharing: await readSharing(db, event.id) };
}
export const stagehandEligibleMember = (member, context) => context.characters.some(character => character.id === member.characterId && character.user_id === member.ownerUserId);
export function stagehandNode(encounter, context) { return context.definition.nodes.find(node => node.id === encounter.document.nodeId && node.type === 'wayfinder') || null; }
const acknowledgmentEligible = (encounter, record, context) => Boolean(record && context?.staff.some(staff => staff.id === record.actorId && (staff.can_manage || encounter.document.staffUserIds.includes(staff.id))));
export function stagehandReady(encounter, context = null) { return encounter.document.checks.every(check => Object.hasOwn(encounter.checks, check.id) && encounter.checks[check.id]?.ready === true && acknowledgmentEligible(encounter, encounter.checks[check.id], context)); }
export async function stagehandCharacterAllowed(db, event, node, character, context) {
  if (!node || !character || !context.characters.some(row => row.id === character.id && row.user_id === character.user_id) || sharingPolicyFor(context.sharing, node.id) === 'organizer_only') return false;
  const progress = (await db.query('SELECT progress,flags FROM adventure_runs WHERE event_id=$1 AND character_id=$2', [event.id, character.id])).rows[0];
  return storyConditionsPass(node.conditions, character, event, progress, context);
}
export async function stagehandCapacity(db, event, encounter, context = null) {
  context ||= await stagehandContext(db, event);
  const node = stagehandNode(encounter, context), ids = new Set();
  if (encounter.document.nodeId) {
    const attendance = (await db.query('SELECT character_id FROM adventure_attendance WHERE event_id=$1 AND node_id=$2', [event.id, encounter.document.nodeId])).rows;
    for (const row of attendance) if (context.characters.some(character => character.id === row.character_id)) ids.add(row.character_id);
  }
  for (const party of (await db.query("SELECT members FROM stagehand_parties WHERE event_id=$1 AND encounter_id=$2 AND status='dispatched'", [event.id, encounter.id])).rows) for (const member of party.members) if (stagehandEligibleMember(member, context)) ids.add(member.characterId);
  return { characterIds: [...ids].sort(), attendanceCount: ids.size, capacity: Math.min(encounter.document.capacity, node?.maxPlayers || encounter.document.capacity) };
}
export async function stagehandAssertAdmission(db, event, encounter, characters, { requireOpen = false, context = null } = {}) {
  stagehandRequirePlayable(event); context ||= await stagehandContext(db, event);
  const node = stagehandNode(encounter, context), now = await stagehandClock(db);
  if (!node) stagehandReject(409, 'Link a current WAYFINDER scene before admitting parties.');
  if (encounter.document.capacity > node.maxPlayers) stagehandReject(409, 'The linked scene capacity changed. An organizer must review this encounter.');
  if (['cancelled', 'ended'].includes(encounter.state)) stagehandReject(409, 'This encounter has ended or been cancelled.');
  if (sharingPolicyFor(context.sharing, node.id) === 'organizer_only') stagehandReject(409, 'The linked scene is not available to players.');
  if (node.availability !== 'open') stagehandReject(409, 'The authored scene is closed.');
  if (node.startsAt && Date.parse(node.startsAt) > now) stagehandReject(409, 'The authored scene has not started yet.');
  if (node.endsAt && Date.parse(node.endsAt) <= now) stagehandReject(409, 'The authored scene has ended.');
  for (const character of characters) if (!await stagehandCharacterAllowed(db, event, node, character, context)) stagehandReject(409, 'Every party member must currently meet the linked scene requirements and own an approved character.');
  if (requireOpen && (encounter.state !== 'open' || !stagehandReady(encounter, context))) stagehandReject(409, 'The encounter must be open with every readiness check acknowledged by current authorized staff.');
  return { node, context, ...await stagehandCapacity(db, event, encounter, context) };
}
export async function stagehandRecordHistory(db, event, actorId, encounterId, partyId, action, details = {}, system = false) {
  const count = (await db.query('SELECT count(*)::int AS n FROM stagehand_history WHERE event_id=$1', [event.id])).rows[0].n;
  if (count >= 10000 && !system) stagehandReject(429, 'Operations history is full. Return and cancellation remain available; existing history is preserved.');
  if (count < 10000) await db.query('INSERT INTO stagehand_history(id,event_id,encounter_id,party_id,actor_user_id,action,details) VALUES($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), event.id, encounterId, partyId, actorId, action, JSON.stringify(details)]);
  await db.query('INSERT INTO audit_entries(event_id,actor_id,action,details) VALUES($1,$2,$3,$4)', [event.id, actorId, `stagehand.${action}`, JSON.stringify({ encounterId, ...(partyId ? { partyId } : {}), ...details })]);
}
export async function stagehandReleaseParty(db, event, party, actorId, status, reason, system = false) {
  if (!['returned', 'cancelled'].includes(status)) stagehandReject(400, 'Choose return or cancellation.');
  if (!active(party)) return party;
  if (party.status === 'dispatched' && party.dispatched_node_id) for (const member of party.members) if (!member.attendedBefore) await db.query('DELETE FROM adventure_attendance a USING characters c WHERE a.event_id=$1 AND a.node_id=$2 AND a.character_id=$3 AND c.event_id=a.event_id AND c.id=a.character_id AND c.user_id=$4', [event.id, party.dispatched_node_id, member.characterId, member.ownerUserId]);
  await db.query('UPDATE stagehand_parties SET status=$3,version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2', [event.id, party.id, status]);
  await stagehandRecordHistory(db, event, actorId, party.encounter_id, party.id, status, { reason }, true);
  void system;
  return (await db.query('SELECT * FROM stagehand_parties WHERE event_id=$1 AND id=$2', [event.id, party.id])).rows[0];
}
export async function syncStagehandEventState(db, beforeEvent, afterEvent, actorId) {
  if (!['ended', 'archived'].includes(afterEvent.status) || beforeEvent.status === afterEvent.status) return;
  const parties = (await db.query("SELECT * FROM stagehand_parties WHERE event_id=$1 AND status IN('waiting','dispatched') ORDER BY id", [beforeEvent.id])).rows;
  const users = [...new Set([actorId, ...parties.flatMap(party => party.members.map(member => member.ownerUserId))])].sort();
  await db.query('SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE', [users]);
  for (const party of parties) await stagehandReleaseParty(db, beforeEvent, party, actorId, 'cancelled', `Event ${afterEvent.status}; assignments closed.`, true);
  for (const encounter of (await db.query("SELECT * FROM stagehand_encounters WHERE event_id=$1 AND state NOT IN('ended','cancelled') ORDER BY id", [beforeEvent.id])).rows) {
    await db.query("UPDATE stagehand_encounters SET state='ended',version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2", [beforeEvent.id, encounter.id]);
    await stagehandRecordHistory(db, beforeEvent, actorId, encounter.id, null, 'event_closed', { reason: `Event ${afterEvent.status}.` }, true);
  }
}
export async function seedStagehand(db, event, actorId) {
  if ((await db.query('SELECT id FROM stagehand_encounters WHERE event_id=$1 LIMIT 1', [event.id])).rows.length) return;
  const theme = event.setup.theme?.id || event.setup.themeId || 'fantasy';
  const title = theme === 'cyberpunk' ? 'Relay control encounter' : theme === 'wasteland' ? 'Pump station encounter' : 'Restoration circle encounter';
  const document = { ...defaultStagehandDocument(), title, publicMessage: 'Check in with event staff before setting out.', staffNotes: 'Choose a WAYFINDER scene, assign current staff, and review the three checks before opening. Linking the scene transfers admission to whole-party dispatch. Waiting parties do not reserve seats. Acknowledge every return; an overdue window does not free capacity.', checks: [{ id: 'performer', label: 'Scene performer briefed and ready', kind: 'performer' }, { id: 'prop', label: 'Required scene prop checked', kind: 'prop' }, { id: 'check-in', label: 'Check-in staff ready to dispatch and receive parties', kind: 'staff' }] };
  await db.query('INSERT INTO stagehand_encounters(id,event_id,document,created_by) VALUES($1,$2,$3,$4)', [randomUUID(), event.id, JSON.stringify(document), actorId]);
}
export async function copyStagehand(db, sourceEventId, eventId, actorId) {
  for (const row of (await db.query('SELECT document FROM stagehand_encounters WHERE event_id=$1 ORDER BY created_at,id', [sourceEventId])).rows) await db.query('INSERT INTO stagehand_encounters(id,event_id,document,created_by) VALUES($1,$2,$3,$4)', [randomUUID(), eventId, JSON.stringify({ ...row.document, staffUserIds: [] }), actorId]);
}
export async function resetStagehand(db, eventId) {
  const storyIds = (await db.query('SELECT story_entry_id FROM stagehand_announcements WHERE event_id=$1', [eventId])).rows.map(row => row.story_entry_id);
  if (storyIds.length) await db.query('DELETE FROM story_entries WHERE event_id=$1 AND id=ANY($2::uuid[])', [eventId, storyIds]);
  for (const table of ['stagehand_requests', 'stagehand_history', 'stagehand_announcements', 'stagehand_parties']) await db.query(`DELETE FROM ${table} WHERE event_id=$1`, [eventId]);
  await db.query("UPDATE stagehand_encounters SET state='planning',checks='{}',version=version+1,updated_at=clock_timestamp() WHERE event_id=$1", [eventId]);
}
export async function assertStagehandAnnouncementCurrent(db, event, storyEntryId) {
  const row = (await db.query("SELECT a.encounter_version,e.version,e.document->>'nodeId' AS node_id FROM stagehand_announcements a JOIN stagehand_encounters e ON e.event_id=a.event_id AND e.id=a.encounter_id WHERE a.event_id=$1 AND a.story_entry_id=$2", [event.id, storyEntryId])).rows[0];
  if (!row) return;
  const definition = (await db.query('SELECT definition FROM event_adventures WHERE event_id=$1', [event.id])).rows[0]?.definition;
  if (row.encounter_version !== row.version || !playable(event) || !enabled(event) || !event.setup.enabledInstruments.includes('broadside') || !definition?.nodes.some(node => node.id === row.node_id && node.type === 'wayfinder')) stagehandReject(409, 'This operations announcement is stale or unavailable. Prepare a new draft from the current encounter before approving it.');
}
export async function filterStagehandBulletins(db, event, entries) {
  if (!entries.length) return entries;
  const links = (await db.query("SELECT a.story_entry_id,a.encounter_version,e.version,e.document->>'nodeId' AS node_id FROM stagehand_announcements a JOIN stagehand_encounters e ON e.event_id=a.event_id AND e.id=a.encounter_id WHERE a.event_id=$1 AND a.story_entry_id=ANY($2::uuid[])", [event.id, entries.map(entry => entry.id)])).rows;
  const definition = (await db.query('SELECT definition FROM event_adventures WHERE event_id=$1', [event.id])).rows[0]?.definition;
  const eligible = playable(event) && enabled(event) && event.setup.enabledInstruments.includes('broadside');
  return entries.filter(entry => { const link = links.find(row => row.story_entry_id === entry.id); return !link || eligible && link.encounter_version === link.version && definition?.nodes.some(node => node.id === link.node_id && node.type === 'wayfinder'); });
}
async function availabilityFor(db, event, encounter, context) {
  const counts = await stagehandCapacity(db, event, encounter, context), node = stagehandNode(encounter, context);
  let availability = encounter.state, reason = null;
  try { await stagehandAssertAdmission(db, event, encounter, [], { requireOpen: true, context }); availability = counts.attendanceCount >= counts.capacity ? 'full' : 'open'; if (availability === 'full') reason = 'All seats are reserved or occupied.'; }
  catch (error) { operationalRefusal(error); reason = error.message; availability = ['planning', 'paused'].includes(encounter.state) ? encounter.state : node?.startsAt && Date.parse(node.startsAt) > await stagehandClock(db) ? 'scheduled' : ['cancelled', 'ended'].includes(encounter.state) ? 'closed' : 'unavailable'; }
  return { ...counts, available: availability === 'open', availability, reason };
}
export async function stagehandWayfinderState(db, event, node, character, { lock = false } = {}) {
  const encounter = (await db.query("SELECT * FROM stagehand_encounters WHERE event_id=$1 AND document->>'nodeId'=$2", [event.id, node.id])).rows[0];
  if (!encounter) return null;
  if (lock) {
    const rows = (await db.query("SELECT members FROM stagehand_parties WHERE event_id=$1 AND encounter_id=$2 AND status IN('waiting','dispatched')", [event.id, encounter.id])).rows;
    const memberIds = [...new Set(rows.flatMap(party => party.members.map(member => member.characterId)))];
    const currentOwners = (await db.query('SELECT c.user_id FROM characters c WHERE c.event_id=$1 AND c.user_id IS NOT NULL AND (c.id=ANY($2::uuid[]) OR EXISTS(SELECT 1 FROM adventure_attendance a WHERE a.event_id=c.event_id AND a.character_id=c.id AND a.node_id=$3))', [event.id, memberIds, node.id])).rows.map(row => row.user_id);
    const userIds = [...new Set([character?.user_id, ...encounter.document.staffUserIds, ...Object.values(encounter.checks).map(check => check.actorId), ...rows.flatMap(party => party.members.map(member => member.ownerUserId)), ...currentOwners].filter(Boolean))].sort();
    await db.query('SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE', [userIds]);
  }
  const context = await stagehandContext(db, event), availability = await availabilityFor(db, event, encounter, context);
  const parties = (await db.query("SELECT * FROM stagehand_parties WHERE event_id=$1 AND encounter_id=$2 AND status IN('waiting','dispatched') ORDER BY created_at,id", [event.id, encounter.id])).rows;
  const ownParty = character ? parties.find(party => party.members.some(member => member.characterId === character.id && member.ownerUserId === character.user_id && stagehandEligibleMember(member, context))) : null;
  let canJoin = false, reason = availability.reason;
  if (ownParty?.status === 'dispatched') {
    try { await stagehandAssertAdmission(db, event, encounter, [character], { requireOpen: true, context }); canJoin = true; reason = null; } catch (error) { operationalRefusal(error); reason = error.message; }
  } else reason ||= 'Join a waiting party and ask assigned staff to dispatch it before entering this scene.';
  return { encounterId: encounter.id, state: encounter.state, reason, canJoin, attendanceCount: availability.attendanceCount, capacity: availability.capacity, partyStatus: ownParty?.status || null, returnBy: iso(ownParty?.return_by) };
}
export async function stagehandDashboard(db, event, user, { manage = false, characterId = null } = {}) {
  if (manage && !operators.has(event.role)) stagehandReject(403, 'Only event staff can open operations management.');
  const context = await stagehandContext(db, event), now = await stagehandClock(db), canManage = stagehandManagers.has(event.role);
  const character = manage ? null : await ownStoryCharacter(db, event, user, characterId);
  const allEncounters = (await db.query('SELECT * FROM stagehand_encounters WHERE event_id=$1 ORDER BY created_at,id', [event.id])).rows;
  const allParties = (await db.query('SELECT * FROM stagehand_parties WHERE event_id=$1 ORDER BY updated_at DESC,id DESC', [event.id])).rows;
  const ownActive = character ? allParties.some(party => active(party) && party.members.some(member => member.characterId === character.id && member.ownerUserId === user.id && stagehandEligibleMember(member, context))) : false;
  const encounters = [], visibleIds = new Set();
  for (const encounter of allEncounters) {
    const node = stagehandNode(encounter, context), scoped = stagehandCanOperate(event, user, encounter);
    if (manage ? !scoped : !await stagehandCharacterAllowed(db, event, node, character, context) || !event.setup.enabledInstruments.includes('wayfinder')) continue;
    visibleIds.add(encounter.id);
    const available = await availabilityFor(db, event, encounter, context);
    const base = { id: encounter.id, version: encounter.version, title: encounter.document.title, nodeId: encounter.document.nodeId, location: node?.location || '', publicMessage: encounter.document.publicMessage, state: encounter.state, available: available.available, availability: available.availability, reason: available.reason, attendanceCount: available.attendanceCount, capacity: available.capacity };
    if (!manage) {
      let canQueue = !ownActive; try { await stagehandAssertAdmission(db, event, encounter, [character], { context }); } catch (error) { operationalRefusal(error); canQueue = false; }
      encounters.push({ ...base, canQueue }); continue;
    }
    const writable = event.status !== 'archived', terminal = ['ended', 'cancelled'].includes(encounter.state);
    let canOpen = writable && !terminal; try { await stagehandAssertAdmission(db, event, encounter, [], { context }); } catch (error) { operationalRefusal(error); canOpen = false; }
    canOpen &&= stagehandReady(encounter, context);
    const records = Object.values(encounter.checks), actorIds = [...new Set(records.map(record => record.actorId).filter(Boolean))];
    const actors = actorIds.length ? (await db.query('SELECT id,display_name FROM users WHERE id=ANY($1::uuid[])', [actorIds])).rows : [];
    const readiness = encounter.document.checks.map(check => { const record = encounter.checks[check.id]; return { checkId: check.id, ready: record?.ready === true && acknowledgmentEligible(encounter, record, context), actorName: actors.find(actor => actor.id === record?.actorId)?.display_name || null, at: record?.at || null, reason: record?.reason || '' }; });
    const announcement = (await db.query('SELECT a.story_entry_id,a.encounter_version,s.status,s.document->>\'title\' AS title FROM stagehand_announcements a JOIN story_entries s ON s.event_id=a.event_id AND s.id=a.story_entry_id WHERE a.event_id=$1 AND a.encounter_id=$2 ORDER BY a.created_at DESC,a.id DESC LIMIT 1', [event.id, encounter.id])).rows[0];
    encounters.push({ ...base, document: encounter.document, readiness, canEdit: canManage && writable, canCheck: writable && !terminal, canOpen: canOpen && encounter.state !== 'open', canPause: writable && encounter.state === 'open', canCancel: writable && !terminal, canEnd: writable && !terminal, canAnnounce: writable && playable(event) && enabled(event) && event.setup.enabledInstruments.includes('broadside') && Boolean(node), announcement: announcement ? { storyEntryId: announcement.story_entry_id, encounterVersion: announcement.encounter_version, status: announcement.status, title: announcement.title, current: announcement.encounter_version === encounter.version && playable(event) && enabled(event) && event.setup.enabledInstruments.includes('broadside') && Boolean(node) } : null });
  }
  const parties = [];
  for (const party of allParties) {
    const encounter = allEncounters.find(row => row.id === party.encounter_id);
    const own = character ? party.members.find(member => member.characterId === character.id && member.ownerUserId === user.id && stagehandEligibleMember(member, context)) : null;
    if (manage ? !visibleIds.has(party.encounter_id) : !own) continue;
    const eligible = party.members.every(member => stagehandEligibleMember(member, context));
    const acceptedCount = party.members.filter(member => member.response === 'accepted' && member.responseTermsVersion === party.terms_version && stagehandEligibleMember(member, context)).length;
    let blockedReason = !eligible && active(party) ? 'A party member no longer owns an approved character with event access.' : null;
    let admission = null;
    if (party.status === 'waiting' && eligible) { try { admission = await stagehandAssertAdmission(db, event, encounter, party.members.map(member => context.characters.find(row => row.id === member.characterId)), { requireOpen: true, context }); } catch (error) { operationalRefusal(error); blockedReason ||= error.message; } }
    const fits = admission ? new Set([...admission.characterIds, ...party.members.map(member => member.characterId)]).size <= admission.capacity : false;
    if (admission && !fits) blockedReason ||= 'The whole party does not fit in the available scene capacity.';
    const base = { id: party.id, version: party.version, termsVersion: party.terms_version, name: party.name, encounterId: party.encounter_id, status: party.status, returnMinutes: party.return_minutes, dispatchedAt: iso(party.dispatched_at), returnBy: iso(party.return_by), overdue: party.status === 'dispatched' && new Date(party.return_by).getTime() < now, memberCount: party.members.length, acceptedCount, blockedReason };
    if (manage) parties.push({ ...base, members: party.members.map(member => ({ characterId: member.characterId, name: member.name, response: member.response, responseTermsVersion: member.responseTermsVersion, respondedAt: member.respondedAt || null, eligible: stagehandEligibleMember(member, context) })), canRevise: party.status === 'waiting' && playable(event) && enabled(event), canDispatch: party.status === 'waiting' && eligible && acceptedCount === party.members.length && fits && Boolean(admission), canReturn: party.status === 'dispatched' && event.status !== 'archived', canCancel: active(party) && event.status !== 'archived' });
    else {
      let canRespond = party.status === 'waiting' && eligible && visibleIds.has(encounter.id);
      try { await stagehandAssertAdmission(db, event, encounter, [character], { context }); } catch (error) { operationalRefusal(error); canRespond = false; }
      parties.push({ ...base, characterId: own.characterId, response: own.response, canRespond, canCancel: party.status === 'waiting' && party.members.length === 1 && event.status !== 'archived' });
    }
  }
  const result = { event: { id: event.id, name: event.name, status: event.status, role: event.role, version: event.version }, serverTime: iso(now), readOnly: event.status === 'archived' || !playable(event) || !enabled(event), canManage, canOperate: operators.has(event.role) && (canManage || allEncounters.some(row => stagehandCanOperate(event, user, row))), encounters, parties };
  if (!manage) return { ...result, character: character ? { id: character.id, name: character.profile.name } : null, characters: context.characters.filter(row => row.user_id === user.id).map(row => ({ id: row.id, name: row.profile.name })) };
  const activity = visibleIds.size ? (await db.query('SELECT h.id,h.encounter_id,h.party_id,h.action,h.details,h.created_at,u.display_name FROM stagehand_history h JOIN users u ON u.id=h.actor_user_id WHERE h.event_id=$1 AND h.encounter_id=ANY($2::uuid[]) ORDER BY h.created_at DESC,h.id DESC LIMIT 100', [event.id, [...visibleIds]])).rows.map(row => ({ id: row.id, encounterId: row.encounter_id, partyId: row.party_id, action: row.action, at: iso(row.created_at), actorName: row.display_name, ...(typeof row.details.reason === 'string' ? { reason: row.details.reason } : {}) })) : [];
  const scopedEncounters = allEncounters.filter(encounter => visibleIds.has(encounter.id));
  return { ...result, context: { nodes: context.definition.nodes.filter(node => node.type === 'wayfinder' && (canManage || scopedEncounters.some(encounter => encounter.document.nodeId === node.id))).map(node => ({ id: node.id, title: node.title, location: node.location, maxPlayers: node.maxPlayers, availability: node.availability })), staff: context.staff.filter(staff => canManage || scopedEncounters.some(encounter => encounter.document.staffUserIds.includes(staff.id))).map(staff => ({ id: staff.id, name: staff.name })), characters: (canManage || visibleIds.size ? context.characters : []).map(row => ({ id: row.id, name: row.profile.name })) }, activity };
}
