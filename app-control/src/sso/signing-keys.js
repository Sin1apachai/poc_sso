const fs = require("node:fs");
const crypto = require("node:crypto");

let cached;

async function getKeys() {
  if (cached) return cached;

  const file = process.env.OIDC_JWKS_FILE;
  if (!file) throw new Error("OIDC_JWKS_FILE is required");

  const { keys } = JSON.parse(fs.readFileSync(file, "utf8"));
  const privateJwk = keys.find((key) => key.use === "sig" && key.alg === "RS256");
  if (!privateJwk?.d || !privateJwk.kid)
    throw new Error("An RS256 private signing key is required");

  const { importJWK } = await import("jose");
  const publicJwk = crypto
    .createPublicKey({ key: privateJwk, format: "jwk" })
    .export({ format: "jwk" });

  cached = {
    signing: { key: await importJWK(privateJwk, "RS256"), kid: privateJwk.kid },
    publicJwks: { keys: [{ ...publicJwk, kid: privateJwk.kid, use: "sig", alg: "RS256" }] },
  };
  return cached;
}

async function getSigningKey() {
  return (await getKeys()).signing;
}

async function getPublicJwks() {
  return (await getKeys()).publicJwks;
}

module.exports = { getSigningKey, getPublicJwks };
