const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkReadiness } = require("../app/src/sso/sso-readiness");
const base = { url: "http://invalid.test", issuer: "http://expected.test", sleep: async () => {} };
test("automatic probe checks once without retry", async () => {
  let n = 0;
  const result = await checkReadiness({
    ...base,
    maxAttempts: 1,
    fetcher: async () => {
      n++;
      throw Error("offline");
    },
  });
  assert.equal(n, 1);
  assert.equal(result.attempts, 1);
  assert.equal(result.ok, false);
});
test("explicit probe uses exactly 3 checks and two backoff intervals", async () => {
  let n = 0;
  const delays = [];
  const result = await checkReadiness({
    ...base,
    sleep: async (ms) => delays.push(ms),
    fetcher: async () => {
      n++;
      throw Error("offline");
    },
  });
  assert.equal(n, 3);
  assert.equal(result.attempts, 3);
  assert.deepEqual(delays, [2000, 5000]);
});
test("successful second check stops retrying", async () => {
  let n = 0;
  const result = await checkReadiness({
    ...base,
    fetcher: async () =>
      ++n === 1
        ? { ok: false, status: 503 }
        : { ok: true, json: async () => ({ issuer: base.issuer }) },
  });
  assert.equal(n, 2);
  assert.equal(result.ok, true);
});
test("invalid issuer and 4xx fail without retry", async () => {
  for (const response of [
    { ok: true, json: async () => ({ issuer: "http://wrong.test" }) },
    { ok: false, status: 403 },
  ]) {
    let n = 0;
    const result = await checkReadiness({
      ...base,
      fetcher: async () => {
        n++;
        return response;
      },
    });
    assert.equal(n, 1);
    assert.equal(result.reason, "configuration");
  }
});
