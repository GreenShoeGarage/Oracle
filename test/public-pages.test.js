import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { VERSION } from '../src/config.js';

async function page(path, { environment = 'production', method = 'GET' } = {}) {
  const headers = new Headers();
  let status, body;
  const app = createApp({ pool: { query() { throw new Error('Public content must not read private data.'); } }, config: { origin: 'https://oracle.greenshoegarage.com', appEnv: environment, production: true }, logger() {} });
  const response = { headersSent: false, setHeader(name, value) { headers.set(name, value); }, writeHead(code, extra = {}) { status = code; for (const [name, value] of Object.entries(extra)) headers.set(name, value); this.headersSent = true; }, end(value) { body = value == null ? '' : value.toString(); } };
  await app({ url: path, method, headers: {} }, response);
  return { status, headers, body };
}

test('public landing content and help are useful before JavaScript without reading account data', async () => {
  const home = await page('/');
  assert.equal(home.status, 200);
  assert.match(home.body, /id="public-intro"/);
  assert.match(home.body, /Fantasy/);
  assert.match(home.body, /Cyberpunk/);
  assert.match(home.body, /Wasteland/);
  assert.match(home.body, /href="\/help.html"/);
  assert.match(home.body, /name="mobile-web-app-capable"/);
  assert.match(home.body, /rel="canonical" href="https:\/\/oracle.greenshoegarage.com\/"/);
  assert.equal(home.headers.get('x-robots-tag'), null);
  const help = await page('/help.html');
  assert.equal(help.status, 200);
  assert.match(help.body, /For players/);
  assert.equal((await page('/', { method: 'HEAD' })).body, '');
});

test('crawler routes advertise only public production pages and exclude staging', async () => {
  const robots = await page('/robots.txt'), sitemap = await page('/sitemap.xml');
  assert.equal(robots.status, 200);
  assert.match(robots.body, /Disallow: \/api\//);
  assert.match(robots.body, /Sitemap: https:\/\/oracle.greenshoegarage.com\/sitemap.xml/);
  assert.equal(sitemap.headers.get('content-type'), 'application/xml; charset=utf-8');
  assert.equal((sitemap.body.match(/<loc>/g) || []).length, 2);
  assert.match(sitemap.body, /<loc>https:\/\/oracle.greenshoegarage.com\/help.html<\/loc>/);
  for (const path of ['/', '/help.html', '/robots.txt', '/sitemap.xml']) {
    const staging = await page(path, { environment: 'staging' });
    assert.equal(staging.status, 200);
    assert.equal(staging.headers.get('x-robots-tag'), 'noindex, nofollow');
    if (path === '/robots.txt') assert.equal(staging.body, 'User-agent: *\nDisallow: /\n');
    if (path === '/sitemap.xml') assert.doesNotMatch(staging.body, /<loc>/);
  }
  assert.equal((await page('/sitemap.xml', { method: 'HEAD' })).body, '');
  assert.equal((await page('/robots.txt', { method: 'POST' })).status, 405);
});

test('startup and offline preparation modules are served as current public assets', async () => {
  for (const path of ['/display.js', '/startup.js', '/preparation-model.js', '/landing.css']) {
    const result = await page(path);
    assert.equal(result.status, 200, path);
    assert.equal(result.headers.get('x-oracle-shell-version'), VERSION);
    assert.equal(result.headers.get('content-type'), path.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8');
    assert.ok(result.body.length > 0);
  }
});

test('fictional example screens are public and cannot submit or run live app controls', async () => {
  const result = await page('/tour-examples.html');
  assert.equal(result.status, 200);
  assert.match(result.body, /Fictional, read-only examples/);
  assert.match(result.body, /inert aria-hidden="true"/);
  assert.doesNotMatch(result.body, /<(?:script|form|iframe|object|embed)\b/i);
  assert.doesNotMatch(result.body, /\s(?:on\w+|formaction|action|contenteditable|autofocus)=/i);
  assert.doesNotMatch(result.body, /mike@|greenshoegarage\.com\/api\/|__Host-oracle_session/);
  for (const path of ['/tour-examples.css', '/tour-catalog.json']) assert.equal((await page(path)).status, 200, path);
  const catalog = JSON.parse((await page('/tour-catalog.json')).body);
  assert.ok(catalog.length >= 19);
  assert.ok(catalog.every(row => /^[a-z][a-z0-9-]+$/.test(row.id) && row.title && row.description));
  for (const row of catalog) assert.ok(result.body.includes(`id="${row.id}"`));
  assert.equal((await page('/tour-examples.html', { method: 'POST' })).status, 405);
});
