import pg from "pg";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { SCHEMA_VERSION } from "./config.js";

export function createPool(config) {
  return new pg.Pool({
    connectionString: config.databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
    ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
  });
}
export async function transaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
export async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(72431001)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const directory = fileURLToPath(new URL("../migrations/", import.meta.url));
    const files = (await readdir(directory))
      .filter((x) => /^\d{3}_.+\.sql$/.test(x))
      .sort();
    const applied = (
      await client.query("SELECT * FROM schema_migrations ORDER BY version")
    ).rows;
    const versions = new Set(files.map((x) => Number(x.split("_")[0])));
    if (applied.some((x) => !versions.has(x.version)))
      throw new Error(
        "Database contains unsupported migrations. Use a compatible application release.",
      );
    for (const name of files) {
      const version = Number(name.split("_")[0]);
      const sql = await readFile(`${directory}/${name}`, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = applied.find((x) => x.version === version);
      if (existing) {
        if (existing.checksum !== checksum)
          throw new Error(`Migration ${version} checksum mismatch.`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations(version,name,checksum) VALUES($1,$2,$3)",
          [version, name, checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return files.length;
  } finally {
    await client.query("SELECT pg_advisory_unlock(72431001)").catch(() => {});
    client.release();
  }
}
export async function checkSchema(pool) {
  const { rows } = await pool.query(
    "SELECT max(version)::int AS version FROM schema_migrations",
  );
  if (rows[0].version !== SCHEMA_VERSION)
    throw new Error(
      "Database schema does not match this application release. Run migrations first.",
    );
  return rows[0].version;
}
