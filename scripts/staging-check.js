import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { VERSION, SCHEMA_VERSION } from "../src/config.js";
import { defaultSetup, THEMES } from "../public/kit.js";

// Account creation and event mutations are confined to this disposable environment.
// The production mode below imports only the read-only public smoke checks.
const STAGING_ORIGIN = "https://oracle-production-488d.up.railway.app";
const publicOnly = process.argv.includes("--public-only");

if (publicOnly) {
  await import("./smoke.js");
} else {
  const origin = process.env.SMOKE_ORIGIN || STAGING_ORIGIN;
  assert.equal(origin, STAGING_ORIGIN, "Authenticated checks require the allowlisted staging origin.");
  const expectedCommit = process.env.GITHUB_SHA || process.env.EXPECTED_COMMIT;
  if (expectedCommit)
    assert.match(expectedCommit, /^[0-9a-f]{40}$/, "Expected deployment commit must be a full Git commit SHA.");
  const accounts = [];
  const ownedEvents = [];
  const runId = randomUUID();
  const secretMarker = `Organizer-only staging marker ${runId}`;
  const publicMarker = `Public staging marker ${runId}`;
  const pass = (message) => console.log(`PASS ${message}`);

  async function request(account, path, { method = "GET", body, status = 200 } = {}) {
    const headers = { Accept: "application/json" };
    if (account?.cookie) headers.Cookie = account.cookie;
    if (method !== "GET") {
      headers.Origin = origin;
      headers["Content-Type"] = "application/json";
    }
    const response = await fetch(new URL(path, origin), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, status, `${method} ${path} must return HTTP ${status}.`);
    const cookie = response.headers.get("set-cookie");
    if (account && cookie) {
      assert.ok(
        cookie.startsWith("__Host-oracle_session=") &&
        cookie.includes("; Secure") && cookie.includes("; HttpOnly") &&
        cookie.includes("; Path=/") && cookie.includes("; SameSite=Lax") &&
        !/;\s*Domain=/i.test(cookie),
        "Staging sessions must use secure, host-only cookies.",
      );
      account.cookie = cookie.split(";", 1)[0];
    }
    if (status === 204) return null;
    return response.json();
  }

  async function waitForRelease() {
    const deadline = Date.now() + 300000;
    let attempts = 0;
    while (Date.now() < deadline) {
      attempts++;
      try {
        const response = await fetch(new URL("/health/ready", origin), {
          redirect: "error",
          signal: AbortSignal.timeout(Math.min(10000, deadline - Date.now())),
        });
        if (response.ok) {
          const health = await response.json();
          if (
            health.status === "ready" &&
            health.version === VERSION &&
            health.schemaVersion === SCHEMA_VERSION &&
            (!expectedCommit || health.deploymentCommit === expectedCommit)
          ) {
            pass("staging is ready with the expected version, database schema, and commit");
            return;
          }
        }
      } catch {}
      if (attempts === 1 || attempts % 6 === 0)
        console.log(`Waiting for the expected staging release (attempt ${attempts}).`);
      const remaining = deadline - Date.now();
      if (remaining > 0) await delay(Math.min(5000, remaining));
    }
    throw new Error("The expected staging release did not become ready within five minutes.");
  }

  async function register(label) {
    const account = {
      email: `oracle-ci-${label.toLowerCase()}-${runId}@example.invalid`,
      password: randomBytes(32).toString("base64url"),
      cookie: null,
    };
    accounts.push(account);
    const result = await request(account, "/api/auth/register", {
      method: "POST",
      body: { displayName: `Staging check ${label}`, email: account.email, password: account.password },
      status: 201,
    });
    account.id = result.user.id;
    assert.ok(account.cookie?.startsWith("__Host-oracle_session="), "Staging must issue a production session cookie.");
    return account;
  }

  async function createEvent(account, name, setup) {
    const { event } = await request(account, "/api/events", {
      method: "POST", body: { name, setup }, status: 201,
    });
    ownedEvents.push({ account, id: event.id });
    return event;
  }

  async function patchEvent(account, event, changes) {
    return (await request(account, `/api/events/${event.id}`, {
      method: "PATCH", body: { version: event.version, ...changes },
    })).event;
  }

  function noSecrets(value, label) {
    assert.ok(!JSON.stringify(value).includes(secretMarker), `${label} must exclude organizer secrets.`);
  }

  async function cleanup() {
    let failed = false;
    for (const { account, id } of ownedEvents) {
      try {
        let { event } = await request(account, `/api/events/${id}`);
        const next = { draft: "rehearsal", rehearsal: "live", live: "ended", paused: "ended", ended: "archived" };
        while (event.status !== "archived") {
          assert.ok(next[event.status], "Cleanup requires a known event lifecycle state.");
          event = await patchEvent(account, event, { status: next[event.status] });
        }
      } catch {
        failed = true;
        console.warn("A staging check event could not be archived; its account remains private.");
      }
    }
    for (const account of accounts) {
      if (!account.cookie) continue;
      try {
        await request(account, "/api/auth/logout", { method: "POST", body: {}, status: 204 });
        account.cookie = null;
      } catch {
        failed = true;
        console.warn("A staging check session could not be signed out; it will expire normally.");
      }
    }
    if (!failed && ownedEvents.length) pass("check events archived and sessions signed out");
  }

  try {
    await waitForRelease();
    process.env.SMOKE_ORIGIN = origin;
    process.env.EXPECTED_ENVIRONMENT = "staging";
    if (expectedCommit) process.env.EXPECTED_COMMIT = expectedCommit;
    await import("./smoke.js");
    const owner = await register("Organizer");
    const player = await register("Player");
    pass("two accounts registered using the configured staging origin");

    const setup = defaultSetup("fantasy", "council");
    // The records below deliberately exercise both content audience boundaries.
    setup.content.push(
      { id: "ci-private", title: "Organizer staging note", body: secretMarker, visibility: "organizer", prop: false },
      { id: "ci-public", title: "Public staging notice", body: publicMarker, visibility: "player", prop: true },
    );
    let event = await createEvent(owner, `CI field kit ${runId}`, setup);
    const isolated = await createEvent(player, `CI isolated event ${runId}`, defaultSetup());
    await request(player, `/api/events/${event.id}`, { status: 404 });
    await request(owner, `/api/events/${isolated.id}`, { status: 404 });
    pass("events are isolated between accounts");

    const { invitation } = await request(owner, `/api/events/${event.id}/invites`, {
      method: "POST", body: { role: "player", maxUses: 1, expiresInHours: 1 }, status: 201,
    });
    const joined = await request(player, "/api/events/join", {
      method: "POST", body: { code: invitation.code },
    });
    assert.equal(joined.event.role, "player", "Invitation must grant the requested player role.");
    noSecrets(joined, "Joined event response");
    noSecrets(await request(player, `/api/events/${event.id}`), "Player event detail");
    noSecrets(await request(player, "/api/events"), "Player event list");
    await request(player, `/api/events/${event.id}`, {
      method: "PATCH", body: { version: event.version, theme: THEMES.find((theme) => theme.id === "cyberpunk") }, status: 403,
    });
    await request(player, `/api/events/${event.id}/pack?audience=organizer`, { status: 403 });
    pass("invitation join preserves player permissions and hides organizer content");

    for (const audience of ["player", "prop"]) {
      const preview = await request(owner, `/api/events/${event.id}/preview?audience=${audience}`);
      assert.equal(preview.readOnly, true, "Audience previews must be read-only.");
      assert.equal(preview.audience, audience, "Preview must use the requested audience.");
      noSecrets(preview, `${audience} preview`);
      assert.ok(JSON.stringify(preview).includes(publicMarker), "Preview must include its public record.");
      assert.ok(!Object.hasOwn(preview.event, "role") && !Object.hasOwn(preview, "members"), "Preview must omit organizer controls and membership details.");
    }
    pass("player and prop previews show public content without organizer secrets");

    const mechanics = structuredClone({ rules: event.setup.rules, content: event.setup.content });
    for (const theme of THEMES) {
      event = await patchEvent(owner, event, { theme });
      assert.ok(isDeepStrictEqual(event.setup.theme, theme), "Theme selection must persist.");
      assert.ok(isDeepStrictEqual({ rules: event.setup.rules, content: event.setup.content }, mechanics), "Theme changes must preserve rules and content.");
    }
    pass("all themes switch while preserving game rules and content");

    const pack = await request(owner, `/api/events/${event.id}/pack?audience=organizer`);
    assert.ok(JSON.stringify(pack).includes(secretMarker), "Organizer pack must preserve organizer content.");
    const imported = await request(owner, "/api/events/import", { method: "POST", body: { pack }, status: 201 });
    ownedEvents.push({ account: owner, id: imported.event.id });
    assert.notEqual(imported.event.id, event.id, "Pack import must create a separate event.");
    assert.equal(imported.event.status, "draft", "Pack import must start in draft.");
    assert.ok(isDeepStrictEqual(imported.event.setup, event.setup), "Pack import must preserve all setup values and content IDs.");
    const importedDetail = await request(owner, `/api/events/${imported.event.id}`);
    assert.equal(importedDetail.members.length, 1, "Pack import must not copy event memberships.");
    noSecrets(await request(player, `/api/events/${event.id}/pack?audience=player`), "Player event pack");
    pass("organizer pack round-trip creates a new draft; player export excludes secrets");

    const previousVersion = event.version;
    event = await patchEvent(owner, event, { description: "Saved staging workflow verification." });
    await request(owner, `/api/events/${event.id}`, {
      method: "PATCH", body: { version: previousVersion, description: "This stale write must fail." }, status: 409,
    });
    const savedSetup = structuredClone(event.setup);
    await request(owner, "/api/auth/logout", { method: "POST", body: {}, status: 204 });
    owner.cookie = null;
    await request(owner, "/api/auth/login", {
      method: "POST", body: { email: owner.email, password: owner.password },
    });
    const persisted = await request(owner, `/api/events/${event.id}`);
    assert.ok(isDeepStrictEqual(persisted.event.setup, savedSetup), "Saved setup must persist after signing back in.");
    assert.equal(persisted.event.description, "Saved staging workflow verification.", "Stale writes must not overwrite the saved event.");
    pass("stale writes are rejected and setup persists after a fresh sign-in");

    await request(owner, `/api/events/${event.id}/members/${player.id}`, { method: "DELETE" });
    await request(player, `/api/events/${event.id}`, { status: 404 });
    await request(player, `/api/events/${event.id}/pack?audience=player`, { status: 404 });
    await request(player, `/api/events/${event.id}/preview?audience=player`, { status: 404 });
    pass("membership revocation immediately removes detail, export, and preview access");
  } catch (error) {
    // Every assertion above uses an explicit message; never dump request bodies,
    // response payloads, passwords, invitation codes, or session cookies into CI.
    console.error(`FAIL staging workflow: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}
