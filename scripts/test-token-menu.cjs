// Real Admin Console + real A/B/C. No token or credentials are written to the report.
const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const base = "http://localhost:8080";
const endpoint = base + "/admin/realms/sso-lab/temporary-sso-tokens";
const results = [];
let browser, bearer, fixtureId, originalLifespan;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function pass(message) {
  results.push(message);
  console.log("PASS " + message);
}
async function post(url, data) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data),
    redirect: "manual",
  });
}
async function loginToken(username, password) {
  const r = await post(base + "/realms/master/protocol/openid-connect/token", {
    client_id: "admin-cli",
    grant_type: "password",
    username,
    password,
  });
  assert.equal(r.status, 200);
  return (await r.json()).access_token;
}
async function admin(method, path, body) {
  const r = await fetch(base + "/admin/realms/" + path, {
    method,
    headers: { authorization: "Bearer " + bearer, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.ok(r.ok, "Admin request failed " + r.status);
  return r;
}
async function list(query = "", token = bearer) {
  const response = await fetch(endpoint + query, { headers: { authorization: "Bearer " + token } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  return response.json();
}
async function sso(context, port) {
  const page = await context.newPage();
  await page.goto(`http://localhost:${port}/sso`);
  await page.waitForURL((url) => url.port === "4003" || url.href === `http://localhost:${port}/`);
  if (await page.locator("[name=login]").count()) {
    await page.locator("[name=login]").fill("admin");
    await page.locator("[name=password]").fill("admin-c");
    await page.locator("button[type=submit]").click();
  }
  await page.waitForURL(`http://localhost:${port}/`);
  return page;
}
(async () => {
  try {
    bearer = await loginToken("admin", "admin-local-demo");
    assert.equal((await fetch(endpoint)).status, 401);
    const username = "menu-viewer-" + crypto.randomBytes(5).toString("hex");
    const created = await admin("POST", "master/users", {
      username,
      email: username + "@example.test",
      firstName: "Menu",
      lastName: "Viewer",
      emailVerified: true,
      enabled: true,
      credentials: [{ type: "password", value: "menu-viewer-demo-pass", temporary: false }],
    });
    fixtureId = created.headers.get("location").split("/").at(-1);
    const unprivileged = await loginToken(username, "menu-viewer-demo-pass");
    assert.equal(
      (await fetch(endpoint, { headers: { authorization: "Bearer " + unprivileged } })).status,
      403,
    );
    pass(
      "Token metadata API rejects anonymous requests and authenticated users without realm-admin",
    );
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      headless: true,
    });
    const apps = await browser.newContext();
    apps.setDefaultTimeout(20000);
    const captured = [];
    apps.on("request", (r) => {
      if (r.url().endsWith("/sso/callback") && r.method() === "POST")
        captured.push(Object.fromEntries(new URLSearchParams(r.postData())));
    });
    await sso(apps, 4001);
    await sso(apps, 4002);
    const tokens = captured.map((form) =>
      JSON.parse(Buffer.from(form.access_token.split(".")[1], "base64url")),
    );
    assert.equal(tokens.length, 2);
    assert.equal(
      captured[0].access_token,
      captured[1].access_token,
      "A/B must receive one shared JWT",
    );
    assert.equal(tokens[0].jti, tokens[1].jti);
    assert.equal((await list("?search=" + tokens[0].sub)).total, 1);
    const data = await list();
    for (const token of tokens) {
      const item = data.items.find((row) => row.id === token.jti);
      assert.ok(item);
      assert.equal(item.email, "admin@example.com");
      assert.equal(item.clientId, token.azp);
      assert.equal(item.expiresAt, token.exp);
      assert.equal(item.issuedAt, token.iat);
      assert.equal(item.status, "active");
      assert.deepEqual(
        item.permissions,
        Object.entries(token.app_permissions).flatMap(([app, actions]) =>
          actions.map((action) => app + ":" + action),
        ),
      );
    }
    assert.ok(
      data.items.every(
        (item) =>
          Object.keys(item).sort().join(",") ===
          "clientId,email,expiresAt,id,issuedAt,permissions,status,sub",
      ),
    );
    const filtered = await list("?client=app-b&search=" + tokens[1].jti);
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0].id, tokens[1].jti);
    const page1 = await list("?max=1");
    assert.equal(page1.items.length, 1);
    assert.ok((await list("?first=1&max=1")).items.every((row) => row.id !== page1.items[0].id));
    assert.equal(
      (await fetch(endpoint + "?max=1000", { headers: { authorization: "Bearer " + bearer } }))
        .status,
      400,
    );
    assert.equal((await admin("GET", "sso-lab/users/count")).status, 200);
    assert.equal(await (await admin("GET", "sso-lab/users/count")).json(), 0);
    pass(
      "One shared C/A/B token appears with correct metadata; filter/pagination work; response has no raw JWT and realm users remain zero",
    );
    const ui = await browser.newContext();
    const page = await ui.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(base + "/admin/master/console/#/sso-lab/realm-settings/tokens");
    await page.locator("#username").fill("admin");
    await page.locator("#password").fill("admin-local-demo");
    await page.locator("#kc-login").click();
    await page.getByRole("link", { name: "SSO Tokens", exact: true }).click();
    await page.locator('[data-testid="temporary-token-page"]').waitFor();
    await page.locator(`[data-token-id="${tokens[0].jti}"]`).waitFor();
    await page.locator(`[data-token-id="${tokens[1].jti}"]`).waitFor();
    await page.getByLabel("กรองตามระบบ").selectOption("app-b");
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("tbody tr[data-token-id]")].every((row) =>
          row.textContent.includes("app-b"),
        ) && document.querySelectorAll("tbody tr[data-token-id]").length > 0,
    );
    await page.getByLabel("ค้นหา token").fill(tokens[1].jti);
    await page.getByRole("button", { name: "ค้นหา", exact: true }).click();
    await page
      .locator('[data-testid="temporary-token-count"]')
      .filter({ hasText: "Active tokens: 1" })
      .waitFor();
    await page.getByLabel("ค้นหา token").fill("");
    await page.getByRole("button", { name: "ค้นหา", exact: true }).click();
    await page.getByLabel("กรองตามระบบ").selectOption("");
    await page.locator(`[data-token-id="${tokens[0].jti}"]`).waitFor();
    await page.screenshot({ path: "docs/keycloak/images/token-menu.png", fullPage: true });
    pass(
      "Native SSO Tokens navigation opens the real table; client filter and search work in Admin Console",
    );
    await page.getByRole("link", { name: "Clients", exact: true }).click();
    await page.getByRole("link", { name: "app-a", exact: true }).waitFor();
    await page.getByRole("link", { name: "SSO Tokens", exact: true }).click();
    await page.locator('[data-testid="temporary-token-page"]').waitFor();
    pass("Existing Clients screen still works after adding the custom menu");
    // Use the actual C logout, then refresh the console to verify removal from the live cache.
    const control = await apps.newPage();
    await control.goto("http://localhost:4003/");
    await control.locator('form[action="/logout"] button').click();
    await control.waitForURL("http://localhost:4003/login");
    await page.getByRole("button", { name: "รีเฟรช", exact: true }).click();
    await page.waitForFunction(
      (ids) => ids.every((id) => !document.querySelector(`[data-token-id="${id}"]`)),
      tokens.map((token) => token.jti),
    );
    const after = await list();
    assert.ok(tokens.every((token) => !after.items.some((row) => row.id === token.jti)));
    pass(
      "Logout C removes the shared C/A/B token from the menu without creating permanent history",
    );
    originalLifespan = await (await admin("GET", "sso-lab")).json();
    await admin("PUT", "sso-lab", { accessTokenLifespan: 8 });
    await sso(apps, 4001);
    const expiring = JSON.parse(
      Buffer.from(captured.at(-1).access_token.split(".")[1], "base64url"),
    );
    assert.ok((await list()).items.some((row) => row.id === expiring.jti));
    await page.getByRole("button", { name: "รีเฟรช", exact: true }).click();
    await page.locator(`[data-token-id="${expiring.jti}"]`).waitFor();
    await pause(Math.max(0, expiring.exp * 1000 - Date.now()) + 1500);
    await page.getByRole("button", { name: "รีเฟรช", exact: true }).click();
    await page.locator(`[data-token-id="${expiring.jti}"]`).waitFor({ state: "detached" });
    assert.equal((await list("?search=" + expiring.jti)).total, 0);
    const cStateAfterExpiry = await (
      await apps.request.get("http://localhost:4003/sso/status")
    ).json();
    assert.equal(cStateAfterExpiry.tokenIssued, false);
    assert.equal(cStateAfterExpiry.reason, "expired");
    pass(
      "A token disappears from the API and Admin Console after real expiry; cache does not become a permanent issuance history",
    );

    fs.writeFileSync(
      "docs/keycloak/TOKEN-MENU-TEST-RESULTS.json",
      JSON.stringify(
        {
          testedAt: new Date().toISOString(),
          keycloak: "26.8.1",
          mode: "real Admin Console + A/B/C",
          tests: results,
        },
        null,
        2,
      ) + "\n",
    );
  } catch (e) {
    console.error(e.stack);
    process.exitCode = 1;
  } finally {
    if (originalLifespan) {
      try {
        bearer = await loginToken("admin", "admin-local-demo");
        await admin("PUT", "sso-lab", {
          accessTokenLifespan: originalLifespan.accessTokenLifespan,
        });
      } catch (e) {
        console.error("Failed to restore token lifespan");
        process.exitCode = 1;
      }
    }
    if (fixtureId) {
      try {
        await admin("DELETE", "master/users/" + fixtureId);
      } catch {}
    }
    if (browser) await Promise.race([browser.close(), pause(5000)]);
  }
  process.exit(process.exitCode || 0);
})();
