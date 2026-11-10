# C SSO readiness and retry - 6 November 2026

C password Login creates its independent local session, then displays the dashboard while checking Keycloak readiness. This does not create OIDC requests during connection retries.

## States

- checking: up to 3 connection checks, 3-second timeout each; 2 then 5 seconds backoff.
- ready: connectivity verified; the dashboard submits one CSRF-protected OIDC continuation.
- redirecting: one OIDC authorization is in progress. This is not success.
- success: callback validated state, nonce, PKCE, signed token, IdP and matching C email.
- failed: connection checks exhausted, configuration error, OIDC failure or stalled attempt.
- idle: no SSO attempt for this C session yet; use Retry to start.

Only transient connection errors, timeout, 429 and 5xx are retried. Invalid issuer, malformed discovery data and other 4xx stop immediately. Each manual Retry may start one new cycle; duplicate requests during an active cycle do not spawn another job.

State is held in the C database, keyed by C session and a generation ID, so polling and multiple tabs do not overwrite local authentication or each other's attempt. Pending attempts expire after two minutes without progress. Success is bounded by verified token/C session expiry. This status records the last verified bootstrap; A/B still validate their own tokens and permissions independently.

## A/B links on C

Links route through GET /connect/app-a or /connect/app-b. The server checks C authorization and SSO success before redirecting to the fixed app destination. Pending and failed states display a modal on C. A failed bootstrap does not destroy the C local session.

POST /sso/retry and POST /sso/continue require C local authentication and CSRF. GET /sso/status exposes status, attempt counts and the current CSRF form token to the authenticated same-origin page; it never exposes OIDC state, proofs or authentication tokens. A stale form token triggers a dashboard reload before automatic continuation. CSRF is initialized and saved when the C local session is created, before concurrent dashboard/status requests. Invalid SSO form submissions are rejected with a 303 redirect to the dashboard rather than a plain error page; other protected forms still return 403.

## Boundary

Preflight cannot guarantee Keycloak remains available after the browser leaves C. If the browser lands on a network error during OIDC, it must return to C; the server eventually marks the interrupted attempt failed. C cannot display a popup on another origin's browser error page. No token exchange is blindly replayed.

## Verification

- node --test scripts/test-sso-readiness.cjs
- python3 scripts/test-auto-sso.py
- python3 scripts/test-sso-retry.py

The final test temporarily pauses Keycloak and always unpauses it in finally. It uses temporary accounts, verifies no OIDC requests during retry, three attempts only, pending/error link gating, and recovery through Retry followed by a validated callback and A SSO.

No Keycloak settings were changed. A/B local Login, token lifetime and logout policy were not changed.

CSRF race regression: `python3 scripts/test-sso-csrf.py` verifies 12 concurrent dashboard reads, rejection of stale SSO forms without advancing state, and one successful OIDC continuation after refreshing a stale dashboard.
