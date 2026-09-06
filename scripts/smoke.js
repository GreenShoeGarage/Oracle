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
  "/robots.txt",
  "/sitemap.xml",
  "/style.css",
  "/landing.css",
  "/display.js",
  "/startup.js",
  "/preparation-model.js",
  "/app.js",
  "/builder.js",
  "/characters-ui.js",
  "/adventure-model.js",
  "/adventure-player.js",
  "/adventure-organizer.js",
  "/adventure.css",
  "/adventure-organizer.css",
  "/offline.js",
  "/connection.js",
  "/field-store.js",
  "/field-sync.js",
  "/field-ui.js",
  "/field.css",
  "/guide-ui.js",
  "/guide.css",
  "/help.html",
  "/help.css",
  "/install.js",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
  "/app-icon.svg",
  "/prop-code.js",
  "/sw.js",
  "/exchange-model.js",
  "/exchange-code.js",
  "/exchanges-ui.js",
  "/exchanges.css",
  "/sharing-ui.js",
  "/sharing.css",
  "/story-model.js",
  "/story-ui.js",
  "/story.css",
  "/trace-model.js",
  "/trace-ui.js",
  "/trace.css",
  "/economy-model.js",
  "/economy-ui.js",
  "/economy.css",
  "/oath-model.js",
  "/oath-ui.js",
  "/oath.css",
  "/sigil-model.js",
  "/sigil-ui.js",
  "/sigil.css",
  "/static-model.js",
  "/static-ui.js",
  "/static.css",
  "/stagehand-model.js",
  "/stagehand-ui.js",
  "/stagehand-manage.js",
  "/stagehand.css",
  "/prop-effects.js",
  "/props.css",
  "/instrument-code.js",
  "/characters-model.js",
  "/characters.css",
  "/admin-ui.js",
  "/qr.js",
  "/vendor/qrcode-generator-2.0.4.js",
  "/vendor/jsqr-1.4.0.js",
  "/kit.js",
  "/themes.css",
  "/favicon.svg",
]) {
  const response = await fetch(new URL(path, origin), {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200, `${path} must respond successfully`);
  if (!path.startsWith("/health/") && !path.startsWith("/api/"))
    assert.equal(response.headers.get("x-oracle-shell-version"), VERSION, `${path} must belong to this complete shell version`);
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
  if (path === "/robots.txt") {
    const robots = await response.text();
    assert.match(robots, /User-agent: \*/);
    if (process.env.EXPECTED_ENVIRONMENT === "production") assert.ok(robots.includes(`Sitemap: ${origin}/sitemap.xml`));
  }
  if (path === "/sitemap.xml") {
    const sitemap = await response.text();
    assert.match(response.headers.get("content-type") || "", /^application\/xml\b/);
    if (process.env.EXPECTED_ENVIRONMENT === "production") assert.ok(sitemap.includes(`<loc>${origin}/help.html</loc>`));
  }
  if (path.endsWith(".css"))
    assert.match(response.headers.get("content-type") || "", /^text\/css\b/);
  if (path.endsWith(".png")) {
    assert.equal(response.headers.get("content-type"), "image/png");
    const png = Buffer.from(await response.arrayBuffer());
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  }
  if (path === "/manifest.webmanifest") {
    assert.match(response.headers.get("content-type") || "", /^application\/manifest\+json\b/);
    const manifest = await response.json();
    assert.equal(manifest.start_url, "/"); assert.equal(manifest.scope, "/");
    assert.equal(manifest.display, "standalone"); assert.match(manifest.name, /ORACLE/);
  }
  console.log(`PASS ${path}`);
}
