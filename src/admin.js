import { timingSafeEqual } from "node:crypto";
import { transaction } from "./db.js";
import { digest } from "./security.js";

export function isReservedSuperuserEmail(address, config) {
  return Boolean(
    config.bootstrapSuperuserEmail &&
    typeof address === "string" &&
    address.trim().toLowerCase() === config.bootstrapSuperuserEmail,
  );
}

// Only an operator-provided secret permits claiming the reserved account.
// The caller must still insert a unique email in a transaction; no body field
// may grant a role. Existing accounts are provisioned exclusively at deployment.
export function registerSuperuserAllowed(address, setupCode, config) {
  if (!isReservedSuperuserEmail(address, config)) return true;
  if (
    typeof config.bootstrapSetupToken !== "string" ||
    config.bootstrapSetupToken.length < 32 ||
    typeof setupCode !== "string" ||
    setupCode.length > 512
  ) return false;
  return timingSafeEqual(
    Buffer.from(digest(setupCode), "hex"),
    Buffer.from(digest(config.bootstrapSetupToken), "hex"),
  );
}

export async function systemAudit(db, actorId, targetUserId, action, details = {}) {
  await db.query(
    "INSERT INTO system_audit_entries(actor_id,target_user_id,action,details) VALUES($1,$2,$3,$4)",
    [actorId, targetUserId, action, JSON.stringify(details)],
  );
}

export async function provisionSuperuser(pool, config) {
  if (!config.bootstrapSuperuserEmail) return null;
  return transaction(pool, async (db) => {
    const { rows } = await db.query(
      "SELECT id,is_superuser,is_disabled FROM users WHERE email=$1 FOR UPDATE",
      [config.bootstrapSuperuserEmail],
    );
    const user = rows[0];
    if (!user)
      return { event: "superuser_provisioned", matched: false, reserved: true };
    if (!user.is_superuser || user.is_disabled) {
      await db.query(
        "UPDATE users SET is_superuser=true,is_disabled=false WHERE id=$1",
        [user.id],
      );
      await systemAudit(db, null, user.id, "superuser.provisioned", {
        source: "deployment",
      });
    }
    return { event: "superuser_provisioned", matched: true, userId: user.id };
  });
}

export function createAdminHandler({ pool, config, helpers }) {
  const { send, fail, body, identifier, transaction: transact = transaction } = helpers;
  function pagination(url) {
    const read = (key, fallback, max) => {
      const raw = url.searchParams.get(key);
      if (raw === null) return fallback;
      if (!/^\d+$/.test(raw)) fail(400, `${key} must be a positive integer.`);
      const n = Number(raw);
      if (!Number.isSafeInteger(n) || n < 1 || n > max)
        fail(400, `${key} must be between 1 and ${max}.`);
      return n;
    };
    const limit = read("limit", 25, 100);
    const page = read("page", 1, 10000);
    return { limit, page, offset: (page - 1) * limit };
  }
  return async function admin({ req, res, url, path = url.pathname, method = req.method, user }) {
    if (path !== "/api/admin" && !path.startsWith("/api/admin/")) return false;
    if (!user) fail(401, "Sign in to continue.");
    if (user.is_superuser !== true || user.is_disabled)
      fail(403, "Project superuser access is required.");

    if (path === "/api/admin/users" && method === "GET") {
      const { limit, page, offset } = pagination(url);
      const search = (url.searchParams.get("q") || "").trim();
      if (search.length > 80) fail(400, "Search must contain at most 80 characters.");
      const term = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
      const where = "WHERE email ILIKE $1 OR display_name ILIKE $1";
      const [{ rows }, total] = await Promise.all([
        pool.query(
          `SELECT id,email,display_name,is_superuser,is_disabled,created_at FROM users ${where} ORDER BY created_at DESC,id LIMIT $2 OFFSET $3`,
          [term, limit, offset],
        ),
        pool.query(`SELECT count(*)::int AS total FROM users ${where}`, [term]),
      ]);
      send(res, 200, { users: rows, page, limit, total: total.rows[0].total });
      return true;
    }

    if (path === "/api/admin/audit" && method === "GET") {
      const { limit, page, offset } = pagination(url);
      const { rows } = await pool.query(
        "SELECT a.id,a.actor_id,a.target_user_id,a.action,a.details,a.created_at,u.display_name AS actor_name,t.display_name AS target_name FROM system_audit_entries a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN users t ON t.id=a.target_user_id ORDER BY a.id DESC LIMIT $1 OFFSET $2",
        [limit, offset],
      );
      send(res, 200, { entries: rows, page, limit });
      return true;
    }

    const revoke = path.match(/^\/api\/admin\/users\/([^/]+)\/sessions$/);
    if (revoke && method === "DELETE") {
      const targetId = identifier(revoke[1]);
      const revoked = await transact(pool, async (db) => {
        const { rows } = await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [targetId]);
        if (!rows[0]) fail(404, "User not found.");
        const result = await db.query("DELETE FROM sessions WHERE user_id=$1 RETURNING token_hash", [targetId]);
        await systemAudit(db, user.id, targetId, "user.sessions_revoked", { count: result.rows.length });
        return result.rows.length;
      });
      send(res, 200, { revoked });
      return true;
    }

    const account = path.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (account && method === "PATCH") {
      const targetId = identifier(account[1]);
      const data = await body(req);
      if (Object.keys(data).length !== 1 || typeof data.disabled !== "boolean")
        fail(400, "Provide only the disabled setting as true or false.");
      const updated = await transact(pool, async (db) => {
        const { rows } = await db.query(
          "SELECT id,email,display_name,is_superuser,is_disabled,created_at FROM users WHERE id=$1 FOR UPDATE",
          [targetId],
        );
        const target = rows[0];
        if (!target) fail(404, "User not found.");
        if (data.disabled && (targetId === user.id || target.is_superuser))
          fail(409, "Superuser accounts cannot be disabled here.");
        if (target.is_disabled !== data.disabled) {
          await db.query("UPDATE users SET is_disabled=$2 WHERE id=$1", [targetId, data.disabled]);
          if (data.disabled) await db.query("DELETE FROM sessions WHERE user_id=$1", [targetId]);
          await systemAudit(db, user.id, targetId, data.disabled ? "user.disabled" : "user.enabled");
        }
        return { ...target, is_disabled: data.disabled };
      });
      send(res, 200, { user: updated });
      return true;
    }
    fail(404, "Admin action not found.");
  };
}
