const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const assert = require("node:assert/strict");
(async () => {
  const b = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  try {
    const ctx = await b.newContext();
    const c = await ctx.newPage();
    await c.goto("http://localhost:4003/login");
    await c.locator('input[name="login"]').fill(process.env.FLOW_TEST_USER);
    await c.locator('input[name="password"]').fill("ui-login-pass");
    await c.locator('button[type="submit"]').click();
    for (let n = 0; n < 150; n++) {
      await c.waitForTimeout(150);
      const conf = c.locator('form[action$="/confirm"] button');
      if (await conf.count()) await conf.click();
      if (
        (await c.locator("#sso-status").count()) &&
        (await c.locator("#sso-status").innerText()).includes("SSO พร้อมใช้งาน")
      )
        break;
    }
    assert.match(await c.locator("#sso-status").innerText(), /SSO พร้อมใช้งาน/);
    const a = await ctx.newPage();
    await a.goto("http://localhost:4001/login");
    await a.locator('a[href="/sso"]').waitFor();
    await a.waitForTimeout(500);
    assert.equal(new URL(a.url()).pathname, "/login");
    assert.equal(await a.locator("dialog").count(), 0);
    assert.equal((await ctx.request.get("http://localhost:4001/session/heartbeat")).status(), 401);
    console.log("PASS automatic SSO denial: Login shown without modal; access still denied");
    await a.locator('a[href="/sso"]').click();
    await a.locator("dialog[open]").waitFor();
    assert.equal(await a.locator("dialog h2").innerText(), "ไม่มีสิทธิ");
    await a.locator("dialog button").click();
    await a.locator("dialog").waitFor({ state: "detached" });
    assert.equal(await a.locator("dialog").count(), 0);
    console.log("PASS explicit Login with C denial: one modal appears and closes");
    for (let n = 0; n < 3; n++) {
      await a.reload();
      await a.locator('a[href="/sso"]').waitFor();
      assert.equal(await a.locator("dialog").count(), 0);
    }
    await a.goto("http://localhost:4001/");
    await a.waitForURL("http://localhost:4001/login");
    assert.equal(await a.locator("dialog").count(), 0);
    console.log("PASS reload and revisit: no recurring denial modal");
    await a.locator('a[href="/sso"]').click();
    await a.locator("dialog[open]").waitFor();
    await a.reload();
    assert.equal(await a.locator("dialog").count(), 0);
    assert.equal((await ctx.request.get("http://localhost:4001/session/heartbeat")).status(), 401);
    console.log("PASS a new explicit click shows a new one-time error; refresh consumes it");
    const bp = await ctx.newPage();
    await bp.goto("http://localhost:4002/login");
    await bp.waitForURL("http://localhost:4002/");
    assert.match(await bp.locator("body").innerText(), /CENTRAL SSO/);
    assert.equal(
      (await (await ctx.request.get("http://localhost:4003/session/heartbeat")).json())
        .authenticated,
      true,
    );
    console.log("PASS allowed B and C session remain functional");
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
