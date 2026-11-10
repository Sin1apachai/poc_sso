const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
function tokenOf(service, email) {
  const code =
    "const{pool}=require('./src/db/database');pool.query(`SELECT sess->'sso'->>'accessToken' AS token FROM session WHERE sess->'sso'->>'email'=$1 ORDER BY expire DESC LIMIT 1`,[process.argv[1]]).then(r=>console.log(r.rows[0]?.token||'')).finally(()=>pool.end());";
  return execFileSync("docker", ["compose", "exec", "-T", service, "node", "-e", code, email])
    .toString()
    .trim();
}
function active(service, token) {
  const code =
    "(async()=>{const token=JSON.parse(require('fs').readFileSync(0,'utf8'));const r=await fetch(process.env.KC_INTERNAL_URL+'/protocol/openid-connect/token/introspect',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token,client_id:process.env.KC_CLIENT_ID,client_secret:process.env.KC_CLIENT_SECRET})});console.log((await r.json()).active===true);})().catch(()=>process.exitCode=1);";
  return (
    execFileSync("docker", ["compose", "exec", "-T", service, "node", "-e", code], {
      input: JSON.stringify(token),
    })
      .toString()
      .trim() === "true"
  );
}
(async () => {
  const b = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  try {
    const ctx = await b.newContext();
    let kcBrowser = 0,
      oldOidc = 0;
    ctx.on("request", (r) => {
      const u = new URL(r.url());
      if (u.port === "8080") kcBrowser++;
      if (u.port === "4003" && u.pathname.startsWith("/oidc/auth")) oldOidc++;
    });
    const a = await ctx.newPage();
    await a.goto("http://localhost:4001/login");
    await a.locator("[data-sso-link]").click();
    await a.waitForURL(/localhost:4003\/login\?request=/);
    await a.locator('input[name="login"]').fill(process.env.FLOW_TEST_USER);
    await a.locator('input[name="password"]').fill("ui-login-pass");
    await a.locator('button[type="submit"]').click();
    await a.waitForURL("http://localhost:4001/", { timeout: 25000 });
    assert.match(await a.locator("body").innerText(), /CENTRAL SSO/);
    assert.equal(kcBrowser, 0);
    assert.equal(oldOidc, 0);
    console.log(
      "PASS A new Login: goes straight to C, server JWT grant and direct signed token POST, zero browser trips to Keycloak or C OIDC authorization",
    );
    const bp = await ctx.newPage();
    await bp.goto("http://localhost:4002/login");
    await bp.waitForURL("http://localhost:4002/", { timeout: 20000 });
    assert.match(await bp.locator("body").innerText(), /CENTRAL SSO/);
    assert.equal(kcBrowser, 0);
    assert.equal(oldOidc, 0);
    console.log(
      "PASS B SSO reuses C session automatically, no password, no Keycloak browser cookie needed",
    );
    const c = await ctx.newPage();
    await c.goto("http://localhost:4003/");
    assert.equal(await c.locator("#sso-status").innerText(), "SSO พร้อมใช้งาน");
    const email = process.env.FLOW_TEST_USER + "@example.test";
    const aToken = tokenOf("app-a", email),
      bToken = tokenOf("app-b", email);
    assert.ok(active("app-a", aToken));
    assert.ok(active("app-b", bToken));
    const localCtx = await b.newContext();
    const lp = await localCtx.newPage();
    await lp.goto("http://localhost:4001/login/local");
    await lp.locator('input[name="email"]').fill("admin");
    await lp.locator('input[name="password"]').fill("admin-a");
    await lp.locator('button[type="submit"]').click();
    await lp.waitForURL("http://localhost:4001/");
    await c.locator('form[action="/logout"] button').click();
    await c.waitForURL("http://localhost:4003/login", { timeout: 20000 });
    await a.waitForURL("http://localhost:4001/login");
    await bp.waitForURL("http://localhost:4002/login");
    assert.equal(active("app-a", aToken), false);
    assert.equal(active("app-b", bToken), false);
    assert.equal((await localCtx.request.get("http://localhost:4001/")).status(), 200);
    console.log(
      "PASS C Logout revokes API-issued Keycloak tokens, notifies A/B immediately, preserves local Login",
    );
    // Direct C Login still bootstraps a central token through the API without browser redirects.
    await c.locator('input[name="login"]').fill(process.env.FLOW_TEST_USER);
    await c.locator('input[name="password"]').fill("ui-login-pass");
    await c.locator('button[type="submit"]').click();
    await c.waitForFunction(
      () => document.getElementById("sso-status")?.textContent.trim() === "SSO พร้อมใช้งาน",
      {},
      { timeout: 25000 },
    );
    assert.equal(kcBrowser, 0);
    console.log("PASS direct C Login obtains its central token through the API");
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
