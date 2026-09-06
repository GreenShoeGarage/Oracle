export const VERSION = "0.7.0";
export const SCHEMA_VERSION = 8;
export function readConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be a valid TCP port.");
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const origin =
    env.APP_ORIGIN ||
    (env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${env.RAILWAY_PUBLIC_DOMAIN}`
      : !production
        ? `http://localhost:${port}`
        : "");
  if (!origin) throw new Error("APP_ORIGIN is required in production.");
  const parsed = new URL(origin);
  if (
    parsed.origin !== origin ||
    !["http:", "https:"].includes(parsed.protocol) ||
    (production && parsed.protocol !== "https:")
  )
    throw new Error(
      "APP_ORIGIN must be an exact origin; production requires HTTPS.",
    );
  if (env.DATABASE_SSL && !["require", "disable"].includes(env.DATABASE_SSL))
    throw new Error("DATABASE_SSL must be require or disable.");
  const bootstrapSuperuserEmail = (env.BOOTSTRAP_SUPERUSER_EMAIL || "")
    .trim()
    .toLowerCase();
  if (
    bootstrapSuperuserEmail &&
    (bootstrapSuperuserEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bootstrapSuperuserEmail))
  )
    throw new Error("BOOTSTRAP_SUPERUSER_EMAIL must be a valid email address.");
  const bootstrapSetupToken = env.BOOTSTRAP_SUPERUSER_SETUP_TOKEN || "";
  if (bootstrapSetupToken && (!bootstrapSuperuserEmail || bootstrapSetupToken.length < 32 || bootstrapSetupToken.length > 512))
    throw new Error("BOOTSTRAP_SUPERUSER_SETUP_TOKEN requires a reserved email and 32–512 characters.");
  return {
    deploymentCommit: env.RAILWAY_GIT_COMMIT_SHA || null,
    port,
    origin,
    production,
    databaseUrl: env.DATABASE_URL,
    ssl: env.DATABASE_SSL === "require",
    appEnv: env.APP_ENV || (production ? "production" : "development"),
    registrationEnabled: env.REGISTRATION_ENABLED !== "false",
    bootstrapSuperuserEmail,
    bootstrapSetupToken,
    cookieName: production ? "__Host-oracle_session" : "oracle_session",
  };
}
