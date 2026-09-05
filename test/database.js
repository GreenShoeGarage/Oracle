import { PGlite } from "@electric-sql/pglite";
import { createPool } from "../src/db.js";
export async function testDatabase() {
  if (process.env.TEST_DATABASE_URL) {
    const pool = createPool({
      databaseUrl: process.env.TEST_DATABASE_URL,
      ssl: false,
    });
    const dbName = (await pool.query("SELECT current_database() AS name"))
      .rows[0].name;
    if (!dbName.startsWith("oracle_test")) {
      await pool.end();
      throw new Error("Tests require an isolated database named oracle_test*.");
    }
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    return { pool, kind: "PostgreSQL TCP", close: () => pool.end() };
  }
  // PGlite runs PostgreSQL in WebAssembly. It has a single connection; CI also
  // runs these tests on real PostgreSQL connections to verify row-lock races.
  const pg = new PGlite();
  let tail = Promise.resolve();
  const acquire = async () => {
    let release;
    const previous = tail;
    tail = new Promise((r) => {
      release = r;
    });
    await previous;
    return release;
  };
  const query = (sql, params) =>
    !params && sql.split(";").filter((x) => x.trim()).length > 1
      ? pg.exec(sql).then((r) => r.at(-1))
      : pg.query(sql, params);
  const pool = {
    async query(sql, params) {
      const release = await acquire();
      try {
        return await query(sql, params);
      } finally {
        release();
      }
    },
    async connect() {
      const release = await acquire();
      return { query, release };
    },
  };
  return {
    pool,
    kind: "PGlite PostgreSQL (single connection)",
    pg,
    close: () => pg.close(),
  };
}
