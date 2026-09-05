// Shared character data contract. Profiles are plain data; public identity is an
// explicit allowlist and never inherits private sheet or inventory properties.
const fail = (message) => { const error = new Error(message); error.status = 400; throw error; };
export const PUBLIC_CHARACTER_FIELDS = ["portrait", "pronouns", "biography", "faction", "skills"];
export const CHARACTER_STATUSES = ["draft", "pending", "approved", "changes_requested", "retired"];
export const CHARACTER_PROFILE_FIELDS = ["name", "portrait", "pronouns", "biography", "factionId", "attributes", "skills", "privateObjectives", "startingEquipment"];
export function characterRecord(value, keys, label, required = keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be an object.`);
  if (Reflect.ownKeys(value).some((key) => !keys.includes(key)) || required.some((key) => !Object.hasOwn(value, key))) fail(`${label} contains unsupported or missing fields.`);
  for (const key of Reflect.ownKeys(value)) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value")) fail(`${label} must contain data fields only.`);
  return value;
}
export function characterText(value, label, min = 0, max = 2000) {
  if (typeof value !== "string" || value.trim().length < min || value.length > max || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail(`${label} must contain ${min}–${max} plain-text characters.`);
  return value.trim();
}
export function characterInteger(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`${label} must be a whole number between ${min} and ${max}.`);
  return value;
}
function list(value, label, max) {
  if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) fail(`${label} must be a list of at most ${max} entries.`);
  for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, i), "value")) fail(`${label} must contain data entries only.`);
  return value;
}
export function defaultCharacterSettings() {
  return { allowPlayerCreation: true, requireApproval: true, maxPerPlayer: 1, publicFields: ["portrait", "pronouns", "faction"], version: 1 };
}
export function validateCharacterSettings(value) {
  characterRecord(value, ["allowPlayerCreation", "requireApproval", "maxPerPlayer", "publicFields", "version"], "Character settings");
  for (const field of ["allowPlayerCreation", "requireApproval"]) if (typeof value[field] !== "boolean") fail(`${field} must be true or false.`);
  const publicFields = list(value.publicFields, "Public fields", PUBLIC_CHARACTER_FIELDS.length);
  if (publicFields.some((field) => !PUBLIC_CHARACTER_FIELDS.includes(field)) || new Set(publicFields).size !== publicFields.length) fail("Public fields must be unique supported fields.");
  return { allowPlayerCreation: value.allowPlayerCreation, requireApproval: value.requireApproval, maxPerPlayer: characterInteger(value.maxPerPlayer, "Characters per player", 1, 10), publicFields: [...publicFields], version: characterInteger(value.version, "Settings version", 1, 2147483647) };
}
export function defaultCharacterProfile(rules = { attributes: [] }) {
  return { name: "", portrait: null, pronouns: "", biography: "", factionId: null, attributes: Object.fromEntries((rules.attributes || []).map((rule) => [rule.id, rule.default])), skills: [], privateObjectives: "", startingEquipment: [] };
}
function portrait(value) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 205_000) fail("Portrait must be an uploaded JPEG, PNG, or WebP image of at most 150 KB.");
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) fail("Portrait must be a JPEG, PNG, or WebP data image.");
  const encoded = match[2];
  const bytes = encoded.length * 3 / 4 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if (bytes > 150_000 || bytes < 12) fail("Portrait must be a JPEG, PNG, or WebP image of at most 150 KB.");
  let header;
  try { header = atob(encoded.slice(0, 32)); } catch { fail("Portrait encoding is invalid."); }
  const valid = match[1] === "png" ? header.startsWith("\x89PNG\r\n\x1a\n") : match[1] === "jpeg" ? header.startsWith("\xff\xd8\xff") : header.startsWith("RIFF") && header.slice(8, 12) === "WEBP";
  if (!valid) fail("Portrait contents do not match the image type.");
  return value;
}
export function validateCharacterProfile(value, eventSetup, factions = []) {
  characterRecord(value, CHARACTER_PROFILE_FIELDS, "Character profile");
  const rules = eventSetup.rules || eventSetup;
  const expected = (rules.attributes || []).map((rule) => rule.id);
  characterRecord(value.attributes, expected, "Character attributes");
  const attributes = Object.fromEntries((rules.attributes || []).map((rule) => {
    const number = value.attributes[rule.id];
    if (typeof number !== "number" || !Number.isFinite(number) || number < rule.min || number > rule.max) fail(`${rule.name} must be between ${rule.min} and ${rule.max}.`);
    return [rule.id, number];
  }));
  const skills = list(value.skills, "Character skills", 24);
  if (skills.some((id) => !(rules.expertise || []).some((rule) => rule.id === id)) || new Set(skills).size !== skills.length) fail("Choose unique skills from the event rules.");
  const factionId = value.factionId;
  if (factionId !== null && (typeof factionId !== "string" || !factions.some((faction) => faction.id === factionId))) fail("Choose a faction from this event.");
  const startingEquipment = list(value.startingEquipment, "Starting equipment", 50).map((item) => {
    characterRecord(item, ["name", "quantity", "notes"], "Starting equipment item");
    return { name: characterText(item.name, "Equipment name", 1, 100), quantity: characterInteger(item.quantity, "Equipment quantity", 1, 9999), notes: characterText(item.notes, "Equipment notes", 0, 500) };
  });
  return { name: characterText(value.name, "Character name", 1, 80), portrait: portrait(value.portrait), pronouns: characterText(value.pronouns, "Pronouns", 0, 50), biography: characterText(value.biography, "Biography", 0, 4000), factionId, attributes, skills: [...skills], privateObjectives: characterText(value.privateObjectives, "Private objectives", 0, 4000), startingEquipment };
}
export function projectCharacter(row, settings = defaultCharacterSettings(), audience = "public", factions = []) {
  if (!["private", "public"].includes(audience)) fail("Unsupported character audience.");
  const result = { id: row.id, eventId: row.event_id, status: row.status, visibility: audience };
  if (audience === "private") return { ...result, userId: row.user_id, version: row.version, badgeCode: row.badge_code, reviewNotes: row.review_notes, inventoryInitialized: row.inventory_initialized, profile: structuredClone(row.profile), createdAt: row.created_at, updatedAt: row.updated_at };
  const profile = { name: row.profile.name };
  for (const field of settings.publicFields) {
    if (field === "faction") {
      const faction = factions.find((entry) => entry.id === row.profile.factionId);
      profile.faction = faction ? { id: faction.id, name: faction.name } : null;
    } else if (PUBLIC_CHARACTER_FIELDS.includes(field)) profile[field] = structuredClone(row.profile[field]);
  }
  return { ...result, profile };
}
