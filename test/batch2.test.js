import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { testDatabase } from "./database.js";
import { migrate, checkSchema } from "../src/db.js";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { defaultSetup, THEMES } from "../public/kit.js";

let database, pool, server, origin;
const users = {};
const legacy = { user: randomUUID(), event: randomUUID(), invitation: randomUUID() };
const secret = "ORGANIZER SECRET: the archivist is the missing heir.";
const pass = "Batch two test passphrase!";
async function request(path, method = "GET", data, who, headers = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(method !== "GET" ? { "Content-Type": "application/json", Origin: origin } : {}),
      ...(who?.cookie ? { Cookie: who.cookie } : {}),
      ...headers,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const raw = response.status === 204 ? "" : await response.text();
  return {
    status: response.status,
    data: raw && response.headers.get("content-type")?.includes("application/json") ? JSON.parse(raw) : raw,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
    headers: response.headers,
  };
}
function setup() {
  const result = defaultSetup("fantasy", "council");
  result.content = [
    { id: "welcome", title: "Welcome", body: "Gather at the gate at sunset.", visibility: "player", prop: true },
    { id: "field-notes", title: "Field notes", body: "Bring a lantern and water.", visibility: "player", prop: false },
    { id: "organizer-notes", title: "Hidden truth", body: secret, visibility: "organizer", prop: false },
  ];
  return result;
}
async function createEvent(name = "Theme rehearsal", customSetup = setup(), who = users.owner) {
  const result = await request("/api/events", "POST", { name, description: "A shared event briefing.", location: "The gate", setup: customSetup }, who);
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.event;
}
async function join(event, who, role = "player") {
  const invite = await request(`/api/events/${event.id}/invites`, "POST", { role, maxUses: 1 }, users.owner);
  assert.equal(invite.status, 201, JSON.stringify(invite.data));
  const result = await request("/api/events/join", "POST", { code: invite.data.invitation.code }, who);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return { result, invitation: invite.data.invitation };
}
function noPrivate(result) {
  const serialized = JSON.stringify(result.data);
  assert.ok(!serialized.includes(secret), "Organizer-only content leaked into a public response.");
  assert.ok(!serialized.includes("owner_user_id"));
  assert.ok(!serialized.includes("password_hash"));
  assert.ok(!serialized.includes("token_hash"));
}

before(async () => {
  database = await testDatabase();
  pool = database.pool;
  // Recreate the already-deployed Batch 1 state before the additive migration.
  const oldSql = await readFile(new URL("../migrations/001_foundation.sql", import.meta.url), "utf8");
  await pool.query(oldSql);
  await pool.query("CREATE TABLE schema_migrations (version integer PRIMARY KEY,name text NOT NULL,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())");
  await pool.query("INSERT INTO schema_migrations(version,name,checksum) VALUES(1,$1,$2)", ["001_foundation.sql", createHash("sha256").update(oldSql).digest("hex")]);
  await pool.query("INSERT INTO users(id,email,display_name,password_hash) VALUES($1,'legacy@example.test','Existing organizer','existing-hash')", [legacy.user]);
  await pool.query("INSERT INTO events(id,owner_user_id,name,description,location,status,version) VALUES($1,$2,'Existing live event','Original description','Original location','live',7)", [legacy.event, legacy.user]);
  await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'owner')", [legacy.event, legacy.user]);
  await pool.query("INSERT INTO invitations(id,event_id,token_hash,role,created_by,max_uses,expires_at) VALUES($1,$2,'original-token-hash','player',$3,3,now()+interval '1 day')", [legacy.invitation, legacy.event, legacy.user]);
  await pool.query("INSERT INTO audit_entries(event_id,actor_id,action,details) VALUES($1,$2,'event.created','{}')", [legacy.event, legacy.user]);
  await migrate(pool);
  let handler;
  server = createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  handler = createApp({ pool, config: { ...readConfig({ DATABASE_URL: "postgres://unused", PORT: "3000" }), origin }, logger: () => {} });
  for (const name of ["owner", "organizer", "staff", "player", "outsider"]) {
    const result = await request("/api/auth/register", "POST", { displayName: `Batch2 ${name}`, email: `${name}@batch2.example.test`, password: pass });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    users[name] = { ...result.data.user, cookie: result.cookie };
  }
  console.log(`Batch 2 integration database: ${database.kind}`);
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (database) await database.close();
});

