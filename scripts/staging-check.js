import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { VERSION, SCHEMA_VERSION } from "../src/config.js";
import { defaultSetup, THEMES } from "../public/kit.js";
import { defaultCharacterProfile } from "../public/characters-model.js";

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
    const safePath = path.replace(/([?&]code=)[^&]*/g, "$1[redacted]").replace(/(\/api\/badges\/)[^/?]+/, "$1[redacted]");
    assert.equal(response.status, status, `${method} ${safePath} must return HTTP ${status}.`);
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

  async function characterJourney(owner, player, event, targetEvent) {
    const base = `/api/events/${event.id}`;
    const { settings: initialSettings } = await request(owner, `${base}/character-settings`);
    const { settings } = await request(owner, `${base}/character-settings`, {
      method: "PUT",
      body: { ...initialSettings, requireApproval: true, maxPerPlayer: 2, publicFields: ["pronouns", "faction"] },
    });
    assert.equal(settings.requireApproval, true, "Character approval must be enabled.");
    const { faction } = await request(owner, `${base}/factions`, {
      method: "POST", body: { name: "Staging Lantern Guild", description: "A fictional faction used for verification." }, status: 201,
    });
    const profile = (name) => ({
      ...defaultCharacterProfile(event.setup.rules), name, pronouns: "they/them", factionId: faction.id,
      biography: "A fictional traveller with a private backstory.",
      skills: event.setup.rules.expertise.slice(0, 1).map((skill) => skill.id),
      privateObjectives: `Private character objective ${runId}`,
      startingEquipment: [{ name: "Staging lantern", quantity: 2, notes: "Private inventory note." }],
    });
    const ownerProfile = profile("Staging Keeper");
    const playerProfile = profile("Staging Traveller");
    const attribute = event.setup.rules.attributes[0];
    if (attribute) playerProfile.attributes[attribute.id] = attribute.default === attribute.max ? attribute.min : attribute.max;
    let ownerCharacter = (await request(owner, `${base}/characters`, {
      method: "POST", body: { profile: ownerProfile, userId: owner.id }, status: 201,
    })).character;
    let playerCharacter = (await request(player, `${base}/characters`, {
      method: "POST", body: { profile: playerProfile }, status: 201,
    })).character;
    const action = async (account, character, verb, extra = {}, status = 200) => request(account, `${base}/characters/${character.id}/${verb}`, {
      method: "POST", body: { version: character.version, ...extra }, status,
    });
    await request(player, `/api/badges/${ownerCharacter.badgeCode}`, { status: 404 });
    ownerCharacter = (await action(owner, ownerCharacter, "submit")).character;
    playerCharacter = (await action(player, playerCharacter, "submit")).character;
    assert.equal(playerCharacter.status, "pending", "Player submission must await organizer approval.");
    await action(player, playerCharacter, "review", { decision: "approve", feedback: "Must not apply." }, 403);
    await action(player, playerCharacter, "assign", { userId: owner.id }, 403);
    ownerCharacter = (await action(owner, ownerCharacter, "review", { decision: "approve", feedback: "Private organizer review." })).character;
    playerCharacter = (await action(owner, playerCharacter, "review", { decision: "approve", feedback: "Private organizer review." })).character;
    assert.equal(ownerCharacter.status, "approved", "Organizer review must approve the first character.");
    assert.equal(playerCharacter.status, "approved", "Organizer review must approve the second character.");
    pass("two enrolled accounts create, submit, and receive organizer approval for characters");

    const badge = await request(player, `/api/badges/${ownerCharacter.badgeCode}`);
    assert.equal(badge.character.id, ownerCharacter.id, "Badge lookup must identify the intended character.");
    assert.equal(badge.character.visibility, "public", "Badge lookup must use the public character projection.");
    assert.deepEqual(Object.keys(badge.character.profile).sort(), ["faction", "name", "pronouns"], "Badges expose only the organizer's allowed public profile fields.");
    assert.equal(badge.character.profile.faction.name, faction.name, "Badge lookup must resolve the event's faction.");
    for (const field of ["badgeCode", "userId", "reviewNotes", "inventory", "inventoryInitialized", "version"])
      assert.ok(!Object.hasOwn(badge.character, field), `Public badge must omit ${field}.`);
    const badgeText = JSON.stringify(badge);
    for (const privateValue of [owner.email, player.email, ownerProfile.privateObjectives, ownerProfile.biography, "Private organizer review.", "Private inventory note."])
      assert.ok(!badgeText.includes(privateValue), "Public badge response must omit private account and character content.");
    await request(null, `/api/badges/${ownerCharacter.badgeCode}`, { status: 401 });
    await request(player, `${base}/characters/${ownerCharacter.id}`, {
      method: "PATCH", body: { version: ownerCharacter.version, profile: { ...ownerProfile, name: "Must not persist" } }, status: 403,
    });
    await request(player, `/api/events/${targetEvent.id}/characters/${ownerCharacter.id}`, { status: 404 });
    const previousBadge = ownerCharacter.badgeCode;
    ownerCharacter = (await action(owner, ownerCharacter, "badge")).character;
    assert.notEqual(ownerCharacter.badgeCode, previousBadge, "Rotating a badge must replace its lookup identifier.");
    await request(player, `/api/badges/${previousBadge}`, { status: 404 });
    await request(player, `/api/badges/${ownerCharacter.badgeCode}`);
    pass("badge lookups enforce event membership, privacy, ownership, and immediate rotation");

    const inventoryPath = `${base}/characters/${playerCharacter.id}/inventory`;
    const { inventory: initialInventory } = await request(player, inventoryPath);
    assert.equal(initialInventory.length, 1, "First approval must initialize one starting inventory item.");
    assert.equal(initialInventory[0].quantity, 2, "Starting inventory quantity must be preserved.");
    await request(player, inventoryPath, { method: "POST", body: { name: "Forged item", quantity: 9, notes: "" }, status: 403 });
    await request(owner, `${inventoryPath}/${initialInventory[0].id}`, {
      method: "PATCH", body: { version: initialInventory[0].version, name: initialInventory[0].name, quantity: 1, notes: initialInventory[0].notes },
    });
    playerCharacter = (await request(player, `${base}/characters/${playerCharacter.id}`)).character;
    playerCharacter = (await request(player, `${base}/characters/${playerCharacter.id}`, {
      method: "PATCH", body: { version: playerCharacter.version, profile: { ...playerProfile, name: "Revised Staging Traveller" } },
    })).character;
    playerCharacter = (await action(player, playerCharacter, "submit")).character;
    playerCharacter = (await action(owner, playerCharacter, "review", { decision: "approve", feedback: "Revision accepted." })).character;
    const { inventory: retainedInventory } = await request(player, inventoryPath);
    assert.equal(retainedInventory.length, 1, "Reapproval must not duplicate starting inventory.");
    assert.equal(retainedInventory[0].id, initialInventory[0].id, "Reapproval must retain the existing inventory record.");
    assert.equal(retainedInventory[0].quantity, 1, "Reapproval must not refill inventory consumed by an organizer.");
    pass("approved inventory is organizer-controlled and reapproval preserves current quantities");

    const copied = (await request(player, `${base}/characters/${playerCharacter.id}/copy`, {
      method: "POST", body: { targetEventId: targetEvent.id }, status: 201,
    })).character;
    assert.equal(copied.eventId, targetEvent.id, "Character copies must belong to the selected destination event.");
    assert.equal(copied.userId, player.id, "Character copies must belong to their requesting player.");
    assert.equal(copied.status, "draft", "Cross-event copies must start as draft characters.");
    assert.notEqual(copied.id, playerCharacter.id, "Copies must have a new character identifier.");
    assert.notEqual(copied.badgeCode, playerCharacter.badgeCode, "Copies must have a new badge identifier.");
    assert.deepEqual(copied.profile.attributes, defaultCharacterProfile(targetEvent.setup.rules).attributes, "Copies must use destination rules defaults.");
    assert.equal(copied.profile.privateObjectives, "", "Copies must not carry private objectives into another event.");
    assert.equal(copied.profile.factionId, null, "Copies must not retain source-event factions.");
    assert.deepEqual(copied.profile.startingEquipment, [], "Copies must not transfer starting equipment.");
    assert.deepEqual(copied.profile.skills, [], "Copies must not transfer source-event skills.");
    assert.equal(copied.reviewNotes, "", "Copies must not transfer organizer review notes.");
    assert.equal(copied.inventoryInitialized, false, "Copied draft inventory must await destination approval.");
    assert.deepEqual((await request(player, `/api/events/${targetEvent.id}/characters/${copied.id}/inventory`)).inventory, [], "Copies must not carry inventory into another event.");
    await request(owner, `/api/badges/${copied.badgeCode}`, { status: 404 });
    pass("cross-event character copies reset approval, private objectives, equipment, faction, and rules");

    let prewritten = (await request(owner, `${base}/characters`, {
      method: "POST", body: { profile: profile("Staging Prewritten Role"), userId: null }, status: 201,
    })).character;
    assert.equal(prewritten.userId, null, "Prewritten characters may be prepared without an assigned player.");
    prewritten = (await action(owner, prewritten, "assign", { userId: player.id })).character;
    assert.equal(prewritten.userId, player.id, "Organizers must be able to assign a prewritten character to an enrolled player.");
    const { characters: playerCharacters } = await request(player, `${base}/characters`);
    assert.ok(playerCharacters.some((character) => character.id === prewritten.id && character.visibility === "private"), "An assigned player must receive their private prewritten sheet.");
    const invalidProfile = { ...prewritten.profile, attributes: { ...prewritten.profile.attributes, unexpectedAttribute: 99 } };
    await request(player, `${base}/characters/${prewritten.id}`, {
      method: "PATCH", body: { version: prewritten.version, profile: invalidProfile }, status: 400,
    });
    await request(player, `${base}/characters/${prewritten.id}`, {
      method: "PATCH", body: { version: prewritten.version, profile: { ...prewritten.profile, privateObjectives: "<script>bad input</script>" } }, status: 400,
    });
    const unchanged = (await request(player, `${base}/characters/${prewritten.id}`)).character;
    assert.equal(unchanged.version, prewritten.version, "Malformed writes must not advance the character version.");
    assert.ok(isDeepStrictEqual(unchanged.profile, prewritten.profile), "Malformed writes must not change the saved character profile.");
    pass("prewritten assignment works and malformed character writes leave saved data intact");
    return ownerCharacter;
  }

  function noSecrets(value, label) {
    assert.ok(!JSON.stringify(value).includes(secretMarker), `${label} must exclude organizer secrets.`);
  }

  function safeAdventure(snapshot, definition, { initial = false } = {}) {
    assert.ok(Array.isArray(snapshot.nodes) && Array.isArray(snapshot.journal), "Adventure play must include projected nodes and a private journal.");
    const forbidden = new Set(["definition", "organizerNotes", "conditions", "actions", "flags", "answer", "releaseCode", "code", "userId", "email", "password_hash", "token_hash"]);
    const inspect = (value) => {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        assert.ok(!forbidden.has(key), "Adventure play must omit server rules, answers, codes, and account data.");
        inspect(child);
      }
    };
    inspect(snapshot);
    const serialized = JSON.stringify(snapshot);
    if (definition.organizerNotes) assert.ok(!serialized.includes(definition.organizerNotes), "Organizer notes must never enter a player snapshot.");
    if (initial) {
      assert.equal(snapshot.journal.length, 0, "A newly assigned player must begin with an empty journal.");
      for (const node of definition.nodes) {
        const protectedTexts = node.type === "relic" ? node.examinations.map((exam) => exam.text)
          : node.type === "dead_drop" ? [node.body]
          : node.type === "cipherbox" ? [node.successText, node.failureText, ...node.hints.map((hint) => hint.text)] : [];
        for (const value of protectedTexts.filter(Boolean)) assert.ok(!serialized.includes(value), "Unreleased readings, messages, hints, and puzzle outcomes must remain hidden.");
      }
    }
    for (const node of snapshot.nodes.filter((entry) => entry.locked))
      assert.ok(Object.keys(node).every((key) => ["id", "type", "title", "summary", "locked", "lockReason", "completed", "failed", "joined"].includes(key)), "Locked instruments must expose only their public summary and the player's own attendance state.");
  }

  async function adventureJourney(owner, player) {
    const catalog = await request(owner, "/api/adventure-templates");
    assert.deepEqual(catalog.templates.map((template) => template.id).sort(), ["cyberpunk", "fantasy", "wasteland"], "All three complete starter adventures must be available.");
    for (const template of catalog.templates)
      assert.ok(Object.keys(template).every((key) => ["id", "title", "summary", "durationMinutes", "players"].includes(key)), "Starter catalog must contain metadata only.");
    await request(null, "/api/adventure-templates", { status: 401 });
    const completedSources = [];
    for (const theme of ["fantasy", "cyberpunk", "wasteland"]) {
      let { event } = await request(owner, `/api/adventure-templates/${theme}`, {
        method: "POST", body: { name: `CI ${theme} adventure ${runId}` }, status: 201,
      });
      ownedEvents.push({ account: owner, id: event.id });
      assert.equal(event.status, "draft", "Starter adventures must be created as fresh draft events.");
      assert.equal(event.setup.theme.id, theme, "Starter adventure must use the selected theme.");
      const base = `/api/events/${event.id}/adventure`;
      await request(player, `${base}/manage`, { status: 404 });
      const { invitation } = await request(owner, `/api/events/${event.id}/invites`, {
        method: "POST", body: { role: "player", maxUses: 1, expiresInHours: 1 }, status: 201,
      });
      await request(player, "/api/events/join", { method: "POST", body: { code: invitation.code } });
      await request(player, `${base}/manage`, { status: 403 });
      const { characters } = await request(owner, `/api/events/${event.id}/characters`);
      assert.equal(characters.length, 2, "Every complete starter must provide two prewritten characters.");
      for (const character of characters) {
        assert.equal(character.status, "approved", "Prewritten starter characters must be ready to assign and play.");
        assert.equal(character.userId, null, "Starter characters must not inherit another event's ownership.");
      }
      const assigned = [];
      for (const [index, account] of [owner, player].entries()) {
        const { character } = await request(owner, `/api/events/${event.id}/characters/${characters[index].id}/assign`, {
          method: "POST", body: { version: characters[index].version, userId: account.id },
        });
        assigned.push({ account, character });
      }
      const manage = await request(owner, `${base}/manage`);
      const { definition, version } = manage;
      const relic = definition.nodes.find((node) => node.id === "evidence-core");
      const message = definition.nodes.find((node) => node.id === "sealed-message");
      const puzzle = definition.nodes.find((node) => node.id === "restoration-console");
      const scene = definition.nodes.find((node) => node.id === "community-gathering");
      const alternate = definition.nodes.find((node) => node.id === "manual-watch");
      assert.ok(relic && message && puzzle && scene && alternate, "Every starter must include the complete investigation and fallback scene.");
      const exam = relic.examinations.find((entry) => entry.id === "read-markings");
      assert.ok(exam, "Every starter must offer its ungated opening examination.");
      const playPath = (character) => `${base}/play?characterId=${character.id}`;
      const act = (account, character, node, kind, fields = {}, { requestId = randomUUID(), status = 200 } = {}) => request(account, `${base}/action`, {
        method: "POST", body: { requestId, version, characterId: character.id, nodeId: node.id, kind, ...fields }, status,
      });
      for (const { account, character } of assigned) safeAdventure(await request(account, playPath(character)), definition, { initial: true });
      const preview = await request(owner, `${playPath(assigned[1].character)}&preview=true`);
      assert.equal(preview.readOnly, true, "Organizer simulations must be read-only.");
      assert.equal(preview.preview, true, "Organizer simulations must identify their preview state.");
      assert.equal(preview.journal.length, 0, "Preview must not create progress or journal entries.");
      await request(null, playPath(assigned[0].character), { status: 401 });
      await request(null, `${base}/lookup?characterId=${assigned[0].character.id}&code=${relic.code}`, { status: 401 });
      await request(player, playPath(assigned[0].character), { status: 404 });
      await request(player, `${base}/override`, {
        method: "POST", body: { requestId: randomUUID(), version, characterId: assigned[1].character.id, nodeId: puzzle.id, kind: "solve" }, status: 403,
      });
      event = await patchEvent(owner, event, { status: "rehearsal" });
      let firstRequest;
      for (const [index, { account, character }] of assigned.entries()) {
        if (index === 1) event = await patchEvent(owner, event, { status: "live" });
        safeAdventure(await request(account, playPath(character)), definition, { initial: true });
        await act(account, character, message, "open", { code: message.releaseCode }, { status: 403 });
        const lookedUp = await request(account, `${base}/lookup?characterId=${character.id}&code=${relic.code}`);
        assert.equal(lookedUp.focusNodeId, relic.id, "Printed prop lookup must focus the correct instrument.");
        safeAdventure(lookedUp, definition, { initial: true });
        const requestId = randomUUID();
        let played = await act(account, character, relic, "examine", { examId: exam.id, code: relic.code }, { requestId });
        assert.ok(played.journal.some((entry) => entry.nodeId === relic.id && entry.text === exam.text), "Authorized examination must persist its actual reading in the private journal.");
        const replay = await act(account, character, relic, "examine", { examId: exam.id, code: relic.code }, { requestId });
        assert.equal(replay.outcome.replayed, true, "An exact action retry must be recognized as a replay.");
        assert.ok(isDeepStrictEqual(replay.journal, played.journal), "An exact action retry must not duplicate journal entries.");
        await act(account, character, relic, "examine", { examId: exam.id, code: "AAAAAAAAAAAAAAAAAAAA" }, { requestId, status: 409 });
        const repeated = await act(account, character, relic, "examine", { examId: exam.id, code: relic.code });
        assert.ok(isDeepStrictEqual(repeated.journal, played.journal), "Repeating a completed examination under a new request ID must not duplicate its reward.");
        if (index === 0) firstRequest = { requestId, character, account };
        played = await act(account, character, message, "open", { code: message.releaseCode });
        assert.ok(played.journal.some((entry) => entry.nodeId === message.id && entry.text === message.body), "Opening a released message must persist its permitted contents.");
        if (index === 1) {
          const wrongAnswer = `incorrect-${randomUUID()}`;
          for (let attempt = 0; attempt < puzzle.maxAttempts; attempt++) {
            if (attempt > 0) await delay(1100);
            played = await act(account, character, puzzle, "attempt", { answer: wrongAnswer });
          }
          assert.equal(played.nodes.find((node) => node.id === puzzle.id).failed, true, "Exhausted puzzle attempts must enter the declared failure state.");
          assert.equal(played.nodes.find((node) => node.id === alternate.id).locked, false, "The declared failure outcome must unlock the fallback scene.");
          played = await act(account, character, alternate, "join");
          assert.ok(played.journal.some((entry) => entry.nodeId === alternate.id), "The fallback scene must create a durable journal entry.");
          const overridden = await request(owner, `${base}/override`, {
            method: "POST", body: { requestId: randomUUID(), version, characterId: character.id, nodeId: puzzle.id, kind: "reset_attempts" },
          });
          assert.equal(overridden.nodes.find((node) => node.id === puzzle.id).failed, false, "An organizer may explicitly reset exhausted attempts.");
          assert.equal(overridden.nodes.find((node) => node.id === puzzle.id).attempts, 0, "An explicit organizer reset must clear the attempt count.");
          played = await request(owner, `${base}/override`, {
            method: "POST", body: { requestId: randomUUID(), version, characterId: character.id, nodeId: puzzle.id, kind: "solve" },
          });
        } else {
          const availableHint = played.nodes.find((node) => node.id === puzzle.id).hints.find((hint) => hint.available);
          assert.ok(availableHint, "Every starter must offer its introductory hint before the first attempt.");
          assert.ok(!Object.hasOwn(availableHint, "text"), "Available hints must remain hidden until explicitly requested.");
          played = await act(account, character, puzzle, "hint", { hintIndex: availableHint.index });
          assert.ok(played.nodes.find((node) => node.id === puzzle.id).hints.some((hint) => hint.index === availableHint.index && hint.requested && typeof hint.text === "string"), "An explicitly requested available hint must reveal only its authorized text.");
          played = await act(account, character, puzzle, "attempt", { answer: puzzle.answer });
        }
        assert.equal(played.nodes.find((node) => node.id === puzzle.id).completed, true, "A valid solution or explicit organizer solve must complete the puzzle.");
        assert.equal(played.nodes.find((node) => node.id === scene.id).locked, false, "Puzzle success must unlock the final scene.");
        played = await act(account, character, scene, "join");
        assert.equal(played.nodes.find((node) => node.id === scene.id).joined, true, "The player must be enrolled in the final scene.");
        const entries = played.journal.length;
        const repeatedJoin = await act(account, character, scene, "join");
        assert.equal(repeatedJoin.journal.length, entries, "Repeated scene attendance must not duplicate outcomes or journal entries.");
        const reloaded = await request(account, playPath(character));
        assert.ok(isDeepStrictEqual(reloaded.journal, played.journal), "The private field journal must survive a fresh HTTP load.");
        safeAdventure(reloaded, definition);
      }
      const finalReplay = await act(firstRequest.account, firstRequest.character, relic, "examine", { examId: exam.id, code: relic.code }, { requestId: firstRequest.requestId });
      assert.ok(finalReplay.journal.some((entry) => entry.nodeId === scene.id), "Replaying an old action must return the current permitted state rather than an obsolete snapshot.");
      event = await patchEvent(owner, event, { status: "paused" });
      await act(firstRequest.account, firstRequest.character, relic, "examine", { examId: exam.id, code: relic.code }, { requestId: firstRequest.requestId, status: 409 });
      event = await patchEvent(owner, event, { status: "live" });
      const original = await request(owner, playPath(assigned[0].character));
      const originalInventory = (await request(owner, `/api/events/${event.id}/characters/${assigned[0].character.id}/inventory`)).inventory;
      const { event: rehearsal } = await request(owner, `${base}/rehearsal`, { method: "POST", body: {}, status: 201 });
      ownedEvents.push({ account: owner, id: rehearsal.id });
      assert.notEqual(rehearsal.id, event.id, "Rehearsal must create a separate event.");
      assert.equal(rehearsal.status, "rehearsal", "The copied rehearsal event must be ready for rehearsal play.");
      const rehearsalBase = `/api/events/${rehearsal.id}/adventure`;
      let rehearsalManage = await request(owner, `${rehearsalBase}/manage`);
      assert.equal(rehearsalManage.isRehearsal, true, "Only dedicated rehearsal copies may be reset.");
      assert.equal(rehearsalManage.sourceEventId, event.id, "A rehearsal must identify its original source event.");
      assert.equal(rehearsalManage.progress.length, 0, "Rehearsal copies must not transfer original progress.");
      const rehearsalCharacters = (await request(owner, `/api/events/${rehearsal.id}/characters`)).characters;
      assert.equal(rehearsalCharacters.length, 2, "Rehearsal must copy both authored character identities.");
      assert.ok(rehearsalCharacters.every((character) => character.userId === null && !assigned.some((entry) => entry.character.id === character.id)), "Rehearsal characters must have new identities and await assignment.");
      const { character: rehearsalCharacter } = await request(owner, `/api/events/${rehearsal.id}/characters/${rehearsalCharacters[0].id}/assign`, {
        method: "POST", body: { version: rehearsalCharacters[0].version, userId: owner.id },
      });
      const rehearsalRelic = rehearsalManage.definition.nodes.find((node) => node.id === relic.id);
      await request(owner, `${rehearsalBase}/action`, {
        method: "POST", body: { requestId: randomUUID(), version: rehearsalManage.version, characterId: rehearsalCharacter.id, nodeId: rehearsalRelic.id, kind: "examine", examId: exam.id, code: rehearsalRelic.code },
      });
      const rehearsalPlayPath = `${rehearsalBase}/play?characterId=${rehearsalCharacter.id}`;
      assert.ok((await request(owner, rehearsalPlayPath)).journal.length > 0, "The rehearsal reset check must clear actual persisted play.");
      await request(owner, `${base}/reset`, { method: "POST", body: { version, confirm: true }, status: 409 });
      await request(owner, `${rehearsalBase}/reset`, { method: "POST", body: { version: rehearsalManage.version, confirm: true } });
      rehearsalManage = await request(owner, `${rehearsalBase}/manage`);
      assert.ok(rehearsalManage.version > version, "A rehearsal reset must advance the adventure version.");
      assert.equal((await request(owner, rehearsalPlayPath)).journal.length, 0, "A rehearsal reset must remove its journal and play state.");
      assert.ok(isDeepStrictEqual((await request(owner, playPath(assigned[0].character))).journal, original.journal), "Resetting a rehearsal must preserve the original event's journal.");
      assert.ok(isDeepStrictEqual((await request(owner, `/api/events/${event.id}/characters/${assigned[0].character.id}/inventory`)).inventory, originalInventory), "Resetting a rehearsal must preserve original character inventory.");
      await request(owner, `/api/events/${event.id}/members/${player.id}`, { method: "DELETE" });
      await request(player, playPath(assigned[1].character), { status: 404 });
      await act(player, assigned[1].character, scene, "join", {}, { status: 404 });
      completedSources.push({ event, journalEntries: original.journal.length });
      pass(`${theme} starter: two assigned characters, conditional readings, puzzle outcomes, scenes, replay, privacy, persistence, and isolated rehearsal reset`);
    }
    assert.equal(completedSources.length, 3, "Every theme must complete its actual staged adventure journey.");
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

    const sharedCharacter = await characterJourney(owner, player, event, isolated);

    await request(owner, `/api/events/${event.id}/members/${player.id}`, { method: "DELETE" });
    await request(player, `/api/events/${event.id}`, { status: 404 });
    await request(player, `/api/events/${event.id}/pack?audience=player`, { status: 404 });
    await request(player, `/api/events/${event.id}/preview?audience=player`, { status: 404 });
    await request(player, `/api/events/${event.id}/characters`, { status: 404 });
    await request(player, `/api/badges/${sharedCharacter.badgeCode}`, { status: 404 });
    pass("membership revocation immediately removes detail, export, preview, character, and badge access");
    await adventureJourney(owner, player);
  } catch (error) {
    // Every assertion above uses an explicit message; never dump request bodies,
    // response payloads, passwords, invitation codes, or session cookies into CI.
    console.error(`FAIL staging workflow: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}
