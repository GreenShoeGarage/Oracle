// Adventure schemas are shared with authoring UI. Story solutions and starter
// content belong exclusively in the server's adventure-templates module.
import { characterRecord, characterText, characterInteger } from "./characters-model.js";
const fail = (message) => { const error = new Error(message); error.status = 400; throw error; };
export const ADVENTURE_EVENT_STATUSES = ["draft", "rehearsal", "live", "paused", "ended", "archived"];
export const ADVENTURE_TYPES = ["relic", "dead_drop", "cipherbox", "wayfinder"];
export const ADVENTURE_CODE = /^[A-HJ-NP-Z2-9]{20}$/;
const baseKeys = ["id", "type", "title", "summary", "code", "conditions", "actions"];
const typeKeys = { relic: ["examinations"], dead_drop: ["body", "releaseCode", "audio"], cipherbox: ["prompt", "answer", "match", "hints", "maxAttempts", "successText", "failureText"], wayfinder: ["body", "location", "playStyle", "durationMinutes", "minPlayers", "maxPlayers", "availability", "startsAt", "endsAt"] };
export const defaultAdventureConditions = () => ({ completed: [], skills: [], flags: [], statuses: [] });
export function defaultAdventure() { return { formatVersion: 1, title: "Field adventure", summary: "", organizerNotes: "", flags: [], nodes: [] }; }
export function defaultAdventureNode(type, id, code) {
  if (!ADVENTURE_TYPES.includes(type)) fail("Choose a supported instrument.");
  const node = { id, type, title: "New instrument", summary: "", code, conditions: defaultAdventureConditions(), actions: { success: [], failure: [] } };
  if (type === "relic") return { ...node, examinations: [{ id: "examine", label: "Examine", text: "A closer look reveals something.", conditions: defaultAdventureConditions(), actions: [] }] };
  if (type === "dead_drop") return { ...node, body: "A hidden message.", releaseCode: null, audio: null };
  if (type === "cipherbox") return { ...node, prompt: "What is the answer?", answer: "answer", match: "fold", hints: [], maxAttempts: 5, successText: "The puzzle opens.", failureText: "The puzzle remains locked. Ask an organizer for help." };
  return { ...node, body: "Meet for a scene.", location: "", playStyle: "mixed", durationMinutes: 15, minPlayers: 1, maxPlayers: 6, availability: "open", startsAt: null, endsAt: null };
}
function slug(value, label) { if (typeof value !== "string" || !/^[a-z][a-z0-9-]{0,47}$/.test(value)) fail(`${label} must be a lowercase identifier of at most 48 characters.`); return value; }
function list(value, max, label) {
  if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) fail(`${label} must be a list of at most ${max} entries.`);
  for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, i), "value")) fail(`${label} must contain data entries only.`);
  return value;
}
function unique(values, label) { if (new Set(values).size !== values.length) fail(`${label} must be unique.`); return values; }
function choice(value, allowed, label) { if (!allowed.includes(value)) fail(`${label} is not supported.`); return value; }
function references(value, allowed, label) {
  const result = unique(list(value, 10, label).map((entry) => slug(entry, label)), label);
  if (result.some((entry) => !allowed.includes(entry))) fail(`${label} includes an unknown reference.`);
  return [...result];
}
function conditions(value, nodes, flags, skills) {
  characterRecord(value, ["completed", "skills", "flags", "statuses"], "Conditions");
  return { completed: references(value.completed, nodes, "Completed instruments"), skills: references(value.skills, skills, "Required skills"), flags: references(value.flags, flags, "Required flags"), statuses: unique(list(value.statuses, 10, "Required statuses").map((status) => choice(status, ADVENTURE_EVENT_STATUSES, "Event status")), "Required statuses") };
}
function audio(value) {
  if (value === null) return { value: null, bytes: 0 };
  if (typeof value !== "string" || value.length > 1_340_000) fail("Audio must be an uploaded MPEG, Ogg, or WAV file of at most 1 MB.");
  const matched = /^data:audio\/(mpeg|ogg|wav);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!matched || matched[2].length % 4 !== 0) fail("Audio must be MPEG, Ogg, or WAV data, without external URLs.");
  const encoded = matched[2], bytes = encoded.length * 3 / 4 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if (bytes < 12 || bytes > 1_000_000) fail("Audio must contain 12–1,000,000 bytes.");
  let head; try { head = atob(encoded.slice(0, 48)); } catch { fail("Audio encoding is invalid."); }
  const valid = matched[1] === "wav" ? head.startsWith("RIFF") && head.slice(8, 12) === "WAVE" : matched[1] === "ogg" ? head.startsWith("OggS") : head.startsWith("ID3") || (head.charCodeAt(0) === 255 && (head.charCodeAt(1) & 224) === 224);
  if (!valid) fail("Audio contents do not match its media type.");
  return { value, bytes };
}
function date(value, label) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 35 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail(`${label} must be an ISO date with a timezone, or null.`);
  const [y, m, d] = value.slice(0, 10).split("-").map(Number), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (m < 1 || m > 12 || d < 1 || d > days) fail(`${label} must be a real calendar date.`);
  return new Date(value).toISOString();
}
export function validateAdventure(value, eventSetupOrRules = { attributes: [], expertise: [] }) {
  characterRecord(value, ["formatVersion", "title", "summary", "organizerNotes", "flags", "nodes"], "Adventure definition");
  if (value.formatVersion !== 1) fail("Adventure format version is unsupported. Expected version 1.");
  const inputNodes = list(value.nodes, 50, "Adventure instruments");
  const flags = list(value.flags, 30, "Adventure flags").map((flag) => { characterRecord(flag, ["id", "name"], "Adventure flag"); return { id: slug(flag.id, "Flag identifier"), name: characterText(flag.name, "Flag name", 1, 80) }; });
  const flagIds = unique(flags.map((flag) => flag.id), "Flag identifiers");
  const nodeIds = unique(inputNodes.map((node) => {
    characterRecord(node, [...baseKeys, ...Object.values(typeKeys).flat()], "Adventure instrument", baseKeys);
    choice(node.type, ADVENTURE_TYPES, "Instrument type");
    characterRecord(node, [...baseKeys, ...typeKeys[node.type]], "Adventure instrument");
    return slug(node.id, "Instrument identifier");
  }), "Instrument identifiers");
  const rules = eventSetupOrRules.rules || eventSetupOrRules, skills = (rules.expertise || []).map((skill) => skill.id);
  let audioBytes = 0;
  const nodes = inputNodes.map((node) => {
    choice(node.type, ADVENTURE_TYPES, "Instrument type");
    if (typeof node.code !== "string" || !ADVENTURE_CODE.test(node.code)) fail("Prop code must contain 20 uppercase code characters.");
    characterRecord(node.actions, ["success", "failure"], "Instrument actions");
    const result = { id: node.id, type: node.type, title: characterText(node.title, "Instrument title", 1, 120), summary: characterText(node.summary, "Instrument summary", 0, 2000), code: node.code, conditions: conditions(node.conditions, nodeIds, flagIds, skills), actions: { success: references(node.actions.success, flagIds, "Success flags"), failure: references(node.actions.failure, flagIds, "Failure flags") } };
    if (node.type === "relic") {
      const examinations = list(node.examinations, 8, "Examinations").map((exam) => {
        characterRecord(exam, ["id", "label", "text", "conditions", "actions"], "Examination");
        return { id: slug(exam.id, "Examination identifier"), label: characterText(exam.label, "Examination label", 1, 120), text: characterText(exam.text, "Examination reading", 1, 6000), conditions: conditions(exam.conditions, nodeIds, flagIds, skills), actions: references(exam.actions, flagIds, "Examination flags") };
      });
      if (!examinations.length) fail("A relic needs at least one examination.");
      unique(examinations.map((exam) => exam.id), "Examination identifiers");
      return { ...result, examinations };
    }
    if (node.type === "dead_drop") {
      const clip = audio(node.audio); audioBytes += clip.bytes;
      return { ...result, body: characterText(node.body, "Message body", 1, 12000), releaseCode: node.releaseCode === null ? null : characterText(node.releaseCode, "Release code", 1, 80), audio: clip.value };
    }
    if (node.type === "cipherbox") {
      const maxAttempts = characterInteger(node.maxAttempts, "Maximum attempts", 1, 20);
      const hints = list(node.hints, 5, "Puzzle hints").map((hint) => { characterRecord(hint, ["text", "afterAttempts"], "Puzzle hint"); return { text: characterText(hint.text, "Hint text", 1, 2000), afterAttempts: characterInteger(hint.afterAttempts, "Hint attempts threshold", 0, maxAttempts) }; });
      return { ...result, prompt: characterText(node.prompt, "Puzzle prompt", 1, 6000), answer: characterText(node.answer, "Puzzle answer", 1, 80), match: choice(node.match, ["fold", "exact"], "Answer matching"), hints, maxAttempts, successText: characterText(node.successText, "Success reading", 1, 6000), failureText: characterText(node.failureText, "Failure reading", 1, 6000) };
    }
    const minPlayers = characterInteger(node.minPlayers, "Minimum players", 1, 100), maxPlayers = characterInteger(node.maxPlayers, "Maximum players", minPlayers, 100);
    const startsAt = date(node.startsAt, "Scene start"), endsAt = date(node.endsAt, "Scene end");
    if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) fail("Scene end must be after its start.");
    return { ...result, body: characterText(node.body, "Scene body", 1, 12000), location: characterText(node.location, "Scene location", 0, 200), playStyle: choice(node.playStyle, ["social", "investigation", "physical", "mixed"], "Scene play style"), durationMinutes: characterInteger(node.durationMinutes, "Scene duration", 1, 240), minPlayers, maxPlayers, availability: choice(node.availability, ["open", "closed"], "Scene availability"), startsAt, endsAt };
  });
  unique(nodes.map((node) => node.code), "Prop codes");
  if (audioBytes > 1_000_000) fail("All adventure audio together must be at most 1 MB.");
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) fail("Completed-instrument conditions cannot contain a self reference or cycle.");
    if (visited.has(id)) return;
    visiting.add(id);
    const node = byId.get(id);
    // An examination may depend on prior instruments, never its own node;
    // include those edges so a first discovery cannot be cyclically blocked.
    const edges = [...node.conditions.completed, ...(node.examinations || []).flatMap((exam) => exam.conditions.completed)];
    for (const dependency of edges) visit(dependency);
    visiting.delete(id); visited.add(id);
  }
  for (const id of nodeIds) visit(id);
  const result = { formatVersion: 1, title: characterText(value.title, "Adventure title", 1, 120), summary: characterText(value.summary, "Adventure summary", 0, 4000), organizerNotes: characterText(value.organizerNotes, "Organizer notes", 0, 12000), flags, nodes };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 2_000_000) fail("Adventure definition must be at most 2 MB.");
  return result;
}
