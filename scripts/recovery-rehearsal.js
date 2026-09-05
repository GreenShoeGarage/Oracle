import { spawn } from "node:child_process";
import { mkdtemp, rm, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createPool, migrate } from "../src/db.js";
import { digest } from "../src/security.js";
const sourceUrl = new URL(process.env.TEST_DATABASE_URL || "");
const targetUrl = new URL(process.env.RESTORE_DATABASE_URL || "");
for (const url of [sourceUrl, targetUrl])
  if (!/^oracle_test[a-z0-9_]*$/.test(url.pathname.slice(1)))
    throw new Error(
      "Recovery rehearsal is limited to disposable oracle_test* databases.",
    );
assert.notEqual(
  sourceUrl.pathname,
  targetUrl.pathname,
  "Source and restore database names must differ.",
);
assert.equal(
  sourceUrl.host,
  targetUrl.host,
  "Use the same disposable test server for this rehearsal.",
);
const source = createPool({ databaseUrl: sourceUrl.href, ssl: false });
let restored;
const directory = await mkdtemp(join(tmpdir(), "oracle-recovery-"));
const backup = join(directory, "database.dump");
function pgTool(tool, args, inputFd, outputFd, url = sourceUrl) {
  const container = process.env.PG_TOOL_CONTAINER;
  const command = container ? "docker" : tool;
  const argv = container ? ["exec", "-i", container, tool, ...args] : args;
  const env = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
  };
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, {
      env,
      stdio: [inputFd ?? "ignore", outputFd ?? "ignore", "pipe"],
    });
    child.stderr.resume();
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `${tool} failed (${code}). Verify matching PostgreSQL client tools and the configured test credentials.`,
            ),
          ),
    );
  });
}
try {
  const name = targetUrl.pathname.slice(1);
  // Never replace an existing database, even if its name looks disposable.
  assert.equal(
    (await source.query("SELECT 1 FROM pg_database WHERE datname=$1", [name]))
      .rows.length,
    0,
    "Restore database already exists; choose a fresh name.",
  );
  await source.query(`CREATE DATABASE "${name}"`);
  const out = await open(backup, "wx", 0o600);
  try {
    await pgTool(
      "pg_dump",
      [
        "-U",
        decodeURIComponent(sourceUrl.username),
        "-d",
        sourceUrl.pathname.slice(1),
        "--format=custom",
        "--no-owner",
        "--no-acl",
      ],
      undefined,
      out.fd,
    );
  } finally {
    await out.close();
  }
  const input = await open(backup, "r");
  try {
    await pgTool(
      "pg_restore",
      [
        "-U",
        decodeURIComponent(targetUrl.username),
        "-d",
        name,
        "--no-owner",
        "--no-acl",
        "--exit-on-error",
      ],
      input.fd,
      undefined,
      targetUrl,
    );
  } finally {
    await input.close();
  }
  restored = createPool({ databaseUrl: targetUrl.href, ssl: false });
  for (const [table, order] of [
    ["users", "id"],
    ["events", "id"],
    ["memberships", "event_id,user_id"],
    ["invitations", "id"],
    ["audit_entries", "id"],
    ["schema_migrations", "version"],
  ]) {
    const a = (await source.query(`SELECT * FROM ${table} ORDER BY ${order}`))
      .rows;
    const b = (await restored.query(`SELECT * FROM ${table} ORDER BY ${order}`))
      .rows;
    assert.equal(
      digest(JSON.stringify(b)),
      digest(JSON.stringify(a)),
      `${table} restored content`,
    );
  }
  await migrate(restored);
  const event = (
    await restored.query("SELECT id,owner_user_id FROM events LIMIT 1")
  ).rows[0];
  assert.ok(event, "Rehearsal source must contain an event.");
  const maximum = BigInt(
    (
      await restored.query(
        "SELECT COALESCE(max(id),0) AS id FROM audit_entries",
      )
    ).rows[0].id,
  );
  const inserted = (
    await restored.query(
      "INSERT INTO audit_entries(event_id,actor_id,action) VALUES($1,$2,'recovery.rehearsed') RETURNING id",
      [event.id, event.owner_user_id],
    )
  ).rows[0];
  assert.ok(
    BigInt(inserted.id) > maximum,
    "Restored identity sequence must advance safely.",
  );
  console.log(
    "PostgreSQL pg_dump/pg_restore round trip and migration after restore passed.",
  );
} finally {
  if (restored) await restored.end();
  await source.end();
  await rm(directory, { recursive: true, force: true });
}
