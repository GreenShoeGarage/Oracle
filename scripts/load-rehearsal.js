import assert from "node:assert/strict";
import { Agent, createServer, request as httpRequest } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cpus, platform, arch, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { createPool, migrate } from "../src/db.js";
import { createApp } from "../src/app.js";
import { readConfig, VERSION, SCHEMA_VERSION } from "../src/config.js";
import { defaultSetup } from "../public/kit.js";
import { defaultCharacterProfile } from "../public/characters-model.js";
import { defaultAdventure, defaultAdventureNode } from "../public/adventure-model.js";

export const LOAD_TARGET = 100;
const ROUNDS = 3;
const REQUEST_TIMEOUT_MS = 10000;
const WORKLOAD_TIMEOUT_MS = 240000;
const SOURCE_ADDRESSES = ["127.0.0.2", "127.0.0.3"];

// This tool creates its HTTP server. It has no remote HTTP mode and never
// changes an auth limiter, provisions SQL users/sessions, or seeds gameplay.
export function loadConfiguration(env = process.env, args = process.argv.slice(2)) {
  assert.ok(!env.SMOKE_ORIGIN && !env.LOAD_ORIGIN, "Remote HTTP targets are unsupported by the load rehearsal.");
  assert.ok(env.NODE_ENV !== "production" && env.APP_ENV !== "production", "The load rehearsal cannot run in a production environment.");
  let database;
  try { database = new URL(env.TEST_DATABASE_URL); }
  catch { throw new Error("TEST_DATABASE_URL must identify a disposable loopback PostgreSQL database."); }
  assert.ok(["postgres:", "postgresql:"].includes(database.protocol), "Use PostgreSQL TCP; embedded databases do not establish capacity.");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(database.hostname), "The load rehearsal requires a loopback PostgreSQL server.");
  assert.match(database.pathname, /^\/oracle_test[a-z0-9_]*$/, "The connection database must be named oracle_test*.");
  assert.equal(database.search, "", "Connection URL options are unsupported; use the isolated local database defaults.");
  assert.equal(database.hash, "", "Connection URL fragments are unsupported.");
  assert.ok(args.length <= 1 && args.every((arg) => /^--report=.+/.test(arg)), "Usage: node scripts/load-rehearsal.js [--report=path.json]");
  return { database, reportPath: args[0] ? resolve(args[0].slice("--report=".length)) : null };
}

export function summarizeSamples(samples) {
  const latency = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
  const percentile = (fraction) => latency.length ? Math.round(latency[Math.max(0, Math.ceil(latency.length * fraction) - 1)] * 100) / 100 : null;
  const statuses = {};
  for (const sample of samples) statuses[sample.status] = (statuses[sample.status] || 0) + 1;
  return { requests: samples.length, errors: samples.filter((sample) => !sample.ok).length, timeouts: samples.filter((sample) => sample.status === "timeout").length, p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: percentile(1), statuses };
}

function machine() {
  return { node: process.version, platform: platform(), architecture: arch(), cpuModel: cpus()[0]?.model || "unknown", logicalCpus: cpus().length, hostMemoryBytes: totalmem(), scope: "Load generator and application share one process and host; PostgreSQL runs separately on loopback. Host totals are not a resource allocation guarantee." };
}

