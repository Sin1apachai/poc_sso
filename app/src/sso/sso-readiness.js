// Probe connectivity only. No OIDC state, token exchange or proof is created here.
async function checkReadiness({
  url,
  issuer,
  fetcher = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  onAttempt = async () => {},
  maxAttempts = 3,
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await onAttempt(attempt);
    let retryable = true;
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(3000), redirect: "error" });
      if (response.ok) {
        const metadata = await response.json();
        return metadata.issuer === issuer
          ? { ok: true, attempts: attempt }
          : { ok: false, attempts: attempt, reason: "configuration" };
      }
      retryable = response.status >= 500 || response.status === 429;
    } catch (error) {
      if (error instanceof SyntaxError) {
        return { ok: false, attempts: attempt, reason: "configuration" };
      }
    }
    if (!retryable) {
      return { ok: false, attempts: attempt, reason: "configuration" };
    }
    if (attempt < maxAttempts) {
      await sleep(attempt === 1 ? 2000 : 5000);
    }
  }
  return { ok: false, attempts: maxAttempts, reason: "unavailable" };
}
module.exports = { checkReadiness };
