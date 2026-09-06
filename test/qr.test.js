import test from "node:test";
import assert from "node:assert/strict";
import jsQR from "../public/vendor/jsqr-1.4.0.js";
import { badgeQrPixels, renderBadgeQR, parseBadgeInput, scanImage, startScanner } from "../public/qr.js";

const origin = "https://oracle.greenshoegarage.com";
const code = "ABCD2345EFGH6789JKLM";
const link = `${origin}/#badge/${code}`;

function globals(t, values) {
  for (const [name, value] of Object.entries(values)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
    });
  }
}

test("real generated QR pixels round-trip through the independent decoder", () => {
  for (const payload of [code, link, `https://oracle-production-488d.up.railway.app/#badge/${code}`]) {
    for (const size of [144, 256, 512]) {
      const image = badgeQrPixels(payload, size);
      assert.equal(jsQR(image.data, image.width, image.height)?.data, payload);
      assert.equal(image.width, image.height);
      assert.equal(image.data.length, image.width * image.height * 4);
      assert.ok(image.data.slice(0, image.width * 4 * 8).every((channel) => channel === 255), "At least four modules of white border.");
      assert.ok(image.data.every((channel) => channel === 0 || channel === 255), "Only solid black and white pixels.");
    }
  }
});

test("rendered canvas contains a decodable badge and replaces prior QR contents", () => {
  let drawn, child;
  const canvas = {
    style: {}, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; },
    getContext: () => ({
      createImageData: (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: (pixels) => { drawn = pixels; },
    }),
  };
  const container = { ownerDocument: { createElement: () => canvas }, replaceChildren: (element) => { child = element; } };
  assert.equal(renderBadgeQR(container, link), canvas);
  assert.equal(child, canvas);
  assert.equal(canvas.attributes.role, "img");
  assert.match(canvas.attributes["aria-label"], /QR code/);
  assert.equal(jsQR(drawn.data, canvas.width, canvas.height)?.data, link);
});

test("badge parser accepts formatted codes and only the exact same-origin badge link", () => {
  for (const input of [code, code.toLowerCase(), " ABCD-2345-EFGH-6789-JKLM ", "ABCD 2345 EFGH 6789 JKLM", link, link.toLowerCase()]) {
    assert.equal(parseBadgeInput(input, origin), code);
  }
  assert.equal(parseBadgeInput(`http://localhost:3000/#badge/${code}`, "http://localhost:3000"), code);
  for (const input of [
    "", null, 123, {}, "ABCD2345EFGH6789JKL0", code + "A", code.slice(1), "x".repeat(1025),
    `https://evil.test/#badge/${code}`, `https://oracle.greenshoegarage.com.evil.test/#badge/${code}`,
    `https://oracle.greenshoegarage.com@evil.test/#badge/${code}`, `https://evil.test@oracle.greenshoegarage.com/#badge/${code}`,
    `http://oracle.greenshoegarage.com/#badge/${code}`, `${origin}:444/#badge/${code}`,
    `${origin}/elsewhere#badge/${code}`, `${origin}/?redirect=evil#badge/${code}`, `${origin}/#badge/${code}/more`,
    `${origin}/#badge/%41${code.slice(1)}`, `${origin}/#badge/${code}?admin=true`, `${origin}/\n#badge/${code}`,
    `//#badge/${code}`, `/#badge/${code}`, `#badge/${code}`, `javascript:alert('${code}')`, `data:text/plain,${code}`,
    `<img src=x onerror=alert(1)>`, `${code}\u0000`, `ABCD\n2345EFGH6789JKLM`,
  ]) assert.throws(() => parseBadgeInput(input, origin), Error, String(input));
});

test("QR generation rejects unsupported text and invalid dimensions", () => {
  for (const value of [null, "", "x".repeat(513), "こんにちは", "test\ncode"]) assert.throws(() => badgeQrPixels(value));
  for (const size of [NaN, Infinity, 0, -1, 143, 1025, "256"]) assert.throws(() => badgeQrPixels(link, size));
});

