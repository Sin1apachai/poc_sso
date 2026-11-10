const crypto = require("node:crypto");
const { getSigningKey } = require("./signing-keys");
const { pool } = require("../db/database");
const config = require("../config");
const { verifyAppToken } = require("../auth/app-token");
const { csrfToken } = require("../auth/csrf");
const { saveSession } = require("../auth/auth");
const targets = {
  "app-a": {
    secret: () => process.env.APP_A_KC_CLIENT_SECRET,
    callback: "http://localhost:4001/sso/callback",
    logout: "http://app-a:4001/logout/control",
    read: "allow_a",
  },
  "app-b": {
    secret: () => process.env.APP_B_KC_CLIENT_SECRET,
    callback: "http://localhost:4002/sso/callback",
    logout: "http://app-b:4001/logout/control",
    read: "allow_b",
  },
  "app-control": { secret: () => process.env.KC_CLIENT_SECRET },
};
const hash = (s) => crypto.createHash("sha256").update(s).digest("base64url");
let keys;
async function sign(payload, audience, subject) {
  const jose = await import("jose");
  const signing = await getSigningKey();
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: signing.kid, typ: "JWT" })
    .setIssuer(config.oidcIssuer)
    .setSubject(String(subject))
    .setAudience(audience)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(signing.key);
}

async function kcPost(path, clientId, params) {
  const target = targets[clientId];
  if (!target) {
    throw Error("Unknown client");
  }
  const response = await fetch(config.kcInternalUrl + "/protocol/openid-connect/" + path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, client_id: clientId, client_secret: target.secret() }),
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) {
    throw Error("Central token request failed");
  }
  return response;
}

async function currentUser(req) {
  const local = req.session.local;
  if (!local || local.expiresAt <= Date.now()) {
    return null;
  }
  try {
    await verifyAppToken(local.appToken, { userId: local.userId, mode: "local" });
  } catch {
    return null;
  }
  return (
    (await pool.query("SELECT * FROM users WHERE id=$1 AND enabled=true", [local.userId]))
      .rows[0] || null
  );
}

async function sourceActive(db, sessionId, userId) {
  const { rows } = await db.query(
    `SELECT s.sid FROM session s JOIN users u ON u.id=$2
 WHERE s.sid=$1 AND s.sess->'local'->>'userId'=$2::text AND u.enabled=true
 AND s.expire>now() AND (s.sess->'local'->>'expiresAt')::bigint>extract(epoch from now())*1000
 AND NOT EXISTS(SELECT 1 FROM api_sso_closed_sessions c WHERE c.session_id=s.sid)`,
    [sessionId, String(userId)],
  );
  return !!rows[0];
}

