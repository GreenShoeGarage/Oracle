// TRACE records are authored observations, never an assertion of game truth.
import { characterRecord, characterText, characterInteger } from './characters-model.js';
import { normalizeStoryAudience, storyUUID, storyList } from './story-model.js';

const fail = message => { const error = new Error(message); error.status = 400; throw error; };
export const TRACE_KINDS = ['evidence', 'person', 'place', 'theory'];
export const TRACE_LIMITS = { perCharacter: 300, perEvent: 2000, sources: 10, links: 10 };
export function defaultTraceDocument() {
  return { kind: 'evidence', title: '', notes: '', audience: { type: 'private', ids: [] }, sources: [], links: [] };
}
export function validateTraceDocument(value) {
  characterRecord(value, Object.keys(defaultTraceDocument()), 'Investigation record');
  if (!TRACE_KINDS.includes(value.kind)) fail('Choose evidence, person, place, or theory.');
  const sources = storyList(value.sources, TRACE_LIMITS.sources, 'Sources').map(id => storyUUID(id, 'Source identifier'));
  const links = storyList(value.links, TRACE_LIMITS.links, 'Links').map(link => {
    characterRecord(link, ['recordId', 'label'], 'Investigation link');
    return { recordId: storyUUID(link.recordId, 'Linked record identifier'), label: characterText(link.label, 'Link label', 0, 120) };
  });
  if (new Set(sources).size !== sources.length) fail('Choose each source only once.');
  if (new Set(links.map(link => link.recordId)).size !== links.length) fail('Choose each linked record only once.');
  return { kind: value.kind, title: characterText(value.title, 'Title', 1, 120), notes: characterText(value.notes, 'Notes', 0, 6000), audience: normalizeStoryAudience(value.audience), sources, links };
}
export function validateTraceRequest(value, action) {
  const actions = { create: ['requestId', 'characterId', 'document'], update: ['requestId', 'characterId', 'version', 'document'], archive: ['requestId', 'characterId', 'version'] };
  if (!Object.hasOwn(actions, action)) fail('Unsupported investigation action.');
  const fields = actions[action];
  characterRecord(value, fields, 'Investigation request');
  const result = { requestId: storyUUID(value.requestId, 'Request identifier'), characterId: storyUUID(value.characterId, 'Character identifier') };
  if (fields.includes('version')) result.version = characterInteger(value.version, 'Record version', 1, 2147483647);
  if (fields.includes('document')) result.document = validateTraceDocument(value.document);
  return result;
}
