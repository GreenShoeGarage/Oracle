import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./database.js";
import { migrate } from "../src/db.js";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { defaultSetup } from "../public/kit.js";
import { defaultCharacterProfile } from "../public/characters-model.js";
import { defaultAdventure, defaultAdventureNode, validateAdventure } from "../public/adventure-model.js";
import { ADVENTURE_TEMPLATES, buildAdventureTemplate } from "../src/adventure-templates.js";

let database, pool, server, origin;
const users = {};
const tokens = ["AAAAAAAAAAAAAAAAAAAA", "BBBBBBBBBBBBBBBBBBBB", "CCCCCCCCCCCCCCCCCCCC", "DDDDDDDDDDDDDDDDDDDD", "EEEEEEEEEEEEEEEEEEEE"];
const secrets = { examination: "SECRET examination crown-map", message: "SECRET courier-message cobalt", answer: "SECRET-answer-meridian", hint: "SECRET hint westward", success: "SECRET puzzle success amber", failure: "SECRET puzzle failure violet", notes: "SECRET organizer decoy", release: "SECRET-release-code" };
async function request(path, method = "GET", data, who = users.owner) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(method !== "GET" ? { "Content-Type": "application/json", Origin: origin } : {}), ...(who?.cookie ? { Cookie: who.cookie } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  const raw = await response.text();
  return { status: response.status, data: raw ? JSON.parse(raw) : null, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
function ok(response, status = 200) { assert.equal(response.status, status, JSON.stringify(response.data)); return response.data; }
const path = (event, action = "play") => `/api/events/${event.id}/adventure/${action}`;
function fixtureDefinition() {
  const relic = { ...defaultAdventureNode("relic", "relic", tokens[0]), title: "A field relic" };
  relic.examinations[0].text = secrets.examination;
  relic.examinations.push({ ...structuredClone(relic.examinations[0]), id: "skilled", label: "Investigate markings", text: "SECRET skilled examination", conditions: { completed: [], flags: [], skills: ["investigation"], statuses: [] } });
  const drop = { ...defaultAdventureNode("dead_drop", "drop", tokens[1]), title: "A sealed message", body: secrets.message, releaseCode: secrets.release };
  drop.conditions.completed = ["relic"];
  const puzzle = { ...defaultAdventureNode("cipherbox", "puzzle", tokens[2]), title: "A coded lock", answer: secrets.answer, maxAttempts: 2, successText: secrets.success, failureText: secrets.failure, hints: [{ text: secrets.hint, afterAttempts: 1 }] };
  puzzle.conditions.completed = ["drop"]; puzzle.actions.success = ["solved"]; puzzle.actions.failure = ["failed"];
  const scene = { ...defaultAdventureNode("wayfinder", "scene", tokens[3]), title: "A gathering", body: "SECRET future scene", maxPlayers: 1 };
  scene.conditions.flags = ["solved"];
  const fallback = { ...defaultAdventureNode("wayfinder", "fallback", tokens[4]), title: "A manual response", body: "SECRET failure scene" }; fallback.conditions.flags = ["failed"];
  return { ...defaultAdventure(), title: "A complete adventure", organizerNotes: secrets.notes, flags: [{ id: "solved", name: "Puzzle solved" }, { id: "failed", name: "Puzzle exhausted" }], nodes: [relic, drop, puzzle, scene, fallback] };
}
async function fixture() {
  const setup = defaultSetup("fantasy", "council"); setup.enabledInstruments = ["briefing", "relic", "dead-drop", "cipherbox", "wayfinder"];
  const event = ok(await request("/api/events", "POST", { name: "Adventure test", setup }), 201).event;
  for (const name of ["one", "two"]) await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'player')", [event.id, users[name].id]);
  const characters = {};
  for (const name of ["one", "two"]) {
    const profile = { ...defaultCharacterProfile(setup.rules), name: `Adventurer ${name}`, skills: name === "one" ? ["investigation"] : [] };
    const created = ok(await request(`/api/events/${event.id}/characters`, "POST", { profile }, users[name]), 201).character;
    await pool.query("UPDATE characters SET status='approved',inventory_initialized=true WHERE id=$1", [created.id]);
    characters[name] = created;
  }
  const managed = ok(await request(path(event, "manage"), "PUT", { version: 0, definition: fixtureDefinition() }));
  await pool.query("UPDATE events SET status='rehearsal' WHERE id=$1", [event.id]);
  return { event, characters, version: managed.version };
}
function payload(f, who, nodeId, kind, extra = {}) { return { requestId: randomUUID(), version: f.version, characterId: f.characters[who].id, nodeId, kind, ...extra }; }
async function act(f, who, nodeId, kind, extra = {}) { return request(path(f.event, "action"), "POST", payload(f, who, nodeId, kind, extra), users[who]); }
async function unlockPuzzle(f, who) { ok(await act(f, who, "relic", "examine", { examId: "examine", code: tokens[0] })); ok(await act(f, who, "drop", "open", { code: secrets.release })); }
async function expireCooldown(f, who) { await pool.query("UPDATE adventure_runs SET progress=jsonb_set(progress,'{puzzle,lastAttemptAt}','\"2000-01-01T00:00:00.000Z\"') WHERE event_id=$1 AND character_id=$2", [f.event.id, f.characters[who].id]); }
function absent(data, values) { const raw = JSON.stringify(data); for (const value of values) assert.ok(!raw.includes(value), `Protected value leaked: ${value}`); }

before(async () => {
  database = await testDatabase(); pool = database.pool; await migrate(pool);
  let handler; server = createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  handler = createApp({ pool, config: { ...readConfig({ DATABASE_URL: "postgres://unused", PORT: "3000" }), origin }, logger: (entry) => console.error(entry) });
  for (const name of ["owner", "one", "two", "outsider"]) { const result = await request("/api/auth/register", "POST", { displayName: `Adventure ${name}`, email: `${name}@adventure.example.test`, password: "Adventure integration passphrase!" }, null); users[name] = { ...ok(result, 201).user, cookie: result.cookie }; }
  console.log(`Adventure integration database: ${database.kind}`);
});
after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); if (database) await database.close(); });

