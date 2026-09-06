import test from "node:test";
import assert from "node:assert/strict";
import { loadConfiguration, summarizeSamples, rehearseHttp, LOAD_TARGET } from "../scripts/load-rehearsal.js";
import { testDatabase } from "./database.js";
import { migrate } from "../src/db.js";

test("load rehearsal rejects production, remote hosts and URL option overrides before connecting", () => {
  const base = { TEST_DATABASE_URL: "postgresql://oracle:disposable@127.0.0.1:5432/oracle_test" };
  assert.equal(LOAD_TARGET, 100);
  assert.equal(loadConfiguration(base, []).database.hostname, "127.0.0.1");
  for (const env of [{}, { ...base, NODE_ENV: "production" }, { ...base, APP_ENV: "production" }, { ...base, SMOKE_ORIGIN: "https://oracle.greenshoegarage.com" }, { ...base, LOAD_ORIGIN: "http://127.0.0.1:3000" }, ...["postgresql://localhost/production", "postgresql://remote.example/oracle_test", "https://127.0.0.1/oracle_test", "postgresql://127.0.0.1/oracle_test?host=remote.example", "postgresql://127.0.0.1/oracle_test#anything"].map((TEST_DATABASE_URL) => ({ TEST_DATABASE_URL }))]) assert.throws(() => loadConfiguration(env, []));
  for (const args of [["--origin=https://oracle.greenshoegarage.com"], ["--players=1000"], ["--report="]]) assert.throws(() => loadConfiguration(base, args));
});

test("load summaries retain failed and timed-out requests in percentiles and counts", () => {
  const sample = Array.from({ length: 100 }, (_, index) => ({ durationMs: index + 1, status: index === 99 ? "timeout" : index === 98 ? 503 : 200, ok: index < 98 }));
  assert.deepEqual(summarizeSamples(sample), { requests: 100, errors: 2, timeouts: 1, p50Ms: 50, p95Ms: 95, maxMs: 100, statuses: { 200: 98, 503: 1, timeout: 1 } });
  assert.equal(summarizeSamples([]).p95Ms, null);
});

test("rehearsal public HTTP lifecycle verifies replay, privacy, inventory and cleanup with a small non-capacity cohort", { timeout: 60000 }, async () => {
  const database = await testDatabase();
  try {
    await migrate(database.pool);
    const result = await rehearseHttp({ pool: database.pool, players: 2, databaseKind: database.kind });
    assert.equal(result.result, "passed");
    assert.equal(result.capacityTargetMet, false);
    assert.equal(result.measurement.requests, 36);
    assert.equal(result.measurement.errors, 0);
    assert.equal(result.measurement.peakPlayerConnections, 2);
    assert.deepEqual(result.hosting.observedClientAddresses, ["127.0.0.2", "127.0.0.3"]);
    assert.equal(result.integrity.idempotencyReceipts, 2);
    assert.equal(result.integrity.crossAccountReadsRejected, 2);
    assert.equal(result.cleanup.eventArchived, true);
    assert.equal(result.cleanup.sessionsSignedOut, 3);
    assert.equal(result.cleanup.serverClosed, true);
    assert.equal((await database.pool.query("SELECT count(*)::int AS n FROM sessions")).rows[0].n, 0);
    assert.equal((await database.pool.query("SELECT status FROM events")).rows[0].status, "archived");
  } finally { await database.close(); }
});
