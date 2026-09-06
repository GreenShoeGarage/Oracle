// This module contains declarative event data only. Both server and browser use
// the same validation; themes never supply CSS, markup, scripts, or asset URLs.
const MAX_BYTES = 200_000;
const AVAILABLE_INSTRUMENT_IDS = ["briefing", "relic", "dead-drop", "cipherbox", "wayfinder", "trace", "whisper", "broadside"];
// Reserve room for public event metadata and the versioned export envelope, so
// every valid saved setup can be exported without dropping authored records.
const MAX_SETUP_BYTES = 180_000;
const clone = (value) => structuredClone(value);
const fail = (message) => {
  const error = new Error(message);
  error.status = 400;
  throw error;
};
function record(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    fail(`${label} must be an object.`);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => !keys.includes(key)))
    fail(`${label} contains unsupported or missing fields.`);
  for (const key of keys) {
    if (!Object.hasOwn(value, key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"))
      fail(`${label} must contain data fields only.`);
  }
  return value;
}
function text(value, label, min, max, allowAngles = false) {
  if (typeof value !== "string" || value.trim().length < min || value.length > max)
    fail(`${label} must contain ${min}–${max} characters.`);
  if ((!allowAngles && /[<>]/u.test(value)) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))
    fail(`${label} must be plain text without markup or control characters.`);
  return value.trim();
}
function id(value, label) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{0,47}$/.test(value))
    fail(`${label} must be a lowercase identifier of at most 48 characters.`);
  return value;
}
function choice(value, values, label) {
  if (!values.includes(value)) fail(`${label} is not supported.`);
  return value;
}
function boolean(value, label) {
  if (typeof value !== "boolean") fail(`${label} must be true or false.`);
  return value;
}
function version(value, label) {
  if (value !== 1) fail(`${label} version is not supported. Expected version 1.`);
  return 1;
}
function list(value, max, label, normalize) {
  if (!Array.isArray(value) || value.length > max)
    fail(`${label} must contain at most ${max} entries.`);
  if (Reflect.ownKeys(value).length !== value.length + 1)
    fail(`${label} must be a plain list without extra fields or missing entries.`);
  for (let index = 0; index < value.length; index++)
    if (!Object.hasOwn(value, index) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, index), "value"))
      fail(`${label} must contain data entries only.`);
  const result = value.map(normalize);
  if (new Set(result.map((item) => typeof item === "string" ? item : item.id)).size !== result.length)
    fail(`${label} contains duplicate identifiers.`);
  return result;
}
function size(value, max = MAX_BYTES, label = "Event pack") {
  if (new TextEncoder().encode(JSON.stringify(value)).length > max)
    fail(`${label} is too large. Use at most ${max.toLocaleString("en-US")} bytes.`);
  return value;
}
function color(value, label) {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value))
    fail(`${label} must be a six-digit hexadecimal color.`);
  return value.toLowerCase();
}
function luminance(value) {
  const rgb = [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16) / 255)
    .map((part) => part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a, b) {
  const light = luminance(a), dark = luminance(b);
  return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
}
export function validateTheme(value) {
  record(value, ["id", "name", "version", "tokens", "terms", "sounds"], "Theme");
  const input = record(value.tokens, ["background", "panel", "text", "muted", "accent", "font", "texture", "icon"], "Theme tokens");
  const tokens = {};
  for (const key of ["background", "panel", "text", "muted", "accent"])
    tokens[key] = color(input[key], `Theme ${key}`);
  tokens.font = choice(input.font, ["serif", "sans", "mono"], "Theme font");
  tokens.texture = choice(input.texture, ["none", "grain", "grid", "dust"], "Theme texture");
  tokens.icon = choice(input.icon, ["sigil", "chip", "compass"], "Theme icon");
  for (const foreground of ["text", "muted", "accent"])
    for (const background of ["background", "panel"])
      if (contrast(tokens[foreground], tokens[background]) < 4.5)
        fail(`Theme ${foreground} needs at least 4.5:1 contrast against ${background}.`);
  record(value.terms, ["briefing", "people", "resources", "expertise"], "Theme terminology");
  const terms = Object.fromEntries(Object.entries(value.terms)
    .map(([key, val]) => [key, text(val, `Terminology ${key}`, 1, 40)]));
  record(value.sounds, ["enabled", "cue"], "Theme sounds");
  return {
    id: id(value.id, "Theme identifier"), name: text(value.name, "Theme name", 1, 60),
    version: version(value.version, "Theme"), tokens, terms,
    sounds: { enabled: boolean(value.sounds.enabled, "Theme sound preference"), cue: choice(value.sounds.cue, ["bell", "pulse", "click"], "Sound cue") },
  };
}
function numericRule(value, label) {
  record(value, ["id", "name", "min", "max", "default"], label);
  for (const key of ["min", "max", "default"])
    if (typeof value[key] !== "number" || !Number.isFinite(value[key]) || Math.abs(value[key]) > 1_000_000)
      fail(`${label} ${key} must be a finite number between -1,000,000 and 1,000,000.`);
  if (value.min > value.max || value.default < value.min || value.default > value.max)
    fail(`${label} needs min ≤ default ≤ max.`);
  return { id: id(value.id, `${label} identifier`), name: text(value.name, `${label} name`, 1, 60), min: value.min, max: value.max, default: value.default };
}
function rules(value) {
  record(value, ["version", "attributes", "expertise", "resources", "outcomes"], "Rules profile");
  return {
    version: version(value.version, "Rules profile"),
    attributes: list(value.attributes, 12, "Attributes", (item) => numericRule(item, "Attribute")),
    expertise: list(value.expertise, 24, "Expertise", (item) => {
      record(item, ["id", "name"], "Expertise");
      return { id: id(item.id, "Expertise identifier"), name: text(item.name, "Expertise name", 1, 60) };
    }),
    resources: list(value.resources, 12, "Resources", (item) => numericRule(item, "Resource")),
    outcomes: list(value.outcomes, 12, "Outcomes", (item) => {
      record(item, ["id", "name", "description"], "Outcome");
      return { id: id(item.id, "Outcome identifier"), name: text(item.name, "Outcome name", 1, 60), description: text(item.description, "Outcome description", 0, 1000) };
    }),
  };
}
export function validateSetup(value) {
  record(value, ["version", "theme", "templateId", "enabledInstruments", "rules", "content"], "Event setup");
  return size({
    version: version(value.version, "Event setup"), theme: validateTheme(value.theme),
    templateId: id(value.templateId, "Template identifier"),
    enabledInstruments: list(value.enabledInstruments, AVAILABLE_INSTRUMENT_IDS.length, "Enabled instruments", (item) => choice(item, AVAILABLE_INSTRUMENT_IDS, "Instrument")),
    rules: rules(value.rules),
    content: list(value.content, 20, "Briefing content", (item) => {
      record(item, ["id", "title", "body", "visibility", "prop"], "Briefing entry");
      return { id: id(item.id, "Briefing identifier"), title: text(item.title, "Briefing title", 1, 120), body: text(item.body, "Briefing body", 0, 6000), visibility: choice(item.visibility, ["player", "organizer"], "Briefing visibility"), prop: boolean(item.prop, "Prop visibility") };
    }),
  }, MAX_SETUP_BYTES, "Event setup");
}

