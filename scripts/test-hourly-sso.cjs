const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
function sessionCount(service) {
  const code =
    "const{pool}=require('./src/db/database');pool.query(`SELECT count(*)::int AS n FROM session WHERE sess->'sso'->>'email'=$1`,[process.argv[1]]).then(r=>console.log(r.rows[0].n)).finally(()=>pool.end());";
  return Number(
    execFileSync("docker", [
      "compose",
      "exec",
      "-T",
      service,
      "node",
      "-e",
      code,
      process.env.FLOW_TEST_USER + "@example.test",
    ])
      .toString()
      .trim(),
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
    const c = await ctx.newPage();
    await c.goto("http://localhost:4003/login");
    await c.locator('input[name="login"]').fill(process.env.FLOW_TEST_USER);
    await c.locator('input[name="password"]').fill("ui-login-pass");
    await c.locator('button[type="submit"]').click();
    for (let n = 0; n < 150; n++) {
      await c.waitForTimeout(150);
      const confirm = c.locator('form[action$="/confirm"] button');
      if (await confirm.count()) await confirm.click();
      if (
        (await c.locator("#sso-status").count()) &&
        (await c.locator("#sso-status").innerText()).includes("SSO พร้อมใช้งาน")
      )
        break;
    }
    assert.match(await c.locator("#sso-status").innerText(), /SSO พร้อมใช้งาน/);
    const pages = [];
    let latestExpiry = 0;
    const storage = await ctx.storageState();
    for (const port of [4001, 4002]) {
      const appCtx = await b.newContext({ storageState: storage });
      const p = await appCtx.newPage();
      await p.clock.install();
      let calls = 0;
      p.on("request", (r) => {
        if (new URL(r.url()).pathname === "/session/heartbeat") calls++;
      });
      await p.goto("http://localhost:" + port + "/login");
      await p.waitForURL("http://localhost:" + port + "/");
      await p.clock.pauseAt(new Date((await p.evaluate(() => Date.now())) + 100));
      const state = await (
        await p.context().request.get("http://localhost:" + port + "/session/heartbeat")
      ).json();
      assert.equal(state.authenticated, true);
      assert.equal(state.intervalMs, 3600000);
      assert.ok(state.expiresAt - Date.now() < 25000);
      latestExpiry = Math.max(latestExpiry, state.expiresAt);
      await p.clock.fastForward(3590000);
      assert.equal(calls, 0);
      pages.push({ p, port, calls: () => calls });
    }
    console.log(
      "PASS A/B: signed central tokens valid; no browser heartbeat before the hourly interval",
    );
    // Local Login must not acquire the central heartbeat script.
    const localCtx = await b.newContext();
    const local = await localCtx.newPage();
    await local.clock.install();
    let localCalls = 0;
    local.on("request", (r) => {
      if (new URL(r.url()).pathname === "/session/heartbeat") localCalls++;
    });
    await local.goto("http://localhost:4001/login/local");
    await local.locator('input[name="email"]').fill("admin");
    await local.locator('input[name="password"]').fill("admin-a");
    await local.locator('button[type="submit"]').click();
    await local.waitForURL("http://localhost:4001/");
    await local.clock.pauseAt(new Date((await local.evaluate(() => Date.now())) + 100));
    assert.equal(
      await local.locator('script[src="/heartbeat.js"]').count(),
      0,
      "Local Login must not load heartbeat",
    );
    await new Promise((r) => setTimeout(r, Math.max(0, latestExpiry - Date.now()) + 250));
    for (const { p, calls } of pages) {
      assert.equal(calls(), 0, "No heartbeat before hourly tick for " + new URL(p.url()).port);
      assert.equal(new URL(p.url()).pathname, "/");
    }
    assert.ok(sessionCount("app-a") > 0);
    assert.ok(sessionCount("app-b") > 0);
    console.log(
      "PASS expiry alone starts no extra timer or heartbeat; waiting app sessions remain until the hourly check",
    );
    for (const { p, port, calls } of pages) {
      await p.clock.fastForward(10000);
      await p.waitForURL("http://localhost:" + port + "/login");
      assert.equal(calls(), 1);
      assert.match(await p.locator("body").innerText(), /เซสชันหมดอายุ/);
      assert.equal(
        (await p.context().request.get("http://localhost:" + port + "/session/heartbeat")).status(),
        401,
      );
    }
    assert.equal(sessionCount("app-a"), 0);
    assert.equal(sessionCount("app-b"), 0);
    console.log(
      "PASS one-hour heartbeat: expired central token -> 401 -> app SSO session removed -> Login A/B",
    );
    await local.clock.fastForward(3600000);
    assert.equal(localCalls, 0);
    assert.equal((await localCtx.request.get("http://localhost:4001/")).status(), 200);
    assert.equal(
      (await (await ctx.request.get("http://localhost:4003/session/heartbeat")).json())
        .authenticated,
      true,
    );
    console.log("PASS local A and C sessions are unchanged");
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
