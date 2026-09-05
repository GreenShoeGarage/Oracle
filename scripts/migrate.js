import { readConfig } from "../src/config.js";
import { createPool, migrate } from "../src/db.js";
import { provisionSuperuser } from "../src/admin.js";
const config = readConfig();
const pool = createPool(config);
try {
  const count = await migrate(pool);
  console.log(JSON.stringify({ event: "migrations_complete", version: count }));
  const provisioned = await provisionSuperuser(pool, config);
  if (provisioned) console.log(JSON.stringify(provisioned));
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