export const THEMES = [
  {
    id: "fantasy", name: "Fantasy", version: 1,
    tokens: { background: "#111810", panel: "#1d281b", text: "#f4efd9", muted: "#c0c9ad", accent: "#dbbd73", font: "serif", texture: "grain", icon: "sigil" },
    terms: { briefing: "Field chronicle", people: "Company", resources: "Supplies", expertise: "Lore" },
    sounds: { enabled: false, cue: "bell" },
  },
  {
    id: "cyberpunk", name: "Cyberpunk", version: 1,
    tokens: { background: "#080f1c", panel: "#131e31", text: "#e9f8ff", muted: "#afc5d9", accent: "#62e7eb", font: "mono", texture: "grid", icon: "chip" },
    terms: { briefing: "Mission feed", people: "Crew", resources: "Credits", expertise: "Protocols" },
    sounds: { enabled: false, cue: "pulse" },
  },
  {
    id: "wasteland", name: "Wasteland", version: 1,
    tokens: { background: "#1b1510", panel: "#2b2219", text: "#fff1d3", muted: "#d2bea2", accent: "#f1bd69", font: "sans", texture: "dust", icon: "compass" },
    terms: { briefing: "Dispatch board", people: "Survivors", resources: "Salvage", expertise: "Know-how" },
    sounds: { enabled: false, cue: "click" },
  },
].map(validateTheme);
export const INSTRUMENTS = [
  { id: "briefing", name: "Briefing", available: true },
  ...[
    ["relic", "RELIC"], ["dead-drop", "DEAD DROP"], ["cipherbox", "CIPHERBOX"],
    ["wayfinder", "WAYFINDER"], ["trace", "TRACE"], ["whisper", "WHISPER"],
    ["broadside", "BROADSIDE"], ["bazaar", "BAZAAR"], ["oathbook", "OATHBOOK"],
    ["sigil", "SIGIL"], ["static", "STATIC"], ["stagehand", "STAGEHAND"],
  ].map(([id, name]) => ({ id, name, available: AVAILABLE_INSTRUMENT_IDS.includes(id) })),
];
const emptyRules = () => ({ version: 1, attributes: [], expertise: [], resources: [], outcomes: [] });
const baseSetup = (themeId, templateId) => ({ version: 1, theme: clone(THEMES.find((theme) => theme.id === themeId)), templateId, enabledInstruments: ["briefing"], rules: emptyRules(), content: [] });
const seedRules = () => ({
  version: 1,
  attributes: [{ id: "resolve", name: "Resolve", min: 0, max: 5, default: 2 }],
  expertise: [{ id: "investigation", name: "Investigation" }],
  resources: [{ id: "supplies", name: "Supplies", min: 0, max: 10, default: 3 }],
  outcomes: [
    { id: "success", name: "Success", description: "An organizer describes the successful result." },
    { id: "complication", name: "Complication", description: "An organizer describes a cost or new obstacle." },
  ],
});
export const TEMPLATES = [
  { id: "blank", name: "Blank event", description: "Start with an empty briefing and rules profile.", themeId: "fantasy", setup: baseSetup("fantasy", "blank") },
  {
    id: "council", name: "The Lantern Council", description: "A fantasy council briefing to customize. A starting scene, not a complete adventure.", themeId: "fantasy",
    setup: { ...baseSetup("fantasy", "council"), rules: seedRules(), content: [
      { id: "arrival", title: "A summons at dusk", body: "The border lanterns have gone dark. Delegates have gathered at the old council hall to decide who will investigate. Introduce your delegation, share one concern, and find another delegate willing to help.", visibility: "player", prop: true },
      { id: "organizer-notes", title: "Organizer preparation", body: "Choose a meeting place and introduce the delegates in person. Invite each group to suggest a cause of the darkness. This starter provides a briefing only; prepare your own characters, clues, and scene outcomes.", visibility: "organizer", prop: false },
    ] },
  },
  {
    id: "signal", name: "The Missing Signal", description: "A cyberpunk crew briefing to customize. A starting scene, not a complete adventure.", themeId: "cyberpunk",
    setup: { ...baseSetup("cyberpunk", "signal"), rules: seedRules(), content: [
      { id: "arrival", title: "The relay is silent", body: "A neighborhood relay has stopped transmitting. Your crew has gathered at the repair shop to agree on a response. Introduce your specialty, compare what you know, and find a partner for the next move.", visibility: "player", prop: true },
      { id: "organizer-notes", title: "Organizer preparation", body: "Choose a safe meeting point and explain the fictional relay problem. Ask the crew which community depends on it. This starter provides a briefing only; prepare your own characters, clues, and scene outcomes.", visibility: "organizer", prop: false },
    ] },
  },
  {
    id: "frontier", name: "The Last Water Stop", description: "A wasteland settlement briefing to customize. A starting scene, not a complete adventure.", themeId: "wasteland",
    setup: { ...baseSetup("wasteland", "frontier"), rules: seedRules(), content: [
      { id: "arrival", title: "A convoy overdue", body: "The settlement's next supply convoy is late. Survivors have gathered beside the water tower to plan a search. Introduce your camp, share one useful skill, and decide who should speak to the watch.", visibility: "player", prop: true },
      { id: "organizer-notes", title: "Organizer preparation", body: "Choose the gathering place and establish the fictional supply shortage. Invite players to describe their settlement's priorities. This starter provides a briefing only; prepare your own characters, clues, and scene outcomes.", visibility: "organizer", prop: false },
    ] },
  },
].map((template) => ({ ...template, setup: validateSetup(template.setup) }));

