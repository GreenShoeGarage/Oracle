import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const derive = promisify(scrypt);
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt:${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password, hash) {
  const [kind, salt, expected] = (hash || "").split(":");
  const candidate = await derive(
    password,
    salt || "oracle-invalid-account",
    64,
    { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
  );
  if (kind !== "scrypt" || !expected || expected.length !== 128) return false;
  return timingSafeEqual(candidate, Buffer.from(expected, "hex"));
}
export function newToken() {
  return randomBytes(32).toString("base64url");
}
export function inviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...randomBytes(16)].map((x) => alphabet[x % 32]).join("");
}
export function readCookie(req, name) {
  const entry = (req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(`${name}=`));
  return entry ? entry.slice(name.length + 1) : "";
}
export function sessionCookie(config, token, clear = false) {
  return `${config.cookieName}=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 604800}${config.production ? "; Secure" : ""}`;
}
export async function limit(pool, identity, max, minutes = 15) {
  const slot = Math.floor(Date.now() / (minutes * 60000));
  const key = digest(`${slot}:${identity}`);
  const expires = new Date((slot + 1) * minutes * 60000);
  const { rows } = await pool.query(
    "INSERT INTO rate_limits(key,attempts,expires_at) VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET attempts=rate_limits.attempts+1 WHERE rate_limits.attempts < $3 RETURNING attempts",
    [key, expires, max],
  );
  return rows.length > 0;
}
