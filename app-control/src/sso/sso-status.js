const crypto = require("node:crypto");
const { pool } = require("../db/database");
const { retryBootstrap } = require("./sso-readiness");
const centralToken = require("./central-token");
const config = require("../config");
const jobs = new Map();
async function read(sessionId) {
  const old = (
    await pool.query(
      "SELECT access_token FROM central_sso_status WHERE session_id=$1 AND status='success'",
      [sessionId],
    )
  ).rows[0];
  if (old?.access_token) {
    let shared = false;
    try {
      const claims = JSON.parse(Buffer.from(old.access_token.split(".")[1], "base64url"));
      shared = claims.central_shared === true && claims.aud === config.kcAudience;
    } catch {}
    if (!shared)
      await pool.query(
        "UPDATE central_sso_status SET status='failed',reason='expired',access_token=NULL,token_jti=NULL WHERE session_id=$1",
        [sessionId],
      );
  }
  await pool.query(
    `UPDATE central_sso_status SET status='failed',reason='expired',access_token=NULL,token_jti=NULL,updated_at=now()
    WHERE session_id=$1 AND status!='failed' AND (expires_at<=now()
      OR (status='success' AND access_token IS NULL)
      OR (status='checking' AND updated_at<now()-interval '2 minutes'))`,
    [sessionId],
  );
  return (
    (await pool.query("SELECT * FROM central_sso_status WHERE session_id=$1", [sessionId]))
      .rows[0] || { status: "idle", attempts: 0 }
  );
}
async function enqueue(req, { wait = false } = {}) {
  const sessionId = req.sessionID;
  if (jobs.has(sessionId)) {
    if (wait) await jobs.get(sessionId);
    return read(sessionId);
  }
  await read(sessionId);
  const generation = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO central_sso_status(session_id,generation,status,expires_at,user_id)
    VALUES($1,$2,'checking',$3,$4) ON CONFLICT(session_id) DO UPDATE SET
    generation=EXCLUDED.generation,status='checking',attempts=0,reason=NULL,email=NULL,
    user_id=EXCLUDED.user_id,access_token=NULL,token_jti=NULL,expires_at=EXCLUDED.expires_at,updated_at=now()
    WHERE central_sso_status.status!='checking' RETURNING generation`,
    [sessionId, generation, new Date(req.session.local.expiresAt), req.session.local.userId],
  );
  if (!rows[0]) return read(sessionId);
  const job = run(sessionId, generation)
    .catch(async () => {
      await pool
        .query(
          `UPDATE central_sso_status SET status='failed',reason='internal',access_token=NULL,token_jti=NULL,updated_at=now()
      WHERE session_id=$1 AND generation=$2 AND status='checking'`,
          [sessionId, generation],
        )
        .catch(() => {});
    })
    .finally(() => {
      if (jobs.get(sessionId) === job) jobs.delete(sessionId);
    });
  jobs.set(sessionId, job);
  if (wait) await job;
  return read(sessionId);
}
async function ensure(req, { retryFailed = true } = {}) {
  const state = await read(req.sessionID);
  if (state.status === "success" && state.access_token) return state;
  if (state.status === "failed" && !retryFailed) return state;
  return enqueue(req, { wait: true });
}
async function run(sessionId, generation) {
  const result = await retryBootstrap({
    attempt: () => centralToken.request(sessionId, generation),
    onAttempt: async (attempt) => {
      const updated = await pool.query(
        `UPDATE central_sso_status SET attempts=$3,updated_at=now()
        WHERE session_id=$1 AND generation=$2 AND status='checking' RETURNING session_id`,
        [sessionId, generation, attempt],
      );
      if (!updated.rowCount) throw Error("Bootstrap cancelled");
    },
  });
  if (!result.ok) {
    await pool.query(
      `UPDATE central_sso_status SET status='failed',reason=$3,access_token=NULL,token_jti=NULL,updated_at=now()
      WHERE session_id=$1 AND generation=$2 AND status='checking'`,
      [sessionId, generation, result.reason],
    );
    return;
  }
  const token = result.value;
  const updated = await pool.query(
    `UPDATE central_sso_status c SET status='success',email=$3,
    access_token=$4,token_jti=$5,expires_at=LEAST($6,
      (SELECT to_timestamp((sess->'local'->>'expiresAt')::double precision/1000) FROM session WHERE sid=$1)),
    reason=NULL,updated_at=now() WHERE session_id=$1 AND generation=$2 AND status='checking' AND user_id=$7
    AND EXISTS(SELECT 1 FROM session s JOIN users u ON u.id=$7 WHERE s.sid=$1 AND s.expire>now()
      AND s.sess->'local'->>'userId'=$7::text AND (s.sess->'local'->>'expiresAt')::bigint>extract(epoch FROM now())*1000
      AND u.enabled=true AND NOT EXISTS(SELECT 1 FROM api_sso_closed_sessions WHERE session_id=s.sid))`,
    [
      sessionId,
      generation,
      token.payload.email,
      token.accessToken,
      token.payload.jti,
      new Date(token.payload.exp * 1000),
      token.userId,
    ],
  );
  if (!updated.rowCount) await centralToken.revoke(token.accessToken).catch(() => {});
}
function publicStatus(row) {
  const status = row.status,
    reason = row.reason || null,
    attempts = row.attempts || 0;
  let label,
    note = "",
    message = "",
    buttonLabel = "ลองเชื่อมต่อ SSO อีกครั้ง";
  if (status === "success") {
    label = "เชื่อมต่อ SSO สำเร็จ ได้รับ token กลางแล้ว";
    note =
      "ได้รับ token กลางแล้ว เมื่อเข้าแอปอื่นจะใช้ token ใบเดิมและตรวจสิทธิ์ของแอปจาก app_permissions";
    buttonLabel = "เชื่อมต่อ SSO ใหม่";
  } else if (status === "idle") {
    label = "ยังไม่ได้ยืนยันสถานะ SSO";
    note = "เข้าสู่ระบบ C แล้ว แต่ session นี้ยังไม่มีผลยืนยัน SSO กรุณากดเชื่อมต่อ SSO";
    buttonLabel = "เชื่อมต่อ SSO";
    message = note;
  } else if (status === "checking") {
    label = "กำลังเชื่อมต่อ Keycloak (ครั้งที่ " + attempts + "/3)";
    message = "กำลังสร้าง SSO session กรุณารอสักครู่";
    buttonLabel = "กำลังเชื่อมต่อ SSO";
  } else {
    label =
      reason === "expired"
        ? "Token หรือคำขอ SSO หมดอายุ กรุณาเชื่อมต่อ SSO ใหม่"
        : reason === "logout"
          ? "ออกจาก SSO แล้ว กรุณาเชื่อมต่อ SSO ใหม่"
          : "ไม่สามารถสร้าง SSO session ได้ กรุณาลองเชื่อมต่อใหม่หรือติดต่อผู้ดูแลระบบ";
    note = "Login ของ C ยังใช้งานได้ สามารถลองเชื่อมต่อ SSO อีกครั้ง";
    message = label;
  }
  return {
    status,
    reason,
    attempts,
    maxAttempts: 3,
    label,
    note,
    message,
    buttonLabel,
    tokenIssued: status === "success" && !!row.access_token,
    clientId: status === "success" ? config.kcAuthorityClient : null,
    expiresAt: status === "success" ? new Date(row.expires_at).getTime() : null,
  };
}

module.exports = { read, enqueue, ensure, publicStatus };