// Exported only so the same public HTTP lifecycle can be checked with a small
// cohort in ordinary tests. The command-line capacity gate always requests 100.
export async function rehearseHttp({ pool, players = LOAD_TARGET, databaseKind = "PostgreSQL TCP", report = {}, progress = () => {} }) {
  assert.ok(Number.isInteger(players) && players >= 2 && players <= LOAD_TARGET, "Cohort size must be 2–100.");
  Object.assign(report, {
    formatVersion: 1, version: VERSION, schemaVersion: SCHEMA_VERSION,
    commit: process.env.GITHUB_SHA || null, startedAt: new Date().toISOString(), result: "running",
    target: { confirmedBeforeRun: LOAD_TARGET, actualPlayers: players, scope: "Simulated authenticated player sessions; not physical devices or human participants." },
    hosting: { environment: process.env.CI ? "GitHub Actions isolated lab" : "Local isolated lab", databaseKind, appInstances: 1, applicationDatabasePoolMax: pool.options?.max ?? 1, databaseConnectionTimeoutMs: 5000, databaseStatementTimeoutMs: 10000, requestTimeoutMs: REQUEST_TIMEOUT_MS, overallWorkloadTimeoutMs: WORKLOAD_TIMEOUT_MS, cleanupTimeoutMs: 30000, sourceAddresses: SOURCE_ADDRESSES, ...machine() },
    workload: { rounds: ROUNDS, eventCount: 1, theme: "fantasy", plannedRequests: players * ROUNDS * 6, readsPerPlayerPerRound: 5, writesPerPlayerPerRound: 1, write: "One permitted RELIC examination per player, retried with the identical request ID in the next two rounds.", reads: ["Own character and inventory", "Permitted adventure journal", "Story publications", "Information exchanges", "BAZAAR overview"], synchronization: "All player requests in each step begin together; each player has one HTTP keep-alive connection. There is no think time.", excluded: "Setup, integrity, closure and logout are outside latency samples. This is a short controlled burst, not a sustained soak, mobile network test, simultaneous registration test, full-event performance claim or Railway capacity claim." },
    constraints: ["The unchanged authentication limit permits 60 attempts per source address per 15 minutes. Account setup uses two real loopback source addresses (at most 51 registrations per address), without forwarded-header spoofing. Same-network arrivals exceeding the limit must register ahead of the event or wait for the window.", "The workload does not establish production capacity or prove human field usability."],
    cleanup: { eventArchived: false, sessionsSignedOut: 0, serverClosed: false, databaseDropped: false },
  });
  const accounts = [], playerAccounts = [], samples = [], sockets = new Set(), playerSockets = new Set(), seenSources = new Set();
  let handler, measuring = false, active = 0, peak = 0, socketPeak = 0, playerSocketPeak = 0, event, owner;
  let measuredCpu, measuredStarted, measuredMemory, cleanupDeadline;
  const started = performance.now();
  const deadline = AbortSignal.timeout(WORKLOAD_TIMEOUT_MS);
  const server = createServer((req, res) => {
    seenSources.add(req.socket.remoteAddress);
    if (measuring) {
      if (!playerSockets.has(req.socket)) { playerSockets.add(req.socket); req.socket.once("close", () => playerSockets.delete(req.socket)); }
      active++; peak = Math.max(peak, active); socketPeak = Math.max(socketPeak, sockets.size);
      playerSocketPeak = Math.max(playerSocketPeak, playerSockets.size);
      let done = false;
      const finish = () => { if (!done) { done = true; active--; } };
      res.once("finish", finish); res.once("close", finish);
    }
    handler(req, res);
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  report.hosting.applicationOrigin = origin;
  handler = createApp({ pool, config: { ...readConfig({ DATABASE_URL: "postgresql://unused", APP_ENV: "test" }), origin }, logger: () => {} });

  async function request(account, path, { method = "GET", body, status = 200, label, cleanup = false } = {}) {
    const stamp = performance.now();
    const sample = label ? { route: `${method} ${label}`, durationMs: 0, status: "network", ok: false } : null;
    try {
      const result = await new Promise((resolveRequest, reject) => {
        const data = body === undefined ? undefined : JSON.stringify(body);
        const req = httpRequest(new URL(path, origin), {
          method, agent: account.agent, localAddress: account.sourceAddress,
          signal: AbortSignal.any([cleanup ? cleanupDeadline : deadline, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
          headers: { Accept: "application/json", ...(account.cookie ? { Cookie: account.cookie } : {}), ...(account.id ? { "X-ORACLE-Expected-Account": account.id } : {}), ...(method !== "GET" ? { Origin: origin, "Content-Type": "application/json", ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}) } : {}) },
        }, (res) => {
          const chunks = []; let bytes = 0;
          res.on("data", (chunk) => { bytes += chunk.length; if (bytes > 2_000_000) req.destroy(new Error("Load response exceeded 2 MB.")); else chunks.push(chunk); });
          res.on("error", reject);
          res.on("end", () => {
            try { resolveRequest({ status: res.statusCode, headers: res.headers, data: res.statusCode === 204 ? null : JSON.parse(Buffer.concat(chunks).toString("utf8")) }); }
            catch { reject(new Error("Load response was not readable JSON.")); }
          });
        });
        req.on("error", reject);
        req.end(data);
      });
      if (sample) sample.status = result.status;
      assert.equal(result.status, status, `${method} ${label || path.replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g, ":id").split("?")[0]} must return HTTP ${status}; received ${result.status}.`);
      const cookie = result.headers["set-cookie"]?.[0];
      if (cookie) {
        assert.ok(cookie.startsWith("oracle_session=") && cookie.includes("; HttpOnly") && cookie.includes("; SameSite=Lax"), "Local public authentication must issue its normal protected session cookie.");
        account.cookie = cookie.split(";", 1)[0];
      }
      if (account.id) assert.equal(result.headers["x-oracle-account"], account.id, "Every authenticated reply must retain the expected account.");
      if (sample) sample.ok = true;
      return result.data;
    } catch (error) {
      if (sample && error.name === "AbortError") sample.status = "timeout";
      throw error;
    } finally {
      if (sample) { sample.durationMs = performance.now() - stamp; samples.push(sample); }
    }
  }
  async function all(items, action) {
    const outcomes = await Promise.allSettled(items.map(action));
    const failures = outcomes.filter((outcome) => outcome.status === "rejected");
    if (failures.length) throw new Error(`${failures.length} concurrent request(s) failed: ${failures[0].reason.message}`);
    return outcomes.map((outcome) => outcome.value);
  }
  async function register(index) {
    const account = { sourceAddress: SOURCE_ADDRESSES[index % SOURCE_ADDRESSES.length], agent: new Agent({ keepAlive: true, maxSockets: 1 }), cookie: null };
    accounts.push(account);
    const data = await request(account, "/api/auth/register", { method: "POST", status: 201, body: { displayName: `Load rehearsal ${index}`, email: `oracle-load-${randomUUID()}@example.invalid`, password: randomBytes(32).toString("base64url") } });
    account.id = data.user.id;
    return account;
  }
  async function transition(status, cleanup = false) {
    event = (await request(owner, `/api/events/${event.id}`, { method: "PATCH", body: { version: event.version, status }, cleanup })).event;
  }
  function summarize() {
    const durationMs = measuredStarted ? Math.round(performance.now() - measuredStarted) : 0;
    report.measurement = { ...summarizeSamples(samples), durationMs, requestsPerSecond: durationMs ? Math.round(samples.length / durationMs * 100000) / 100 : null, peakServerRequests: peak, peakOpenConnections: socketPeak, peakPlayerConnections: playerSocketPeak, perRoute: Object.fromEntries([...new Set(samples.map((sample) => sample.route))].sort().map((route) => [route, summarizeSamples(samples.filter((sample) => sample.route === route))])) };
  }
  try {
    progress(`Target confirmed before setup: ${LOAD_TARGET} simultaneous authenticated player sessions; this run uses ${players}.`);
    owner = await register(0);
    const setup = defaultSetup("fantasy", "council");
    setup.enabledInstruments = ["briefing", "relic", "whisper", "broadside", "bazaar"];
    event = (await request(owner, "/api/events", { method: "POST", status: 201, body: { name: `Disposable load rehearsal ${randomUUID()}`, setup } })).event;
    const base = `/api/events/${event.id}`;
    const { invitation } = await request(owner, `${base}/invites`, { method: "POST", status: 201, body: { role: "player", maxUses: players, expiresInHours: 1 } });
    const node = defaultAdventureNode("relic", "load-reading", "ABCDEFGHJKLMNPQRSTUV");
    node.examinations[0].text = "A fictional permitted load rehearsal reading.";
    const adventure = await request(owner, `${base}/adventure/manage`, { method: "PUT", body: { version: 0, definition: { ...defaultAdventure(), title: "Load rehearsal", organizerNotes: "Organizer-only load marker", nodes: [node] } } });
    for (let index = 1; index <= players; index++) {
      const account = await register(index);
      playerAccounts.push(account);
      await request(account, "/api/events/join", { method: "POST", body: { code: invitation.code } });
      account.character = (await request(account, `${base}/characters`, { method: "POST", status: 201, body: { profile: { ...defaultCharacterProfile(setup.rules), name: `Load traveller ${index}`, privateObjectives: `Private load objective ${index}`, startingEquipment: [{ name: "Rehearsal lantern", quantity: 1, notes: "Unchanged during readings." }] } } })).character;
      account.character = (await request(account, `${base}/characters/${account.character.id}/submit`, { method: "POST", body: { version: account.character.version } })).character;
      if (account.character.status === "pending") account.character = (await request(owner, `${base}/characters/${account.character.id}/review`, { method: "POST", body: { version: account.character.version, decision: "approve", feedback: "" } })).character;
      assert.equal(account.character.status, "approved");
      account.initialInventory = (await request(account, `${base}/characters/${account.character.id}/inventory`)).inventory;
      account.action = { requestId: randomUUID(), version: adventure.version, characterId: account.character.id, nodeId: node.id, kind: "examine", examId: node.examinations[0].id, code: node.code };
    }
    assert.equal(new Set(playerAccounts.map((account) => account.id)).size, players);
    await transition("rehearsal");
    const sessions = await all(playerAccounts, (account) => request(account, "/api/session"));
    assert.deepEqual(sessions.map((session) => session.user.id), playerAccounts.map((account) => account.id));
    const activeSessions = (await pool.query("SELECT count(DISTINCT s.user_id)::int AS n FROM sessions s JOIN memberships m ON m.user_id=s.user_id WHERE m.event_id=$1 AND m.role='player' AND s.expires_at>now()", [event.id])).rows[0].n;
    assert.equal(activeSessions, players);
    report.integrity = { simultaneousAuthenticatedSessions: activeSessions, uniqueApprovedCharacters: players };
    progress(`Prepared ${players} public-API player accounts and approved characters; starting ${players * ROUNDS * 6} measured HTTP requests.`);
    measuring = true; measuredStarted = performance.now(); measuredCpu = process.cpuUsage(); measuredMemory = process.memoryUsage();
    for (let round = 0; round < ROUNDS; round++) {
      const routes = [
        ["/characters/:character", (a) => `${base}/characters/${a.character.id}`],
        ["/adventure/play", (a) => `${base}/adventure/play?characterId=${a.character.id}`],
        ["/story/play", (a) => `${base}/story/play?characterId=${a.character.id}`],
        ["/exchanges", (a) => `${base}/exchanges?characterId=${a.character.id}`],
        ["/bazaar", (a) => `${base}/bazaar?characterId=${a.character.id}`],
      ];
      for (const [label, path] of routes) await all(playerAccounts, async (account) => {
        const reply = await request(account, path(account), { label });
        assert.ok(!JSON.stringify(reply).includes("Organizer-only load marker"), "Player reads must exclude organizer-only content.");
        if (label === "/characters/:character") { assert.equal(reply.character.userId, account.id); assert.deepEqual(reply.inventory, account.initialInventory); }
      });
      await all(playerAccounts, async (account) => {
        const reply = await request(account, `${base}/adventure/action`, { method: "POST", body: account.action, label: "/adventure/action" });
        assert.equal(reply.journal.length, 1);
        assert.equal(reply.outcome.replayed, round > 0);
      });
    }
    measuring = false;
    summarize();
    report.measurement.cpu = process.cpuUsage(measuredCpu);
    report.measurement.memoryBefore = measuredMemory;
    report.measurement.memoryAfter = process.memoryUsage();
    report.measurement.processMaxRssKiB = process.resourceUsage().maxRSS;
    assert.equal(report.measurement.requests, players * ROUNDS * 6);
    assert.equal(report.measurement.errors, 0);
    assert.equal(playerSocketPeak, players, "All player HTTP connections must overlap during the measured workload.");
    const counts = (await pool.query("SELECT (SELECT count(*)::int FROM adventure_journal WHERE event_id=$1) AS journal, (SELECT count(*)::int FROM adventure_requests WHERE event_id=$1) AS receipts, (SELECT count(*)::int FROM characters WHERE event_id=$1 AND status='approved') AS characters", [event.id])).rows[0];
    assert.deepEqual(counts, { journal: players, receipts: players, characters: players });
    let privacyRejections = 0;
    for (const [index, account] of playerAccounts.entries()) {
      const journal = await request(account, `${base}/adventure/play?characterId=${account.character.id}`);
      assert.equal(journal.journal.length, 1);
      assert.equal(journal.journal[0].text, node.examinations[0].text);
      assert.deepEqual((await request(account, `${base}/characters/${account.character.id}/inventory`)).inventory, account.initialInventory);
      const other = playerAccounts[(index + 1) % players];
      await request(account, `${base}/adventure/play?characterId=${other.character.id}`, { status: 404 });
      privacyRejections++;
    }
    Object.assign(report.integrity, { journalEffects: counts.journal, idempotencyReceipts: counts.receipts, repeatedWriteAttempts: players * (ROUNDS - 1), unchangedInventories: players, crossAccountReadsRejected: privacyRejections, expectedPrivacyRejectionsExcludedFromMeasuredErrors: true });
    report.result = "passed";
    report.capacityTargetMet = players === LOAD_TARGET && databaseKind === "PostgreSQL TCP";
  } catch (error) {
    measuring = false;
    if (!report.measurement) summarize();
    report.result = "failed"; report.capacityTargetMet = false;
    // Never copy request bodies, session cookies, SQL errors or credentials.
    report.failure = { phase: measuredStarted ? "workload or integrity" : "setup", message: "The bounded rehearsal failed. Inspect the safe assertion printed by the runner." };
    throw error;
  } finally {
    const cleanupErrors = [];
    cleanupDeadline = AbortSignal.timeout(30000);
    if (event && owner) {
      try {
        event = (await request(owner, `/api/events/${event.id}`, { cleanup: true })).event;
        const next = { draft: "rehearsal", rehearsal: "live", live: "ended", paused: "ended", ended: "archived" };
        while (event.status !== "archived") { assert.ok(next[event.status]); await transition(next[event.status], true); }
        report.cleanup.eventArchived = true;
      } catch { cleanupErrors.push("Event closure did not complete before disposable database removal."); }
    }
    await Promise.all(accounts.map(async (account) => {
      if (account.id) {
        try { await request(account, "/api/auth/logout", { method: "POST", status: 204, cleanup: true }); report.cleanup.sessionsSignedOut++; }
        catch { cleanupErrors.push("A disposable session could not sign out before database removal."); }
      }
      account.agent.destroy();
    }));
    try { server.closeAllConnections(); await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())); report.cleanup.serverClosed = true; }
    catch { cleanupErrors.push("The local HTTP server did not close cleanly."); }
    report.hosting.observedClientAddresses = [...seenSources].sort();
    report.cleanup.errors = cleanupErrors;
    report.totalDurationMs = Math.round(performance.now() - started);
    report.finishedAt = new Date().toISOString();
    if (cleanupErrors.length) { report.result = "failed"; report.capacityTargetMet = false; }
  }
  assert.equal(report.cleanup.errors.length, 0, "Load rehearsal cleanup must finish.");
  return report;
}

