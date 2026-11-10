const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  try {
    const ctx = await browser.newContext();
    let redeem = 0;
    ctx.on("request", (r) => {
      if (r.url().includes("/sso/redeem")) redeem++;
      assert.ok(!new URL(r.url()).searchParams.has("access_token"));
    });
    await ctx.route("**/sso-post.js", (route) =>
      route.fulfill({ contentType: "application/javascript", body: "" }),
    );
    const p = await ctx.newPage();
    await p.goto("http://localhost:4001/login");
    await p.locator("[data-sso-link]").click();
    await p.waitForURL(/4003\/login\?request=/);
    await p.locator("[name=login]").fill(process.env.FLOW_TEST_USER);
    await p.locator("[name=password]").fill("ui-login-pass");
    await p.locator("button[type=submit]").click();
    await p.locator("#sso-response").waitFor({ state: "attached" });
    async function form(page) {
      return page.locator("#sso-response").evaluate((f) => Object.fromEntries(new FormData(f)));
    }
    async function post(port, data, origin = "http://localhost:4003") {
      return ctx.request.post(`http://localhost:${port}/sso/callback`, {
        form: data,
        headers: { origin },
        maxRedirects: 0,
      });
    }
    const a = await form(p);
    assert.equal((await post(4001, { ...a, access_token: a.access_token + "x" })).status(), 400);
    assert.equal((await post(4001, { ...a, response: a.response + "x" })).status(), 400);
    assert.equal((await post(4001, { ...a, state: "x".repeat(43) })).status(), 400);
    assert.equal((await post(4002, a)).status(), 400);
    assert.equal((await post(4001, a, "http://evil.example")).status(), 400);
    assert.equal((await post(4001, a)).status(), 303);
    assert.equal((await post(4001, a)).status(), 400);
    await p.goto("http://localhost:4001/");
    assert.match(await p.locator("body").innerText(), /CENTRAL SSO/);
    console.log(
      "PASS signed token POST: tampering, wrong state/app/origin and replay rejected; valid response accepted; no token URLs",
    );
    const b = await ctx.newPage();
    await b.goto("http://localhost:4002/login");
    await b.locator("#sso-response").waitFor({ state: "attached" });
    const held = await form(b);
    const c = await ctx.newPage();
    await c.goto("http://localhost:4003/");
    await c.locator('form[action="/logout"] button').click();
    await c.waitForURL("http://localhost:4003/login");
    const late = await post(4002, held);
    assert.equal(late.status(), 302);
    assert.equal(late.headers().location, "/login");
    const check = await ctx.request.get("http://localhost:4002/", { maxRedirects: 0 });
    assert.notEqual(check.status(), 200);
    console.log("PASS token delivered after C Logout rejected by revocation fence");
    assert.equal(redeem, 0);
    await ctx.unroute("**/sso-post.js");
    await c.locator("[name=login]").fill(process.env.FLOW_TEST_USER);
    await c.locator("[name=password]").fill("ui-login-pass");
    await c.locator("button[type=submit]").click();
    await c.waitForFunction(
      () => document.querySelector("#sso-status")?.textContent.trim() === "SSO พร้อมใช้งาน",
    );
    await b.goto("http://localhost:4002/sso");
    await b.waitForURL("http://localhost:4002/");
    console.log("PASS fresh Login after Logout accepted; no redemption requests");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
