import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { digest } from "../src/security.js";
import { VERSION, SCHEMA_VERSION } from "../src/config.js";

export const ROLLBACK_COMMIT = "6127db477f76f1c3b9f18ea6eb423e029c9dcaf7";
export const ROLLBACK_VERSION = "0.11.0";
const root = fileURLToPath(new URL("../", import.meta.url));

export function recoveryConfiguration(env = process.env) {
  assert.ok(env.APP_ENV !== "production" && env.NODE_ENV !== "production", "Recovery rehearsals cannot run in production.");
  const urls = ["TEST_DATABASE_URL", "RESTORE_DATABASE_URL"].map((key) => {
    let url;
    try { url = new URL(env[key]); } catch { throw new Error(`${key} must identify a disposable loopback PostgreSQL database.`); }
    assert.ok(["postgres:", "postgresql:"].includes(url.protocol), "Recovery requires PostgreSQL TCP.");
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Recovery requires a loopback PostgreSQL server.");
    assert.match(url.pathname, /^\/oracle_test[a-z0-9_]*$/, "Recovery is limited to disposable oracle_test* databases.");
    assert.equal(url.search, "", "Recovery connection URL overrides are unsupported.");
    assert.equal(url.hash, "", "Recovery connection URL fragments are unsupported.");
    return url;
  });
  assert.equal(urls[0].host, urls[1].host, "Use the same disposable test server for recovery.");
  assert.notEqual(urls[0].pathname, urls[1].pathname, "Source and restored database names must differ.");
  return { sourceUrl: urls[0], targetUrl: urls[1] };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

// Sort rows and JSON object keys so the checksum is independent of PostgreSQL
// row-return order. No fixture contents, credentials or session tokens escape.
export function checksumRows(rows) {
  return digest(JSON.stringify(rows.map((row) => JSON.stringify(canonical(row))).sort()));
}

export async function databaseChecksums(pool) {
  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  assert.ok(tables.length > 0, "Rollback requires a populated recovered schema.");
  const result = {};
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z][a-z0-9_]*$/, "Unexpected recovered table identifier.");
    const rows = (await pool.query(`SELECT to_jsonb(t) AS record FROM "${tablename}" t`)).rows.map(({ record }) => record);
    result[tablename] = { rows: rows.length, checksum: checksumRows(rows) };
  }
  return result;
}

export async function drainRecoveryDatabase(source, name, timeoutMs = 5000) {
  assert.match(name, /^oracle_test[a-z0-9_]*$/, "Only an owned disposable recovery target may be removed.");
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 5000, "Recovery database drain is bounded to five seconds.");
  const deadline = performance.now() + timeoutMs;
  while (true) {
    const remaining = Math.ceil(deadline - performance.now());
    assert.ok(remaining > 0, "Recovered database connections did not drain; the database was not force-dropped.");
    const count = (await source.query({ text: "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1", values: [name], query_timeout: remaining })).rows[0].n;
    if (count === 0) { await source.query(`DROP DATABASE "${name}"`); return; }
    await delay(Math.min(25, remaining));
  }
}

function subprocess(command, args, { cwd = root, env = process.env, timeoutMs = 30000 } = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", timedOut = false;
    child.stdout.on("data", (chunk) => { if (output.length < 65536) output += chunk.toString(); });
    child.stderr.resume();
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut || code !== 0) reject(new Error(`Rollback rehearsal subprocess ${command === process.execPath ? "node" : command} ${timedOut ? "timed out" : `failed (${code})`}.`));
      else resolveCommand(output.trim());
    });
  });
}

