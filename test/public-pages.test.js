import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { VERSION } from '../src/config.js';
import { TOUR_SCREEN_IDS } from '../src/tour-assets.js';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

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
  assert.equal((sitemap.body.match(/<loc>/g) || []).length, 3);
  assert.match(sitemap.body, /<loc>https:\/\/oracle.greenshoegarage.com\/help.html<\/loc>/);
  for (const path of ['/', '/tour.html', '/help.html', '/robots.txt', '/sitemap.xml']) {
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

test('the public tour has working screenshot links and text for every instrument without account access', async () => {
  const result = await page('/tour.html');
  assert.equal(result.status, 200);
  const dom = new JSDOM(result.body);
  try {
    const document = dom.window.document;
    assert.equal(document.querySelectorAll('h1').length, 1);
    assert.equal(document.querySelectorAll('form').length, 0);
    assert.ok(document.querySelector('link[rel="canonical"]').href.endsWith('/tour.html'));
    for (const id of ['relic','dead-drop','cipherbox','wayfinder','trace','whisper','broadside','bazaar','oathbook','sigil','static','stagehand']) assert.ok(document.getElementById(id), id);
    for (const link of document.querySelectorAll('a[href^="#"]')) assert.ok(document.getElementById(link.getAttribute('href').slice(1)), link.href);
    for (const image of document.querySelectorAll('img')) {
      assert.ok(image.alt.length > 20);
      assert.ok(Number(image.getAttribute('width')) > 0 && Number(image.getAttribute('height')) > 0);
      assert.ok(TOUR_SCREEN_IDS.some(id => image.getAttribute('src') === `/tour-images/${id}.jpg`));
    }
    assert.ok(document.querySelectorAll('img').length >= 19);
  } finally { dom.window.close(); }
  const worker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.doesNotMatch(worker, /tour-images\//, 'Marketing screenshots must not enlarge the field cache.');
  for (const id of TOUR_SCREEN_IDS) {
    const bytes = await readFile(new URL(`../public/tour-images/${id}.jpg`, import.meta.url));
    assert.equal(bytes.subarray(0, 3).toString('hex'), 'ffd8ff', id);
    const response = await page(`/tour-images/${id}.jpg`);
    assert.equal(response.status, 200, id);
    assert.equal(response.headers.get('content-type'), 'image/jpeg', id);
  }
  assert.equal((await page('/tour-images/not-a-screen.jpg')).status, 404);
  assert.match((await page('/')).body, /href="\/tour.html"/);
  assert.match((await page('/sitemap.xml')).body, /https:\/\/oracle.greenshoegarage.com\/tour.html/);
});
