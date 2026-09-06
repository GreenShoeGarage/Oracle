import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { assessPilotReport, createPilotReport, PILOT_CHECKS, PILOT_DEVICES } from "../scripts/pilot-report.js";

// Synthetic validation fixtures only. These observations never occurred and are
// never written to a release/pilot artifact.
function completedFixture() {
  const report = createPilotReport("0.11.0");
  report.release = { version: "0.11.0", commit: "a".repeat(40), origin: "https://pilot.example.invalid" };
  report.humanObservationAttested = true;
  for (const device of report.devices) Object.assign(device, { physical: true, model: "Test fixture", operatingSystem: "Fixture OS 1", browser: "Fixture browser 1" });
  for (const check of report.checks) Object.assign(check, { status: "pass", deviceIds: [...PILOT_DEVICES], observedAt: new Date().toISOString(), observer: "fixture-observer", evidence: "Synthetic validator fixture, not pilot evidence." });
  Object.assign(report.load, { status: "pass", targetConfirmed: true, observedPlayers: 100, durationSeconds: 30, environment: "Isolated fixture", hostingConfiguration: "Fixture configuration", workload: "Fixture workload and limits", observedAt: new Date().toISOString(), evidence: "Synthetic validator fixture, not capacity evidence." });
  return report;
}
function finding(overrides = {}) {
  return { id: "fixture-1", severity: "medium", status: "scheduled", checkIds: ["organizer-onboarding"], summary: "Fixture problem", evidence: "Fixture observation", owner: "fixture-owner", resolution: "Fixture plan and reason for deferral", scheduledFor: "0.12.0", ...overrides };
}

test("an untouched template is valid but cannot report that a human pilot passed", () => {
  const result = assessPilotReport(createPilotReport("0.11.0"));
  assert.equal(result.valid, true);
  assert.equal(result.ready, false);
  assert.equal(result.totals.not_run, PILOT_CHECKS.length);
  assert.match(result.blockers.join("\n"), /Actual human observation/);
  assert.match(result.blockers.join("\n"), /Load measurement: not_run/);
});

test("complete self-reported gates need physical devices and explicit human attestation", () => {
  const report = completedFixture();
  assert.equal(assessPilotReport(report).ready, true);
  report.humanObservationAttested = false;
  assert.equal(assessPilotReport(report).ready, false);
  report.humanObservationAttested = true;
  report.devices[0].physical = false;
  assert.equal(assessPilotReport(report).ready, false);
  report.devices[0].physical = true;
  report.devices[0].browser = "";
  assert.equal(assessPilotReport(report).ready, false);
});

test("a passed check needs actual timestamp, observer, evidence and every specified device", () => {
  for (const field of ["observedAt", "observer", "evidence"]) {
    const report = completedFixture();
    report.checks[0][field] = "";
    assert.equal(assessPilotReport(report).valid, false, field);
  }
  const report = completedFixture();
  report.checks.find(({ id }) => id === "offline-reconnect-pair").deviceIds = ["iphone"];
  assert.equal(assessPilotReport(report).valid, false);
  report.checks.find(({ id }) => id === "offline-reconnect-pair").deviceIds = ["iphone", "android"];
  report.checks[0].observedAt = new Date(Date.now() + 86400000).toISOString();
  assert.equal(assessPilotReport(report).valid, false);
});

test("required failures remain blockers and critical findings cannot be scheduled past acceptance", () => {
  const report = completedFixture();
  report.findings = [finding()];
  assert.equal(assessPilotReport(report).ready, true);
  report.findings[0].severity = "critical";
  assert.equal(assessPilotReport(report).ready, false);
  report.findings[0].status = "resolved";
  assert.equal(assessPilotReport(report).ready, true);
  report.checks[0].status = "fail";
  assert.equal(assessPilotReport(report).ready, false);
  report.checks[0].status = "blocked";
  assert.equal(assessPilotReport(report).ready, false);
});

test("findings need tracked disposition rather than an unsupported waiver or empty schedule", () => {
  for (const field of ["owner", "resolution", "scheduledFor"]) {
    const report = completedFixture(); report.findings = [finding({ [field]: "" })];
    assert.equal(assessPilotReport(report).ready, false, field);
  }
  const report = completedFixture(); report.findings = [finding({ status: "waived" })];
  assert.equal(assessPilotReport(report).valid, false);
  report.findings = [finding({ status: "open" })];
  assert.equal(assessPilotReport(report).ready, false);
  report.findings = [finding({ status: "resolved", resolution: "" })];
  assert.equal(assessPilotReport(report).ready, false);
});

test("load acceptance requires measured concurrency, confirmed target, configuration and limits", () => {
  for (const patch of [{ targetConfirmed: false }, { observedPlayers: 99 }, { durationSeconds: 0 }, { hostingConfiguration: "" }, { workload: "" }, { targetPlayers: 50, targetRationale: "" }]) {
    const report = completedFixture(); Object.assign(report.load, patch);
    assert.equal(assessPilotReport(report).ready, false, JSON.stringify(patch));
  }
  const report = completedFixture();
  Object.assign(report.load, { targetPlayers: 50, targetRationale: "Confirmed smaller event target; no larger capacity claim." });
  assert.equal(assessPilotReport(report).ready, true);
});

test("partial, duplicate, unsupported or credential-bearing release metadata cannot yield readiness", () => {
  for (const mutate of [
    (report) => report.checks.pop(),
    (report) => { report.checks[1] = report.checks[0]; },
    (report) => { report.checks[0].status = "automated_pass"; },
    (report) => { report.checks[0].method = "automation"; },
    (report) => { report.release.commit = ""; },
    (report) => { report.release.origin = "https://user:secret@pilot.example.invalid"; },
    (report) => { report.release.origin = "https://pilot.example.invalid/?token=secret"; },
    (report) => { report.findings = [finding({ checkIds: ["missing"] })]; },
  ]) {
    const report = completedFixture(); mutate(report);
    assert.equal(assessPilotReport(report).ready, false);
  }
});

test("CLI creates an unrun private local report, refuses overwrite and distinguishes incomplete gates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oracle-pilot-"));
  const file = join(directory, "report.json");
  const cli = new URL("../scripts/pilot-report.js", import.meta.url).pathname;
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  try {
    const init = run("init", file);
    assert.equal(init.status, 0, init.stderr);
    const original = await readFile(file, "utf8");
    assert.equal(JSON.parse(original).humanObservationAttested, false);
    assert.equal(run("init", file).status, 1);
    assert.equal(await readFile(file, "utf8"), original);
    const inspect = run("check", file);
    assert.equal(inspect.status, 0);
    assert.match(inspect.stdout, /INCOMPLETE/);
    assert.equal(run("check", file, "--require-ready").status, 2);
    assert.equal(run("check", file, "--unsupported").status, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
