import { createServer } from "node:http";
import { createAppV14 } from "./app-v14.js";
import { createPool, checkSchema } from "./db.js";
import { readConfig, VERSION } from "./config.js";

let pool;
try {
  const config = readConfig();
  pool = createPool(config);
  pool.on("error", (error) => console.error(JSON.stringify({ event: "database_pool_error", code: error.code || "DATABASE_ERROR" })));
  await checkSchema(pool);
  if (config.bootstrapSuperuserEmail) {
    const { rows } = await pool.query("SELECT is_superuser,is_disabled FROM users WHERE email=$1", [config.bootstrapSuperuserEmail]);
    console.log(JSON.stringify({ event: "superuser_status", accountExists: Boolean(rows[0]), enabled: rows[0]?.is_superuser === true && rows[0]?.is_disabled === false }));
  }
  const server = createServer({ requestTimeout: 30000, headersTimeout: 10000, maxHeaderSize: 16384 }, createAppV14({ pool, config, logger: (entry) => console.log(JSON.stringify(entry)) }));
  server.listen(config.port, "0.0.0.0", () => console.log(JSON.stringify({ event: "server_ready", version: VERSION, environment: config.appEnv, port: config.port })));
  const cleanup = setInterval(() => pool.query("DELETE FROM sessions WHERE expires_at<now()").then(() => pool.query("DELETE FROM rate_limits WHERE expires_at<now()")).catch((error) => console.error(JSON.stringify({ event: "cleanup_failed", code: error.code || "DATABASE_ERROR" }))), 3600000);
  cleanup.unref();
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(cleanup);
    console.log(JSON.stringify({ event: "shutdown_started" }));
    const deadline = setTimeout(() => process.exit(1), 12000); deadline.unref();
    server.close(async () => { await pool.end(); clearTimeout(deadline); process.exit(0); });
    server.closeIdleConnections();
  };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
} catch (error) {
  console.error(JSON.stringify({ event: "startup_failed", code: error.code || "CONFIG_OR_SCHEMA_ERROR", message: error.code ? "Check database connection and migrations." : error.message }));
  if (pool) await pool.end();
  process.exitCode = 1;
}
