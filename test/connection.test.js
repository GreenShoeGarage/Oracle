import test from "node:test";
import assert from "node:assert/strict";
import { requestJSON } from "../public/connection.js";

test("bounded transport binds the captured account and does not cache or retry a write", async () => {
  let calls = 0;
  const result = await requestJSON("/api/events/example/exchanges", "POST", { requestId: "stable" }, {
    expectedAccount: "captured-account", fetch: async (url, init) => {
      calls++; assert.equal(init.headers["X-ORACLE-Expected-Account"], "captured-account");
      assert.equal(init.cache, "no-store"); assert.equal(init.credentials, "same-origin");
      assert.equal(JSON.parse(init.body).requestId, "stable");
      return new Response(JSON.stringify({ saved: true }), { headers: { "Content-Type": "application/json" } });
    },
  });
  assert.equal(result.result.saved, true); assert.equal(calls, 1);
});

test("lost or unreadable write responses are uncertain and never automatically repeated", async () => {
  for (const response of [() => { throw new TypeError("failed"); }, () => new Response("Bad gateway", { status: 502 })]) {
    let calls = 0;
    await assert.rejects(requestJSON("/api/example", "POST", {}, { fetch: async () => { calls++; return response(); } }), (error) => error.uncertain === true && error.transmitted === true);
    assert.equal(calls, 1);
  }
});

test("hanging request aborts within the transport deadline", async () => {
  let aborted = false;
  await assert.rejects(requestJSON("/api/session", "GET", undefined, { timeoutMs: 5, fetch: async (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener("abort", () => { aborted = true; reject(new DOMException("Aborted", "AbortError")); })) }), (error) => error.status === 0 && error.uncertain === false);
  assert.equal(aborted, true);
});
