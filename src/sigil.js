import { randomUUID, randomInt, createHash } from 'node:crypto';
import { defaultAdventure } from '../public/adventure-model.js';
import { defaultSigilDocument, validateSigilDocument, validateSigilRequest, sigilUUID, SIGIL_LEASE_MS } from '../public/sigil-model.js';
import { ownStoryCharacter, storyConditionsPass } from './story.js';
import { readEconomyAssets } from './economy.js';
import { inspectSigilComponents, consumeSigilComponents } from './sigil-components.js';

const reject = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const managers = new Set(['owner', 'organizer', 'superuser']);
const operators = new Set([...managers, 'staff']);
const playable = event => ['live', 'rehearsal'].includes(event.status);
const enabled = event => event.setup.enabledInstruments.includes('sigil');
const pending = row => ['running', 'paused'].includes(row.status);
const eventDTO = event => ({ id: event.id, name: event.name, status: event.status, role: event.role });
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const clock = async db => new Date((await db.query('SELECT clock_timestamp() AS time')).rows[0].time).getTime();
const iso = value => value === null || value === undefined ? null : new Date(value).toISOString();
const code = () => { const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from({ length: 20 }, () => alphabet[randomInt(alphabet.length)]).join(''); };
const normalizeAnswer = value => value.normalize('NFKC').toLocaleLowerCase('en-US').trim();
const entryFor = async (db, eventId, id) => (await db.query('SELECT * FROM sigil_entries WHERE event_id=$1 AND id=$2', [eventId, id])).rows[0];
const runFor = async (db, eventId, id) => (await db.query('SELECT * FROM sigil_runs WHERE event_id=$1 AND id=$2', [eventId, id])).rows[0];
const requireOpen = event => { if (event.status === 'archived') reject(409, 'Archived events are read-only.'); };
const requirePlayable = event => { requireOpen(event); if (!enabled(event)) reject(403, 'SIGIL is not enabled for this event.'); if (!playable(event)) reject(409, 'Challenges require a live event or rehearsal.'); };
const requireVersion = (input, row) => { if (input.version !== row.version) reject(409, 'This challenge changed. Reload and review before continuing.'); };
async function contextFor(db, event) {
  const definition = (await db.query('SELECT definition FROM event_adventures WHERE event_id=$1', [event.id])).rows[0]?.definition || defaultAdventure();
  const resources = (await db.query('SELECT id,name FROM economy_resources WHERE event_id=$1 ORDER BY id', [event.id])).rows;
  return { definition, resources };
}
async function hostFor(db, row) {
  return (await db.query(`SELECT c.*, (c.user_id=$3 AND c.status='approved' AND NOT COALESCE(u.is_disabled,true) AND (COALESCE(u.is_superuser,false) OR EXISTS(SELECT 1 FROM memberships m WHERE m.event_id=c.event_id AND m.user_id=$3))) AS eligible FROM characters c LEFT JOIN users u ON u.id=$3 WHERE c.event_id=$1 AND c.id=$2`, [row.event_id, row.character_id, row.owner_user_id])).rows[0];
}
async function recordHistory(db, event, row, actorId, action, details = {}, system = false) {
  const count = (await db.query('SELECT count(*)::int AS n FROM sigil_history WHERE event_id=$1 AND run_id=$2', [event.id, row.id])).rows[0].n;
  // Two final records remain available after the ordinary interaction limit.
  if (!system && count >= 510) reject(429, 'This challenge has reached its interaction limit. Staff can cancel it; existing history is preserved.');
  if (count < 512) await db.query('INSERT INTO sigil_history(id,event_id,run_id,actor_user_id,action,details) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), event.id, row.id, actorId, action, JSON.stringify(details)]);
  await db.query('INSERT INTO audit_entries(event_id,actor_id,action,details) VALUES($1,$2,$3,$4)', [event.id, actorId, `sigil.${action}`, JSON.stringify({ runId: row.id, entryId: row.entry_id, ...details })]);
}
export function projectSigilClock(row, now = Date.now()) {
  let status = row.status, pauseReason = row.pause_reason, remainingMs = row.remaining_ms, checkpointElapsedMs = row.checkpoint_elapsed_ms;
  if (status === 'running') {
    const deadline = new Date(row.deadline_at).getTime(), lease = new Date(row.lease_expires_at).getTime();
    const end = Math.min(now, deadline, lease);
    remainingMs = Math.max(0, Math.round(deadline - end));
    checkpointElapsedMs += Math.max(0, Math.round(end - new Date(row.checkpoint_started_at).getTime()));
    if (deadline <= lease && deadline <= now) { status = 'failed'; pauseReason = 'deadline'; }
    else if (lease < deadline && lease <= now) { status = 'paused'; pauseReason = 'connection'; }
  }
  return { status, pauseReason, remainingMs, checkpointElapsedMs };
}
async function outcomeFor(db, row) {
  const outcome = (await db.query('SELECT status,text,flags,consumption,journal_id,created_at FROM sigil_outcomes WHERE event_id=$1 AND run_id=$2', [row.event_id, row.id])).rows[0];
  return outcome ? { status: outcome.status, text: outcome.text, flags: outcome.flags, consumption: outcome.consumption, journalId: outcome.journal_id, at: iso(outcome.created_at) } : null;
}
async function finish(db, event, row, actorId, status, { reason = null, system = false, now = null } = {}) {
  if (!pending(row)) return row;
  const host = await hostFor(db, row);
  if (!host?.eligible) reject(409, 'The host no longer owns an approved character with current event access.');
  const context = await contextFor(db, event);
  try { validateSigilDocument(row.snapshot, context.definition, event.setup.rules, context.resources); } catch { reject(409, 'Challenge references changed. Ask an organizer to review the configuration.'); }
  if (status === 'succeeded') {
    const progress = (await db.query('SELECT progress,flags FROM adventure_runs WHERE event_id=$1 AND character_id=$2', [event.id, row.character_id])).rows[0];
    if (!storyConditionsPass(row.snapshot.conditions, host, event, progress, context)) reject(409, 'The host no longer meets this challenge’s required discoveries, skills or event conditions.');
  }
  if (status === 'succeeded' && (await db.query("SELECT id FROM sigil_outcomes WHERE event_id=$1 AND entry_id=$2 AND character_id=$3 AND status='succeeded'", [event.id, row.entry_id, row.character_id])).rows.length) reject(409, 'This character has already completed this challenge.');
  if ((await db.query('SELECT count(*)::int AS n FROM adventure_journal WHERE event_id=$1 AND character_id=$2', [event.id, row.character_id])).rows[0].n >= 1000) reject(429, 'The character journal is full. No challenge outcome or components were changed.');
  const consumption = status === 'succeeded' ? await consumeSigilComponents(db, event.id, row.character_id, row.snapshot.components, row.bindings) : { items: [], resources: [] };
  const configured = row.snapshot[status === 'succeeded' ? 'success' : 'failure'];
  const flags = Object.fromEntries(configured.flags.map(id => [id, true]));
  await db.query(`INSERT INTO adventure_runs(event_id,character_id,flags) VALUES($1,$2,$3) ON CONFLICT(event_id,character_id) DO UPDATE SET flags=adventure_runs.flags || EXCLUDED.flags`, [event.id, row.character_id, JSON.stringify(flags)]);
  const journalId = randomUUID();
  await db.query('INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,type) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [journalId, event.id, row.character_id, `sigil:${row.entry_id}`, `sigil:${row.id}`, row.snapshot.title, configured.text, 'sigil']);
  await db.query('INSERT INTO sigil_outcomes(id,event_id,run_id,entry_id,owner_user_id,character_id,status,text,flags,consumption,journal_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [randomUUID(), event.id, row.id, row.entry_id, row.owner_user_id, row.character_id, status, configured.text, JSON.stringify(configured.flags), JSON.stringify(consumption), journalId]);
  const current = projectSigilClock(row, now ?? await clock(db));
  await db.query('UPDATE sigil_runs SET status=$3,pause_reason=NULL,remaining_ms=$4,checkpoint_elapsed_ms=$5,checkpoint_index=$6,deadline_at=NULL,lease_expires_at=NULL,checkpoint_started_at=NULL,version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2', [event.id, row.id, status, current.remainingMs, current.checkpointElapsedMs, status === 'succeeded' ? row.snapshot.checkpoints.length : row.checkpoint_index]);
  await recordHistory(db, event, row, actorId, status, { ...(reason ? { reason } : {}), journalId }, system);
  return runFor(db, event.id, row.id);
}
async function pauseRun(db, event, row, actorId, pauseReason, now, { reason = null, system = false } = {}) {
  if (row.status !== 'running') return row;
  const view = projectSigilClock(row, now);
  await db.query("UPDATE sigil_runs SET status='paused',pause_reason=$3,remaining_ms=$4,checkpoint_elapsed_ms=$5,deadline_at=NULL,lease_expires_at=NULL,checkpoint_started_at=NULL,version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2", [event.id, row.id, pauseReason, view.remainingMs, view.checkpointElapsedMs]);
  await recordHistory(db, event, row, actorId, 'paused', { pauseReason, ...(reason ? { reason } : {}) }, system);
  return runFor(db, event.id, row.id);
}
async function cancelRun(db, event, row, actorId, reason = null, system = false, now = null) {
  if (!pending(row)) return row;
  const view = projectSigilClock(row, now ?? await clock(db));
  await db.query("UPDATE sigil_runs SET status='cancelled',pause_reason=NULL,remaining_ms=$3,checkpoint_elapsed_ms=$4,deadline_at=NULL,lease_expires_at=NULL,checkpoint_started_at=NULL,version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2", [event.id, row.id, view.remainingMs, view.checkpointElapsedMs]);
  await recordHistory(db, event, row, actorId, 'cancelled', reason ? { reason } : {}, system);
  return runFor(db, event.id, row.id);
}
async function reconcile(db, event, row, actorId, now) {
  if (row.status !== 'running') return row;
  const derived = projectSigilClock(row, now);
  if (derived.status === 'failed') {
    // Removed hosts cannot acquire flags or receipts through a clock transition.
    if (!(await hostFor(db, row))?.eligible) return cancelRun(db, event, row, actorId, 'The host is no longer eligible.', true, now);
    const context = await contextFor(db, event);
    try { validateSigilDocument(row.snapshot, context.definition, event.setup.rules, context.resources); } catch { return cancelRun(db, event, row, actorId, 'The timer expired while challenge references were unavailable. No outcome flags were applied.', true, now); }
    if ((await db.query('SELECT count(*)::int AS n FROM adventure_journal WHERE event_id=$1 AND character_id=$2', [event.id, row.character_id])).rows[0].n >= 1000) return cancelRun(db, event, row, actorId, 'The timer expired while the character journal was full. No outcome flags were applied.', true, now);
    return finish(db, event, row, actorId, 'failed', { reason: 'The active timer expired.', system: true, now });
  }
  if (derived.status === 'paused') return pauseRun(db, event, row, actorId, 'connection', now, { system: true });
  return row;
}
export async function syncSigilEventState(db, beforeEvent, afterEvent, actorId) {
  const ends = ['ended', 'archived'].includes(afterEvent.status);
  const freezes = !playable(afterEvent) || !enabled(afterEvent);
  if (!ends && !freezes) return;
  const rows = (await db.query("SELECT * FROM sigil_runs WHERE event_id=$1 AND status IN('running','paused') ORDER BY id", [beforeEvent.id])).rows;
  if (!rows.length) return;
  const owners = [...new Set([actorId, ...rows.map(row => row.owner_user_id)])].sort();
  await db.query('SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE', [owners]);
  const now = await clock(db);
  for (let row of rows) {
    if (ends) { await cancelRun(db, beforeEvent, row, actorId, `Event ${afterEvent.status}.`, true, now); continue; }
    row = await reconcile(db, beforeEvent, row, actorId, now);
    if (row.status === 'running') await pauseRun(db, beforeEvent, row, actorId, !enabled(afterEvent) ? 'instrument' : 'event', now, { system: true });
  }
}
export async function resetSigil(db, eventId) {
  for (const table of ['sigil_requests', 'sigil_history', 'sigil_outcomes', 'sigil_runs']) await db.query(`DELETE FROM ${table} WHERE event_id=$1`, [eventId]);
}
export async function copySigil(db, sourceEventId, eventId, actorId) {
  for (const row of (await db.query('SELECT * FROM sigil_entries WHERE event_id=$1 ORDER BY created_at,id', [sourceEventId])).rows) await db.query('INSERT INTO sigil_entries(id,event_id,code,document,published,status,published_version,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), eventId, code(), JSON.stringify(row.document), row.published ? JSON.stringify(row.published) : null, row.status, row.published ? 1 : 0, actorId]);
}
export async function seedSigil(db, event, actorId) {
  if ((await db.query('SELECT id FROM sigil_entries WHERE event_id=$1 LIMIT 1', [event.id])).rows.length) return;
  const theme = event.setup.theme?.id || event.setup.themeId || 'fantasy';
  const names = theme === 'cyberpunk' ? ['Relay synchronization', 'Operator', 'Signal analyst', 'Connect the relay', 'Align the signal', 'Commit the restoration'] : theme === 'wasteland' ? ['Pump restoration', 'Mechanic', 'Lookout', 'Prepare the pump', 'Check the pressure', 'Restore the flow'] : ['The restoration ritual', 'Ritual keeper', 'Witness', 'Prepare the circle', 'Align the sigil', 'Seal the restoration'];
  const document = { ...defaultSigilDocument(), title: names[0], summary: 'Gather two people around one host device. The host supplies the listed components; only a successful completion consumes any marked costs.', organizerNotes: 'Shared-device cooperation: assign the two in-person roles, review the host components and take turns confirming the three checkpoints. Pause before leaving the device. Reconnection requires an explicit resume. Staff may intervene with a recorded reason.', durationSeconds: 300, roles: [{ id: 'lead', name: names[1], instructions: 'Guide the sequence on the shared device.' }, { id: 'witness', name: names[2], instructions: 'Read the field evidence and confirm each handover.' }], components: [{ id: 'notebook', name: 'Field notes', kind: 'item', itemName: 'Pocket notebook', resourceId: null, quantity: 1, consume: false }], checkpoints: names.slice(3).map((title, index) => ({ id: ['prepare', 'align', 'restore'][index], title, instructions: ['Compare the discovered field evidence and confirm that everyone is ready.', 'Ask the second performer to check the evidence and confirm the alignment.', 'Have both performers agree that the procedure is complete, then confirm the restoration.'][index], roleId: index === 1 ? 'witness' : 'lead', minimumSeconds: 0, answer: null })), conditions: { completed: ['evidence-core'], flags: [], skills: [], statuses: [] }, success: { text: 'The cooperative restoration is complete. The field readings have changed.', flags: ['cooperation-complete'] }, failure: { text: 'The procedure timed out. No components were consumed. Regroup and try again.', flags: ['cooperation-failed'] } };
  const context = await contextFor(db, event); validateSigilDocument(document, context.definition, event.setup.rules, context.resources);
  await db.query("INSERT INTO sigil_entries(id,event_id,code,document,published,status,published_version,created_by) VALUES($1,$2,$3,$4,$4,'published',1,$5)", [randomUUID(), event.id, code(), JSON.stringify(document), actorId]);
}

export function createSigilHandler({ pool, helpers }) {
  const { body, send, membership, transaction, audit } = helpers;
  const lookupLimits = new Map();
  const requireManager = event => { if (!managers.has(event.role)) reject(403, 'Only an organizer can author or publish challenges.'); };
  const requireOperator = event => { if (!operators.has(event.role)) reject(403, 'Only event staff can operate challenges.'); };
  const notFound = () => reject(404, 'Challenge not found.');
  const requireHost = (row, user, character) => { if (!character || row.owner_user_id !== user.id || row.character_id !== character.id) notFound(); };
  async function available(db, event, character, entry, context) {
    let blockedReason = null;
    const completed = character ? Boolean((await db.query("SELECT id FROM sigil_outcomes WHERE event_id=$1 AND entry_id=$2 AND character_id=$3 AND status='succeeded'", [event.id, entry.id, character.id])).rows.length) : false;
    if (!character) blockedReason = 'Choose an approved character.';
    else if (!enabled(event)) blockedReason = 'SIGIL is not enabled for this event.';
    else if (!playable(event)) blockedReason = 'Challenges require a live event or rehearsal.';
    else if (!entry.published || entry.status === 'withdrawn') blockedReason = 'This challenge is not currently published.';
    else if (completed) blockedReason = 'This character has already completed this challenge.';
    else {
      try { validateSigilDocument(entry.published, context.definition, event.setup.rules, context.resources); } catch { blockedReason = 'Challenge references changed. Ask an organizer to review them.'; }
      const run = (await db.query('SELECT progress,flags FROM adventure_runs WHERE event_id=$1 AND character_id=$2', [event.id, character.id])).rows[0];
      if (!blockedReason && !storyConditionsPass(entry.published.conditions, character, event, run, context)) blockedReason = 'The required discoveries, skills or event conditions are not complete.';
    }
    return { available: !blockedReason, blockedReason, completed };
  }
  function entryDTO(entry, manage) {
    if (manage) return { id: entry.id, version: entry.version, publishedVersion: entry.published_version, status: entry.status, hasUnpublishedChanges: Boolean(entry.published && canonical(entry.document) !== canonical(entry.published)), code: entry.code, document: entry.document, published: entry.published };
    const document = entry.published;
    return { id: entry.id, version: entry.version, publishedVersion: entry.published_version, status: entry.status, code: entry.code, published: document ? { title: document.title, summary: document.summary, durationSeconds: document.durationSeconds, roles: document.roles, components: document.components } : null };
  }
  async function project(db, event, user, character, row, now = null) {
    if (!operators.has(event.role)) requireHost(row, user, character);
    const host = await hostFor(db, row), owned = row.owner_user_id === user.id && character?.id === row.character_id && host?.eligible;
    const current = projectSigilClock(row, now ?? await clock(db));
    let status = current.status, blockedReason = null;
    const entry = await entryFor(db, event.id, row.entry_id), context = await contextFor(db, event);
    let valid = true; try { validateSigilDocument(row.snapshot, context.definition, event.setup.rules, context.resources); } catch { valid = false; }
    if (pending(row) && !host?.eligible) { status = 'unavailable'; blockedReason = 'The host no longer owns an approved character with current event access.'; }
    else if (pending(row) && !valid) blockedReason = 'Challenge references changed. Ask an organizer to review them.';
    if (!enabled(event)) blockedReason ||= 'SIGIL is not enabled for this event.';
    if (!playable(event)) blockedReason ||= event.status === 'archived' ? 'Archived events are read-only.' : 'Challenges require a live event or rehearsal.';
    if (entry?.status === 'withdrawn') blockedReason ||= 'This challenge was withdrawn. Staff must publish it before play resumes.';
    if (current.status === 'failed' && row.status === 'running') blockedReason ||= 'The active timer expired. The result will be recorded when the device reconnects.';
    const actionable = Boolean(host?.eligible && valid && playable(event) && enabled(event) && entry?.status !== 'withdrawn');
    const checkpoint = pending(row) ? row.snapshot.checkpoints[row.checkpoint_index] : null;
    const checkpointRemainingMs = checkpoint ? Math.max(0, checkpoint.minimumSeconds * 1000 - current.checkpointElapsedMs) : 0;
    const history = (await db.query('SELECT id,action,details,created_at FROM sigil_history WHERE event_id=$1 AND run_id=$2 ORDER BY created_at,id', [event.id, row.id])).rows.map(record => ({ id: record.id, action: record.action, ...record.details, at: iso(record.created_at) }));
    return { id: row.id, entryId: row.entry_id, title: row.snapshot.title, version: row.version, publishedVersion: row.published_version, status, pauseReason: current.pauseReason, character: { id: row.character_id, name: row.character_name }, roles: row.roles.map(role => ({ ...row.snapshot.roles.find(item => item.id === role.roleId), ...role })), components: row.snapshot.components, bindings: row.bindings, currentCheckpoint: checkpoint && ['running', 'paused'].includes(status) ? { id: checkpoint.id, title: checkpoint.title, instructions: checkpoint.instructions, roleId: checkpoint.roleId, minimumSeconds: checkpoint.minimumSeconds, requiresAnswer: checkpoint.answer !== null } : null, completedCheckpoints: row.snapshot.checkpoints.slice(0, row.checkpoint_index).map(step => ({ id: step.id, title: step.title })), remainingMs: current.remainingMs, checkpointRemainingMs, serverTime: iso(now ?? await clock(db)), leaseExpiresAt: current.status === 'running' ? iso(row.lease_expires_at) : null, heartbeatSequence: row.heartbeat_sequence, result: await outcomeFor(db, row), history, canAdvance: Boolean(owned && actionable && status === 'running' && checkpointRemainingMs === 0), canPause: Boolean(owned && status === 'running' && event.status !== 'archived'), canResume: Boolean(owned && actionable && status === 'paused'), canCancel: Boolean(owned && pending(row) && event.status !== 'archived'), canOperate: operators.has(event.role) && event.status !== 'archived' && pending(row), readOnly: !owned || !actionable || !['running', 'paused'].includes(status), blockedReason };
  }
  async function summaries(db, event, user, character, manage) {
    const rows = (await db.query(`SELECT r.id,r.event_id,r.entry_id,r.character_id,r.character_name,r.owner_user_id,r.snapshot->>'title' AS title,r.version,r.status,r.pause_reason,r.remaining_ms,r.deadline_at,r.lease_expires_at,r.checkpoint_elapsed_ms,r.checkpoint_started_at,r.updated_at FROM sigil_runs r JOIN characters c ON c.event_id=r.event_id AND c.id=r.character_id WHERE r.event_id=$1 AND ($2::boolean OR (r.owner_user_id=$3 AND r.character_id=$4 AND c.user_id=r.owner_user_id AND c.status='approved')) ORDER BY r.updated_at DESC,r.id DESC LIMIT $5`, [event.id, manage, user.id, character?.id || null, manage ? 200 : 50])).rows;
    const now = await clock(db), result = [];
    for (const row of rows) { const view = projectSigilClock(row, now), host = await hostFor(db, row); result.push({ id: row.id, entryId: row.entry_id, title: row.title, character: { id: row.character_id, name: row.character_name }, version: row.version, status: pending(row) && !host?.eligible ? 'unavailable' : view.status, pauseReason: view.pauseReason, remainingMs: view.remainingMs, updatedAt: iso(row.updated_at) }); }
    return result;
  }
  async function overview(db, event, user, character, manage = false) {
    const context = await contextFor(db, event), canManage = managers.has(event.role), canOperate = operators.has(event.role);
    const entries = (await db.query(`SELECT * FROM sigil_entries WHERE event_id=$1 ${manage && canManage ? '' : "AND published IS NOT NULL"} ORDER BY created_at,id`, [event.id])).rows;
    const result = { event: eventDTO(event), canManage, canOperate, readOnly: !playable(event) || !enabled(event), runs: await summaries(db, event, user, character, manage) };
    if (manage) return { ...result, entries: entries.map(entry => entryDTO(entry, canManage)), context: { nodes: context.definition.nodes.map(row => ({ id: row.id, title: row.title })), flags: context.definition.flags.map(row => ({ id: row.id, name: row.name })), skills: event.setup.rules.expertise, resources: context.resources } };
    const characters = (await db.query("SELECT c.id,c.profile->>'name' AS name FROM characters c JOIN users u ON u.id=c.user_id WHERE c.event_id=$1 AND c.user_id=$2 AND c.status='approved' AND NOT u.is_disabled ORDER BY c.created_at,c.id", [event.id, user.id])).rows;
    const challenges = []; for (const entry of entries) challenges.push({ id: entry.id, title: entry.published.title, summary: entry.published.summary, publishedVersion: entry.published_version, ...await available(db, event, character, entry, context) });
    return { ...result, character: character ? { id: character.id, name: character.profile.name } : null, characters, challenges, ...await readEconomyAssets(db, event.id, character?.id), readOnly: result.readOnly || !character };
  }
  async function lookup(db, event, character, input) {
    const entry = (await db.query('SELECT * FROM sigil_entries WHERE event_id=$1 AND code=$2 AND published IS NOT NULL', [event.id, input.code])).rows[0];
    if (!entry) notFound();
    const availability = await available(db, event, character, entry, await contextFor(db, event));
    return { challenge: { id: entry.id, title: entry.published.title, summary: entry.published.summary, publishedVersion: entry.published_version, durationSeconds: entry.published.durationSeconds, roles: entry.published.roles, components: entry.published.components, ...availability } };
  }
  return async function handleSigil({ req, res, path, url, method, user }) {
    const route = /^\/api\/events\/([^/]+)\/sigil(?:\/(manage|lookup|start|entries|runs))?(?:\/([^/]+))?(?:\/(publish|withdraw|checkpoint|pause|resume|cancel|heartbeat|operate))?$/.exec(path);
    if (!route) return false;
    if (!user) reject(401, 'Sign in to continue.');
    const eventId = sigilUUID(route[1], 'Event'), section = route[2], target = route[3] ? sigilUUID(route[3], 'Challenge') : null, operation = route[4];
    if (method === 'GET') {
      if (operation || target && section !== 'runs' || section && !['manage', 'runs'].includes(section) || section === 'runs' && !target) reject(405, 'Method not allowed.');
      const event = await membership(pool, eventId, user.id);
      if (section === 'manage') { requireOperator(event); send(res, 200, await overview(pool, event, user, null, true)); return true; }
      const character = await ownStoryCharacter(pool, event, user, url.searchParams.get('characterId'));
      if (target) { const row = await runFor(pool, eventId, target); if (!row) notFound(); send(res, 200, { run: await project(pool, event, user, character, row) }); }
      else send(res, 200, await overview(pool, event, user, character));
      return true;
    }
    let action;
    if (section === 'entries') action = target ? operation || 'edit' : 'create';
    else if (section === 'runs' && target) action = operation;
    else if (!target && !operation && ['lookup', 'start'].includes(section)) action = section;
    if (!action || !(['create', 'edit', 'publish', 'withdraw'].includes(action) ? section === 'entries' : ['lookup', 'start'].includes(action) || section === 'runs') || (action === 'edit' ? method !== 'PUT' : method !== 'POST') || ['publish', 'withdraw'].includes(action) && !target) reject(405, 'Method not allowed.');
    const input = validateSigilRequest(await body(req, 384_000), action);
    if (action === 'lookup') {
      const event = await membership(pool, eventId, user.id), key = `${eventId}:${user.id}`, now = Date.now(), prior = lookupLimits.get(key);
      if (!prior || prior.until <= now) { if (lookupLimits.size > 5000) for (const [oldKey, value] of lookupLimits) if (value.until <= now) lookupLimits.delete(oldKey); if (!lookupLimits.has(key) && lookupLimits.size >= 10000) reject(429, 'Code lookup capacity is busy. Wait a minute and try again.'); lookupLimits.set(key, { count: 1, until: now + 60_000 }); }
      else if (++prior.count > 60) reject(429, 'Too many code lookups. Wait a minute and try again.');
      const character = await ownStoryCharacter(pool, event, user, input.characterId); send(res, 200, await lookup(pool, event, character, input)); return true;
    }
    const hash = createHash('sha256').update(canonical({ action, target, input })).digest('hex');
    let created = false;
    const response = await transaction(pool, async db => {
      let event = await membership(db, eventId, user.id, true);
      const prior = input.requestId ? (await db.query('SELECT * FROM sigil_requests WHERE event_id=$1 AND actor_user_id=$2 AND request_id=$3', [eventId, user.id, input.requestId])).rows[0] : null;
      if (prior && prior.payload_hash !== hash) reject(409, 'This request identifier was already used for different challenge data.');
      const isAuthor = ['create', 'edit', 'publish', 'withdraw'].includes(action);
      let row = section === 'runs' || prior?.run_id ? await runFor(db, eventId, target || prior.run_id) : null;
      if (section === 'runs' && !row) notFound();
      const affectedOwners = action === 'withdraw' ? (await db.query("SELECT owner_user_id FROM sigil_runs WHERE event_id=$1 AND entry_id=$2 AND status='running'", [eventId, target])).rows.map(run => run.owner_user_id) : [];
      const owners = [...new Set([user.id, row?.owner_user_id, ...affectedOwners].filter(Boolean))].sort();
      await db.query('SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE', [owners]);
      event = await membership(db, eventId, user.id);
      if (isAuthor) requireManager(event); if (action === 'operate') requireOperator(event);
      const character = isAuthor || action === 'operate' ? null : await ownStoryCharacter(db, event, user, input.characterId);
      if (!isAuthor && action !== 'operate' && !character) reject(404, 'Character not found or not assigned to you.');
      if (row && action !== 'operate') requireHost(row, user, character);
      const beforeVersion = row?.version, now = await clock(db);
      if (row && event.status !== 'archived') row = await reconcile(db, event, row, user.id, now);
      const reconciled = Boolean(row && row.version !== beforeVersion);
      // A rejected requested action must not roll back an authoritative clock
      // transition that was discovered after acquiring the event/user locks.
      await db.query('SAVEPOINT sigil_requested_action');
      try {
      if (prior) return row ? { run: await project(db, event, user, character, row, now), outcome: { ...prior.outcome, replayed: true } } : { entry: entryDTO(await entryFor(db, eventId, prior.entry_id), true), outcome: { replayed: true } };
      requireOpen(event);
      if (input.requestId && (await db.query('SELECT count(*)::int AS n FROM sigil_requests WHERE event_id=$1 AND actor_user_id=$2', [eventId, user.id])).rows[0].n >= 10000) {
        if (row && row.version !== beforeVersion) return { run: await project(db, event, user, character, row, now), outcome: { replayed: false, interrupted: true, message: 'The timer state was recorded. Challenge request history is full; this command was not applied.' } };
        reject(429, 'Challenge request history is full for this account and event.');
      }
      let entry = null, outcome = { replayed: false };
      const record = async () => { if (input.requestId) await db.query('INSERT INTO sigil_requests(event_id,actor_user_id,request_id,payload_hash,action,entry_id,run_id,outcome) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [eventId, user.id, input.requestId, hash, action, row?.entry_id || entry?.id || null, row?.id || null, JSON.stringify(outcome)]); };
      if (isAuthor) {
        entry = target ? await entryFor(db, eventId, target) : null; if (target && !entry) notFound(); if (entry) requireVersion(input, entry);
        const context = await contextFor(db, event);
        if (action === 'create' || action === 'edit') {
          const document = validateSigilDocument(input.document, context.definition, event.setup.rules, context.resources);
          if (action === 'create') {
            if ((await db.query('SELECT count(*)::int AS n FROM sigil_entries WHERE event_id=$1', [eventId])).rows[0].n >= 30) reject(429, 'This event already has thirty challenges.');
            const id = randomUUID(); await db.query('INSERT INTO sigil_entries(id,event_id,code,document,created_by) VALUES($1,$2,$3,$4,$5)', [id, eventId, code(), JSON.stringify(document), user.id]); entry = await entryFor(db, eventId, id); created = true;
          } else if (canonical(document) !== canonical(entry.document)) { await db.query('UPDATE sigil_entries SET document=$3,version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2', [eventId, entry.id, JSON.stringify(document)]); entry = await entryFor(db, eventId, entry.id); }
        } else if (action === 'publish') {
          validateSigilDocument(entry.document, context.definition, event.setup.rules, context.resources);
          await db.query("UPDATE sigil_entries SET published=document,status='published',published_version=published_version+1,version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2", [eventId, entry.id]); entry = await entryFor(db, eventId, entry.id);
        } else {
          const active = (await db.query("SELECT * FROM sigil_runs WHERE event_id=$1 AND entry_id=$2 AND status='running' ORDER BY id", [eventId, entry.id])).rows;
          const freezeAt = await clock(db);
          for (let run of active) { run = await reconcile(db, event, run, user.id, freezeAt); if (run.status === 'running') await pauseRun(db, event, run, user.id, 'withdrawn', freezeAt, { system: true }); }
          await db.query("UPDATE sigil_entries SET status='withdrawn',version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2", [eventId, entry.id]); entry = await entryFor(db, eventId, entry.id);
        }
        await audit(db, eventId, user.id, `sigil.${action}`, { entryId: entry.id, version: entry.version }); await record(); return { entry: entryDTO(entry, true), outcome };
      }
      if (action === 'start') {
        requirePlayable(event); entry = await entryFor(db, eventId, input.entryId); if (!entry || entry.code !== input.code) notFound();
        if (entry.published_version !== input.publishedVersion) reject(409, 'The challenge publication changed. Scan again and review the current component costs.');
        const availability = await available(db, event, character, entry, await contextFor(db, event)); if (!availability.available) reject(409, availability.blockedReason);
        if (entry.published.roles.length !== input.roles.length || entry.published.roles.some(role => !input.roles.some(item => item.roleId === role.id))) reject(400, 'Assign every published role exactly once.');
        const counts = (await db.query("SELECT count(*) FILTER(WHERE status IN('running','paused'))::int AS active,count(*) FILTER(WHERE entry_id=$3 AND status IN('running','paused'))::int AS same,count(*) FILTER(WHERE entry_id=$3)::int AS attempts FROM sigil_runs WHERE event_id=$1 AND character_id=$2", [eventId, character.id, entry.id])).rows[0];
        if (counts.same) reject(409, 'This character already has an unfinished attempt. Open it to confirm its current state, or ask staff to cancel it.');
        if (counts.active >= 5 || counts.attempts >= 50) reject(429, 'This character has reached the active challenge or attempt limit.');
        await inspectSigilComponents(db, eventId, character.id, entry.published.components, input.bindings);
        const id = randomUUID(), startedAt = await clock(db), remaining = entry.published.durationSeconds * 1000;
        await db.query('INSERT INTO sigil_runs(id,event_id,entry_id,owner_user_id,character_id,character_name,snapshot,published_version,roles,bindings,remaining_ms,deadline_at,lease_expires_at,checkpoint_started_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)', [id, eventId, entry.id, user.id, character.id, character.profile.name, JSON.stringify(entry.published), entry.published_version, JSON.stringify(input.roles), JSON.stringify(input.bindings), remaining, iso(startedAt + remaining), iso(startedAt + SIGIL_LEASE_MS), iso(startedAt)]);
        row = await runFor(db, eventId, id); await recordHistory(db, event, row, user.id, 'started'); created = true;
      } else if (action === 'heartbeat') {
        if (row.status === 'running' && playable(event) && enabled(event) && input.sequence > row.heartbeat_sequence) await db.query('UPDATE sigil_runs SET lease_expires_at=$3,heartbeat_sequence=$4 WHERE event_id=$1 AND id=$2', [eventId, row.id, iso(now + SIGIL_LEASE_MS), input.sequence]);
        row = await runFor(db, eventId, row.id); return { run: await project(db, event, user, character, row, now) };
      } else {
        const operation = action === 'operate' ? input.operation : action, reason = action === 'operate' ? input.reason : null;
        if (row.version !== beforeVersion && (row.status !== 'paused' || operation !== 'resume')) { outcome = { replayed: false, interrupted: true, message: row.status === 'paused' ? 'Connection was interrupted. Review the paused attempt and resume explicitly.' : 'The attempt ended before this command arrived.' }; await record(); return { run: await project(db, event, user, character, row, now), outcome }; }
        if (!(row.version !== beforeVersion && operation === 'resume' && input.version === beforeVersion)) requireVersion(input, row);
        if (!pending(row)) reject(409, 'This attempt has already ended. Its outcome cannot be applied again.');
        if (operation === 'cancel') row = await cancelRun(db, event, row, user.id, reason, action === 'operate', now);
        else if (operation === 'pause') { if (row.status !== 'running') reject(409, 'Only a running challenge can be paused.'); row = await pauseRun(db, event, row, user.id, action === 'operate' ? 'staff' : 'host', now, { reason }); }
        else {
          requirePlayable(event); entry = await entryFor(db, eventId, row.entry_id);
          if (entry.status === 'withdrawn') reject(409, 'This challenge was withdrawn. Publish it before resuming play.');
          const host = await hostFor(db, row); if (!host?.eligible) reject(409, 'The host no longer owns an approved character with current event access.');
          const context = await contextFor(db, event); try { validateSigilDocument(row.snapshot, context.definition, event.setup.rules, context.resources); } catch { reject(409, 'Challenge references changed. Ask an organizer to review them.'); }
          if (operation === 'resume') {
            if (row.status !== 'paused') reject(409, 'Only a paused challenge can be resumed.');
            const progress = (await db.query('SELECT progress,flags FROM adventure_runs WHERE event_id=$1 AND character_id=$2', [eventId, row.character_id])).rows[0];
            if (!storyConditionsPass(row.snapshot.conditions, host, event, progress, context)) reject(409, 'The host no longer meets this challenge’s required discoveries, skills or event conditions.');
            await db.query("UPDATE sigil_runs SET status='running',pause_reason=NULL,deadline_at=$3,lease_expires_at=$4,checkpoint_started_at=$5,version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2", [eventId, row.id, iso(now + row.remaining_ms), iso(now + SIGIL_LEASE_MS), iso(now)]);
            await recordHistory(db, event, row, user.id, 'resumed', reason ? { reason } : {}); row = await runFor(db, eventId, row.id);
          } else if (operation === 'succeed' || operation === 'fail') row = await finish(db, event, row, user.id, operation === 'succeed' ? 'succeeded' : 'failed', { reason, now });
          else {
            if (row.status !== 'running') reject(409, 'Resume this challenge before advancing a checkpoint.');
            const checkpoint = row.snapshot.checkpoints[row.checkpoint_index], view = projectSigilClock(row, now);
            if (action !== 'operate') {
              if (checkpoint.id !== input.checkpointId || checkpoint.roleId !== input.roleId) reject(409, 'Review the current checkpoint and assigned role.');
              if (view.checkpointElapsedMs < checkpoint.minimumSeconds * 1000) reject(409, 'The checkpoint minimum active time has not elapsed.');
              if (checkpoint.answer !== null && normalizeAnswer(input.answer) !== normalizeAnswer(checkpoint.answer)) { outcome = { replayed: false, accepted: false, message: 'That code does not match. Review the field clue and try again.' }; await recordHistory(db, event, row, user.id, 'answer_rejected', { checkpointId: checkpoint.id }); await record(); return { run: await project(db, event, user, character, row, now), outcome }; }
            }
            if (row.checkpoint_index + 1 === row.snapshot.checkpoints.length) row = await finish(db, event, row, user.id, 'succeeded', { reason, now });
            else { await db.query('UPDATE sigil_runs SET checkpoint_index=checkpoint_index+1,checkpoint_elapsed_ms=0,checkpoint_started_at=$3,version=version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND id=$2', [eventId, row.id, iso(now)]); await recordHistory(db, event, row, user.id, 'checkpoint', { checkpointId: checkpoint.id, ...(reason ? { reason } : {}) }); row = await runFor(db, eventId, row.id); }
          }
        }
      }
      await record(); return { run: await project(db, event, user, character, row), outcome };
      } catch (error) {
        if (!reconciled || error.status < 400 || error.status >= 500 || !Number.isInteger(error.status)) throw error;
        await db.query('ROLLBACK TO SAVEPOINT sigil_requested_action');
        row = await runFor(db, eventId, row.id);
        const interrupted = { replayed: false, interrupted: true, message: `${error.message} The timer state was recorded; the requested action was not applied.` };
        if (input.requestId && (await db.query('SELECT count(*)::int AS n FROM sigil_requests WHERE event_id=$1 AND actor_user_id=$2', [eventId, user.id])).rows[0].n < 10000) await db.query('INSERT INTO sigil_requests(event_id,actor_user_id,request_id,payload_hash,action,entry_id,run_id,outcome) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [eventId, user.id, input.requestId, hash, action, row.entry_id, row.id, JSON.stringify(interrupted)]);
        return { run: await project(db, event, user, character, row, now), outcome: interrupted };
      }
    });
    send(res, created ? 201 : 200, response); return true;
  };
}
