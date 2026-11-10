const { test } = require("node:test");
const assert = require("node:assert/strict");
const { retryBootstrap } = require("../app-control/src/sso/sso-readiness");
test("three failed real bootstrap attempts, only two backoffs", async () => {
  const attempts = [],
    delays = [];
  const result = await retryBootstrap({
    attempt: async () => {
      throw Error("offline");
    },
    onAttempt: async (n) => attempts.push(n),
    sleep: async (ms) => delays.push(ms),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(attempts, [1, 2, 3]);
  assert.deepEqual(delays, [2000, 5000]);
});
test("successful token bootstrap stops retrying and returns verified result", async () => {
  let n = 0;
  const token = { payload: { jti: "verified-result" } };
  const result = await retryBootstrap({
    attempt: async () => {
      if (++n === 1) throw Error("offline");
      return token;
    },
    sleep: async () => {},
  });
  assert.equal(n, 2);
  assert.equal(result.value, token);
  assert.equal(result.ok, true);
});
test("client/proof configuration rejection stops immediately", async () => {
  let n = 0;
  const result = await retryBootstrap({
    attempt: async () => {
      n++;
      throw Object.assign(Error("invalid proof"), { retryable: false, reason: "configuration" });
    },
  });
  assert.equal(n, 1);
  assert.equal(result.reason, "configuration");
});
test("invalid JSON token response cannot become successful", async () => {
  let n = 0;
  const result = await retryBootstrap({
    attempt: async () => {
      n++;
      throw SyntaxError("invalid response");
    },
  });
  assert.equal(n, 1);
  assert.equal(result.ok, false);
});
