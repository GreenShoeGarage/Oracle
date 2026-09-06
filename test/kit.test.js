import test from "node:test";
import assert from "node:assert/strict";
import {
  THEMES, TEMPLATES, INSTRUMENTS, defaultSetup, validateTheme, validateSetup,
  projectSetup, validateEventPack, makeEventPack,
} from "../public/kit.js";

const fresh = () => defaultSetup("fantasy", "council");
const event = () => ({
  name: "Lanterns at the border", description: "An evening council.", location: "Old hall",
  starts_at: new Date("2026-10-10T18:30:00Z"), setup: fresh(),
  id: "internal-event-id", owner_user_id: "private-owner", members: [{ email: "private@example.test" }],
  audit: ["private history"], inviteCode: "secret-code", session: "secret-session",
});
const rejects = (value, operation = validateSetup) => assert.throws(() => operation(value), (error) => error.status === 400);

test("built-in themes, templates and unavailable instruments have coherent data", () => {
  assert.deepEqual(THEMES.map((theme) => theme.id), ["fantasy", "cyberpunk", "wasteland"]);
  for (const theme of THEMES) {
    assert.deepEqual(validateTheme(theme), theme);
    assert.equal(theme.sounds.enabled, false);
  }
  for (const template of TEMPLATES) assert.deepEqual(validateSetup(template.setup), template.setup);
  assert.equal(TEMPLATES.length, 4);
  assert.equal(INSTRUMENTS.filter((instrument) => !instrument.available).length, 1);
  assert.deepEqual(INSTRUMENTS.filter((instrument) => instrument.available).map((instrument) => instrument.id), ["briefing", "relic", "dead-drop", "cipherbox", "wayfinder", "trace", "whisper", "broadside", "bazaar", "oathbook", "sigil", "static"]);
  rejects("unknown-theme", defaultSetup);
});

test("switching themes preserves stable rules, content and configuration", () => {
  const setup = fresh();
  const original = structuredClone(setup);
  for (const theme of THEMES) {
    const changed = validateSetup({ ...setup, theme });
    assert.deepEqual(changed.rules, original.rules);
    assert.deepEqual(changed.content, original.content);
    assert.deepEqual(changed.enabledInstruments, original.enabledInstruments);
    assert.equal(changed.templateId, original.templateId);
    changed.content[0].title = "A private working copy";
    changed.theme.tokens.text = "#000000";
  }
  assert.deepEqual(setup, original);
  assert.deepEqual(fresh(), original);
});

test("all available instruments survive setup validation and format-1 pack reuse", () => {
  const selected = INSTRUMENTS.filter(instrument => instrument.available).map(instrument => instrument.id);
  for (const theme of THEMES) {
    const source = event();
    source.setup = validateSetup({ ...source.setup, theme, enabledInstruments: selected });
    for (const audience of ["organizer", "player"]) {
      const restored = validateEventPack(JSON.parse(JSON.stringify(makeEventPack(source, audience))));
      assert.deepEqual(restored.setup.enabledInstruments, selected);
      assert.equal(restored.setup.theme.id, theme.id);
    }
  }
});

test("player and prop projections remove secrets and do not alias organizer data", () => {
  const setup = fresh();
  setup.content.push({ id: "player-note", title: "Pocket note", body: "A player-only handout", visibility: "player", prop: false });
  setup.content.find((entry) => entry.visibility === "organizer").prop = true;
  const player = projectSetup(setup, "player"), prop = projectSetup(setup, "prop");
  assert.deepEqual(player.content.map((entry) => entry.id), ["arrival", "player-note"]);
  assert.deepEqual(prop.content.map((entry) => entry.id), ["arrival"]);
  assert.ok(!JSON.stringify(player).includes("Organizer preparation"));
  assert.deepEqual(projectSetup(setup, "organizer"), setup);
  player.content[0].body = "Changed projection";
  assert.notEqual(setup.content[0].body, player.content[0].body);
  assert.throws(() => projectSetup(setup, "staff"), { status: 400 });
});

