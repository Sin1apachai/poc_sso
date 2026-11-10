const session = require("express-session");
const PgStore = require("connect-pg-simple")(session);
const { pool } = require("../db/database");

const { cookieName } = require("../config");
const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: false, // Local development uses HTTP.
};

function sessionMiddleware() {
  if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is required");
  }

  return session({
    store: new PgStore({ pool, createTableIfMissing: true }),
    name: cookieName,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { ...cookieOptions, maxAge: 60 * 60 * 1000 },
  });
}

module.exports = { sessionMiddleware };
