// Cache only this exact public application shell. API responses, credentials,
// badge/prop/exchange lookups, and gameplay actions always go directly to the network.
const CACHE_NAME = "oracle-static-v0.5.0";
const STATIC_ASSETS = [
  "/", "/app.js", "/style.css", "/themes.css", "/favicon.svg", "/kit.js", "/builder.js",
  "/characters-ui.js", "/characters-model.js", "/characters.css", "/admin-ui.js", "/qr.js",
  "/vendor/qrcode-generator-2.0.4.js", "/vendor/jsqr-1.4.0.js",
  "/adventure-model.js", "/adventure-player.js", "/adventure-organizer.js",
  "/adventure.css", "/adventure-organizer.css", "/offline.js", "/prop-code.js",
  "/exchange-model.js", "/exchanges-ui.js", "/exchanges.css", "/exchange-code.js",
  "/sharing-ui.js", "/sharing.css",
];
const paths = new Set(STATIC_ASSETS);
function cacheableRequest(request) {
  const url = new URL(request.url);
  return request.method === "GET" && url.origin === self.location.origin && !url.search && !url.username && !url.password &&
    paths.has(url.pathname) && !request.headers.has("authorization") && !request.headers.has("range");
}
function cacheableResponse(response, url) {
  if (!response || !response.ok || response.status !== 200 || response.redirected || response.type === "opaque") return false;
  const type = response.headers.get("content-type") || "";
  const expected = url.pathname === "/" ? /^text\/html\b/i : url.pathname.endsWith(".js") ? /^(?:text|application)\/javascript\b/i : url.pathname.endsWith(".css") ? /^text\/css\b/i : /^image\/svg\+xml\b/i;
  return expected.test(type) && (!response.url || new URL(response.url).origin === self.location.origin && new URL(response.url).pathname === url.pathname && !new URL(response.url).search);
}
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(STATIC_ASSETS.map(async (path) => {
      const url = new URL(path, self.location.origin);
      const response = await fetch(new Request(url, { cache: "reload", credentials: "omit" }));
      if (!cacheableResponse(response, url)) throw new Error("ORACLE offline shell is incomplete.");
      await cache.put(url.href, response);
    }));
  })());
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("oracle-static-") && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  if (!cacheableRequest(event.request)) return;
  event.respondWith((async () => {
    const url = new URL(event.request.url);
    let cache;
    try { cache = await caches.open(CACHE_NAME); } catch { /* Storage failure must not break the online app. */ }
    try {
      const response = await fetch(event.request);
      if (cache && cacheableResponse(response, url)) {
        try { await cache.put(url.href, response.clone()); } catch { /* Keep serving the valid online response. */ }
      }
      return response;
    } catch (error) {
      const cached = cache && await cache.match(url.href);
      if (cached) return cached;
      throw error;
    }
  })());
});
