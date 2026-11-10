const config = require("../config");
const { checkReadiness } = require("./sso-readiness");
const inFlight = new Map();
function probe(browserId, { silent = false } = {}) {
  const key = browserId + ":" + (silent ? "auto" : "manual");
  if (inFlight.has(key)) {
    return inFlight.get(key).promise;
  }
  const entry = { attempts: 0, maxAttempts: silent ? 1 : 3 };
  entry.promise = checkReadiness({
    url: config.kcInternalUrl + "/.well-known/openid-configuration",
    issuer: config.kcIssuer,
    maxAttempts: entry.maxAttempts,
    onAttempt: async (n) => {
      entry.attempts = n;
    },
  }).finally(() => {
    if (inFlight.get(key) === entry) {
      inFlight.delete(key);
    }
  });
  inFlight.set(key, entry);
  return entry.promise;
}

function probeStatus(browserId) {
  const entry = inFlight.get(browserId + ":manual");
  return { status: entry ? "checking" : "idle", attempts: entry?.attempts || 0, maxAttempts: 3 };
}
module.exports = { probe, probeStatus };
