const config = require("../config");

// Callers supply only fixed metadata; never pass a request body, JWT, cookie or secret.
function logHeartbeat(event, fields) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      system: config.systemId,
      ...fields,
    }),
  );
}
function elapsedMs(started) {
  return Number((process.hrtime.bigint() - started) / 1000000n);
}
function observeHeartbeat(req, res, next) {
  const started = process.hrtime.bigint();
  const mode = req.session.sso ? "sso" : req.session.local ? "local" : "anonymous";
  res.once("finish", () =>
    logHeartbeat("session_heartbeat", {
      from: "browser",
      to: config.systemId,
      method: req.method,
      path: req.path,
      mode,
      status: res.statusCode,
      reason: res.locals.heartbeatReason || null,
      durationMs: elapsedMs(started),
    }),
  );
  next();
}
module.exports = { logHeartbeat, elapsedMs, observeHeartbeat };
