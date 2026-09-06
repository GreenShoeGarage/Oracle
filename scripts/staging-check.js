import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { VERSION, SCHEMA_VERSION } from "../src/config.js";
import { defaultSetup, THEMES } from "../public/kit.js";
import { defaultStoryDocument } from "../public/story-model.js";
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

  async function exchangeJourney(owner, player, event, assigned, definition, adventureVersion) {
    const base = `/api/events/${event.id}`;
    const participants = assigned.map((entry) => ({ ...entry }));
    const relic = definition.nodes.find((node) => node.id === "evidence-core");
    const overview = (participant) => request(participant.account, `${base}/exchanges?characterId=${participant.character.id}`);
    const detail = (participant, id) => request(participant.account, `${base}/exchanges/${id}?characterId=${participant.character.id}`);
    const journal = (participant) => request(participant.account, `${base}/adventure/play?characterId=${participant.character.id}`);
    const mutate = (participant, id, action, version, fields = {}, { requestId = randomUUID(), status = 200 } = {}) => request(participant.account, `${base}/exchanges/${id}/${action}`, {
      method: action === "offer" ? "PUT" : "POST", body: { requestId, characterId: participant.character.id, version, ...fields }, status,
    });
    const create = (participant, requestId = randomUUID(), status = 201) => request(participant.account, `${base}/exchanges`, {
      method: "POST", body: { requestId, characterId: participant.character.id }, status,
    });
    const pair = async () => {
      const created = await create(participants[0]);
      assert.equal(created.exchange.status, "waiting", "Showing an exchange code must create a waiting session.");
      assert.ok(/^[A-HJ-NP-Z2-9]{12}$/.test(created.exchange.code), "Waiting exchange codes must contain twelve unambiguous characters.");
      const joined = await request(player, `${base}/exchanges/join`, {
        method: "POST", body: { requestId: randomUUID(), characterId: participants[1].character.id, code: created.exchange.code },
      });
      assert.equal(joined.exchange.status, "negotiating", "Scanning a code must pair the players without completing an exchange.");
      assert.equal(joined.exchange.code, null, "The single-recipient code must disappear after pairing.");
      assert.equal(joined.exchange.own.confirmed, false, "Joining must never imply the recipient's confirmation.");
      assert.equal(joined.exchange.partner.confirmed, false, "Joining must never imply the initiator's confirmation.");
      return joined.exchange;
    };
    const privateBeforeCompletion = (exchange, peerReading) => {
      assert.equal(exchange.receipt, null, "Uncompleted exchanges must not expose a transfer receipt.");
      for (const offered of exchange.partner?.offered || [])
        assert.ok(Object.keys(offered).every((key) => ["id", "title", "type"].includes(key)), "A peer's pending offer must expose titles only, never reading contents.");
      const serialized = JSON.stringify(exchange);
      if (peerReading) assert.ok(!serialized.includes(peerReading.text), "Peer reading text must remain hidden until both players confirm the same offer revision.");
      for (const participant of participants) {
        assert.ok(!serialized.includes(participant.account.email), "Exchange projections must omit account email addresses.");
        if (participant.character.profile.privateObjectives)
          assert.ok(!serialized.includes(participant.character.profile.privateObjectives), "Exchange projections must omit private character objectives.");
      }
    };
    for (const participant of participants) {
      const ownExam = relic.examinations.find((exam) => exam.id !== "read-markings" && exam.conditions.skills.every((skill) => participant.character.profile.skills.includes(skill)));
      assert.ok(ownExam, "Each starter character must have a distinct permitted specialist reading to exchange.");
      const result = await request(participant.account, `${base}/adventure/action`, {
        method: "POST", body: { requestId: randomUUID(), version: adventureVersion, characterId: participant.character.id, nodeId: relic.id, kind: "examine", examId: ownExam.id, code: relic.code },
      });
      participant.reading = result.journal.find((entry) => entry.nodeId === relic.id && entry.text === ownExam.text);
      assert.ok(participant.reading, "An offered specialist reading must first exist in its owner's discovered journal.");
      const available = await overview(participant);
      assert.ok(available.readings.some((reading) => reading.id === participant.reading.id && reading.shareable), "The starter's newly discovered relic reading must be explicitly shareable.");
      assert.equal(available.contacts.length, 0, "No contacts may be created by merely discovering a reading.");
      for (const reading of available.readings)
        assert.ok(!Object.hasOwn(reading, "text") && !Object.hasOwn(reading, "audio"), "The exchange reading picker must contain metadata only.");
    }
    assert.notEqual(participants[0].reading.id, participants[1].reading.id, "The two participants must offer independent discovered records.");
    assert.ok(participants[0].reading.text !== participants[1].reading.text, "The two offered readings must contain distinct discoveries.");
    const stateBefore = (await request(owner, `${base}/adventure/manage`)).progress.map(({ journalEntries, ...progress }) => progress);
    const nodeState = (play) => play.nodes.map(({ retryAfterMs, ...node }) => node);
    const nodesBefore = await Promise.all(participants.map(async (participant) => nodeState(await journal(participant))));
    const inventoryBefore = await Promise.all(participants.map((participant) => request(participant.account, `${base}/characters/${participant.character.id}/inventory`)));

    let introduction = await pair();
    const introOwnerRequest = randomUUID();
    const firstConfirmation = await mutate(participants[0], introduction.id, "confirm", introduction.version, {}, { requestId: introOwnerRequest });
    assert.equal(firstConfirmation.exchange.status, "negotiating", "One confirmation must not complete an introduction.");
    privateBeforeCompletion(firstConfirmation.exchange);
    assert.equal((await overview(participants[0])).contacts.length, 0, "A one-sided confirmation must not create a contact.");
    introduction = (await mutate(participants[1], introduction.id, "confirm", introduction.version)).exchange;
    assert.equal(introduction.status, "completed", "Two confirmations must complete a zero-item introduction.");
    assert.equal(introduction.receipt.introduced, true, "A zero-item exchange must record the bilateral introduction.");
    assert.equal(introduction.receipt.received.length, 0, "An introduction must not silently transfer discoveries.");
    for (const participant of participants) assert.equal((await overview(participant)).contacts.length, 1, "Bilateral completion must create exactly one contact for each participant.");
    const introductionReplay = await mutate(participants[0], introduction.id, "confirm", introduction.version, {}, { requestId: introOwnerRequest });
    assert.equal(introductionReplay.exchange.status, "completed", "A repeated confirmation must return the current completed session.");
    assert.equal(introductionReplay.outcome.replayed, true, "A repeated confirmation must be acknowledged as an idempotent replay.");
    await mutate(participants[0], introduction.id, "confirm", introduction.version + 1, {}, { requestId: introOwnerRequest, status: 409 });
    pass("bilateral introductions require both confirmations and create durable contacts without transferring readings");

    let session = await pair();
    const expiry = session.expiresAt;
    session = (await mutate(participants[0], session.id, "offer", session.version, { readingIds: [participants[0].reading.id] })).exchange;
    session = (await mutate(participants[1], session.id, "offer", session.version, { readingIds: [participants[1].reading.id] })).exchange;
    for (const [index, participant] of participants.entries()) privateBeforeCompletion((await detail(participant, session.id)).exchange, participants[1 - index].reading);
    session = (await mutate(participants[0], session.id, "confirm", session.version)).exchange;
    assert.equal(session.own.confirmed, true, "The first participant must see their own confirmed revision.");
    session = (await mutate(participants[1], session.id, "offer", session.version, { readingIds: [] })).exchange;
    assert.equal(session.own.confirmed, false, "Changing an offer must clear the changing player's confirmation.");
    assert.equal(session.partner.confirmed, false, "Changing an offer must clear the other player's confirmation.");
    assert.equal(session.expiresAt, expiry, "Offer changes must not extend the original exchange deadline.");
    session = (await mutate(participants[1], session.id, "offer", session.version, { readingIds: [participants[1].reading.id] })).exchange;
    await mutate(participants[0], session.id, "confirm", session.version);
    let sharing = await request(owner, `${base}/sharing`);
    const originalPolicies = sharing.nodes.map((node) => ({ nodeId: node.id, policy: node.policy }));
    sharing = await request(owner, `${base}/sharing`, {
      method: "PUT", body: { version: sharing.version, policies: originalPolicies.map((entry) => entry.nodeId === relic.id ? { ...entry, policy: "restricted" } : entry) },
    });
    session = (await detail(participants[0], session.id)).exchange;
    assert.equal(session.own.confirmed, false, "A sharing policy change must clear the initiator's confirmation.");
    assert.equal(session.partner.confirmed, false, "A sharing policy change must clear the recipient's confirmation.");
    assert.ok(session.blockedReason, "A newly restricted pending reading must visibly block completion.");
    await mutate(participants[1], session.id, "confirm", session.version, {}, { status: 403 });
    await request(owner, `${base}/sharing`, { method: "PUT", body: { version: sharing.version, policies: originalPolicies } });
    session = (await detail(participants[0], session.id)).exchange;
    assert.equal(session.own.confirmed, false, "Restoring policy must still require fresh confirmation.");
    assert.equal(session.partner.confirmed, false, "Restoring policy must require both players to confirm again.");
    privateBeforeCompletion(session, participants[1].reading);
    await request(owner, "/api/auth/logout", { method: "POST", body: {}, status: 204 });
    owner.cookie = null;
    await request(owner, "/api/auth/login", { method: "POST", body: { email: owner.email, password: owner.password } });
    const resumed = (await detail(participants[0], session.id)).exchange;
    assert.equal(resumed.id, session.id, "A new sign-in must resume the same pending exchange.");
    assert.equal(resumed.version, session.version, "A new sign-in must preserve the authoritative offer revision.");
    const ownConfirmationRequest = randomUUID();
    await mutate(participants[0], session.id, "confirm", session.version, {}, { requestId: ownConfirmationRequest });
    privateBeforeCompletion((await detail(participants[1], session.id)).exchange, participants[0].reading);
    const finalRequestId = randomUUID();
    session = (await mutate(participants[1], session.id, "confirm", session.version, {}, { requestId: finalRequestId })).exchange;
    assert.equal(session.status, "completed", "Selected readings must transfer only after both current confirmations.");
    const completedJournals = [];
    for (const [index, participant] of participants.entries()) {
      const completed = (await detail(participant, session.id)).exchange;
      const peerReading = participants[1 - index].reading;
      assert.ok(completed.receipt.received.some((reading) => reading.text === peerReading.text && reading.alreadyKnown === false), "The committed receipt must contain the actual newly received reading.");
      const refreshed = await journal(participant);
      assert.equal(refreshed.journal.filter((entry) => entry.type === "shared_reading" && entry.text === peerReading.text).length, 1, "A selected peer discovery must be copied exactly once into the recipient journal.");
      assert.equal(refreshed.journal.filter((entry) => entry.type === "exchange_receipt").length, 2, "Each completed introduction or sharing exchange must add one receipt per participant.");
      assert.equal((await overview(participant)).contacts.length, 1, "Repeated exchanges with the same character must not duplicate contacts.");
      completedJournals.push(refreshed.journal);
    }
    const finalReplay = await mutate(participants[1], session.id, "confirm", session.version, {}, { requestId: finalRequestId });
    assert.equal(finalReplay.outcome.replayed, true, "Retrying a lost final-confirm response must return the committed receipt.");
    assert.ok(isDeepStrictEqual((await journal(participants[1])).journal, completedJournals[1]), "Retrying final completion must not copy discoveries or receipts twice.");
    const stateAfter = (await request(owner, `${base}/adventure/manage`)).progress.map(({ journalEntries, ...progress }) => progress);
    assert.ok(isDeepStrictEqual(stateAfter, stateBefore), "Sharing readings must not change adventure flags, completion, or failure state.");
    const nodesAfter = await Promise.all(participants.map(async (participant) => nodeState(await journal(participant))));
    assert.ok(isDeepStrictEqual(nodesAfter, nodesBefore), "Shared discoveries must not grant examination completion, puzzle attempts, hints, or scene attendance.");
    const inventoryAfter = await Promise.all(participants.map((participant) => request(participant.account, `${base}/characters/${participant.character.id}/inventory`)));
    assert.ok(isDeepStrictEqual(inventoryAfter, inventoryBefore), "Sharing readings must not change either character's inventory.");
    pass("selected two-way sharing hides peer bodies until commit, invalidates changed offers and policies, resumes safely, and preserves gameplay state");

    const completedId = session.id;
    const receivedCopy = completedJournals[0].find((entry) => entry.type === "shared_reading" && entry.text === participants[1].reading.text);
    let returnSession = await pair();
    returnSession = (await mutate(participants[0], returnSession.id, "offer", returnSession.version, { readingIds: [receivedCopy.id] })).exchange;
    await mutate(participants[0], returnSession.id, "confirm", returnSession.version);
    returnSession = (await mutate(participants[1], returnSession.id, "confirm", returnSession.version)).exchange;
    assert.ok(returnSession.receipt.received.some((reading) => reading.alreadyKnown === true), "Returning a reshared discovery to its original owner must report it as already known.");
    assert.equal((await journal(participants[1])).journal.filter((entry) => entry.text === participants[1].reading.text).length, 1, "Canonical provenance must prevent duplicate readings when information returns to its origin.");
    let rejected = await pair();
    rejected = (await mutate(participants[1], rejected.id, "reject", rejected.version)).exchange;
    assert.equal(rejected.status, "rejected", "A recipient must be able to reject a pending exchange.");
    let cancelled = (await create(participants[0])).exchange;
    cancelled = (await mutate(participants[0], cancelled.id, "cancel", cancelled.version)).exchange;
    assert.equal(cancelled.status, "cancelled", "An initiator must be able to cancel a waiting exchange.");
    assert.ok((await overview(participants[0])).sessions.some((entry) => entry.id === completedId && entry.status === "completed"), "Refreshing recent exchanges must preserve committed history.");
    pass("exchange provenance prevents duplicate readings and completed history survives rejection, cancellation, and reload");
    return completedId;
  }

  async function storyJourney(owner, player, event, assigned) {
    const base = `/api/events/${event.id}`;
    const [a, b] = assigned;
    const play = (p) => request(p.account, `${base}/story/play?characterId=${p.character.id}`);
    const trace = (p) => request(p.account, `${base}/trace?characterId=${p.character.id}`);
    const journal = (p) => request(p.account, `${base}/adventure/play?characterId=${p.character.id}`);
    const manage = () => request(owner, `${base}/story/manage`);
    const entryAction = async (entry, action, status = 200) => (await request(owner, `${base}/story/entries/${entry.id}/${action}`, { method: "POST", body: { requestId: randomUUID(), version: entry.version }, status })).entry;
    const createEntry = async (kind, document) => (await request(owner, `${base}/story/entries`, { method: "POST", body: { requestId: randomUUID(), kind, document }, status: 201 })).entry;
    const updateEntry = async (entry, document) => (await request(owner, `${base}/story/entries/${entry.id}`, { method: "PUT", body: { requestId: randomUUID(), version: entry.version, document } })).entry;
    const createTrace = async (p, document) => (await request(p.account, `${base}/trace`, { method: "POST", body: { requestId: randomUUID(), characterId: p.character.id, document }, status: 201 })).record;
    const updateTrace = async (p, record, document) => (await request(p.account, `${base}/trace/${record.id}`, { method: "PUT", body: { requestId: randomUUID(), characterId: p.character.id, version: record.version, document } })).record;
    const progression = async () => (await request(owner, `${base}/adventure/manage`)).progress.map(({ journalEntries, ...state }) => state);
    const beforeProgress = await progression();
    const beforeInventory = await Promise.all(assigned.map((p) => request(p.account, `${base}/characters/${p.character.id}/inventory`)));
    const hiddenTruth = `Hidden witness truth ${runId}`;
    const hiddenTopic = `Private alternate topic ${runId}`;
    const safe = (value) => {
      const text = JSON.stringify(value);
      for (const secret of [hiddenTruth, hiddenTopic, owner.email, player.email]) assert.ok(!text.includes(secret), "Player story and investigation projections must omit organizer truths, topics, and account identities.");
    };
    await request(player, `${base}/story/manage`, { status: 403 });
    await request(player, `${base}/story/entries`, { method: "POST", body: { requestId: randomUUID(), kind: "rumor", document: defaultStoryDocument() }, status: 403 });
    let group = (await request(owner, `${base}/story/groups`, { method: "POST", body: { requestId: randomUUID(), name: "Staging investigation party", characterIds: assigned.map((p) => p.character.id) }, status: 201 })).group;
    const rumors = [];
    const rumorReadings = [];
    for (const [index, p] of assigned.entries()) {
      const document = { ...defaultStoryDocument(), title: index ? "A witness at the southern gate" : "A witness at the northern gate", body: `Independent witness account ${index + 1} ${runId}`, sourceLabel: "A local witness", topic: hiddenTopic, truth: hiddenTruth, audience: { type: "private", ids: [p.character.id] }, conditions: { completed: ["evidence-core"], flags: [], skills: [], statuses: [] }, shareable: true };
      let entry = await createEntry("rumor", document);
      assert.ok(!(await play(p)).rumors.some((r) => r.id === entry.id), "Draft rumors must remain unavailable to players.");
      entry = await entryAction(entry, "publish");
      rumors.push(entry);
    }
    for (const [index, p] of assigned.entries()) {
      const initial = await play(p);
      safe(initial);
      assert.ok(initial.rumors.some((r) => r.id === rumors[index].id), "Each character must receive their own eligible account after the required discovery.");
      assert.ok(!JSON.stringify(initial).includes(rumors[1 - index].id), "An alternate private account must not leak its identifier or title.");
      assert.ok(!JSON.stringify(initial).includes(rumors[index].document.body), "An eligible rumor must withhold its body until explicitly collected.");
      const body = { requestId: randomUUID(), characterId: p.character.id, entryId: rumors[index].id, publicationVersion: rumors[index].publishedVersion };
      const result = await request(p.account, `${base}/story/collect`, { method: "POST", body });
      safe(result);
      assert.ok(result.reading.text.startsWith("Unverified account") && result.reading.text.endsWith(rumors[index].document.body), "Explicit collection must return the intended witness account with its unverified label.");
      rumorReadings.push(result.reading);
      const replay = await request(p.account, `${base}/story/collect`, { method: "POST", body });
      assert.equal(replay.outcome.replayed, true, "An identical collection retry must be idempotent.");
      assert.equal((await journal(p)).journal.filter((r) => r.id === result.reading.id).length, 1, "A collection retry must not duplicate a rumor journal entry.");
      await request(p.account, `${base}/story/collect`, { method: "POST", body: { ...body, requestId: randomUUID(), entryId: rumors[1 - index].id, publicationVersion: rumors[1 - index].publishedVersion }, status: 404 });
    }
    pass("WHISPER delivers different eligible accounts, withholds bodies until collection, preserves retries, and hides alternate tellings and organizer truth");

    const privateDoc = { kind: "theory", title: "A private explanation", notes: `Private speculation ${runId}`, audience: { type: "private", ids: [] }, sources: [rumorReadings[0].id], links: [] };
    const privateA = await createTrace(a, privateDoc);
    const privateB = await createTrace(b, { ...privateDoc, title: "The other player's private explanation", sources: [rumorReadings[1].id] });
    assert.ok(!(await trace(a)).records.some((r) => r.id === privateB.id), "An event owner must not bypass another player's private investigation.");
    await request(owner, `${base}/trace?characterId=${b.character.id}`, { status: 404 });
    assert.ok(!(await trace(b)).records.some((r) => r.id === privateA.id), "Private theories must remain hidden until intentionally shared.");
    const sharedDoc = { kind: "evidence", title: "The gate witness connection", notes: "These accounts may describe the same lantern. This is a player observation.", audience: { type: "public", ids: [] }, sources: [rumorReadings[0].id], links: [{ recordId: privateA.id, label: "My private working theory" }] };
    let shared = await createTrace(a, sharedDoc);
    let receivedTrace = (await trace(b)).records.find((r) => r.id === shared.id);
    assert.ok(receivedTrace, "A deliberately public observation must reach other approved characters in this event.");
    assert.equal(receivedTrace.notes, sharedDoc.notes, "Shared authored notes must retain their exact meaning.");
    assert.deepEqual(receivedTrace.sources, [], "Sharing a TRACE note must not reveal an undiscovered private citation.");
    assert.deepEqual(receivedTrace.links, [], "A link to an inaccessible theory must not leak its identifier or title.");
    safe(receivedTrace);
    await request(player, `${base}/trace/${shared.id}`, { method: "PUT", body: { requestId: randomUUID(), characterId: b.character.id, version: shared.version, document: sharedDoc }, status: 404 });
    const pair = async () => {
      const created = (await request(owner, `${base}/exchanges`, { method: "POST", body: { requestId: randomUUID(), characterId: a.character.id }, status: 201 })).exchange;
      return (await request(player, `${base}/exchanges/join`, { method: "POST", body: { requestId: randomUUID(), characterId: b.character.id, code: created.code } })).exchange;
    };
    const exchangeAction = async (p, exchange, action, extra = {}) => (await request(p.account, `${base}/exchanges/${exchange.id}/${action}`, { method: action === "offer" ? "PUT" : "POST", body: { requestId: randomUUID(), characterId: p.character.id, version: exchange.version, ...extra } })).exchange;
    let exchange = await pair();
    exchange = await exchangeAction(a, exchange, "offer", { readingIds: [rumorReadings[0].id] });
    assert.ok(!JSON.stringify((await request(player, `${base}/exchanges/${exchange.id}?characterId=${b.character.id}`)).exchange).includes(rumorReadings[0].text), "A pending rumor exchange must hide the peer's account body.");
    await exchangeAction(a, exchange, "confirm");
    exchange = await exchangeAction(b, exchange, "confirm");
    assert.equal(exchange.status, "completed", "Both confirmations must complete the selected rumor exchange.");
    assert.ok(exchange.receipt.received.some((r) => r.text === rumorReadings[0].text), "The intended rumor must appear in the completed receipt.");
    receivedTrace = (await trace(b)).records.find((r) => r.id === shared.id);
    assert.ok(receivedTrace.sources.some((s) => s.title === rumorReadings[0].title), "Once the original reading is received through QR exchange, TRACE may expose its citation metadata.");
    assert.deepEqual(receivedTrace.links, [], "Receiving a source must not grant access to a linked private theory.");
    const groupDoc = { ...sharedDoc, audience: { type: "group", ids: [group.id] } };
    shared = await updateTrace(a, shared, groupDoc);
    assert.ok((await trace(b)).records.some((r) => r.id === shared.id), "An explicit group member must receive the shared record.");
    group = (await request(owner, `${base}/story/groups/${group.id}`, { method: "PUT", body: { requestId: randomUUID(), version: group.version, name: group.name, characterIds: [a.character.id] } })).group;
    assert.ok(!(await trace(b)).records.some((r) => r.id === shared.id), "Removing a character from a group must immediately remove current shared investigation access.");
    shared = await updateTrace(a, shared, { ...sharedDoc, audience: { type: "private", ids: [b.character.id] } });
    assert.ok((await trace(b)).records.some((r) => r.id === shared.id), "A private record explicitly shared to another character must be visible to that character.");
    pass("TRACE preserves private theories, intentional audiences, canonical evidence citations, hidden links, and immediate group revocation");

    const { faction } = await request(owner, `${base}/factions`, { method: "POST", body: { name: "Staging witness faction", description: "A fictional audience used only for release verification." }, status: 201 });
    const setFaction = async (id) => {
      let character = (await request(owner, `${base}/characters/${b.character.id}`)).character;
      character = (await request(owner, `${base}/characters/${character.id}`, { method: "PATCH", body: { version: character.version, profile: { ...character.profile, factionId: id } } })).character;
      character = (await request(player, `${base}/characters/${character.id}/submit`, { method: "POST", body: { version: character.version } })).character;
      if (character.status === "pending") character = (await request(owner, `${base}/characters/${character.id}/review`, { method: "POST", body: { version: character.version, decision: "approve", feedback: "Audience verification character revision." } })).character;
      assert.equal(character.status, "approved", "Faction changes must pass the configured character approval process.");
      b.character = character;
    };
    await setFaction(faction.id);
    shared = await updateTrace(a, shared, { ...sharedDoc, audience: { type: "faction", ids: [faction.id] } });
    assert.ok((await trace(b)).records.some((r) => r.id === shared.id), "A current faction member must receive a record shared to that faction.");
    let factionNews = await createEntry("bulletin", { ...defaultStoryDocument(), title: "Faction witness briefing", body: "Members of the witness faction should assemble at the gate.", audience: { type: "faction", ids: [faction.id] } });
    factionNews = await entryAction(factionNews, "publish");
    assert.ok((await play(b)).bulletins.some((r) => r.id === factionNews.id), "A faction publication must reach a current approved faction member.");
    assert.ok(!(await play(a)).bulletins.some((r) => r.id === factionNews.id), "Player mode must enforce faction audience even for an event owner.");
    await setFaction(null);
    assert.ok(!(await trace(b)).records.some((r) => r.id === shared.id), "Leaving a faction must remove current faction investigation access.");
    assert.ok(!(await play(b)).bulletins.some((r) => r.id === factionNews.id), "Leaving a faction must remove current faction bulletin access.");
    shared = await updateTrace(a, shared, { ...sharedDoc, audience: { type: "private", ids: [b.character.id] } });
    pass("Faction publications and investigations follow current approved affiliations without manager bypass in player mode");

    const proposalTitle = "Witnesses propose an evening meeting";
    const proposalBody = `Player-proposed announcement ${runId}`;
    const proposal = (await request(player, `${base}/story/proposals`, { method: "POST", body: { requestId: randomUUID(), characterId: b.character.id, title: proposalTitle, body: proposalBody, sourceJournalId: rumorReadings[1].id, audience: { type: "private", ids: [a.character.id] } }, status: 201 })).entry;
    assert.equal(proposal.status, "submitted", "Player announcements must await publication review.");
    assert.ok(!(await play(a)).bulletins.some((r) => r.id === proposal.id), "Submitted announcements must not publish themselves.");
    let bulletin = (await manage()).entries.find((r) => r.id === proposal.id);
    assert.ok(bulletin, "Organizers must receive submitted announcements for review.");
    assert.equal(bulletin.document.truth, "", "A player proposal must not infer hidden game truth from its source.");
    bulletin = await entryAction(bulletin, "publish");
    let publication = (await play(a)).bulletins.find((r) => r.id === bulletin.id);
    assert.equal(publication.body, proposalBody, "Review and Publish must expose the selected approved bulletin.");
    assert.ok(!(await play(b)).bulletins.some((r) => r.id === bulletin.id), "Publication must enforce the selected private audience even for its proposer.");
    const correctedBody = `Corrected meeting place ${runId}`;
    bulletin = await updateEntry(bulletin, { ...bulletin.document, body: correctedBody, correctionNote: "The meeting place was corrected after reviewing the two witness accounts." });
    assert.equal((await play(a)).bulletins.find((r) => r.id === bulletin.id).body, proposalBody, "Saving a correction draft must leave the previous approved publication live.");
    bulletin = await entryAction(bulletin, "publish");
    publication = (await play(a)).bulletins.find((r) => r.id === bulletin.id);
    assert.equal(publication.body, correctedBody, "Publishing a reviewed correction must replace the live bulletin.");
    assert.ok(publication.correctionNote, "Readers must see why a publication was corrected.");
    safe(publication);
    bulletin = await entryAction(bulletin, "withdraw");
    assert.ok(!(await play(a)).bulletins.some((r) => r.id === bulletin.id), "Withdrawal must hide the current bulletin from its former audience.");
    let pending = await pair();
    pending = await exchangeAction(a, pending, "offer", { readingIds: [rumorReadings[0].id] });
    await exchangeAction(a, pending, "confirm");
    rumors[0] = await entryAction(rumors[0], "withdraw");
    pending = (await request(owner, `${base}/exchanges/${pending.id}?characterId=${a.character.id}`)).exchange;
    assert.equal(pending.own.confirmed, false, "Withdrawing a rumor must clear outstanding exchange confirmation.");
    assert.equal(pending.partner.confirmed, false, "Withdrawing a rumor must clear both exchange confirmations.");
    assert.ok(pending.blockedReason, "A withdrawn rumor must block a new exchange transfer.");
    await exchangeAction(a, pending, "cancel");
    assert.ok((await journal(a)).journal.some((r) => r.id === rumorReadings[0].id), "Withdrawal must preserve already authorized rumor journal history.");
    assert.ok((await journal(b)).journal.some((r) => r.type === "shared_reading" && r.text === rumorReadings[0].text), "Withdrawal must preserve a previously completed received reading.");
    for (const p of assigned) { safe(await play(p)); safe(await trace(p)); safe(await journal(p)); }
    assert.ok(isDeepStrictEqual(await progression(), beforeProgress), "Rumors, investigations and publications must not grant adventure completion, flags, or attendance.");
    assert.ok(isDeepStrictEqual(await Promise.all(assigned.map((p) => request(p.account, `${base}/characters/${p.character.id}/inventory`))), beforeInventory), "Story work must not alter either character's inventory.");
    assert.ok((await manage()).activity.some((r) => r.entryId === bulletin.id), "Publication and correction work must leave organizer activity metadata.");
    pass("BROADSIDE requires review, preserves live text while corrections are drafted, publishes to the intended audience, withdraws cleanly, and preserves game state");
    return { rumors, group, sourceTraceId: shared.id, ownerPrivateTraceId: privateA.id };
  }

  async function economyJourney(owner, player, event, assigned) {
    const [a, b] = assigned;
    const base = `/api/events/${event.id}`;
    const market = (p) => request(p.account, `${base}/bazaar?characterId=${p.character.id}`);
    const inventory = (p) => request(p.account, `${base}/characters/${p.character.id}/inventory`);
    const journal = (p) => request(p.account, `${base}/adventure/play?characterId=${p.character.id}`);
    assert.ok(event.setup.enabledInstruments.includes("bazaar") && event.setup.enabledInstruments.includes("oathbook"), "New complete adventures must explicitly enable economy and agreements.");
    await request(player, `${base}/bazaar/manage`, { status: 403 });
    await request(player, `${base}/bazaar/resources`, { method: "POST", body: { requestId: randomUUID(), id: "forged", name: "Forbidden resource" }, status: 403 });
    const initial = await market(a);
    assert.ok(initial.balances.every((balance) => balance.quantity === 0), "New starter characters must not silently receive spendable balances.");
    const { resource } = await request(owner, `${base}/bazaar/resources`, { method: "POST", body: { requestId: randomUUID(), id: "ci-tokens", name: "Fictional staging tokens" }, status: 201 });
    const { shop } = await request(owner, `${base}/bazaar/shops`, { method: "POST", body: { requestId: randomUUID(), name: "Staging supply stall", description: "Fictional stock used only in this disposable event.", enabled: true }, status: 201 });
    let { stock } = await request(owner, `${base}/bazaar/shops/${shop.id}/stock`, { method: "POST", body: { requestId: randomUUID(), name: "Staging trade lantern", description: "A fictional item with no private notes.", quantity: 3, resourceId: resource.id, unitPrice: 2 }, status: 201 });
    const balance = (snapshot) => snapshot.balances.find((entry) => entry.resourceId === resource.id);
    const adjust = async (p, quantity, reason, agreementId) => {
      const current = balance(await market(p));
      return request(owner, `${base}/bazaar/adjust`, { method: "POST", body: { requestId: randomUUID(), characterId: p.character.id, resourceId: resource.id, quantity, version: current?.version || 0, reason, ...(agreementId ? { agreementId } : {}) } });
    };
    await adjust(a, 20, "Grant the organizer character its fictional test allocation.");
    await adjust(b, 10, "Grant the player character its fictional test allocation.");
    const outdatedStockVersion = stock.version;
    stock = (await request(owner, `${base}/bazaar/shops/${shop.id}/stock/${stock.id}`, { method: "PATCH", body: { requestId: randomUUID(), version: stock.version, name: stock.name, description: stock.description, quantity: 3, resourceId: resource.id, unitPrice: 3, reason: "Correct the fictional price before the purchase." } })).stock;
    const purchaseInput = { requestId: randomUUID(), characterId: b.character.id, shopId: shop.id, stockId: stock.id, version: stock.version, quantity: 1 };
    await request(player, `${base}/bazaar/purchase`, { method: "POST", body: { ...purchaseInput, requestId: randomUUID(), version: outdatedStockVersion }, status: 409 });
    const purchase = await request(player, `${base}/bazaar/purchase`, { method: "POST", body: purchaseInput });
    const purchaseReplay = await request(player, `${base}/bazaar/purchase`, { method: "POST", body: purchaseInput });
    assert.equal(purchaseReplay.receipt.id, purchase.receipt.id, "An exact purchase retry must return the same immutable transaction.");
    assert.equal(purchaseReplay.outcome.replayed, true, "The repeated purchase must be identified as a replay.");
    await request(player, `${base}/bazaar/purchase`, { method: "POST", body: { ...purchaseInput, quantity: 2 }, status: 409 });
    let afterPurchase = await market(b);
    assert.equal(balance(afterPurchase).quantity, 7, "The purchase must debit the corrected price exactly once.");
    stock = afterPurchase.shops.find((entry) => entry.id === shop.id).stock.find((entry) => entry.id === stock.id);
    assert.equal(stock.quantity, 2, "The purchase must decrement finite stock exactly once.");
    assert.equal(stock.initialQuantity, 3, "Purchasing must preserve the authored stock baseline.");
    const purchasedItem = afterPurchase.inventory.find((entry) => entry.name === "Staging trade lantern");
    assert.equal(purchasedItem.quantity, 1, "A paid purchase must deliver one owned inventory item.");
    await request(player, `${base}/bazaar/purchase`, { method: "POST", body: { ...purchaseInput, requestId: randomUUID(), version: stock.version, quantity: 3 }, status: 409 });
    await adjust(b, 0, "Exercise insufficient fictional funds without changing shop stock.");
    const beforeRejectedPurchase = await market(b);
    await request(player, `${base}/bazaar/purchase`, { method: "POST", body: { ...purchaseInput, requestId: randomUUID(), version: stock.version }, status: 409 });
    assert.deepEqual(await market(b), beforeRejectedPurchase, "An insufficient-funds purchase must leave balance, inventory, stock and receipts unchanged.");
    await adjust(b, 7, "Restore the fictional funds for the bilateral trade.");
    pass("BAZAAR uses explicit fictional grants, corrected displayed prices, finite stock, atomic purchases, and one durable transaction on retry");

    let { item } = await request(owner, `${base}/characters/${a.character.id}/inventory`, { method: "POST", body: { name: "Staging barter compass", quantity: 1, notes: `Private inventory marker ${runId}` }, status: 201 });
    const created = (await request(owner, `${base}/exchanges`, { method: "POST", body: { requestId: randomUUID(), characterId: a.character.id }, status: 201 })).exchange;
    let exchange = (await request(player, `${base}/exchanges/join`, { method: "POST", body: { requestId: randomUUID(), characterId: b.character.id, code: created.code } })).exchange;
    const exchangeAction = async (p, action, fields = {}, requestId = randomUUID(), status = 200) => {
      const result = await request(p.account, `${base}/exchanges/${exchange.id}/${action}`, { method: action === "offer" ? "PUT" : "POST", body: { requestId, characterId: p.character.id, version: exchange.version, ...fields }, status });
      if (status === 200) exchange = result.exchange;
      return result;
    };
    const aOffer = () => ({ readingIds: [], items: [{ itemId: item.id, quantity: 1, version: item.version }], resources: [{ resourceId: resource.id, quantity: 2 }] });
    const bOffer = { readingIds: [], items: [{ itemId: purchasedItem.id, quantity: 1, version: purchasedItem.version }], resources: [{ resourceId: resource.id, quantity: 3 }] };
    await exchangeAction(a, "offer", aOffer());
    await exchangeAction(b, "offer", bOffer);
    await exchangeAction(a, "confirm");
    await exchangeAction(b, "offer", { ...bOffer, resources: [{ resourceId: resource.id, quantity: 2 }] });
    assert.equal(exchange.own.confirmed, false, "Changing a resource offer must clear the actor's prior confirmation.");
    assert.equal(exchange.partner.confirmed, false, "Changing a resource offer must clear the other player's prior confirmation.");
    await exchangeAction(b, "offer", bOffer);
    await exchangeAction(a, "confirm");
    const hidden = JSON.stringify((await request(player, `${base}/exchanges/${exchange.id}?characterId=${b.character.id}`)).exchange);
    for (const marker of [`Private inventory marker ${runId}`, owner.email, player.email]) assert.ok(!hidden.includes(marker), "A pending trade must omit private notes and account identifiers.");
    assert.ok(!Object.hasOwn(exchange.partner, "balances") && !Object.hasOwn(exchange.partner, "inventory"), "The partner sees selected transfer terms only.");
    item = (await request(owner, `${base}/characters/${a.character.id}/inventory/${item.id}`, { method: "PATCH", body: { version: item.version, name: item.name, quantity: 0, notes: `Private inventory marker ${runId}` } })).item;
    const beforeFailedTrade = await Promise.all([market(a), market(b), journal(a), journal(b)]);
    await exchangeAction(b, "confirm", {}, randomUUID(), 409);
    assert.deepEqual(await Promise.all([market(a), market(b), journal(a), journal(b)]), beforeFailedTrade, "A stale or unavailable last-leg item must roll back all resources, inventory, readings and receipts.");
    item = (await request(owner, `${base}/characters/${a.character.id}/inventory/${item.id}`, { method: "PATCH", body: { version: item.version, name: item.name, quantity: 1, notes: `Private inventory marker ${runId}` } })).item;
    await exchangeAction(a, "offer", aOffer());
    await exchangeAction(a, "confirm");
    const finalVersion = exchange.version, finalRequestId = randomUUID();
    await exchangeAction(b, "confirm", {}, finalRequestId);
    assert.equal(exchange.status, "completed", "Both reviewed offers must complete the atomic trade.");
    assert.ok(exchange.receipt.assets.transactionId, "Completed barter must retain its authoritative economy transaction.");
    const tradeId = exchange.id, tradeTransactionId = exchange.receipt.assets.transactionId;
    const tradeReplay = await request(player, `${base}/exchanges/${tradeId}/confirm`, { method: "POST", body: { requestId: finalRequestId, characterId: b.character.id, version: finalVersion } });
    assert.equal(tradeReplay.exchange.receipt.assets.transactionId, tradeTransactionId, "Retrying a completed trade must return the original transaction.");
    const [afterA, afterB] = await Promise.all([market(a), market(b)]);
    assert.equal(balance(afterA).quantity, 21, "The first player must receive exactly the agreed net resources.");
    assert.equal(balance(afterB).quantity, 6, "The second player must receive exactly the agreed net resources.");
    assert.equal(afterA.inventory.filter((entry) => entry.name === "Staging trade lantern").reduce((sum, entry) => sum + entry.quantity, 0), 1);
    assert.equal(afterB.inventory.filter((entry) => entry.name === "Staging barter compass").reduce((sum, entry) => sum + entry.quantity, 0), 1);
    assert.ok(!(await inventory(b)).inventory.some((entry) => entry.notes.includes(`Private inventory marker ${runId}`)), "Receiving an item must not transfer the sender's private notes.");
    pass("QR barter resets consent on revised terms, rejects stale assets without partial writes, transfers both sides atomically, and preserves one receipt on replay");

    const witness = await register("Witness");
    const { invitation } = await request(owner, `${base}/invites`, { method: "POST", body: { role: "player", maxUses: 1, expiresInHours: 1 }, status: 201 });
    await request(witness, "/api/events/join", { method: "POST", body: { code: invitation.code } });
    let witnessCharacter = (await request(owner, `${base}/characters`, { method: "POST", body: { profile: { ...defaultCharacterProfile(event.setup.rules), name: "Staging independent witness" }, userId: witness.id }, status: 201 })).character;
    witnessCharacter = (await request(owner, `${base}/characters/${witnessCharacter.id}/submit`, { method: "POST", body: { version: witnessCharacter.version } })).character;
    if (witnessCharacter.status === "pending") witnessCharacter = (await request(owner, `${base}/characters/${witnessCharacter.id}/review`, { method: "POST", body: { version: witnessCharacter.version, decision: "approve", feedback: "Approved only for the disposable witness journey." } })).character;
    assert.equal(witnessCharacter.status, "approved");
    const w = { account: witness, character: witnessCharacter };
    const participants = [a.character.id, b.character.id];
    const document = { title: "Staging supply compact", terms: "Both travellers agree to carry the lantern to the gathering.", participantIds: participants, witnessIds: [w.character.id], expiresAt: new Date(Date.now() + 3600000).toISOString(), settlement: [{ fromCharacterId: a.character.id, toCharacterId: b.character.id, resourceId: resource.id, quantity: 4 }] };
    let agreement = (await request(owner, `${base}/oaths`, { method: "POST", body: { requestId: randomUUID(), characterId: a.character.id, ...document }, status: 201 })).agreement;
    assert.equal(agreement.status, "proposed");
    assert.ok(agreement.participants.every((entry) => !entry.accepted), "Creating an agreement must not impersonate anyone's acceptance, including the creator.");
    const oathAction = async (p, action, fields = {}, requestId = randomUUID(), status = 200) => {
      const result = await request(p.account, `${base}/oaths/${agreement.id}/${action}`, { method: "POST", body: { requestId, characterId: p.character.id, version: agreement.version, ...fields }, status });
      if (status === 200) agreement = result.agreement;
      return result;
    };
    await oathAction(a, "accept");
    await oathAction(w, "witness");
    const previousTermsVersion = agreement.termsVersion;
    const revised = { ...document, terms: `${document.terms} The confirmed settlement is five fictional tokens.`, settlement: [{ ...document.settlement[0], quantity: 5 }] };
    agreement = (await request(owner, `${base}/oaths/${agreement.id}`, { method: "PUT", body: { requestId: randomUUID(), characterId: a.character.id, version: agreement.version, ...revised } })).agreement;
    assert.ok(agreement.termsVersion > previousTermsVersion, "Editing proposed terms must create a new exact terms revision.");
    assert.ok(agreement.participants.every((entry) => !entry.accepted) && agreement.witnesses.every((entry) => !entry.witnessed), "Changing terms must clear every acceptance and witness attestation.");
    await oathAction(a, "accept");
    await oathAction(b, "accept");
    assert.equal(agreement.status, "active", "All participants must explicitly accept before an agreement becomes active.");
    await oathAction(w, "witness");
    assert.ok(agreement.participants.every((entry) => entry.acceptedTermsVersion === agreement.termsVersion), "Every acceptance must identify the exact current terms version.");
    assert.equal(agreement.witnesses[0].termsVersion, agreement.termsVersion, "The independent witness must attest the displayed revision.");
    await oathAction(w, "settle", {}, randomUUID(), 403);
    const priorBalances = [balance(await market(a)).quantity, balance(await market(b)).quantity];
    await oathAction(a, "settle");
    assert.deepEqual([balance(await market(a)).quantity, balance(await market(b)).quantity], priorBalances, "One settlement confirmation must not move fictional resources.");
    const settlementVersion = agreement.version, settlementRequestId = randomUUID();
    await oathAction(b, "settle", {}, settlementRequestId);
    assert.equal(agreement.status, "fulfilled");
    const settlementId = agreement.receipt.id;
    const settlementReplay = await request(player, `${base}/oaths/${agreement.id}/settle`, { method: "POST", body: { requestId: settlementRequestId, characterId: b.character.id, version: settlementVersion } });
    assert.equal(settlementReplay.agreement.receipt.id, settlementId, "An accepted settlement retry must not create another resource transfer.");
    assert.deepEqual([balance(await market(a)).quantity, balance(await market(b)).quantity], [16, 11]);
    await oathAction(a, "dispute", { reason: "The fictional delivery took place later than promised." });
    assert.equal(agreement.status, "disputed");
    agreement = (await request(owner, `${base}/oaths/${agreement.id}/adjudicate`, { method: "POST", body: { requestId: randomUUID(), version: agreement.version, outcome: "fulfilled", reason: "Organizer reviewed the delivery and retained the already completed payment.", settle: true } })).agreement;
    assert.equal(agreement.status, "adjudicated");
    assert.equal(agreement.receipt.id, settlementId, "Adjudicating a previously settled agreement must preserve its one original payment.");
    assert.deepEqual([balance(await market(a)).quantity, balance(await market(b)).quantity], [16, 11]);
    const correction = await adjust(b, 12, "Organizer grants one fictional token as an audited correction for the delay.", agreement.id);
    assert.equal(correction.receipt.correction.agreementId, agreement.id, "A correction must identify its agreement without rewriting the original settlement.");
    assert.ok(agreement.history.some((entry) => entry.action.includes("adjudicat") && entry.reason), "The final ruling must retain an explicit audit reason.");
    const agreementText = JSON.stringify((await request(witness, `${base}/oaths/${agreement.id}?characterId=${w.character.id}`)).agreement);
    for (const marker of [owner.email, player.email, witness.email, owner.id, player.id, witness.id]) assert.ok(!agreementText.includes(marker), "Agreement participants and witnesses must see character identities without account identifiers.");
    const saved = (await request(player, `${base}/oaths?characterId=${b.character.id}`)).agreements;
    assert.ok(saved.some((entry) => entry.id === agreement.id), "Completed agreements must survive a fresh list load.");
    pass("OATHBOOK records exact revised terms, independent witnessing, bilateral settlement, replay-safe fulfillment, a dispute, organizer adjudication, and a linked audited correction");
    return { resourceId: resource.id, shopId: shop.id, stockId: stock.id, agreementId: agreement.id, tradeId, characterCount: 3 };
  }

  async function instrumentJourney(owner, player, event, assigned, theme) {
    const base = `/api/events/${event.id}`, host = assigned[0], peer = assigned[1];
    const characterId = host.character.id;
    const own = `characterId=${characterId}`;
    assert.ok(event.setup.enabledInstruments.includes("sigil") && event.setup.enabledInstruments.includes("static"), "Complete starters must explicitly enable SIGIL and STATIC.");
    let sigilManage = await request(owner, `${base}/sigil/manage`);
    let staticManage = await request(owner, `${base}/static/manage`);
    assert.ok(sigilManage.entries.length && staticManage.entries.length, "Every theme must provide prepared cooperative and fictional-reading definitions.");
    await request(player, `${base}/sigil/manage`, { status: 403 });
    await request(player, `${base}/static/manage`, { status: 403 });
    const publish = async (kind, entry) => entry.publishedVersion ? entry : (await request(owner, `${base}/${kind}/entries/${entry.id}/publish`, { method: "POST", body: { requestId: randomUUID(), version: entry.version } })).entry;
    const challenge = await publish("sigil", sigilManage.entries[0]);
    let signalEntry = await publish("static", staticManage.entries[0]);
    const challengeDocument = challenge.published || challenge.document;
    assert.equal(challengeDocument.roles.length, 2, "The same starter cooperation must assign two in-person roles in every theme.");
    assert.equal(challengeDocument.checkpoints.length, 3, "All themes must run the same three-step cooperative procedure.");
    const inventory = (await request(owner, `${base}/characters/${characterId}/inventory`)).inventory;
    const startInput = (entry, doc, character, items) => ({ requestId: randomUUID(), characterId: character.id, entryId: entry.id, publishedVersion: entry.publishedVersion, code: entry.code, roles: doc.roles.map((role, index) => ({ roleId: role.id, performer: `In-person participant ${index + 1}` })), bindings: doc.components.filter((component) => component.kind === "item").map((component) => { const item = items.find((row) => row.name === component.itemName && row.quantity >= component.quantity); assert.ok(item, "Prepared challenge inventory requirements must exist on the host character."); return { componentId: component.id, itemId: item.id }; }) });
    const catalog = await request(owner, `${base}/sigil?${own}`);
    assert.ok(catalog.challenges.some((entry) => entry.id === challenge.id && entry.available), "Existing discovery progress must unlock the prepared cooperation.");
    const catalogText = JSON.stringify(catalog);
    for (const checkpoint of challengeDocument.checkpoints) if (checkpoint.answer) assert.ok(!catalogText.includes(checkpoint.answer), "Challenge listings must not reveal future answers.");
    const lookup = await request(owner, `${base}/sigil/lookup`, { method: "POST", body: { characterId, code: challenge.code } });
    assert.equal(lookup.challenge.id, challenge.id, "Printed SIGIL codes must identify the expected procedure.");
    const readSignal = (account, character, entry = signalEntry) => request(account, `${base}/static/lookup`, { method: "POST", body: { characterId: character.id, code: entry.code } });
    const beforeSignal = (await readSignal(owner, host.character)).signal;
    assert.equal(beforeSignal.fictional, true, "STATIC must explicitly identify every reading as fictional.");
    assert.equal(beforeSignal.label, "Fictional event reading");
    assert.ok(!Object.hasOwn(beforeSignal, "states") && !Object.hasOwn(beforeSignal, "organizerNotes"), "A current fictional reading must not disclose future states or organizer notes.");
    const initialInput = startInput(challenge, challengeDocument, host.character, inventory);
    await request(player, `${base}/sigil/start`, { method: "POST", body: { ...initialInput, requestId: randomUUID() }, status: 404 });
    let run = (await request(owner, `${base}/sigil/start`, { method: "POST", body: initialInput, status: 201 })).run;
    const initialReplay = await request(owner, `${base}/sigil/start`, { method: "POST", body: initialInput });
    assert.equal(initialReplay.run.id, run.id, "Retrying challenge creation must return the same shared-device run.");
    assert.equal(initialReplay.outcome.replayed, true);
    const runPath = `${base}/sigil/runs/${run.id}`;
    const command = async (operation, fields = {}, { account = owner, requestId = randomUUID(), status = 200 } = {}) => {
      const response = await request(account, `${runPath}/${operation}`, { method: "POST", body: { requestId, characterId, version: run.version, ...fields }, status });
      if (status === 200) run = response.run;
      return response;
    };
    const heartbeat = await request(owner, `${runPath}/heartbeat`, { method: "POST", body: { characterId, sequence: 1 } });
    const heartbeatReplay = await request(owner, `${runPath}/heartbeat`, { method: "POST", body: { characterId, sequence: 1 } });
    assert.equal(heartbeatReplay.run.leaseExpiresAt, heartbeat.run.leaseExpiresAt, "Replaying a heartbeat sequence must not extend its connectivity lease.");
    run = heartbeatReplay.run;
    await command("pause");
    const pausedRemaining = run.remainingMs;
    run = (await request(owner, `${runPath}?${own}`)).run;
    assert.equal(run.status, "paused");
    assert.equal(run.remainingMs, pausedRemaining, "A paused timer must remain frozen across a fresh connection.");
    await command("resume");
    event = await patchEvent(owner, event, { status: "paused" });
    run = (await request(owner, `${runPath}?${own}`)).run;
    assert.equal(run.status, "paused", "Pausing an event must immediately freeze its running SIGIL procedure.");
    event = await patchEvent(owner, event, { status: "live" });
    run = (await request(owner, `${runPath}?${own}`)).run;
    assert.equal(run.status, "paused", "Reopening an event must require explicit challenge resume.");
    await command("resume");
    await request(player, `${runPath}/operate`, { method: "POST", body: { requestId: randomUUID(), version: run.version, operation: "succeed", reason: "This player must not operate staff controls." }, status: 403 });
    let finalRequest;
    while (run.currentCheckpoint) {
      const checkpoint = challengeDocument.checkpoints.find((entry) => entry.id === run.currentCheckpoint.id);
      assert.ok(checkpoint, "The active step must belong to the immutable published procedure.");
      if (run.checkpointRemainingMs > 0) await delay(run.checkpointRemainingMs + 100);
      const requestId = randomUUID(), version = run.version;
      const fields = { checkpointId: checkpoint.id, roleId: checkpoint.roleId, answer: checkpoint.answer || "" };
      const response = await command("checkpoint", fields, { requestId });
      if (response.run.status === "succeeded") finalRequest = { requestId, characterId, version, ...fields };
    }
    assert.equal(run.status, "succeeded", "A group must complete the prepared cooperation in every theme.");
    assert.ok(run.result?.journalId, "A completed challenge must persist its authoritative result receipt.");
    const completedRun = run;
    const completionReplay = await request(owner, `${runPath}/checkpoint`, { method: "POST", body: finalRequest });
    assert.equal(completionReplay.run.result.journalId, run.result.journalId, "Retrying the final checkpoint must preserve one result and journal receipt.");
    await request(owner, `${base}/sigil/start`, { method: "POST", body: { ...initialInput, requestId: randomUUID() }, status: 409 });
    const afterSignal = (await readSignal(owner, host.character)).signal;
    assert.equal(afterSignal.source, "conditions", "A cooperative result must drive its prepared STATIC rule.");
    assert.notEqual(afterSignal.readingKey, beforeSignal.readingKey, "Success must visibly change the fictional signal state.");
    const collectInput = { requestId: randomUUID(), characterId, entryId: signalEntry.id, code: signalEntry.code, publicationVersion: afterSignal.publicationVersion, readingKey: afterSignal.readingKey };
    const collected = await request(owner, `${base}/static/collect`, { method: "POST", body: collectInput });
    const collectReplay = await request(owner, `${base}/static/collect`, { method: "POST", body: collectInput });
    assert.equal(collectReplay.reading.id, collected.reading.id, "An uncertain STATIC collection retry must return the original captured reading.");
    const duplicateCollect = await request(owner, `${base}/static/collect`, { method: "POST", body: { ...collectInput, requestId: randomUUID() } });
    assert.equal(duplicateCollect.reading.id, collected.reading.id, "A fresh request for the same signal state must not duplicate its journal entry.");
    staticManage = await request(owner, `${base}/static/manage`);
    signalEntry = staticManage.entries.find((entry) => entry.id === signalEntry.id);
    const staticDocument = signalEntry.published || signalEntry.document;
    const manualState = staticDocument.states.find((state) => state.id !== afterSignal.state.id);
    assert.ok(manualState, "The starter signal must provide a distinct prepared state for staff operation.");
    const stateInput = { requestId: randomUUID(), version: signalEntry.override?.version || 0, stateId: manualState.id, reason: "Staff rehearse a prepared fictional prop state after group completion." };
    await request(player, `${base}/static/entries/${signalEntry.id}/state`, { method: "POST", body: stateInput, status: 403 });
    await request(owner, `${base}/static/entries/${signalEntry.id}/state`, { method: "POST", body: stateInput });
    const manual = (await readSignal(owner, host.character)).signal;
    assert.equal(manual.source, "organizer");
    assert.equal(manual.state.id, manualState.id);
    assert.equal(manual.fictional, true);
    await request(owner, `${base}/static/collect`, { method: "POST", body: { ...collectInput, requestId: randomUUID() }, status: 409 });
    assert.equal((await request(owner, `${base}/static?${own}`)).readings.filter((entry) => entry.id === collected.reading.id || entry.journalId === collected.reading.id).length, 1, "Changing a live signal must preserve its already collected immutable reading.");
    if (theme === "fantasy") {
      const resourceId = "sigil-charges";
      await request(owner, `${base}/bazaar/resources`, { method: "POST", body: { requestId: randomUUID(), id: resourceId, name: "Fictional SIGIL charges" }, status: 201 });
      const adjust = async (quantity) => {
        const current = (await request(owner, `${base}/bazaar?${own}`)).balances.find((row) => row.resourceId === resourceId);
        return request(owner, `${base}/bazaar/adjust`, { method: "POST", body: { requestId: randomUUID(), characterId, resourceId, quantity, version: current?.version || 0, reason: "Rehearse atomic cooperation component consumption." } });
      };
      await adjust(5);
      let coil = (await request(owner, `${base}/characters/${characterId}/inventory`, { method: "POST", body: { name: "Staging SIGIL coil", quantity: 2, notes: "Private inventory note excluded from shared prop presentation." }, status: 201 })).item;
      if (!coil) coil = (await request(owner, `${base}/characters/${characterId}/inventory`)).inventory.find((item) => item.name === "Staging SIGIL coil");
      const paidDocument = {
        title: "Staging component procedure", summary: "A fictional two-component cooperation.", organizerNotes: "Private component adjudication notes.", durationSeconds: 120,
        roles: [{ id: "operator", name: "Operator", instructions: "Agree on the physical sequence." }],
        components: [{ id: "coil", name: "Coil", kind: "item", itemName: coil.name, resourceId: null, quantity: 1, consume: true }, { id: "charge", name: "Charge", kind: "resource", itemName: null, resourceId, quantity: 2, consume: true }],
        checkpoints: [{ id: "prepare", title: "Prepare", instructions: "Place the coil.", roleId: "operator", minimumSeconds: 0, answer: null }, { id: "activate", title: "Activate", instructions: "Confirm the fictional activation.", roleId: "operator", minimumSeconds: 0, answer: null }],
        conditions: { completed: [], flags: [], skills: [], statuses: [] },
        success: { text: "The fictional coil and charges powered the prepared procedure.", flags: [] },
        failure: { text: "The fictional procedure timed out.", flags: [] },
      };
      let paidEntry = (await request(owner, `${base}/sigil/entries`, { method: "POST", body: { requestId: randomUUID(), document: paidDocument }, status: 201 })).entry;
      paidEntry = await publish("sigil", paidEntry);
      const input = startInput(paidEntry, paidDocument, host.character, [coil]);
      let paidRun = (await request(owner, `${base}/sigil/start`, { method: "POST", body: input, status: 201 })).run;
      const path = `${base}/sigil/runs/${paidRun.id}`;
      const step = (checkpoint, requestId = randomUUID()) => ({ requestId, characterId, version: paidRun.version, checkpointId: checkpoint.id, roleId: checkpoint.roleId, answer: "" });
      paidRun = (await request(owner, `${path}/checkpoint`, { method: "POST", body: step(paidDocument.checkpoints[0]) })).run;
      await adjust(0);
      const beforeFailure = await request(owner, `${base}/adventure/play?${own}`);
      await request(owner, `${path}/checkpoint`, { method: "POST", body: step(paidDocument.checkpoints[1]), status: 409 });
      const stillRunning = (await request(owner, `${path}?${own}`)).run;
      assert.equal(stillRunning.version, paidRun.version, "An insufficient final component must roll back the checkpoint version.");
      assert.equal(stillRunning.currentCheckpoint.id, "activate", "Failed consumption must leave the final step uncommitted.");
      assert.equal((await request(owner, `${base}/characters/${characterId}/inventory`)).inventory.find((item) => item.id === coil.id).quantity, 2, "Failed resource consumption must not partially consume the other inventory component.");
      assert.deepEqual((await request(owner, `${base}/adventure/play?${own}`)).journal, beforeFailure.journal, "An insufficient final component must create no result or private journal receipt.");
      await adjust(5);
      const finalInput = step(paidDocument.checkpoints[1]);
      paidRun = (await request(owner, `${path}/checkpoint`, { method: "POST", body: finalInput })).run;
      assert.equal(paidRun.status, "succeeded");
      const replay = await request(owner, `${path}/checkpoint`, { method: "POST", body: finalInput });
      assert.equal(replay.run.result.journalId, paidRun.result.journalId);
      await request(owner, `${base}/sigil/start`, { method: "POST", body: { ...input, requestId: randomUUID() }, status: 409 });
      const after = await request(owner, `${base}/bazaar?${own}`);
      assert.equal(after.balances.find((row) => row.resourceId === resourceId).quantity, 3, "Successful completion and all retries must consume exactly two fictional charges.");
      assert.equal((await request(owner, `${base}/characters/${characterId}/inventory`)).inventory.find((item) => item.id === coil.id).quantity, 1, "Successful completion and all retries must consume exactly one inventory component.");
      pass("SIGIL final component failure rolls back the checkpoint, inventory, flags and journal; successful retries consume each agreed component exactly once");
    }
    // A second host exercises cancellation/retry and the reasoned staff override.
    const peerInventory = (await request(player, `${base}/characters/${peer.character.id}/inventory`)).inventory;
    const peerInput = startInput(challenge, challengeDocument, peer.character, peerInventory);
    let peerRun = (await request(player, `${base}/sigil/start`, { method: "POST", body: peerInput, status: 201 })).run;
    peerRun = (await request(player, `${base}/sigil/runs/${peerRun.id}/cancel`, { method: "POST", body: { requestId: randomUUID(), characterId: peer.character.id, version: peerRun.version } })).run;
    assert.equal(peerRun.status, "cancelled");
    peerRun = (await request(player, `${base}/sigil/start`, { method: "POST", body: { ...peerInput, requestId: randomUUID() }, status: 201 })).run;
    peerRun = (await request(owner, `${base}/sigil/runs/${peerRun.id}/operate`, { method: "POST", body: { requestId: randomUUID(), version: peerRun.version, operation: "succeed", reason: "Organizer observed the group complete the in-person sequence." } })).run;
    assert.equal(peerRun.status, "succeeded", "A reasoned staff override must create one normal authoritative outcome.");
    assert.ok(peerRun.history.some((entry) => JSON.stringify(entry).includes("Organizer observed")), "Staff intervention must retain its explicit reason in run history.");
    pass(`${theme} SIGIL and STATIC: two roles, three checkpoints, frozen event/host pauses, current reconnect state, one result, conditional fictional readings, immutable collection, and audited staff controls`);
    return { event, challengeId: challenge.id, challengeTitle: challengeDocument.title, challengeCode: challenge.code, signalId: signalEntry.id, signalCode: signalEntry.code, signalTitle: staticDocument.title, runId: completedRun.id, result: completedRun.result, peerRunId: peerRun.id, readingId: collected.reading.id };
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
      const completedExchange = theme === "fantasy" ? await exchangeJourney(owner, player, event, assigned, definition, version) : null;
      const completedStory = theme === "fantasy" ? await storyJourney(owner, player, event, assigned) : null;
      const completedEconomy = theme === "fantasy" ? await economyJourney(owner, player, event, assigned) : null;
      const completedInstruments = await instrumentJourney(owner, player, event, assigned, theme);
      event = completedInstruments.event;
      const original = await request(owner, playPath(assigned[0].character));
      const originalInventory = (await request(owner, `/api/events/${event.id}/characters/${assigned[0].character.id}/inventory`)).inventory;
      const originalEconomy = completedEconomy ? await request(owner, `/api/events/${event.id}/bazaar?characterId=${assigned[0].character.id}`) : null;
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
      assert.equal(rehearsalCharacters.length, completedEconomy?.characterCount || 2, "Rehearsal must copy the authored character identities without their play history.");
      assert.ok(rehearsalCharacters.every((character) => character.userId === null && !assigned.some((entry) => entry.character.id === character.id)), "Rehearsal characters must have new identities and await assignment.");
      const { character: rehearsalCharacter } = await request(owner, `/api/events/${rehearsal.id}/characters/${rehearsalCharacters[0].id}/assign`, {
        method: "POST", body: { version: rehearsalCharacters[0].version, userId: owner.id },
      });
      const copiedSigil = await request(owner, `/api/events/${rehearsal.id}/sigil/manage`);
      const copiedStatic = await request(owner, `/api/events/${rehearsal.id}/static/manage`);
      const rehearsalChallenge = copiedSigil.entries.find((entry) => (entry.document || entry.published).title === completedInstruments.challengeTitle);
      const rehearsalSignal = copiedStatic.entries.find((entry) => (entry.document || entry.published).title === completedInstruments.signalTitle);
      assert.ok(rehearsalChallenge && rehearsalSignal, "A rehearsal must copy its authored cooperative and fictional prop definitions.");
      assert.notEqual(rehearsalChallenge.id, completedInstruments.challengeId);
      assert.notEqual(rehearsalChallenge.code, completedInstruments.challengeCode, "A copied challenge must receive a fresh printed prop code.");
      assert.notEqual(rehearsalSignal.id, completedInstruments.signalId);
      assert.notEqual(rehearsalSignal.code, completedInstruments.signalCode, "A copied signal must receive a fresh zone/prop code.");
      assert.equal(copiedSigil.runs.length, 0, "A rehearsal must not inherit original role assignments, timers, runs or outcomes.");
      assert.equal(rehearsalSignal.override?.stateId ?? null, null, "A rehearsal must not copy staff's live signal override.");
      assert.equal((await request(owner, `/api/events/${rehearsal.id}/static?characterId=${rehearsalCharacter.id}`)).readings.length, 0, "A rehearsal must not inherit original private signal readings.");
      let rehearsalInstrumentRun;
      let rehearsalEconomy;
      if (completedEconomy) {
        const copied = await request(owner, `/api/events/${rehearsal.id}/bazaar?characterId=${rehearsalCharacter.id}`);
        assert.ok(copied.balances.every((entry) => entry.quantity === 0), "A rehearsal must begin with zero fictional balances.");
        assert.equal(copied.receipts.length, 0, "A rehearsal must not inherit source economic receipts.");
        assert.equal((await request(owner, `/api/events/${rehearsal.id}/oaths?characterId=${rehearsalCharacter.id}`)).agreements.length, 0, "A rehearsal must not inherit private source agreements.");
        const shop = copied.shops.find((entry) => entry.name === "Staging supply stall");
        const stock = shop.stock.find((entry) => entry.name === "Staging trade lantern");
        assert.notEqual(shop.id, completedEconomy.shopId, "A copied shop must have a fresh identity.");
        assert.notEqual(stock.id, completedEconomy.stockId, "Copied stock must have a fresh identity.");
        assert.equal(stock.quantity, 3, "A rehearsal must copy authored initial stock, not the source's remaining stock.");
        rehearsalEconomy = { shop, stock, inventory: (await request(owner, `/api/events/${rehearsal.id}/characters/${rehearsalCharacter.id}/inventory`)).inventory };
      }
      let rehearsalStory;
      if (completedStory) {
        const storyBase = `/api/events/${rehearsal.id}/story`;
        const copied = await request(owner, `${storyBase}/manage`);
        assert.ok(copied.entries.every((entry) => !completedStory.rumors.some((original) => original.id === entry.id)), "Rehearsal story entries must receive new identifiers.");
        const oldCharacterIds = assigned.map((p) => p.character.id);
        const copiedCharacterIds = rehearsalCharacters.map((c) => c.id);
        for (const entry of copied.entries) {
          if (entry.document.audience.type === "private")
            assert.ok(entry.document.audience.ids.every((id) => copiedCharacterIds.includes(id) && !oldCharacterIds.includes(id)), "Rehearsal private audiences must remap to its own character identities.");
          if (entry.document.audience.type === "faction")
            assert.ok(entry.document.audience.ids.every((id) => copied.factions.some((f) => f.id === id)), "Rehearsal faction audiences must remap to copied factions.");
        }
        assert.ok(copied.groups.every((group) => group.characterIds.every((id) => copiedCharacterIds.includes(id))), "Rehearsal groups must contain only remapped character identities.");
        assert.equal((await request(owner, `/api/events/${rehearsal.id}/trace?characterId=${rehearsalCharacter.id}`)).records.length, 0, "Rehearsal copies must not copy private or shared player investigations.");
        assert.equal((await request(owner, `${storyBase}/play?characterId=${rehearsalCharacter.id}`)).readings.length, 0, "Rehearsal copies must not inherit collected rumor snapshots.");
        let entry = (await request(owner, `${storyBase}/entries`, { method: "POST", body: { requestId: randomUUID(), kind: "rumor", document: { ...defaultStoryDocument(), title: "Rehearsal gated witness", body: "A collected witness account used only in the disposable rehearsal.", conditions: { completed: [relic.id], flags: [], skills: [], statuses: [] } } }, status: 201 })).entry;
        entry = (await request(owner, `${storyBase}/entries/${entry.id}/publish`, { method: "POST", body: { requestId: randomUUID(), version: entry.version } })).entry;
        assert.ok(!(await request(owner, `${storyBase}/play?characterId=${rehearsalCharacter.id}`)).rumors.some((r) => r.id === entry.id), "A published rumor must remain hidden until its discovery condition is met.");
        rehearsalStory = { entry, groupIds: copied.groups.map((g) => g.id) };
      }
      const rehearsalRelic = rehearsalManage.definition.nodes.find((node) => node.id === relic.id);
      await request(owner, `${rehearsalBase}/action`, {
        method: "POST", body: { requestId: randomUUID(), version: rehearsalManage.version, characterId: rehearsalCharacter.id, nodeId: rehearsalRelic.id, kind: "examine", examId: exam.id, code: rehearsalRelic.code },
      });
      const rehearsalPlayPath = `${rehearsalBase}/play?characterId=${rehearsalCharacter.id}`;
      assert.ok((await request(owner, rehearsalPlayPath)).journal.length > 0, "The rehearsal reset check must clear actual persisted play.");
      {
        const instrumentBase = `/api/events/${rehearsal.id}`;
        const doc = rehearsalChallenge.published || rehearsalChallenge.document;
        const items = (await request(owner, `${instrumentBase}/characters/${rehearsalCharacter.id}/inventory`)).inventory;
        const input = { requestId: randomUUID(), characterId: rehearsalCharacter.id, entryId: rehearsalChallenge.id, publishedVersion: rehearsalChallenge.publishedVersion, code: rehearsalChallenge.code, roles: doc.roles.map((role, index) => ({ roleId: role.id, performer: `Rehearsal participant ${index + 1}` })), bindings: doc.components.filter((component) => component.kind === "item").map((component) => ({ componentId: component.id, itemId: items.find((item) => item.name === component.itemName).id })) };
        rehearsalInstrumentRun = (await request(owner, `${instrumentBase}/sigil/start`, { method: "POST", body: input, status: 201 })).run;
        while (rehearsalInstrumentRun.currentCheckpoint) {
          const checkpoint = doc.checkpoints.find((entry) => entry.id === rehearsalInstrumentRun.currentCheckpoint.id);
          if (rehearsalInstrumentRun.checkpointRemainingMs > 0) await delay(rehearsalInstrumentRun.checkpointRemainingMs + 100);
          rehearsalInstrumentRun = (await request(owner, `${instrumentBase}/sigil/runs/${rehearsalInstrumentRun.id}/checkpoint`, { method: "POST", body: { requestId: randomUUID(), characterId: rehearsalCharacter.id, version: rehearsalInstrumentRun.version, checkpointId: checkpoint.id, roleId: checkpoint.roleId, answer: checkpoint.answer || "" } })).run;
        }
        assert.equal(rehearsalInstrumentRun.status, "succeeded", "The reset gate must include an actually completed copied challenge.");
        const current = (await request(owner, `${instrumentBase}/static/lookup`, { method: "POST", body: { characterId: rehearsalCharacter.id, code: rehearsalSignal.code } })).signal;
        assert.equal(current.source, "conditions", "Copied challenge outcomes must drive their copied fictional signal rules.");
        await request(owner, `${instrumentBase}/static/collect`, { method: "POST", body: { requestId: randomUUID(), characterId: rehearsalCharacter.id, entryId: rehearsalSignal.id, code: rehearsalSignal.code, publicationVersion: current.publicationVersion, readingKey: current.readingKey } });
        const states = (rehearsalSignal.published || rehearsalSignal.document).states;
        await request(owner, `${instrumentBase}/static/entries/${rehearsalSignal.id}/state`, { method: "POST", body: { requestId: randomUUID(), version: rehearsalSignal.override?.version || 0, stateId: states.find((state) => state.id !== current.state.id).id, reason: "Create an actual disposable staff override before resetting rehearsal state." } });
        assert.ok((await request(owner, `${instrumentBase}/static?characterId=${rehearsalCharacter.id}`)).readings.length > 0, "Rehearsal reset must clear an actually collected signal snapshot.");
      }
      if (rehearsalStory) {
        const storyBase = `/api/events/${rehearsal.id}/story`;
        const available = await request(owner, `${storyBase}/play?characterId=${rehearsalCharacter.id}`);
        assert.ok(available.rumors.some((r) => r.id === rehearsalStory.entry.id), "An actual prop discovery must unlock its related published rumor.");
        const { reading } = await request(owner, `${storyBase}/collect`, { method: "POST", body: { requestId: randomUUID(), characterId: rehearsalCharacter.id, entryId: rehearsalStory.entry.id, publicationVersion: rehearsalStory.entry.publishedVersion } });
        await request(owner, `/api/events/${rehearsal.id}/trace`, { method: "POST", body: { requestId: randomUUID(), characterId: rehearsalCharacter.id, document: { kind: "theory", title: "Rehearsal private theory", notes: "Disposable investigation state to verify a real reset.", audience: { type: "private", ids: [] }, sources: [reading.id], links: [] } }, status: 201 });
        assert.equal((await request(owner, `/api/events/${rehearsal.id}/trace?characterId=${rehearsalCharacter.id}`)).records.length, 1, "Rehearsal reset must exercise an actually saved investigation record.");
      }
      let rehearsalExchange;
      if (completedExchange) {
        const exchangeBase = `/api/events/${rehearsal.id}/exchanges`;
        const beforeExchange = await request(owner, `${exchangeBase}?characterId=${rehearsalCharacter.id}`);
        assert.equal(beforeExchange.sessions.length, 0, "A rehearsal copy must not inherit source exchange sessions.");
        assert.equal(beforeExchange.contacts.length, 0, "A rehearsal copy must not inherit source contacts.");
        const { invitation } = await request(owner, `/api/events/${rehearsal.id}/invites`, { method: "POST", body: { role: "player", maxUses: 1 }, status: 201 });
        await request(player, "/api/events/join", { method: "POST", body: { code: invitation.code } });
        const { character: rehearsalPeer } = await request(owner, `/api/events/${rehearsal.id}/characters/${rehearsalCharacters[1].id}/assign`, {
          method: "POST", body: { version: rehearsalCharacters[1].version, userId: player.id },
        });
        rehearsalExchange = (await request(owner, exchangeBase, { method: "POST", body: { requestId: randomUUID(), characterId: rehearsalCharacter.id }, status: 201 })).exchange;
        rehearsalExchange = (await request(player, `${exchangeBase}/join`, { method: "POST", body: { requestId: randomUUID(), characterId: rehearsalPeer.id, code: rehearsalExchange.code } })).exchange;
        for (const [account, character] of [[owner, rehearsalCharacter], [player, rehearsalPeer]])
          await request(account, `${exchangeBase}/${rehearsalExchange.id}/confirm`, { method: "POST", body: { requestId: randomUUID(), characterId: character.id, version: rehearsalExchange.version } });
        assert.equal((await request(owner, `${exchangeBase}?characterId=${rehearsalCharacter.id}`)).contacts.length, 1, "The rehearsal reset check must include an actual completed exchange and contact.");
        if (rehearsalEconomy) {
          const marketBase = `/api/events/${rehearsal.id}/bazaar`;
          await request(owner, `${marketBase}/adjust`, { method: "POST", body: { requestId: randomUUID(), characterId: rehearsalCharacter.id, resourceId: completedEconomy.resourceId, quantity: 10, version: 0, reason: "Give the rehearsal character disposable purchase funds." } });
          await request(owner, `${marketBase}/purchase`, { method: "POST", body: { requestId: randomUUID(), characterId: rehearsalCharacter.id, shopId: rehearsalEconomy.shop.id, stockId: rehearsalEconomy.stock.id, version: rehearsalEconomy.stock.version, quantity: 1 } });
          const played = await request(owner, `${marketBase}?characterId=${rehearsalCharacter.id}`);
          assert.ok(played.receipts.length > 0 && played.balances.some((entry) => entry.quantity > 0), "Reset must exercise actually spent stock, credited funds and committed receipts.");
          assert.equal(played.shops.find((entry) => entry.id === rehearsalEconomy.shop.id).stock.find((entry) => entry.id === rehearsalEconomy.stock.id).quantity, 2);
          const { agreement } = await request(owner, `/api/events/${rehearsal.id}/oaths`, { method: "POST", body: { requestId: randomUUID(), characterId: rehearsalCharacter.id, title: "Disposable rehearsal compact", terms: "This agreement exists only to verify reset isolation.", participantIds: [rehearsalCharacter.id, rehearsalPeer.id], witnessIds: [], expiresAt: null, settlement: [] }, status: 201 });
          rehearsalEconomy.agreementId = agreement.id;
        }
      }
      await request(owner, `${base}/reset`, { method: "POST", body: { version, confirm: true }, status: 409 });
      await request(owner, `${rehearsalBase}/reset`, { method: "POST", body: { version: rehearsalManage.version, confirm: true } });
      rehearsalManage = await request(owner, `${rehearsalBase}/manage`);
      assert.ok(rehearsalManage.version > version, "A rehearsal reset must advance the adventure version.");
      assert.equal((await request(owner, rehearsalPlayPath)).journal.length, 0, "A rehearsal reset must remove its journal and play state.");
      {
        const instrumentBase = `/api/events/${rehearsal.id}`;
        assert.equal((await request(owner, `${instrumentBase}/sigil?characterId=${rehearsalCharacter.id}`)).runs.length, 0, "Rehearsal reset must clear actual cooperative roles, timers, checkpoints and outcomes.");
        await request(owner, `${instrumentBase}/sigil/runs/${rehearsalInstrumentRun.id}?characterId=${rehearsalCharacter.id}`, { status: 404 });
        assert.equal((await request(owner, `${instrumentBase}/static?characterId=${rehearsalCharacter.id}`)).readings.length, 0, "Rehearsal reset must clear collected signal snapshots and replay records.");
        const signal = (await request(owner, `${instrumentBase}/static/manage`)).entries.find((entry) => entry.id === rehearsalSignal.id);
        assert.equal(signal.override?.stateId ?? null, null, "Rehearsal reset must clear the actual staff signal override.");
        assert.equal(signal.code, rehearsalSignal.code, "Reset must preserve authored copied prop identities and codes.");
        const preserved = (await request(owner, `${instrumentBase}/sigil/manage`)).entries.find((entry) => entry.id === rehearsalChallenge.id);
        assert.equal(preserved.code, rehearsalChallenge.code, "Reset must preserve the authored copied challenge code.");
        assert.deepEqual((await request(owner, `/api/events/${event.id}/sigil/runs/${completedInstruments.runId}?characterId=${assigned[0].character.id}`)).run.result, completedInstruments.result, "A copied rehearsal reset must preserve the original completed cooperative receipt.");
        assert.ok((await request(owner, `/api/events/${event.id}/static?characterId=${assigned[0].character.id}`)).readings.some((reading) => reading.id === completedInstruments.readingId), "A copied rehearsal reset must preserve the original captured fictional reading.");
        pass(`${theme} instrument rehearsal: fresh authored props, actual cooperative outcome and collected signal, reset runtime and staff override, source receipt unchanged`);
      }
      if (rehearsalExchange) {
        const afterReset = await request(owner, `/api/events/${rehearsal.id}/exchanges?characterId=${rehearsalCharacter.id}`);
        assert.equal(afterReset.sessions.length, 0, "Rehearsal reset must remove completed exchange sessions and receipts.");
        assert.equal(afterReset.contacts.length, 0, "Rehearsal reset must remove contacts created during rehearsal.");
        await request(owner, `/api/events/${rehearsal.id}/exchanges/${rehearsalExchange.id}?characterId=${rehearsalCharacter.id}`, { status: 404 });
      }
      if (rehearsalEconomy) {
        const afterReset = await request(owner, `/api/events/${rehearsal.id}/bazaar?characterId=${rehearsalCharacter.id}`);
        assert.ok(afterReset.balances.every((entry) => entry.quantity === 0), "Rehearsal reset must zero disposable balances.");
        assert.equal(afterReset.receipts.length, 0, "Rehearsal reset must clear disposable economic receipts.");
        assert.equal(afterReset.shops.find((entry) => entry.id === rehearsalEconomy.shop.id).stock.find((entry) => entry.id === rehearsalEconomy.stock.id).quantity, 3, "Reset must restore authored shop stock.");
        const restoredInventory = (await request(owner, `/api/events/${rehearsal.id}/characters/${rehearsalCharacter.id}/inventory`)).inventory;
        const contents = (rows) => rows.map(({ id, name, quantity, notes }) => ({ id, name, quantity, notes })).sort((a, b) => a.id.localeCompare(b.id));
        assert.deepEqual(contents(restoredInventory), contents(rehearsalEconomy.inventory), "Reset must restore the captured initial inventory and remove purchased or transferred items.");
        assert.equal((await request(owner, `/api/events/${rehearsal.id}/oaths?characterId=${rehearsalCharacter.id}`)).agreements.length, 0, "Reset must clear actually created agreements and their histories.");
        await request(owner, `/api/events/${rehearsal.id}/oaths/${rehearsalEconomy.agreementId}?characterId=${rehearsalCharacter.id}`, { status: 404 });
        assert.deepEqual(await request(owner, `/api/events/${event.id}/bazaar?characterId=${assigned[0].character.id}`), originalEconomy, "Rehearsal reset must leave every source balance, stock line and transaction unchanged.");
        const originalAgreement = (await request(owner, `/api/events/${event.id}/oaths/${completedEconomy.agreementId}?characterId=${assigned[0].character.id}`)).agreement;
        assert.equal(originalAgreement.status, "adjudicated", "Rehearsal reset must preserve the source agreement and its ruling.");
        pass("Economy rehearsal copies reset to initial stock, zero balances and no agreements; actual purchases and agreements reset to baseline inventory while the source remains intact");
      }
      if (rehearsalStory) {
        const storyBase = `/api/events/${rehearsal.id}/story`;
        const afterReset = await request(owner, `${storyBase}/play?characterId=${rehearsalCharacter.id}`);
        assert.equal(afterReset.readings.length, 0, "Rehearsal reset must remove collected rumors and their replay state.");
        assert.ok(!afterReset.rumors.some((r) => r.id === rehearsalStory.entry.id), "Reset discovery conditions must again hide the gated rumor.");
        assert.equal((await request(owner, `/api/events/${rehearsal.id}/trace?characterId=${rehearsalCharacter.id}`)).records.length, 0, "Rehearsal reset must remove player investigation state.");
        const authored = await request(owner, `${storyBase}/manage`);
        assert.ok(authored.entries.some((r) => r.id === rehearsalStory.entry.id && r.hasPublication), "Reset must retain authored rumor definitions and explicit publications.");
        assert.deepEqual(authored.groups.map((g) => g.id).sort(), rehearsalStory.groupIds.sort(), "Reset must retain authored audience groups.");
        assert.ok((await request(owner, `/api/events/${event.id}/trace?characterId=${assigned[0].character.id}`)).records.some((r) => r.id === completedStory.ownerPrivateTraceId), "Reset must preserve the original player's private investigation.");
        pass("Story rehearsal copies remap audiences, exclude original player work, unlock rumors through real discoveries, and reset only disposable play state");
      }
      assert.ok(isDeepStrictEqual((await request(owner, playPath(assigned[0].character))).journal, original.journal), "Resetting a rehearsal must preserve the original event's journal.");
      assert.ok(isDeepStrictEqual((await request(owner, `/api/events/${event.id}/characters/${assigned[0].character.id}/inventory`)).inventory, originalInventory), "Resetting a rehearsal must preserve original character inventory.");
      await request(owner, `/api/events/${event.id}/members/${player.id}`, { method: "DELETE" });
      await request(player, playPath(assigned[1].character), { status: 404 });
      await act(player, assigned[1].character, scene, "join", {}, { status: 404 });
      await request(player, `/api/events/${event.id}/sigil/runs/${completedInstruments.peerRunId}?characterId=${assigned[1].character.id}`, { status: 404 });
      await request(player, `/api/events/${event.id}/static?characterId=${assigned[1].character.id}`, { status: 404 });
      if (completedStory) {
        await request(player, `/api/events/${event.id}/story/play?characterId=${assigned[1].character.id}`, { status: 404 });
        await request(player, `/api/events/${event.id}/trace?characterId=${assigned[1].character.id}`, { status: 404 });
      }
      if (completedExchange) {
        await request(player, `/api/events/${event.id}/exchanges/${completedExchange}?characterId=${assigned[1].character.id}`, { status: 404 });
        const retained = (await request(owner, `/api/events/${event.id}/exchanges/${completedExchange}?characterId=${assigned[0].character.id}`)).exchange;
        assert.equal(retained.status, "completed", "A completed receipt must remain available to its authorized owner after the peer leaves.");
        assert.ok(retained.receipt, "Peer departure must not erase already completed exchange receipts.");
      }
      if (completedEconomy) {
        await request(player, `/api/events/${event.id}/bazaar?characterId=${assigned[1].character.id}`, { status: 404 });
        await request(player, `/api/events/${event.id}/oaths/${completedEconomy.agreementId}?characterId=${assigned[1].character.id}`, { status: 404 });
        const retained = (await request(owner, `/api/events/${event.id}/oaths/${completedEconomy.agreementId}?characterId=${assigned[0].character.id}`)).agreement;
        assert.equal(retained.status, "adjudicated", "A participant's departure must preserve an authorized counterpart's agreement history.");
        assert.ok(retained.receipt, "A completed agreement receipt must survive peer departure for its authorized owner.");
        const trade = (await request(owner, `/api/events/${event.id}/exchanges/${completedEconomy.tradeId}?characterId=${assigned[0].character.id}`)).exchange;
        assert.ok(trade.receipt.assets.transactionId, "Spent items and peer departure must not invalidate a completed trade receipt.");
      }
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
