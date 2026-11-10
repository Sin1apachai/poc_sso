// Retry actual token bootstrap. Each attempt creates a fresh signed proof in the caller.
async function retryBootstrap({
  attempt,
  onAttempt = async () => {},
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  for (let n = 1; n <= 3; n++) {
    await onAttempt(n);
    try {
      return { ok: true, attempts: n, value: await attempt() };
    } catch (error) {
      if (error.retryable === false || error instanceof SyntaxError)
        return { ok: false, attempts: n, reason: error.reason || "configuration" };
      if (n === 3) return { ok: false, attempts: n, reason: "unavailable" };
      await sleep(n === 1 ? 2000 : 5000);
    }
  }
}
module.exports = { retryBootstrap };
