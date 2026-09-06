import { characterInteger, characterRecord, characterText } from './characters-model.js';
import { defaultAdventureConditions } from './adventure-model.js';
import { storyList, validateStoryConditions } from './story-model.js';

const fail = message => { const error = new Error(message); error.status = 400; throw error; };
export const STATIC_TONES = ['calm', 'alert', 'critical'];
function staticList(value, maximum, label) {
  const list = storyList(value, maximum, label);
  if (Object.getPrototypeOf(list) !== Array.prototype) fail(`${label} must contain plain data only.`);
  return list;
}
function conditionsFor(value, definition, rules) {
  characterRecord(value, ['completed', 'flags', 'skills', 'statuses'], 'Conditions');
  for (const key of ['completed', 'flags', 'skills', 'statuses']) staticList(value[key], 10, 'Conditions');
  return validateStoryConditions(value, definition, rules);
}
export function staticSlug(value, label = 'Identifier') {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(value) || ['constructor', 'prototype', '__proto__'].includes(value)) fail(`${label} must be a short lowercase identifier.`);
  return value;
}
export function staticCode(value) {
  if (typeof value !== 'string' || !/^[A-HJ-NP-Z2-9]{20}$/.test(value)) fail('Enter a valid STATIC prop code.');
  return value;
}
export function defaultStaticDocument() {
  return { title: '', summary: '', organizerNotes: '', zoneLabel: '', conditions: defaultAdventureConditions(), states: [{ id: 'unsettled', label: 'Unsettled', text: '', level: 25, tone: 'alert' }], defaultStateId: 'unsettled', rules: [] };
}
export function validateStaticDocument(value, definition, rules) {
  characterRecord(value, Object.keys(defaultStaticDocument()), 'STATIC entry');
  const states = staticList(value.states, 12, 'Reading states').map(state => {
    characterRecord(state, ['id', 'label', 'text', 'level', 'tone'], 'Reading state');
    if (!STATIC_TONES.includes(state.tone)) fail('Choose a supported reading tone.');
    return { id: staticSlug(state.id, 'State identifier'), label: characterText(state.label, 'State label', 1, 80), text: characterText(state.text, 'Reading text', 1, 3000), level: characterInteger(state.level, 'Fictional reading level', 0, 100), tone: state.tone };
  });
  if (!states.length || new Set(states.map(state => state.id)).size !== states.length) fail('Provide one to twelve uniquely identified reading states.');
  const stateIds = new Set(states.map(state => state.id));
  if (!stateIds.has(value.defaultStateId)) fail('Choose a default reading state.');
  const preparedRules = staticList(value.rules, 12, 'Reading rules').map(rule => {
    characterRecord(rule, ['id', 'conditions', 'stateId'], 'Reading rule');
    if (!stateIds.has(rule.stateId)) fail('Reading rules must use a defined state.');
    return { id: staticSlug(rule.id, 'Rule identifier'), conditions: conditionsFor(rule.conditions, definition, rules), stateId: rule.stateId };
  });
  if (new Set(preparedRules.map(rule => rule.id)).size !== preparedRules.length) fail('Use each reading rule identifier once.');
  return { title: characterText(value.title, 'Title', 1, 120), summary: characterText(value.summary, 'Summary', 0, 2000), organizerNotes: characterText(value.organizerNotes, 'Organizer notes', 0, 6000), zoneLabel: characterText(value.zoneLabel, 'Zone label', 0, 100), conditions: conditionsFor(value.conditions, definition, rules), states, defaultStateId: value.defaultStateId, rules: preparedRules };
}
