const crypto = require("node:crypto");
const { pool } = require("../db/database");
const config = require("../config");
const { checkReadiness } = require("./sso-readiness");
const pending = ["checking", "ready", "redirecting"];
async function read(sessionId) {
  // A stalled browser redirect or interrupted worker must not remain pending forever.
  await pool.query(
    `UPDATE central_sso_status SET status='failed',reason='expired',updated_at=now()
    WHERE session_id=$1 AND status!='failed' AND (expires_at<=now() OR
      (status IN ('checking','ready','redirecting') AND updated_at<now()-interval '2 minutes'))`,
    [sessionId],
  );
  const { rows } = await pool.query("SELECT * FROM central_sso_status WHERE session_id=$1", [
    sessionId,
  ]);
  return rows[0] || { status: "idle", attempts: 0 };
}

async function enqueue(req) {
  await read(req.sessionID);
  const generation = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO central_sso_status(session_id,generation,status,expires_at)
    VALUES($1,$2,'checking',$3) ON CONFLICT(session_id) DO UPDATE
    SET generation=EXCLUDED.generation,status='checking',attempts=0,reason=NULL,email=NULL,
        expires_at=EXCLUDED.expires_at,updated_at=now()
    WHERE central_sso_status.status NOT IN ('checking','ready','redirecting')
    RETURNING generation`,
    [req.sessionID, generation, new Date(req.session.local.expiresAt)],
  );
  if (rows[0]) {
    void run(req.sessionID, generation).catch(async () => {
      await pool
        .query(
          `UPDATE central_sso_status SET status='failed',reason='internal',updated_at=now()
      WHERE session_id=$1 AND generation=$2 AND status='checking'`,
          [req.sessionID, generation],
        )
        .catch(() => {});
    });
  }
}

async function run(sessionId, generation) {
  const result = await checkReadiness({
    url: config.kcInternalUrl + "/.well-known/openid-configuration",
    issuer: config.kcIssuer,
    onAttempt: async (attempt) => {
      await pool.query(
        `UPDATE central_sso_status SET attempts=$3,updated_at=now()
      WHERE session_id=$1 AND generation=$2 AND status='checking'`,
        [sessionId, generation, attempt],
      );
    },
  });
  await pool.query(
    `UPDATE central_sso_status SET status=$3,reason=$4,updated_at=now()
    WHERE session_id=$1 AND generation=$2 AND status='checking'`,
    [sessionId, generation, result.ok ? "ready" : "failed", result.reason || null],
  );
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
    label = "SSO พร้อมใช้งาน";
    buttonLabel = "เชื่อมต่อ SSO ใหม่";
  } else if (status === "idle") {
    label = "ยังไม่ได้ยืนยันสถานะ SSO";
    note = "เข้าสู่ระบบ C แล้ว แต่ session นี้ยังไม่มีผลยืนยัน SSO กรุณากดเชื่อมต่อ SSO";
    buttonLabel = "เชื่อมต่อ SSO";
    message = note;
  } else if (pending.includes(status)) {
    label =
      status === "checking"
        ? "กำลังเชื่อมต่อ Keycloak (ครั้งที่ " + attempts + "/3)"
        : status === "ready"
          ? "เชื่อมต่อ Keycloak ได้แล้ว กำลังเริ่ม SSO"
          : "กำลังยืนยัน SSO กับ Keycloak";
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
  return { status, reason, attempts, maxAttempts: 3, label, note, message, buttonLabel };
}
module.exports = { read, enqueue, publicStatus };
