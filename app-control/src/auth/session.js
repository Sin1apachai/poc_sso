const session = require("express-session");
const PgStore = require("connect-pg-simple")(session);
const { pool } = require("../db/database");
module.exports = session({
  name: "app_control_session",
  secret: process.env.SESSION_SECRET,
  store: new PgStore({ pool, createTableIfMissing: true }),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: false, maxAge: 3600000 },
});
