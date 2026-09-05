import { readConfig } from "../src/config.js";
import { createPool, migrate } from "../src/db.js";
const pool = createPool(readConfig());
try {
  const count = await migrate(pool);
  console.log(JSON.stringify({ event: "migrations_complete", version: count }));
} catch (error) {
  console.error(
    JSON.stringify({
      event: "migration_failed",
      code: error.code || "MIGRATION_ERROR",
    }),
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
