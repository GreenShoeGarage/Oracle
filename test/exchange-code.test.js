import test from "node:test";
import assert from "node:assert/strict";
import { parseExchangeInput } from "../public/exchange-code.js";
import { badgeQrPixels } from "../public/qr.js";
import jsQR from "../public/vendor/jsqr-1.4.0.js";

const origin = "https://oracle.greenshoegarage.com";
const eventId = "9e5d4d3c-20a4-447e-8e23-58eeaee8d70d";
const otherId = "2183c9e2-9948-4d37-9a24-e940d811c67f";
const code = "ABCD2345EFGH";
const link = `${origin}/#exchange/${eventId}/${code}`;

test("exchange entry accepts 12-character manual codes and exact same-origin exchange links", () => {
  assert.deepEqual(parseExchangeInput(link, origin), { eventId, code });
  assert.deepEqual(parseExchangeInput(link.toUpperCase(), origin), { eventId, code });
  assert.deepEqual(parseExchangeInput(link, origin, otherId), { eventId, code });
  assert.deepEqual(parseExchangeInput(code, origin), { eventId: null, code });
  for (const formatted of [" abcd-2345-efgh ", "ABCD 2345 EFGH", "abcd2345efgh"])
    assert.deepEqual(parseExchangeInput(formatted, origin, eventId), { eventId, code });
  assert.deepEqual(parseExchangeInput(`http://localhost:3000/#exchange/${eventId}/${code}`, "http://localhost:3000"), { eventId, code });
});

test("badge and prop identities cannot be mistaken for exchange invitations", () => {
  const badge = code + "6789JKLM";
  for (const input of [badge, "ABCD-2345-EFGH-6789-JKLM", `${origin}/#badge/${badge}`, `${origin}/#prop/${eventId}/${badge}`, `${origin}/#exchange/${eventId}/${badge}`])
    assert.throws(() => parseExchangeInput(input, origin), Error, input);
});

test("exchange parser rejects foreign origins, executable content, extra URL data and malformed identifiers", () => {
  for (const input of [
    "", null, {}, 12, "x".repeat(1025), code.slice(1), code + "A", "ABCD2345EFG0", "ABCD2345EFGI", "ABCD2345EFGO", "ABCD2345EFG1",
    `https://evil.test/#exchange/${eventId}/${code}`, `${origin}.evil.test/#exchange/${eventId}/${code}`,
    `https://oracle.greenshoegarage.com@evil.test/#exchange/${eventId}/${code}`,
    `https://evil.test@oracle.greenshoegarage.com/#exchange/${eventId}/${code}`,
    `http://oracle.greenshoegarage.com/#exchange/${eventId}/${code}`, `${origin}:444/#exchange/${eventId}/${code}`,
    `${origin}/somewhere#exchange/${eventId}/${code}`, `${origin}/somewhere/../#exchange/${eventId}/${code}`,
    `${origin}/?#exchange/${eventId}/${code}`, `${origin}/?redirect=evil#exchange/${eventId}/${code}`,
    `${origin}/#exchange/${eventId}/${code}/more`, `${origin}/#exchange/${eventId}/${code}?accept=true`,
    `${origin}/#exchange/${eventId}/%41${code.slice(1)}`, `${origin}/#exchange/invalid-event/${code}`,
    `${origin}/#exchange/9e5d4d3c-20a4-447e-0e23-58eeaee8d70d/${code}`,
    `${origin}/\n#exchange/${eventId}/${code}`, `${origin}/\\#exchange/${eventId}/${code}`,
    `/#exchange/${eventId}/${code}`, `#exchange/${eventId}/${code}`, `javascript:alert('${code}')`, `data:text/plain,${code}`,
    `<img src=x onerror=alert(1)>`, `${code}\u0000`, `ABCD\n2345EFGH`,
  ]) assert.throws(() => parseExchangeInput(input, origin), Error, String(input));
  let coerced = false;
  assert.throws(() => parseExchangeInput(code, origin, { toString() { coerced = true; return eventId; } }));
  assert.equal(coerced, false);
});

test("a complete exchange link round-trips through rendered QR pixels and the scanner decoder", () => {
  for (const host of [origin, "https://oracle-production-488d.up.railway.app"]) {
    const payload = `${host}/#exchange/${eventId}/${code}`;
    const image = badgeQrPixels(payload, 256);
    const decoded = jsQR(image.data, image.width, image.height)?.data;
    assert.equal(decoded, payload);
    assert.deepEqual(parseExchangeInput(decoded, host), { eventId, code });
  }
});
