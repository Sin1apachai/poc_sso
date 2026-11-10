# Hourly heartbeat

SSO pages in A/B load `app/public/heartbeat.js`. Local Login pages do not.

- One heartbeat request every 3,600,000 ms to the app's own `/session/heartbeat`.
- No focus, pageshow or extra expiry timer; no automatic token refresh.
- Expired tokens produce HTTP 401 and return the browser to Login.
- Protected page requests also validate token expiry.
- A signed C Logout notification removes matching SSO sessions and notifies open tabs immediately through the event stream.
- Local sessions are independent of central token expiry.

`python3 scripts/test-hourly-sso.py` uses temporary short token lifetimes and an accelerated browser clock. It restores client settings and deletes its temporary users in cleanup. Run only after configuring the lab. Current token settings are reference-only in [API-MODE-SETTINGS.json](API-MODE-SETTINGS.json).
