const express = require("express");
const { issueAppToken, verifyAppToken } = require("./auth/app-token");
const central = require("./sso/central-login");
const apiSso = require("./sso/api-sso");
const ssoStatus = require("./sso/sso-status");
const bcrypt = require("bcryptjs");
const { rateLimit } = require("express-rate-limit");
const { pool } = require("./db/database");
const { csrfToken, checkCsrf, checkSsoCsrf } = require("./auth/csrf");
const { authenticate, regenerateSession, saveSession } = require("./auth/auth");
const { syncUser, unlinkControlIdentity } = require("./services/keycloak-sync");
const { getPublicJwks } = require("./sso/signing-keys");
const permissionKeys = [
  "allow_a",
  "allow_b",
  "allow_a_write",
  "allow_a_delete",
  "allow_b_write",
  "allow_b_delete",
];
const permissionValues = (body) => permissionKeys.map((key) => body[key] === "on");
async function createRoutes() {
  const r = express.Router();
  const limit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  r.get("/health", async (req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  });
  r.get("/sso/authorize", apiSso.authorize);
  r.get("/sso/resume", apiSso.resume);
  r.get("/login", async (req, res) => {
    const relay = await apiSso.loginRequest(req, req.query.request);
    if (req.query.request && !relay) {
      return res
        .status(400)
        .render("message", { title: "คำขอ SSO หมดอายุ", message: "กรุณาเริ่ม Login ใหม่จาก A/B" });
    }
    const local = req.session.local;
    if (local && local.expiresAt > Date.now()) {
      let valid = false;
      try {
        await verifyAppToken(local.appToken, { userId: local.userId, mode: "local" });
        valid = true;
      } catch {}
      if (valid) {
        const { rows } = await pool.query("SELECT id FROM users WHERE id=$1 AND enabled=true", [
          local.userId,
        ]);
        if (rows[0]) {
          return res.redirect(relay ? "/sso/resume?request=" + encodeURIComponent(relay.id) : "/");
        }
      }
    }
    return res.render("login", {
      error: null,
      csrf: csrfToken(req),
      apiLoginRequestId: relay?.id || null,
      loginNotice: req.session.loginNotice || null,
    });
  });
  r.post("/login", limit, checkCsrf, async (req, res) => {
    const login = typeof req.body.login === "string" ? req.body.login.trim().toLowerCase() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const relay = await apiSso.loginRequest(req, req.body.sso_request);
    if (req.body.sso_request && !relay) {
      return res
        .status(400)
        .render("message", { title: "คำขอ SSO หมดอายุ", message: "กรุณาเริ่ม Login ใหม่จาก A/B" });
    }
    const user = await authenticate(login, password);
    if (!user) {
      return res.status(401).render("login", {
        error: "Invalid username or password",
        csrf: csrfToken(req),
        apiLoginRequestId: relay?.id || null,
        loginNotice: null,
      });
    }
    const previousSessionId = req.sessionID;
    await regenerateSession(req);
    const expiresAt = Date.now() + 3600000;
    req.session.local = {
      userId: user.id,
      expiresAt,
      appToken: await issueAppToken({ userId: user.id, mode: "local", expiresAt }),
    };
    // Persist one CSRF value before parallel dashboard/status requests can run.
    csrfToken(req);
    await saveSession(req);
    if (relay) {
      const result = await pool.query(
        "UPDATE api_sso_login_requests SET session_id=$1 WHERE id=$2 AND session_id=$3 AND expires_at>now()",
        [req.sessionID, relay.id, previousSessionId],
      );
      return res.redirect(
        result.rowCount ? "/sso/resume?request=" + encodeURIComponent(relay.id) : "/",
      );
    }
    return central.start(req, res);
  });
  r.get("/oidc/jwks", async (req, res) => res.json(await getPublicJwks()));
  r.post("/logout", checkCsrf, async (req, res) => {
    const userId = req.session.local?.userId;
    if (userId) {
      await pool.query(
        "INSERT INTO api_sso_closed_sessions(session_id) VALUES($1) ON CONFLICT DO NOTHING",
        [req.sessionID],
      );
      try {
        await apiSso.revokeIssued(userId);
      } catch {
        await pool.query("DELETE FROM api_sso_closed_sessions WHERE session_id=$1", [
          req.sessionID,
        ]);
        return res.status(503).render("message", {
          title: "Logout SSO ไม่สำเร็จ",
          message:
            "ไม่สามารถเพิกถอน session กลางที่ Keycloak ได้ จึงยังไม่ออกจากระบบ C กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ",
        });
      }
      await pool.query(
        `UPDATE central_sso_status SET status='failed',reason='logout',updated_at=now()
        WHERE email=(SELECT email FROM users WHERE id=$1) OR session_id=$2`,
        [userId, req.sessionID],
      );
    }
    await new Promise((resolve, reject) =>
      req.session.destroy((error) => (error ? reject(error) : resolve())),
    );
    res.clearCookie("app_control_session", { httpOnly: true, sameSite: "lax", secure: false });
    res.redirect("/login");
  });
  async function localRequired(req, res, next) {
    if (!req.session.local || req.session.local.expiresAt <= Date.now()) {
      if (req.session.local) {
        await regenerateSession(req);
        req.session.loginNotice = "session-expired";
        await saveSession(req);
      }
      if (req.path === "/session/heartbeat") {
        return res.status(401).json({ authenticated: false });
      }
      return res.redirect("/login");
    }
    try {
      await verifyAppToken(req.session.local.appToken, {
        userId: req.session.local.userId,
        mode: "local",
      });
    } catch {
      await regenerateSession(req);
      req.session.loginNotice = "session-expired";
      await saveSession(req);
      return res.redirect("/login");
    }
    next();
  }
  async function resolveControlUser(req, res, next) {
    const { rows } = await pool.query(
      "SELECT id,username,email,is_admin,enabled,allow_a,allow_b,allow_a_write,allow_a_delete,allow_b_write,allow_b_delete,sync_status,sync_error FROM users WHERE id=$1",
      [req.session.local.userId],
    );
    if (!rows[0]?.enabled) {
      await regenerateSession(req);
      await saveSession(req);
      return res.redirect("/login");
    }
    req.user = rows[0];
    res.locals.currentUser = req.user;
    res.locals.ssoState = await ssoStatus.read(req.sessionID);
    res.locals.ssoDisplay = ssoStatus.publicStatus(res.locals.ssoState);
    res.locals.csrf = csrfToken(req);
    next();
  }
  const loginRequired = [localRequired, resolveControlUser];
  r.post("/sso/retry", loginRequired, checkSsoCsrf, central.start);
  r.get("/sso/status", loginRequired, (req, res) =>
    res.json({ ...ssoStatus.publicStatus(res.locals.ssoState), csrf: res.locals.csrf }),
  );
  r.post("/sso/continue", loginRequired, checkSsoCsrf, central.proceed);
  r.get("/connect/:system", loginRequired, (req, res) => {
    const targets = {
      "app-a": { allowed: req.user.allow_a, url: "http://localhost:4001/sso" },
      "app-b": { allowed: req.user.allow_b, url: "http://localhost:4002/sso" },
    };
    const target = targets[req.params.system];
    if (!target) {
      return res.sendStatus(404);
    }
    if (!target.allowed || req.user.sync_status !== "synced") {
      return res.sendStatus(403);
    }
    if (res.locals.ssoState.status !== "success") {
      return res.redirect("/?ssoNotice=1");
    }
    res.redirect(target.url);
  });
  r.get("/session/heartbeat", loginRequired, (req, res) =>
    res.json({ authenticated: true, mode: "local", expiresAt: req.session.local.expiresAt }),
  );
  function adminRequired(req, res, next) {
    if (!req.user.is_admin) {
      return res
        .status(403)
        .render("message", { title: "Forbidden", message: "Admin permission required" });
    }
    next();
  }
  r.get("/", loginRequired, (req, res) =>
    res.render("dashboard", { user: req.user, showSsoNotice: req.query.ssoNotice === "1" }),
  );
  r.get("/users", loginRequired, adminRequired, async (req, res) => {
    const { rows } = await pool.query(
      "SELECT id,username,email,is_admin,enabled,allow_a,allow_b,allow_a_write,allow_a_delete,allow_b_write,allow_b_delete,sync_status,sync_error FROM users ORDER BY id",
    );
    res.render("users", {
      users: rows,
      notice: req.query.saved === "1" ? "บันทึกแล้ว ตรวจสถานะการซิงก์ของผู้ใช้ด้านล่าง" : null,
      error: null,
    });
  });
  function validate(data, creating) {
    const username = typeof data.username === "string" ? data.username.trim().toLowerCase() : "";
    const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
    const password = typeof data.password === "string" ? data.password : "";
    if (!/^[a-z0-9_.-]{2,60}$/.test(username)) {
      throw new Error("ชื่อผู้ใช้ต้องเป็น a-z, 0-9, จุด ขีด หรือ _ ความยาว 2–60 ตัว");
    }
    if (creating && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("รูปแบบอีเมลไม่ถูกต้อง");
    }
    if ((creating || password) && (password.length < 6 || Buffer.byteLength(password) > 72)) {
      throw new Error("รหัสผ่านต้องมีอย่างน้อย 6 ตัว และไม่เกิน 72 ไบต์");
    }
    return { username, email, password };
  }
  async function audit(req, action, email) {
    await pool.query("INSERT INTO audit_log(actor_id,action,email) VALUES($1,$2,$3)", [
      req.user.id,
      action,
      email,
    ]);
  }
  r.post("/users", loginRequired, adminRequired, checkCsrf, async (req, res) => {
    const data = validate(req.body, true);
    const { rows } = await pool.query(
      `INSERT INTO users(username,email,password_hash,allow_a,allow_b,allow_a_write,allow_a_delete,allow_b_write,allow_b_delete)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        data.username,
        data.email,
        await bcrypt.hash(data.password, 12),
        ...permissionValues(req.body),
      ],
    );
    await audit(req, "create-user", data.email);
    await syncUser(rows[0].id);
    res.redirect("/users?saved=1");
  });
  r.post("/users/:id", loginRequired, adminRequired, checkCsrf, async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) {
      return res.sendStatus(400);
    }
    const data = validate(req.body, false);
    const enabled = req.body.enabled === "on";
    if (String(req.user.id) === req.params.id && !enabled) {
      return res.status(400).render("message", {
        title: "บันทึกไม่ได้",
        message: "ไม่สามารถปิดบัญชีผู้ดูแลที่กำลังใช้งานอยู่",
      });
    }
    const hash = data.password ? await bcrypt.hash(data.password, 12) : null;
    const { rows } = await pool.query(
      `UPDATE users SET username=$2,password_hash=COALESCE($3,password_hash),
   enabled=$4,allow_a=$5,allow_b=$6,allow_a_write=$7,allow_a_delete=$8,allow_b_write=$9,allow_b_delete=$10,sync_status='pending',sync_error=NULL WHERE id=$1 RETURNING email`,
      [req.params.id, data.username, hash, enabled, ...permissionValues(req.body)],
    );
    if (!rows[0]) {
      return res.sendStatus(404);
    }
    if (data.password) {
      await pool.query("DELETE FROM session WHERE sess->>'userId'=$1", [req.params.id]);
    }
    await audit(req, "update-user-permissions", rows[0].email);
    await syncUser(req.params.id);
    res.redirect("/users?saved=1");
  });
  r.post("/users/:id/sync", loginRequired, adminRequired, checkCsrf, async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) {
      return res.sendStatus(400);
    }
    await syncUser(req.params.id);
    res.redirect("/users?saved=1");
  });
  r.post("/users/:id/delete", loginRequired, adminRequired, checkCsrf, async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) {
      return res.sendStatus(400);
    }
    if (String(req.user.id) === req.params.id) {
      return res.status(400).render("message", {
        title: "ลบไม่ได้",
        message: "ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่",
      });
    }
    const { rows } = await pool.query(
      "UPDATE users SET enabled=false,allow_a=false,allow_b=false,allow_a_write=false,allow_a_delete=false,allow_b_write=false,allow_b_delete=false,sync_status='pending' WHERE id=$1 RETURNING email",
      [req.params.id],
    );
    if (!rows[0]) {
      return res.sendStatus(404);
    }
    if (!(await syncUser(req.params.id))) {
      return res.redirect("/users?saved=1");
    }
    await unlinkControlIdentity(req.params.id);
    await audit(req, "delete-user", rows[0].email);
    await pool.query("DELETE FROM session WHERE sess->>'userId'=$1", [req.params.id]);
    await pool.query("DELETE FROM users WHERE id=$1", [req.params.id]);
    res.redirect("/users?saved=1");
  });
  return r;
}
module.exports = { createRoutes };
