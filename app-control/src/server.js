const express = require("express");
const helmet = require("helmet");
const path = require("node:path");
const config = require("./config");
const { initializeDatabase } = require("./db/database");
const { getSigningKey } = require("./sso/signing-keys");
const { createRoutes } = require("./routes");
async function start() {
  await initializeDatabase();
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          frameSrc: [
            "'self'",
            "http://localhost:8080",
            "http://localhost:4001",
            "http://localhost:4002",
          ],
          formAction: [
            "'self'",
            "http://localhost:8080",
            "http://localhost:4001",
            "http://localhost:4002",
          ],
        },
      },
    }),
  );
  app.use(express.static(path.join(__dirname, "../public")));
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "../views"));
  await getSigningKey();
  app.use(require("./auth/session"));
  app.use(express.urlencoded({ extended: false, limit: "8kb" }));
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(await createRoutes());
  app.use((err, req, res, next) => {
    console.error("Control request failed:", err.code || err.name, err.message);
    if (res.headersSent) {
      return next(err);
    }
    const validation =
      err.code === "23505" ||
      err.message?.startsWith("รูปแบบ") ||
      err.message?.startsWith("ชื่อผู้ใช้ต้อง") ||
      err.message?.startsWith("รหัสผ่านต้อง");
    const message =
      err.code === "23505"
        ? "ชื่อผู้ใช้หรืออีเมลนี้มีอยู่แล้ว"
        : validation
          ? err.message
          : "ดำเนินการไม่สำเร็จ กรุณากลับแล้วลองใหม่";
    res.status(validation ? 400 : 500).render("message", { title: "ดำเนินการไม่สำเร็จ", message });
  });
  app.listen(config.port, "0.0.0.0", () => console.log("App Control listening on " + config.port));
}
start().catch((e) => {
  console.error("Startup failed:", e.message);
  process.exit(1);
});
