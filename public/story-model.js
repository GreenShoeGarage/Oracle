import { characterRecord, characterText } from './characters-model.js';
import { ADVENTURE_EVENT_STATUSES, defaultAdventureConditions } from './adventure-model.js';
const fail = message => { const error = new Error(message); error.status = 400; throw error; };
export const STORY_KINDS = ['rumor', 'bulletin'];
export const STORY_AUDIENCES = ['public', 'faction', 'group', 'private'];
export function storyUUID(value, label = 'Identifier') {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail(`${label} must be a valid identifier.`);
  return value.toLowerCase();
}
export function storyList(value, max, label) {
  if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) fail(`${label} must be a list of at most ${max} entries.`);
  for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, i), 'value')) fail(`${label} must contain data entries only.`);
  return value;
}
export function normalizeStoryAudience(value) {
  characterRecord(value, ['type', 'ids'], 'Audience');
  if (!STORY_AUDIENCES.includes(value.type)) fail('Choose a supported audience.');
  const ids = storyList(value.ids, 20, 'Audience').map(id => storyUUID(id));
  if (new Set(ids).size !== ids.length || (value.type === 'public' && ids.length)) fail('Choose unique audience identifiers; public audiences do not take identifiers.');
  return { type: value.type, ids };
}
export function validateStoryConditions(value, definition = { nodes: [], flags: [] }, rules = { expertise: [] }) {
  characterRecord(value, ['completed', 'flags', 'skills', 'statuses'], 'Conditions');
  const known = { completed: (definition.nodes || []).map(n => n.id), flags: (definition.flags || []).map(n => n.id), skills: (rules.expertise || []).map(n => n.id), statuses: ADVENTURE_EVENT_STATUSES };
  return Object.fromEntries(Object.keys(known).map(key => {
    const list = storyList(value[key], 10, 'Conditions');
    if (list.some(id => typeof id !== 'string' || !known[key].includes(id)) || new Set(list).size !== list.length) fail('Conditions include duplicate or unknown references.');
    return [key, [...list]];
  }));
}
export function defaultStoryDocument() {
  return { title: '', body: '', sourceLabel: '', topic: '', truth: '', audience: { type: 'public', ids: [] }, conditions: defaultAdventureConditions(), shareable: false, correctionNote: '' };
}
export function validateStoryDocument(value, definition, rules) {
  characterRecord(value, Object.keys(defaultStoryDocument()), 'Story entry');
  if (typeof value.shareable !== 'boolean') fail('Sharing permission must be true or false.');
  return { title: characterText(value.title, 'Title', 1, 120), body: characterText(value.body, 'Body', 1, 6000), sourceLabel: characterText(value.sourceLabel, 'Source label', 0, 120), topic: characterText(value.topic, 'Organizer topic', 0, 120), truth: characterText(value.truth, 'Organizer truth', 0, 6000), audience: normalizeStoryAudience(value.audience), conditions: validateStoryConditions(value.conditions, definition, rules), shareable: value.shareable, correctionNote: characterText(value.correctionNote, 'Correction note', 0, 1000) };
}
