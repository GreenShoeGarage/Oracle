import assert from "node:assert/strict";
const origin = process.env.SMOKE_ORIGIN;
if (!origin)
  throw new Error("Set SMOKE_ORIGIN to the exact deployment origin.");
for (const path of [
  "/health/live",
  "/health/ready",
  "/api/session",
  "/",
  "/style.css",
  "/app.js",
  "/favicon.svg",
]) {
  const response = await fetch(new URL(path, origin), {
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200, `${path} must respond successfully`);
  if (path === "/health/ready") {
    const data = await response.json();
    assert.equal(data.status, "ready");
    assert.equal(data.version, "0.1.0");
  }
  console.log(`PASS ${path}`);
}
