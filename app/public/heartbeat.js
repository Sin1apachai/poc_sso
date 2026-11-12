(() => {
  // The server supplies the same configured interval used for backend token checks.
  const intervalMs = Number(document.currentScript.dataset.intervalMs);
  if (!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 2147483647) return;
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
        // Allow the backend 5-second Keycloak timeout plus session cleanup.
        signal: AbortSignal.timeout(10000),
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
      // Keycloak failures return 401 after session cleanup; this catch is for app connectivity.
    } finally {
      inFlight = false;
    }
  }
  setInterval(check, intervalMs);
})();
