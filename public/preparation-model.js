import { projectSetup } from './kit.js';
import { validateCharacterProfile } from './characters-model.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = message => { throw new Error(message); };
const record = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) fail('Prepared field data must be plain records.');
  return value;
};
const list = (value, max) => {
  if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1 || Array.from({ length: value.length }, (_, i) => Object.getOwnPropertyDescriptor(value, i)).some(row => !row || !Object.hasOwn(row, 'value'))) fail('Prepared field data exceeds its supported limits.');
  return value;
};
const id = value => typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : fail('Prepared field identity is invalid.');
const text = (value, max, required = false) => typeof value === 'string' && value.length <= max && (!required || value.trim()) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ? value : fail('Prepared field text is invalid.');
const date = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : fail('Prepared field timestamp is invalid.');

// An explicit reference-material projection, never a complete API response.
// This is also applied on IndexedDB reads to reject damaged or unsupported data.
export function projectPreparation(input, accountId) {
  record(input); record(input.event); accountId = id(accountId);
  if (input.version !== undefined && input.version !== 1) fail('This prepared field kit format is not supported.');
  const event = { id: id(input.event.id), name: text(input.event.name, 100, true), description: text(input.event.description || '', 2000), location: text(input.event.location || '', 200), startsAt: input.event.startsAt == null ? null : date(input.event.startsAt) };
  const setup = projectSetup(input.setup, 'player');
  const factions = list(input.factions, 30).map(row => { record(row); return { id: id(row.id), name: text(row.name, 80, true) }; });
  const characters = list(input.characters, 10).map(row => {
    record(row);
    if (row.userId !== accountId || row.eventId !== event.id || row.status !== 'approved' || row.visibility !== 'private') fail('Only your own assigned approved character sheets can be prepared.');
    const inventory = list(row.inventory, 200).map(item => {
      record(item);
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 0 || item.quantity > 9999) fail('Prepared inventory quantity is invalid.');
      return { name: text(item.name, 100, true), quantity: item.quantity, notes: text(item.notes || '', 500) };
    });
    return { id: id(row.id), eventId: event.id, userId: accountId, status: 'approved', visibility: 'private', profile: validateCharacterProfile(row.profile, setup, factions), inventory };
  });
  if (new Set(characters.map(row => row.id)).size !== characters.length) fail('Prepared character sheets contain duplicates.');
  const journals = list(input.journals, 10).map(row => {
    record(row); const characterId = id(row.characterId);
    if (!characters.some(character => character.id === characterId)) fail('Prepared readings must belong to your saved characters.');
    const readingIds = list(row.readingIds, 1000).map(value => text(String(value), 100, true));
    if (new Set(readingIds).size !== readingIds.length) fail('Prepared journal references contain duplicates.');
    return { characterId, readingIds, verifiedAt: date(row.verifiedAt) };
  });
  if (new Set(journals.map(row => row.characterId)).size !== journals.length) fail('Prepared journal checks contain duplicates.');
  const result = { version: 1, event, setup, factions: factions.filter(faction => characters.some(row => row.profile.factionId === faction.id)), characters, journals, preparedAt: date(input.preparedAt) };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 4_000_000) fail('This field kit is too large to save on this device.');
  return result;
}

export function preparationReadiness(preparation, archive, accountId) {
  if (!preparation) return { missing: ['No field kit has been prepared for this event.'], journalCount: 0 };
  const missing = []; let journalCount = 0;
  if (!preparation.characters.length) missing.push('No approved character is assigned to you. Ask your organizer, then prepare again.');
  for (const character of preparation.characters) {
    const verification = preparation.journals.find(row => row.characterId === character.id);
    const saved = archive?.accountId === accountId && archive.records?.find(row => row.event.id === preparation.event.id && row.character.id === character.id);
    if (!verification || !saved || Date.parse(saved.lastChecked) < Date.parse(verification.verifiedAt) || verification.readingIds.some(id => !saved.journal.some(row => String(row.id) === id))) missing.push(`Saved readings for ${character.profile.name} are missing or changed. Reconnect and prepare again.`);
    else journalCount += saved.journal.length;
  }
  return { missing, journalCount };
}
