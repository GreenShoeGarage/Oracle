import { characterRecord, characterText, characterInteger } from './characters-model.js';
import { storyUUID, storyList, validateStoryConditions } from './story-model.js';
const fail = message => { const error = new Error(message); error.status = 400; throw error; };
export const SIGIL_LEASE_MS = 20_000;
export const sigilUUID = storyUUID;
const slug = (value, label) => { if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(value)) fail(`${label} must be a lowercase identifier.`); return value; };
const list = (value, min, max, label) => { const entries = storyList(value, max, label); if (entries.length < min) fail(`${label} needs at least ${min} entries.`); return entries; };
const unique = (entries, key, label) => { if (new Set(entries.map(key)).size !== entries.length) fail(`${label} must be unique.`); return entries; };
export function defaultSigilDocument() {
  return { title: '', summary: '', organizerNotes: '', durationSeconds: 300, roles: [{ id: 'lead', name: 'Lead', instructions: '' }], components: [], checkpoints: [{ id: 'begin', title: 'Begin', instructions: 'Confirm that the group is ready.', roleId: 'lead', minimumSeconds: 0, answer: null }], conditions: { completed: [], flags: [], skills: [], statuses: [] }, success: { text: 'The procedure is complete.', flags: [] }, failure: { text: 'The procedure timed out. Regroup and try again.', flags: [] } };
}
export function validateSigilDocument(value, definition = { nodes: [], flags: [] }, rules = { expertise: [] }, resources = []) {
  characterRecord(value, Object.keys(defaultSigilDocument()), 'Challenge');
  const durationSeconds = characterInteger(value.durationSeconds, 'Challenge duration', 10, 3600);
  const roles = unique(list(value.roles, 1, 6, 'Roles').map(row => { characterRecord(row, ['id', 'name', 'instructions'], 'Role'); return { id: slug(row.id, 'Role'), name: characterText(row.name, 'Role name', 1, 80), instructions: characterText(row.instructions, 'Role instructions', 0, 1000) }; }), row => row.id, 'Role identifiers');
  const components = unique(list(value.components, 0, 10, 'Components').map(row => {
    characterRecord(row, ['id', 'name', 'kind', 'itemName', 'resourceId', 'quantity', 'consume'], 'Component');
    if (!['item', 'resource'].includes(row.kind) || typeof row.consume !== 'boolean') fail('Choose a component kind and consumption option.');
    if (row.kind === 'item' ? row.resourceId !== null : row.itemName !== null) fail('A component uses either an item name or a resource identifier.');
    const itemName = row.kind === 'item' ? characterText(row.itemName, 'Required item name', 1, 100) : null;
    const resourceId = row.kind === 'resource' ? slug(row.resourceId, 'Resource') : null;
    if (resourceId && !resources.some(resource => (typeof resource === 'string' ? resource : resource.id) === resourceId)) fail('Choose a resource from this event.');
    return { id: slug(row.id, 'Component'), name: characterText(row.name, 'Component name', 1, 80), kind: row.kind, itemName, resourceId, quantity: characterInteger(row.quantity, 'Component quantity', 1, row.kind === 'item' ? 9999 : 1_000_000_000), consume: row.consume };
  }), row => row.id, 'Component identifiers');
  unique(components, row => `${row.kind}:${row.itemName || row.resourceId}`, 'Component references');
  const checkpoints = unique(list(value.checkpoints, 1, 12, 'Checkpoints').map(row => {
    characterRecord(row, ['id', 'title', 'instructions', 'roleId', 'minimumSeconds', 'answer'], 'Checkpoint');
    if (!roles.some(role => role.id === row.roleId)) fail('Choose an existing role for each checkpoint.');
    return { id: slug(row.id, 'Checkpoint'), title: characterText(row.title, 'Checkpoint title', 1, 120), instructions: characterText(row.instructions, 'Checkpoint instructions', 1, 3000), roleId: row.roleId, minimumSeconds: characterInteger(row.minimumSeconds, 'Checkpoint minimum duration', 0, 600), answer: row.answer === null ? null : characterText(row.answer, 'Checkpoint answer', 1, 80) };
  }), row => row.id, 'Checkpoint identifiers');
  if (checkpoints.reduce((total, checkpoint) => total + checkpoint.minimumSeconds, 0) >= durationSeconds) fail('Checkpoint minimum durations must leave time within the total challenge duration.');
  const outcome = (row, label) => { characterRecord(row, ['text', 'flags'], label); return { text: characterText(row.text, `${label} text`, 1, 6000), flags: validateStoryConditions({ completed: [], flags: row.flags, skills: [], statuses: [] }, definition, rules).flags }; };
  return { title: characterText(value.title, 'Challenge title', 1, 120), summary: characterText(value.summary, 'Challenge summary', 0, 2000), organizerNotes: characterText(value.organizerNotes, 'Organizer notes', 0, 6000), durationSeconds, roles, components, checkpoints, conditions: validateStoryConditions(value.conditions, definition, rules), success: outcome(value.success, 'Success'), failure: outcome(value.failure, 'Failure') };
}
export function validateSigilRequest(value, action) {
  const fields = { create: ['requestId', 'document'], edit: ['requestId', 'version', 'document'], publish: ['requestId', 'version'], withdraw: ['requestId', 'version'], lookup: ['characterId', 'code'], start: ['requestId', 'characterId', 'entryId', 'publishedVersion', 'code', 'roles', 'bindings'], checkpoint: ['requestId', 'characterId', 'version', 'checkpointId', 'roleId', 'answer'], pause: ['requestId', 'characterId', 'version'], resume: ['requestId', 'characterId', 'version'], cancel: ['requestId', 'characterId', 'version'], heartbeat: ['characterId', 'sequence'], operate: ['requestId', 'version', 'operation', 'reason'] };
  if (!Object.hasOwn(fields, action)) fail('Unsupported challenge action.');
  characterRecord(value, fields[action], 'Challenge request');
  const result = {};
  if (fields[action].includes('requestId')) result.requestId = sigilUUID(value.requestId, 'Request');
  if (fields[action].includes('characterId')) result.characterId = sigilUUID(value.characterId, 'Character');
  if (fields[action].includes('version')) result.version = characterInteger(value.version, 'Version', 1, 2147483647);
  if (fields[action].includes('document')) { characterRecord(value.document, Object.keys(defaultSigilDocument()), 'Challenge'); result.document = value.document; }
  if (fields[action].includes('code')) { if (typeof value.code !== 'string' || !/^[A-HJ-NP-Z2-9]{20}$/.test(value.code)) fail('Enter the twenty-character challenge code.'); result.code = value.code; }
  if (action === 'start') {
    result.entryId = sigilUUID(value.entryId, 'Challenge'); result.publishedVersion = characterInteger(value.publishedVersion, 'Publication version', 1, 2147483647);
    result.roles = unique(list(value.roles, 1, 6, 'Performers').map(row => { characterRecord(row, ['roleId', 'performer'], 'Performer'); return { roleId: slug(row.roleId, 'Role'), performer: characterText(row.performer, 'Performer name', 1, 80) }; }), row => row.roleId, 'Assigned roles').sort((a, b) => a.roleId.localeCompare(b.roleId));
    result.bindings = unique(list(value.bindings, 0, 10, 'Item bindings').map(row => { characterRecord(row, ['componentId', 'itemId'], 'Item binding'); return { componentId: slug(row.componentId, 'Component'), itemId: sigilUUID(row.itemId, 'Item') }; }), row => row.componentId, 'Item bindings').sort((a, b) => a.componentId.localeCompare(b.componentId));
  }
  if (action === 'checkpoint') { result.checkpointId = slug(value.checkpointId, 'Checkpoint'); result.roleId = slug(value.roleId, 'Role'); result.answer = characterText(value.answer, 'Answer', 0, 80); }
  if (action === 'heartbeat') result.sequence = characterInteger(value.sequence, 'Heartbeat sequence', 1, 2147483647);
  if (action === 'operate') { if (!['pause', 'resume', 'advance', 'succeed', 'fail', 'cancel'].includes(value.operation)) fail('Choose a supported staff operation.'); result.operation = value.operation; result.reason = characterText(value.reason, 'Staff reason', 1, 2000); }
  return result;
}
