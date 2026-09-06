import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { VERSION } from "./config.js";
import { createAdminHandler, isReservedSuperuserEmail, registerSuperuserAllowed, systemAudit } from "./admin.js";
import { createCharacterHandler } from "./characters.js";
import { createAdventureHandler } from "./adventures.js";
import { createExchangeHandler } from "./exchanges.js";
import { createSharingHandler } from "./sharing.js";
import { createStoryHandler } from "./story.js";
import { createTraceHandler } from "./trace.js";
import { createEconomyHandler } from "./economy.js";
import { createOathHandler } from "./oaths.js";
import { createSigilHandler, syncSigilEventState } from "./sigil.js";
import { createStaticHandler } from "./static.js";
import { createStagehandHandler } from "./stagehand.js";
import { syncStagehandEventState } from "./stagehand-core.js";
import { checkSchema, transaction } from "./db.js";
import {
  THEMES,
  TEMPLATES,
  INSTRUMENTS,
  defaultSetup,
  validateSetup,
  projectSetup,
  validateEventPack,
  makeEventPack,
} from "../public/kit.js";
import {
  digest,
  hashPassword,
  verifyPassword,
  newToken,
  inviteCode,
  readCookie,
  sessionCookie,
  limit,
} from "./security.js";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const managers = new Set(["owner", "organizer", "superuser"]);
const canOwn = (event) => ["owner", "superuser"].includes(event.role);
const transitions = {
  draft: ["rehearsal"],
  rehearsal: ["draft", "live"],
  live: ["paused", "ended"],
  paused: ["live", "ended"],
  ended: ["archived"],
  archived: [],
};
function text(value, label, min, max) {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max
  )
    fail(400, `${label} must contain ${min}–${max} characters.`);
  return value.trim();
}
function password(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 128)
    fail(400, "Use a password between 12 and 128 characters.");
  return value;
}
function email(value) {
  const v = text(value, "Email", 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
    fail(400, "Enter a valid email address.");
  return v;
}
function identifier(value) {
  if (!UUID.test(value || "")) fail(404, "Not found.");
  return value;
}
function date(value) {
  if (!value) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    fail(400, "Choose a valid event date.");
  return new Date(value);
}
function positive(value, label, max) {
  if (!Number.isInteger(value) || value < 1 || value > max)
    fail(400, `${label} must be between 1 and ${max}.`);
  return value;
}
async function body(req, maxBytes = 16384) {
  if (!(req.headers["content-type"] || "").startsWith("application/json"))
    fail(415, "Send JSON content.");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) fail(413, "Request is too large.");
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString());
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error();
    return data;
  } catch {
    fail(400, "Invalid JSON request.");
  }
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data === undefined ? undefined : JSON.stringify(data));
}
async function audit(db, eventId, actorId, action, details = {}) {
  await db.query(
    "INSERT INTO audit_entries(event_id,actor_id,action,details) VALUES($1,$2,$3,$4)",
    [eventId, actorId, action, JSON.stringify(details)],
  );
}
async function membership(db, eventId, userId, lock = false) {
  // Every event mutation takes this lock before reading current permissions.
  // A fresh statement after waiting sees concurrent membership revocations.
  if (lock) await db.query("SELECT id FROM events WHERE id=$1 FOR UPDATE", [eventId]);
  const { rows } = await db.query(
    `SELECT e.*,CASE WHEN u.is_superuser THEN 'superuser' ELSE m.role END AS role
     FROM events e JOIN users u ON u.id=$2
     LEFT JOIN memberships m ON m.event_id=e.id AND m.user_id=u.id
     WHERE e.id=$1 AND NOT u.is_disabled AND (u.is_superuser OR m.user_id IS NOT NULL)`,
    [eventId, userId],
  );
  if (!rows[0]) fail(404, "Event not found or access has been removed.");
  return rows[0];
}
function requireManager(event) {
  if (!managers.has(event.role))
    fail(403, "Only an organizer can make this change.");
}
async function setSession(db, res, config, userId, previous) {
  const token = newToken();
  if (previous)
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [
      digest(previous),
    ]);
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
    [digest(token), userId],
  );
  res.setHeader("Set-Cookie", sessionCookie(config, token));
}
function safeUser(row) {
  return { id: row.id, email: row.email, displayName: row.display_name, isSuperuser: row.is_superuser === true };
}
// Explicit projections keep organizer material out of every player response,
// including joins and list views. Preview never grants organizer permissions.
function safeEvent(row, audience = managers.has(row.role) ? "organizer" : "player", preview = false) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    location: row.location,
    starts_at: row.starts_at,
    status: row.status,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    setup: projectSetup(row.setup, audience),
    ...(!preview && row.role ? { role: row.role } : {}),
    ...(!preview && row.member_count !== undefined ? { member_count: row.member_count } : {}),
    ...(!preview && row.alreadyMember ? { alreadyMember: true } : {}),
  };
}

