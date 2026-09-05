import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
const image = process.env.ORACLE_TEST_IMAGE;
const databaseUrl = process.env.TEST_DATABASE_URL;
if (
  !image ||
  !databaseUrl ||
  !new URL(databaseUrl).pathname.slice(1).startsWith("oracle_test")
)
  throw new Error("Set ORACLE_TEST_IMAGE and a disposable TEST_DATABASE_URL.");
const name = `oracle-check-${process.pid}`;
const origin = "https://oracle-ci.invalid";
const run = (args) => {
  const r = spawnSync("docker", args, {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  if (r.status !== 0) throw new Error(`Docker check failed: ${r.stderr}`);
  return r.stdout.trim();
};
try {
  // CI uses Linux host networking so the app reaches the disposable PostgreSQL port.
  run([
    "run",
    "--detach",
    "--network",
    "host",
    "--name",
    name,
    "-e",
    "DATABASE_URL",
    "-e",
    "NODE_ENV=production",
    "-e",
    `APP_ORIGIN=${origin}`,
    "-e",
    "APP_ENV=test",
    "-e",
    "PORT=3000",
    image,
  ]);
  let ready = false;
  for (let n = 0; n < 60; n++) {
    try {
      const response = await fetch("http://127.0.0.1:3000/health/ready", {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(500);
  }
  assert.ok(ready, "Built production image must become ready.");
  for (const path of ["/", "/app.js", "/builder.js", "/kit.js", "/style.css", "/themes.css", "/api/session"])
    assert.equal(
      (await fetch(`http://127.0.0.1:3000${path}`)).status,
      200,
      path,
    );
  const response = await fetch("http://127.0.0.1:3000/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({
      displayName: "Container check",
      email: `container-${process.pid}@example.test`,
      password: "CI-only container passphrase 2026!",
    }),
  });
  assert.equal(response.status, 201, "Production registration path");
  const cookie = response.headers.get("set-cookie");
  assert.ok(
    cookie?.startsWith("__Host-oracle_session=") &&
      cookie.includes("; Secure") &&
      cookie.includes("HttpOnly"),
  );
  assert.equal(
    response.headers.get("strict-transport-security"),
    "max-age=31536000",
  );
  run(["stop", "--time", "15", name]);
  assert.equal(
    run(["inspect", "--format", "{{.State.ExitCode}}", name]),
    "0",
    "Container must exit cleanly.",
  );
  console.log(
    "Built image, production configuration, secure session creation and graceful stop passed.",
  );
} finally {
  spawnSync("docker", ["rm", "--force", name], { stdio: "ignore" });
}