export async function main(env = process.env, args = process.argv.slice(2)) {
  const { database, reportPath } = loadConfiguration(env, args);
  const source = createPool({ databaseUrl: database.href, ssl: false });
  const name = `oracle_test_load_${randomUUID().replaceAll("-", "")}`;
  const report = { result: "failed", cleanup: { databaseDropped: false } };
  let owned = false, pool, failure;
  try {
    assert.equal((await source.query("SELECT current_database() AS name")).rows[0].name, database.pathname.slice(1), "Disposable connection database must match its configured name.");
    await source.query(`CREATE DATABASE "${name}"`); owned = true;
    const target = new URL(database); target.pathname = `/${name}`;
    pool = createPool({ databaseUrl: target.href, ssl: false });
    await migrate(pool);
    await rehearseHttp({ pool, report, progress: (message) => console.log(message) });
    report.hosting.postgresqlVersion = (await pool.query("SHOW server_version")).rows[0].server_version;
    report.hosting.databaseHost = database.hostname;
    report.hosting.databasePort = Number(database.port || 5432);
    report.hosting.databaseName = name;
  } catch (error) {
    failure = error;
    report.result = "failed"; report.capacityTargetMet = false;
    // Database/provider errors can embed connection details. Print only safe
    // assertions from this harness or a generic operational failure.
    console.error(error.code === "ERR_ASSERTION" ? error.message : "Load rehearsal setup, HTTP request, or database operation failed.");
  } finally {
    if (pool) await pool.end().catch(() => { report.result = "failed"; });
    if (owned) {
      try { await source.query(`DROP DATABASE "${name}" WITH (FORCE)`); report.cleanup.databaseDropped = true; }
      catch { report.result = "failed"; report.cleanup.databaseDropped = false; }
    }
    await source.end();
    if (!report.cleanup.databaseDropped) report.result = "failed";
    if (report.result !== "passed") report.capacityTargetMet = false;
    if (reportPath) { await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); }
    console.log(`LOAD_REHEARSAL_RESULT ${JSON.stringify(report)}`);
  }
  if (failure || report.result !== "passed") throw new Error("The load rehearsal did not pass with complete cleanup.");
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) { console.error(error.code === "ERR_ASSERTION" ? error.message : "Load rehearsal failed; verify the disposable local configuration and report."); process.exitCode = 1; }
}
