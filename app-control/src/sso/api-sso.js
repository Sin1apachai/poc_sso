const crypto = require("node:crypto");
const { sign, centralSubject } = require("./control-proof");
const ssoStatus = require("./sso-status");
const { pool } = require("../db/database");
const config = require("../config");
const { verifyAppToken } = require("../auth/app-token");
const { csrfToken } = require("../auth/csrf");
const { saveSession } = require("../auth/auth");
const targets = {
  "app-a": {
    callback: "http://localhost:4001/sso/callback",
    logout: "http://app-a:4001/logout/control",
    read: "allow_a",
  },
  "app-b": {
    callback: "http://localhost:4002/sso/callback",
    logout: "http://app-b:4001/logout/control",
    read: "allow_b",
  },
};
async function currentUser(req) {
  const local = req.session.local;
  if (!local || local.expiresAt <= Date.now()) return null;
  try {
    await verifyAppToken(local.appToken, { userId: local.userId, mode: "local" });
  } catch {
    return null;
  }
  const { rows } = await pool.query(
    `SELECT u.* FROM users u WHERE u.id=$1 AND u.enabled=true
    AND NOT EXISTS(SELECT 1 FROM api_sso_closed_sessions WHERE session_id=$2)`,
    [local.userId, req.sessionID],
  );
  return rows[0] || null;
}
function returnTo(res, request, extra) {
  const url = new URL(targets[request.client_id].callback);
  url.search = new URLSearchParams({ state: request.state, iss: config.publicUrl, ...extra });
  return res.redirect(url.href);
}
async function finish(req, res, request, user, options = {}) {
  if (!user[targets[request.client_id].read])
    return returnTo(res, request, { error: "access_denied" });
  const state = await ssoStatus.ensure(req, options);
  if (state.status !== "success" || !state.access_token)
    return returnTo(res, request, { error: "temporarily_unavailable" });
  const assertion = await sign(
    {
      token_use: "sso_login",
      c_session: req.sessionID,
      email: user.email,
      central_jti: state.token_jti,
      target_client: request.client_id,
      redirect_uri: targets[request.client_id].callback,
      sso_state: request.state,
      sso_challenge: request.challenge,
      source_issued_ms: Date.now(),
    },
    config.kcIssuer,
    user.id,
  );
  const fallback = new URL(targets[request.client_id].callback);
  fallback.search = new URLSearchParams({
    state: request.state,
    iss: config.publicUrl,
    error: "temporarily_unavailable",
  });
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  return res.render("sso-post", {
    assertion,
    action: config.kcIssuer + "/temporary-sso-poc/authorize",
    fallback: fallback.href,
  });
}
async function authorize(req, res) {
  const { client_id, state, challenge, mode } = req.query;
  if (
    !Object.hasOwn(targets, client_id) ||
    typeof state !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(state) ||
    typeof challenge !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(challenge)
  )
    return res.sendStatus(400);
  const request = { client_id, state, challenge };
  const user = await currentUser(req);
  if (user) return finish(req, res, request, user);
  if (mode === "silent") return returnTo(res, request, { error: "login_required" });
  csrfToken(req);
  await saveSession(req);
  const id = crypto.randomBytes(32).toString("base64url");
  await pool.query("DELETE FROM api_sso_login_requests WHERE expires_at<=now()");
  await pool.query(
    `INSERT INTO api_sso_login_requests(id,session_id,client_id,state,challenge,expires_at)
    VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')`,
    [id, req.sessionID, client_id, state, challenge],
  );
  return res.render("login", {
    error: null,
    csrf: csrfToken(req),
    apiLoginRequestId: id,
    loginNotice: null,
  });
}
async function loginRequest(req, id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
  return (
    (
      await pool.query(
        "SELECT * FROM api_sso_login_requests WHERE id=$1 AND session_id=$2 AND expires_at>now()",
        [id, req.sessionID],
      )
    ).rows[0] || null
  );
}
async function completeLogin(req, res, requestId, sourceSessionId) {
  const user = await currentUser(req);
  if (!user) return res.redirect("/login");
  // Consume the original browser-bound request once, after session ID rotation.
  const { rows } = await pool.query(
    `DELETE FROM api_sso_login_requests
    WHERE id=$1 AND session_id=$2 AND expires_at>now()
    RETURNING client_id,state,challenge`,
    [requestId, sourceSessionId],
  );
  if (!rows[0])
    return res.status(400).render("message", {
      title: "คำขอ SSO หมดอายุ",
      message: "กรุณาเริ่ม Login ใหม่จาก A/B",
    });
  await ssoStatus.ensure(req);
  return finish(req, res, rows[0], user, { retryFailed: false });
}
async function revokeIssued(userId, sessionId = "admin-action") {
  // Invalidate pending C bootstraps before revoking to prevent late success after logout.
  await pool.query(
    "UPDATE central_sso_status SET status='failed',reason='logout',access_token=NULL,token_jti=NULL,updated_at=now() WHERE user_id=$1",
    [userId],
  );
  // Revoke the shared central token and notify each application independently.
  const assertion = await sign(
    { token_use: "sso_logout", c_session: sessionId },
    config.kcIssuer,
    userId,
  );
  const response = await fetch(config.kcInternalUrl + "/temporary-sso-poc/logout-user", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ assertion }),
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  });
  if (!response.ok) throw Error("Central logout failed");
  const cutoff = Date.now();
  for (const [client, target] of Object.entries(targets)) {
    const notification = await sign(
      { token_use: "control_logout", revoked_before: cutoff },
      client,
      centralSubject(userId),
    );
    const result = await fetch(target.logout, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ logout_token: notification }),
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if (!result.ok) throw Error("App logout failed");
  }
}
module.exports = { authorize, completeLogin, loginRequest, revokeIssued };
