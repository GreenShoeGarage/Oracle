import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { testDatabase } from "./database.js";
import { migrate } from "../src/db.js";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { defaultSetup } from "../public/kit.js";
import { defaultCharacterProfile, defaultCharacterSettings, validateCharacterProfile, validateCharacterSettings, projectCharacter } from "../public/characters-model.js";

let database, pool, server, origin;
const users = {};
async function request(path, method = "GET", data, who = users.owner) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(method !== "GET" ? { "Content-Type": "application/json", Origin: origin } : {}), ...(who?.cookie ? { Cookie: who.cookie } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  const raw = await response.text();
  return { status: response.status, data: raw ? JSON.parse(raw) : null, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
function success(response, status = 200) { assert.equal(response.status, status, JSON.stringify(response.data)); return response.data; }
const base = (event) => `/api/events/${event.id}`;
const chars = (event) => `${base(event)}/characters`;
async function event(name = "Character rehearsal", memberNames = ["player", "other", "staff"]) {
  const result = success(await request("/api/events", "POST", { name, setup: defaultSetup("fantasy", "council") }), 201).event;
  for (const name of memberNames) await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,$3)", [result.id, users[name].id, name === "staff" ? "staff" : "player"]);
  return result;
}
function profile(ev, overrides = {}) { return { ...defaultCharacterProfile(ev.setup.rules), name: "Lantern Keeper", pronouns: "they/them", biography: "A traveler from the northern road.", privateObjectives: "PRIVATE: find the lost crown", attributes: { resolve: 3 }, skills: ["investigation"], startingEquipment: [{ name: "Lantern", quantity: 2, notes: "PRIVATE inventory notes" }], ...overrides }; }
async function create(ev, who = users.player, overrides = {}, extra = {}) { return success(await request(chars(ev), "POST", { profile: profile(ev, overrides), ...extra }, who), 201).character; }
async function submit(ev, character, who = users.player) { return success(await request(`${chars(ev)}/${character.id}/submit`, "POST", { version: character.version }, who)).character; }
async function approve(ev, character) { return success(await request(`${chars(ev)}/${character.id}/review`, "POST", { version: character.version, decision: "approve", feedback: "" })).character; }
async function settings(ev, patch) {
  const current = success(await request(`${base(ev)}/character-settings`)).settings;
  return success(await request(`${base(ev)}/character-settings`, "PUT", { ...current, ...patch })).settings;
}
function publicOnly(value) {
  const serialized = JSON.stringify(value);
  for (const forbidden of ["PRIVATE", "privateObjectives", "startingEquipment", "inventory", "reviewNotes", "badgeCode", "userId", "attributes", users.player.email]) assert.ok(!serialized.includes(forbidden), `Public response leaked ${forbidden}`);
}
before(async () => {
  database = await testDatabase(); pool = database.pool; await migrate(pool);
  let handler;
  server = createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  handler = createApp({ pool, config: { ...readConfig({ DATABASE_URL: "postgres://unused", PORT: "3000" }), origin }, logger: (entry) => console.error(entry) });
  for (const name of ["owner", "player", "other", "staff", "outsider"]) {
    const result = await request("/api/auth/register", "POST", { email: `${name}@characters.example.test`, displayName: `Character ${name}`, password: "Character integration passphrase!" }, null);
    users[name] = { ...success(result, 201).user, cookie: result.cookie };
  }
  console.log(`Character integration database: ${database.kind}`);
});
after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); if (database) await database.close(); });

