// Exchange requests contain identifiers only. Readings and identities always
// come from the server's currently authorized records.
import { characterRecord, characterInteger } from "./characters-model.js";
import { validateTradeAssets } from "./economy-model.js";
export const EXCHANGE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const EXCHANGE_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{12}$/;
export const EXCHANGE_STATUSES = ["waiting", "negotiating", "completed", "cancelled", "rejected", "expired", "unavailable"];
export const EXCHANGE_MAX_READINGS = 10;
export const EXCHANGE_TTL_MINUTES = 15;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message) => { const error = new Error(message); error.status = 400; throw error; };
export function exchangeIdentifier(value, label = "Identifier") { if (typeof value !== "string" || !UUID.test(value)) fail(`${label} must be a UUID.`); return value.toLowerCase(); }
export function validateExchangeRequest(value, action) {
  const fieldMap = { create: ["requestId", "characterId"], join: ["requestId", "characterId", "code"], offer: ["requestId", "characterId", "version", "readingIds", "items", "resources"], confirm: ["requestId", "characterId", "version"], cancel: ["requestId", "characterId", "version"], reject: ["requestId", "characterId", "version"] };
  const fields = Object.hasOwn(fieldMap, action) ? [...fieldMap[action], ...(["create", "join", "offer"].includes(action) ? ["informationOnly"] : [])] : null;
  if (!fields) fail("Unsupported exchange action.");
  characterRecord(value, fields, "Exchange request", fields.filter(field => !["items", "resources", "informationOnly"].includes(field)));
  const result = { requestId: exchangeIdentifier(value.requestId, "Request identifier"), characterId: exchangeIdentifier(value.characterId, "Character identifier") };
  if (fields.includes("version")) result.version = characterInteger(value.version, "Exchange version", 1, 2147483647);
  if (action === "join") { if (typeof value.code !== "string" || !EXCHANGE_CODE_PATTERN.test(value.code)) fail("Enter the 12-character exchange code."); result.code = value.code; }
  if (action === "offer") {
    const items = value.readingIds;
    if (!Array.isArray(items) || items.length > EXCHANGE_MAX_READINGS || Reflect.ownKeys(items).length !== items.length + 1) fail("Choose at most 10 unique readings.");
    for (let i = 0; i < items.length; i++) if (!Object.hasOwn(items, i) || !Object.hasOwn(Object.getOwnPropertyDescriptor(items, i), "value")) fail("Reading identifiers must be plain data.");
    result.readingIds = items.map((id) => exchangeIdentifier(id, "Reading identifier"));
    if (new Set(result.readingIds).size !== result.readingIds.length) fail("Each reading may be offered only once.");
    result.readingIds.sort();
    const assets = validateTradeAssets({ items: Object.hasOwn(value, "items") ? value.items : [], resources: Object.hasOwn(value, "resources") ? value.resources : [] });
    if (Object.hasOwn(value, "items")) result.items = assets.items;
    if (Object.hasOwn(value, "resources")) result.resources = assets.resources;
  }
  if (Object.hasOwn(value, "informationOnly")) {
    if (value.informationOnly !== true || Object.hasOwn(value, "items") || Object.hasOwn(value, "resources")) fail("Saved information requests must be marked information-only and cannot contain item or resource fields.");
    result.informationOnly = true;
  }
  return result;
}
