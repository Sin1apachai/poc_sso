const { storePendingRequest, takePendingRequest, getPendingRequest } = require("./sso-pending");
const config = require("../config");
const crypto = require("node:crypto");
const { withUserLock } = require("./sso-user-lock");
const { csrfToken } = require("../auth/csrf");
const { probe, probeStatus } = require("./sso-connectivity");
const { issueAppToken, verifyAppToken } = require("../auth/app-token");
const { pool } = require("../db/database");
const logoutEvents = require("./logout-events");
const { saveSession, regenerateSession } = require("../auth/auth");
let clientPromise;

async function keycloakClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const jose = await import("jose");
      const keys = jose.createRemoteJWKSet(
        new URL(config.kcInternalUrl + "/protocol/openid-connect/certs"),
      );
      return { jose, keys };
    })().catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  }
  return clientPromise;
}
let controlKeys;
async function controlVerifier() {
  const jose = await import("jose");
  controlKeys ||= jose.createRemoteJWKSet(new URL(config.controlInternalUrl + "/oidc/jwks"));
  return { jose, keys: controlKeys };
}
const tokenHash = (value) => crypto.createHash("sha256").update(value).digest("base64url");

async function connectionFailed(req, res, { silent = false, json = false, attempts } = {}) {
  if (json) {
    return res.status(503).json({ available: false, reason: "sso-unavailable", attempts });
  }
  // Reload before saving: another tab may have updated the session during the probe.
  const loaded = await new Promise((resolve) => req.session.reload((error) => resolve(!error)));
  if (!loaded) {
    return res.redirect("/login");
  }
  req.session.ssoChecked = true;
  req.session.ssoUnavailable = true;
  if (!silent) {
    req.session.connectionError = true;
  }
  await saveSession(req);
  return res.redirect("/login");
}

async function startSso(req, res, { silent = false, json = false } = {}) {
  req.session.ssoChecked = true;
  csrfToken(req);
  await saveSession(req);
  const result = await probe(req.browserId, { silent });
  if (!result.ok) {
    return connectionFailed(req, res, { silent, json, attempts: result.attempts });
  }
  try {
    const authorizationUrl = await authorization(req, { silent });
    if (json) {
      return res.json({ available: true, authorizationUrl });
    }
    return res.redirect(authorizationUrl);
  } catch {
    return connectionFailed(req, res, { silent, json });
  }
}

async function authorization(req, { silent }) {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const state = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  await storePendingRequest(req.browserId, {
    verifier,
    state,
    silent,
    flow: "post",
  });
  const url = new URL(config.controlPublicUrl + "/sso/authorize");
  url.search = new URLSearchParams({
    client_id: config.kcClientId,
    state,
    challenge,
    mode: silent ? "silent" : "interactive",
  });
  return url.href;
}

async function validateAccessToken(token) {
  const { jose, keys } = await keycloakClient();
  const { payload } = await jose.jwtVerify(token, keys, {
    issuer: config.kcIssuer,
    audience: config.kcAudience,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "jti", "exp", "iat", "email"],
  });
  if (
    payload.idp !== config.kcIdpAlias ||
    payload.azp !== config.kcAuthorityClient ||
    payload.central_shared !== true ||
    payload.temporary_identity !== true
  ) {
    throw new Error("Only App C identities are accepted");
  }
  return payload;
}

async function acceptSso(req, res) {
  if (req.method === "POST") {
    return acceptPostedToken(req, res);
  }
  if (!req.query.error) {
    return res.status(400).send("SSO response requires POST");
  }
  const pending = await takePendingRequest(req.browserId, req.query.state);
  if (!pending) {
    return res.redirect("/login");
  }
  if (req.query.iss !== config.controlPublicUrl || req.query.state !== pending.state) {
    return res.status(400).send("Invalid SSO response");
  }
  if (req.query.error === "temporarily_unavailable") {
    return connectionFailed(req, res, { silent: pending.silent });
  }
  if (pending.silent) {
    req.session.ssoChecked = true;
    await saveSession(req);
    return res.redirect("/login");
  }
  if (["access_denied", "login_required"].includes(req.query.error)) {
    return denyAccess(req, res, true, { showModal: true });
  }
  req.session.loginNotice = "login-failed";
  await saveSession(req);
  res.redirect("/login");
}

