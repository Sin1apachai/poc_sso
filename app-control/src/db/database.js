const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
async function initializeDatabase() {
  await pool.query(`CREATE TABLE IF NOT EXISTS api_sso_closed_sessions (
    session_id TEXT PRIMARY KEY,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS api_sso_login_requests (
    id TEXT PRIMARY KEY,session_id TEXT NOT NULL,client_id TEXT NOT NULL,
    state TEXT NOT NULL,challenge TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS central_sso_status (
    session_id TEXT PRIMARY KEY, generation TEXT NOT NULL,
    status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    reason TEXT, email TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
  )`);
  await pool.query(`ALTER TABLE central_sso_status
    ADD COLUMN IF NOT EXISTS user_id BIGINT,
    ADD COLUMN IF NOT EXISTS access_token TEXT,
    ADD COLUMN IF NOT EXISTS token_jti TEXT`);
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL CHECK(email=lower(email)),password_hash TEXT NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT false,enabled BOOLEAN NOT NULL DEFAULT true,
    allow_a BOOLEAN NOT NULL DEFAULT false,allow_b BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`ALTER TABLE users
    ADD COLUMN IF NOT EXISTS allow_a_write BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS allow_a_delete BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS allow_b_write BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS allow_b_delete BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,actor_id BIGINT,action TEXT NOT NULL,email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(
    `INSERT INTO users(username,email,password_hash,is_admin,allow_a,allow_b)
    VALUES('admin','admin@example.com',$1,true,true,true) ON CONFLICT(username) DO NOTHING`,
    [await bcrypt.hash("admin-c", 12)],
  );
}
module.exports = { pool, initializeDatabase };
