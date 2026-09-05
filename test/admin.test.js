import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { before, after, test } from "node:test";
import { testDatabase } from "./database.js";
import { migrate, transaction } from "../src/db.js";
import { readConfig } from "../src/config.js";
import {
  createAdminHandler,
  isReservedSuperuserEmail,
  provisionSuperuser,
  registerSuperuserAllowed,
} from "../src/admin.js";

const adminId = randomUUID();
const ordinaryId = randomUUID();
const otherAdminId = randomUUID();
const config = { bootstrapSuperuserEmail: "operator@example.invalid", bootstrapSetupToken: "" };
let database, pool, server, origin;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const send = (res, status, data) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
};

before(async () => {
  database = await testDatabase();
  pool = database.pool;
  await migrate(pool);
  await pool.query(
    "INSERT INTO users(id,email,display_name,password_hash,is_superuser) VALUES($1,$2,'Operator','retained-password-hash',false),($3,'player@example.invalid','Player','player-password-hash',false),($4,'second-operator@example.invalid','Second operator','other-password-hash',true)",
    [adminId, config.bootstrapSuperuserEmail, ordinaryId, otherAdminId],
  );
  const handle = createAdminHandler({
    pool,
    config,
    helpers: {
      send, fail, transaction,
      identifier: (value) => {
        if (!/^[0-9a-f-]{36}$/.test(value)) fail(404, "Not found.");
        return value;
      },
      body: async (req) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        return JSON.parse(Buffer.concat(chunks).toString());
      },
    },
  });
  // This isolated adapter supplies DB-verified actors to the module. Application
  // integration tests separately exercise real session cookies and Origin gates.
  server = createServer(async (req, res) => {
    try {
      const actor = req.headers["x-test-user"];
      const user = actor ? (await pool.query("SELECT id,is_superuser,is_disabled FROM users WHERE id=$1", [actor])).rows[0] : null;
      if (!await handle({ req, res, url: new URL(req.url, origin), user })) send(res, 404, {});
    } catch (error) {
      send(res, error.status || 500, { error: error.message });
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (database) await database.close();
});

async function request(path, actor, method = "GET", data) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: { ...(actor ? { "x-test-user": actor } : {}), "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: response.status, data: await response.json() };
}

test("superuser configuration normalizes email and validates operator setup secrets", () => {
  const base = { DATABASE_URL: "postgresql://localhost/oracle_test" };
  assert.equal(readConfig({ ...base, BOOTSTRAP_SUPERUSER_EMAIL: " Operator@Example.invalid " }).bootstrapSuperuserEmail, config.bootstrapSuperuserEmail);
  assert.throws(() => readConfig({ ...base, BOOTSTRAP_SUPERUSER_EMAIL: "invalid" }), /valid email/);
  assert.throws(() => readConfig({ ...base, BOOTSTRAP_SUPERUSER_EMAIL: config.bootstrapSuperuserEmail, BOOTSTRAP_SUPERUSER_SETUP_TOKEN: "short" }), /32–512/);
  assert.throws(() => readConfig({ ...base, BOOTSTRAP_SUPERUSER_SETUP_TOKEN: "x".repeat(32) }), /reserved email/);
});

test("provisioning preserves the existing account and password and is idempotent", async () => {
  const first = await provisionSuperuser(pool, config);
  assert.deepEqual(first, { event: "superuser_provisioned", matched: true, userId: adminId });
  assert.deepEqual(await provisionSuperuser(pool, config), first);
  const { rows } = await pool.query("SELECT id,password_hash,is_superuser,is_disabled FROM users WHERE id=$1", [adminId]);
  assert.deepEqual(rows[0], { id: adminId, password_hash: "retained-password-hash", is_superuser: true, is_disabled: false });
  const audits = await pool.query("SELECT actor_id,action,details FROM system_audit_entries WHERE target_user_id=$1", [adminId]);
  assert.deepEqual(audits.rows, [{ actor_id: null, action: "superuser.provisioned", details: { source: "deployment" } }]);
});

test("an absent reserved account creates no user and ordinary users stay ordinary", async () => {
  const absent = { bootstrapSuperuserEmail: "unclaimed@example.invalid" };
  assert.deepEqual(await provisionSuperuser(pool, absent), { event: "superuser_provisioned", matched: false, reserved: true });
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n, 3);
  assert.equal((await pool.query("SELECT is_superuser FROM users WHERE id=$1", [ordinaryId])).rows[0].is_superuser, false);
  assert.equal(await provisionSuperuser(pool, {}), null);
});

test("reserved signup requires the configured secret and rejects forged role values", () => {
  const secret = "test-only-operator-setup-secret-0123456789";
  const claim = { ...config, bootstrapSetupToken: secret };
  assert.equal(isReservedSuperuserEmail(" OPERATOR@example.invalid ", config), true);
  assert.equal(registerSuperuserAllowed(config.bootstrapSuperuserEmail, undefined, config), false);
  assert.equal(registerSuperuserAllowed(config.bootstrapSuperuserEmail, secret, config), false);
  assert.equal(registerSuperuserAllowed(config.bootstrapSuperuserEmail, "incorrect", claim), false);
  assert.equal(registerSuperuserAllowed(config.bootstrapSuperuserEmail, { is_superuser: true }, claim), false);
  assert.equal(registerSuperuserAllowed(config.bootstrapSuperuserEmail, secret, claim), true);
  assert.equal(registerSuperuserAllowed("player@example.invalid", undefined, config), true);
});

test("admin routes reject unauthenticated and ordinary actors", async () => {
  assert.equal((await request("/api/admin/users")).status, 401);
  assert.equal((await request("/api/admin/users", ordinaryId)).status, 403);
  assert.equal((await request(`/api/admin/users/${adminId}/sessions`, ordinaryId, "DELETE")).status, 403);
  assert.equal((await request(`/api/admin/users/${adminId}`, ordinaryId, "PATCH", { disabled: true })).status, 403);
});

test("user search is paginated, bounded, literal, and never returns credential material", async () => {
  const list = await request("/api/admin/users?q=player&limit=1&page=1", adminId);
  assert.equal(list.status, 200);
  assert.equal(list.data.users.length, 1);
  assert.equal(list.data.total, 1);
  assert.equal(list.data.users[0].id, ordinaryId);
  assert.deepEqual(Object.keys(list.data.users[0]).sort(), ["created_at", "display_name", "email", "id", "is_disabled", "is_superuser"]);
  assert.equal((await request("/api/admin/users?q=%25", adminId)).data.total, 0);
  assert.equal((await request("/api/admin/users?limit=101", adminId)).status, 400);
  assert.equal((await request("/api/admin/users?page=-1", adminId)).status, 400);
  assert.equal((await request(`/api/admin/users?q=${"a".repeat(81)}`, adminId)).status, 400);
});

test("session revocation removes only the target's sessions and audits no token", async () => {
  await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('target-session-one',$1,now()+interval '1 day'),('target-session-two',$1,now()+interval '1 day'),('operator-session',$2,now()+interval '1 day')", [ordinaryId, adminId]);
  const result = await request(`/api/admin/users/${ordinaryId}/sessions`, adminId, "DELETE");
  assert.deepEqual(result, { status: 200, data: { revoked: 2 } });
  assert.deepEqual((await pool.query("SELECT token_hash FROM sessions")).rows, [{ token_hash: "operator-session" }]);
  const audit = (await pool.query("SELECT actor_id,target_user_id,action,details FROM system_audit_entries ORDER BY id DESC LIMIT 1")).rows[0];
  assert.deepEqual(audit, { actor_id: adminId, target_user_id: ordinaryId, action: "user.sessions_revoked", details: { count: 2 } });
});

test("disable revokes sessions, enable preserves the password, and repeated updates are idempotent", async () => {
  await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('new-target-session',$1,now()+interval '1 day')", [ordinaryId]);
  const disabled = await request(`/api/admin/users/${ordinaryId}`, adminId, "PATCH", { disabled: true });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.data.user.is_disabled, true);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM sessions WHERE user_id=$1", [ordinaryId])).rows[0].n, 0);
  assert.equal((await request(`/api/admin/users/${ordinaryId}`, adminId, "PATCH", { disabled: true })).status, 200);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM system_audit_entries WHERE target_user_id=$1 AND action='user.disabled'", [ordinaryId])).rows[0].n, 1);
  assert.equal((await request(`/api/admin/users/${ordinaryId}`, adminId, "PATCH", { disabled: false })).data.user.is_disabled, false);
  assert.equal((await pool.query("SELECT password_hash FROM users WHERE id=$1", [ordinaryId])).rows[0].password_hash, "player-password-hash");
});

test("admin writes cannot disable superusers or change roles or passwords", async () => {
  assert.equal((await request(`/api/admin/users/${adminId}`, adminId, "PATCH", { disabled: true })).status, 409);
  assert.equal((await request(`/api/admin/users/${otherAdminId}`, adminId, "PATCH", { disabled: true })).status, 409);
  assert.equal((await request(`/api/admin/users/${ordinaryId}`, adminId, "PATCH", { disabled: false, is_superuser: true })).status, 400);
  assert.equal((await request(`/api/admin/users/${ordinaryId}`, adminId, "PATCH", { password: "replacement" })).status, 400);
  assert.equal((await request(`/api/admin/users/${randomUUID()}`, adminId, "PATCH", { disabled: false })).status, 404);
  assert.equal((await request("/api/admin/audit?limit=1", adminId)).data.entries.length, 1);
});
