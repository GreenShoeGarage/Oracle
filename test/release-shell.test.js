import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createAppV18, FIELD_SHELL_ASSETS } from '../src/app-v18.js';
import { VERSION } from '../src/config.js';

// Unlike source-marker tests, this exercises the actual server wrapper chain.
// No database or gameplay writes are permitted for public shell requests.
test('every offline shell asset has the current release identity through the production handler', async (t) => {
  const config = { origin: 'http://127.0.0.1', cookieName: 'oracle_session', production: false, appEnv: 'test', registrationEnabled: true };
  const pool = { query: async () => { throw new Error('Public shell assets must not query gameplay or account data.'); } };
  const server = createServer(createAppV18({ pool, config }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const worker = await readFile('public/sw-v18.js', 'utf8');
  const declaration = /const STATIC_ASSETS=\[([\s\S]*?)\];/.exec(worker);
  assert.ok(declaration, 'The complete service worker asset list must be discoverable.');
  const paths = [...declaration[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.ok(paths.length > 70, 'Do not replace this check with a partial asset list.');
  assert.equal(new Set(paths).size, paths.length, 'Offline assets must be unique.');
  for (const path of new Set([...paths, ...Object.keys(FIELD_SHELL_ASSETS)])) {
    assert.ok(!path.startsWith('/api/'), 'Private API responses are not public shell assets.');
    const response = await fetch(origin + path, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('x-oracle-shell-version'), VERSION, `${path} must match the installed shell, including legacy aliases`);
    assert.ok(!/private/i.test(response.headers.get('cache-control') || ''), path);
    assert.equal(response.headers.get('set-cookie'), null, 'Public shell checks must not establish a session.');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length > 0 && bytes.length <= 2_000_000, path);
    if (Object.hasOwn(FIELD_SHELL_ASSETS, path)) {
      const [file, mime] = FIELD_SHELL_ASSETS[path];
      assert.equal(response.headers.get('content-type'), `${mime}; charset=utf-8`, path);
      assert.deepEqual(bytes, await readFile(`public/${file}`), `${path} must retain the exact intended module contents`);
      const head = await fetch(origin + path, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
      assert.equal(head.status, 200, path);
      assert.equal(head.headers.get('x-oracle-shell-version'), VERSION, path);
      assert.equal(Number(head.headers.get('content-length')), bytes.length, path);
      assert.equal((await head.arrayBuffer()).byteLength, 0, path);
    }
  }
  const api = await fetch(`${origin}/api/events/00000000-0000-4000-8000-000000000001/projects`, { signal: AbortSignal.timeout(10000) });
  assert.equal(api.status, 401, 'Gameplay routes still require authentication.');
  assert.equal(api.headers.get('x-oracle-shell-version'), null, 'Do not stamp API responses as cacheable public assets.');
});