test("character model rejects unsupported fields, out-of-rules values and unsafe portraits", () => {
  const ev = { setup: defaultSetup("fantasy", "council") };
  const good = profile(ev);
  assert.deepEqual(validateCharacterProfile(good, ev.setup), good);
  for (const mutate of [
    (p) => { p.attributes.resolve = 6; }, (p) => { p.attributes.unrecognized = 2; }, (p) => { delete p.attributes.resolve; },
    (p) => { p.skills = ["unrecognized"]; }, (p) => { p.skills.push("investigation"); }, (p) => { p.userId = users.owner.id; },
    (p) => { p.factionId = users.owner.id; }, (p) => { p.portrait = "https://example.test/player.jpg"; },
    (p) => { p.portrait = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="; }, (p) => { p.portrait = "data:image/png;base64,QUFBQUFBQUFBQUFB"; },
    (p) => { p.startingEquipment[0].quantity = -1; }, (p) => { p.name = "<script>alert(1)</script>"; },
  ]) { const changed = structuredClone(good); mutate(changed); assert.throws(() => validateCharacterProfile(changed, ev.setup), { status: 400 }); }
  assert.throws(() => validateCharacterSettings({ ...defaultCharacterSettings(), publicFields: ["privateObjectives"] }), { status: 400 });
  assert.throws(() => validateCharacterSettings({ ...defaultCharacterSettings(), maxPerPlayer: 11 }), { status: 400 });
});

test("private drafts, approvals, public field allowlists and badge lookups preserve privacy", async () => {
  const ev = await event();
  let character = await create(ev);
  assert.equal(character.status, "draft");
  assert.equal(character.profile.privateObjectives, "PRIVATE: find the lost crown");
  assert.match(character.badgeCode, /^[A-HJ-NP-Z2-9]{20}$/);
  assert.equal(success(await request(chars(ev), "GET", undefined, users.other)).characters.length, 0);
  assert.equal((await request(`${chars(ev)}/${character.id}`, "GET", undefined, users.other)).status, 404);
  assert.equal((await request(`/api/badges/${character.badgeCode}`, "GET", undefined, users.other)).status, 404);
  character = await submit(ev, character);
  assert.equal(character.status, "pending");
  assert.equal((await request(`${chars(ev)}/${character.id}/review`, "POST", { version: character.version, decision: "approve", feedback: "" }, users.staff)).status, 403);
  character = await approve(ev, character);
  const detail = success(await request(`${chars(ev)}/${character.id}`, "GET", undefined, users.other));
  assert.deepEqual(Object.keys(detail.character.profile).sort(), ["faction", "name", "portrait", "pronouns"]);
  publicOnly(detail);
  publicOnly(success(await request(chars(ev), "GET", undefined, users.other)));
  const badge = success(await request(`/api/badges/${character.badgeCode}`, "GET", undefined, users.other));
  publicOnly(badge); assert.equal(badge.event.id, ev.id);
  assert.deepEqual(badge.event.skills, [{ id: "investigation", name: "Investigation" }]);
  assert.equal((await request(`/api/badges/${character.badgeCode}`, "GET", undefined, null)).status, 401);
  assert.equal((await request(`/api/badges/${character.badgeCode}`, "GET", undefined, users.outsider)).status, 404);
  assert.equal((await request(`${chars(ev)}/${character.id}/inventory`, "GET", undefined, users.other)).status, 404);
  await settings(ev, { publicFields: ["biography", "skills"] });
  const modified = success(await request(`/api/badges/${character.badgeCode}`, "GET", undefined, users.other));
  assert.deepEqual(Object.keys(modified.character.profile).sort(), ["biography", "name", "skills"]); publicOnly(modified);
});

test("approval initializes independent inventory once and reapproval never refills it", async () => {
  const ev = await event();
  let character = await approve(ev, await submit(ev, await create(ev)));
  let items = success(await request(`${chars(ev)}/${character.id}/inventory`, "GET", undefined, users.player)).inventory;
  assert.equal(items.length, 1); assert.equal(items[0].quantity, 2);
  assert.equal((await request(`${chars(ev)}/${character.id}/inventory/${items[0].id}`, "PATCH", { ...items[0], quantity: 0 }, users.player)).status, 403);
  const changedItem = success(await request(`${chars(ev)}/${character.id}/inventory/${items[0].id}`, "PATCH", { version: items[0].version, name: items[0].name, quantity: 0, notes: items[0].notes, reason: "Correct a recorded use during the scene" })).item;
  const correction = (await pool.query("SELECT details FROM audit_entries WHERE event_id=$1 AND action='character.inventory_updated'", [ev.id])).rows[0].details;
  assert.equal(correction.reason, "Correct a recorded use during the scene");
  assert.equal(correction.beforeQuantity, 2); assert.equal(correction.quantity, 0);
  assert.ok(!JSON.stringify(correction).includes("PRIVATE inventory notes"));
  assert.equal((await request(`${chars(ev)}/${character.id}/inventory/${items[0].id}`, "PATCH", { version: items[0].version, name: items[0].name, quantity: 4, notes: "" })).status, 409);
  const changedProfile = { ...character.profile, biography: "A changed biography", startingEquipment: [{ name: "Lantern", quantity: 99, notes: "new authoring value" }] };
  character = success(await request(`${chars(ev)}/${character.id}`, "PATCH", { version: character.version, profile: changedProfile }, users.player)).character;
  assert.equal(character.status, "draft");
  assert.equal((await request(`/api/badges/${character.badgeCode}`, "GET", undefined, users.other)).status, 404);
  character = await approve(ev, await submit(ev, character));
  items = success(await request(`${chars(ev)}/${character.id}`, "GET", undefined, users.player)).inventory;
  assert.deepEqual(items, [changedItem]);
  assert.equal(character.inventoryInitialized, true);
});

test("request changes, stale edits, invalid current rules and archived writes fail atomically", async () => {
  const ev = await event();
  let character = await submit(ev, await create(ev));
  character = success(await request(`${chars(ev)}/${character.id}/review`, "POST", { version: character.version, decision: "request_changes", feedback: "Explain the proposed starting equipment." })).character;
  assert.equal(character.status, "changes_requested"); assert.match(character.reviewNotes, /Explain/);
  const previous = character.version;
  character = success(await request(`${chars(ev)}/${character.id}`, "PATCH", { version: character.version, profile: { ...character.profile, biography: "Revised background" } }, users.player)).character;
  assert.equal((await request(`${chars(ev)}/${character.id}`, "PATCH", { version: previous, profile: character.profile }, users.player)).status, 409);
  const bad = { ...character.profile, attributes: { resolve: 99 } };
  assert.equal((await request(`${chars(ev)}/${character.id}`, "PATCH", { version: character.version, profile: bad }, users.player)).status, 400);
  assert.equal(success(await request(`${chars(ev)}/${character.id}`, "GET", undefined, users.player)).character.version, character.version);
  await pool.query("UPDATE events SET status='archived' WHERE id=$1", [ev.id]);
  assert.equal((await request(`${chars(ev)}/${character.id}/submit`, "POST", { version: character.version }, users.player)).status, 409);
  assert.equal((await request(`${base(ev)}/character-settings`, "PUT", defaultCharacterSettings())).status, 409);
});

test("prewritten assignment checks membership and limits, immediately removes former private access", async () => {
  const ev = await event();
  const existing = await create(ev);
  let prewritten = await create(ev, users.owner, { name: "The Archivist", privateObjectives: "PRIVATE prewritten" }, { userId: null });
  assert.equal(prewritten.userId, null);
  assert.equal((await request(`${chars(ev)}/${prewritten.id}/assign`, "POST", { version: prewritten.version, userId: users.player.id })).status, 409);
  assert.equal((await request(`${chars(ev)}/${prewritten.id}/assign`, "POST", { version: prewritten.version, userId: users.outsider.id })).status, 400);
  prewritten = success(await request(`${chars(ev)}/${prewritten.id}/assign`, "POST", { version: prewritten.version, userId: users.other.id })).character;
  assert.equal(success(await request(`${chars(ev)}/${prewritten.id}`, "GET", undefined, users.other)).character.profile.privateObjectives, "PRIVATE prewritten");
  prewritten = success(await request(`${chars(ev)}/${prewritten.id}/assign`, "POST", { version: prewritten.version, userId: null })).character;
  assert.equal((await request(`${chars(ev)}/${prewritten.id}`, "GET", undefined, users.other)).status, 404);
  success(await request(`${chars(ev)}/${existing.id}/retire`, "POST", { version: existing.version }, users.player));
  const replacement = await create(ev);
  assert.notEqual(replacement.id, existing.id);
});

test("player creation policy, approval-off mode and optimistic settings versions are enforced", async () => {
  const ev = await event();
  const oldSettings = defaultCharacterSettings();
  await settings(ev, { allowPlayerCreation: false });
  assert.equal((await request(chars(ev), "POST", { profile: profile(ev) }, users.player)).status, 403);
  assert.equal((await request(`${base(ev)}/character-settings`, "PUT", oldSettings)).status, 409);
  assert.equal((await request(`${base(ev)}/character-settings`, "PUT", { ...oldSettings, version: 2 }, users.staff)).status, 403);
  await settings(ev, { allowPlayerCreation: true, requireApproval: false });
  const character = await submit(ev, await create(ev));
  assert.equal(character.status, "approved");
  assert.equal(success(await request(`${chars(ev)}/${character.id}/inventory`, "GET", undefined, users.player)).inventory.length, 1);
});

test("concurrent character creation enforces one active character per player", async () => {
  const ev = await event();
  const results = await Promise.all([request(chars(ev), "POST", { profile: profile(ev) }, users.player), request(chars(ev), "POST", { profile: profile(ev, { name: "Second attempt" }) }, users.player)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM characters WHERE event_id=$1 AND user_id=$2", [ev.id, users.player.id])).rows[0].n, 1);
});

test("cross-event copies reset gameplay data and validate against destination rules", async () => {
  const source = await event(), destination = await event();
  const char = await approve(source, await submit(source, await create(source)));
  const changedSetup = structuredClone(destination.setup); changedSetup.rules.attributes = [{ id: "nerve", name: "Nerve", min: 0, max: 9, default: 4 }]; changedSetup.rules.expertise = [];
  await pool.query("UPDATE events SET setup=$1 WHERE id=$2", [JSON.stringify(changedSetup), destination.id]);
  const copied = success(await request(`${chars(source)}/${char.id}/copy`, "POST", { targetEventId: destination.id }, users.player), 201);
  assert.equal(copied.character.status, "draft"); assert.equal(copied.character.userId, users.player.id);
  assert.notEqual(copied.character.id, char.id); assert.notEqual(copied.character.badgeCode, char.badgeCode);
  assert.deepEqual(copied.character.profile.attributes, { nerve: 4 }); assert.deepEqual(copied.character.profile.skills, []);
  assert.equal(copied.character.profile.factionId, null); assert.equal(copied.character.profile.privateObjectives, ""); assert.deepEqual(copied.character.profile.startingEquipment, []);
  assert.equal(copied.character.inventoryInitialized, false); assert.ok(copied.warnings.length);
  assert.deepEqual(success(await request(`${chars(destination)}/${copied.character.id}/inventory`, "GET", undefined, users.player)).inventory, []);
  assert.equal((await request(`${chars(source)}/${char.id}/copy`, "POST", { targetEventId: destination.id }, users.other)).status, 403);
  assert.equal((await request(`${chars(destination)}/${char.id}`, "GET", undefined, users.owner)).status, 404);
});

test("badge rotation, retirement and removed membership revoke badge access", async () => {
  const ev = await event();
  let character = await approve(ev, await submit(ev, await create(ev)));
  const oldCode = character.badgeCode;
  character = success(await request(`${chars(ev)}/${character.id}/badge`, "POST", { version: character.version }, users.player)).character;
  assert.notEqual(character.badgeCode, oldCode);
  assert.equal((await request(`/api/badges/${oldCode}`, "GET", undefined, users.other)).status, 404);
  assert.equal((await request(`/api/badges/${character.badgeCode}`, "GET", undefined, users.other)).status, 200);
  await pool.query("DELETE FROM memberships WHERE event_id=$1 AND user_id=$2", [ev.id, users.other.id]);
  assert.equal((await request(`/api/badges/${character.badgeCode}`, "GET", undefined, users.other)).status, 404);
  character = success(await request(`${chars(ev)}/${character.id}/retire`, "POST", { version: character.version }, users.player)).character;
  assert.equal((await request(`/api/badges/${character.badgeCode}`, "GET", undefined, users.player)).status, 404);
  assert.equal((await request(`${chars(ev)}/${character.id}/badge`, "POST", { version: character.version }, users.player)).status, 409);
});

test("factions belong to one event, reject duplicate names and cannot disappear while referenced", async () => {
  const ev = await event();
  const faction = success(await request(`${base(ev)}/factions`, "POST", { name: "Lantern Guild", description: "Keepers of the northern road." }), 201).faction;
  assert.equal((await request(`${base(ev)}/factions`, "POST", { name: "lantern guild", description: "duplicate" })).status, 409);
  assert.equal((await request(`${base(ev)}/factions`, "POST", { name: "Unauthorized guild", description: "" }, users.player)).status, 403);
  const char = await approve(ev, await submit(ev, await create(ev, users.player, { factionId: faction.id })));
  const badge = success(await request(`/api/badges/${char.badgeCode}`, "GET", undefined, users.other));
  assert.deepEqual(badge.character.profile.faction, { id: faction.id, name: faction.name });
  assert.equal((await request(`${base(ev)}/factions/${faction.id}`, "DELETE", { version: faction.version })).status, 409);
  const ev2 = await event();
  assert.equal((await request(chars(ev2), "POST", { profile: profile(ev2, { factionId: faction.id }) }, users.player)).status, 400);
  assert.equal((await request(`${base(ev2)}/factions/${faction.id}`, "DELETE", { version: faction.version })).status, 404);
});

test("explicit projection ignores unknown and sensitive stored fields", () => {
  const row = { id: "id", event_id: "event", user_id: "PRIVATE owner", status: "approved", profile: { name: "Public name", pronouns: "they/them", portrait: null, factionId: null, privateObjectives: "PRIVATE objective", unexpected: "PRIVATE unexpected" }, password_hash: "PRIVATE hash", review_notes: "PRIVATE review" };
  const projected = projectCharacter(row, defaultCharacterSettings(), "public");
  publicOnly(projected);
});
