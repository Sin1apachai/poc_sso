const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const { pool } = require("../db/database");
let dummyHash;
async function authenticate(login, password) {
  dummyHash ||= await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);
  const { rows } = await pool.query(
    "SELECT id,email,password_hash FROM users WHERE email=$1 OR username=$1",
    [login],
  );
  const user = rows[0];
  const valid = await bcrypt.compare(password, user?.password_hash || dummyHash);
  if (!user || !valid || Buffer.byteLength(password) > 72) {
    return null;
  }
  return { id: String(user.id), email: user.email };
}
const saveSession = (req) =>
  new Promise((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
const regenerateSession = (req) =>
  new Promise((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
module.exports = { authenticate, saveSession, regenerateSession };
