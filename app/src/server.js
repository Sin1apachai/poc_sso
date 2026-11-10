const { initializePendingRequests } = require("./sso/sso-pending");
const config = require("./config");
const { browserIdentity } = require("./auth/browser-identity");
const express = require("express");
const path = require("node:path");
const helmet = require("helmet");
const { initializeDatabase } = require("./db/database");
const { sessionMiddleware } = require("./auth/session");
const { createRoutes } = require("./routes");

async function start() {
  await initializeDatabase();
  await initializePendingRequests();

  const app = express();
  app.locals.systemName = config.systemName;
  app.locals.systemId = config.systemId;
  app.disable("x-powered-by");
  // Chromium applies form-action to redirects after form submission too.
  // Allow only the public origins participating in this SSO flow.
  const formOrigins = [
    "'self'",
    new URL(config.kcIssuer).origin,
    new URL(config.otherAppUrl).origin,
    "http://localhost:4003",
  ];
  app.use(
    helmet({
      xFrameOptions: false,
      contentSecurityPolicy: {
        directives: {
          formAction: [...new Set(formOrigins)],
          frameAncestors: ["'self'", "http://localhost:4003"],
        },
      },
    }),
  );
  app.use(express.static(path.join(__dirname, "../public")));
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "../views"));

  app.use(sessionMiddleware());
  app.use(browserIdentity);
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));

  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  app.use(await createRoutes());
  app.use((error, req, res, next) => {
    // Do not log credentials, cookies, tokens, or request bodies.
    console.error("Request failed:", {
      method: req.method,
      handler: req.route?.path || "unknown",
      type: error.constructor.name,
      message: error.message,
    });
    if (res.headersSent) {
      return next(error);
    }
    res.status(500).send("ระบบขัดข้อง กรุณาลองใหม่");
  });
  app.listen(config.port, "0.0.0.0", () => {
    console.log(`${config.systemName} listening on port ${config.port}`);
  });
}

start().catch((error) => {
  console.error("Startup failed:", error.message);
  process.exit(1);
});
