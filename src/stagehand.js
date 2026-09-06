import { randomUUID, createHash } from 'node:crypto';
import { validateStagehandRequest, stagehandUUID } from '../public/stagehand-model.js';
import { defaultStoryDocument } from '../public/story-model.js';
import * as core from './stagehand-core.js';
import { createStagehandParties, partyAffectedUsers } from './stagehand-parties.js';

const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const reject = core.stagehandReject;
const requireManager = event => { if (!core.stagehandManagers.has(event.role)) reject(403, 'Only an organizer can configure encounters and assign staff.'); };
const requireVersion = (input, encounter) => { if (input.version !== encounter.version) reject(409, 'This encounter changed. Refresh and review the current readiness and configuration.'); };
const terminal = encounter => ['ended', 'cancelled'].includes(encounter.state);
export function createStagehandHandler({ pool, helpers }) {
  const { body, send, membership, transaction } = helpers;
  const partyHandler = createStagehandParties({ core });
  async function validateConfiguration(db, event, document, existing = null) {
    const context = await core.stagehandContext(db, event);
    if (document.staffUserIds.some(id => !context.staff.some(staff => staff.id === id))) reject(400, 'Assign current enabled event staff or organizers.');
    const candidate = { ...(existing || {}), document }, node = core.stagehandNode(candidate, context);
    if (document.nodeId && !node) reject(400, 'Choose a current WAYFINDER scene from this event.');
    if (node && document.capacity > node.maxPlayers) reject(400, 'Encounter capacity cannot exceed the authored scene capacity.');
    if (document.nodeId && (await db.query("SELECT id FROM stagehand_encounters WHERE event_id=$1 AND document->>'nodeId'=$2 AND ($3::uuid IS NULL OR id<>$3)", [event.id, document.nodeId, existing?.id || null])).rows.length) reject(409, 'This WAYFINDER scene already has an operations encounter. Unlink its previous encounter after every active party is released.');
    if (existing && document.nodeId !== existing.document.nodeId && (await db.query("SELECT id FROM stagehand_parties WHERE event_id=$1 AND encounter_id=$2 AND status IN('waiting','dispatched') LIMIT 1", [event.id, existing.id])).rows.length) reject(409, 'Return, redirect or cancel every active party before changing the linked scene. Party destination consent must remain explicit.');
    const occupied = await core.stagehandCapacity(db, event, { ...candidate, id: existing?.id || null }, context);
    if (document.capacity < occupied.attendanceCount) reject(409, 'Capacity cannot be reduced below the currently reserved and occupied seats.');
  }
  async function encounterAction(db, event, user, action, target, input, prior) {
    let encounter = target || prior ? await core.stagehandEncounter(db, event.id, target || prior.target_id) : null;
    if (['create', 'edit'].includes(action)) requireManager(event); else core.stagehandRequireOperator(event, user, encounter);
    if (prior) return { targetId: encounter.id, characterId: null, manage: true, message: 'The earlier encounter action is recorded.' };
    if (event.status === 'archived') reject(409, 'Archived events are read-only.');
    if (encounter) requireVersion(input, encounter);
    if (action === 'create') {
      if ((await db.query('SELECT count(*)::int AS n FROM stagehand_encounters WHERE event_id=$1', [event.id])).rows[0].n >= 100) reject(429, 'This event already has one hundred encounters.');
      await validateConfiguration(db, event, input.document);
      const id = randomUUID(); await db.query('INSERT INTO stagehand_encounters(id,event_id,document,created_by) VALUES($1,$2,$3,$4)', [id, event.id, JSON.stringify(input.document), user.id]);
      encounter = await core.stagehandEncounter(db, event.id, id);
      await core.stagehandRecordHistory(db, event, user.id, id, null, 'encounter.created');
    } else if (action === 'edit') {
      await validateConfiguration(db, event, input.document, encounter);
      if (stable(input.document) !== stable(encounter.document)) {
        await db.query("UPDATE stagehand_encounters SET document=$3,checks='{}',state=CASE WHEN state='open' THEN 'paused' ELSE state END,version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2", [event.id, encounter.id, JSON.stringify(input.document)]);
        await core.stagehandRecordHistory(db, event, user.id, encounter.id, null, 'encounter.revised', { reason: 'Configuration changed; every readiness acknowledgment must be reviewed again.' });
      }
    } else if (action === 'check') {
      if (terminal(encounter)) reject(409, 'This encounter is terminal. Create another encounter to run a new scene.');
      if (!encounter.document.checks.some(check => check.id === input.checkId)) reject(400, 'Choose a current readiness check.');
      const checks = { ...encounter.checks, [input.checkId]: { ready: input.ready, actorId: user.id, at: new Date(await core.stagehandClock(db)).toISOString(), reason: input.reason } };
      await db.query("UPDATE stagehand_encounters SET checks=$3,state=CASE WHEN state='open' AND NOT $4 THEN 'paused' ELSE state END,version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2", [event.id, encounter.id, JSON.stringify(checks), input.ready]);
      await core.stagehandRecordHistory(db, event, user.id, encounter.id, null, 'encounter.checked', { checkId: input.checkId, ready: input.ready, reason: input.reason });
    } else if (action === 'state') {
      if (terminal(encounter)) reject(409, 'Ended and cancelled encounters cannot reopen. Release or redirect their parties and create a new encounter.');
      if (input.state === 'open') {
        await core.stagehandAssertAdmission(db, event, encounter, [], { requireOpen: false });
        if (!core.stagehandReady(encounter, await core.stagehandContext(db, event))) reject(409, 'Have current authorized staff acknowledge every readiness check before opening the encounter.');
      }
      await db.query('UPDATE stagehand_encounters SET state=$3,version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2', [event.id, encounter.id, input.state]);
      // Waiting parties stay intact so a cancelled scene can redirect its queue.
      // Dispatched reservations remain until an explicit release acknowledgment.
      await core.stagehandRecordHistory(db, event, user.id, encounter.id, null, 'encounter.state', { state: input.state, reason: input.reason }, ['paused', 'ended', 'cancelled'].includes(input.state));
    } else if (action === 'announcement') {
      if (!['live', 'rehearsal'].includes(event.status) || !event.setup.enabledInstruments.includes('stagehand') || !event.setup.enabledInstruments.includes('wayfinder') || !event.setup.enabledInstruments.includes('broadside')) reject(409, 'Operational announcements require a live event or rehearsal with STAGEHAND, WAYFINDER and BROADSIDE enabled.');
      if (!core.stagehandNode(encounter, await core.stagehandContext(db, event))) reject(409, 'Link a current WAYFINDER scene before preparing an operations announcement.');
      if ((await db.query('SELECT count(*)::int AS n FROM stagehand_announcements WHERE event_id=$1 AND encounter_id=$2', [event.id, encounter.id])).rows[0].n >= 100) reject(429, 'This encounter has reached its announcement history limit.');
      if ((await db.query('SELECT count(*)::int AS n FROM story_entries WHERE event_id=$1', [event.id])).rows[0].n >= 200) reject(429, 'The event story entry limit has been reached.');
      const storyId = randomUUID(), document = { ...defaultStoryDocument(), title: input.title, body: input.body, sourceLabel: 'Event operations' };
      await db.query("INSERT INTO story_entries(id,event_id,kind,document,status,created_by) VALUES($1,$2,'bulletin',$3,'submitted',$4)", [storyId, event.id, JSON.stringify(document), user.id]);
      await db.query('INSERT INTO stagehand_announcements(id,event_id,encounter_id,encounter_version,story_entry_id,created_by) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), event.id, encounter.id, encounter.version, storyId, user.id]);
      await db.query("INSERT INTO story_activity(id,event_id,entry_id,actor_id,action,version) VALUES($1,$2,$3,$4,'submitted',1)", [randomUUID(), event.id, storyId, user.id]);
      await core.stagehandRecordHistory(db, event, user.id, encounter.id, null, 'announcement.submitted', { storyEntryId: storyId });
    }
    return { targetId: encounter.id, characterId: null, manage: true, message: action === 'announcement' ? 'Announcement submitted to BROADSIDE. An organizer must review and publish it.' : action === 'edit' ? 'Encounter saved. Changed configuration clears readiness and pauses an open encounter.' : action === 'state' && ['cancelled', 'ended'].includes(input.state) ? 'Encounter closed. Redirect or cancel its waiting parties; acknowledge every dispatched party’s return.' : 'Encounter operation recorded.' };
  }
  return async function handleStagehand({ req, res, path, url, method, user }) {
    const route = /^\/api\/events\/([^/]+)\/stagehand(?:\/(manage|encounters|parties|queue))?(?:\/([^/]+))?(?:\/(state|check|announcement|respond|dispatch|return|cancel))?$/.exec(path);
    if (!route) return false;
    if (!user) reject(401, 'Sign in to continue.');
    const eventId = stagehandUUID(route[1], 'Event'), section = route[2], target = route[3] ? stagehandUUID(route[3], 'Record') : null, operation = route[4];
    if (method === 'GET') {
      if (target || operation || section && section !== 'manage') reject(405, 'Method not allowed.');
      const event = await membership(pool, eventId, user.id);
      send(res, 200, await core.stagehandDashboard(pool, event, user, { manage: section === 'manage', characterId: url.searchParams.get('characterId') })); return true;
    }
    let action;
    if (section === 'encounters' && (!operation || ['state', 'check', 'announcement'].includes(operation))) action = target ? operation || 'edit' : !operation ? 'create' : null;
    if (section === 'parties' && (!operation || ['respond', 'dispatch', 'return', 'cancel'].includes(operation))) action = target ? operation || 'party-edit' : !operation ? 'party-create' : null;
    if (section === 'queue' && !target && !operation) action = 'queue';
    if (!action || (['edit', 'party-edit'].includes(action) ? method !== 'PUT' : method !== 'POST')) reject(405, 'Method not allowed.');
    const input = validateStagehandRequest(await body(req, 96_000), action === 'party-create' ? 'partyCreate' : action === 'party-edit' ? 'partyEdit' : action);
    const hash = createHash('sha256').update(stable({ action, target, input })).digest('hex');
    const isParty = section === 'parties' || section === 'queue';
    let created = false;
    const response = await transaction(pool, async db => {
      let event = await membership(db, eventId, user.id, true);
      let prior = (await db.query('SELECT * FROM stagehand_requests WHERE event_id=$1 AND actor_user_id=$2 AND request_id=$3', [eventId, user.id, input.requestId])).rows[0];
      if (!prior) {
        const fallback = (await db.query("SELECT id,release_receipt FROM stagehand_parties WHERE event_id=$1 AND release_receipt->>'actorUserId'=$2 AND release_receipt->>'requestId'=$3 LIMIT 1", [eventId, user.id, input.requestId])).rows[0];
        if (fallback) prior = { target_id: fallback.id, payload_hash: fallback.release_receipt.payloadHash, action: fallback.release_receipt.action, outcome: fallback.release_receipt.outcome, character_id: fallback.release_receipt.characterId, manage: fallback.release_receipt.manage };
      }
      if (prior && prior.payload_hash !== hash) reject(409, 'This request identifier was already used for a different operations command.');
      let affected = [];
      if (isParty) {
        const partyId = target || prior?.target_id || null;
        affected = await partyAffectedUsers(db, eventId, action, partyId, input);
        const currentEncounterId = partyId ? (await db.query('SELECT encounter_id FROM stagehand_parties WHERE event_id=$1 AND id=$2', [eventId, partyId])).rows[0]?.encounter_id : null;
        for (const encounterId of new Set([currentEncounterId, input.encounterId].filter(Boolean))) {
          const encounter = await core.stagehandEncounter(db, eventId, encounterId);
          affected.push(...encounter.document.staffUserIds, ...Object.values(encounter.checks).map(check => check.actorId));
        }
      }
      else {
        affected = [...(input.document?.staffUserIds || [])];
        const id = target || prior?.target_id;
        if (id) { const encounter = await core.stagehandEncounter(db, eventId, id); affected.push(...encounter.document.staffUserIds, ...Object.values(encounter.checks).map(check => check.actorId)); for (const party of (await db.query("SELECT members FROM stagehand_parties WHERE event_id=$1 AND encounter_id=$2 AND status IN('waiting','dispatched')", [eventId, id])).rows) affected.push(...party.members.map(member => member.ownerUserId)); }
        const nodeIds = [...new Set([input.document?.nodeId, id ? (await core.stagehandEncounter(db, eventId, id)).document.nodeId : null].filter(Boolean))];
        if (nodeIds.length) affected.push(...(await db.query('SELECT c.user_id FROM characters c JOIN adventure_attendance a ON a.event_id=c.event_id AND a.character_id=c.id WHERE c.event_id=$1 AND a.node_id=ANY($2::text[]) AND c.user_id IS NOT NULL', [eventId, nodeIds])).rows.map(row => row.user_id));
      }
      const users = [...new Set([user.id, ...affected].filter(Boolean))].sort();
      await db.query('SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE', [users]);
      event = await membership(db, eventId, user.id);
      const count = (await db.query('SELECT count(*)::int AS n FROM stagehand_requests WHERE event_id=$1 AND actor_user_id=$2', [eventId, user.id])).rows[0].n;
      if (!prior && count >= 5000 && !['return', 'cancel'].includes(action)) reject(429, 'Operations request history is full. Existing parties can still be returned or cancelled.');
      const result = await (isParty ? partyHandler : encounterAction)(...(isParty ? [{ db, event, user, action, target, input, prior }] : [db, event, user, action, target, input, prior]));
      const outcome = prior ? { ...prior.outcome, replayed: true } : { action, replayed: false, message: result.message, targetId: result.targetId };
      if (!prior) {
        if (count < 5000) await db.query('INSERT INTO stagehand_requests(event_id,actor_user_id,request_id,payload_hash,action,target_id,character_id,manage,outcome) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [eventId, user.id, input.requestId, hash, action, result.targetId, result.characterId, result.manage, JSON.stringify(outcome)]);
        if (['return', 'cancel'].includes(action)) await db.query('UPDATE stagehand_parties SET release_receipt=$3 WHERE event_id=$1 AND id=$2 AND release_receipt IS NULL', [eventId, result.targetId, JSON.stringify({ requestId: input.requestId, actorUserId: user.id, payloadHash: hash, action, outcome, characterId: result.characterId, manage: result.manage })]);
      }
      created = !prior && ['create', 'party-create', 'queue'].includes(action);
      return { ...await core.stagehandDashboard(db, event, user, { manage: result.manage, characterId: result.characterId }), outcome };
    });
    send(res, created ? 201 : 200, response); return true;
  };
}
