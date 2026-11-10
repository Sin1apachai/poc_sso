const express = require("express");
const { issueAppToken, verifyAppToken } = require("./auth/app-token");
const { rateLimit } = require("express-rate-limit");
const { authenticate, regenerateSession, saveSession } = require("./auth/auth");
const { pool } = require("./db/database");
const { csrfToken, checkCsrf } = require("./auth/csrf");
const config = require("./config");
const sso = require("./sso/keycloak");
const logoutEvents = require("./sso/logout-events");

async function createRoutes() {
  const router = express.Router();
  const localLoginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  async function requireAuthentication(req, res, next) {
    if (!req.session.local) {
      return sso.requireSso(req, res, next);
    }
    const local = req.session.local;
    try {
      await verifyAppToken(local.appToken, { userId: local.userId, mode: "local" });
    } catch {
      return sso.rejectSession(req, res, "session-invalid");
    }
    if (local.expiresAt <= Date.now()) {
      return sso.rejectSession(req, res, "session-expired");
    }
    const { rows } = await pool.query("SELECT id,email FROM users WHERE id=$1", [local.userId]);
    if (!rows[0]) {
      return sso.rejectSession(req, res, "missing-user");
    }
    req.localUser = rows[0];
    req.authMode = "local";
    next();
  }

  router.get("/health", async (req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok", system: config.systemId });
  });
  router.get("/login/local", async (req, res) => {
    req.session.ssoChecked = true;
    await saveSession(req);
    res.redirect("/login");
  });
  router.get("/login", async (req, res) => {
    if (req.session.sso && req.session.sso.expiresAt * 1000 <= Date.now()) {
      return sso.rejectSession(req, res, "session-expired");
    }
    if (req.session.local || req.session.sso) {
      return requireAuthentication(req, res, () => res.redirect("/"));
    }
    if (!req.session.ssoChecked && !req.session.accessDenied && !req.session.loginNotice) {
      return sso.startSso(req, res, { silent: true });
    }
    // Consume explicit Login errors once. Discard legacy persistent denial flags.
    const denied = req.session.accessDenied;
    delete req.session.accessDenied;
    const accessDenied = denied?.explicit
      ? denied.reason === "missing-user"
        ? "missing-user"
        : true
      : false;
    const connectionError = req.session.connectionError || false;
    delete req.session.connectionError;
    const csrf = csrfToken(req);
    await saveSession(req);
    res.render("login", {
      error: null,
      csrf,
      accessDenied,
      connectionError,
      ssoUnavailable: req.session.ssoUnavailable || false,
      loginNotice: req.session.loginNotice || null,
    });
  });
  router.post("/login", localLoginLimit, checkCsrf, async (req, res) => {
    const login = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const user = await authenticate(login, password);
    if (!user) {
      return res.status(401).render("login", {
        error: "Invalid username or password",
        csrf: csrfToken(req),
        accessDenied: false,
        connectionError: false,
        ssoUnavailable: req.session.ssoUnavailable || false,
        loginNotice: null,
      });
    }
    await regenerateSession(req);
    const expiresAt = Date.now() + 60 * 60 * 1000;
    req.session.local = {
      userId: user.id,
      email: user.email,
      expiresAt,
      appToken: await issueAppToken({ userId: user.id, mode: "local", expiresAt }),
    };
    csrfToken(req);
    await saveSession(req);
    res.redirect("/");
  });
  router.get("/sso", async (req, res) => sso.startSso(req, res));
  router.post("/sso/preflight", checkCsrf, (req, res) => sso.startSso(req, res, { json: true }));
  router.get("/sso/connectivity", sso.connectivityStatus);
  router.get("/sso/callback", sso.acceptSso);
  router.post("/sso/callback", sso.acceptSso);
  router.get("/session/logout-events", (req, res) => logoutEvents.listen(req, res));
  router.get("/session/heartbeat", requireAuthentication, (req, res) => {
    if (req.authMode === "local") {
      return res.json({
        authenticated: true,
        mode: "local",
        expiresAt: req.session.local.expiresAt,
      });
    }
    return sso.heartbeat(req, res);
  });
  router.post("/logout/control", sso.controlLogout);
  router.get("/", requireAuthentication, (req, res) => {
    res.render("home", {
      authMode: req.authMode || "sso",
      appTokenIssued: !!(req.session.local?.appToken || req.session.sso?.appToken),
      centralTokenIssued: !!req.session.sso?.accessToken,
      email: req.localUser?.email || req.centralUser.email,
      idp: req.centralUser?.idp || "-",
      permissions: req.centralUser?.app_permissions?.[config.systemId] || [],
      otherAppUrl: config.otherAppUrl,
      csrf: csrfToken(req),
    });
  });
  router.post("/logout", checkCsrf, sso.logout);
  return router;
}
module.exports = { createRoutes };