test("adventure validation rejects executable data, unknown references, cycles, duplicate codes and unsafe audio", () => {
  const setup = defaultSetup("fantasy", "council");
  assert.equal(validateAdventure(fixtureDefinition(), setup).nodes.length, 5);
  for (const change of [
    (d) => { d.version = 2; }, (d) => { d.nodes[0].type = "constructor"; }, (d) => { d.nodes[0].type = "__proto__"; }, (d) => { d.nodes[0].type = "toString"; }, (d) => { d.nodes[0].script = "alert(1)"; }, (d) => { d.nodes[1].code = d.nodes[0].code; },
    (d) => { d.nodes[0].conditions.completed = ["missing"]; }, (d) => { d.nodes[0].conditions.completed = ["relic"]; },
    (d) => { d.nodes[0].conditions.completed = ["drop"]; }, (d) => { d.nodes[0].actions.success = ["unknown"]; },
    (d) => { d.nodes[0].conditions.skills = ["unknown"]; }, (d) => { d.nodes[0].examinations[0].text = "<script>"; },
    (d) => { d.nodes[1].audio = "https://example.test/voice.wav"; }, (d) => { d.nodes[1].audio = "data:audio/wav;base64,QUFBQUFBQUFBQUFB"; },
    (d) => { d.nodes[2].hints[0].afterAttempts = 3; }, (d) => { d.nodes[3].maxPlayers = 0; },
    (d) => { d.nodes[3].startsAt = "2026-02-30T00:00:00Z"; },
  ]) { const invalid = fixtureDefinition(); change(invalid); assert.throws(() => validateAdventure(invalid, setup), { status: 400 }); }
  const getter = fixtureDefinition(); Object.defineProperty(getter, "title", { get: () => "bad" }); assert.throws(() => validateAdventure(getter, setup), { status: 400 });
  let getterRan = false; const typeGetter = fixtureDefinition(); Object.defineProperty(typeGetter.nodes[0], "type", { get: () => { getterRan = true; return "relic"; } }); assert.throws(() => validateAdventure(typeGetter, setup), { status: 400 }); assert.equal(getterRan, false);
  const validAudio = fixtureDefinition(); validAudio.nodes[1].audio = `data:audio/wav;base64,${Buffer.from("RIFF0000WAVEfmt ").toString("base64")}`; assert.equal(validateAdventure(validAudio, setup).nodes[1].audio, validAudio.nodes[1].audio);
});

