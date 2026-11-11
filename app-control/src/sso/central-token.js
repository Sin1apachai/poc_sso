const { pool } = require("../db/database");
const config = require("../config");
const { verifyAppToken } = require("../auth/app-token");
const { sign, permissions, centralSubject } = require("./control-proof");
let keys;
function failure(reason, retryable = false) {
  return Object.assign(new Error("Central bootstrap failed"), { reason, retryable });
}
async function request(sessionId, generation) {
  const { rows } = await pool.query(
    `SELECT s.sess->'local' AS local,u.* FROM session s
    JOIN users u ON u.id=(s.sess->'local'->>'userId')::bigint
    WHERE s.sid=$1 AND s.expire>now() AND u.enabled=true
    AND NOT EXISTS(SELECT 1 FROM api_sso_closed_sessions WHERE session_id=s.sid)`,
    [sessionId],
  );
  const user = rows[0];
  if (!user?.local || user.local.expiresAt <= Date.now()) throw failure("session-ended");
  try {
    await verifyAppToken(user.local.appToken, { userId: user.id, mode: "local" });
  } catch {
    throw failure("session-ended");
  }
  const assertion = await sign(
    {
      token_use: "sso_bootstrap",
      target_client: config.kcAuthorityClient,
      c_session: sessionId,
      email: user.email,
      app_permissions: permissions(user),
      bootstrap_generation: generation,
      source_issued_ms: Date.now(),
    },
    config.kcIssuer,
    user.id,
  );
  let response;
  try {
    response = await fetch(config.kcInternalUrl + "/temporary-sso-poc/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        assertion,
        client_id: config.kcAuthorityClient,
        client_secret: process.env.KC_CLIENT_SECRET,
      }),
      signal: AbortSignal.timeout(3000),
      redirect: "error",
    });
  } catch {
    throw failure("unavailable", true);
  }
  if (!response.ok)
    throw failure(
      response.status >= 500 || response.status === 429 ? "unavailable" : "configuration",
      response.status >= 500 || response.status === 429,
    );
  const tokens = await response.json();
  try {
    const jose = await import("jose");
    keys ||= jose.createRemoteJWKSet(
      new URL(config.kcInternalUrl + "/protocol/openid-connect/certs"),
      { timeoutDuration: 3000 },
    );
    const { payload } = await jose.jwtVerify(tokens.access_token, keys, {
      issuer: config.kcIssuer,
      audience: config.kcAudience,
      algorithms: ["RS256"],
      requiredClaims: ["sub", "exp", "iat", "jti", "email", "bootstrap_generation"],
    });
    if (
      payload.bootstrap_generation !== generation ||
      payload.sub !== centralSubject(user.id) ||
      payload.email !== user.email ||
      payload.idp !== config.kcIdpAlias ||
      payload.azp !== config.kcAuthorityClient ||
      payload.central_shared !== true ||
      payload.temporary_identity !== true
    )
      throw failure("configuration");
    return { accessToken: tokens.access_token, payload, userId: user.id };
  } catch (error) {
    if (error.code === "ERR_JWKS_TIMEOUT" || error instanceof TypeError)
      throw failure("unavailable", true);
    throw failure("configuration");
  }
}
async function revoke(token) {
  const response = await fetch(config.kcInternalUrl + "/temporary-sso-poc/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token,
      client_id: config.kcAuthorityClient,
      client_secret: process.env.KC_CLIENT_SECRET,
    }),
    signal: AbortSignal.timeout(3000),
    redirect: "error",
  });
  if (!response.ok) throw failure("unavailable", true);
}
async function receiveGlobalLogout(req, res) {
  try {
    const jose = await import("jose");
    keys ||= jose.createRemoteJWKSet(
      new URL(config.kcInternalUrl + "/protocol/openid-connect/certs"),
      { timeoutDuration: 3000 },
    );
    const { payload } = await jose.jwtVerify(req.body.logout_token, keys, {
      issuer: config.kcIssuer,
      audience: config.kcAuthorityClient,
      algorithms: ["RS256"],
      requiredClaims: ["sub", "iat", "exp", "jti", "token_use", "idp", "revoked_before"],
      maxTokenAge: "2m",
    });
    if (
      payload.token_use !== "idp_logout" ||
      payload.idp !== config.kcIdpAlias ||
      !Number.isSafeInteger(payload.revoked_before) ||
      payload.revoked_before > Date.now() + 1000
    )
      return res.sendStatus(400);
    await pool.query(
      `UPDATE central_sso_status SET status='failed',reason='logout',access_token=NULL,token_jti=NULL,updated_at=now()
      WHERE access_token IS NOT NULL AND updated_at<=to_timestamp($1::double precision/1000)`,
      [payload.revoked_before],
    );
    return res.sendStatus(200);
  } catch {
    return res.sendStatus(400);
  }
}
module.exports = { request, revoke, receiveGlobalLogout };
