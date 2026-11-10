const crypto = require("node:crypto");

function csrfToken(req) {
  req.session.csrf ||= crypto.randomBytes(32).toString("hex");
  return req.session.csrf;
}

function checkCsrf(req, res, next) {
  const expected = Buffer.from(req.session.csrf || "");
  const actual = Buffer.from(typeof req.body.csrf === "string" ? req.body.csrf : "");

  if (
    !expected.length ||
    expected.length !== actual.length ||
    !crypto.timingSafeEqual(expected, actual)
  ) {
    return res.status(403).send("Invalid form. Please reload.");
  }

  next();
}

module.exports = { csrfToken, checkCsrf };