test("organizer/player event packs round-trip only permitted event metadata and data", () => {
  for (const audience of ["organizer", "player"]) {
    const pack = makeEventPack(event(), audience);
    assert.deepEqual(validateEventPack(JSON.parse(JSON.stringify(pack))), pack);
    assert.deepEqual(Object.keys(pack.event), ["name", "description", "location", "startsAt"]);
    assert.equal(pack.event.startsAt, "2026-10-10T18:30:00.000Z");
    for (const secret of ["private-owner", "private@example.test", "private history", "secret-code", "secret-session", "internal-event-id"])
      assert.ok(!JSON.stringify(pack).includes(secret));
    assert.equal(pack.setup.content.length, audience === "organizer" ? 2 : 1);
  }
  const forged = makeEventPack(event(), "organizer");
  forged.audience = "player";
  rejects(forged, validateEventPack);
  const legacy = event(); legacy.name = "B < A"; legacy.description = "Literal <brackets>";
  assert.equal(makeEventPack(legacy, "organizer").event.description, "Literal <brackets>");
  const longName = event(); longName.name = "x".repeat(101);
  assert.throws(() => makeEventPack(longName, "organizer"), { status: 400 });
});

test("theme validation rejects executable content, URL assets, extra keys and low contrast", () => {
  const mutations = [
    (theme) => { theme.script = "alert(1)"; },
    (theme) => { theme.name = "<script>alert(1)</script>"; },
    (theme) => { theme.tokens.accent = "red; background:url(https://example.test/track)"; },
    (theme) => { theme.tokens.background = "url(javascript:alert(1))"; },
    (theme) => { theme.tokens.font = "https://example.test/font.woff"; },
    (theme) => { theme.tokens.icon = "<svg onload=alert(1)>"; },
    (theme) => { theme.tokens.texture = "url(https://example.test/texture.png)"; },
    (theme) => { theme.tokens.opacity = 0.2; },
    (theme) => { theme.tokens.text = theme.tokens.panel; },
    (theme) => { theme.tokens.muted = "#404040"; },
    (theme) => { theme.tokens.accent = "#555555"; },
    (theme) => { theme.terms.briefing = "<img src=x onerror=alert(1)>"; },
    (theme) => { theme.sounds.url = "https://example.test/track.mp3"; },
    (theme) => { theme.sounds.cue = "javascript:alert(1)"; },
    (theme) => { theme.sounds.enabled = "true"; },
    (theme) => { theme.version = 2; },
  ];
  for (const mutate of mutations) {
    const theme = structuredClone(THEMES[0]);
    mutate(theme);
    rejects(theme, validateTheme);
  }
});

test("rules are bounded declarative records and cannot smuggle formulas or capabilities", () => {
  const mutations = [
    (setup) => { setup.rules.attributes[0].formula = "fetch('/api/secrets')"; },
    (setup) => { setup.rules.resources[0].default = Infinity; },
    (setup) => { setup.rules.attributes[0].min = NaN; },
    (setup) => { setup.rules.resources[0].max = 1_000_001; },
    (setup) => { setup.rules.resources[0].default = "3"; },
    (setup) => { setup.rules.resources[0].default = 11; },
    (setup) => { setup.rules.attributes[0].min = 10; },
    (setup) => { setup.rules.expertise.push(structuredClone(setup.rules.expertise[0])); },
    (setup) => { setup.rules.outcomes[0].id = "../secret"; },
    (setup) => { setup.rules.outcomes[0].description = "<script>alert(1)</script>"; },
    (setup) => { setup.rules.version = 0; },
    (setup) => { setup.enabledInstruments = ["stagehand"]; },
    (setup) => { setup.enabledInstruments = ["briefing", "briefing"]; },
  ];
  for (const mutate of mutations) {
    const setup = fresh(); mutate(setup); rejects(setup);
  }
  const disabled = fresh(); disabled.enabledInstruments = [];
  assert.deepEqual(validateSetup(disabled).enabledInstruments, []);
});

