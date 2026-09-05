import { createServer } from "node:http";
import { createApp } from "./app.js";
import { createPool, checkSchema } from "./db.js";
import { readConfig, VERSION } from "./config.js";

let pool;
try {
  const config = readConfig();
  pool = createPool(config);
  pool.on("error", (error) =>
    console.error(
      JSON.stringify({
        event: "database_pool_error",
        code: error.code || "DATABASE_ERROR",
      }),
    ),
  );
  await checkSchema(pool);
  const server = createServer(
    { requestTimeout: 30000, headersTimeout: 10000, maxHeaderSize: 16384 },
    createApp({ pool, config }),
  );
  server.listen(config.port, "0.0.0.0", () =>
    console.log(
      JSON.stringify({
        event: "server_ready",
        version: VERSION,
        environment: config.appEnv,
        port: config.port,
      }),
    ),
  );
  const cleanup = setInterval(
    () =>
      pool
        .query("DELETE FROM sessions WHERE expires_at<now()")
        .then(() =>
          pool.query("DELETE FROM rate_limits WHERE expires_at<now()"),
        )
        .catch((error) =>
          console.error(
            JSON.stringify({
              event: "cleanup_failed",
              code: error.code || "DATABASE_ERROR",
            }),
          ),
        ),
    3600000,
  );
  cleanup.unref();
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(cleanup);
    console.log(JSON.stringify({ event: "shutdown_started" }));
    const deadline = setTimeout(() => process.exit(1), 12000);
    deadline.unref();
    server.close(async () => {
      await pool.end();
      clearTimeout(deadline);
      process.exit(0);
    });
    server.closeIdleConnections();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
} catch (error) {
  console.error(
    JSON.stringify({
      event: "startup_failed",
      code: error.code || "CONFIG_OR_SCHEMA_ERROR",
      message: error.code
        ? "Check database connection and migrations."
        : error.message,
    }),
  );
  if (pool) await pool.end();
  process.exitCode = 1;
}
