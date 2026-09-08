import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./database.js";
import { migrate, checkSchema } from "../src/db.js";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { defaultSetup } from "../public/kit.js";

let database, pool, server, origin;
const users = {};
async function request(path, method = "GET", data, who = users.owner, headers = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(method !== "GET" ? { "Content-Type": "application/json", Origin: origin } : {}),
      ...(who?.cookie ? { Cookie: who.cookie } : {}),
      ...headers,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const raw = await response.text();
  return {
    status: response.status,
    data: raw ? JSON.parse(raw) : null,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
    headers: response.headers,
  };
}
function success(response, status = 200) {
  assert.equal(response.status, status, JSON.stringify(response.data));
  return response.data;
}
before(async () => {
  database = await testDatabase();
  pool = database.pool;
  await migrate(pool);
  let handler;
  server = createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  handler = createApp({
    pool,
    config: { ...readConfig({ DATABASE_URL: "postgres://unused", PORT: "3000" }), origin },
    logger: (entry) => console.error(entry),
  });
  for (const name of ["owner", "player", "staff", "organizer", "other", "outsider"]) {
    const result = await request(
      "/api/auth/register",
      "POST",
      {
        email: `${name}@oracle.example.test`,
        displayName: `Test ${title(name)}`,
        password: "A sufficiently long test password!",
      },
      null,
    );
    users[name] = { ...result.data.user, cookie: result.cookie };
  }
  console.log(`Integration database: ${database.kind}`);
});
function title(v) {
  return v[0].toUpperCase() + v.slice(1);
}
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (database) await database.close();
});