test("Batch 1 to Batch 3 migration preserves event identity, lifecycle, membership, invitations and audit", async () => {
  assert.equal(await migrate(pool), 4);
  assert.equal(await checkSchema(pool), 4);
  const event = (await pool.query("SELECT * FROM events WHERE id=$1", [legacy.event])).rows[0];
  assert.equal(event.name, "Existing live event");
  assert.equal(event.description, "Original description");
  assert.equal(event.location, "Original location");
  assert.equal(event.status, "live");
  assert.equal(event.version, 7);
  assert.equal(event.owner_user_id, legacy.user);
  assert.deepEqual(event.setup, defaultSetup("fantasy", "blank"));
  assert.equal((await pool.query("SELECT role FROM memberships WHERE event_id=$1 AND user_id=$2", [legacy.event, legacy.user])).rows[0].role, "owner");
  assert.equal((await pool.query("SELECT token_hash FROM invitations WHERE id=$1", [legacy.invitation])).rows[0].token_hash, "original-token-hash");
  assert.equal((await pool.query("SELECT action FROM audit_entries WHERE event_id=$1", [legacy.event])).rows[0].action, "event.created");
  const user = (await pool.query("SELECT id,password_hash,is_superuser,is_disabled FROM users WHERE id=$1", [legacy.user])).rows[0];
  assert.equal(user.id, legacy.user);
  assert.equal(user.password_hash, "existing-hash");
  assert.equal(user.is_superuser, false);
  assert.equal(user.is_disabled, false);
  assert.deepEqual((await pool.query("SELECT version FROM schema_migrations ORDER BY version")).rows.map((row) => row.version), [1, 2, 3, 4]);
});

test("catalog requires authentication and theme module is served under the script CSP", async () => {
  assert.equal((await request("/api/catalog")).status, 401);
  const catalog = await request("/api/catalog", "GET", undefined, users.owner);
  assert.equal(catalog.status, 200);
  assert.ok(catalog.data.themes && catalog.data.templates && catalog.data.instruments);
  const module = await request("/kit.js");
  assert.equal(module.status, 200);
  assert.match(module.headers.get("content-type"), /text\/javascript/);
  assert.match(module.headers.get("content-security-policy"), /script-src 'self'/);
  assert.ok(!module.headers.get("content-security-policy").includes("unsafe-inline"));
});

test("Batch 1 event creation remains compatible and persisted setup defaults are valid", async () => {
  const result = await request("/api/events", "POST", { name: "Old client creation" }, users.owner);
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.deepEqual(result.data.event.setup, defaultSetup());
  assert.equal((await request(`/api/events/${result.data.event.id}`, "GET", undefined, users.owner)).data.event.id, result.data.event.id);
});

test("switching all three themes preserves IDs, rules, content and lifecycle across reloads", async () => {
  let event = await createEvent();
  const original = structuredClone(event);
  for (const themeId of ["cyberpunk", "wasteland", "fantasy"]) {
    const theme = Array.isArray(THEMES) ? THEMES.find((entry) => entry.id === themeId) : THEMES[themeId];
    const result = await request(`/api/events/${event.id}`, "PATCH", { version: event.version, theme }, users.owner);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    event = (await request(`/api/events/${event.id}`, "GET", undefined, users.owner)).data.event;
    assert.equal(event.setup.theme.id, themeId);
    assert.equal(event.id, original.id);
    assert.equal(event.status, original.status);
    assert.equal(event.name, original.name);
    assert.deepEqual(event.setup.rules, original.setup.rules);
    assert.deepEqual(event.setup.content, original.setup.content);
    assert.deepEqual(event.setup.enabledInstruments, original.setup.enabledInstruments);
  }
  assert.equal(event.version, original.version + 3);
});

