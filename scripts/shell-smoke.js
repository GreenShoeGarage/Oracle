import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VERSION, SCHEMA_VERSION } from '../src/config.js';
import { EXPERIENCE_STUDIO_SHELL_ASSETS } from '../src/app-v23.js';

const origin = process.env.SMOKE_ORIGIN;
assert.ok(origin, 'Set SMOKE_ORIGIN to the deployment origin.');
assert.equal(new URL(origin).origin, origin, 'Use an exact origin.');
assert.equal(new URL(origin).protocol, 'https:', 'Remote release verification requires HTTPS.');
const expectedCommit = process.env.EXPECTED_COMMIT || process.env.GITHUB_SHA;
assert.match(expectedCommit || '', /^[0-9a-f]{40}$/, 'Pin the exact release commit.');
const options = { redirect: 'error', credentials: 'omit', headers: { 'Cache-Control': 'no-cache' } };
const get = path => fetch(new URL(path, origin), { ...options, signal: AbortSignal.timeout(15000) });
const ready = await get('/health/ready');
assert.equal(ready.status, 200);
const health = await ready.json();
assert.equal(health.status, 'ready');
assert.equal(health.version, VERSION);
assert.equal(health.schemaVersion, SCHEMA_VERSION);
assert.equal(health.deploymentCommit, expectedCommit);
const session = await get('/api/session');
assert.equal(session.status, 200);
const account = await session.json();
assert.equal(account.user, null, 'Release checks must stay unauthenticated.');
assert.equal(account.version, VERSION);
if (process.env.EXPECTED_ENVIRONMENT) assert.equal(account.environment, process.env.EXPECTED_ENVIRONMENT);

const expectedWorker = await readFile('public/sw-v23.js', 'utf8');
const match = /const STATIC_ASSETS=\[([\s\S]*?)\];/.exec(expectedWorker);
assert.ok(match, 'Cannot find the current offline asset manifest.');
const paths = [...new Set([...match[1].matchAll(/'([^']+)'/g)].map(entry => entry[1]).concat(Object.keys(EXPERIENCE_STUDIO_SHELL_ASSETS)))];
let totalBytes = 0;
for (const path of paths) {
  assert.ok(!path.startsWith('/api/'), 'Never cache private API responses as shell assets.');
  const response = await get(path);
  assert.equal(response.status, 200, path);
  assert.equal(response.headers.get('x-oracle-shell-version'), VERSION, `${path}: mismatched shell identity`);
  assert.ok(!response.redirected, path);
  assert.ok(!/private/i.test(response.headers.get('cache-control') || ''), path);
  const type = response.headers.get('content-type') || '';
  const expected = path === '/' || path.endsWith('.html') ? /^text\/html\b/i
    : path.endsWith('.js') ? /^(?:text|application)\/javascript\b/i
    : path.endsWith('.css') ? /^text\/css\b/i
    : path.endsWith('.png') ? /^image\/png\b/i
    : path.endsWith('.webmanifest') ? /^application\/(?:manifest\+json|json)\b/i
    : /^image\/svg\+xml\b/i;
  assert.match(type, expected, path);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length > 0 && bytes.length <= 2_000_000, `${path}: asset byte limit`);
  totalBytes += bytes.length;
  if (Object.hasOwn(EXPERIENCE_STUDIO_SHELL_ASSETS, path)) {
    assert.deepEqual(bytes, await readFile(`public/${EXPERIENCE_STUDIO_SHELL_ASSETS[path][0]}`), `${path}: deployed bytes must match the checked commit`);
  }
  console.log(`PASS shell ${path}`);
}
assert.ok(totalBytes <= 10_000_000, 'The complete public shell must fit its installation budget.');
console.log(`PASS ${paths.length} public shell paths, ${totalBytes} bytes; exact v${VERSION}, schema ${SCHEMA_VERSION}, commit ${expectedCommit}. No gameplay or account writes.`);
