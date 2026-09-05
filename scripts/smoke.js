import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { VERSION, SCHEMA_VERSION } from "../src/config.js";
const origin = process.env.SMOKE_ORIGIN;
if (!origin)
  throw new Error("Set SMOKE_ORIGIN to the exact deployment origin.");
assert.equal(new URL(origin).origin, origin, "SMOKE_ORIGIN must be an exact origin.");
if (process.env.SMOKE_WAIT_SECONDS !== undefined) {
  const waitSeconds = Number(process.env.SMOKE_WAIT_SECONDS);
  assert.ok(
    Number.isInteger(waitSeconds) && waitSeconds >= 1 && waitSeconds <= 300,
    "SMOKE_WAIT_SECONDS must be an integer from 1 to 300.",
  );
  const deadline = Date.now() + waitSeconds * 1000;
  let ready = false;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts++;
    try {
      const response = await fetch(new URL("/health/ready", origin), {
        redirect: "error",
        signal: AbortSignal.timeout(Math.max(1, Math.min(10000, deadline - Date.now()))),
      });
      if (response.ok) {
        const data = await response.json();
        if (
          data.status === "ready" && data.version === VERSION &&
          data.schemaVersion === SCHEMA_VERSION &&
          (!process.env.EXPECTED_COMMIT || data.deploymentCommit === process.env.EXPECTED_COMMIT)
        ) {
          ready = true;
          break;
        }
      }
    } catch {}
    if (attempts === 1 || attempts % 6 === 0)
      console.log(`Waiting for the expected public release (attempt ${attempts}).`);
    const remaining = deadline - Date.now();
    if (remaining > 0) await delay(Math.min(5000, remaining));
  }
  assert.ok(ready, "The expected public release did not become ready within the configured wait.");
  console.log("PASS public release is ready with the expected version, database schema, and commit");
}
for (const path of [
  "/health/live",
  "/health/ready",
  "/api/session",
  "/",
  "/style.css",
  "/app.js",
  "/builder.js",
  "/kit.js",
  "/themes.css",
  "/favicon.svg",
]) {
  const response = await fetch(new URL(path, origin), {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200, `${path} must respond successfully`);
  if (path === "/health/ready") {
    const data = await response.json();
    assert.equal(data.status, "ready");
    assert.equal(data.version, VERSION);
    assert.equal(data.schemaVersion, SCHEMA_VERSION);
    if (process.env.EXPECTED_COMMIT)
      assert.equal(data.deploymentCommit, process.env.EXPECTED_COMMIT);
  }
  if (path === "/api/session") {
    const data = await response.json();
    assert.equal(data.version, VERSION);
    assert.equal(data.user, null, "Public smoke must remain unauthenticated.");
    if (process.env.EXPECTED_ENVIRONMENT)
      assert.equal(data.environment, process.env.EXPECTED_ENVIRONMENT);
  }
  if (path.endsWith(".js"))
    assert.match(response.headers.get("content-type") || "", /^text\/javascript\b/);
  if (path.endsWith(".css"))
    assert.match(response.headers.get("content-type") || "", /^text\/css\b/);
  console.log(`PASS ${path}`);
}