export async function verifyRollbackSource(directory, candidateRoot = root) {
  const oldRoot = resolve(directory);
  assert.notEqual(oldRoot, resolve(candidateRoot), "Rollback must use a separate exact prior source checkout.");
  const head = await subprocess("git", ["rev-parse", "HEAD"], { cwd: oldRoot });
  assert.equal(head, ROLLBACK_COMMIT, "Rollback source must match the pinned successful release.");
  assert.equal(await subprocess("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: oldRoot }), "", "Rollback source must be unmodified.");
  const oldPackage = JSON.parse(await readFile(join(oldRoot, "package.json"), "utf8"));
  assert.equal(oldPackage.version, ROLLBACK_VERSION, "Unexpected rollback application version.");
  const expected = (await readdir(join(candidateRoot, "migrations"))).filter((name) => name.endsWith(".sql")).sort();
  const previous = (await readdir(join(oldRoot, "migrations"))).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(previous, expected, "App-only rollback requires the same migration set.");
  assert.equal(SCHEMA_VERSION, 10, "This rollback target is established only for schema 10.");
  for (const name of expected) assert.equal(digest(await readFile(join(oldRoot, "migrations", name))), digest(await readFile(join(candidateRoot, "migrations", name))), `Rollback migration ${name} must be byte-identical.`);
  return oldRoot;
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
  const { port } = server.address();
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) throw new Error("Rollback application exited before its graceful shutdown check.");
  const exit = new Promise((resolveExit) => child.once("exit", (code, signal) => resolveExit({ code, signal })));
  child.kill("SIGTERM");
  let timer;
  try {
    const result = await Promise.race([exit, new Promise((_, reject) => { timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Rollback application failed to drain within 15 seconds.")); }, 15000); })]);
    assert.deepEqual(result, { code: 0, signal: null }, "Every application version must stop gracefully.");
  } finally { clearTimeout(timer); }
}

// Invoked only after the real pg_dump/pg_restore comparison has passed. Both
// cookies belong to fictional sessions included in that recovered fixture.
// All application requests are GETs: every table, including sessions and rate
// limits, must remain byte-equivalent after migration and each application.
export async function rehearseApplicationRollback({ pool, databaseUrl, fixture, oldRoot, candidateCommit = process.env.GITHUB_SHA }) {
  const target = recoveryConfiguration({ ...process.env, RESTORE_DATABASE_URL: databaseUrl }).targetUrl;
  const previousRoot = await verifyRollbackSource(oldRoot);
  assert.match(candidateCommit || "", /^[a-f0-9]{40}$/, "Rollback requires the exact candidate commit.");
  const before = await databaseChecksums(pool);
  for (const table of ["users", "sessions", "events", "characters", "character_inventory", "adventure_journal", "exchange_receipts", "story_entries", "trace_records", "economy_receipts", "sigil_outcomes", "static_readings", "stagehand_parties", "schema_migrations"]) assert.ok(before[table]?.rows > 0, `Rollback fixture must populate ${table}.`);
  const baselineChecksum = checksumRows([before]);
  const report = { formatVersion: 1, result: "running", scope: "Isolated restored PostgreSQL fixture; application rollback only, not a live database backup or browser-cache rollback.", candidateCommit, candidateVersion: VERSION, rollbackCommit: ROLLBACK_COMMIT, rollbackVersion: ROLLBACK_VERSION, schemaVersion: SCHEMA_VERSION, tables: Object.keys(before).length, populatedTables: Object.values(before).filter(({ rows }) => rows > 0).length, baselineChecksum, phases: [], cleanup: { serversStopped: false, restoredDatabaseDropped: false } };
  const owner = (await pool.query("SELECT id,email,password_hash,is_superuser,is_disabled FROM users WHERE id=$1", [fixture.user])).rows[0];
  assert.ok(owner?.is_superuser && !owner.is_disabled && owner.password_hash, "An existing enabled fictional operator must survive the restore.");
  for (const [label, cwd, version, commit] of [["candidate-before", root, VERSION, candidateCommit], ["previous-release", previousRoot, ROLLBACK_VERSION, ROLLBACK_COMMIT], ["candidate-after", root, VERSION, candidateCommit]]) {
    const port = await availablePort(), origin = `http://127.0.0.1:${port}`;
    const env = { PATH: process.env.PATH, NODE_ENV: "test", APP_ENV: "test", DATABASE_URL: target.href, DATABASE_SSL: "disable", APP_ORIGIN: origin, PORT: String(port), RAILWAY_GIT_COMMIT_SHA: commit, BOOTSTRAP_SUPERUSER_EMAIL: owner.email, REGISTRATION_ENABLED: "false" };
    const migrationOutput = await subprocess(process.execPath, ["scripts/migrate.js"], { cwd, env });
    const migrationEvents = migrationOutput.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    assert.ok(migrationEvents.some((entry) => entry.event === "migrations_complete" && entry.version === 10), `${label} must reapply schema-10 migrations.`);
    assert.ok(migrationEvents.some((entry) => entry.event === "superuser_provisioned" && entry.matched === true && entry.userId === owner.id), `${label} must retain the same existing operator.`);
    const child = spawn(process.execPath, ["src/server.js"], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let startup = "", spawnError;
    child.on("error", (error) => { spawnError = error; });
    child.stdout.on("data", (chunk) => { if (startup.length < 65536) startup += chunk.toString(); });
    child.stderr.resume();
    let reads = 0, rejected = 0;
    async function get(path, account, expected = 200, expectedAccount = account?.id) {
      const response = await fetch(`${origin}${path}`, { redirect: "error", signal: AbortSignal.timeout(5000), headers: { ...(account ? { Cookie: `oracle_session=${account.token}`, "X-ORACLE-Expected-Account": expectedAccount } : {}) } });
      assert.equal(response.status, expected, `${label} ${path.split("?")[0]} must return ${expected}.`);
      if (account) assert.equal(response.headers.get("x-oracle-account"), account.id, `${label} must retain response account binding.`);
      reads++;
      if (expected >= 400) rejected++;
      return response.json();
    }
    try {
      let ready = false;
      for (let attempt = 0; attempt < 80; attempt++) {
        if (spawnError || child.exitCode !== null || child.signalCode !== null) throw new Error(`${label} application exited before readiness.`);
        try {
          const response = await fetch(`${origin}/health/ready`, { redirect: "error", signal: AbortSignal.timeout(500) });
          const value = await response.json();
          if (response.ok && value.status === "ready" && value.version === version && value.schemaVersion === 10 && value.deploymentCommit === commit) { ready = true; break; }
        } catch {}
        await delay(100);
      }
      assert.ok(ready, `${label} must report its exact version, commit and schema.`);
      const operator = { id: fixture.user, token: fixture.ownerToken }, peer = { id: fixture.peer, token: fixture.peerToken };
      const session = await get("/api/session", operator);
      assert.equal(session.version, version);
      assert.equal(session.user.id, owner.id);
      assert.equal(session.user.email, owner.email);
      assert.equal(session.user.isSuperuser, true);
      assert.equal((await get("/api/session", peer)).user.isSuperuser, false);
      await get("/api/session", operator, 409, fixture.peer);
      await get("/api/admin/users", peer, 403);
      const event = (await get("/api/events", operator)).events.find((entry) => entry.id === fixture.event);
      assert.ok(event && event.role === "superuser" && event.status === "rehearsal", `${label} must retain operator event access.`);
      const base = `/api/events/${fixture.event}`;
      const own = await get(`${base}/characters/${fixture.character}`, operator);
      assert.equal(own.character.userId, owner.id);
      assert.equal(own.character.status, "approved");
      assert.equal(own.character.profile.privateObjectives, "A fictional secret that must survive database recovery.");
      assert.ok(own.inventory.some((item) => item.id === fixture.item && item.quantity === 1));
      const publicCharacter = await get(`${base}/characters/${fixture.character}`, peer);
      assert.equal(publicCharacter.character.visibility, "public");
      assert.equal(Object.hasOwn(publicCharacter.character.profile, "privateObjectives"), false);
      await get(`${base}/characters/${fixture.character}/inventory`, peer, 404);
      const play = await get(`${base}/adventure/play?characterId=${fixture.character}`, operator);
      assert.ok(play.journal.some((entry) => entry.id === fixture.originJournal && entry.type === "relic"));
      await get(`${base}/adventure/play?characterId=${fixture.character}`, peer, 404);
      const peerPlay = await get(`${base}/adventure/play?characterId=${fixture.peerCharacter}`, peer);
      assert.ok(peerPlay.journal.some((entry) => entry.id === fixture.sharedJournal && entry.type === "shared_reading"));
      assert.ok(startup.split("\n").filter(Boolean).map((line) => JSON.parse(line)).some((entry) => entry.event === "superuser_status" && entry.accountExists && entry.enabled), `${label} startup must confirm the existing enabled operator.`);
    } finally { await stopServer(child); }
    const after = await databaseChecksums(pool);
    assert.deepEqual(after, before, `${label} must preserve every recovered table, including operator credentials, sessions, inventories, histories and replay records.`);
    report.phases.push({ label, version, commit, readiness: true, migration: 10, operatorPreserved: true, authenticatedGetChecks: reads, deniedBoundaryChecks: rejected, checksum: checksumRows([after]), gracefulStop: true });
  }
  report.result = "passed";
  report.cleanup.serversStopped = true;
  return report;
}
