const { pool } = require("../db/database");

async function initializePendingRequests() {
  await pool.query(`CREATE TABLE IF NOT EXISTS sso_pending_requests (
    state TEXT PRIMARY KEY,
    browser_id TEXT NOT NULL,
    payload JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sso_pending_requests_expiry
    ON sso_pending_requests(expires_at)`);
}

async function storePendingRequest(browserId, request) {
  await pool.query("DELETE FROM sso_pending_requests WHERE expires_at <= now()");
  await pool.query(
    `INSERT INTO sso_pending_requests(state,browser_id,payload,expires_at)
    VALUES($1,$2,$3,now()+interval '10 minutes')`,
    [request.state, browserId, request],
  );
}

async function takePendingRequest(browserId, state) {
  if (typeof state !== "string" || state.length > 256) {
    return undefined;
  }
  const { rows } = await pool.query(
    `DELETE FROM sso_pending_requests
    WHERE state=$1 AND browser_id=$2 AND expires_at>now()
    RETURNING payload`,
    [state, browserId],
  );
  return rows[0]?.payload;
}

async function getPendingRequest(browserId, state) {
  if (typeof state !== "string" || state.length > 256) {
    return undefined;
  }
  const { rows } = await pool.query(
    "SELECT payload FROM sso_pending_requests WHERE state=$1 AND browser_id=$2 AND expires_at>now()",
    [state, browserId],
  );
  return rows[0]?.payload;
}
module.exports = {
  initializePendingRequests,
  storePendingRequest,
  takePendingRequest,
  getPendingRequest,
};
