// Real browser + real IdP outage. Changes only this lab and restores configuration in finally.
const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const base = "http://localhost:8080";
const prefix = "temporary.sso.idp-heartbeat.";
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
  originalClient,
  stopped = false,
  profile;
const results = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function pass(message) {
  results.push(message);
  console.log("PASS " + message);
}
function compose(...args) {
  return execFileSync("docker", ["compose", ...args], { stdio: ["ignore", "pipe", "pipe"] });
}
async function admin(method, resource, body) {
  const response = await fetch(base + "/admin/realms/sso-lab" + resource, {
    method,
    headers: { authorization: "Bearer " + bearer, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  assert.ok(response.ok, "Admin " + method + " failed: " + response.status);
  return response.status === 204 ? null : response.json();
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
(async () => {
  const watchdog = setTimeout(() => {
    console.error("Heartbeat test exceeded its deadline");
    process.exit(2);
  }, 180000);
  try {
    const auth = await fetch(base + "/realms/master/protocol/openid-connect/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "admin-cli",
        username: "admin",
        password: "admin-local-demo",
      }),
    });
    assert.equal(auth.status, 200);
    bearer = (await auth.json()).access_token;
    originalRealm = await admin("GET", "");
    [originalClient] = await admin("GET", "/clients?clientId=" + env.APP_A_KC_CLIENT_ID);
    originalClient = await admin("GET", "/clients/" + originalClient.id);
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
    await settings.getByTestId("idp-heartbeat-settings").waitFor();
    await settings.getByLabel("เปิดใช้งาน IdP heartbeat").check();
    await settings.getByLabel("หน่วยเวลาตรวจ IdP").selectOption("1");
    await settings.getByLabel("รอบตรวจ IdP", { exact: true }).fill("2");
    await settings.getByLabel("จำนวนครั้งที่ตรวจไม่ผ่านติดต่อกันก่อน Global logout").fill("3");
    await Promise.all([
      settings.waitForEvent("load"),
      settings.getByRole("button", { name: "บันทึก IdP heartbeat" }).click(),
    ]);
    await settings.getByTestId("idp-heartbeat-settings").waitFor();
    const saved = await admin("GET", "");
    assert.equal(saved.attributes[prefix + "interval-seconds"], "2");
    assert.equal(saved.attributes[prefix + "failure-threshold"], "3");
    assert.equal(saved.ssoSessionIdleTimeout, originalRealm.ssoSessionIdleTimeout);
    assert.equal(await settings.getByLabel("รอบตรวจ IdP", { exact: true }).inputValue(), "2");
    assert.ok(await settings.getByText("SSO Session Settings", { exact: true }).count());
    pass(
      "Sessions > Logout saves a custom heartbeat interval and failure threshold, survives reload, and preserves native session settings",
    );

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
    await admin("PUT", "/clients/" + originalClient.id, {
      ...originalClient,
      attributes: {
        ...originalClient.attributes,
        "temporary.sso.logout-url": "http://app-a:4001/not-found",
      },
    });
    const missedToken = captured.at(-1).access_token;
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
    await admin("PUT", "/clients/" + originalClient.id, originalClient);
    await pause(4500);
    await a.reload();
    assert.match(await a.locator("body").innerText(), /CENTRAL SSO/);
    pass("A delayed logout retry uses its original cutoff and does not delete a newer SSO login");
    await control.goto("http://localhost:4003/");
    await control.locator('form[action="/logout"] button').click();
    await control.waitForURL("http://localhost:4003/login");
    await admin("PUT", "", { attributes: originalRealm.attributes });
    await settings.reload();
    await settings.getByTestId("idp-heartbeat-settings").waitFor();
    await settings.getByTestId("idp-heartbeat-settings").scrollIntoViewIfNeeded();
    await settings.screenshot({
      path: "docs/keycloak/images/idp-heartbeat-settings.png",
      fullPage: true,
    });
    fs.writeFileSync(
      "docs/keycloak/IDP-HEARTBEAT-TEST-RESULTS.json",
      JSON.stringify(
        {
          testedAt: new Date().toISOString(),
          mode: "real Keycloak scheduler + browser + C container outage",
          tests: results,
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
    if (originalClient) {
      try {
        await admin("PUT", "/clients/" + originalClient.id, originalClient);
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
