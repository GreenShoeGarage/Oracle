import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { VERSION } from "../src/config.js";
for (const dir of ["src", "scripts", "test", "public"]) {
  for (const file of await readdir(new URL(`../${dir}/`, import.meta.url))) {
    if (!file.endsWith(".js")) continue;
    const result = spawnSync(process.execPath, ["--check", `${dir}/${file}`], { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
const pkg = JSON.parse(await readFile("package.json", "utf8"));
assert.equal(VERSION, pkg.version, "App/package versions must match.");
const workerSource = await readFile("public/sw-v17.js", "utf8");
assert.ok(workerSource.includes(`const VERSION='${VERSION}';`), "The v1.7 cached public shell must match the server version.");
assert.ok((await readFile("public/install-v17.js", "utf8")).includes(`export const SHELL_VERSION = '${VERSION}';`), "The v1.7 install controller must identify this shell version.");
for (const asset of ["/landing.css","/display.js","/startup.js","/preparation-model.js","/app.js","/app-v16.js","/app-v15.js","/app-v14.js","/app-v13.js","/app-core.js","/install.js","/connections.html","/connections.js","/connections.css","/arcs.html","/arcs.js","/arcs-store.js","/arcs.css","/projects.html","/projects.js","/projects.css","/project-effects-ui.js"]) {
  assert.ok(workerSource.includes(`'${asset}'`), `${asset} must be included in offline installation.`);
}
const html = await readFile("public/index.html", "utf8");
for (const asset of ["/style.css", "/themes.css", "/characters.css", "/adventure.css", "/adventure-organizer.css", "/exchanges.css", "/sharing.css", "/story.css", "/trace.css", "/economy.css", "/oath.css", "/sigil.css", "/static.css", "/stagehand.css", "/props.css", "/field.css", "/guide.css", "/app.js", "/favicon.svg", "/manifest.webmanifest", "/apple-touch-icon.png"]) {
  assert.ok(html.includes(asset));
  await readFile(`public${asset}`);
}
for (const file of ["public/projects.html","public/projects-ui.js","public/projects.css","public/project-effects-ui.js","public/app-v16.js","public/sw-v17.js","public/install-v17.js","src/projects-app.js","src/project-effects-app.js","src/project-starters.js","src/app-v16.js","migrations/013_community_projects.sql","migrations/014_project_effects.sql","migrations/015_starter_experiences.sql","src/app-v17.js","src/experiences-app.js","src/experience-starters.js","public/experiences.html","public/experiences-ui.js","public/experiences.css","migrations/015_starter_experiences.sql","src/app-v17.js","src/experiences-app.js","src/experience-starters.js","public/experiences.html","public/experiences-ui.js","public/experiences.css","migrations/015_starter_experiences.sql","src/app-v17.js","src/experiences-app.js","src/experience-starters.js","public/experiences.html","public/experiences-ui.js","public/experiences.css"]) await readFile(file);
const migration = await readFile("migrations/014_project_effects.sql","migrations/015_starter_experiences.sql","src/app-v17.js","src/experiences-app.js","src/experience-starters.js","public/experiences.html","public/experiences-ui.js","public/experiences.css","migrations/015_starter_experiences.sql","src/app-v17.js","src/experiences-app.js","src/experience-starters.js","public/experiences.html","public/experiences-ui.js","public/experiences.css","migrations/015_starter_experiences.sql","src/app-v17.js","src/experiences-app.js","src/experience-starters.js","public/experiences.html","public/experiences-ui.js","public/experiences.css", "utf8");
for (const marker of ["project_donation","project_refund","community_project_consequences","community_project_effects","community_project_refunds"]) assert.ok(migration.includes(marker), `Batch 16 migration must include ${marker}.`);
const manifest = JSON.parse(await readFile("public/manifest.webmanifest", "utf8"));
assert.match(manifest.name, /ORACLE/);
assert.equal(manifest.start_url, "/");
assert.equal(manifest.scope, "/");
assert.equal(manifest.display, "standalone");
for (const icon of manifest.icons) {
  assert.match(icon.src, /^\/[a-z0-9-]+\.(png|svg)$/);
  const bytes = await readFile(`public${icon.src}`);
  if (icon.type === "image/svg+xml") { assert.equal(icon.sizes, "any"); assert.match(bytes.toString("utf8"), /<svg\b/); }
  else { assert.equal(icon.type, "image/png"); assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a"); assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes); }
}
console.log("Syntax, version, entrypoint, Batch 17, and offline-shell assets verified.");
