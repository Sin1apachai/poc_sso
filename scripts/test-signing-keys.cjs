const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

test("C JWKS exposes only the public key and verifies C signed JWTs", async () => {
  const directory = fs.mkdtempSync(path.join(__dirname, ".sso-jwks-"));
  const previousFile = process.env.OIDC_JWKS_FILE;
  try {
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateJwk = {
      ...privateKey.export({ format: "jwk" }),
      kid: "test-signing-key",
      alg: "RS256",
      use: "sig",
    };
    const file = path.join(directory, "keys.json");
    fs.writeFileSync(file, JSON.stringify({ keys: [privateJwk] }), { mode: 0o600 });
    process.env.OIDC_JWKS_FILE = file;

    const { getSigningKey, getPublicJwks } = require("../app-control/src/sso/signing-keys");
    const signing = await getSigningKey();
    const jwks = await getPublicJwks();
    assert.equal(jwks.keys.length, 1);
    assert.deepEqual(Object.keys(jwks.keys[0]).sort(), ["alg", "e", "kid", "kty", "n", "use"]);
    assert.equal(jwks.keys[0].n, privateJwk.n);
    assert.equal(jwks.keys[0].kid, signing.kid);

    const josePath = require.resolve("jose", { paths: [path.resolve("app-control")] });
    const { SignJWT, jwtVerify, createLocalJWKSet } = await import(josePath);
    const token = await new SignJWT({ token_use: "sso_login" })
      .setProtectedHeader({ alg: "RS256", kid: signing.kid })
      .setIssuer("http://localhost:4003/oidc")
      .setAudience("app-a")
      .setExpirationTime("60s")
      .sign(signing.key);
    const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
      issuer: "http://localhost:4003/oidc",
      audience: "app-a",
      algorithms: ["RS256"],
    });
    assert.equal(payload.token_use, "sso_login");
  } finally {
    if (previousFile === undefined) delete process.env.OIDC_JWKS_FILE;
    else process.env.OIDC_JWKS_FILE = previousFile;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
