// Probe connectivity only. No OIDC state, token exchange or proof is created here.
async function checkReadiness({
  url,
  issuer,
  fetcher = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  onAttempt = async () => {},
}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
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
    if (attempt < 3) {
      await sleep(attempt === 1 ? 2000 : 5000);
    }
  }
  return { ok: false, attempts: 3, reason: "unavailable" };
}
module.exports = { checkReadiness };
