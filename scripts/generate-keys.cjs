const { generateKeyPairSync, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const file = "secrets/app-control-jwks.json";
fs.mkdirSync("secrets", { recursive: true });
if (fs.existsSync(file))
  throw new Error("Key file already exists; existing keys were not changed.");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = {
  ...privateKey.export({ format: "jwk" }),
  kid: randomUUID(),
  use: "sig",
  alg: "RS256",
};
fs.writeFileSync(file, JSON.stringify({ keys: [key] }, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log("Created local C signing key. Keep it private; never commit it.");
