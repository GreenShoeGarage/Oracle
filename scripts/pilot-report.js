import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// This file never contacts ORACLE or reads credentials/browser data. Reports are
// local, manually recorded observations; validation cannot prove they happened.
export const PILOT_DEVICES = ["iphone", "android", "desktop", "shared-tablet"];
const STATUSES = ["not_run", "pass", "fail", "blocked"];
const THEMES = ["fantasy", "cyberpunk", "wasteland"];
const INSTRUMENTS = ["relic", "dead-drop", "cipherbox", "wayfinder", "trace", "whisper", "broadside", "bazaar", "oathbook", "sigil", "static", "stagehand"];
export const PILOT_CHECKS = [
  { id: "organizer-onboarding", devices: ["desktop"] },
  ...["iphone", "android"].flatMap((device) => ["player-onboarding", "installation", "camera-fallback"].map((step) => ({ id: `${step}-${device}`, devices: [device] }))),
  { id: "offline-reconnect-pair", devices: ["iphone", "android"] },
  { id: "duplicate-and-conflicting-change", devices: ["iphone", "android"] },
  { id: "expired-session-and-revocation", devices: ["iphone", "android"] },
  { id: "shared-device-account-event-isolation", devices: ["shared-tablet"] },
  { id: "same-browser-note-conflict", devices: ["desktop"] },
  { id: "update-with-active-tabs", devices: ["desktop", "iphone", "android"] },
  ...PILOT_DEVICES.map((device) => ({ id: `accessibility-${device}`, devices: [device] })),
  { id: "loading-empty-denied-failure", devices: ["desktop", "iphone", "android"] },
  { id: "print-and-event-closure", devices: ["desktop", "shared-tablet"] },
  ...THEMES.flatMap((theme) => [
    ...INSTRUMENTS.map((instrument) => ({ id: `${theme}-${instrument}`, devices: [] })),
    { id: `${theme}-connected-event-closure`, devices: ["iphone", "android", "desktop"] },
  ]),
];

export function createPilotReport(version = "") {
  return {
    format: "oracle-pilot-report", formatVersion: 1,
    release: { version, commit: "", origin: "" },
    humanObservationAttested: false,
    devices: PILOT_DEVICES.map((id) => ({ id, physical: false, model: "", operatingSystem: "", browser: "" })),
    checks: PILOT_CHECKS.map(({ id }) => ({ id, status: "not_run", deviceIds: [], observedAt: "", observer: "", evidence: "" })),
    load: {
      status: "not_run", targetPlayers: 100, targetConfirmed: false, targetRationale: "",
      observedPlayers: 0, durationSeconds: 0, environment: "", hostingConfiguration: "",
      workload: "", observedAt: "", evidence: "",
    },
    findings: [],
  };
}

