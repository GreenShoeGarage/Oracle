import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { createPool, migrate } from "../src/db.js";
import { readConfig } from "../src/config.js";
const config = readConfig();
const database = new URL(config.databaseUrl).pathname.slice(1);
if (!database.startsWith("oracle_test"))
  throw new Error("Startup checks require an isolated oracle_test* database.");
const pool = createPool(config);
try {
  await migrate(pool);
} finally {
  await pool.end();
}
const child = spawn(process.execPath, ["src/server.js"], {
  env: process.env,
  stdio: "inherit",
});
try {
  let ready = false;
  for (let n = 0; n < 40; n++) {
    if (child.exitCode !== null)
      throw new Error("Server exited before becoming ready.");
    try {
      const r = await fetch(`${config.origin}/health/ready`, {
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(250);
  }
  assert.ok(ready, "Server must become ready.");
  for (const path of [
    "/health/live",
    "/health/ready",
    "/api/session",
    "/",
    "/app.js",
    "/style.css",
    "/favicon.svg",
  ])
    assert.equal((await fetch(`${config.origin}${path}`)).status, 200, path);
  console.log(
    "Startup, database readiness, session API and public assets passed.",
  );
} finally {
  let deadline;
  const closed =
    child.exitCode !== null
      ? Promise.resolve({ code: child.exitCode, signal: child.signalCode })
      : new Promise((resolve) =>
          child.once("exit", (code, signal) => resolve({ code, signal })),
        );
  child.kill("SIGTERM");
  try {
    const result = await Promise.race([
      closed,
      new Promise((_, reject) => {
        deadline = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("Graceful shutdown timed out."));
        }, 15000);
      }),
    ]);
    assert.equal(result.code, 0, "Server must exit cleanly after SIGTERM.");
    assert.equal(
      result.signal,
      null,
      "Server must drain rather than be terminated by a signal.",
    );
  } finally {
    clearTimeout(deadline);
  }
}