test("setup writes enforce organizer permissions, optimistic versions and atomic validation", async () => {
  const event = await createEvent("Permission rehearsal");
  await join(event, users.player);
  await join(event, users.staff, "staff");
  await join(event, users.organizer, "organizer");
  const changed = setup();
  changed.content[0].title = "New public briefing";
  for (const who of [users.player, users.staff])
    assert.equal((await request(`/api/events/${event.id}`, "PATCH", { version: event.version, setup: changed }, who)).status, 403);
  assert.equal((await request(`/api/events/${event.id}`, "PATCH", { version: event.version, setup: changed }, users.organizer)).status, 200);
  assert.equal((await request(`/api/events/${event.id}`, "PATCH", { version: event.version, setup: setup() }, users.owner)).status, 409);
  const invalid = structuredClone(changed);
  invalid.theme.tokens.accent = "url(javascript:alert(1))";
  assert.equal((await request(`/api/events/${event.id}`, "PATCH", { version: 2, name: "Must not persist", setup: invalid }, users.owner)).status, 400);
  const result = await request(`/api/events/${event.id}`, "GET", undefined, users.owner);
  assert.equal(result.data.event.version, 2);
  assert.equal(result.data.event.name, event.name);
  assert.equal(result.data.event.setup.content[0].title, "New public briefing");
});

test("every player route strips organizer material and previews exclude account and membership data", async () => {
  const event = await createEvent("Projection rehearsal");
  const joined = await join(event, users.player);
  noPrivate(joined.result);
  const responses = await Promise.all([
    request("/api/events", "GET", undefined, users.player),
    request(`/api/events/${event.id}`, "GET", undefined, users.player),
    request(`/api/events/${event.id}/pack?audience=player`, "GET", undefined, users.player),
    request(`/api/events/${event.id}/preview?audience=player`, "GET", undefined, users.owner),
    request(`/api/events/${event.id}/preview?audience=prop`, "GET", undefined, users.owner),
  ]);
  for (const result of responses) { assert.equal(result.status, 200); noPrivate(result); }
  const playerPreview = responses[3];
  assert.equal(playerPreview.data.readOnly, true);
  assert.equal(playerPreview.data.event.role, undefined);
  assert.equal(playerPreview.data.members, undefined);
  assert.ok(!JSON.stringify(playerPreview.data).includes(users.owner.email));
  assert.deepEqual(playerPreview.data.event.setup.content.map((entry) => entry.id), ["welcome", "field-notes"]);
  assert.deepEqual(responses[4].data.event.setup.content.map((entry) => entry.id), ["welcome"]);
  assert.equal((await request(`/api/events/${event.id}/pack?audience=organizer`, "GET", undefined, users.player)).status, 403);
  for (const suffix of ["pack?audience=player", "pack?audience=organizer", "preview?audience=player", "preview?audience=prop"])
    assert.equal((await request(`/api/events/${event.id}/${suffix}`, "GET", undefined, users.outsider)).status, 404);
  const ownerPack = await request(`/api/events/${event.id}/pack?audience=organizer`, "GET", undefined, users.owner);
  assert.ok(JSON.stringify(ownerPack.data).includes(secret));
  for (const forbidden of ["owner_user_id", "password_hash", "token_hash", users.owner.id, users.owner.email, event.id])
    assert.ok(!JSON.stringify(ownerPack.data).includes(forbidden), `Export included ${forbidden}`);
});

