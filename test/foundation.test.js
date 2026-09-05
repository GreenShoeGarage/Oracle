import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./database.js";
import { migrate, checkSchema, transaction } from "../src/db.js";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { digest, sessionCookie } from "../src/security.js";
let database, pool, server, origin;
const users = {};
const pass = "Test-only passphrase 2026!";
async function request(path, method = "GET", data, who, headers = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(method !== "GET"
        ? { "Content-Type": "application/json", Origin: origin }
        : {}),
      ...(who?.cookie ? { Cookie: who.cookie } : {}),
      ...headers,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return {
    status: response.status,
    data: response.status === 204 ? {} : await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
    headers: response.headers,
  };
}
async function createEvent(name, who = users.owner) {
  const r = await request(
    "/api/events",
    "POST",
    { name, description: "A private briefing.", location: "The workshop" },
    who,
  );
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.event;
}
async function invitation(
  event,
  role = "player",
  maxUses = 1,
  who = users.owner,
) {
  const r = await request(
    `/api/events/${event.id}/invites`,
    "POST",
    { role, maxUses, expiresInHours: 24 },
    who,
  );
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.invitation;
}
async function join(event, who, role = "player") {
  const i = await invitation(event, role);
  const r = await request("/api/events/join", "POST", { code: i.code }, who);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return i;
}
before(async () => {
  database = await testDatabase();
  pool = database.pool;
  await migrate(pool);
  const config = readConfig({
    DATABASE_URL: "postgres://unused",
    PORT: "3000",
  });
  server = createServer((req, res) => handler(req, res));
  let handler;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  handler = createApp({
    pool,
    config: { ...config, origin },
    logger: () => {},
  });
  for (const name of [
    "owner",
    "organizer",
    "staff",
    "player",
    "outsider",
    "other",
  ]) {
    const r = await request("/api/auth/register", "POST", {
      displayName: title(name),
      email: `${name}@example.test`,
      password: pass,
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    users[name] = { ...r.data.user, cookie: r.cookie };
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
  assert.equal(await migrate(pool), 2);
  assert.equal(await checkSchema(pool), 2);
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n,
    6,
  );
});
test("readiness validates the database schema; session responses contain no secrets", async () => {
  assert.equal((await request("/health/ready")).status, 200);
  const r = await request("/api/session", "GET", undefined, users.owner);
  assert.deepEqual(Object.keys(r.data.user).sort(), [
    "displayName",
    "email",
    "id",
  ]);
  assert.equal(r.headers.get("cache-control"), "no-store");
});
test("unsafe requests require the exact configured Origin", async () => {
  for (const Origin of ["https://evil.example", "null", ""])
    assert.equal(
      (
        await request(
          "/api/events",
          "POST",
          { name: "Forged event" },
          users.owner,
          { Origin },
        )
      ).status,
      403,
    );
});
test("email uniqueness is case-insensitive and password hashes are salted", async () => {
  const r = await request("/api/auth/register", "POST", {
    displayName: "Duplicate",
    email: "OWNER@EXAMPLE.TEST",
    password: pass,
  });
  assert.equal(r.status, 409);
  const rows = (await pool.query("SELECT password_hash FROM users")).rows;
  assert.equal(new Set(rows.map((r) => r.password_hash)).size, 6);
  assert.ok(rows.every((r) => !r.password_hash.includes(pass)));
});
test("event creation creates exactly one owner and persists", async () => {
  const e = await createEvent("Foundation rehearsal");
  const rows = (
    await pool.query("SELECT * FROM memberships WHERE event_id=$1", [e.id])
  ).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, "owner");
  const r = await request(`/api/events/${e.id}`, "GET", undefined, users.owner);
  assert.equal(r.data.event.name, "Foundation rehearsal");
  assert.equal(r.data.event.description, "A private briefing.");
});
test("outsiders cannot enumerate, read, edit or inspect invitations/activity of another event", async () => {
  const e = await createEvent("Restricted event");
  const i = await invitation(e);
  assert.ok(
    !(
      await request("/api/events", "GET", undefined, users.outsider)
    ).data.events.some((x) => x.id === e.id),
  );
  for (const [path, method, data] of [
    [`/api/events/${e.id}`, "GET"],
    [`/api/events/${e.id}`, "PATCH", { version: 1, name: "Stolen" }],
    [`/api/events/${e.id}/invites`, "GET"],
    [`/api/events/${e.id}/audit`, "GET"],
    [`/api/events/${e.id}/invites/${i.id}`, "DELETE"],
  ])
    assert.equal(
      (await request(path, method, data, users.outsider)).status,
      404,
    );
});
test("event IDs and subresource IDs cannot be mixed", async () => {
  const a = await createEvent("Event A");
  const b = await createEvent("Event B", users.other);
  const inv = await invitation(b, "player", 1, users.other);
  assert.equal(
    (
      await request(
        `/api/events/${a.id}/invites/${inv.id}`,
        "DELETE",
        undefined,
        users.owner,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        `/api/events/${a.id}/members/${users.other.id}`,
        "DELETE",
        undefined,
        users.owner,
      )
    ).status,
    404,
  );
});
test("players and staff cannot edit event details, issue invites, or change roles", async () => {
  const e = await createEvent("Role boundary");
  await join(e, users.player);
  await join(e, users.staff, "staff");
  for (const u of [users.player, users.staff]) {
    assert.equal(
      (
        await request(
          `/api/events/${e.id}`,
          "PATCH",
          { version: 1, name: "Forbidden" },
          u,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          `/api/events/${e.id}/invites`,
          "POST",
          { role: "player" },
          u,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          `/api/events/${e.id}/members/${u.id}`,
          "PATCH",
          { role: "organizer" },
          u,
        )
      ).status,
      403,
    );
  }
});
test("organizers can edit but cannot grant organizer rights or affect the owner", async () => {
  const e = await createEvent("Organizer boundary");
  await join(e, users.organizer, "organizer");
  assert.equal(
    (
      await request(
        `/api/events/${e.id}`,
        "PATCH",
        { version: 1, name: "Updated briefing" },
        users.organizer,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        `/api/events/${e.id}/invites`,
        "POST",
        { role: "organizer" },
        users.organizer,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/api/events/${e.id}/members/${users.owner.id}`,
        "DELETE",
        undefined,
        users.organizer,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/api/events/${e.id}/members/${users.owner.id}`,
        "PATCH",
        { role: "player" },
        users.owner,
      )
    ).status,
    403,
  );
});
test("single-use invitations admit exactly one of two concurrent users", async () => {
  const e = await createEvent("One seat");
  const inv = await invitation(e);
  const results = await Promise.all(
    [users.player, users.outsider].map((u) =>
      request("/api/events/join", "POST", { code: inv.code }, u),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  const row = (
    await pool.query("SELECT uses FROM invitations WHERE id=$1", [inv.id])
  ).rows[0];
  assert.equal(row.uses, 1);
});
test("joining an event twice does not duplicate membership or consume another use", async () => {
  const e = await createEvent("Repeat enrollment");
  const inv = await invitation(e, "player", 3);
  for (let n = 0; n < 2; n++)
    assert.equal(
      (
        await request(
          "/api/events/join",
          "POST",
          { code: inv.code },
          users.player,
        )
      ).status,
      200,
    );
  assert.equal(
    (await pool.query("SELECT uses FROM invitations WHERE id=$1", [inv.id]))
      .rows[0].uses,
    1,
  );
});
test("privileged invitations are single-use and cannot restore a demoted role", async () => {
  const e = await createEvent("No restored privilege");
  assert.equal(
    (
      await request(
        `/api/events/${e.id}/invites`,
        "POST",
        { role: "organizer", maxUses: 2 },
        users.owner,
      )
    ).status,
    400,
  );
  const inv = await join(e, users.organizer, "organizer");
  assert.equal(
    (
      await request(
        `/api/events/${e.id}/members/${users.organizer.id}`,
        "PATCH",
        { role: "player" },
        users.owner,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        `/api/events/${e.id}/members/${users.organizer.id}`,
        "DELETE",
        undefined,
        users.organizer,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/api/events/join",
        "POST",
        { code: inv.code },
        users.organizer,
      )
    ).status,
    400,
  );
});
test("expired and revoked invitation codes cannot be redeemed", async () => {
  const e = await createEvent("Expired invitations");
  const a = await invitation(e);
  await pool.query(
    "UPDATE invitations SET expires_at=now()-interval '1 second' WHERE id=$1",
    [a.id],
  );
  assert.equal(
    (await request("/api/events/join", "POST", { code: a.code }, users.player))
      .status,
    400,
  );
  const b = await invitation(e);
  assert.equal(
    (
      await request(
        `/api/events/${e.id}/invites/${b.id}`,
        "DELETE",
        undefined,
        users.owner,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/events/join", "POST", { code: b.code }, users.player))
      .status,
    400,
  );
  const stored = (
    await pool.query("SELECT token_hash FROM invitations WHERE id=$1", [b.id])
  ).rows[0];
  assert.equal(stored.token_hash, digest(b.code));
});
test("removing a member invalidates access through their existing session", async () => {
  const e = await createEvent("Removed member");
  await join(e, users.player);
  assert.equal(
    (
      await request(
        `/api/events/${e.id}/members/${users.player.id}`,
        "DELETE",
        undefined,
        users.owner,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request(`/api/events/${e.id}`, "GET", undefined, users.player))
      .status,
    404,
  );
  assert.equal(
    (await request("/api/session", "GET", undefined, users.player)).status,
    200,
  );
});
test("event lifecycle enforces order, optimistic concurrency, and archive read-only behavior", async () => {
  const e = await createEvent("Lifecycle");
  assert.equal(
    (
      await request(
        `/api/events/${e.id}`,
        "PATCH",
        { version: 1, status: "live" },
        users.owner,
      )
    ).status,
    409,
  );
  let version = 1;
  for (const status of [
    "rehearsal",
    "live",
    "paused",
    "live",
    "ended",
    "archived",
  ]) {
    const r = await request(
      `/api/events/${e.id}`,
      "PATCH",
      { version, status },
      users.owner,
    );
    assert.equal(r.status, 200, JSON.stringify(r.data));
    version = r.data.event.version;
  }
  assert.equal(
    (
      await request(
        `/api/events/${e.id}`,
        "PATCH",
        { version, name: "Changed" },
        users.owner,
      )
    ).status,
    409,
  );
  assert.equal(
    (await request(`/api/events/${e.id}/invites`, "POST", {}, users.owner))
      .status,
    409,
  );
  const f = await createEvent("Stale edit");
  assert.equal(
    (
      await request(
        `/api/events/${f.id}`,
        "PATCH",
        { version: 2, name: "Wrong version" },
        users.owner,
      )
    ).status,
    409,
  );
});
test("transaction rollback does not leave an orphan event", async () => {
  const id = randomUUID();
  await assert.rejects(
    transaction(pool, async (db) => {
      await db.query(
        "INSERT INTO events(id,owner_user_id,name) VALUES($1,$2,$3)",
        [id, users.owner.id, "Rolled back"],
      );
      throw new Error("intentional rehearsal");
    }),
  );
  assert.equal(
    (await pool.query("SELECT id FROM events WHERE id=$1", [id])).rows.length,
    0,
  );
});
test("production configuration requires HTTPS and host-only secure sessions", () => {
  assert.throws(() =>
    readConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://unused" }),
  );
  assert.throws(() =>
    readConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://unused",
      APP_ORIGIN: "http://oracle.example",
    }),
  );
  const config = readConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgres://unused",
    APP_ORIGIN: "https://oracle.example",
  });
  const cookie = sessionCookie(config, "opaque");
  assert.ok(cookie.startsWith("__Host-oracle_session="));
  assert.ok(
    cookie.includes("HttpOnly") &&
      cookie.includes("Secure") &&
      !cookie.includes("Domain="),
  );
});
test("password change revokes every old session and rejects the old password", async () => {
  const login = await request("/api/auth/login", "POST", {
    email: users.other.email,
    password: pass,
  });
  assert.equal(login.status, 200);
  const changed = await request(
    "/api/auth/password",
    "POST",
    { currentPassword: pass, newPassword: "Replacement-only password 2026!" },
    users.other,
  );
  assert.equal(changed.status, 200);
  assert.equal(
    (await request("/api/session", "GET", undefined, { cookie: login.cookie }))
      .data.user,
    null,
  );
  assert.equal(
    (
      await request("/api/auth/login", "POST", {
        email: users.other.email,
        password: pass,
      })
    ).status,
    401,
  );
  users.other.cookie = changed.cookie;
});
test("a password change cannot be followed by a surviving old-password login", async (t) => {
  if (database.pg)
    return t.skip(
      "Requires the PostgreSQL TCP CI gate; PGlite has one connection.",
    );
  const { hashPassword } = await import("../src/security.js");
  const client = await pool.connect();
  let pending;
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      users.outsider.id,
    ]);
    pending = request("/api/auth/login", "POST", {
      email: users.outsider.email,
      password: pass,
    });
    await new Promise((r) => setTimeout(r, 200));
    await client.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
      await hashPassword("Changed during blocked login 2026!"),
      users.outsider.id,
    ]);
    await client.query("DELETE FROM sessions WHERE user_id=$1", [
      users.outsider.id,
    ]);
    await client.query("COMMIT");
    const login = await pending;
    if (login.status === 200)
      assert.equal(
        (
          await request("/api/session", "GET", undefined, {
            cookie: login.cookie,
          })
        ).data.user,
        null,
      );
    else assert.equal(login.status, 401);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

