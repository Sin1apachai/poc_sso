(() => {
  // PoC: check once per hour only. No focus checks or token-expiry timers.
  const intervalMs = 60 * 60 * 1000;
  let inFlight = false;
  // Event-only logout notification; it does not add heartbeat polling or an expiry timer.
  const logoutEvents = new EventSource("/session/logout-events");
  logoutEvents.addEventListener("logout", () => {
    logoutEvents.close();
    window.location.replace("/login/local");
  });
  async function check() {
    if (inFlight) {
      return;
    }
    inFlight = true;
    try {
      const response = await fetch("/session/heartbeat", {
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 401 || response.status === 403) {
        window.location.replace("/login");
        return;
      }
      if (!response.ok) {
        return;
      }
      const state = await response.json();
      if (!state.authenticated) {
        window.location.replace("/login");
      }
    } catch {
      // A connectivity failure does not prove expiry; wait for the next hourly check.
    } finally {
      inFlight = false;
    }
  }
  setInterval(check, intervalMs);
})();