function object(value, keys, path, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path}: expected an object.`); return false;
  }
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    errors.push(`${path}: missing or unsupported fields.`); return false;
  }
  return true;
}
function text(value, path, errors, max = 2000) {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    errors.push(`${path}: expected plain text of at most ${max} characters.`); return false;
  }
  return true;
}
function nonempty(value) { return typeof value === "string" && value.trim().length > 0; }
function timestamp(value) { return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now() + 60000; }
function validOrigin(value) {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && url.origin === value; } catch { return false; }
}

export function assessPilotReport(report) {
  const errors = [], blockers = [];
  const totals = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  const result = () => ({ valid: errors.length === 0, ready: errors.length === 0 && blockers.length === 0, errors, blockers, totals });
  if (!object(report, ["format", "formatVersion", "release", "humanObservationAttested", "devices", "checks", "load", "findings"], "report", errors)) return result();
  if (report.format !== "oracle-pilot-report" || report.formatVersion !== 1) errors.push("Unsupported report format/version.");
  if (typeof report.humanObservationAttested !== "boolean") errors.push("humanObservationAttested must be true or false.");
  if (!report.humanObservationAttested) blockers.push("Actual human observation has not been attested; automation does not satisfy the pilot.");
  if (object(report.release, ["version", "commit", "origin"], "release", errors)) {
    for (const [key, value] of Object.entries(report.release)) text(value, `release.${key}`, errors, 250);
    if (report.release.version && !/^\d+\.\d+\.\d+$/.test(report.release.version)) errors.push("release.version must be a three-part version.");
    if (report.release.commit && !/^[a-f0-9]{40}$/.test(report.release.commit)) errors.push("release.commit must be a full lowercase Git SHA.");
    if (report.release.origin && !validOrigin(report.release.origin)) errors.push("release.origin must be an exact HTTP(S) origin without credentials, path, query, or fragment.");
    if (!nonempty(report.release.version) || !nonempty(report.release.commit) || !nonempty(report.release.origin)) blockers.push("Record the tested release version, exact commit, and origin.");
  }
  const devices = new Map();
  if (!Array.isArray(report.devices) || report.devices.length !== PILOT_DEVICES.length) errors.push("devices must contain the four required device slots.");
  else for (const device of report.devices) {
    if (!object(device, ["id", "physical", "model", "operatingSystem", "browser"], "device", errors)) continue;
    if (!PILOT_DEVICES.includes(device.id) || devices.has(device.id)) errors.push("A device slot is unknown or repeated.");
    else devices.set(device.id, device);
    if (typeof device.physical !== "boolean") errors.push(`device ${device.id}: physical must be true or false.`);
    for (const key of ["model", "operatingSystem", "browser"]) text(device[key], `device.${key}`, errors, 250);
    if (device.physical !== true || ![device.model, device.operatingSystem, device.browser].every(nonempty)) blockers.push(`Record the actual ${device.id} model, OS version, and browser version; emulation is insufficient.`);
  }
  const checks = new Map();
  if (!Array.isArray(report.checks) || report.checks.length !== PILOT_CHECKS.length) errors.push(`checks must contain all ${PILOT_CHECKS.length} required observations.`);
  else for (const check of report.checks) {
    if (!object(check, ["id", "status", "deviceIds", "observedAt", "observer", "evidence"], "check", errors)) continue;
    const definition = PILOT_CHECKS.find(({ id }) => id === check.id);
    if (!definition || checks.has(check.id)) { errors.push("A check is unknown or repeated."); continue; }
    checks.set(check.id, check);
    if (!STATUSES.includes(check.status)) errors.push(`${check.id}: unsupported status.`);
    else totals[check.status]++;
    for (const key of ["observedAt", "observer", "evidence"]) text(check[key], `${check.id}.${key}`, errors);
    const validDevices = Array.isArray(check.deviceIds) && check.deviceIds.length <= PILOT_DEVICES.length && new Set(check.deviceIds).size === check.deviceIds.length && check.deviceIds.every((id) => devices.has(id));
    if (!validDevices) errors.push(`${check.id}: deviceIds must name unique required device slots.`);
    if (check.status !== "not_run" && (!timestamp(check.observedAt) || !nonempty(check.observer) || !nonempty(check.evidence))) errors.push(`${check.id}: attempted checks need an actual UTC observation time, observer alias, and result/evidence.`);
    if (check.status === "pass" && (!validDevices || check.deviceIds.length === 0 || definition.devices.some((id) => !check.deviceIds.includes(id)))) errors.push(`${check.id}: passing requires the specified physical devices.`);
    if (check.status !== "pass") blockers.push(`${check.id}: ${STATUSES.includes(check.status) ? check.status : "invalid"}.`);
  }
  if (object(report.load, ["status", "targetPlayers", "targetConfirmed", "targetRationale", "observedPlayers", "durationSeconds", "environment", "hostingConfiguration", "workload", "observedAt", "evidence"], "load", errors)) {
    const load = report.load;
    if (!STATUSES.includes(load.status)) errors.push("load.status is unsupported.");
    if (!Number.isInteger(load.targetPlayers) || load.targetPlayers < 1) errors.push("load.targetPlayers must be a positive integer.");
    if (!Number.isInteger(load.observedPlayers) || load.observedPlayers < 0) errors.push("load.observedPlayers must be a nonnegative integer.");
    if (!Number.isFinite(load.durationSeconds) || load.durationSeconds < 0) errors.push("load.durationSeconds must be a nonnegative number.");
    if (typeof load.targetConfirmed !== "boolean") errors.push("load.targetConfirmed must be true or false.");
    for (const key of ["targetRationale", "environment", "hostingConfiguration", "workload", "observedAt", "evidence"]) text(load[key], `load.${key}`, errors);
    if (load.status !== "not_run" && (!timestamp(load.observedAt) || !nonempty(load.evidence))) errors.push("An attempted load measurement needs its actual UTC time and evidence.");
    if (load.status !== "pass") blockers.push(`Load measurement: ${STATUSES.includes(load.status) ? load.status : "invalid"}.`);
    else {
      if (!load.targetConfirmed || (load.targetPlayers !== 100 && !nonempty(load.targetRationale))) blockers.push("Confirm the load target and explain any revision from 100 players.");
      if (load.observedPlayers < load.targetPlayers || load.durationSeconds <= 0) blockers.push("Passing load evidence must reach the confirmed concurrency target for a recorded duration.");
      if (![load.environment, load.hostingConfiguration, load.workload].every(nonempty)) blockers.push("Record the measured environment, hosting configuration, workload, and limits; an isolated result is not Railway capacity.");
    }
  }
  const findingIds = new Set();
  if (!Array.isArray(report.findings) || report.findings.length > 500) errors.push("findings must be a list of at most 500 records.");
  else for (const finding of report.findings) {
    if (!object(finding, ["id", "severity", "status", "checkIds", "summary", "evidence", "owner", "resolution", "scheduledFor"], "finding", errors)) continue;
    for (const key of ["id", "summary", "evidence", "owner", "resolution", "scheduledFor"]) text(finding[key], `finding.${key}`, errors);
    if (!nonempty(finding.id) || findingIds.has(finding.id)) errors.push("Finding identifiers must be nonempty and unique.");
    findingIds.add(finding.id);
    if (!["critical", "high", "medium", "low"].includes(finding.severity)) errors.push(`${finding.id}: unsupported severity.`);
    if (!["open", "scheduled", "resolved"].includes(finding.status)) errors.push(`${finding.id}: unsupported finding status.`);
    if (!Array.isArray(finding.checkIds) || finding.checkIds.length === 0 || new Set(finding.checkIds).size !== finding.checkIds.length || finding.checkIds.some((id) => !checks.has(id) && id !== "load")) errors.push(`${finding.id}: link to at least one unique check or load measurement.`);
    if (![finding.summary, finding.evidence].every(nonempty)) errors.push(`${finding.id}: summary and observation evidence are required.`);
    if (finding.status === "open" || (finding.severity === "critical" && finding.status !== "resolved")) blockers.push(`${finding.id}: unresolved ${finding.severity} finding.`);
    if (finding.status === "scheduled" && ![finding.owner, finding.resolution, finding.scheduledFor].every(nonempty)) blockers.push(`${finding.id}: scheduled findings need an owner alias, reason/plan, and target date or release.`);
    if (finding.status === "resolved" && !nonempty(finding.resolution)) blockers.push(`${finding.id}: resolved findings need fix and successful recheck evidence.`);
  }
  return result();
}

export function formatPilotReadout(assessment) {
  const lines = [
    `ORACLE pilot report: ${!assessment.valid ? "INVALID" : assessment.ready ? "RECORDED GATES SATISFIED" : "INCOMPLETE"}`,
    `Human/device checks: ${assessment.totals.pass} pass, ${assessment.totals.fail} fail, ${assessment.totals.blocked} blocked, ${assessment.totals.not_run} not run.`,
    "This validates a locally recorded report; it does not prove a field pilot occurred or certify untested devices/production capacity.",
  ];
  if (assessment.errors.length) lines.push("Report errors:", ...assessment.errors.map((value) => `- ${value}`));
  if (assessment.blockers.length) lines.push("Outstanding gates:", ...assessment.blockers.map((value) => `- ${value}`));
  return `${lines.join("\n")}\n`;
}

export async function runPilotCLI(argv) {
  const [command, file, ...flags] = argv;
  if (!["init", "check"].includes(command) || !file || flags.some((flag) => flag !== "--require-ready") || flags.length > 1 || (command === "init" && flags.length)) throw new Error("Usage: node scripts/pilot-report.js init report.json | check report.json [--require-ready]");
  if (command === "init") {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    await writeFile(file, `${JSON.stringify(createPilotReport(pkg.version), null, 2)}\n`, { flag: "wx", mode: 0o600 });
    console.log("Created an unrun local pilot template. Fill it only with actual observations; no pilot has been performed.");
    return 0;
  }
  const bytes = await readFile(file);
  if (bytes.length > 1_000_000) throw new Error("Pilot reports must be at most 1 MB. Reference sanitized evidence instead of embedding recordings or exports.");
  const assessment = assessPilotReport(JSON.parse(bytes.toString("utf8")));
  process.stdout.write(formatPilotReadout(assessment));
  return !assessment.valid ? 1 : flags.includes("--require-ready") && !assessment.ready ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await runPilotCLI(process.argv.slice(2)); }
  catch (error) { console.error(`Pilot report could not be processed: ${error.code || error.message}`); process.exitCode = 1; }
}