test("player projections and protected prop lookup expose no solutions or unreached readings", async () => {
  const f = await fixture();
  assert.equal((await request(path(f.event, "manage"), "GET", undefined, users.one)).status, 403);
  const before = ok(await request(path(f.event), "GET", undefined, users.one));
  absent(before, [...Object.values(secrets), ...tokens, "conditions", "actions", "flags", "SECRET future scene", "SECRET failure scene"]);
  assert.equal(before.nodes.find((node) => node.id === "drop").locked, true);
  assert.equal((await request(`${path(f.event)}?characterId=${f.characters.one.id}`, "GET", undefined, users.two)).status, 404);
  assert.equal((await request(`${path(f.event)}?preview=true&characterId=${f.characters.one.id}`, "GET", undefined, users.one)).status, 403);
  assert.equal((await request(`${path(f.event, "lookup")}?code=${tokens[1]}`, "GET", undefined, users.one)).status, 403);
  const looked = ok(await request(`${path(f.event, "lookup")}?code=${tokens[0]}`, "GET", undefined, users.one)); assert.equal(looked.focusNodeId, "relic"); absent(looked, [secrets.examination, secrets.answer]);
  assert.equal((await act(f, "one", "relic", "examine", { examId: "examine", code: tokens[1] })).status, 400);
  const read = ok(await act(f, "one", "relic", "examine", { examId: "examine", code: tokens[0] }));
  assert.equal(read.journal[0].text, secrets.examination); absent(read, [secrets.message, secrets.answer, secrets.hint, secrets.success, secrets.failure, secrets.notes]);
  const other = ok(await request(path(f.event), "GET", undefined, users.two)); assert.equal(other.journal.length, 0); absent(other, [secrets.examination]);
  assert.equal((await act(f, "two", "relic", "examine", { examId: "skilled", code: tokens[0] })).status, 403);
});

test("exact requests replay safely, altered payloads conflict, and new requests cannot duplicate discoveries", async () => {
  const f = await fixture();
  const action = payload(f, "one", "relic", "examine", { examId: "examine", code: tokens[0] });
  const first = ok(await request(path(f.event, "action"), "POST", action, users.one));
  const again = ok(await request(path(f.event, "action"), "POST", action, users.one)); assert.equal(again.outcome.replayed, true); assert.deepEqual(again.journal, first.journal);
  assert.equal((await request(path(f.event, "action"), "POST", { ...action, examId: "skilled" }, users.one)).status, 409);
  const repeated = ok(await act(f, "one", "relic", "examine", { examId: "examine", code: tokens[0] })); assert.equal(repeated.journal.length, 1);
  assert.equal((await request(path(f.event, "action"), "POST", { ...payload(f, "one", "drop", "open"), success: true }, users.one)).status, 400);
  await pool.query("DELETE FROM memberships WHERE event_id=$1 AND user_id=$2", [f.event.id, users.one.id]);
  assert.equal((await request(path(f.event, "action"), "POST", action, users.one)).status, 404);
  assert.equal((await request(path(f.event), "GET", undefined, users.one)).status, 404);
});

test("puzzle attempts, requested hints, exhaustion and organizer recovery produce one-time outcomes", async () => {
  const f = await fixture(); await unlockPuzzle(f, "one");
  assert.equal((await act(f, "one", "puzzle", "hint", { hintIndex: 0 })).status, 403);
  let played = ok(await act(f, "one", "puzzle", "attempt", { answer: "wrong" }));
  absent(played, [secrets.answer, secrets.hint, secrets.success, secrets.failure]); assert.equal(played.nodes.find((node) => node.id === "puzzle").attempts, 1);
  assert.equal((await act(f, "one", "puzzle", "attempt", { answer: "still wrong" })).status, 429);
  played = ok(await act(f, "one", "puzzle", "hint", { hintIndex: 0 })); assert.equal(played.nodes.find((node) => node.id === "puzzle").hints[0].text, secrets.hint);
  await expireCooldown(f, "one"); played = ok(await act(f, "one", "puzzle", "attempt", { answer: "still wrong" }));
  assert.equal(played.nodes.find((node) => node.id === "puzzle").failed, true); assert.equal(played.nodes.find((node) => node.id === "fallback").locked, false); assert.ok(played.journal.some((entry) => entry.text === secrets.failure));
  assert.equal((await act(f, "one", "puzzle", "attempt", { answer: secrets.answer })).status, 409);
  const override = payload(f, "one", "puzzle", "reset_attempts");
  assert.equal((await request(path(f.event, "override"), "POST", override, users.one)).status, 403);
  const reset = ok(await request(path(f.event, "override"), "POST", override)); assert.equal(reset.preview, true); assert.equal(reset.readOnly, true); assert.equal(reset.nodes.find((node) => node.id === "puzzle").attempts, 0);
  played = ok(await act(f, "one", "puzzle", "attempt", { answer: secrets.answer.toUpperCase() })); assert.ok(played.journal.some((entry) => entry.text === secrets.success)); assert.equal(played.nodes.find((node) => node.id === "scene").locked, false);
  const duplicate = ok(await act(f, "one", "puzzle", "attempt", { answer: "anything" })); assert.equal(duplicate.journal.length, played.journal.length);
  const audits = (await pool.query("SELECT details FROM audit_entries WHERE event_id=$1", [f.event.id])).rows; absent(audits, [...Object.values(secrets), ...tokens]);
});

