import { characterRecord, characterText, characterInteger } from './characters-model.js';
const fail = message => { const error = new Error(message); error.status = 400; throw error; };
export const OATH_STATUSES = ['proposed', 'active', 'fulfilled', 'cancelled', 'disputed', 'adjudicated', 'expired', 'unavailable'];
export function oathUUID(value, label = 'Identifier') {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail(`${label} must be a UUID.`);
  return value.toLowerCase();
}
function list(value, label, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) fail(`${label} must contain ${min}–${max} entries.`);
  for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, i), 'value')) fail(`${label} must contain data entries only.`);
  return value;
}
function ids(value, label, min, max) {
  const result = list(value, label, min, max).map(id => oathUUID(id, label)).sort();
  if (new Set(result).size !== result.length) fail(`${label} must be unique.`);
  return result;
}
export function validateOathDocument(value) {
  const participantIds = ids(value.participantIds, 'Participants', 2, 8), witnessIds = ids(value.witnessIds, 'Witnesses', 0, 5);
  if (participantIds.some(id => witnessIds.includes(id))) fail('Witnesses must be separate from participants.');
  let expiresAt = value.expiresAt;
  if (expiresAt !== null) {
    if (typeof expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(expiresAt) || !Number.isFinite(Date.parse(expiresAt))) fail('Expiration must be an ISO UTC timestamp or null.');
    const normalized = new Date(expiresAt).toISOString();
    if (normalized.replace('.000Z', 'Z') !== expiresAt.replace('.000Z', 'Z')) fail('Expiration must be a valid calendar date.');
    expiresAt = normalized;
  }
  const settlement = list(value.settlement, 'Settlement', 0, 16).map(entry => {
    characterRecord(entry, ['fromCharacterId', 'toCharacterId', 'resourceId', 'quantity'], 'Settlement transfer');
    const fromCharacterId = oathUUID(entry.fromCharacterId), toCharacterId = oathUUID(entry.toCharacterId);
    if (fromCharacterId === toCharacterId || !participantIds.includes(fromCharacterId) || !participantIds.includes(toCharacterId)) fail('Settlement transfers must connect two different participants.');
    if (typeof entry.resourceId !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(entry.resourceId)) fail('Choose a resource identifier.');
    return { fromCharacterId, toCharacterId, resourceId: entry.resourceId, quantity: characterInteger(entry.quantity, 'Settlement quantity', 1, 1_000_000_000) };
  }).sort((a, b) => `${a.fromCharacterId}:${a.toCharacterId}:${a.resourceId}`.localeCompare(`${b.fromCharacterId}:${b.toCharacterId}:${b.resourceId}`));
  if (new Set(settlement.map(row => `${row.fromCharacterId}:${row.toCharacterId}:${row.resourceId}`)).size !== settlement.length) fail('Combine duplicate settlement transfers.');
  return { title: characterText(value.title, 'Agreement title', 1, 120), terms: characterText(value.terms, 'Agreement terms', 1, 12000), participantIds, witnessIds, expiresAt, settlement };
}
export function validateOathRequest(value, action) {
  const doc = ['title', 'terms', 'participantIds', 'witnessIds', 'expiresAt', 'settlement'];
  const fields = { create: ['requestId', 'characterId', ...doc], edit: ['requestId', 'characterId', 'version', ...doc], accept: ['requestId', 'characterId', 'version'], witness: ['requestId', 'characterId', 'version'], settle: ['requestId', 'characterId', 'version'], cancel: ['requestId', 'characterId', 'version'], dispute: ['requestId', 'characterId', 'version', 'reason'], adjudicate: ['requestId', 'version', 'outcome', 'reason', 'settle'] };
  if (!Object.hasOwn(fields, action)) fail('Unsupported agreement action.');
  characterRecord(value, fields[action], 'Agreement request');
  const result = { requestId: oathUUID(value.requestId, 'Request') };
  if (action !== 'adjudicate') result.characterId = oathUUID(value.characterId, 'Character');
  if (action !== 'create') result.version = characterInteger(value.version, 'Agreement version', 1, 2147483647);
  if (['create', 'edit'].includes(action)) Object.assign(result, validateOathDocument(value));
  if (['dispute', 'adjudicate'].includes(action)) result.reason = characterText(value.reason, 'Reason', 1, 2000);
  if (action === 'adjudicate') {
    if (!['fulfilled', 'cancelled'].includes(value.outcome) || typeof value.settle !== 'boolean' || (value.outcome === 'cancelled' && value.settle)) fail('Choose a valid ruling and settlement option.');
    result.outcome = value.outcome; result.settle = value.settle;
  }
  return result;
}
