import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { migrate } from "../src/db.js";
import { hashPassword } from "../src/security.js";
import { provisionSuperuser } from "../src/admin.js";
import { defaultSetup } from "../public/kit.js";
import { defaultCharacterProfile } from "../public/characters-model.js";
import { testDatabase } from "./database.js";

let database, pool, config, server, origin;
const users = {};
const pass = "Superuser integration passphrase!";
const reservedEmail = "operator@superuser.example.test";
const privateText = "The hidden gate opens after midnight.";

async function request(path, method = "GET", data, user, extraHeaders = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(method !== "GET" ? { "Content-Type": "application/json", Origin: origin } : {}),
      ...(user?.cookie ? { Cookie: user.cookie } : {}),
      ...extraHeaders,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const raw = response.status === 204 ? "" : await response.text();
  return {
    status: response.status,
    data: raw && response.headers.get("content-type")?.includes("application/json") ? JSON.parse(raw) : raw,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}

before(async () => {
  database = await testDatabase();
  pool = database.pool;
  await migrate(pool);
  config = readConfig({ DATABASE_URL: "postgresql://unused", BOOTSTRAP_SUPERUSER_EMAIL: reservedEmail });
  const id = randomUUID();
  const passwordHash = await hashPassword(pass);
  await pool.query("INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Existing project operator',$3)", [id, reservedEmail, passwordHash]);
  let handle;
  server = createServer((req, res) => handle(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  config.origin = origin;
  handle = createApp({ pool, config, logger: () => {} });
  const login = await request("/api/auth/login", "POST", { email: reservedEmail, password: pass });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.equal(login.data.user.isSuperuser, false);
  users.operator = { ...login.data.user, cookie: login.cookie };
  for (const name of ["owner", "player", "outsider"]) {
    const registered = await request("/api/auth/register", "POST", { email: `${name}@superuser.example.test`, displayName: `Superuser test ${name}`, password: pass, isSuperuser: true, is_superuser: true, role: "superuser" });
    assert.equal(registered.status, 201, JSON.stringify(registered.data));
    assert.equal(registered.data.user.isSuperuser, false);
    users[name] = { ...registered.data.user, cookie: registered.cookie };
  }
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (database) await database.close();
});

test("existing sessions receive DB-provisioned superuser access without account replacement", async () => {
  const before = (await pool.query("SELECT password_hash,created_at FROM users WHERE id=$1", [users.operator.id])).rows[0];
  assert.equal((await request("/api/admin/users", "GET", undefined, users.operator)).status, 403);
  await provisionSuperuser(pool, config);
  const session = await request("/api/session", "GET", undefined, users.operator);
  assert.equal(session.status, 200);
  assert.equal(session.data.user.id, users.operator.id);
  assert.equal(session.data.user.isSuperuser, true);
  assert.deepEqual(Object.keys(session.data.user).sort(), ["displayName", "email", "id", "isSuperuser"]);
  const after = (await pool.query("SELECT password_hash,created_at FROM users WHERE id=$1", [users.operator.id])).rows[0];
  assert.deepEqual(after, before);
  assert.equal((await request("/api/admin/users", "GET", undefined, users.operator)).status, 200);
  assert.equal((await request("/api/admin/users", "GET", undefined, users.owner)).status, 403);
});

test("global superuser manages another owner's event without changing its ownership or memberships", async () => {
  const setup = defaultSetup();
  setup.content = [{ id: "hidden-gate", title: "Organizer notes", body: privateText, visibility: "organizer", prop: false }];
  const created = await request("/api/events", "POST", { name: "Global access rehearsal", setup }, users.owner);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  let event = created.data.event;
  assert.equal((await request(`/api/events/${event.id}`, "GET", undefined, users.outsider)).status, 404);
  const listed = await request("/api/events", "GET", undefined, users.operator);
  assert.equal(listed.data.events.find((entry) => entry.id === event.id).role, "superuser");
  const opened = await request(`/api/events/${event.id}`, "GET", undefined, users.operator);
  assert.equal(opened.data.event.role, "superuser");
  assert.ok(JSON.stringify(opened.data).includes(privateText));
  const edited = await request(`/api/events/${event.id}`, "PATCH", { version: event.version, description: "Updated by project operator." }, users.operator);
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  event = edited.data.event;
  assert.equal(event.description, "Updated by project operator.");
  const invite = await request(`/api/events/${event.id}/invites`, "POST", { role: "organizer", maxUses: 1 }, users.operator);
  assert.equal(invite.status, 201, JSON.stringify(invite.data));
  assert.equal((await request("/api/events/join", "POST", { code: invite.data.invitation.code }, users.player)).status, 200);
  assert.equal((await request(`/api/events/${event.id}/members/${users.player.id}`, "PATCH", { role: "player" }, users.operator)).status, 200);
  assert.equal((await request(`/api/events/${event.id}/members/${users.owner.id}`, "DELETE", undefined, users.operator)).status, 403);
  assert.equal((await request(`/api/events/${event.id}/members/${users.owner.id}`, "PATCH", { role: "player" }, users.operator)).status, 403);
  assert.equal((await pool.query("SELECT owner_user_id FROM events WHERE id=$1", [event.id])).rows[0].owner_user_id, users.owner.id);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM memberships WHERE event_id=$1 AND user_id=$2", [event.id, users.operator.id])).rows[0].n, 0);
  const activity = await request(`/api/events/${event.id}/audit`, "GET", undefined, users.operator);
  assert.equal(activity.status, 200);
  assert.ok(activity.data.entries.some((entry) => entry.action === "event.updated" && entry.actor === "Existing project operator"));

  const profile = { ...defaultCharacterProfile(event.setup.rules), name: "The night watch", privateObjectives: "Guard the secret passage." };
  const character = await request(`/api/events/${event.id}/characters`, "POST", { profile, userId: users.player.id }, users.operator);
  assert.equal(character.status, 201, JSON.stringify(character.data));
  const characterId = character.data.character.id;
  const pending = await request(`/api/events/${event.id}/characters/${characterId}/submit`, "POST", { version: character.data.character.version }, users.player);
  assert.equal(pending.status, 200, JSON.stringify(pending.data));
  const approved = await request(`/api/events/${event.id}/characters/${characterId}/review`, "POST", { version: pending.data.character.version, decision: "approve", feedback: "" }, users.operator);
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal(approved.data.character.status, "approved");
});

test("admin mutations enforce Origin and revocation immediately invalidates real cookies", async () => {
  assert.equal((await request(`/api/admin/users/${users.outsider.id}/sessions`, "DELETE", undefined, users.operator, { Origin: "https://another.example.test" })).status, 403);
  assert.equal((await request("/api/session", "GET", undefined, users.outsider)).data.user.id, users.outsider.id);
  const revoked = await request(`/api/admin/users/${users.outsider.id}/sessions`, "DELETE", undefined, users.operator);
  assert.equal(revoked.status, 200);
  assert.equal(revoked.data.revoked, 1);
  assert.equal((await request("/api/session", "GET", undefined, users.outsider)).data.user, null);
  assert.equal((await request("/api/events", "GET", undefined, users.outsider)).status, 401);
  const relogin = await request("/api/auth/login", "POST", { email: users.outsider.email, password: pass });
  assert.equal(relogin.status, 200);
  users.outsider.cookie = relogin.cookie;
});

test("disabled accounts cannot log in or reuse cookies and enabling preserves credentials", async () => {
  const disabled = await request(`/api/admin/users/${users.outsider.id}`, "PATCH", { disabled: true }, users.operator);
  assert.equal(disabled.status, 200);
  assert.equal((await request("/api/session", "GET", undefined, users.outsider)).data.user, null);
  assert.equal((await request("/api/auth/login", "POST", { email: users.outsider.email, password: pass })).status, 401);
  assert.equal((await request(`/api/admin/users/${users.operator.id}`, "PATCH", { disabled: true }, users.operator)).status, 409);
  assert.equal((await request(`/api/admin/users/${users.outsider.id}`, "PATCH", { disabled: false }, users.operator)).status, 200);
  const restored = await request("/api/auth/login", "POST", { email: users.outsider.email, password: pass });
  assert.equal(restored.status, 200);
  assert.equal(restored.data.user.isSuperuser, false);
  users.outsider.cookie = restored.cookie;
});

test("reserved account signup fails without operator authorization and can be claimed only once", async () => {
  const reserved = "unclaimed@superuser.example.test";
  const setupCode = "operator-claim-integration-only-secret-0123456789";
  const previous = config.bootstrapSuperuserEmail;
  try {
    config.bootstrapSuperuserEmail = reserved;
    assert.deepEqual(await provisionSuperuser(pool, config), { event: "superuser_provisioned", matched: false, reserved: true });
    const data = { email: reserved, displayName: "Claimed operator", password: pass, isSuperuser: true, is_superuser: true };
    assert.equal((await request("/api/auth/register", "POST", data)).status, 403);
    assert.equal((await request("/api/auth/register", "POST", { ...data, setupCode })).status, 403);
    config.bootstrapSetupToken = setupCode;
    assert.equal((await request("/api/auth/register", "POST", { ...data, setupCode: "forged" })).status, 403);
    const claimed = await request("/api/auth/register", "POST", { ...data, setupCode });
    assert.equal(claimed.status, 201, JSON.stringify(claimed.data));
    assert.equal(claimed.data.user.isSuperuser, true);
    assert.equal((await request("/api/auth/register", "POST", { ...data, setupCode })).status, 409);
    const row = (await pool.query("SELECT id,is_superuser FROM users WHERE email=$1", [reserved])).rows[0];
    assert.equal(row.id, claimed.data.user.id);
    const audit = (await pool.query("SELECT details FROM system_audit_entries WHERE target_user_id=$1 AND action='superuser.claimed'", [row.id])).rows;
    assert.deepEqual(audit, [{ details: {} }]);
    assert.equal((await pool.query("SELECT is_superuser FROM users WHERE id=$1", [users.owner.id])).rows[0].is_superuser, false);
  } finally {
    config.bootstrapSuperuserEmail = previous;
    config.bootstrapSetupToken = "";
  }
});