test("content and pack validation enforces counts, sizes, identity and strict unknown fields", () => {
  const mutations = [
    (setup) => { setup.content[0].body = "x".repeat(6001); },
    (setup) => { setup.content[0].title = " ".repeat(200) + "Hello"; },
    (setup) => { setup.content = Array.from({ length: 21 }, (_, index) => ({ ...setup.content[0], id: `entry-${index}` })); },
    (setup) => { setup.content.push(structuredClone(setup.content[0])); },
    (setup) => { setup.content[0].body = "<iframe src=\"https://example.test\"></iframe>"; },
    (setup) => { setup.content[0].body = "Bad\u0000text"; },
    (setup) => { setup.content[0].visibility = "everyone"; },
    (setup) => { setup.content[0].prop = "false"; },
    (setup) => { setup.content[0].ownerId = "private"; },
    (setup) => { setup.rules.attributes = Array.from({ length: 13 }, (_, index) => ({ ...setup.rules.attributes[0], id: `entry-${index}` })); },
    (setup) => { setup.rules.expertise = Array.from({ length: 25 }, (_, index) => ({ ...setup.rules.expertise[0], id: `entry-${index}` })); },
    (setup) => { setup.rules.resources = Array.from({ length: 13 }, (_, index) => ({ ...setup.rules.resources[0], id: `entry-${index}` })); },
    (setup) => { setup.rules.outcomes = Array.from({ length: 13 }, (_, index) => ({ ...setup.rules.outcomes[0], id: `entry-${index}` })); },
    (setup) => { setup.templateId = "a".repeat(49); },
    (setup) => { delete setup.version; },
    (setup) => { setup.members = []; },
  ];
  for (const mutate of mutations) {
    const setup = fresh(); mutate(setup); rejects(setup);
  }
  for (const field of ["members", "owner_user_id", "inviteCode", "audit", "session", "role", "state", "id"]) {
    const pack = makeEventPack(event(), "organizer"); pack.event[field] = "secret";
    rejects(pack, validateEventPack);
    const outer = makeEventPack(event(), "organizer"); outer[field] = "secret";
    rejects(outer, validateEventPack);
  }
  const oversized = fresh();
  oversized.content = Array.from({ length: 20 }, (_, index) => ({ ...oversized.content[0], id: `entry-${index}`, body: "界".repeat(6000) }));
  rejects(oversized);
});

test("prototype keys, getters, unsupported objects and sparse lists are rejected", () => {
  const setup = fresh();
  const malicious = JSON.parse(JSON.stringify(setup).replace('"version":1', '"__proto__":{"isAdmin":true},"version":1'));
  rejects(malicious);
  assert.equal({}.isAdmin, undefined);
  const inherited = Object.assign(Object.create({ version: 1 }), setup); delete inherited.version;
  rejects(inherited);
  const accessor = fresh();
  Object.defineProperty(accessor, "content", { get: () => { throw new Error("Do not execute getters"); }, enumerable: true });
  rejects(accessor);
  const sparse = fresh(); sparse.content = new Array(1); rejects(sparse);
  const extraArray = fresh(); extraArray.content.secrets = "private"; rejects(extraArray);
  const arrayGetter = fresh();
  Object.defineProperty(arrayGetter.content, 0, { get: () => { throw new Error("Do not execute getters"); }, enumerable: true });
  rejects(arrayGetter);
  rejects(new Date());
});

test("every accepted near-limit setup exports with maximum-sized event metadata", () => {
  const setup = fresh();
  setup.content = Array.from({ length: 20 }, (_, index) => ({
    id: `entry-${index}`, title: `Record ${index}`, body: "界".repeat(2800), visibility: "player", prop: true,
  }));
  const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
  const target = 180_000;
  let remaining = target - bytes(setup);
  for (const entry of setup.content) {
    const add = Math.min(remaining, 6000 - entry.body.length);
    entry.body += "x".repeat(add);
    remaining -= add;
  }
  assert.equal(remaining, 0, "Fixture reaches the exact setup byte limit.");
  assert.equal(bytes(setup), target);
  const accepted = validateSetup(setup);
  const maximumMetadata = {
    name: "界".repeat(100), description: "界".repeat(2000), location: "界".repeat(200),
    startsAt: "2026-10-10T18:30:00.000Z", setup: accepted,
  };
  for (const audience of ["organizer", "player"]) {
    const pack = makeEventPack(maximumMetadata, audience);
    assert.ok(bytes(pack) < 200_000);
    assert.deepEqual(validateEventPack(JSON.parse(JSON.stringify(pack))).setup, accepted);
  }
  setup.content.at(-1).body += "x";
  assert.equal(bytes(setup), target + 1);
  rejects(setup);
});

test("pack versions and real dated metadata are validated before import", () => {
  for (const startsAt of ["2026-02-30T12:00:00Z", "2025-02-29T12:00:00Z", "2026-01-01", "2026-01-01T12:00:00", "2026-10-10T24:00:00Z", 123, "not a date"] ) {
    const pack = makeEventPack(event(), "organizer"); pack.event.startsAt = startsAt;
    rejects(pack, validateEventPack);
  }
  const pack = makeEventPack(event(), "organizer");
  pack.event.startsAt = "2028-02-29T12:00:00-04:00";
  assert.equal(validateEventPack(pack).event.startsAt, "2028-02-29T16:00:00.000Z");
  pack.version = 2; rejects(pack, validateEventPack);
  pack.version = 1; pack.format = "some-other-pack"; rejects(pack, validateEventPack);
});
