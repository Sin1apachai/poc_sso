// Real browser + real IdP outage. Changes only this lab and restores configuration in finally.
const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { execFileSync } = require("node:child_process");
const base = "http://localhost:8080";
const prefix = "temporary.sso.idp-heartbeat.";
const providerResource = "/identity-provider/instances/app-control";
const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_0-9]+=/.test(line))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at), line.slice(at + 1)];
    }),
);
let bearer,
  browser,
  ui,
  originalRealm,
  originalProvider,
  stopped = false,
  profile;
const results = [];
const testStartedAt = new Date().toISOString();
let cadenceEvidence;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function pass(message) {
  results.push(message);
  console.log("PASS " + message);
}
function compose(...args) {
  return execFileSync("docker", ["compose", ...args], { stdio: ["ignore", "pipe", "pipe"] });
}
async function signInAdmin() {
  const response = await fetch(base + "/realms/master/protocol/openid-connect/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: "admin",
      password: "admin-local-demo",
    }),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200, "Admin sign-in failed");
  bearer = (await response.json()).access_token;
}
async function admin(method, resource, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(base + "/admin/realms/sso-lab" + resource, {
      method,
      headers: { authorization: "Bearer " + bearer, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 401 && attempt === 0) {
      await signInAdmin();
      continue;
    }
    assert.ok(response.ok, "Admin " + method + " failed: " + response.status);
    return response.status === 204 || response.status === 201 ? null : response.json();
  }
}
async function eventually(check, message, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await pause(250);
  }
  throw Error(message);
}
async function healthyC() {
  try {
    return (await fetch("http://localhost:4003/health", { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}
async function active(token) {
  const response = await fetch(base + "/realms/sso-lab/temporary-sso-poc/introspect", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token,
      client_id: env.APP_A_KC_CLIENT_ID,
      client_secret: env.APP_A_KC_CLIENT_SECRET,
    }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  return (await response.json()).active;
}
async function sso(context, port, captures) {
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url() === `http://localhost:${port}/sso/callback`)
      captures.push(Object.fromEntries(new URLSearchParams(request.postData())));
  });
  await page.goto(`http://localhost:${port}/sso`);
  await page.waitForURL((url) => url.port === "4003" || url.href === `http://localhost:${port}/`);
  if (await page.locator("[name=login]").count()) {
    await page.locator("[name=login]").fill("admin");
    await page.locator("[name=password]").fill("admin-c");
    await page.locator("button[type=submit]").click();
  }
  await page.waitForURL(`http://localhost:${port}/`);
  assert.match(await page.locator("body").innerText(), /CENTRAL SSO/);
  return page;
}
async function restoreC() {
  if (stopped) {
    compose("start", "app-control");
    stopped = false;
  }
  await eventually(healthyC, "C did not recover");
}
async function verifySeparateProbeIntervals() {
  const saved = await admin("GET", "");
  const savedProvider = await admin("GET", providerResource);
  const probes = [];
  const logoutNotifications = [];
  let remainingFailures = 0;
  let failContinuously = false;
  const server = http.createServer((request, response) => {
    if (request.method === "POST" && request.url === "/logout") {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        try {
          const token = new URLSearchParams(body).get("logout_token");
          logoutNotifications.push(JSON.parse(Buffer.from(token.split(".")[1], "base64url")));
        } catch {
          logoutNotifications.push({});
        }
        response.writeHead(200, { Connection: "close" });
        response.end();
      });
      return;
    }
    const failed = failContinuously || remainingFailures > 0;
    if (remainingFailures > 0) remainingFailures--;
    probes.push({ at: Date.now(), status: failed ? 503 : 200 });
    response.writeHead(failed ? 503 : 200, { Connection: "close" });
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", resolve);
  });
  try {
    await admin("PUT", "", {
      attributes: {
        ...saved.attributes,
        "temporary.sso.logout-urls": JSON.stringify([
          ...JSON.parse(saved.attributes["temporary.sso.logout-urls"] || "[]"),
          "http://host.docker.internal:" + server.address().port + "/logout",
        ]),
        [prefix + "enabled"]: "true",
        [prefix + "interval-seconds"]: "4",
        [prefix + "confirmation-interval-seconds"]: "1",
        [prefix + "failure-threshold"]: "3",
        [prefix + "idp-alias"]: savedProvider.alias,
      },
    });
    await admin("PUT", providerResource, {
      ...savedProvider,
      config: {
        ...savedProvider.config,
        ssoHealthCheckUrl: "http://host.docker.internal:" + server.address().port + "/health",
      },
    });
    await eventually(
      async () => probes.length >= 2,
      "No regular heartbeat requests reached the test endpoint",
    );
    assert.ok(
      probes[1].at - probes[0].at >= 3800,
      "Healthy probes must use the normal four-second interval",
    );

    const vars = new Map();
    const environment = {
      project_root: "../..",
      keycloak_url: base,
      realm: "sso-lab",
      control_issuer: "http://localhost:4003/oidc",
      app: "a",
    };
    require("../bruno/keycloak/scripts/prepare-request").prepareRequest(
      {
        cwd: () => path.join(process.cwd(), "bruno/keycloak"),
        getEnvVar: (name) => environment[name],
        setVar: (name, value) => vars.set(name, value),
        getVar: (name) => vars.get(name),
        deleteVar: (name) => vars.delete(name),
      },
      { getUrl: () => base + "/realms/sso-lab/temporary-sso-poc/bootstrap" },
    );
    const issued = await fetch(base + "/realms/sso-lab/temporary-sso-poc/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        assertion: vars.get("assertion"),
        client_id: vars.get("authority_client_id"),
        client_secret: vars.get("authority_client_secret"),
      }),
    });
    assert.equal(issued.status, 200);
    const token = (await issued.json()).access_token;
    assert.equal(await active(token), true);

    const monitorConfiguration = await admin("GET", "");
    await admin("PUT", "", {
      attributes: { ...monitorConfiguration.attributes, [prefix + "enabled"]: "false" },
    });
    await pause(1250);
    failContinuously = true;
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await admin("POST", "/idp-heartbeat/" + savedProvider.alias + "/test");
      assert.equal(result.healthy, false);
      assert.equal(result.httpStatus, 503);
      assert.ok(result.durationMillis >= 0);
    }
    assert.equal(
      await active(token),
      true,
      "Manual tests must not count toward an outage or revoke tokens",
    );
    failContinuously = false;
    const resumeAt = probes.length;
    await admin("PUT", "", { attributes: monitorConfiguration.attributes });
    await eventually(
      async () => probes.length > resumeAt && probes.at(-1).status === 200,
      "Monitoring did not resume",
    );
    pass(
      "Manual IdP heartbeat tests report HTTP failures without changing outage counts or revoking tokens",
    );

    const transientStart = probes.length;
    remainingFailures = 2;
    await eventually(
      async () => probes.length >= transientStart + 4,
      "Confirmation probes did not return to the normal interval",
    );
    const transient = probes.slice(transientStart, transientStart + 4);
    assert.deepEqual(
      transient.map((probe) => probe.status),
      [503, 503, 200, 200],
    );
    const gaps = transient.slice(1).map((probe, index) => probe.at - transient[index].at);
    assert.ok(
      gaps[0] >= 800 && gaps[0] < 3500,
      "First confirmation must use one second, not the normal interval",
    );
    assert.ok(gaps[1] >= 800 && gaps[1] < 3500, "Second confirmation must use one second");
    assert.ok(gaps[2] >= 3800, "A successful confirmation must restore the normal interval");
    assert.equal(
      await active(token),
      true,
      "Two failures followed by success must not revoke a token",
    );

    const outageStart = probes.length;
    failContinuously = true;
    await eventually(
      async () => probes.length >= outageStart + 2,
      "No failed confirmation requests observed",
    );
    assert.equal(
      await active(token),
      true,
      "The first check counts toward three, but two failures must not revoke",
    );
    await eventually(
      async () => probes.length >= outageStart + 3 && !(await active(token)),
      "Three failures must revoke the token",
    );
    await eventually(
      async () => logoutNotifications.length > 0,
      "New logout target did not receive a notification",
    );
    assert.ok([].concat(logoutNotifications[0].aud).includes(env.KC_AUDIENCE));
    assert.equal(logoutNotifications[0].token_use, "idp_logout");
    assert.equal(logoutNotifications[0].idp, savedProvider.alias);
    pass(
      "Keycloak sends IdP logout to an additional URL outside A/B/C without registering a Client ID",
    );
    cadenceEvidence = {
      normalIntervalMs: probes[1].at - probes[0].at,
      confirmationIntervalsMs: gaps.slice(0, 2),
      intervalAfterRecoveryMs: gaps[2],
      failuresRequired: 3,
    };
    pass(
      "Real heartbeat requests use separate normal/confirmation intervals, reset after recovery, and revoke only after three failed checks including the first",
    );
    failContinuously = false;
    await eventually(
      async () => probes.length > outageStart + 3 && probes.at(-1).status === 200,
      "Heartbeat did not recover",
    );
    await pause(250);
  } finally {
    try {
      await admin("PUT", providerResource, savedProvider);
      await admin("PUT", "", { attributes: saved.attributes });
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

(async () => {
  const watchdog = setTimeout(() => {
    console.error("Heartbeat test exceeded its deadline");
    process.exit(2);
  }, 180000);
  try {
    await signInAdmin();
    originalRealm = await admin("GET", "");
    const workingLogoutUrls = [
      ...new Set([
        ...JSON.parse(originalRealm.attributes["temporary.sso.logout-urls"] || "[]"),
        "http://app-a:4001/logout/control",
        "http://app-b:4001/logout/control",
        "http://app-control:4003/logout/keycloak",
      ]),
    ];
    await admin("PUT", "", {
      attributes: {
        ...originalRealm.attributes,
        "temporary.sso.logout-urls": JSON.stringify(workingLogoutUrls),
      },
    });
    originalProvider = await admin("GET", providerResource);
    fs.mkdirSync("scripts/.test-artifacts", { recursive: true });
    profile = fs.mkdtempSync(path.join(process.cwd(), "scripts/.test-artifacts/heartbeat-"));
    ui = await chromium.launchPersistentContext(profile, {
      executablePath:
        process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      headless: true,
      viewport: { width: 1550, height: 1000 },
    });
    browser = ui.browser();
    const settings = await ui.newPage();
    settings.setDefaultTimeout(20000);
    await settings.goto(base + "/admin/master/console/#/sso-lab/realm-settings/sessions");
    await settings.locator("#username").fill("admin");
    await settings.locator("#password").fill("admin-local-demo");
    await settings.locator("#kc-login").click();
    await settings.getByText("SSO Session Settings", { exact: true }).waitFor();
    assert.equal(await settings.getByTestId("idp-heartbeat-settings").count(), 0);
    await settings.getByRole("tab", { name: "Heartbeat", exact: true }).click();
    await settings.getByTestId("idp-heartbeat-settings").waitFor();
    assert.match(settings.url(), /realm-settings\/heartbeat$/);
    assert.equal(
      await settings
        .getByRole("tab", { name: "Heartbeat", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    const providerPage = await ui.newPage();
    await providerPage.goto(
      base +
        "/admin/master/console/#/sso-lab/identity-providers/jwt-authorization-grant/app-control/settings",
    );
    const healthField = providerPage.getByLabel("Health Check URL", { exact: true });
    await healthField.waitFor();
    await healthField.click();
    const changedHealthUrl = "http://app-control:4003/health?idp-settings-test=1";
    await healthField.fill(changedHealthUrl);
    assert.equal(
      await providerPage.getByRole("button", { name: "Test heartbeat", exact: true }).count(),
      0,
    );
    await providerPage.getByRole("button", { name: "Save", exact: true }).click();
    await eventually(
      async () =>
        (await admin("GET", providerResource)).config.ssoHealthCheckUrl === changedHealthUrl,
      "IdP Health Check URL was not saved by the native form",
    );
    await providerPage.reload();
    await healthField.waitFor();
    assert.equal(await healthField.inputValue(), changedHealthUrl);
    const savedProvider = await admin("GET", providerResource);
    assert.equal(savedProvider.config.issuer, originalProvider.config.issuer);
    assert.equal(savedProvider.config.jwksUrl, originalProvider.config.jwksUrl);
    const manualRequest = settings.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/idp-heartbeat/app-control/test"),
    );
    await settings.getByRole("button", { name: "Test heartbeat", exact: true }).click();
    const manualResult = await (await manualRequest).json();
    assert.equal(manualResult.healthy, true);
    assert.equal(manualResult.httpStatus, 200);
    await settings.getByText(/^Heartbeat succeeded \(HTTP 200,/).waitFor();
    assert.equal(
      (
        await fetch(base + "/admin/realms/sso-lab/idp-heartbeat/app-control/test", {
          method: "POST",
        })
      ).status,
      401,
    );

    await healthField.fill(originalProvider.config.ssoHealthCheckUrl);
    await providerPage.getByRole("button", { name: "Save", exact: true }).click();
    await eventually(
      async () =>
        (await admin("GET", providerResource)).config.ssoHealthCheckUrl ===
        originalProvider.config.ssoHealthCheckUrl,
      "Could not restore IdP Health Check URL",
    );
    pass(
      "Health Check URL stays in IdP Settings; the native Realm settings Heartbeat tab tests the selected IdP with English results",
    );
    await settings.reload();
    await settings.getByTestId("idp-heartbeat-settings").waitFor();
    assert.equal(
      await settings.locator("#idpAlias").evaluate((element) => element.tagName),
      "BUTTON",
    );
    assert.equal(await settings.getByLabel("Health Check URL", { exact: true }).count(), 0);
    const threshold = settings
      .getByTestId("idp-heartbeat-settings")
      .locator('input[aria-label="Input"]');
    await threshold.fill("4");
    await settings.getByTestId("heartbeat-revert").click();
    assert.equal(
      await threshold.inputValue(),
      String(originalRealm.attributes[prefix + "failure-threshold"] || 3),
    );
    assert.ok(await settings.getByTestId("heartbeat-save").isDisabled());

    async function setSeconds(name, seconds) {
      const field = settings.getByTestId(name);
      const group = field.locator("xpath=ancestor::div[contains(@class,'pf-v5-c-form__group')][1]");
      await group.getByRole("button", { name: "Select a time unit", exact: true }).click();
      await settings.getByRole("option", { name: "Seconds", exact: true }).click();
      await field.fill(String(seconds));
    }
    await settings.getByLabel("Enable heartbeat", { exact: true }).check();
    await setSeconds("intervalSeconds", 2);
    await threshold.fill("3");
    await setSeconds("confirmationIntervalSeconds", 1);
    await settings.getByRole("button", { name: "4. Target IdP", exact: true }).click();
    await settings.getByRole("option", { name: originalProvider.alias, exact: true }).click();
    await settings.getByTestId("heartbeat-save").click();
    await eventually(
      async () => (await admin("GET", "")).attributes[prefix + "interval-seconds"] === "2",
      "Heartbeat settings were not saved",
    );
    await settings.reload();
    await settings.getByTestId("idp-heartbeat-settings").waitFor();
    assert.equal(
      await settings
        .getByRole("tab", { name: "Heartbeat", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    const saved = await admin("GET", "");
    assert.equal(saved.attributes[prefix + "interval-seconds"], "2");
    assert.equal(saved.attributes[prefix + "failure-threshold"], "3");
    assert.equal(saved.attributes[prefix + "confirmation-interval-seconds"], "1");
    assert.equal(saved.attributes[prefix + "idp-alias"], originalProvider.alias);
    assert.equal(saved.attributes[prefix + "health-url"], undefined);
    assert.equal(await settings.getByTestId("confirmationIntervalSeconds").inputValue(), "1");
    assert.equal(saved.ssoSessionIdleTimeout, originalRealm.ssoSessionIdleTimeout);
    assert.equal(await settings.getByTestId("intervalSeconds").inputValue(), "2");
    assert.equal(await settings.getByText("SSO Session Settings", { exact: true }).count(), 0);
    await settings.getByRole("tab", { name: "Sessions", exact: true }).click();
    await settings.getByText("SSO Session Settings", { exact: true }).waitFor();
    assert.equal(await settings.getByTestId("idp-heartbeat-settings").count(), 0);
    await settings.getByRole("tab", { name: "Heartbeat", exact: true }).click();
    await settings.getByTestId("idp-heartbeat-settings").waitFor();
    assert.equal(await settings.getByTestId("intervalSeconds").inputValue(), "2");
    pass(
      "Native Heartbeat tab uses Keycloak controls, saves all settings, supports Revert/reload/tab navigation, and preserves native Sessions",
    );

    await verifySeparateProbeIntervals();

    const apps = await browser.newContext();
    const captured = [];
    let a = await sso(apps, 4001, captured),
      b = await sso(apps, 4002, captured);
    const oldToken = captured.at(-1).access_token;
    const local = await browser.newContext();
    const localPage = await local.newPage();
    await localPage.goto("http://localhost:4001/login/local");
    await localPage.locator("[name=email]").fill("admin@example.com");
    await localPage.locator("[name=password]").fill("admin-a-demo");
    await localPage.locator("button[type=submit]").click();
    await localPage.waitForURL("http://localhost:4001/");
    assert.equal(await active(oldToken), true);
    const started = Date.now();
    compose("kill", "-s", "SIGKILL", "app-control");
    stopped = true;
    if (Date.now() - started < 1500)
      assert.equal(
        await active(oldToken),
        true,
        "One failed check must not satisfy a threshold of three",
      );
    await a.waitForURL(/4001\/login/);
    await b.waitForURL(/4002\/login/);
    assert.equal(await active(oldToken), false);
    assert.ok((await fetch(base + "/realms/sso-lab/temporary-sso-poc/status")).ok);
    await localPage.reload();
    assert.match(await localPage.locator("body").innerText(), /LOCAL LOGIN/);
    pass(
      "Stopping C automatically revokes central tokens and pushes A/B to Login through Keycloak, while independent local A stays logged in",
    );
    const forged = await apps.request.post("http://localhost:4001/logout/control", {
      form: { logout_token: oldToken },
    });
    assert.equal(forged.status(), 400);
    pass("A central access token cannot be reused as a Keycloak global-logout notification");

    await restoreC();
    const control = await apps.newPage();
    await control.goto("http://localhost:4003/");
    await eventually(
      async () =>
        !(await (await apps.request.get("http://localhost:4003/sso/status")).json()).tokenIssued,
      "C retained a revoked central-token status",
    );
    await control.reload();
    await control.locator("#sso-modal[open] button").click();
    await control.locator("#sso-retry").click();
    await eventually(
      async () =>
        (await (await apps.request.get("http://localhost:4003/sso/status")).json()).tokenIssued,
      "C could not establish a fresh SSO token after recovery",
    );
    a = await sso(apps, 4001, captured);
    b = await sso(apps, 4002, captured);
    assert.notEqual(captured.at(-1).access_token, oldToken);
    pass(
      "C recovery clears its old central-token status, permits a fresh token, and allows explicit SSO to A/B again",
    );

    // Simulate a missed notification without removing non-IdP heartbeat protection.
    const beforeMissed = await admin("GET", "");
    await admin("PUT", "", {
      attributes: {
        ...beforeMissed.attributes,
        "temporary.sso.logout-urls": JSON.stringify(
          JSON.parse(beforeMissed.attributes["temporary.sso.logout-urls"]).map((url) =>
            url === "http://app-a:4001/logout/control" ? "http://app-a:4001/not-found" : url,
          ),
        ),
      },
    });
    const missedToken = captured.at(-1).access_token;
    const outageFloor = Date.now();
    compose("kill", "-s", "SIGKILL", "app-control");
    stopped = true;
    await b.waitForURL(/4002\/login/);
    assert.equal(await active(missedToken), false);
    assert.equal(new URL(a.url()).pathname, "/");
    const heartbeat = await apps.request.get("http://localhost:4001/session/heartbeat");
    assert.equal(heartbeat.status(), 401);
    await a.reload();
    await a.waitForURL(/4001\/login/);
    pass(
      "When A misses the push, its existing heartbeat checks the revoked token at Keycloak and removes the SSO session",
    );
    await restoreC();
    await control.reload();
    await eventually(
      async () =>
        !(await (await apps.request.get("http://localhost:4003/sso/status")).json()).tokenIssued,
      "Recovery notification not applied",
    );
    await control.reload();
    await control.locator("#sso-modal[open] button").click();
    await control.locator("#sso-retry").click();
    await eventually(
      async () =>
        (await (await apps.request.get("http://localhost:4003/sso/status")).json()).tokenIssued,
      "Fresh SSO not ready",
    );
    a = await sso(apps, 4001, captured);
    const beforeRestore = await admin("GET", "");
    await admin("PUT", "", {
      attributes: {
        ...beforeRestore.attributes,
        "temporary.sso.logout-urls": JSON.stringify(workingLogoutUrls),
      },
    });
    await eventually(async () => {
      const output = compose(
        "exec",
        "-T",
        "app-a",
        "node",
        "-e",
        `
        const { Pool } = require("pg");
        const pool = new Pool({ host: process.env.DB_HOST, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
        pool.query("SELECT COALESCE(MAX(revoked_before),0)::text AS cutoff FROM sso_idp_logout_fences WHERE idp=$1", [process.env.KC_IDP_ALIAS])
          .then(result => console.log(JSON.stringify(result.rows[0]))).finally(() => pool.end());
      `,
      );
      return Number(JSON.parse(output.toString()).cutoff) >= outageFloor;
    }, "The edited logout URL did not receive the pending notification");
    await pause(500);
    await a.reload();
    assert.match(await a.locator("body").innerText(), /CENTRAL SSO/);
    pass("A delayed logout retry uses its original cutoff and does not delete a newer SSO login");
    await control.goto("http://localhost:4003/");
    await control.locator('form[action="/logout"] button').click();
    await control.waitForURL("http://localhost:4003/login");
    const heartbeatLogs = compose(
      "logs",
      "--since",
      testStartedAt,
      "--no-log-prefix",
      "app-control",
    ).toString();
    const entries = heartbeatLogs
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line));
    assert.ok(
      entries.some(
        (entry) =>
          entry.event === "idp_heartbeat" && entry.source === "manual" && entry.status === 200,
      ),
      "Missing manual heartbeat log at C",
    );
    assert.ok(
      entries.some(
        (entry) =>
          entry.event === "idp_heartbeat" && entry.source === "scheduled" && entry.status === 200,
      ),
      "Missing scheduled heartbeat log at C",
    );
    pass("App C logs both manual and scheduled Keycloak heartbeat requests");

    const keycloakLogs = compose(
      "logs",
      "--since",
      testStartedAt,
      "--no-log-prefix",
      "--no-color",
      "keycloak",
    ).toString();
    const checks = keycloakLogs
      .split("\n")
      .flatMap((line) => {
        const start = line.indexOf('{"timestamp":');
        if (start < 0) return [];
        try {
          return [JSON.parse(line.slice(start))];
        } catch {
          return [];
        }
      })
      .filter((entry) => entry.event === "idp_heartbeat_check");
    assert.ok(checks.some((entry) => entry.source === "manual" && entry.healthy === true));
    assert.ok(checks.some((entry) => entry.source === "manual" && entry.healthy === false));
    assert.ok(checks.some((entry) => entry.source === "scheduled" && entry.healthy === true));
    assert.ok(
      checks.some(
        (entry) =>
          entry.source === "scheduled" &&
          entry.healthy === false &&
          entry.failureCount === entry.failureThreshold &&
          entry.down === true,
      ),
    );
    assert.ok(
      checks.every(
        (entry) =>
          Number.isFinite(Date.parse(entry.timestamp)) &&
          entry.from === "keycloak" &&
          entry.to === env.KC_IDP_ALIAS,
      ),
    );
    assert.ok(!/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(JSON.stringify(checks)));
    pass(
      "Keycloak logs each manual and scheduled IdP probe with timestamps, failure counts, threshold and recovery results",
    );

    await admin("PUT", "", { attributes: originalRealm.attributes });
    await settings.reload();
    await settings.getByTestId("idp-heartbeat-settings").waitFor();
    await settings.getByTestId("idp-heartbeat-settings").scrollIntoViewIfNeeded();
    await settings.getByRole("tab", { name: "Heartbeat", exact: true }).scrollIntoViewIfNeeded();
    await settings.screenshot({
      path: "docs/keycloak/images/idp-heartbeat-settings.png",
      fullPage: true,
    });
    await providerPage.setViewportSize({ width: 1550, height: 1250 });
    await providerPage.reload();
    await healthField.waitFor();
    await healthField.scrollIntoViewIfNeeded();
    await providerPage.screenshot({
      path: "docs/keycloak/images/idp-health-url-settings.png",
      fullPage: true,
    });
    fs.writeFileSync(
      "docs/keycloak/IDP-HEARTBEAT-TEST-RESULTS.json",
      JSON.stringify(
        {
          testedAt: new Date().toISOString(),
          mode: "real Keycloak scheduler + browser + C container outage",
          tests: results,
          cadenceEvidence,
        },
        null,
        2,
      ) + "\n",
    );
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    try {
      await restoreC();
    } catch {
      process.exitCode = 1;
    }
    if (originalProvider) {
      try {
        await admin("PUT", providerResource, originalProvider);
      } catch {
        process.exitCode = 1;
      }
    }
    if (originalRealm) {
      try {
        await admin("PUT", "", { attributes: originalRealm.attributes });
      } catch {
        process.exitCode = 1;
      }
    }
    if (ui) await Promise.race([ui.close(), pause(4000)]);
    if (browser) await Promise.race([browser.close(), pause(4000)]);
    if (profile) fs.rmSync(profile, { recursive: true, force: true });
    clearTimeout(watchdog);
  }
  process.exit(process.exitCode || 0);
})();
