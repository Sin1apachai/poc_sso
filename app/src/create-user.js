const { pool } = require("./db/database");
const bcrypt = require("bcryptjs");
(async () => {
  const email = (process.argv[2] || "").trim().toLowerCase();
  let password = "";
  for await (const chunk of process.stdin) {
    password += chunk;
  }
  password = password.replace(/\r?\n$/, "");
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    password.length < 8 ||
    Buffer.byteLength(password) > 72
  ) {
    throw new Error("Valid email and password of 8+ characters (max 72 bytes) required");
  }

  try {
    await pool.query("INSERT INTO users(email,password_hash) VALUES($1,$2)", [
      email,
      await bcrypt.hash(password, 12),
    ]);
    console.log("User created:", email);
  } finally {
    await pool.end();
  }
})().catch((e) => {
  console.error(e.code === "23505" ? "Email already exists" : e.message);
  process.exit(1);
});
