# Current PoC: direct C Login + Keycloak JWT Authorization Grant

This is option 2 selected on 9 November 2026. It supersedes the earlier browser OIDC-broker diagrams for A/B/C.

## Login

1. A/B checks Keycloak readiness as before, then redirects the browser directly to C `/sso/authorize` with an allowlisted client ID, state and PKCE challenge.
2. Without C authentication, C displays its own `/login`. The pending request is bound to the C session and transferred to the new session only after successful password Login and session regeneration.
3. C signs a 60-second RS256 assertion with its C signing key (issuer C, subject C user ID, audience Keycloak realm, unique jti).
4. C calls Keycloak POST `/protocol/openid-connect/token` with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`, assertion, target client ID and its confidential client secret.
5. Keycloak verifies the assertion, the allowed IdP/client relationship and the existing linked user; it issues a scoped central token.
6. C verifies that token and auto-submits a browser form POST to the fixed A/B `/sso/callback`, carrying the access token, state and a short-lived signed response binding the token hash, target app, state and challenge.
7. A/B verifies the signed response and central JWT locally (signature/issuer/audience/expiry), checks signed permissions and local membership, then creates its own app JWT/session. There is no redemption endpoint and no initial introspection request.

No access token or assertion is placed in a browser URL or browser storage. The access token is visible in the browser Network POST payload, as requested. Responses are browser-bound, single-use and signed; permissions come from the signed central JWT. User-supplied callback URLs are not accepted.

The sole token-issuance API is C -> Keycloak. Browser navigation and form POST, existing readiness checks and signing-key retrieval on cache miss are additional requests. Hourly introspection remains; Login introspection is removed. No browser visits Keycloak and no C authorization-code/token exchange is used for this Login.

## SSO session and logout

JWT Authorization Grant creates transient tokens, not a persistent Keycloak browser SSO cookie. The browser's SSO anchor is C's independent authenticated session. Opening another A/B app reuses that C session, obtains a client-specific Keycloak token through the API and establishes the app's own session.

These Keycloak tokens have jti and no sid. A/B bind their app token to the verified central jti when sid is absent. The central JWT is not modified to invent a sid.

C records issued tokens server-side so Logout C can revoke them individually via Keycloak `/revoke`. C then sends short-lived, audience-bound signed logout notifications to A/B. A/B verify C's signature and `token_use=control_logout`, remove only the matching user's SSO sessions, and notify open tabs using the existing logout event stream. Local A/B sessions and other users are preserved. Logout ใช้ token revocation และ signed C notifications เท่านั้น ไม่มี Admin user logout แบบเก่าแล้ว.

A closed-session marker and per-user transaction lock prevent token issuance overlapping C Logout from escaping revocation. The issuer rechecks the C session after Keycloak returns; tokens from a closed/expired source are revoked without delivery. Signed Logout also persists a per-user issuance cutoff in A/B, so a form captured before C Logout cannot establish a new app session after Logout. Acceptance and Logout are serialized per user in each single-process PoC app.

C account disabling/deletion also revokes API-issued tokens. Failed central revocation does not falsely report successful Logout. Hourly heartbeat and expiry checks remain unchanged.

## Keycloak / compose changes

- IdP app-control: JWT Authorization Grant ON, assertion reuse OFF, max assertion expiration 60 seconds, RS256 assertion signature, no assertion-based shortening of the normal central-token lifespan.
- Clients app-a, app-b, app-control: JWT grant ON; allowed IdP only app-control; legacy standard authorization-code flow OFF. Password/implicit grants remain disabled.
- `idp` mapper for these clients is fixed to app-control, the sole allowed assertion IdP, because transient grants do not populate the old broker session note.
- app-control audience mapper restored: C now verifies its own central access token in this mode.
- C receives the existing A/B confidential-client secrets server-side for issuance and revocation. A/B receive fixed C public/internal URLs. No new user rights are automatically granted.
- No additional Keycloak feature flag or Java SPI is required in the installed 26.8.1 version.

Private pre-change backups: work/before-api-mode-_.zip and work/keycloak-before-api-mode-_.json.

## Verification

- `python3 scripts/test-api-mode.py`: direct C Login from A; B automatic SSO; zero Keycloak browser trips or OIDC authorization trips; revoked central tokens after C Logout; immediate A/B Logout; local Login preserved; direct C Login bootstrap through API.
- `python3 scripts/test-post-sso.py`: direct POST integrity, state/app/origin binding, replay rejection, no token URLs, delayed delivery after Logout rejected and fresh Login accepted. The older test-api-mode-security.py describes the superseded redemption flow.
- `python3 scripts/test-explicit-denial.py`: permission denial appears only after explicit Login and not on reload.
- `python3 scripts/test-hourly-sso.py`: temporary short token lifespan and accelerated browser clock; expiry detected by the hourly check; original token settings restored.

Official protocol reference: https://www.keycloak.org/securing-apps/jwt-authorization-grant

The direct-POST change does not modify Keycloak settings. Existing client and IdP settings above remain in effect.
