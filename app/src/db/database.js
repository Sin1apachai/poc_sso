const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function initializeDatabase() {
  await pool.query(`CREATE TABLE IF NOT EXISTS sso_logout_fences (
    kc_sub TEXT PRIMARY KEY,revoked_before BIGINT NOT NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS logout_receipts (
    jti TEXT PRIMARY KEY, received_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT UNIQUE");
}

module.exports = { pool, initializeDatabase };