test("photo scan rejects oversized, active, non-image and mislabeled files before decoding", async () => {
  for (const file of [
    null,
    new Blob(["plain badge text"], { type: "text/plain" }),
    new Blob(["<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"], { type: "image/svg+xml" }),
    new Blob(["<html>not really a PNG</html>"], { type: "image/png" }),
    new Blob(["not really a JPEG"], { type: "image/jpeg" }),
    new Blob(["not really a WebP"], { type: "image/webp" }),
    new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], { type: "image/png" }),
  ]) await assert.rejects(scanImage(file), /image|PNG|JPEG/);
});

test("photo pipeline decodes pixels and releases local image URLs on success and image errors", async (t) => {
  const pixels = badgeQrPixels(link);
  let failImage = false, revoked = 0;
  class BrowserDecodedImage {
    naturalWidth = pixels.width;
    naturalHeight = pixels.height;
    set src(value) { queueMicrotask(() => failImage ? this.onerror() : this.onload()); }
  }
  globals(t, {
    Image: BrowserDecodedImage,
    document: { createElement: () => ({ getContext: () => ({
      fillRect() {}, drawImage() {}, getImageData: () => pixels,
    }) }) },
  });
  t.mock.method(URL, "createObjectURL", () => "blob:local-only");
  t.mock.method(URL, "revokeObjectURL", (value) => { assert.equal(value, "blob:local-only"); revoked++; });
  // Browser image decoding is supplied by BrowserDecodedImage; jsQR decodes genuine QR pixels.
  const file = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], { type: "image/png" });
  assert.equal(await scanImage(file), link);
  assert.equal(revoked, 1);
  failImage = true;
  await assert.rejects(scanImage(file), /could not be opened/);
  assert.equal(revoked, 2);
});

function cameraFixture(t, getUserMedia, source = badgeQrPixels(link)) {
  let stopped = 0, paused = 0, drawCount = 0, nextId = 1;
  const pending = new Map(), listeners = new Map();
  const stream = { getTracks: () => [{ stop: () => { stopped++; } }] };
  const canvas = {
    getContext: () => ({
      fillRect() {}, drawImage() { drawCount++; },
      getImageData: () => source,
    }),
  };
  const document = {
    hidden: false, createElement: () => canvas,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
  };
  const video = {
    videoWidth: source.width, videoHeight: source.height, readyState: 2,
    setAttribute() {}, play: async () => {}, pause: () => { paused++; },
  };
  globals(t, {
    document,
    navigator: { mediaDevices: { getUserMedia: (constraints) => getUserMedia(constraints, stream) } },
    requestAnimationFrame: (fn) => { const id = nextId++; pending.set(id, fn); return id; },
    cancelAnimationFrame: (id) => pending.delete(id),
  });
  return {
    video, document, listeners, pending,
    stats: () => ({ stopped, paused, drawCount }),
    frame: (time = 0) => { const [id, fn] = pending.entries().next().value; pending.delete(id); fn(time); },
  };
}

test("camera scanning decodes a real frame then stops tracks and animation", async (t) => {
  let received, requested;
  const camera = cameraFixture(t, async (constraints, stream) => { requested = constraints; return stream; });
  assert.equal(requested, undefined, "No camera request until startScanner is invoked.");
  const stop = await startScanner(camera.video, (value) => { received = value; }, (error) => assert.fail(error));
  assert.equal(requested.audio, false);
  assert.equal(requested.video.facingMode.ideal, "environment");
  assert.equal(camera.video.playsInline, true);
  camera.frame();
  assert.equal(received, link);
  assert.equal(camera.stats().stopped, 1);
  assert.equal(camera.stats().drawCount, 1);
  assert.equal(camera.video.srcObject, null);
  assert.equal(camera.pending.size, 0);
  assert.equal(camera.listeners.size, 0);
  stop();
  assert.equal(camera.stats().stopped, 1, "Repeated cleanup does not retain or stop an old stream again.");
});

