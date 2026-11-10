const crypto = require("node:crypto");
const config = require("../config");
// Request binding only; no shared login state or cross-app authority.
const cookieName = config.systemId + "_request_browser";
function mac(id) {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET).update(id).digest("hex");
}

function browserIdentity(req, res, next) {
  const cookies = Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim().split(/=(.*)/s))
      .filter((x) => x.length >= 2)
      .map((x) => [x[0], x[1]]),
  );
  let raw = "";
  try {
    raw = decodeURIComponent(cookies[cookieName] || "");
  } catch {}
  const [id, signature] = raw.split(".");
  const valid =
    /^[a-f0-9]{48}$/.test(id || "") &&
    /^[a-f0-9]{64}$/.test(signature || "") &&
    crypto.timingSafeEqual(Buffer.from(mac(id)), Buffer.from(signature));
  req.browserId = valid ? id : crypto.randomBytes(24).toString("hex");
  if (!valid) {
    res.cookie(cookieName, req.browserId + "." + mac(req.browserId), {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 30 * 24 * 3600000,
    });
  }
  if (cookies.sso_lab_browser) {
    res.clearCookie("sso_lab_browser", { httpOnly: true, sameSite: "lax", secure: false });
  }
  next();
}
module.exports = { browserIdentity };