export function defaultSetup(themeId = "fantasy", templateId = "blank") {
  const theme = THEMES.find((item) => item.id === themeId);
  const template = TEMPLATES.find((item) => item.id === templateId);
  if (!theme) fail("Choose a supported starter theme.");
  if (!template) fail("Choose a supported starter template.");
  return validateSetup({ ...clone(template.setup), theme: clone(theme) });
}
export function projectSetup(setup, audience) {
  choice(audience, ["organizer", "player", "prop"], "View audience");
  const result = validateSetup(setup);
  if (audience !== "organizer")
    result.content = result.content.filter((item) => item.visibility === "player" && (audience !== "prop" || item.prop));
  return result;
}
function eventMetadata(value) {
  record(value, ["name", "description", "location", "startsAt"], "Event metadata");
  let startsAt = null;
  if (value.startsAt !== null) {
    const parts = typeof value.startsAt === "string" && value.startsAt.length <= 35 &&
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value.startsAt);
    if (!parts || !Number.isFinite(Date.parse(value.startsAt)))
      fail("Event start must be an ISO date with a timezone, or null.");
    const [, y, m, d, h, minute, second] = parts.map(Number);
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (m < 1 || m > 12 || d < 1 || d > days[m - 1] || h > 23 || minute > 59 || second > 59)
      fail("Event start must be a real calendar date and time.");
    startsAt = new Date(value.startsAt).toISOString();
  }
  // Batch 1 metadata allowed literal angle brackets. Preserve those records;
  // consumers render these strings as text, never as HTML.
  return { name: text(value.name, "Event name", 2, 100, true), description: text(value.description, "Event description", 0, 2000, true), location: text(value.location, "Event location", 0, 200, true), startsAt };
}
export function validateEventPack(value) {
  record(value, ["format", "version", "audience", "event", "setup"], "Event pack");
  choice(value.format, ["oracle-event-pack"], "Event pack format");
  const audience = choice(value.audience, ["organizer", "player"], "Event pack audience");
  const setup = validateSetup(value.setup);
  if (audience === "player" && setup.content.some((item) => item.visibility !== "player"))
    fail("Player event packs cannot contain organizer-only material.");
  return size({ format: "oracle-event-pack", version: version(value.version, "Event pack"), audience, event: eventMetadata(value.event), setup });
}
export function makeEventPack(event, audience) {
  choice(audience, ["organizer", "player"], "Event pack audience");
  const startsAt = event.startsAt ?? event.starts_at ?? null;
  return validateEventPack({
    format: "oracle-event-pack", version: 1, audience,
    event: { name: event.name, description: event.description ?? "", location: event.location ?? "", startsAt: startsAt instanceof Date ? startsAt.toISOString() : startsAt },
    setup: projectSetup(event.setup, audience),
  });
}
