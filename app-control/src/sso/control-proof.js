const crypto = require("node:crypto");
const { getSigningKey } = require("./signing-keys");
const config = require("../config");
async function sign(payload, audience, subject) {
  const { SignJWT } = await import("jose");
  const signing = await getSigningKey();
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: signing.kid, typ: "JWT" })
    .setIssuer(config.oidcIssuer)
    .setSubject(String(subject))
    .setAudience(audience)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(signing.key);
}
function permissions(user) {
  return Object.fromEntries(
    [
      ["app-a", "allow_a"],
      ["app-b", "allow_b"],
    ].map(([app, key]) => [
      app,
      [
        user[key] && "read",
        user[key + "_write"] && "write",
        user[key + "_delete"] && "delete",
      ].filter(Boolean),
    ]),
  );
}
function centralSubject(userId) {
  const bytes = crypto
    .createHash("md5")
    .update(config.oidcIssuer + "::" + userId)
    .digest();
  bytes[6] = (bytes[6] & 15) | 48;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = bytes.toString("hex");
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join("-");
}
module.exports = { sign, permissions, centralSubject };
