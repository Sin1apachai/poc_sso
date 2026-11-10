const crypto = require("node:crypto");

function csrfToken(req) {
  req.session.csrf ||= crypto.randomBytes(32).toString("hex");
  return req.session.csrf;
}

function validCsrf(req) {
  const expected = Buffer.from(req.session.csrf || "");
  const actual = Buffer.from(typeof req.body.csrf === "string" ? req.body.csrf : "");

  return (
    expected.length > 0 &&
    expected.length === actual.length &&
    crypto.timingSafeEqual(expected, actual)
  );
}

function checkCsrf(req, res, next) {
  if (!validCsrf(req)) {
    return res.status(403).send("Invalid form. Please reload.");
  }
  next();
}

// Reject the stale POST without starting SSO; recover with a fresh dashboard GET.
function checkSsoCsrf(req, res, next) {
  if (!validCsrf(req)) {
    return res.redirect(303, "/");
  }
  next();
}
module.exports = { csrfToken, checkCsrf, checkSsoCsrf };