test("scene capacity is atomic across players and leave/rejoin cannot duplicate journal or flags", async () => {
  const f = await fixture();
  for (const who of ["one", "two"]) ok(await request(path(f.event, "override"), "POST", payload(f, who, "puzzle", "solve")));
  const joined = await Promise.all([act(f, "one", "scene", "join"), act(f, "two", "scene", "join")]); assert.deepEqual(joined.map((r) => r.status).sort(), [200, 409]);
  const winner = joined[0].status === 200 ? "one" : "two", loser = winner === "one" ? "two" : "one";
  const before = ok(await request(path(f.event), "GET", undefined, users[winner]));
  ok(await act(f, winner, "scene", "leave")); ok(await act(f, loser, "scene", "join")); ok(await act(f, loser, "scene", "leave"));
  const rejoined = ok(await act(f, winner, "scene", "join")); assert.equal(rejoined.journal.length, before.journal.length);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM adventure_attendance WHERE event_id=$1 AND node_id='scene'", [f.event.id])).rows[0].n, 1);
});

test("event lifecycle, approved ownership, disabled instruments and preview enforce read-only boundaries", async () => {
  const f = await fixture();
  const beforeCounts = (await pool.query("SELECT (SELECT count(*) FROM adventure_runs)::int AS runs,(SELECT count(*) FROM adventure_requests)::int AS requests")).rows[0];
  const preview = ok(await request(`${path(f.event)}?preview=true&characterId=${f.characters.one.id}`)); assert.equal(preview.readOnly, true); absent(preview, [secrets.answer, secrets.examination]);
  assert.deepEqual((await pool.query("SELECT (SELECT count(*) FROM adventure_runs)::int AS runs,(SELECT count(*) FROM adventure_requests)::int AS requests")).rows[0], beforeCounts);
  const action = payload(f, "one", "relic", "examine", { examId: "examine", code: tokens[0] }); ok(await request(path(f.event, "action"), "POST", action, users.one));
  await pool.query("UPDATE events SET status='paused' WHERE id=$1", [f.event.id]); assert.equal((await request(path(f.event, "action"), "POST", action, users.one)).status, 409);
  assert.equal(ok(await request(path(f.event), "GET", undefined, users.one)).readOnly, true);
  await pool.query("UPDATE events SET status='rehearsal',setup=jsonb_set(setup,'{enabledInstruments}','[\"briefing\"]') WHERE id=$1", [f.event.id]);
  assert.equal((await act(f, "one", "relic", "examine", { examId: "examine", code: tokens[0] })).status, 404);
  assert.equal((await request(`${path(f.event, "lookup")}?code=${tokens[0]}`, "GET", undefined, users.one)).status, 404);
  assert.deepEqual(ok(await request(path(f.event), "GET", undefined, users.one)).nodes, []);
  await pool.query("UPDATE characters SET status='retired' WHERE id=$1", [f.characters.one.id]); assert.equal((await request(path(f.event, "action"), "POST", action, users.one)).status, 409);
  const retired = ok(await request(`${path(f.event)}?characterId=${f.characters.one.id}`, "GET", undefined, users.one)); assert.equal(retired.readOnly, true); assert.equal(retired.journal.length, 1); assert.deepEqual(retired.nodes, []);
});

