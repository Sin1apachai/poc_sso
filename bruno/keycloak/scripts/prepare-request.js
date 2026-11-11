const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function readConfiguration(projectRoot) {
  return Object.fromEntries(
    fs
      .readFileSync(path.join(projectRoot, ".env"), "utf8")
      .split(/\r?\n/)
      .filter((line) => /^[A-Z_][A-Z_0-9]*=/.test(line))
      .map((line) => {
        const at = line.indexOf("=");
        let value = line.slice(at + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        )
          value = value.slice(1, -1);
        return [line.slice(0, at), value];
      }),
  );
}
function required(value, label) {
  if (typeof value !== "string" || !value || value.startsWith("replace-"))
    throw Error("ยังไม่มีค่า " + label + " ตรวจ .env ของโครงการ");
  return value;
}
function signAssertion(projectRoot, identity, purpose, issuer, audience, extra) {
  const { keys } = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "secrets/app-control-jwks.json"), "utf8"),
  );
  const jwk = keys.find((key) => key.alg === "RS256" && key.use === "sig" && key.d && key.kid);
  if (!jwk) throw Error("ไม่พบ private signing key ของ C ในโครงการ");
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: jwk.kid })).toString(
    "base64url",
  );
  const payload = Buffer.from(
    JSON.stringify({
      iss: issuer,
      aud: audience,
      sub: identity.subject,
      jti: crypto.randomUUID(),
      iat: issuedAt,
      exp: issuedAt + 60,
      token_use: purpose,
      c_session: identity.sourceSessionId,
      source_issued_ms: Date.now(),
      ...extra,
    }),
  ).toString("base64url");
  const input = header + "." + payload;
  const signature = crypto
    .sign("RSA-SHA256", Buffer.from(input), crypto.createPrivateKey({ key: jwk, format: "jwk" }))
    .toString("base64url");
  return input + "." + signature;
}
function prepareRequest(bru, request) {
  const operation = request.getUrl().split("?")[0].split("/").at(-1);
  if (["status", "certs"].includes(operation)) return;
  const projectRoot = path.resolve(bru.cwd(), bru.getEnvVar("project_root") || "../..");
  if (!fs.existsSync(path.join(projectRoot, ".env")))
    throw Error("ตั้ง project_root ใน environment Local ให้ชี้โฟลเดอร์ SSO ที่มี .env");
  const config = readConfiguration(projectRoot);
  const app = String(bru.getEnvVar("app") || "a").toLowerCase();
  if (!["a", "b"].includes(app)) throw Error("app ต้องเป็น a หรือ b");
  const appPrefix = app === "a" ? "APP_A_" : "APP_B_";
  for (const [name, key] of Object.entries({
    caller_client_id: appPrefix + "KC_CLIENT_ID",
    caller_client_secret: appPrefix + "KC_CLIENT_SECRET",
    authority_client_id: "KC_AUTHORITY_CLIENT",
    authority_client_secret: "CONTROL_KC_CLIENT_SECRET",
  }))
    bru.setVar(name, required(config[key], key));
  const audience =
    String(bru.getEnvVar("keycloak_url")).replace(/\/$/, "") + "/realms/" + bru.getEnvVar("realm");
  const issuer = bru.getEnvVar("control_issuer");
  if (operation === "bootstrap") {
    const id = crypto.randomUUID();
    const identity = {
      subject: "bruno-" + id,
      email: "bruno-" + id + "@example.test",
      sourceSessionId: "bruno-session-" + crypto.randomUUID(),
    };
    bru.setVar("test_identity", JSON.stringify(identity));
    bru.deleteVar("central_access_token");
    bru.deleteVar("central_token_jti");
    bru.setVar("expected_active", true);
    bru.setVar("expected_logout_minimum", 1);
    bru.setVar(
      "assertion",
      signAssertion(projectRoot, identity, "sso_bootstrap", issuer, audience, {
        target_client: config.KC_AUTHORITY_CLIENT,
        email: identity.email,
        bootstrap_generation: crypto.randomUUID(),
        app_permissions: {
          [config.APP_A_SYSTEM_ID]: ["read", "write"],
          [config.APP_B_SYSTEM_ID]: ["read"],
        },
      }),
    );
    return;
  }
  const manualToken = String(bru.getEnvVar("access_token") || "").trim();
  const token = manualToken || bru.getVar("central_access_token");
  if (!token)
    throw Error(
      "รัน 03 Bootstrap ก่อน หรือใส่ access_token จริงใน environment สำหรับ Introspect/Revoke",
    );
  bru.setVar("request_access_token", token);
  if (["introspect", "revoke"].includes(operation)) return;
  if (manualToken)
    throw Error(
      "Authorize/Logout ใช้ตัวตนจำลองจาก Bootstrap กรุณาล้าง access_token แล้วรัน 03 ใหม่",
    );
  if (!bru.getVar("test_identity")) throw Error("รัน 03 Bootstrap ใน collection นี้ก่อน");
  const identity = JSON.parse(bru.getVar("test_identity"));
  if (operation === "logout-user") {
    bru.setVar(
      "assertion",
      signAssertion(projectRoot, identity, "sso_logout", issuer, audience, {}),
    );
    return;
  }
  if (operation === "authorize") {
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    if (claims.exp <= Math.floor(Date.now() / 1000))
      throw Error("Token หมดอายุแล้ว กรุณารัน 03 ใหม่");
    const verifier = crypto.randomBytes(32).toString("base64url");
    const state = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    bru.setVar("sso_state", state);
    bru.setVar("target_client_id", config[appPrefix + "KC_CLIENT_ID"]);
    bru.setVar(
      "assertion",
      signAssertion(projectRoot, identity, "sso_login", issuer, audience, {
        email: identity.email,
        central_jti: claims.jti,
        target_client: config[appPrefix + "KC_CLIENT_ID"],
        redirect_uri: config[appPrefix + "PUBLIC_URL"].replace(/\/$/, "") + "/sso/callback",
        sso_state: state,
        sso_challenge: challenge,
      }),
    );
    return;
  }
  throw Error("Unsupported collection operation");
}
module.exports = { prepareRequest };