test("migration is repeatable and preserves existing accounts", async () => {
  assert.equal(await migrate(pool), 16);
  assert.equal(await checkSchema(pool), 16);
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n,
    6,
  );
});
test("readiness validates the database schema; session responses contain no secrets", async () => {
  assert.equal((await request("/health/ready")).status, 200);
  const session = await request("/api/session", "GET", undefined, users.owner);
  assert.equal(session.status, 200);
  assert.equal(session.data.user.email, users.owner.email);
  const serialized = JSON.stringify(session.data);
  assert.ok(!serialized.includes("password_hash"));
  assert.ok(!serialized.includes("token_hash"));
});
test("unsafe requests require the exact configured Origin", async () => {
  const event = success(await request("/api/events", "POST", { name: "Origin event", setup: defaultSetup() }), 201).event;
  const response = await fetch(`${origin}/api/events/${event.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example", Cookie: users.owner.cookie },
    body: JSON.stringify({ version: event.version, name: "Changed" }),
  });
  assert.equal(response.status, 403);
});
test("email uniqueness is case-insensitive and password hashes are salted", async () => {
  assert.equal((await request("/api/auth/register", "POST", { email: "OWNER@ORACLE.EXAMPLE.TEST", displayName: "Duplicate", password: "A sufficiently long test password!" }, null)).status, 409);
  const rows = (await pool.query("SELECT email,password_hash FROM users WHERE email IN ($1,$2)", [users.owner.email, users.player.email])).rows;
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].password_hash, rows[1].password_hash);
  assert.ok(rows.every((row) => row.password_hash.startsWith("scrypt:")));
});
test("event creation creates exactly one owner and persists", async () => {
  const event = success(await request("/api/events", "POST", { name: "Persistent event", description: "Original", setup: defaultSetup() }), 201).event;
  const rows = (await pool.query("SELECT role FROM memberships WHERE event_id=$1", [event.id])).rows;
  assert.deepEqual(rows, [{ role: "owner" }]);
  const loaded = success(await request(`/api/events/${event.id}`, "GET", undefined, users.owner)).event;
  assert.equal(loaded.name, "Persistent event");
});
test("outsiders cannot enumerate, read, edit or inspect invitations/activity of another event", async () => {
  const event = success(await request("/api/events", "POST", { name: "Private event", setup: defaultSetup() }), 201).event;
  assert.equal((await request(`/api/events/${event.id}`, "GET", undefined, users.outsider)).status, 404);
  assert.equal((await request(`/api/events/${event.id}`, "PATCH", { version: event.version, name: "Stolen" }, users.outsider)).status, 404);
  assert.equal((await request(`/api/events/${event.id}/invites`, "GET", undefined, users.outsider)).status, 404);
  assert.equal((await request(`/api/events/${event.id}/audit`, "GET", undefined, users.outsider)).status, 404);
});
test("event IDs and subresource IDs cannot be mixed", async () => {
  const a = success(await request("/api/events", "POST", { name: "Event A", setup: defaultSetup() }), 201).event;
  const b = success(await request("/api/events", "POST", { name: "Event B", setup: defaultSetup() }), 201).event;
  const invitation = success(await request(`/api/events/${a.id}/invites`, "POST", { role: "player", maxUses: 1, expiresInHours: 1 }), 201).invitation;
  assert.equal((await request(`/api/events/${b.id}/invites/${invitation.id}`, "DELETE")).status, 404);
});
test("players and staff cannot edit event details, issue invites, or change roles", async () => {
  const event = success(await request("/api/events", "POST", { name: "Role event", setup: defaultSetup() }), 201).event;
  await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'player'),($1,$3,'staff')", [event.id, users.player.id, users.staff.id]);
  for (const who of [users.player, users.staff]) {
    assert.equal((await request(`/api/events/${event.id}`, "PATCH", { version: event.version, name: "No" }, who)).status, 403);
    assert.equal((await request(`/api/events/${event.id}/invites`, "POST", { role: "player", maxUses: 1, expiresInHours: 1 }, who)).status, 403);
  }
});
test("organizers can edit but cannot grant organizer rights or affect the owner", async () => {
  const event = success(await request("/api/events", "POST", { name: "Organizer event", setup: defaultSetup() }), 201).event;
  await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'organizer'),($1,$3,'player')", [event.id, users.organizer.id, users.other.id]);
  const edited = success(await request(`/api/events/${event.id}`, "PATCH", { version: event.version, name: "Organizer changed" }, users.organizer)).event;
  assert.equal(edited.name, "Organizer changed");
  assert.equal((await request(`/api/events/${event.id}/members/${users.other.id}`, "PATCH", { role: "organizer" }, users.organizer)).status, 403);
  assert.equal((await request(`/api/events/${event.id}/members/${users.owner.id}`, "DELETE", undefined, users.organizer)).status, 403);
});
test("single-use invitations admit exactly one of two concurrent users", async () => {
  const event = success(await request("/api/events", "POST", { name: "Invite event", setup: defaultSetup() }), 201).event;
  const invitation = success(await request(`/api/events/${event.id}/invites`, "POST", { role: "player", maxUses: 1, expiresInHours: 1 }), 201).invitation;
  const [one, two] = await Promise.all([
    request("/api/events/join", "POST", { code: invitation.code }, users.player),
    request("/api/events/join", "POST", { code: invitation.code }, users.other),
  ]);
  assert.deepEqual([one.status, two.status].sort(), [200, 400]);
});
test("joining an event twice does not duplicate membership or consume another use", async () => {
  const event = success(await request("/api/events", "POST", { name: "Repeat join", setup: defaultSetup() }), 201).event;
  const invitation = success(await request(`/api/events/${event.id}/invites`, "POST", { role: "player", maxUses: 2, expiresInHours: 1 }), 201).invitation;
  success(await request("/api/events/join", "POST", { code: invitation.code }, users.player), 200);
  success(await request("/api/events/join", "POST", { code: invitation.code }, users.player), 200);
  const row = (await pool.query("SELECT uses FROM invitations WHERE id=$1", [invitation.id])).rows[0];
  assert.equal(row.uses, 1);
});
test("privileged invitations are single-use and cannot restore a demoted role", async () => {
  const event = success(await request("/api/events", "POST", { name: "Privilege join", setup: defaultSetup() }), 201).event;
  const invitation = success(await request(`/api/events/${event.id}/invites`, "POST", { role: "organizer", maxUses: 1, expiresInHours: 1 }), 201).invitation;
  success(await request("/api/events/join", "POST", { code: invitation.code }, users.organizer), 200);
  success(await request(`/api/events/${event.id}/members/${users.organizer.id}`, "PATCH", { role: "player" }, users.owner));
  assert.equal((await request("/api/events/join", "POST", { code: invitation.code }, users.organizer)).status, 400);
  const role = (await pool.query("SELECT role FROM memberships WHERE event_id=$1 AND user_id=$2", [event.id, users.organizer.id])).rows[0].role;
  assert.equal(role, "player");
});
test("expired and revoked invitation codes cannot be redeemed", async () => {
  const event = success(await request("/api/events", "POST", { name: "Dead invites", setup: defaultSetup() }), 201).event;
  const expired = success(await request(`/api/events/${event.id}/invites`, "POST", { role: "player", maxUses: 1, expiresInHours: 1 }), 201).invitation;
  await pool.query("UPDATE invitations SET expires_at=now()-interval '1 minute' WHERE id=$1", [expired.id]);
  assert.equal((await request("/api/events/join", "POST", { code: expired.code }, users.player)).status, 400);
  const revoked = success(await request(`/api/events/${event.id}/invites`, "POST", { role: "player", maxUses: 1, expiresInHours: 1 }), 201).invitation;
  success(await request(`/api/events/${event.id}/invites/${revoked.id}`, "DELETE"), 200);
  assert.equal((await request("/api/events/join", "POST", { code: revoked.code }, users.player)).status, 400);
});
test("removing a member invalidates access through their existing session", async () => {
  const event = success(await request("/api/events", "POST", { name: "Remove event", setup: defaultSetup() }), 201).event;
  await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'player')", [event.id, users.player.id]);
  assert.equal((await request(`/api/events/${event.id}`, "GET", undefined, users.player)).status, 200);
  success(await request(`/api/events/${event.id}/members/${users.player.id}`, "DELETE"), 200);
  assert.equal((await request(`/api/events/${event.id}`, "GET", undefined, users.player)).status, 404);
});
test("event lifecycle enforces order, optimistic concurrency, and archive read-only behavior", async () => {
  let event = success(await request("/api/events", "POST", { name: "Lifecycle", setup: defaultSetup() }), 201).event;
  assert.equal((await request(`/api/events/${event.id}`, "PATCH", { version: event.version, status: "live" })).status, 409);
  for (const status of ["rehearsal", "live", "paused", "live", "ended", "archived"]) {
    event = success(await request(`/api/events/${event.id}`, "PATCH", { version: event.version, status })).event;
    assert.equal(event.status, status);
  }
  assert.equal((await request(`/api/events/${event.id}`, "PATCH", { version: event.version, name: "No" })).status, 409);
});
test("transaction rollback does not leave an orphan event", async () => {
  const count = (await pool.query("SELECT count(*)::int n FROM events")).rows[0].n;
  await assert.rejects(async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO events(id,owner_user_id,name,setup) VALUES($1,$2,$3,$4)", [randomUUID(), users.owner.id, "Rollback", JSON.stringify(defaultSetup())]);
      throw new Error("rollback");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  });
  assert.equal((await pool.query("SELECT count(*)::int n FROM events")).rows[0].n, count);
});
test("production configuration requires HTTPS and host-only secure sessions", () => {
  assert.throws(() => readConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://unused", APP_ORIGIN: "http://example.test" }), /HTTPS/);
  const config = readConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://unused", APP_ORIGIN: "https://example.test" });
  assert.equal(config.cookieName, "__Host-oracle_session");
});
test("password change revokes every old session and rejects the old password", async () => {
  const user = `password-${randomUUID()}@oracle.example.test`;
  const oldPassword = "A sufficiently long original password!";
  const newPassword = "A sufficiently long replacement password!";
  const registered = await request("/api/auth/register", "POST", { email: user, displayName: "Password Test", password: oldPassword }, null);
  const first = { ...registered.data.user, cookie: registered.cookie };
  const secondLogin = await request("/api/auth/login", "POST", { email: user, password: oldPassword }, null);
  const second = { ...secondLogin.data.user, cookie: secondLogin.cookie };
  success(await request("/api/auth/password", "POST", { currentPassword: oldPassword, newPassword }, first));
  assert.equal((await request("/api/session", "GET", undefined, second)).data.user, null);
  assert.equal((await request("/api/auth/login", "POST", { email: user, password: oldPassword }, null)).status, 401);
  assert.equal((await request("/api/auth/login", "POST", { email: user, password: newPassword }, null)).status, 200);
});
test("a password change cannot be followed by a surviving old-password login", async () => {
  const address = `password-race-${randomUUID()}@oracle.example.test`;
  const oldPassword = "A sufficiently long race original!";
  const newPassword = "A sufficiently long race replacement!";
  const registered = await request("/api/auth/register", "POST", { email: address, displayName: "Password Race", password: oldPassword }, null);
  const account = { ...registered.data.user, cookie: registered.cookie };
  await Promise.all([
    request("/api/auth/password", "POST", { currentPassword: oldPassword, newPassword }, account),
    request("/api/auth/login", "POST", { email: address, password: oldPassword }, null),
  ]);
  const sessions = (await pool.query("SELECT count(*)::int n FROM sessions WHERE user_id=$1", [account.id])).rows[0].n;
  const oldLogin = await request("/api/auth/login", "POST", { email: address, password: oldPassword }, null);
  assert.equal(oldLogin.status, 401);
  assert.ok(sessions <= 1);
});
test("logout and expiration revoke authentication", async () => {
  const address = `logout-${randomUUID()}@oracle.example.test`;
  const registered = await request("/api/auth/register", "POST", { email: address, displayName: "Logout Test", password: "A sufficiently long logout password!" }, null);
  const account = { ...registered.data.user, cookie: registered.cookie };
  success(await request("/api/auth/logout", "POST", {}, account), 204);
  assert.equal((await request("/api/session", "GET", undefined, account)).data.user, null);
  const login = await request("/api/auth/login", "POST", { email: address, password: "A sufficiently long logout password!" }, null);
  const relogged = { ...login.data.user, cookie: login.cookie };
  await pool.query("UPDATE sessions SET expires_at=now()-interval '1 minute' WHERE user_id=$1", [relogged.id]);
  assert.equal((await request("/api/session", "GET", undefined, relogged)).data.user, null);
});
test("malformed requests and SQL-shaped values cannot escape validation", async () => {
  const malformed = await fetch(`${origin}/api/events`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, Cookie: users.owner.cookie }, body: "{" });
  assert.equal(malformed.status, 400);
  assert.equal((await request("/api/events", "POST", { name: "x'; DROP TABLE users; --", setup: defaultSetup() })).status, 201);
  assert.ok((await pool.query("SELECT count(*)::int n FROM users")).rows[0].n >= 6);
});
test("an isolated database snapshot restores records and accepts repeat migrations", async (t) => {
  if (database?.kind === "PostgreSQL TCP") { t.skip("The PostgreSQL TCP gate runs the dedicated pg_dump/pg_restore rehearsal."); return; }
  const event = success(await request("/api/events", "POST", { name: "Backup source", setup: defaultSetup() }), 201).event;
  const snapshot = await database.snapshot();
  const isolated = await testDatabase({ snapshot });
  try {
    assert.equal((await isolated.pool.query("SELECT name FROM events WHERE id=$1", [event.id])).rows[0].name, "Backup source");
    assert.equal(await migrate(isolated.pool), 16);
  } finally { await isolated.close(); }
});
test("migration checksum drift blocks startup migration without changing data", async () => {
  const before = (await pool.query("SELECT count(*)::int n FROM schema_migrations")).rows[0].n;
  await pool.query("UPDATE schema_migrations SET checksum='tampered' WHERE version=1");
  await assert.rejects(() => migrate(pool), /checksum mismatch/);
  assert.equal((await pool.query("SELECT count(*)::int n FROM schema_migrations")).rows[0].n, before);
  // Restore the exact checksum from a clean isolated migration so later tests are unaffected.
  const clean = await testDatabase();
  try {
    await migrate(clean.pool);
    const checksum = (await clean.pool.query("SELECT checksum FROM schema_migrations WHERE version=1")).rows[0].checksum;
    await pool.query("UPDATE schema_migrations SET checksum=$1 WHERE version=1", [checksum]);
  } finally { await clean.close(); }
});