test("logout and expiration revoke authentication", async () => {
  const login = await request("/api/auth/login", "POST", {
    email: users.staff.email,
    password: pass,
  });
  const who = { cookie: login.cookie };
  assert.equal(
    (await request("/api/auth/logout", "POST", {}, who)).status,
    204,
  );
  assert.equal(
    (await request("/api/session", "GET", undefined, who)).data.user,
    null,
  );
  await pool.query(
    "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
    [users.staff.id],
  );
  assert.equal(
    (await request("/api/session", "GET", undefined, users.staff)).data.user,
    null,
  );
});
test("malformed requests and SQL-shaped values cannot escape validation", async () => {
  assert.equal(
    (await request("/api/events/not-a-uuid", "GET", undefined, users.owner))
      .status,
    404,
  );
  assert.equal(
    (
      await request(
        "/api/events",
        "POST",
        { name: "x'); DROP TABLE users; --" },
        users.owner,
      )
    ).status,
    201,
  );
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n,
    6,
  );
  assert.equal(
    (await request("/api/events", "POST", { name: "A" }, users.owner)).status,
    400,
  );
});
test("an isolated database snapshot restores records and accepts repeat migrations", async (t) => {
  if (!database.pg)
    return t.skip(
      "The PostgreSQL TCP gate runs the dedicated pg_dump/pg_restore rehearsal.",
    );
  const { PGlite } = await import("@electric-sql/pglite");
  const blob = await database.pg.dumpDataDir("gzip");
  const restored = new PGlite({ loadDataDir: blob });
  try {
    for (const [table, order] of [
      ["users", "id"],
      ["events", "id"],
      ["memberships", "event_id,user_id"],
      ["invitations", "id"],
      ["audit_entries", "id"],
      ["schema_migrations", "version"],
    ]) {
      const sql = `SELECT * FROM ${table} ORDER BY ${order}`;
      const before = (await pool.query(sql)).rows,
        after = (await restored.query(sql)).rows;
      assert.equal(
        digest(JSON.stringify(after)),
        digest(JSON.stringify(before)),
        `${table} snapshot`,
      );
    }
    const adapter = {
      query: (...args) => restored.query(...args),
      connect: async () => ({
        query: (...args) => restored.query(...args),
        release() {},
      }),
    };
    assert.equal(await migrate(adapter), 2);
  } finally {
    await restored.close();
  }
});
test("migration checksum drift blocks startup migration without changing data", async () => {
  const original = (
    await pool.query("SELECT checksum FROM schema_migrations WHERE version=1")
  ).rows[0].checksum;
  try {
    await pool.query(
      "UPDATE schema_migrations SET checksum='changed' WHERE version=1",
    );
    await assert.rejects(migrate(pool), /checksum mismatch/);
  } finally {
    await pool.query(
      "UPDATE schema_migrations SET checksum=$1 WHERE version=1",
      [original],
    );
  }
});
