// Public, immutable application builds only. No API response or private game data
// enters the shell cache. Browser-client/build IDs keep active tabs on one build.
const VERSION = '1.4.0';
const CACHE_NAME = `oracle-static-v${VERSION}`;
const CONTROL_CACHE = 'oracle-shell-control-v1';
const COMPLETE_PATH = '/__oracle_shell_complete__';
const NETWORK_TIMEOUT_MS = 4000;
const INSTALL_TIMEOUT_MS = 12000;
const MAX_ASSET_BYTES = 2_000_000;
const STATIC_ASSETS = [
  '/', '/app.js', '/app-v13.js', '/app-core.js', '/style.css', '/themes.css', '/favicon.svg', '/kit.js', '/builder.js',
  '/display.js', '/startup.js', '/landing.css', '/preparation-model.js',
  '/characters-ui.js', '/characters-model.js', '/characters.css', '/admin-ui.js', '/qr.js',
  '/vendor/qrcode-generator-2.0.4.js', '/vendor/jsqr-1.4.0.js',
  '/adventure-model.js', '/adventure-player.js', '/adventure-organizer.js',
  '/adventure.css', '/adventure-organizer.css', '/offline.js', '/prop-code.js',
  '/exchange-model.js', '/exchanges-ui.js', '/exchanges.css', '/exchange-code.js',
  '/sharing-ui.js', '/sharing.css', '/story-model.js', '/story-ui.js', '/story.css',
  '/trace-model.js', '/trace-ui.js', '/trace.css', '/economy-model.js', '/economy-ui.js', '/economy.css',
  '/oath-model.js', '/oath-ui.js', '/oath.css', '/sigil-model.js', '/sigil-ui.js', '/sigil.css',
  '/static-model.js', '/static-ui.js', '/static.css', '/stagehand-model.js', '/stagehand-ui.js', '/stagehand-manage.js', '/stagehand.css',
  '/prop-effects.js', '/props.css', '/instrument-code.js',
  '/guide-ui.js', '/guide.css', '/help.html', '/help.css',
  '/field-store.js', '/field-sync.js', '/field-ui.js', '/field.css', '/connection.js',
  '/connections.html', '/connections.js', '/connections.css',
  '/arcs.html', '/arcs.js', '/arcs-store.js', '/arcs.css',
  '/manifest.webmanifest', '/install.js', '/app-icon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png',
];
const paths = new Set(STATIC_ASSETS);
const buildName = version => `oracle-static-v${version}`;
const validVersion = value => typeof value === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value);
const absolute = path => new URL(path, self.location.origin).href;
function cacheableRequest(request) {
  const url = new URL(request.url);
  return request.method === 'GET' && url.origin === self.location.origin && !url.search && !url.username && !url.password && paths.has(url.pathname) && !request.headers.has('authorization') && !request.headers.has('range');
}
function cacheableResponse(response, url, version = VERSION) {
  if (!response || response.status !== 200 || !response.ok || response.redirected || ['opaque', 'opaqueredirect'].includes(response.type)) return false;
  const type = response.headers.get('content-type') || '';
  const expected = url.pathname === '/' || url.pathname.endsWith('.html') ? /^text\/html\b/i : url.pathname.endsWith('.js') ? /^(?:text|application)\/javascript\b/i : url.pathname.endsWith('.css') ? /^text\/css\b/i : url.pathname.endsWith('.png') ? /^image\/png\b/i : url.pathname.endsWith('.webmanifest') ? /^application\/(?:manifest\+json|json)\b/i : /^image\/svg\+xml\b/i;
  if (!expected.test(type) || response.headers.get('x-oracle-shell-version') !== version || /private/i.test(response.headers.get('cache-control') || '') || response.headers.get('vary') === '*') return false;
  if (Number(response.headers.get('content-length') || 0) > MAX_ASSET_BYTES) return false;
  if (!response.url) return true;
  const actual = new URL(response.url);
  return actual.origin === url.origin && actual.pathname === url.pathname && !actual.search;
}
async function timedFetch(url, timeout = NETWORK_TIMEOUT_MS, version = VERSION) {
  const controller = new AbortController(); let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(new Request(url, { cache: 'reload', credentials: 'omit', redirect: 'error', signal: controller.signal }));
        if (!cacheableResponse(response, new URL(url), version)) throw new Error('ORACLE public shell response does not match this build.');
        const reader = response.body?.getReader(); if (!reader) return response;
        const chunks = []; let length = 0;
        try { while (true) { const item = await reader.read(); if (item.done) break; length += item.value.byteLength; if (length > MAX_ASSET_BYTES) { controller.abort(); throw new Error('ORACLE public shell asset is too large.'); } chunks.push(item.value); } }
        finally { reader.releaseLock(); }
        const bytes = new Uint8Array(length); let position = 0; for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
        return new Response(bytes, { status: 200, headers: response.headers });
      })(),
      new Promise((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('ORACLE public shell request timed out.')); }, timeout); }),
    ]);
  } finally { clearTimeout(timer); }
}
async function complete(version) {
  if (!validVersion(version)) return false;
  try { const cache = await caches.open(buildName(version)); const marker = await cache.match(absolute(COMPLETE_PATH)); return Boolean(marker && await marker.text() === version); } catch { return false; }
}
async function clientVersion(clientId) {
  if (!clientId) return null;
  try { const cache = await caches.open(CONTROL_CACHE), row = await cache.match(absolute(`/__oracle_shell_client__/${encodeURIComponent(clientId)}`)); const value = row && await row.text(); return validVersion(value) ? value : null; } catch { return null; }
}
async function pinClient(clientId, version) {
  if (!clientId || !validVersion(version)) return false;
  try { const cache = await caches.open(CONTROL_CACHE); await cache.put(absolute(`/__oracle_shell_client__/${encodeURIComponent(clientId)}`), new Response(version, { headers: { 'content-type': 'text/plain' } })); return true; } catch { return false; }
}
function unavailable() { return new Response('ORACLE cannot load a complete matching app version. Reconnect, close other ORACLE tabs, and reopen the app. Saved device data remains separate.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } }); }
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    if (await complete(VERSION)) return;
    await caches.delete(CACHE_NAME);
    const cache = await caches.open(CACHE_NAME); let index = 0, totalBytes = 0, failed = false;
    const deadline = Date.now() + 60000;
    try {
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (!failed && index < STATIC_ASSETS.length) {
          if (Date.now() > deadline) throw new Error('ORACLE public shell installation timed out.');
          const path = STATIC_ASSETS[index++], url = new URL(path, self.location.origin), response = await timedFetch(url, INSTALL_TIMEOUT_MS);
          if (!cacheableResponse(response, url)) throw new Error('ORACLE offline shell is incomplete or contains mixed versions.');
          const bytes = await response.arrayBuffer(); totalBytes += bytes.byteLength;
          if (bytes.byteLength > MAX_ASSET_BYTES || totalBytes > 8_000_000) throw new Error('ORACLE public shell exceeds its cache limit.');
          if (failed) return;
          await cache.put(url.href, new Response(bytes, { status: 200, headers: response.headers }));
        }
      }));
      await cache.put(absolute(COMPLETE_PATH), new Response(VERSION, { headers: { 'content-type': 'text/plain' } }));
    } catch (error) { failed = true; await caches.delete(CACHE_NAME); throw error; }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }), keep = new Set([CACHE_NAME]); let unknown = false;
    for (const client of clients) { const version = await clientVersion(client.id); if (version) keep.add(buildName(version)); else unknown = true; }
    if (!unknown) { const names = await caches.keys(); await Promise.all(names.filter(name => name.startsWith('oracle-static-') && !keep.has(name)).map(name => caches.delete(name))); }
    try { const controls = await caches.open(CONTROL_CACHE), alive = new Set(clients.map(client => absolute(`/__oracle_shell_client__/${encodeURIComponent(client.id)}`))); for (const key of await controls.keys()) if (!alive.has(key.url)) await controls.delete(key); } catch { /* Metadata cleanup can wait for the next activation. */ }
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  const message = event.data, source = event.source;
  if (!message || typeof message !== 'object' || !source?.id || !source.url || new URL(source.url).origin !== self.location.origin) return;
  const reply = value => event.ports?.[0]?.postMessage(value);
  if (message.type === 'ORACLE_CLIENT_VERSION') event.waitUntil((async () => { const accepted = await complete(message.version) && await pinClient(source.id, message.version); reply({ ok: Boolean(accepted), version: VERSION }); })());
  else if (message.type === 'ORACLE_APPLY_UPDATE') event.waitUntil((async () => {
    if (!await complete(VERSION) || !validVersion(message.clientVersion) || !await complete(message.clientVersion) || !await pinClient(source.id, message.clientVersion)) { reply({ ok: false, reason: 'incomplete' }); return; }
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) { const version = await clientVersion(client.id); if (!version || !await complete(version)) { reply({ ok: false, reason: 'other-tabs' }); return; } }
    reply({ ok: true, version: VERSION });
    await self.skipWaiting();
  })());
});
self.addEventListener('fetch', event => {
  if (!cacheableRequest(event.request)) return;
  event.respondWith((async () => {
    const url = new URL(event.request.url), navigation = event.request.mode === 'navigate';
    let version = navigation ? VERSION : await clientVersion(event.clientId);
    if (!version) version = VERSION;
    if (navigation) await pinClient(event.resultingClientId || event.clientId, VERSION);
    try { const cache = await caches.open(buildName(version)), response = await cache.match(url.href); if (response && await complete(version)) return response; } catch { /* Matching online build can recover unavailable storage. */ }
    try { const response = await timedFetch(url, NETWORK_TIMEOUT_MS, version); return cacheableResponse(response, url, version) ? response : unavailable(); } catch { return unavailable(); }
  })());
});