test("closing a scanner during a permission prompt stops the subsequently granted camera", async (t) => {
  let grant, fixtureStream, results = 0;
  const camera = cameraFixture(t, (constraints, stream) => { fixtureStream = stream; return new Promise((resolve) => { grant = resolve; }); });
  const abort = new AbortController();
  const started = startScanner(camera.video, () => { results++; }, () => { results++; }, { signal: abort.signal });
  abort.abort();
  grant(fixtureStream);
  const stop = await started;
  assert.equal(results, 0);
  assert.equal(camera.stats().stopped, 1);
  assert.equal(camera.pending.size, 0);
  assert.equal(camera.listeners.size, 0);
  assert.equal(camera.video.srcObject, null);
  stop();
});

test("camera permission denial offers a fallback and leaves no scanner running", async (t) => {
  const camera = cameraFixture(t, async () => { throw Object.assign(new Error("Denied"), { name: "NotAllowedError" }); });
  let message;
  const stop = await startScanner(camera.video, () => assert.fail("No result after denial."), (error) => { message = error.message; });
  assert.match(message, /denied/);
  assert.match(message, /upload a photo/);
  assert.equal(camera.pending.size, 0);
  assert.equal(camera.listeners.size, 0);
  stop();
});

test("hiding the page releases a running camera", async (t) => {
  const camera = cameraFixture(t, async (constraints, stream) => stream);
  await startScanner(camera.video, () => assert.fail("No scan requested."), (error) => assert.fail(error));
  camera.document.hidden = true;
  camera.listeners.get("visibilitychange")();
  assert.equal(camera.stats().stopped, 1);
  assert.equal(camera.pending.size, 0);
  assert.equal(camera.video.srcObject, null);
});

test("camera permission deadline provides manual fallback and stops a late grant", async (t) => {
  let grant, fixtureStream, message;
  const camera = cameraFixture(t, (_constraints, stream) => { fixtureStream = stream; return new Promise(resolve => { grant = resolve; }); });
  const stop = await startScanner(camera.video, () => assert.fail("No result after timeout"), error => { message = error.message; }, { permissionTimeoutMs: 10 });
  assert.match(message, /printed code|photo/);
  assert.equal(camera.pending.size, 0);
  grant(fixtureStream); await new Promise(resolve => setImmediate(resolve));
  assert.equal(camera.stats().stopped, 1);
  assert.equal(camera.video.srcObject, null);
  assert.equal(camera.listeners.size, 0);
  stop();
});

test("a stalled camera playback releases tracks after its deadline", async (t) => {
  const camera = cameraFixture(t, async (_constraints, stream) => stream);
  camera.video.play = () => new Promise(() => {});
  let message;
  await startScanner(camera.video, () => assert.fail("No result"), error => { message = error.message; }, { permissionTimeoutMs: 10 });
  assert.match(message, /could not start in time/);
  assert.equal(camera.stats().stopped, 1);
  assert.equal(camera.video.srcObject, null);
  assert.equal(camera.listeners.size, 0);
});

test("an unproductive scan stops automatically without retaining a camera", async (t) => {
  const camera = cameraFixture(t, async (_constraints, stream) => stream);
  let message;
  await startScanner(camera.video, () => assert.fail("No frame requested"), error => { message = error.message; }, { scanTimeoutMs: 10 });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.match(message, /camera has stopped/);
  assert.match(message, /printed code/);
  assert.equal(camera.stats().stopped, 1);
  assert.equal(camera.pending.size, 0);
  assert.equal(camera.listeners.size, 0);
});

test("a stalled image decode times out and revokes its local URL", async (t) => {
  let image, revoked = 0, removed = 0;
  class StalledImage { constructor() { image = this; } set src(_value) {} removeAttribute(name) { assert.equal(name, "src"); removed++; } }
  globals(t, { Image: StalledImage });
  t.mock.method(URL, "createObjectURL", () => "blob:stalled");
  t.mock.method(URL, "revokeObjectURL", () => { revoked++; });
  const file = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], { type: "image/png" });
  await assert.rejects(scanImage(file, { timeoutMs: 10 }), /time|printed code/);
  assert.equal(revoked, 1); assert.equal(removed, 1);
  assert.equal(image.onload, null); assert.equal(image.onerror, null);
});
