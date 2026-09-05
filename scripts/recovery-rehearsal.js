import { spawn } from "node:child_process";
import { mkdtemp, rm, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createPool, migrate, transaction } from "../src/db.js";
import { digest } from "../src/security.js";
import { defaultSetup } from "../public/kit.js";
import { defaultCharacterProfile } from "../public/characters-model.js";
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
  // The last integration suite can leave the new tables empty. Seed a complete
  // fictional Batch 3 record in this already-validated disposable database so
  // the dump/restore gate checks actual character and administrator data.
  await migrate(source);
  const fixture = { user: randomUUID(), event: randomUUID(), faction: randomUUID(), character: randomUUID(), item: randomUUID() };
  const setup = defaultSetup("fantasy", "council");
  const profile = {
    ...defaultCharacterProfile(setup.rules), name: "Recovery rehearsal character", factionId: fixture.faction,
    privateObjectives: "A fictional secret that must survive database recovery.",
    startingEquipment: [{ name: "Recovery lantern", quantity: 2, notes: "Original allocation." }],
  };
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const badge = [...randomBytes(20)].map((byte) => alphabet[byte % alphabet.length]).join("");
  await transaction(source, async (client) => {
    await client.query("INSERT INTO users(id,email,display_name,password_hash,is_superuser,is_disabled) VALUES($1,$2,'Recovery rehearsal','not-a-login-credential',true,true)", [fixture.user, `recovery-${fixture.user}@example.invalid`]);
    await client.query("INSERT INTO events(id,owner_user_id,name,setup) VALUES($1,$2,'Recovery rehearsal event',$3)", [fixture.event, fixture.user, JSON.stringify(setup)]);
    await client.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'owner')", [fixture.event, fixture.user]);
    await client.query("INSERT INTO event_character_settings(event_id,require_approval,max_per_player,public_fields,version) VALUES($1,true,2,'[\"pronouns\",\"faction\"]',3)", [fixture.event]);
    await client.query("INSERT INTO factions(id,event_id,name,description) VALUES($1,$2,'Recovery guild','Preserve this faction description.')", [fixture.faction, fixture.event]);
    await client.query("INSERT INTO characters(id,event_id,user_id,status,profile,badge_code,review_notes,inventory_initialized,version) VALUES($1,$2,$3,'approved',$4,$5,'Approval survives recovery.',true,5)", [fixture.character, fixture.event, fixture.user, JSON.stringify(profile), badge]);
    await client.query("INSERT INTO character_inventory(id,event_id,character_id,name,quantity,notes,version) VALUES($1,$2,$3,'Recovery lantern',1,'Current quantity after use.',2)", [fixture.item, fixture.event, fixture.character]);
    await client.query("INSERT INTO system_audit_entries(actor_id,target_user_id,action,details) VALUES($1,$1,'recovery.fixture',$2)", [fixture.user, JSON.stringify({ fictional: true, eventId: fixture.event })]);
  });
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
    ["system_audit_entries", "id"],
    ["event_character_settings", "event_id"],
    ["factions", "id"],
    ["characters", "id"],
    ["character_inventory", "id"],
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
  const maximumSystemAudit = BigInt((await restored.query("SELECT COALESCE(max(id),0) AS id FROM system_audit_entries")).rows[0].id);
  const systemAudit = (await restored.query("INSERT INTO system_audit_entries(actor_id,target_user_id,action) VALUES($1,$1,'recovery.rehearsed') RETURNING id", [fixture.user])).rows[0];
  assert.ok(BigInt(systemAudit.id) > maximumSystemAudit, "Restored system audit identity sequence must advance safely.");
  console.log(
    "PostgreSQL pg_dump/pg_restore round trip, populated character and administrator records, both audit sequences, and migration after restore passed.",
  );
} finally {
  if (restored) await restored.end();
  await source.end();
  await rm(directory, { recursive: true, force: true });
}
