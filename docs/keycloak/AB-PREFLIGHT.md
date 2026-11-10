# A/B SSO connectivity preflight - 6 November 2026

A/B check Keycloak discovery from their own backend before constructing an OIDC authorization request or redirecting the browser.

- Automatic entry: one bounded connection check. If unavailable, render Login with an SSO-unavailable status and no automatic modal.
- Explicit Login with C: the browser remains on Login while POST /sso/preflight checks up to three times (3-second timeout each, 2 then 5 seconds backoff). A status line shows progress and repeated clicks are ignored.
- If unavailable: return 503 JSON and display a one-time connectivity modal. It is distinct from a no-permission modal. Local Login remains enabled.
- If available: only then create state/PKCE/nonce and return the fixed Keycloak authorization URL for navigation. Token, role and local-membership checks remain unchanged.
- GET /sso also performs preflight, covering direct links from C, the other app, and clients without the AJAX handler. Failure returns to local Login with a one-time connectivity message instead of redirecting to Keycloak.

POST /sso/preflight requires the app's own CSRF token. GET /sso/connectivity exposes attempt counts for that app's signed browser identifier. Concurrent probes for the same browser/mode share one bounded readiness operation. The in-process probe state is not an authentication session or a token cache.

Readiness probes never generate tokens or OIDC requests. Connectivity does not imply authentication or permission. A race remains possible if Keycloak goes down after readiness succeeds and the browser leaves A/B; preflight does not control another origin's browser error page.

## Verification

- node --test scripts/test-ab-readiness.cjs
- python3 scripts/test-ab-preflight.py
- python3 scripts/test-explicit-denial.py
- python3 scripts/test-auto-sso.py

The outage test temporarily pauses Keycloak and always unpauses it in finally. It verifies no browser requests to Keycloak during failure, three explicit checks, suppressed duplicate clicks, local A/B Login during the outage, and successful recovery with independent C authentication.

No Keycloak settings, permissions, token lifetimes, or ordinary logout policy changed.
