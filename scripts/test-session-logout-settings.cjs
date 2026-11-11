// Real native Sessions UI. Restores settings and removes its temporary permission-test user.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const { chromium } = require("playwright-core");
const base = "http://localhost:8080",
  realmPath = "/sso-lab";
let bearer, originalRealm, originalUrls, viewerId, context, profile;
const results = [];
async function login(username = "admin", password = "admin-local-demo") {
  const r = await fetch(base + "/realms/master/protocol/openid-connect/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username,
      password,
    }),
  });
  assert.equal(r.status, 200);
  return (await r.json()).access_token;
}
async function request(method, resource, body, token) {
  if (!bearer) bearer = await login();
  const send = () =>
    fetch(base + "/admin/realms" + resource, {
      method,
      headers: { authorization: "Bearer " + (token || bearer), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  let r = await send();
  if (r.status === 401 && !token) {
    bearer = await login();
    r = await send();
  }
  return r;
}
async function admin(method, resource, body) {
  const r = await request(method, resource, body);
  assert.ok(r.ok, method + " " + resource + " failed: " + r.status);
  return r.status === 204 ? null : r.json();
}
async function eventually(check) {
  for (let n = 0; n < 60; n++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error("Settings did not reach expected state");
}
function pass(message) {
  results.push(message);
  console.log("PASS " + message);
}
async function verifyConfiguredLogout(browser) {
  const saved = await admin("GET", realmPath);
  const notifications = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      notifications.push(new URLSearchParams(body).get("logout_token"));
      res.writeHead(200, { Connection: "close" });
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  let apps;
  try {
    const urls = [
      ...new Set([
        ...JSON.parse(saved.attributes["temporary.sso.logout-urls"]).filter(
          (url) => url !== "http://app-b:4001/logout/control",
        ),
        "http://app-a:4001/logout/control",
        "http://app-control:4003/logout/keycloak",
        "http://host.docker.internal:" + server.address().port + "/logout",
      ]),
    ];
    await admin("PUT", realmPath, {
      attributes: { ...saved.attributes, "temporary.sso.logout-urls": JSON.stringify(urls) },
    });
    apps = await browser.newContext();
    async function sso(port) {
      const page = await apps.newPage();
      page.setDefaultTimeout(20000);
      await page.goto("http://localhost:" + port + "/sso");
      await page.waitForURL(
        (url) => url.port === "4003" || url.href === "http://localhost:" + port + "/",
      );
      if (await page.locator("[name=login]").count()) {
        await page.locator("[name=login]").fill("admin");
        await page.locator("[name=password]").fill("admin-c");
        await page.locator("button[type=submit]").click();
      }
      await page.waitForURL("http://localhost:" + port + "/");
      assert.match(await page.locator("body").innerText(), /CENTRAL SSO/);
      return page;
    }
    const a = await sso(4001),
      b = await sso(4002);
    const control = await apps.newPage();
    await control.goto("http://localhost:4003/");
    await control.locator('form[action="/logout"] button').click();
    await control.waitForURL("http://localhost:4003/login");
    await a.waitForURL(/4001\/login/);
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(new URL(b.url()).pathname, "/", "Removed B URL still received immediate logout");
    assert.match(await b.locator("body").innerText(), /CENTRAL SSO/);
    assert.equal(notifications.length, 1);
    const [header, body, signature] = notifications[0].split(".");
    const claims = JSON.parse(Buffer.from(body, "base64url"));
    const jwks = await (await fetch("http://localhost:4003/oidc/jwks")).json();
    const kid = JSON.parse(Buffer.from(header, "base64url")).kid;
    const key = crypto.createPublicKey({
      key: jwks.keys.find((key) => key.kid === kid),
      format: "jwk",
    });
    assert.ok(
      crypto.verify(
        "RSA-SHA256",
        Buffer.from(header + "." + body),
        key,
        Buffer.from(signature, "base64url"),
      ),
    );
    assert.equal(claims.token_use, "control_logout");
    assert.ok([].concat(claims.aud).includes(saved.attributes["temporary.sso.audience"]));
    assert.equal((await apps.request.get("http://localhost:4002/session/heartbeat")).status(), 401);
    await b.reload();
    await b.waitForURL(/4002\/login/);
    pass(
      "C logout follows Keycloak URLs: selected A and an extra endpoint receive signed notifications; removed B stays open until its heartbeat detects revocation",
    );
  } finally {
    if (apps) await apps.close();
    await admin("PUT", realmPath, { attributes: saved.attributes });
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

(async () => {
  try {
    originalRealm = await admin("GET", realmPath);
    originalUrls = (await admin("GET", realmPath + "/sso-session-settings")).logoutUrls;
    const endpoint = base + "/admin/realms" + realmPath + "/sso-session-settings";
    assert.equal((await fetch(endpoint)).status, 401);
    const viewer = "logout-viewer-" + crypto.randomBytes(4).toString("hex");
    const created = await request("POST", "/master/users", {
      username: viewer,
      email: viewer + "@example.test",
      firstName: "Viewer",
      lastName: "Test",
      enabled: true,
      emailVerified: true,
      credentials: [{ type: "password", value: "logout-viewer-demo-pass", temporary: false }],
    });
    assert.equal(created.status, 201);
    viewerId = created.headers.get("location").split("/").at(-1);
    const viewerToken = await login(viewer, "logout-viewer-demo-pass");
    assert.equal(
      (await request("GET", realmPath + "/sso-session-settings", undefined, viewerToken)).status,
      403,
    );
    assert.equal(
      (await request("PUT", realmPath + "/sso-session-settings", {}, viewerToken)).status,
      403,
    );
    pass("Sessions logout settings reject anonymous and unauthorized callers");
    assert.equal(
      (
        await request("PUT", realmPath + "/sso-session-settings", {
          sessionSettings: { ssoSessionIdleTimeout: originalRealm.ssoSessionIdleTimeout + 60 },
          logoutUrls: [...originalUrls, "javascript:invalid"],
        })
      ).status,
      400,
    );
    assert.equal(
      (await admin("GET", realmPath)).ssoSessionIdleTimeout,
      originalRealm.ssoSessionIdleTimeout,
    );
    assert.deepEqual(
      (await admin("GET", realmPath + "/sso-session-settings")).logoutUrls,
      originalUrls,
    );
    assert.equal(
      (
        await request("PUT", realmPath + "/sso-session-settings", {
          sessionSettings: {},
          logoutUrls: ["http://example.test/logout", "http://example.test/logout"],
        })
      ).status,
      400,
    );
    pass("Invalid and duplicate URLs cannot partially update session settings or the logout list");
    fs.mkdirSync("scripts/.test-artifacts", { recursive: true });
    profile = fs.mkdtempSync(path.join(process.cwd(), "scripts/.test-artifacts/logout-settings-"));
    context = await chromium.launchPersistentContext(profile, {
      executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      headless: true,
      viewport: { width: 1550, height: 1050 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(base + "/admin/master/console/#/sso-lab/realm-settings/sessions");
    await page.locator("#username").fill("admin");
    await page.locator("#password").fill("admin-local-demo");
    await page.locator("#kc-login").click();
    await page.getByTestId("session-logout-settings").waitFor();
    assert.equal(await page.getByRole("button", { name: "Save", exact: true }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "Revert", exact: true }).count(), 1);
    assert.equal(await page.getByRole("textbox", { name: /^Client ID/ }).count(), 0);
    const count = originalUrls.length,
      extraUrl =
        "http://app-a:4001/logout/control?dynamic-target=" + crypto.randomBytes(3).toString("hex");
    const urlInput = (n) => page.getByRole("textbox", { name: "Logout URL " + n, exact: true });
    const add = page.getByRole("button", { name: "Add logout target", exact: true });
    const idle = page.getByTestId("sso-session-idle-input"),
      beforeIdle = await idle.inputValue();
    await add.click();
    await urlInput(count + 1).fill(extraUrl);
    await idle.fill(String(Number(beforeIdle) + 1));
    await page.getByRole("button", { name: "Revert", exact: true }).click();
    await eventually(
      async () =>
        (await idle.inputValue()) === beforeIdle && (await urlInput(count + 1).count()) === 0,
    );
    await add.click();
    await urlInput(count + 1).fill(extraUrl);
    await idle.fill(String(Number(beforeIdle) + 1));
    let saving = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url() === endpoint,
    );
    await page.getByTestId("sessions-tab-save").click();
    assert.equal((await saving).status(), 204);
    assert.deepEqual((await admin("GET", realmPath + "/sso-session-settings")).logoutUrls, [
      ...originalUrls,
      extraUrl,
    ]);
    assert.notEqual(
      (await admin("GET", realmPath)).ssoSessionIdleTimeout,
      originalRealm.ssoSessionIdleTimeout,
    );
    assert.equal(
      (await admin("GET", realmPath)).ssoSessionMaxLifespan,
      originalRealm.ssoSessionMaxLifespan,
    );
    await page.reload();
    await urlInput(count + 1).waitFor();
    assert.equal(await urlInput(count + 1).inputValue(), extraUrl);
    pass(
      "Add URL supports an extra endpoint without any Client ID; shared native Save/Revert handles session values and dynamic rows with persistence",
    );
    await page.getByRole("button", { name: "Remove target " + (count + 1), exact: true }).click();
    saving = page.waitForResponse((r) => r.request().method() === "PUT" && r.url() === endpoint);
    await page.getByTestId("sessions-tab-save").click();
    assert.equal((await saving).status(), 204);
    assert.deepEqual(
      (await admin("GET", realmPath + "/sso-session-settings")).logoutUrls,
      originalUrls,
    );
    pass("Remove deletes only the selected URL from the realm logout list");
    await page.getByRole("tab", { name: "Tokens", exact: true }).click();
    const lifespan = page.getByTestId("access-token-lifespan-input");
    await lifespan.fill(String(Number(await lifespan.inputValue()) + 1));
    const nativeSave = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().endsWith("/sso-lab/ui-ext"),
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const nativeResult = await nativeSave;
    assert.ok(nativeResult.ok());
    assert.equal(Object.hasOwn(nativeResult.request().postDataJSON(), "logoutTargets"), false);
    pass(
      "Other native realm tabs keep their original save API and receive no Logout helper fields",
    );
    await admin("PUT", realmPath, {
      ssoSessionIdleTimeout: originalRealm.ssoSessionIdleTimeout,
      accessTokenLifespan: originalRealm.accessTokenLifespan,
    });
    await page.goto(base + "/admin/master/console/#/sso-lab/realm-settings/sessions");
    await page.reload();
    await page.getByTestId("session-logout-settings").waitFor();
    await page.locator(".kc-logout-settings-template").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "docs/keycloak/images/session-logout-settings.png",
      fullPage: true,
    });
    await verifyConfiguredLogout(context.browser());
    fs.writeFileSync(
      "docs/keycloak/SESSION-LOGOUT-TEST-RESULTS.json",
      JSON.stringify(
        {
          testedAt: new Date().toISOString(),
          mode: "real Keycloak Sessions form + URL-only logout configuration",
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
    if (viewerId)
      await admin("DELETE", "/master/users/" + viewerId).catch(() => {
        process.exitCode = 1;
      });
    if (originalRealm)
      await admin("PUT", realmPath, {
        attributes: originalRealm.attributes,
        ssoSessionIdleTimeout: originalRealm.ssoSessionIdleTimeout,
        accessTokenLifespan: originalRealm.accessTokenLifespan,
      }).catch(() => {
        process.exitCode = 1;
      });
    if (context) await context.close();
    if (profile) fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