export function createApp({
  pool,
  config,
  logger = (entry) => console.log(JSON.stringify(entry)),
}) {
  const helpers = { body, send, fail, identifier, membership, audit, transaction, safeEvent };
  const adminHandler = createAdminHandler({ pool, config, helpers });
  const characterHandler = createCharacterHandler({ pool, config, helpers });
  const adventureHandler = createAdventureHandler({ pool, config, helpers });
  const exchangeHandler = createExchangeHandler({ pool, config, helpers });
  const sharingHandler = createSharingHandler({ pool, config, helpers });
  const storyHandler = createStoryHandler({ pool, config, helpers });
  const traceHandler = createTraceHandler({ pool, config, helpers });
  const economyHandler = createEconomyHandler({ pool, config, helpers });
  const oathHandler = createOathHandler({ pool, config, helpers });
  const sigilHandler = createSigilHandler({ pool, config, helpers });
  const staticHandler = createStaticHandler({ pool, config, helpers });
  const stagehandHandler = createStagehandHandler({ pool, helpers });
  return async function handle(req, res) {
    const requestId = randomUUID();
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Permissions-Policy",
      "camera=(self), microphone=(), geolocation=()",
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; worker-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    res.setHeader("Cache-Control", "no-store");
    if (config.production)
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    try {
      const url = new URL(req.url, config.origin);
      const path = url.pathname;
      const method = req.method;
      if (path === "/health/live" && method === "GET")
        return send(res, 200, { status: "ok", version: VERSION, deploymentCommit: config.deploymentCommit || null });
      if (path === "/health/ready" && method === "GET") {
        try {
          const version = await checkSchema(pool);
          return send(res, 200, {
            status: "ready",
            version: VERSION,
            schemaVersion: version,
            deploymentCommit: config.deploymentCommit || null,
          });
        } catch {
          return send(res, 503, { status: "unavailable", version: VERSION });
        }
      }
      if (!path.startsWith("/api/")) {
        if (!["GET", "HEAD"].includes(method)) fail(405, "Method not allowed.");
        const assets = {
          "/": ["index.html", "text/html"],
          "/app.js": ["app.js", "text/javascript"],
          "/adventure-model.js": ["adventure-model.js", "text/javascript"],
          "/adventure-player.js": ["adventure-player.js", "text/javascript"],
          "/adventure-organizer.js": ["adventure-organizer.js", "text/javascript"],
          "/adventure.css": ["adventure.css", "text/css"],
          "/adventure-organizer.css": ["adventure-organizer.css", "text/css"],
          "/offline.js": ["offline.js", "text/javascript"],
          "/connection.js": ["connection.js", "text/javascript"],
          "/field-store.js": ["field-store.js", "text/javascript"],
          "/field-sync.js": ["field-sync.js", "text/javascript"],
          "/field-ui.js": ["field-ui.js", "text/javascript"],
          "/field.css": ["field.css", "text/css"],
          "/install.js": ["install.js", "text/javascript"],
          "/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json"],
          "/icon-192.png": ["icon-192.png", "image/png"],
          "/icon-512.png": ["icon-512.png", "image/png"],
          "/icon-maskable-512.png": ["icon-maskable-512.png", "image/png"],
          "/apple-touch-icon.png": ["apple-touch-icon.png", "image/png"],
          "/app-icon.svg": ["app-icon.svg", "image/svg+xml"],
          "/prop-code.js": ["prop-code.js", "text/javascript"],
          "/sw.js": ["sw.js", "text/javascript"],
          "/exchange-model.js": ["exchange-model.js", "text/javascript"],
          "/exchange-code.js": ["exchange-code.js", "text/javascript"],
          "/exchanges-ui.js": ["exchanges-ui.js", "text/javascript"],
          "/exchanges.css": ["exchanges.css", "text/css"],
          "/sharing-ui.js": ["sharing-ui.js", "text/javascript"],
          "/sharing.css": ["sharing.css", "text/css"],
          "/story-model.js": ["story-model.js", "text/javascript"],
          "/story-ui.js": ["story-ui.js", "text/javascript"],
          "/story.css": ["story.css", "text/css"],
          "/trace-model.js": ["trace-model.js", "text/javascript"],
          "/trace-ui.js": ["trace-ui.js", "text/javascript"],
          "/trace.css": ["trace.css", "text/css"],
          "/economy-model.js": ["economy-model.js", "text/javascript"],
          "/economy-ui.js": ["economy-ui.js", "text/javascript"],
          "/economy.css": ["economy.css", "text/css"],
          "/oath-model.js": ["oath-model.js", "text/javascript"],
          "/oath-ui.js": ["oath-ui.js", "text/javascript"],
          "/oath.css": ["oath.css", "text/css"],
          "/sigil-model.js": ["sigil-model.js", "text/javascript"],
          "/sigil-ui.js": ["sigil-ui.js", "text/javascript"],
          "/sigil.css": ["sigil.css", "text/css"],
          "/static-model.js": ["static-model.js", "text/javascript"],
          "/static-ui.js": ["static-ui.js", "text/javascript"],
          "/static.css": ["static.css", "text/css"],
          "/stagehand-model.js": ["stagehand-model.js", "text/javascript"],
          "/stagehand-ui.js": ["stagehand-ui.js", "text/javascript"],
          "/stagehand-manage.js": ["stagehand-manage.js", "text/javascript"],
          "/stagehand.css": ["stagehand.css", "text/css"],
          "/prop-effects.js": ["prop-effects.js", "text/javascript"],
          "/props.css": ["props.css", "text/css"],
          "/instrument-code.js": ["instrument-code.js", "text/javascript"],
          "/characters-ui.js": ["characters-ui.js", "text/javascript"],
          "/characters-model.js": ["characters-model.js", "text/javascript"],
          "/characters.css": ["characters.css", "text/css"],
          "/admin-ui.js": ["admin-ui.js", "text/javascript"],
          "/qr.js": ["qr.js", "text/javascript"],
          "/vendor/qrcode-generator-2.0.4.js": ["vendor/qrcode-generator-2.0.4.js", "text/javascript"],
          "/vendor/jsqr-1.4.0.js": ["vendor/jsqr-1.4.0.js", "text/javascript"],
          "/builder.js": ["builder.js", "text/javascript"],
          "/kit.js": ["kit.js", "text/javascript"],
          "/style.css": ["style.css", "text/css"],
          "/themes.css": ["themes.css", "text/css"],
          "/favicon.svg": ["favicon.svg", "image/svg+xml"],
        };
        const asset = assets[path];
        if (!asset) fail(404, "Not found.");
        const file = await readFile(
          new URL(`../public/${asset[0]}`, import.meta.url),
        );
        res.writeHead(200, { "Content-Type": asset[1].startsWith("image/") ? asset[1] : `${asset[1]}; charset=utf-8`, "X-ORACLE-Shell-Version": VERSION });
        return res.end(method === "HEAD" ? undefined : file);
      }
      if (
        !["GET", "HEAD"].includes(method) &&
        req.headers.origin !== config.origin
      )
        fail(403, "This request must come from the ORACLE application.");
      const token = readCookie(req, config.cookieName);
      const user = token
        ? (
            await pool.query(
              "SELECT u.id,u.email,u.display_name,u.is_superuser,u.is_disabled FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT u.is_disabled",
              [digest(token)],
            )
          ).rows[0]
        : null;
      // Bind resumed work to the account that authored it before any API
      // handler can disclose data or apply effects using a changed cookie.
      if (user) res.setHeader("X-ORACLE-Account", user.id);
      const expectedAccount = req.headers["x-oracle-expected-account"];
      if (expectedAccount !== undefined) {
        if (typeof expectedAccount !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expectedAccount))
          fail(401, "The expected account is invalid. Sign in again to continue.");
        if (!user) fail(401, "Sign in to the original account before sending saved work.");
        if (expectedAccount.toLowerCase() !== user.id)
          fail(409, "Your account changed. Sign in to the original account before sending saved work.");
      }
      if (path === "/api/session" && method === "GET")
        return send(res, 200, {
          user: user ? safeUser(user) : null,
          version: VERSION,
          environment: config.appEnv,
          registrationEnabled: config.registrationEnabled,
        });

      if (
        ["/api/auth/register", "/api/auth/login"].includes(path) &&
        method === "POST"
      ) {
        const input = await body(req);
        const address = email(input.email);
        const pass = password(input.password);
        // The final forwarded address is the immediate proxy's client address; do not trust a caller-supplied first entry.
        const ip = config.production
          ? (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "")
              .split(",")
              .at(-1)
              .trim()
          : req.socket.remoteAddress;
        if (
          !(await limit(pool, `auth-address:${address}`, 10)) ||
          !(await limit(pool, `auth-ip:${ip}`, 60))
        ) {
          res.setHeader("Retry-After", "900");
          fail(429, "Too many attempts. Wait 15 minutes and try again.");
        }
        if (path.endsWith("/register")) {
          if (!config.registrationEnabled)
            fail(403, "New accounts are currently closed.");
          if (!registerSuperuserAllowed(address, input.setupCode, config))
            fail(403, "This account is reserved. Sign in or use your operator setup code.");
          const superuser = isReservedSuperuserEmail(address, config);
          const displayName = text(input.displayName, "Display name", 2, 80);
          const hash = await hashPassword(pass);
          const created = await transaction(pool, async (db) => {
            const id = randomUUID();
            const result = await db.query(
              "INSERT INTO users(id,email,display_name,password_hash,is_superuser) VALUES($1,$2,$3,$4,$5) ON CONFLICT(email) DO NOTHING RETURNING id,email,display_name,is_superuser",
              [id, address, displayName, hash, superuser],
            );
            if (!result.rows[0])
              fail(
                409,
                "Unable to create this account. Try signing in instead.",
              );
            if (superuser) await systemAudit(db, id, id, "superuser.claimed");
            await setSession(db, res, config, id, token);
            return result.rows[0];
          });
          return send(res, 201, { user: safeUser(created) });
        }
        const existing = await transaction(pool, async (db) => {
          const current = (
            await db.query("SELECT * FROM users WHERE email=$1 FOR UPDATE", [
              address,
            ])
          ).rows[0];
          if (!(await verifyPassword(pass, current?.password_hash)) || current.is_disabled)
            fail(401, "Email or password is incorrect.");
          await setSession(db, res, config, current.id, token);
          return current;
        });
        return send(res, 200, { user: safeUser(existing) });
      }
      if (!user) fail(401, "Sign in to continue.");
      res.setHeader("X-ORACLE-Account", user.id);
      if (await adminHandler({ req, res, path, url, method, user })) return;
      if (await characterHandler({ req, res, path, url, method, user })) return;
      if (await adventureHandler({ req, res, path, url, method, user })) return;
      if (await exchangeHandler({ req, res, path, url, method, user })) return;
      if (await sharingHandler({ req, res, path, url, method, user })) return;
      if (await storyHandler({ req, res, path, url, method, user })) return;
      if (await traceHandler({ req, res, path, url, method, user })) return;
      if (await economyHandler({ req, res, path, url, method, user })) return;
      if (await oathHandler({ req, res, path, url, method, user })) return;
      if (await sigilHandler({ req, res, path, url, method, user })) return;
      if (await staticHandler({ req, res, path, url, method, user })) return;
      if (await stagehandHandler({ req, res, path, url, method, user })) return;
      if (path === "/api/catalog" && method === "GET")
        return send(res, 200, { themes: THEMES, templates: TEMPLATES, instruments: INSTRUMENTS });
      if (path === "/api/auth/logout" && method === "POST") {
        await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
          digest(token),
        ]);
        res.setHeader("Set-Cookie", sessionCookie(config, "", true));
        return send(res, 204);
      }
      if (path === "/api/auth/password" && method === "POST") {
        const input = await body(req);
        password(input.currentPassword);
        password(input.newPassword);
        if (!(await limit(pool, `password:${user.id}`, 10)))
          fail(429, "Too many attempts. Wait 15 minutes.");
        await transaction(pool, async (db) => {
          const current = (
            await db.query(
              "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",
              [user.id],
            )
          ).rows[0];
          if (
            !(await verifyPassword(
              input.currentPassword,
              current.password_hash,
            ))
          )
            fail(403, "Current password is incorrect.");
          await db.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
            await hashPassword(input.newPassword),
            user.id,
          ]);
          await db.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
          await setSession(db, res, config, user.id);
        });
        return send(res, 200, { ok: true });
      }
      if (path === "/api/events" && method === "GET") {
        const { rows } = await pool.query(
          "SELECT e.*,CASE WHEN $2::boolean THEN 'superuser' ELSE m.role END AS role,(SELECT count(*)::int FROM memberships n WHERE n.event_id=e.id) AS member_count FROM events e LEFT JOIN memberships m ON m.event_id=e.id AND m.user_id=$1 WHERE $2::boolean OR m.user_id IS NOT NULL ORDER BY e.updated_at DESC",
          [user.id, user.is_superuser],
        );
        return send(res, 200, { events: rows.map((row) => safeEvent(row)) });
      }
      if (path === "/api/events" && method === "POST") {
        if (!(await limit(pool, `create-event:${user.id}`, 20, 60)))
          fail(429, "Event creation limit reached. Try again later.");
        const input = await body(req, 262144);
        const setup = input.setup === undefined ? defaultSetup() : validateSetup(input.setup);
        const event = await transaction(pool, async (db) => {
          const id = randomUUID();
          const result = await db.query(
            "INSERT INTO events(id,owner_user_id,name,description,location,starts_at,setup) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
            [
              id,
              user.id,
              text(input.name, "Event name", 2, 100),
              text(input.description || "", "Description", 0, 2000),
              text(input.location || "", "Location", 0, 200),
              date(input.startsAt),
              JSON.stringify(setup),
            ],
          );
          await db.query(
            "INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'owner')",
            [id, user.id],
          );
          await audit(db, id, user.id, "event.created");
          return { ...result.rows[0], role: "owner" };
        });
        return send(res, 201, { event: safeEvent(event) });
      }
      if (path === "/api/events/import" && method === "POST") {
        if (!(await limit(pool, `create-event:${user.id}`, 20, 60)))
          fail(429, "Event creation limit reached. Try again later.");
        const input = await body(req, 262144);
        const pack = validateEventPack(input.pack);
        const event = await transaction(pool, async (db) => {
          const id = randomUUID();
          // Import always creates a fresh draft owned by the caller. It cannot
          // import identities, live progress, memberships or credentials.
          const result = await db.query(
            "INSERT INTO events(id,owner_user_id,name,description,location,starts_at,setup) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
            [id, user.id, pack.event.name, pack.event.description, pack.event.location, date(pack.event.startsAt), JSON.stringify(pack.setup)],
          );
          await db.query(
            "INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'owner')",
            [id, user.id],
          );
          await audit(db, id, user.id, "event.imported", { formatVersion: pack.version, audience: pack.audience });
          return { ...result.rows[0], role: "owner" };
        });
        return send(res, 201, { event: safeEvent(event) });
      }
      if (path === "/api/events/join" && method === "POST") {
        if (!(await limit(pool, `join:${user.id}`, 30)))
          fail(429, "Too many join attempts. Wait 15 minutes.");
        const input = await body(req);
        const code = text(input.code, "Invitation code", 16, 24)
          .replace(/[\s-]/g, "")
          .toUpperCase();
        if (!/^[A-HJ-NP-Z2-9]{16}$/.test(code))
          fail(400, "Enter the 16-character invitation code.");
        const event = await transaction(pool, async (db) => {
          const found = (
            await db.query(
              "SELECT event_id FROM invitations WHERE token_hash=$1",
              [digest(code)],
            )
          ).rows[0];
          if (!found)
            fail(
              400,
              "This invitation is invalid, expired, or no longer available.",
            );
          // Always lock event before invitation, matching all other event mutations.
          const ev = (
            await db.query("SELECT * FROM events WHERE id=$1 FOR UPDATE", [
              found.event_id,
            ])
          ).rows[0];
          const inv = (
            await db.query(
              "SELECT * FROM invitations WHERE token_hash=$1 FOR UPDATE",
              [digest(code)],
            )
          ).rows[0];
          if (
            !ev ||
            !inv ||
            inv.revoked_at ||
            new Date(inv.expires_at) <= new Date() ||
            inv.uses >= inv.max_uses ||
            ["ended", "archived"].includes(ev.status)
          )
            fail(
              400,
              "This invitation is invalid, expired, or no longer available.",
            );
          const issuer = (
            await db.query(
              "SELECT u.is_superuser,u.is_disabled,m.role FROM users u LEFT JOIN memberships m ON m.user_id=u.id AND m.event_id=$1 WHERE u.id=$2",
              [ev.id, inv.created_by],
            )
          ).rows[0];
          if (
            !issuer ||
            !(!issuer.is_disabled && (issuer.is_superuser || managers.has(issuer.role))) ||
            (inv.role === "organizer" && !issuer.is_superuser && issuer.role !== "owner")
          )
            fail(400, "This invitation is no longer available.");
          const existing = (
            await db.query(
              "SELECT role FROM memberships WHERE event_id=$1 AND user_id=$2",
              [ev.id, user.id],
            )
          ).rows[0];
          if (existing)
            return { ...ev, role: existing.role, alreadyMember: true };
          await db.query(
            "INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,$3)",
            [ev.id, user.id, inv.role],
          );
          await db.query("UPDATE invitations SET uses=uses+1 WHERE id=$1", [
            inv.id,
          ]);
          await audit(db, ev.id, user.id, "member.joined", { role: inv.role });
          return { ...ev, role: inv.role };
        });
        return send(res, 200, { event: safeEvent(event) });
      }
      const match = path.match(
        /^\/api\/events\/([^/]+)(?:\/(members|invites|audit|pack|preview)(?:\/([^/]+))?)?$/,
      );
      if (!match) fail(404, "Not found.");
      const [, rawId, section, rawTarget] = match;
      const id = identifier(rawId),
        target = rawTarget ? identifier(rawTarget) : null;
      if (method === "GET") {
        const event = await membership(pool, id, user.id);
        if (section === "pack" && !target) {
          const audience = url.searchParams.get("audience") || (managers.has(event.role) ? "organizer" : "player");
          if (!["organizer", "player"].includes(audience)) fail(400, "Choose an organizer or player event pack.");
          if (audience === "organizer") requireManager(event);
          return send(res, 200, makeEventPack(event, audience));
        }
        if (section === "preview" && !target) {
          const audience = url.searchParams.get("audience") || "player";
          if (!["player", "prop"].includes(audience)) fail(400, "Choose a player or prop preview.");
          return send(res, 200, { event: safeEvent(event, audience, true), audience, readOnly: true });
        }
        if (!section) {
          const members = (
            await pool.query(
              "SELECT m.user_id,m.role,m.joined_at,u.display_name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.event_id=$1 ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'organizer' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END,u.display_name",
              [id],
            )
          ).rows;
          return send(res, 200, {
            event: safeEvent(event),
            members,
            transitions: managers.has(event.role)
              ? transitions[event.status]
              : [],
          });
        }
        requireManager(event);
        if (section === "invites" && !target)
          return send(res, 200, {
            invitations: (
              await pool.query(
                "SELECT id,role,max_uses,uses,expires_at,revoked_at,created_at FROM invitations WHERE event_id=$1 ORDER BY created_at DESC LIMIT 100",
                [id],
              )
            ).rows,
          });
        if (section === "audit" && !target)
          return send(res, 200, {
            entries: (
              await pool.query(
                "SELECT a.id,a.action,a.details,a.created_at,u.display_name AS actor FROM audit_entries a JOIN users u ON u.id=a.actor_id WHERE event_id=$1 ORDER BY a.id DESC LIMIT 100",
                [id],
              )
            ).rows,
          });
        fail(404, "Not found.");
      }
      const input = method === "DELETE" ? {} : await body(req, !section && method === "PATCH" ? 262144 : 16384);
      const result = await transaction(pool, async (db) => {
        const event = await membership(db, id, user.id, true);
        if (!section && method === "PATCH") {
          requireManager(event);
          if (event.status === "archived")
            fail(409, "Archived events are read-only.");
          if (input.version !== event.version)
            fail(409, "This event changed. Refresh and try again.");
          const status = input.status ?? event.status;
          if (
            status !== event.status &&
            !transitions[event.status].includes(status)
          )
            fail(409, "That event status change is not available.");
          const name =
            input.name === undefined
              ? event.name
              : text(input.name, "Event name", 2, 100);
          const description =
            input.description === undefined
              ? event.description
              : text(input.description, "Description", 0, 2000);
          const location =
            input.location === undefined
              ? event.location
              : text(input.location, "Location", 0, 200);
          const startsAt =
            input.startsAt === undefined
              ? event.starts_at
              : date(input.startsAt);
          if (input.setup !== undefined && input.theme !== undefined)
            fail(400, "Send either event setup or a theme change.");
          const setup = input.setup !== undefined
            ? validateSetup(input.setup)
            : input.theme !== undefined
              ? validateSetup({ ...event.setup, theme: input.theme })
              : event.setup;
          await syncSigilEventState(db, event, { ...event, status, setup }, user.id);
          await syncStagehandEventState(db, event, { ...event, status, setup }, user.id);
          const changed = (
            await db.query(
              "UPDATE events SET name=$1,description=$2,location=$3,starts_at=$4,status=$5,setup=$6,version=version+1,updated_at=now() WHERE id=$7 RETURNING *",
              [name, description, location, startsAt, status, JSON.stringify(setup), id],
            )
          ).rows[0];
          await audit(
            db,
            id,
            user.id,
            status !== event.status ? "event.status_changed" : "event.updated",
            status !== event.status ? { from: event.status, to: status } : {},
          );
          return { event: safeEvent({ ...changed, role: event.role }) };
        }
        if (section === "invites" && method === "POST" && !target) {
          requireManager(event);
          if (["ended", "archived"].includes(event.status))
            fail(409, "This event is closed to new members.");
          const role = input.role || "player";
          if (
            !["player", "staff", "organizer"].includes(role) ||
            (role === "organizer" && !canOwn(event))
          )
            fail(403, "You cannot invite that role.");
          const maxUses = positive(
              input.maxUses ?? (role === "player" ? 20 : 1),
              "Uses",
              1000,
            ),
            hours = positive(input.expiresInHours ?? 48, "Expiry hours", 168);
          if (role !== "player" && maxUses !== 1)
            fail(400, "Staff and organizer invitations must be single-use.");
          const code = inviteCode(),
            inviteId = randomUUID();
          await db.query(
            "INSERT INTO invitations(id,event_id,token_hash,role,created_by,max_uses,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              inviteId,
              id,
              digest(code),
              role,
              user.id,
              maxUses,
              new Date(Date.now() + hours * 3600000),
            ],
          );
          await audit(db, id, user.id, "invitation.created", {
            role,
            maxUses,
            expiresInHours: hours,
          });
          return {
            invitation: {
              id: inviteId,
              code,
              role,
              maxUses,
              expiresInHours: hours,
            },
          };
        }
        if (section === "invites" && target && method === "DELETE") {
          requireManager(event);
          const row = (
            await db.query(
              "SELECT role FROM invitations WHERE id=$1 AND event_id=$2",
              [target, id],
            )
          ).rows[0];
          if (!row) fail(404, "Invitation not found.");
          if (row.role === "organizer" && !canOwn(event))
            fail(403, "Only the owner can revoke organizer invitations.");
          await db.query(
            "UPDATE invitations SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND event_id=$2",
            [target, id],
          );
          await audit(db, id, user.id, "invitation.revoked", {
            invitationId: target,
          });
          return { ok: true };
        }
        if (
          section === "members" &&
          target &&
          ["PATCH", "DELETE"].includes(method)
        ) {
          const member = (
            await db.query(
              "SELECT role FROM memberships WHERE event_id=$1 AND user_id=$2",
              [id, target],
            )
          ).rows[0];
          if (!member) fail(404, "Member not found.");
          if (member.role === "owner")
            fail(403, "The event owner cannot be removed or demoted.");
          if (method === "PATCH") {
            if (!canOwn(event))
              fail(403, "Only the event owner can change roles.");
            if (!["organizer", "staff", "player"].includes(input.role))
              fail(400, "Choose a valid membership role.");
            await db.query(
              "UPDATE memberships SET role=$1 WHERE event_id=$2 AND user_id=$3",
              [input.role, id, target],
            );
            // Revoke outstanding invitations on any role change, avoiding resurrection after later re-promotion.
            await db.query(
              "UPDATE invitations SET revoked_at=now() WHERE event_id=$1 AND created_by=$2 AND revoked_at IS NULL",
              [id, target],
            );
            await audit(db, id, user.id, "member.role_changed", {
              userId: target,
              from: member.role,
              to: input.role,
            });
          } else {
            if (
              target !== user.id &&
              (!managers.has(event.role) ||
                (member.role === "organizer" && !canOwn(event)))
            )
              fail(403, "You cannot remove this member.");
            await db.query(
              "DELETE FROM memberships WHERE event_id=$1 AND user_id=$2",
              [id, target],
            );
            await db.query(
              "UPDATE invitations SET revoked_at=now() WHERE event_id=$1 AND created_by=$2 AND revoked_at IS NULL",
              [id, target],
            );
            await audit(db, id, user.id, "member.removed", { userId: target });
          }
          return { ok: true };
        }
        fail(404, "Not found.");
      });
      return send(
        res,
        section === "invites" && method === "POST" ? 201 : 200,
        result,
      );
    } catch (error) {
      const status =
        error.status ||
        (["23505", "23503", "23514"].includes(error.code) ? 409 : 500);
      if (status >= 500)
        logger({
          level: "error",
          event: "request_failed",
          requestId,
          code: error.code || "INTERNAL_ERROR",
        });
      if (!res.headersSent)
        send(res, status, {
          error:
            status >= 500
              ? "Something went wrong. Please try again."
              : error.status
                ? error.message
                : "The request conflicts with existing data.",
          requestId,
        });
      else res.end();
    }
  };
}
