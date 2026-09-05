import test from "node:test";
import assert from "node:assert/strict";
import { parsePropInput } from "../public/prop-code.js";

const origin = "https://oracle.greenshoegarage.com";
const eventId = "9e5d4d3c-20a4-447e-8e23-58eeaee8d70d";
const otherId = "2183c9e2-9948-4d37-9a24-e940d811c67f";
const code = "ABCD2345EFGH6789JKLM";
const url = `${origin}/#prop/${eventId}/${code}`;

test("prop input separates event prop identities from character badge identities", () => {
  assert.deepEqual(parsePropInput(url, origin), { eventId, code });
  assert.deepEqual(parsePropInput(url.toUpperCase(), origin), { eventId, code });
  assert.deepEqual(parsePropInput(url, origin, otherId), { eventId, code });
  assert.deepEqual(parsePropInput(code, origin), { eventId: null, code });
  assert.deepEqual(parsePropInput(" abcd-2345-efgh-6789-jklm ", origin, eventId), { eventId, code });
  assert.deepEqual(parsePropInput(`http://localhost:3000/#prop/${eventId}/${code}`, "http://localhost:3000"), { eventId, code });
  assert.throws(() => parsePropInput(`${origin}/#badge/${code}`, origin));
});

test("prop input rejects foreign origins, executable payloads, malformed identifiers and hidden controls", () => {
  for (const value of [
    null, {}, 42, "", "x".repeat(1025), code.replace("A", "0"), code + "A", code.slice(1),
    `${origin}.evil.test/#prop/${eventId}/${code}`, `https://evil.test/#prop/${eventId}/${code}`,
    `https://evil.test@oracle.greenshoegarage.com/#prop/${eventId}/${code}`,
    `http://oracle.greenshoegarage.com/#prop/${eventId}/${code}`, `${origin}:444/#prop/${eventId}/${code}`,
    `${origin}/somewhere#prop/${eventId}/${code}`, `${origin}/?redirect=evil#prop/${eventId}/${code}`,
    `${origin}/#prop/${eventId}/${code}/extra`, `${origin}/#prop/not-an-event/${code}`,
    `${origin}/#prop/9e5d4d3c-20a4-447e-0e23-58eeaee8d70d/${code}`,
    `${origin}/#prop/${eventId}/%41${code.slice(1)}`, `${origin}/\n#prop/${eventId}/${code}`,
    `/#prop/${eventId}/${code}`, `#prop/${eventId}/${code}`, `javascript:alert('${code}')`,
    `<img src=x onerror=alert(1)>`, `data:text/plain,${code}`, code + "\u0000",
  ]) assert.throws(() => parsePropInput(value, origin), Error, String(value));
  assert.throws(() => parsePropInput(code, origin, "invalid-event"));
});
