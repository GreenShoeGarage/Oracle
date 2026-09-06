import { characterRecord, characterText, characterInteger } from './characters-model.js';
import { storyUUID, storyList } from './story-model.js';
const fail = message => { const error = new Error(message); error.status = 400; throw error; };
export const stagehandUUID = storyUUID;
export const STAGEHAND_STATES = ['planning', 'open', 'paused', 'cancelled', 'ended'];
export const STAGEHAND_PARTY_STATES = ['waiting', 'dispatched', 'returned', 'cancelled'];
export const stagehandSlug = (value, label = 'Identifier') => { if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(value)) fail(`${label} must be a lowercase identifier.`); return value; };
const ids = (value, min, max, label) => { const result = storyList(value, max, label).map(id => stagehandUUID(id, label)).sort(); if (result.length < min || new Set(result).size !== result.length) fail(`${label} must contain ${min}–${max} unique identifiers.`); return result; };
export function defaultStagehandDocument() { return { title: '', nodeId: null, publicMessage: '', staffNotes: '', capacity: 6, staffUserIds: [], checks: [], returnMinutes: 30 }; }
export function validateStagehandDocument(value) {
  characterRecord(value, Object.keys(defaultStagehandDocument()), 'Encounter');
  const checks = storyList(value.checks, 20, 'Readiness checks').map(row => { characterRecord(row, ['id', 'label', 'kind'], 'Readiness check'); if (!['performer', 'prop', 'staff'].includes(row.kind)) fail('Choose a performer, prop or staff check.'); return { id: stagehandSlug(row.id, 'Check'), label: characterText(row.label, 'Check label', 1, 120), kind: row.kind }; });
  if (new Set(checks.map(row => row.id)).size !== checks.length) fail('Readiness check identifiers must be unique.');
  return { title: characterText(value.title, 'Encounter title', 1, 120), nodeId: value.nodeId === null ? null : stagehandSlug(value.nodeId, 'Scene'), publicMessage: characterText(value.publicMessage, 'Public message', 0, 1200), staffNotes: characterText(value.staffNotes, 'Staff notes', 0, 3000), capacity: characterInteger(value.capacity, 'Encounter capacity', 1, 100), staffUserIds: ids(value.staffUserIds, 0, 20, 'Assigned staff'), checks, returnMinutes: characterInteger(value.returnMinutes, 'Return window', 1, 480) };
}
export function validateStagehandRequest(value, action) {
  const fields = { create: ['requestId', 'document'], edit: ['requestId', 'version', 'document'], state: ['requestId', 'version', 'state', 'reason'], check: ['requestId', 'version', 'checkId', 'ready', 'reason'], announcement: ['requestId', 'version', 'title', 'body'], partyCreate: ['requestId', 'encounterId', 'name', 'characterIds', 'returnMinutes'], queue: ['requestId', 'encounterId', 'characterId'], partyEdit: ['requestId', 'version', 'encounterId', 'name', 'characterIds', 'returnMinutes'], respond: ['requestId', 'version', 'characterId', 'response'], dispatch: ['requestId', 'version', 'reason'], return: ['requestId', 'version', 'reason'], cancel: ['requestId', 'version', 'reason'] };
  if (!Object.hasOwn(fields, action)) fail('Unsupported operations action.');
  characterRecord(value, fields[action], 'Operations request');
  const result = { requestId: stagehandUUID(value.requestId, 'Request') };
  if (fields[action].includes('version')) result.version = characterInteger(value.version, 'Version', 1, 2147483647);
  if (fields[action].includes('document')) result.document = validateStagehandDocument(value.document);
  if (fields[action].includes('encounterId')) result.encounterId = stagehandUUID(value.encounterId, 'Encounter');
  if (fields[action].includes('characterId')) result.characterId = stagehandUUID(value.characterId, 'Character');
  if (fields[action].includes('characterIds')) { result.characterIds = ids(value.characterIds, 1, 20, 'Party characters'); result.name = characterText(value.name, 'Party name', 1, 120); result.returnMinutes = characterInteger(value.returnMinutes, 'Return window', 1, 480); }
  if (fields[action].includes('reason')) result.reason = characterText(value.reason, 'Reason', 1, 2000);
  if (action === 'state') { if (!STAGEHAND_STATES.includes(value.state)) fail('Choose a supported encounter state.'); result.state = value.state; }
  if (action === 'check') { result.checkId = stagehandSlug(value.checkId, 'Check'); if (typeof value.ready !== 'boolean') fail('Readiness must be true or false.'); result.ready = value.ready; }
  if (action === 'announcement') { result.title = characterText(value.title, 'Announcement title', 1, 120); result.body = characterText(value.body, 'Announcement body', 1, 6000); }
  if (action === 'respond') { if (!['accepted', 'declined'].includes(value.response)) fail('Choose acceptance or decline.'); result.response = value.response; }
  return result;
}
