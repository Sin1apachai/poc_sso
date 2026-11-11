// Local PoC only. Configure trust/clients; never create Keycloak users or roles.
const fs = require("node:fs");
const crypto = require("node:crypto");
const configPath = ".env";
const envText = fs.readFileSync(configPath, "utf8");
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_][A-Z_0-9]*=/.test(line))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at), line.slice(at + 1)];
    }),
);
let prepared = envText;
for (const name of [
  "APP_A_KC_CLIENT_SECRET",
  "APP_B_KC_CLIENT_SECRET",
  "CONTROL_KC_CLIENT_SECRET",
]) {
  if (!env[name] || env[name].startsWith("replace-")) {
    env[name] = crypto.randomBytes(32).toString("base64url");
    const pattern = new RegExp("^" + name + "=.*$", "m");
    prepared = pattern.test(prepared)
      ? prepared.replace(pattern, name + "=" + env[name])
      : prepared + "\n" + name + "=" + env[name] + "\n";
  }
}
if (prepared !== envText) fs.writeFileSync(configPath, prepared, { mode: 0o600 });
if (process.argv.includes("--prepare-env")) {
  console.log("Prepared local client secrets without printing them.");
  process.exit(0);
}
const base = "http://localhost:8080",
  realm = "sso-lab";
let bearer;
async function admin(method, path, body) {
  const response = await fetch(base + "/admin/realms" + path, {
    method,
    headers: { authorization: "Bearer " + bearer, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw Error(
      "Admin " +
        method +
        " " +
        path +
        " failed: " +
        response.status +
        " " +
        (await response.text()),
    );
  return [201, 204].includes(response.status) ? null : response.json();
}
(async () => {
  for (let i = 0; i < 90; i++) {
    try {
      const response = await fetch(base + "/realms/master/protocol/openid-connect/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "password",
          client_id: "admin-cli",
          username: process.env.KC_ADMIN_USERNAME || "admin",
          password: process.env.KC_ADMIN_PASSWORD || "admin-local-demo",
        }),
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        bearer = (await response.json()).access_token;
        break;
      }
      if (response.status === 401) throw Error("Admin login failed");
    } catch (e) {
      if (e.message === "Admin login failed") throw e;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!bearer) throw Error("Keycloak not ready");
  const settings = {
    realm,
    adminTheme: "sso-admin",
    enabled: true,
    sslRequired: "none",
    accessTokenLifespan: 900,
    attributes: {
      "temporary.sso.audience": env.KC_AUDIENCE,
      "temporary.sso.issuer": env.KC_ISSUER,
      "temporary.sso.logout-urls": JSON.stringify([
        "http://app-a:4001/logout/control",
        "http://app-b:4001/logout/control",
        "http://app-control:4003/logout/keycloak",
      ]),
      "temporary.sso.idp-heartbeat.enabled": "true",
      "temporary.sso.idp-heartbeat.interval-seconds": "60",
      "temporary.sso.idp-heartbeat.confirmation-interval-seconds": "5",
      "temporary.sso.idp-heartbeat.failure-threshold": "3",
      "temporary.sso.idp-heartbeat.idp-alias": env.KC_IDP_ALIAS,
      "temporary.sso.authority-client": env.KC_AUTHORITY_CLIENT,
      "temporary.sso.idp": env.KC_IDP_ALIAS,
    },
    browserSecurityHeaders: {
      contentSecurityPolicy:
        "frame-src 'self'; frame-ancestors 'self' http://localhost:4003; object-src 'none'; script-src 'self'; form-action http://localhost:4001 http://localhost:4002",
      xFrameOptions: "",
      xContentTypeOptions: "nosniff",
      referrerPolicy: "origin",
    },
  };
  await admin("PUT", "/master", { adminTheme: "sso-admin" });
  const realms = await admin("GET", "");
  if (realms.some((r) => r.realm === realm)) await admin("PUT", "/" + realm, settings);
  else await admin("POST", "", settings);
  const idp = {
    alias: env.KC_IDP_ALIAS,
    providerId: "jwt-authorization-grant",
    enabled: true,
    config: {
      issuer: "http://localhost:4003/oidc",
      jwksUrl: "http://app-control:4003/oidc/jwks",
      useJwksUrl: "true",
      ssoHealthCheckUrl: "http://app-control:4003/health",
    },
  };
  const providers = await admin("GET", "/" + realm + "/identity-provider/instances");
  if (providers.some((p) => p.alias === idp.alias))
    await admin(
      "PUT",
      "/" + realm + "/identity-provider/instances/" + encodeURIComponent(idp.alias),
      idp,
    );
  else await admin("POST", "/" + realm + "/identity-provider/instances", idp);
  for (const [client, port, secret] of [
    ["app-a", 4001, env.APP_A_KC_CLIENT_SECRET],
    ["app-b", 4002, env.APP_B_KC_CLIENT_SECRET],
    [env.KC_AUTHORITY_CLIENT, null, env.CONTROL_KC_CLIENT_SECRET],
  ]) {
    const data = {
      clientId: client,
      enabled: true,
      protocol: "openid-connect",
      publicClient: false,
      secret,
      standardFlowEnabled: false,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: false,
      fullScopeAllowed: false,
      redirectUris: port ? [`http://localhost:${port}/sso/callback`] : [],
      defaultClientScopes: [],
      optionalClientScopes: [],
      attributes: {
        "temporary.sso.enabled": "true",
        "temporary.sso.role": port ? "application" : "authority",
        ...(port ? { "temporary.sso.system-id": client } : {}),
      },
    };
    const existing = await admin("GET", "/" + realm + "/clients?clientId=" + client);
    if (existing.length) await admin("PUT", "/" + realm + "/clients/" + existing[0].id, data);
    else await admin("POST", "/" + realm + "/clients", data);
  }
  const users = await admin("GET", "/" + realm + "/users/count");
  console.log("Configured temporary SSO realm and A/B/C clients. Realm users:", users);
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