// Keycloak signs the token and binds it to the initiating browser request.
async function acceptPostedToken(req, res) {
  if (req.headers.origin && req.headers.origin !== new URL(config.kcIssuer).origin) {
    return res.status(400).send("Invalid SSO origin");
  }
  const body = req.body;
  if (
    typeof body.state !== "string" ||
    typeof body.access_token !== "string" ||
    typeof body.handoff !== "string"
  )
    return res.status(400).send("Invalid SSO response");
  const pending = await getPendingRequest(req.browserId, body.state);
  if (!pending || pending.flow !== "post")
    return res.status(400).send("Invalid or used SSO request");
  let claims, delivery;
  try {
    claims = await validateAccessToken(body.access_token);
    const { jose, keys } = await keycloakClient();
    ({ payload: delivery } = await jose.jwtVerify(body.handoff, keys, {
      issuer: config.kcIssuer,
      audience: config.kcClientId,
      algorithms: ["RS256"],
      requiredClaims: ["sub", "jti", "iat", "exp", "token_use", "central_jti", "token_hash"],
      maxTokenAge: "60s",
    }));
    if (
      delivery.token_use !== "sso_handoff" ||
      delivery.sub !== claims.sub ||
      delivery.central_jti !== claims.jti ||
      delivery.token_hash !== tokenHash(body.access_token) ||
      delivery.exp > claims.exp ||
      delivery.sso_state !== pending.state ||
      delivery.sso_challenge !== tokenHash(pending.verifier) ||
      !Number.isSafeInteger(delivery.source_issued_ms) ||
      delivery.source_issued_ms > Date.now() + 1000 ||
      delivery.source_issued_ms < Date.now() - 61000
    )
      throw Error("Unbound response");
  } catch {
    return res.status(400).send("Invalid or expired SSO response");
  }
  const consumed = await takePendingRequest(req.browserId, body.state);
  if (!consumed) {
    return res.status(400).send("SSO response already used");
  }
  if (!claims.app_permissions?.[config.systemId]?.includes("read")) {
    return denyAccess(req, res, true, { showModal: !pending.silent });
  }
  const { rows: members } = await pool.query("SELECT id FROM users WHERE email=$1", [
    claims.email.trim().toLowerCase(),
  ]);
  if (!members[0]) {
    return denyAccess(req, res, "missing-user", { showModal: !pending.silent });
  }
  return withUserLock("idp:" + claims.idp, () =>
    withUserLock(claims.sub, async () => {
      const { rows } = await pool.query(
        `SELECT revoked_before FROM sso_logout_fences WHERE kc_sub=$1
       UNION ALL SELECT revoked_before FROM sso_idp_logout_fences WHERE idp=$2
       ORDER BY revoked_before DESC LIMIT 1`,
        [claims.sub, claims.idp],
      );
      if (rows[0] && delivery.source_issued_ms <= Number(rows[0].revoked_before)) {
        return rejectSession(req, res, "session-revoked");
      }
      await regenerateSession(req);
      const acceptedAt = Date.now();
      req.session.sso = {
        userId: String(members[0].id),
        appToken: await issueAppToken({
          userId: members[0].id,
          mode: "sso",
          expiresAt: claims.exp * 1000,
          centralSub: claims.sub,
          centralSid: claims.sid || claims.jti,
          permissions: claims.app_permissions[config.systemId],
        }),
        accessToken: body.access_token,
        sub: claims.sub,
        idp: claims.idp,
        expiresAt: claims.exp,
        sourceIssuedMs: delivery.source_issued_ms,
        checkedAt: acceptedAt,
      };
      await saveSession(req);
      res.render("sso-complete", { controlOrigin: config.controlPublicUrl });
    }),
  );
}

async function rejectSession(req, res, reason, { showModal = false } = {}) {
  // Destroy the authenticated app session; keep only a fresh anonymous notice.
  await regenerateSession(req);
  req.session.ssoChecked = true;
  if (["forbidden", "missing-user"].includes(reason)) {
    if (showModal) {
      req.session.accessDenied = { explicit: true, reason };
    }
  } else if (reason === "verification-unavailable") {
    req.session.connectionError = true;
    req.session.ssoUnavailable = true;
  } else {
    req.session.loginNotice = "session-expired";
  }
  await saveSession(req);
  if (req.path === "/session/heartbeat") {
    return res.status(401).json({ authenticated: false, reason, loginUrl: "/login" });
  }
  return res.redirect("/login");
}

async function denyAccess(req, res, reason = true, options = {}) {
  return rejectSession(req, res, reason === "missing-user" ? reason : "forbidden", options);
}

async function requireSso(req, res, next) {
  if (!req.session.sso) {
    if (req.path === "/session/heartbeat") {
      return res
        .status(401)
        .json({ authenticated: false, reason: "login-required", loginUrl: "/login" });
    }
    return res.redirect("/login");
  }
  try {
    if (req.session.sso.expiresAt * 1000 <= Date.now()) {
      return await rejectSession(req, res, "session-expired");
    }
    req.centralUser = await validateAccessToken(req.session.sso.accessToken);
    await verifyAppToken(req.session.sso.appToken, {
      userId: req.session.sso.userId,
      mode: "sso",
      centralSub: req.centralUser.sub,
      centralSid: req.centralUser.sid || req.centralUser.jti,
    });
    // Check the shared central token; application sessions remain independent.
    if (
      req.path === "/session/heartbeat" ||
      !req.session.sso.checkedAt ||
      Date.now() - req.session.sso.checkedAt >= config.heartbeatIntervalMs
    ) {
      let response;
      try {
        response = await fetch(config.kcInternalUrl + "/temporary-sso-poc/introspect", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: req.session.sso.accessToken,
            client_id: config.kcClientId,
            client_secret: process.env.KC_CLIENT_SECRET,
          }),
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
          throw new Error("Keycloak unavailable");
        }
      } catch {
        // Verification failure ends this application SSO session immediately.
        return await rejectSession(req, res, "verification-unavailable");
      }
      const status = await response.json();
      if (!status.active) {
        return await rejectSession(req, res, "session-revoked");
      }
      req.session.sso.checkedAt = Date.now();
      await saveSession(req);
    }
    if (!req.centralUser.app_permissions?.[config.systemId]?.includes("read")) {
      return await denyAccess(req, res);
    }
    const email = req.centralUser.email;
    const { rows } = await pool.query("SELECT id,email FROM users WHERE id=$1 AND email=$2", [
      req.session.sso.userId,
      typeof email === "string" ? email.trim().toLowerCase() : null,
    ]);
    if (!rows[0]) {
      return await denyAccess(req, res, "missing-user");
    }
    req.localUser = rows[0];
    next();
  } catch (error) {
    return rejectSession(req, res, "session-invalid");
  }
}