test("definition editing is optimistic and freezes once state exists; rehearsal reset cannot touch source", async () => {
  const f = await fixture();
  assert.equal((await request(path(f.event, "manage"), "PUT", { version: 0, definition: fixtureDefinition() })).status, 409);
  ok(await act(f, "one", "relic", "examine", { examId: "examine", code: tokens[0] }));
  assert.equal((await request(path(f.event, "manage"), "PUT", { version: f.version, definition: fixtureDefinition() })).status, 409);
  assert.equal((await request(path(f.event, "reset"), "POST", { version: f.version, confirm: true })).status, 409);
  const copied = ok(await request(path(f.event, "rehearsal"), "POST", {}), 201).event;
  assert.notEqual(copied.id, f.event.id); assert.equal(copied.status, "rehearsal");
  const managed = ok(await request(path(copied, "manage"))); assert.equal(managed.isRehearsal, true); assert.equal(managed.sourceEventId, f.event.id); assert.equal(managed.progress.length, 0); assert.equal(managed.characters.length, 2); assert.ok(managed.characters.every((character) => character.status === "approved" && character.userId === null));
  assert.ok(managed.definition.nodes.every((node, i) => node.code !== tokens[i]));
  const character = managed.characters[0];
  ok(await request(path(copied, "override"), "POST", { requestId: randomUUID(), version: managed.version, characterId: character.id, nodeId: "relic", kind: "release" }));
  const reset = ok(await request(path(copied, "reset"), "POST", { version: managed.version, confirm: true })); assert.equal(reset.version, managed.version + 1); assert.equal(reset.progress.length, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM adventure_journal WHERE event_id=$1", [copied.id])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM adventure_journal WHERE event_id=$1", [f.event.id])).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM memberships WHERE event_id=$1", [copied.id])).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM invitations WHERE event_id=$1", [copied.id])).rows[0].n, 0);
});

test("a dedicated rehearsal promoted to live cannot reset its progress or return to rehearsal", async () => {
  const f = await fixture();
  const copied = ok(await request(path(f.event, "rehearsal"), "POST", {}), 201).event;
  const managed = ok(await request(path(copied, "manage")));
  assert.equal(managed.isRehearsal, true);
  const character = managed.characters[0];
  ok(await request(path(copied, "override"), "POST", { requestId: randomUUID(), version: managed.version, characterId: character.id, nodeId: "relic", kind: "release" }));
  const live = ok(await request(`/api/events/${copied.id}`, "PATCH", { version: copied.version, status: "live" })).event;
  assert.equal(live.status, "live");
  const snapshot = async () => ({
    event: ok(await request(`/api/events/${copied.id}`)).event,
    adventure: ok(await request(path(copied, "manage"))),
    journal: (await pool.query("SELECT * FROM adventure_journal WHERE event_id=$1 ORDER BY id", [copied.id])).rows,
    runs: (await pool.query("SELECT * FROM adventure_runs WHERE event_id=$1 ORDER BY character_id", [copied.id])).rows,
    requests: (await pool.query("SELECT * FROM adventure_requests WHERE event_id=$1 ORDER BY character_id,request_id", [copied.id])).rows,
    inventory: (await pool.query("SELECT * FROM character_inventory WHERE event_id=$1 ORDER BY id", [copied.id])).rows,
    audit: (await pool.query("SELECT * FROM audit_entries WHERE event_id=$1 ORDER BY id", [copied.id])).rows,
  });
  const before = await snapshot();
  assert.equal(before.journal.length, 1, "The live copy must contain real progress before reset is attempted.");
  assert.equal(before.runs.length, 1);
  assert.equal(before.adventure.version, managed.version, "The reset request uses the current adventure version.");
  assert.equal((await request(path(copied, "reset"), "POST", { version: before.adventure.version, confirm: true })).status, 409);
  assert.equal((await request(`/api/events/${copied.id}`, "PATCH", { version: live.version, status: "rehearsal" })).status, 409);
  assert.deepEqual(await snapshot(), before, "Rejected reset and lifecycle requests must preserve all live progress, replay records, inventory, event versions, and audit history.");
});

test("all three server-only templates create isolated ready-to-assign character adventures", async () => {
  assert.equal((await request("/api/adventure-templates", "GET", undefined, null)).status, 401);
  const catalog = ok(await request("/api/adventure-templates")); assert.equal(catalog.templates.length, 3);
  for (const meta of ADVENTURE_TEMPLATES) {
    const built = buildAdventureTemplate(meta.id); validateAdventure(built.definition, built.setup);
    absent(catalog, built.definition.nodes.filter((node) => node.type === "cipherbox").map((node) => node.answer));
    const created = ok(await request(`/api/adventure-templates/${meta.id}`, "POST", {}), 201).event;
    assert.equal(created.status, "draft"); assert.equal(created.setup.theme.id, meta.id);
    const managed = ok(await request(path(created, "manage"))); assert.equal(managed.characters.length, 2); assert.equal(managed.definition.nodes.length, 5); assert.equal(managed.version, 1);
    assert.ok(managed.characters.every((character) => character.userId === null && character.status === "approved"));
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM adventure_runs WHERE event_id=$1", [created.id])).rows[0].n, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM character_inventory WHERE event_id=$1", [created.id])).rows[0].n, built.characters.reduce((n, character) => n + character.profile.startingEquipment.length, 0));
    const noCharacter = ok(await request(path(created))); assert.equal(noCharacter.readOnly, true); assert.deepEqual(noCharacter.nodes, []);
    assert.equal((await request("/adventure-templates.js", "GET", undefined, null)).status, 404);
  }
});


