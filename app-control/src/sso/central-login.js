// API-mode central token bootstrap, independent of C local management authorization.
const { pool } = require("../db/database");
const ssoStatus = require("./sso-status");
const apiSso = require("./api-sso");
async function start(req, res) {
  await ssoStatus.enqueue(req);
  res.redirect("/");
}

async function proceed(req, res) {
  await ssoStatus.read(req.sessionID);
  const { rows } = await pool.query(
    `UPDATE central_sso_status SET status='redirecting',updated_at=now()
    WHERE session_id=$1 AND status='ready' RETURNING generation`,
    [req.sessionID],
  );
  if (!rows[0]) {
    return res.redirect("/");
  }
  try {
    await apiSso.issueFor(req.user, "app-control", req.sessionID);
  } catch {
    await pool.query(
      `UPDATE central_sso_status SET status='failed',reason='unavailable',updated_at=now()
      WHERE session_id=$1 AND generation=$2`,
      [req.sessionID, rows[0].generation],
    );
  }
  res.redirect("/");
}
module.exports = { start, proceed };
