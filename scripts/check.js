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
for (const asset of ["/style.css", "/themes.css", "/characters.css", "/adventure.css", "/adventure-organizer.css", "/exchanges.css", "/sharing.css", "/story.css", "/trace.css", "/economy.css", "/oath.css", "/sigil.css", "/static.css", "/stagehand.css", "/props.css", "/field.css", "/app.js", "/favicon.svg", "/manifest.webmanifest", "/apple-touch-icon.png"]) {
  assert.ok(html.includes(asset));
  await readFile(`public${asset}`);
}
const manifest = JSON.parse(await readFile("public/manifest.webmanifest", "utf8"));
assert.match(manifest.name, /ORACLE/);
assert.equal(manifest.start_url, "/");
assert.equal(manifest.scope, "/");
assert.equal(manifest.display, "standalone");
for (const icon of manifest.icons) {
  assert.match(icon.src, /^\/[a-z0-9-]+\.(png|svg)$/);
  const bytes = await readFile(`public${icon.src}`);
  if (icon.type === "image/svg+xml") {
    assert.equal(icon.sizes, "any"); assert.match(bytes.toString("utf8"), /<svg\b/);
  } else {
    assert.equal(icon.type, "image/png");
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
  }
}
console.log("Syntax, version, and entrypoint assets verified.");