// 1. Validate C session. 2. Request and verify token. 3. Register it for Logout.
async function issueFor(user, clientId, sessionId) {
  if (!(await sourceActive(pool, sessionId, user.id))) {
    throw Error("C session ended");
  }
  const assertion = await sign(
    { email: user.email, preferred_username: user.email, name: user.email },
    config.kcIssuer,
    user.id,
  );
  const response = await kcPost("token", clientId, {
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
    scope: "openid profile email",
  });
  const tokens = await response.json();
  const jose = await import("jose");
  keys ||= jose.createRemoteJWKSet(
    new URL(config.kcInternalUrl + "/protocol/openid-connect/certs"),
  );
  const { payload } = await jose.jwtVerify(tokens.access_token, keys, {
    issuer: config.kcIssuer,
    audience: clientId,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "jti", "iat", "exp", "email"],
  });
  if (
    payload.idp !== "app-control" ||
    payload.email.trim().toLowerCase() !== user.email ||
    (user.kc_user_id && payload.sub !== user.kc_user_id)
  ) {
    throw Error("Central identity mismatch");
  }
  const db = await pool.connect();
  let id = crypto.randomUUID(),
    issuedMs;
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(13456,hashtext($1))", [String(user.id)]);
    if (!(await sourceActive(db, sessionId, user.id))) {
      throw Error("C session ended");
    }
    issuedMs = Date.now();
    await db.query(
      `INSERT INTO api_sso_tokens(id,user_id,c_session_id,client_id,kc_sub,token_jti,access_token,expires_at,issued_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        user.id,
        sessionId,
        clientId,
        payload.sub,
        payload.jti,
        tokens.access_token,
        new Date(payload.exp * 1000),
        issuedMs,
      ],
    );
    // The dashboard is ready only while both the C session and central token are valid.
    const { rows: sessions } = await db.query(
      "SELECT sess->'local'->>'expiresAt' AS exp FROM session WHERE sid=$1",
      [sessionId],
    );
    const localExpiresAt = Number(sessions[0].exp);
    const centralExpiresAt = payload.exp * 1000;
    const statusExpiresAt = new Date(Math.min(centralExpiresAt, localExpiresAt));

    await db.query(
      `INSERT INTO central_sso_status (
         session_id, generation, status, attempts, email, expires_at
       ) VALUES ($1, $2, 'success', 1, $3, $4)
       ON CONFLICT (session_id) DO UPDATE SET
         status = 'success',
         email = EXCLUDED.email,
         reason = NULL,
         updated_at = now(),
         expires_at = EXCLUDED.expires_at`,
      [sessionId, crypto.randomUUID(), user.email, statusExpiresAt],
    );
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    await kcPost("revoke", clientId, {
      token: tokens.access_token,
      token_type_hint: "access_token",
    }).catch(() => {});
    throw e;
  } finally {
    db.release();
  }
  return { id, payload, accessToken: tokens.access_token, issuedMs };
}

function returnTo(res, request, extra) {
  const url = new URL(targets[request.client_id].callback);
  url.search = new URLSearchParams({ state: request.state, iss: config.publicUrl, ...extra });
  res.redirect(url.href);
}

// Send the token through a browser POST bound to the original A/B request.
async function finish(req, res, request, user) {
  if (!user[targets[request.client_id].read] || user.sync_status !== "synced") {
    return returnTo(res, request, { error: "access_denied" });
  }
  try {
    const token = await issueFor(user, request.client_id, req.sessionID);
    const response = await sign(
      {
        token_use: "sso_response",
        state: request.state,
        challenge: request.challenge,
        token_hash: hash(token.accessToken),
        token_jti: token.payload.jti,
        issued_ms: token.issuedMs,
      },
      request.client_id,
      token.payload.sub,
    );
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "origin" });
    res.render("sso-post", {
      callback: targets[request.client_id].callback,
      state: request.state,
      issuer: config.publicUrl,
      accessToken: token.accessToken,
      response,
    });
  } catch {
    returnTo(res, request, { error: "temporarily_unavailable" });
  }
}

async function authorize(req, res) {
  const { client_id, state, challenge, mode } = req.query;
  if (
    !["app-a", "app-b"].includes(client_id) ||
    typeof state !== "string" ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(state) ||
    typeof challenge !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(challenge)
  ) {
    return res.sendStatus(400);
  }
  const request = { client_id, state, challenge };
  const user = await currentUser(req);
  if (user) {
    return finish(req, res, request, user);
  }
  if (mode === "silent") {
    return returnTo(res, request, { error: "login_required" });
  }
  csrfToken(req);
  await saveSession(req);
  const id = crypto.randomBytes(32).toString("base64url");
  await pool.query("DELETE FROM api_sso_login_requests WHERE expires_at<=now()");
  await pool.query(
    `INSERT INTO api_sso_login_requests(id,session_id,client_id,state,challenge,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')`,
    [id, req.sessionID, client_id, state, challenge],
  );
  res.redirect("/login?request=" + encodeURIComponent(id));
}

async function loginRequest(req, id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(id)) {
    return null;
  }
  return (
    (
      await pool.query(
        "SELECT * FROM api_sso_login_requests WHERE id=$1 AND session_id=$2 AND expires_at>now()",
        [id, req.sessionID],
      )
    ).rows[0] || null
  );
}

async function resume(req, res) {
  const request = await loginRequest(req, req.query.request);
  const user = await currentUser(req);
  if (!request || !user) {
    return res.redirect("/login");
  }
  await pool.query("DELETE FROM api_sso_login_requests WHERE id=$1", [request.id]);
  return finish(req, res, request, user);
}

async function revokeIssued(userId) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(13456,hashtext($1))", [String(userId)]);
    const cutoff = Date.now();
    const { rows } = await db.query("SELECT * FROM api_sso_tokens WHERE user_id=$1", [userId]);
    for (const row of rows) {
      if (!row.revoked && new Date(row.expires_at).getTime() > Date.now()) {
        await kcPost("revoke", row.client_id, {
          token: row.access_token,
          token_type_hint: "access_token",
        });
      }
    }
    for (const clientId of ["app-a", "app-b"]) {
      for (const sub of new Set(
        rows.filter((r) => r.client_id === clientId).map((r) => r.kc_sub),
      )) {
        const logoutToken = await sign(
          { token_use: "control_logout", revoked_before: cutoff },
          clientId,
          sub,
        );
        const response = await fetch(targets[clientId].logout, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ logout_token: logoutToken }),
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
          throw Error("App logout failed");
        }
      }
    }
    await db.query("DELETE FROM api_sso_tokens WHERE user_id=$1", [userId]);
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
module.exports = { authorize, resume, loginRequest, issueFor, revokeIssued };
