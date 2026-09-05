import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { VERSION } from "../src/config.js";
for (const dir of ["src", "scripts", "test", "public"]) {
  for (const file of await readdir(new URL(`../${dir}/`, import.meta.url))) {
    if (!file.endsWith(".js")) continue;
    const result = spawnSync(process.execPath, ["--check", `${dir}/${file}`], {
      stdio: "inherit",
    });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
const pkg = JSON.parse(await readFile("package.json", "utf8"));
assert.equal(VERSION, pkg.version, "App/package versions must match.");
const html = await readFile("public/index.html", "utf8");
for (const asset of ["/style.css", "/app.js", "/favicon.svg"]) {
  assert.ok(html.includes(asset));
  await readFile(`public${asset}`);
}
console.log("Syntax, version, and entrypoint assets verified.");