test("event lifecycle conditions gate discoveries and future scenes cannot be joined early", async () => {
  const f = await fixture(), definition = fixtureDefinition();
  definition.nodes[0].conditions.statuses = ["live"];
  definition.nodes[3].startsAt = "2099-01-01T00:00:00.000Z";
  f.version = ok(await request(path(f.event, "manage"), "PUT", { version: f.version, definition })).version;
  assert.equal(ok(await request(path(f.event), "GET", undefined, users.one)).nodes[0].locked, true);
  assert.equal((await act(f, "one", "relic", "examine", { examId: "examine", code: tokens[0] })).status, 403);
  await pool.query("UPDATE events SET status='live' WHERE id=$1", [f.event.id]);
  ok(await act(f, "one", "relic", "examine", { examId: "examine", code: tokens[0] }));
  ok(await request(path(f.event, "override"), "POST", payload(f, "one", "puzzle", "solve")));
  const played = ok(await request(path(f.event), "GET", undefined, users.one));
  assert.equal(played.nodes.find((node) => node.id === "scene").availability, "scheduled");
  assert.equal((await act(f, "one", "scene", "join")).status, 409);
  await pool.query("UPDATE characters SET status='draft' WHERE id=$1", [f.characters.one.id]);
  const draft = ok(await request(`${path(f.event)}?characterId=${f.characters.one.id}`, "GET", undefined, users.one));
  assert.equal(draft.readOnly, true); assert.deepEqual(draft.nodes, []); assert.equal(draft.journal.length, 2); absent(draft, ["SECRET future scene"]);
});

test("revoked or unapproved scene reservations release capacity and cannot later resurrect", async () => {
  const f = await fixture();
  for (const who of ["one", "two"]) ok(await request(path(f.event, "override"), "POST", payload(f, who, "puzzle", "solve")));
  ok(await act(f, "one", "scene", "join"));
  await pool.query("DELETE FROM memberships WHERE event_id=$1 AND user_id=$2", [f.event.id, users.one.id]);
  const available = ok(await request(path(f.event), "GET", undefined, users.two)); assert.equal(available.nodes.find((node) => node.id === "scene").attendanceCount, 0);
  ok(await act(f, "two", "scene", "join"));
  await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'player')", [f.event.id, users.one.id]);
  const restored = ok(await request(path(f.event), "GET", undefined, users.one)); assert.equal(restored.nodes.find((node) => node.id === "scene").joined, false); assert.equal(restored.nodes.find((node) => node.id === "scene").attendanceCount, 1);
  assert.equal((await act(f, "one", "scene", "join")).status, 409);
  await pool.query("UPDATE characters SET status='draft' WHERE id=$1", [f.characters.two.id]);
  ok(await act(f, "one", "scene", "join"));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM adventure_attendance WHERE event_id=$1", [f.event.id])).rows[0].n, 1);
});

test("rehearsal creation shares factory limits and validates source conditions against current rules", async () => {
  const f = await fixture();
  await pool.query("UPDATE events SET setup=jsonb_set(setup,'{rules,expertise}','[]') WHERE id=$1", [f.event.id]);
  assert.equal((await request(path(f.event, "rehearsal"), "POST", {})).status, 400);
  await pool.query("UPDATE events SET setup=jsonb_set(setup,'{rules,expertise}','[{\"id\":\"investigation\",\"name\":\"Investigation\"}]') WHERE id=$1", [f.event.id]);
  await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'organizer')", [f.event.id, users.outsider.id]);
  for (let n = 0; n < 40; n++) await pool.query("INSERT INTO events(id,owner_user_id,name) VALUES($1,$2,'Factory limit fixture')", [randomUUID(), users.outsider.id]);
  assert.equal((await request(path(f.event, "rehearsal"), "POST", {}, users.outsider)).status, 429);
  assert.equal((await request("/api/adventure-templates/fantasy", "POST", {}, users.outsider)).status, 429);
});
