const crypto = require("node:crypto");
const config = require("../config");
function key() {
  if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET required");
  }
  return crypto
    .createHash("sha256")
    .update("app-token:" + config.systemId + ":" + process.env.SESSION_SECRET)
    .digest();
}

async function issueAppToken({
  userId,
  mode,
  expiresAt,
  centralSub,
  centralSid,
  permissions = [],
}) {
  const { SignJWT } = await import("jose");
  if (!["local", "sso"].includes(mode) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error("Invalid app token context");
  }
  const payload = { token_use: "app_session", auth_mode: mode, permissions };
  if (mode === "sso") {
    payload.central_sub = centralSub;
    payload.central_sid = centralSid;
  }
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(config.publicUrl)
    .setAudience(config.systemId)
    .setSubject(String(userId))
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt / 1000))
    .sign(key());
}

async function verifyAppToken(token, { userId, mode, centralSub, centralSid }) {
  const { jwtVerify } = await import("jose");
  const { payload } = await jwtVerify(token, key(), {
    issuer: config.publicUrl,
    audience: config.systemId,
    algorithms: ["HS256"],
    requiredClaims: ["sub", "exp", "iat", "jti"],
  });
  if (
    payload.token_use !== "app_session" ||
    payload.auth_mode !== mode ||
    payload.sub !== String(userId)
  ) {
    throw new Error("Wrong app token context");
  }
  if (
    mode === "sso" &&
    (payload.central_sub !== centralSub ||
      payload.central_sid !== centralSid ||
      !payload.permissions?.includes("read"))
  ) {
    throw new Error("Wrong central identity binding");
  }
  return payload;
}
module.exports = { issueAppToken, verifyAppToken };