test("event-pack import creates a new owned draft and preserves the source event and content", async () => {
  let event = await createEvent("Export rehearsal");
  event = (await request(`/api/events/${event.id}`, "PATCH", { version: event.version, status: "rehearsal" }, users.owner)).data.event;
  const pack = (await request(`/api/events/${event.id}/pack?audience=organizer`, "GET", undefined, users.owner)).data;
  const imported = await request("/api/events/import", "POST", { pack }, users.outsider);
  assert.equal(imported.status, 201, JSON.stringify(imported.data));
  const copy = imported.data.event;
  assert.notEqual(copy.id, event.id);
  assert.equal(copy.status, "draft");
  assert.equal(copy.version, 1);
  assert.equal(copy.role, "owner");
  assert.deepEqual(copy.setup, event.setup);
  const members = (await pool.query("SELECT user_id,role FROM memberships WHERE event_id=$1", [copy.id])).rows;
  assert.deepEqual(members, [{ user_id: users.outsider.id, role: "owner" }]);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM invitations WHERE event_id=$1", [copy.id])).rows[0].n, 0);
  const audit = (await pool.query("SELECT action,details FROM audit_entries WHERE event_id=$1", [copy.id])).rows;
  assert.deepEqual(audit, [{ action: "event.imported", details: { audience: "organizer", formatVersion: 1 } }]);
  const source = (await request(`/api/events/${event.id}`, "GET", undefined, users.owner)).data.event;
  assert.equal(source.status, "rehearsal");
  assert.equal(source.version, event.version);
  assert.deepEqual(source.setup, event.setup);
});

test("invalid or future event packs cannot create or overwrite records", async () => {
  const event = await createEvent("Import validation rehearsal");
  const pack = (await request(`/api/events/${event.id}/pack?audience=organizer`, "GET", undefined, users.owner)).data;
  const beforeCount = (await pool.query("SELECT count(*)::int AS n FROM events")).rows[0].n;
  for (const mutate of [
    (p) => { p.version = 999; },
    (p) => { p.event.id = event.id; },
    (p) => { p.event.status = "live"; },
    (p) => { p.memberships = [{ user_id: users.owner.id, role: "owner" }]; },
    (p) => { p.setup.theme.script = "alert(1)"; },
    (p) => { p.setup.enabledInstruments = ["relic"]; },
  ]) {
    const invalid = structuredClone(pack); mutate(invalid);
    const result = await request("/api/events/import", "POST", { pack: invalid }, users.outsider);
    assert.equal(result.status, 400, JSON.stringify(result.data));
  }
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM events")).rows[0].n, beforeCount);
  const current = (await request(`/api/events/${event.id}`, "GET", undefined, users.owner)).data.event;
  assert.equal(current.version, event.version);
  assert.deepEqual(current.setup, event.setup);
});

test("archived events remain read-only while permitted exports and previews still work", async () => {
  const event = await createEvent("Archived rehearsal");
  await pool.query("UPDATE events SET status='archived' WHERE id=$1", [event.id]);
  assert.equal((await request(`/api/events/${event.id}`, "PATCH", { version: event.version, setup: setup() }, users.owner)).status, 409);
  assert.equal((await request(`/api/events/${event.id}/pack?audience=organizer`, "GET", undefined, users.owner)).status, 200);
  assert.equal((await request(`/api/events/${event.id}/preview?audience=player`, "GET", undefined, users.owner)).status, 200);
  assert.equal((await request(`/api/events/${event.id}/preview?audience=organizer`, "GET", undefined, users.owner)).status, 400);
});

test("event setup accepts bounded content above 16 KiB while authentication stays small", async () => {
  const large = setup();
  large.content = Array.from({ length: 5 }, (_, index) => ({ id: `chapter-${index}`, title: `Chapter ${index}`, body: "Story. ".repeat(600), visibility: "player", prop: false }));
  const event = await createEvent("Larger event pack", large);
  assert.ok(JSON.stringify(event.setup).length > 16384);
  const pack = (await request(`/api/events/${event.id}/pack?audience=organizer`, "GET", undefined, users.owner)).data;
  assert.equal((await request("/api/events/import", "POST", { pack }, users.outsider)).status, 201);
  assert.equal((await request("/api/auth/login", "POST", { email: "owner@batch2.example.test", password: pass, padding: "x".repeat(17000) })).status, 413);
  assert.equal((await request("/api/events", "POST", { name: "Oversized", padding: "x".repeat(262144) }, users.owner)).status, 413);
});