function heartbeat(req, res) {
  res.json({
    authenticated: true,
    expiresAt: req.centralUser.exp * 1000,
    remainingMs: Math.max(0, req.centralUser.exp * 1000 - Date.now()),
    intervalMs: config.heartbeatIntervalMs,
  });
}

async function controlLogout(req, res) {
  if (typeof req.body.logout_token !== "string") {
    return res.sendStatus(400);
  }
  try {
    const { jose } = await keycloakClient();
    const issuer = jose.decodeJwt(req.body.logout_token).iss;
    const fromKeycloak = issuer === config.kcIssuer;
    if (!fromKeycloak && issuer !== config.controlPublicUrl + "/oidc") return res.sendStatus(400);
    const { keys } = fromKeycloak ? await keycloakClient() : await controlVerifier();
    const { payload } = await jose.jwtVerify(req.body.logout_token, keys, {
      issuer: fromKeycloak ? config.kcIssuer : config.controlPublicUrl + "/oidc",
      audience: config.kcAudience,
      algorithms: ["RS256"],
      requiredClaims: ["sub", "iat", "exp", "jti", "token_use", "revoked_before"],
      maxTokenAge: "2m",
    });
    if (!Number.isSafeInteger(payload.revoked_before) || payload.revoked_before > Date.now() + 1000)
      return res.sendStatus(400);
    if (fromKeycloak) {
      if (payload.token_use !== "idp_logout" || payload.idp !== config.kcIdpAlias)
        return res.sendStatus(400);
      await withUserLock("idp:" + payload.idp, async () => {
        const { rows } = await pool.query(
          `WITH receipt AS (
          INSERT INTO logout_receipts(jti) VALUES($1) ON CONFLICT DO NOTHING RETURNING jti),
        fence AS (INSERT INTO sso_idp_logout_fences(idp,revoked_before)
          SELECT $2,$3::bigint WHERE EXISTS(SELECT 1 FROM receipt)
          ON CONFLICT(idp) DO UPDATE SET revoked_before=GREATEST(sso_idp_logout_fences.revoked_before,EXCLUDED.revoked_before)
          RETURNING idp)
        DELETE FROM session WHERE sess->'sso'->>'sub' IS NOT NULL
          AND COALESCE(sess->'sso'->>'idp',$2)=$2
          AND COALESCE((sess->'sso'->>'sourceIssuedMs')::bigint,0)<=$3
          AND EXISTS(SELECT 1 FROM fence) RETURNING sid`,
          [payload.jti, payload.idp, payload.revoked_before],
        );
        for (const row of rows) logoutEvents.notify(row.sid);
      });
      return res.sendStatus(200);
    }
    if (payload.token_use !== "control_logout" || payload.idp !== config.kcIdpAlias)
      return res.sendStatus(400);
    await withUserLock(payload.sub, async () => {
      const { rows } = await pool.query(
        `WITH receipt AS (
        INSERT INTO logout_receipts(jti) VALUES($1) ON CONFLICT DO NOTHING RETURNING jti),
      fence AS (INSERT INTO sso_logout_fences(kc_sub,revoked_before)
        SELECT $2,$3::bigint WHERE EXISTS(SELECT 1 FROM receipt)
        ON CONFLICT(kc_sub) DO UPDATE SET revoked_before=GREATEST(sso_logout_fences.revoked_before,EXCLUDED.revoked_before)
        RETURNING kc_sub)
      DELETE FROM session WHERE sess->'sso'->>'sub'=$2 AND EXISTS(SELECT 1 FROM fence) RETURNING sid`,
        [payload.jti, payload.sub, payload.revoked_before],
      );
      for (const row of rows) {
        logoutEvents.notify(row.sid);
      }
    });
    res.sendStatus(200);
  } catch {
    return res.sendStatus(400);
  }
}

async function logout(req, res, next) {
  // Ordinary logout belongs to this application only, including SSO logins.
  req.session.destroy((error) => {
    if (error) {
      return next(error);
    }
    res.clearCookie(config.cookieName, { httpOnly: true, sameSite: "lax", secure: false });
    res.redirect("/login/local");
  });
}
module.exports = {
  rejectSession,
  heartbeat,
  startSso,
  connectivityStatus: (req, res) => res.json(probeStatus(req.browserId)),
  acceptSso,
  requireSso,
  controlLogout,
  logout,
};
