const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const { pool } = require("../db/database");
let dummy;
async function authenticate(login, password) {
  dummy ||= await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);
  const { rows } = await pool.query("SELECT * FROM users WHERE username=$1 OR email=$1", [login]);
  const user = rows[0];
  const ok = await bcrypt.compare(password, user?.password_hash || dummy);
  return user?.enabled && ok && Buffer.byteLength(password) <= 72 ? user : null;
}
const saveSession = (req) =>
  new Promise((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
const regenerateSession = (req) =>
  new Promise((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
module.exports = { authenticate, saveSession, regenerateSession };
