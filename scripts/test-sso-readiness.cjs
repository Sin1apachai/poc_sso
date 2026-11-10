const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkReadiness } = require("../app-control/src/sso/sso-readiness");
const base = { url: "http://example.test/discovery", issuer: "http://expected.test" };
test("three failed connection checks; only two backoff intervals", async () => {
  const attempts = [],
    delays = [];
  let calls = 0;
  const r = await checkReadiness({
    ...base,
    onAttempt: async (n) => attempts.push(n),
    sleep: async (n) => delays.push(n),
    fetcher: async () => {
      calls++;
      throw Error("offline");
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(attempts, [1, 2, 3]);
  assert.deepEqual(delays, [2000, 5000]);
  assert.deepEqual(r, { ok: false, attempts: 3, reason: "unavailable" });
});
test("temporary error then success stops retries", async () => {
  let calls = 0;
  const r = await checkReadiness({
    ...base,
    sleep: async () => {},
    fetcher: async () =>
      ++calls === 1
        ? { ok: false, status: 503 }
        : { ok: true, json: async () => ({ issuer: base.issuer }) },
  });
  assert.equal(calls, 2);
  assert.equal(r.ok, true);
});
test("permission/configuration error is not retried", async () => {
  let calls = 0;
  const r = await checkReadiness({
    ...base,
    fetcher: async () => {
      calls++;
      return { ok: false, status: 403 };
    },
  });
  assert.equal(calls, 1);
  assert.equal(r.reason, "configuration");
});
test("wrong issuer cannot become ready", async () => {
  const r = await checkReadiness({
    ...base,
    fetcher: async () => ({ ok: true, json: async () => ({ issuer: "http://wrong.test" }) }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 1);
});
