// Integration tests against the real Compose PoC. Temporarily stops only lab Keycloak.
const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_0-9]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
const kc = "http://localhost:8080",
  realm = kc + "/realms/sso-lab",
  extension = realm + "/temporary-sso-poc";
let adminToken,
  browser,
  originalRealm,
  originalPermissions,
  stopped = false;
const fixtureSuffix = require("node:crypto").randomBytes(4).toString("hex");
const deniedName = "poc-denied-" + fixtureSuffix,
  missingName = "poc-missing-" + fixtureSuffix;
const results = [],
  contexts = [];
function pass(s) {
  results.push(s);
  console.log("PASS " + s);
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(url, form) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
}
async function adminLogin() {
  const r = await post(kc + "/realms/master/protocol/openid-connect/token", {
    grant_type: "password",
    client_id: "admin-cli",
    username: process.env.KC_ADMIN_USERNAME || "admin",
    password: process.env.KC_ADMIN_PASSWORD || "admin-local-demo",
  });
  assert.equal(r.status, 200);
  adminToken = (await r.json()).access_token;
}
async function admin(method, path, body) {
  const r = await fetch(kc + "/admin/realms/sso-lab" + path, {
    method,
    headers: { authorization: "Bearer " + adminToken, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.ok(r.ok, "Admin " + method + " " + path + " " + r.status);
  return r.status === 204 ? null : r.json();
}
async function ready() {
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(extension + "/status", { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {}
    await pause(1000);
  }
  throw Error("Keycloak did not recover");
}
function compose(...args) {
  return execFileSync("docker", ["compose", ...args], { stdio: ["ignore", "pipe", "pipe"] });
}
function sql(service, text, values = []) {
  const src =
    "const {pool}=require('./src/db/database'); const q=JSON.parse(process.argv[1]); pool.query(q.text,q.values).then(r=>console.log(JSON.stringify(r.rows))).finally(()=>pool.end()).catch(()=>process.exitCode=1);";
  return JSON.parse(
    execFileSync(
      "docker",
      ["compose", "exec", "-T", service, "node", "-e", src, JSON.stringify({ text, values })],
      { encoding: "utf8" },
    ).trim(),
  );
}
async function ctx() {
  const c = await browser.newContext();
  contexts.push(c);
  c.setDefaultTimeout(20000);
  return c;
}
async function cLogin(c) {
  const p = await c.newPage();
  await p.goto("http://localhost:4003/login");
  await p.locator("[name=login]").fill("admin");
  await p.locator("[name=password]").fill("admin-c");
  await p.locator("button[type=submit]").click();
  await p.waitForURL("http://localhost:4003/");
  return p;
}
async function sso(c, port = 4001, user = "admin") {
  const p = await c.newPage();
  await p.goto(`http://localhost:${port}/sso`);
  await p.waitForURL((url) => url.port === "4003" || url.href === `http://localhost:${port}/`);
  if (await p.locator("[name=login]").count()) {
    await p.locator("[name=login]").fill(user);
    await p.locator("[name=password]").fill(user === "admin" ? "admin-c" : "test-c-pass");
    await p.locator("button[type=submit]").click();
  }
  return p;
}
async function dashboard(p, port) {
  await p.waitForURL(`http://localhost:${port}/`);
  assert.match(await p.locator("body").innerText(), /CENTRAL SSO/);
}
async function loginForm(c, port) {
  const p = await c.newPage();
  await p.goto(`http://localhost:${port}/login/local`);
  await p.waitForURL(`http://localhost:${port}/login`);
  return p;
}
async function run() {
  await ready();
  await adminLogin();
  originalRealm = await admin("GET", "");
  originalPermissions = sql(
    "app-control",
    "SELECT allow_a_write,allow_a_delete FROM users WHERE username='admin'",
  )[0];
  assert.equal(await admin("GET", "/users/count"), 0);
  const c = await ctx(),
    captures = [],
    proofs = [];
  const loginResponses = [];
  c.on("response", (r) => {
    if (r.url() === "http://localhost:4003/login" && r.request().method() === "POST")
      loginResponses.push(r.status());
  });
  c.on("request", (r) => {
    assert.notEqual(
      new URL(r.url()).pathname,
      "/sso/resume",
      "SSO must not loop back through a resume redirect",
    );
    if (r.url() === extension + "/authorize" && r.method() === "POST")
      proofs.push(new URLSearchParams(r.postData()).get("assertion"));
    assert.ok(!new URL(r.url()).searchParams.has("access_token"));
    if (r.url().includes("/sso/callback") && r.method() === "POST")
      captures.push({
        origin: r.headers().origin,
        ...Object.fromEntries(new URLSearchParams(r.postData())),
      });
  });
  const a = await sso(c);
  await dashboard(a, 4001);
  const ta = captures.at(-1);
  assert.deepEqual(loginResponses, [200], "Login C must directly return the handoff page");
  pass("Fresh SSO returns the proof page directly from C POST /login without a resume redirect");
  assert.equal(ta.origin, kc);
  const payload = JSON.parse(Buffer.from(ta.access_token.split(".")[1], "base64url"));
  assert.equal(payload.temporary_identity, true);
  assert.deepEqual(Object.keys(payload.app_permissions).sort(), ["app-a", "app-b"]);
  assert.equal(payload.aud, env.KC_AUDIENCE);
  const b = await sso(c, 4002);
  await dashboard(b, 4002);
  const tb = captures.at(-1);
  assert.equal(
    JSON.parse(Buffer.from(tb.access_token.split(".")[1], "base64url")).sub,
    payload.sub,
  );
  assert.deepEqual(
    Object.keys(
      JSON.parse(Buffer.from(tb.access_token.split(".")[1], "base64url")).app_permissions,
    ),
    ["app-a", "app-b"],
  );
  assert.equal(ta.access_token, tb.access_token, "A and B must receive the exact same JWT");
  const sharedCookie = (await c.cookies("http://localhost:4003")).find(
    (cookie) => cookie.name === "app_control_session",
  );
  const sourceId = decodeURIComponent(sharedCookie.value).slice(2).split(".")[0];
  const sourceToken = sql(
    "app-control",
    "SELECT access_token FROM central_sso_status WHERE session_id=$1",
    [sourceId],
  )[0].access_token;
  assert.equal(ta.access_token, sourceToken, "C/A/B must hold identical JWT bytes");
  const sharedRows = await admin("GET", "/temporary-sso-tokens?search=" + payload.sub);
  assert.equal(sharedRows.total, 1, "Opening A/B must not add central tokens");
  assert.equal(
    sql(
      "app-control",
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name='api_sso_tokens'",
    )[0].n,
    0,
  );
  assert.equal(
    sql(
      "app-control",
      "SELECT count(*)::int AS n FROM session WHERE sess::text LIKE '%accessToken%'",
    )[0].n,
    0,
  );
  pass(
    "A login through C; B reuses C session; Keycloak posts directly to A/B; C/A/B reuse the identical central JWT and jti, only one token-list row after entering both apps",
  );
  const proofReplay = await post(extension + "/authorize", { assertion: proofs[0] });
  assert.equal(proofReplay.status, 400);
  const proofTamper = await post(extension + "/authorize", { assertion: proofs[0] + "x" });
  assert.equal(proofTamper.status, 400);
  // Browser binding, replay and client separation.
  const replay = await c.request.post("http://localhost:4001/sso/callback", {
    form: ta,
    headers: { origin: kc },
    maxRedirects: 0,
  });
  assert.equal(replay.status(), 400);
  const cross = await c.request.post("http://localhost:4002/sso/callback", {
    form: ta,
    headers: { origin: kc },
    maxRedirects: 0,
  });
  assert.equal(cross.status(), 400);
  const good = await post(extension + "/introspect", {
    token: ta.access_token,
    client_id: "app-a",
    client_secret: env.APP_A_KC_CLIENT_SECRET,
  });
  assert.equal((await good.json()).active, true);
  const wrong = await post(extension + "/introspect", {
    token: ta.access_token,
    client_id: "app-b",
    client_secret: env.APP_B_KC_CLIENT_SECRET,
  });
  assert.equal((await wrong.json()).active, true);
  pass(
    "Proof tampering/replay and callback replay/cross-app token rejected; introspection accepts the same JWT for both entitled clients",
  );
  // C logout must clear SSO sessions but leave a separate local A session intact.
  const local = await ctx(),
    lp = await loginForm(local, 4001);
  await lp.locator("[name=email]").fill("admin@example.com");
  await lp.locator("[name=password]").fill("admin-a-demo");
  await lp.locator("button[type=submit]").click();
  await lp.waitForURL("http://localhost:4001/");
  assert.match(await lp.locator("body").innerText(), /LOCAL LOGIN/);
  const cp = await c.newPage();
  await cp.goto("http://localhost:4003/");
  await cp.locator('form[action="/logout"] button').click();
  await cp.waitForURL("http://localhost:4003/login");
  assert.equal(
    (
      await (
        await post(extension + "/introspect", {
          token: ta.access_token,
          client_id: "app-a",
          client_secret: env.APP_A_KC_CLIENT_SECRET,
        })
      ).json()
    ).active,
    false,
  );
  await a.waitForURL(/4001\/login/);
  await b.waitForURL(/4002\/login/);
  await lp.reload();
  assert.match(await lp.locator("body").innerText(), /LOCAL LOGIN/);
  const localState = sql("app-a", "SELECT sess FROM session WHERE sess->'local' IS NOT NULL");
  assert.ok(localState.length);
  assert.ok(localState.every((r) => !r.sess.sso));
  pass(
    "Logout C revokes central tokens, pushes A/B out through SSE, and preserves independent local login",
  );
  // Local A cannot create an authenticated B session.
  const lpb = await loginForm(local, 4002);
  assert.ok(await lpb.locator("[name=email]").count());
  await lp.locator('form[action="/logout"] button').click();
  await lp.waitForURL("http://localhost:4001/login");
  assert.ok(await lp.locator("[name=email]").count());
  pass(
    "Local login issues no central token; local A does not sign in B; app-only logout stays on login",
  );
  // Real user management, permissions and missing-user modal.
  const manager = await ctx(),
    mp = await cLogin(manager);
  await mp
    .locator("#sso-status")
    .filter({ hasText: "เชื่อมต่อ SSO สำเร็จ ได้รับ token กลางแล้ว" })
    .waitFor();
  const publicCState = await (await manager.request.get("http://localhost:4003/sso/status")).json();
  assert.equal(publicCState.tokenIssued, true);
  assert.equal(publicCState.clientId, "app-control");
  assert.equal(Object.hasOwn(publicCState, "access_token"), false);
  const cookie = (await manager.cookies("http://localhost:4003")).find(
    (c) => c.name === "app_control_session",
  );
  const cSession = decodeURIComponent(cookie.value).slice(2).split(".")[0];
  const centralC = sql(
    "app-control",
    "SELECT access_token,token_jti FROM central_sso_status WHERE session_id=$1",
    [cSession],
  )[0];
  const cClaims = JSON.parse(Buffer.from(centralC.access_token.split(".")[1], "base64url"));
  assert.equal(cClaims.aud, env.KC_AUDIENCE);
  assert.equal(cClaims.jti, centralC.token_jti);
  assert.deepEqual(Object.keys(cClaims.app_permissions).sort(), ["app-a", "app-b"]);
  const cActive = await post(extension + "/introspect", {
    token: centralC.access_token,
    client_id: "app-control",
    client_secret: env.CONTROL_KC_CLIENT_SECRET,
  });
  assert.equal((await cActive.json()).active, true);
  const menu = await admin("GET", "/temporary-sso-tokens?client=app-control&search=" + cClaims.jti);
  assert.equal(menu.total, 1);
  pass(
    "Login C immediately gets a verified central token before opening A/B; it appears as app-control in SSO Tokens and the public status exposes no JWT",
  );
  const fromC = await manager.newPage();
  await fromC.goto("http://localhost:4003/");
  await fromC.locator('a[href="/connect/app-a"]').click();
  await dashboard(fromC, 4001);
  pass(
    "Direct login C reports actual token issuance correctly and the A link signs in without asking for the password again",
  );
  await mp.goto("http://localhost:4003/users");
  for (const [username, email, allow] of [
    [deniedName, deniedName + "@example.test", false],
    [missingName, missingName + "@example.test", true],
  ]) {
    const f = mp.locator('form[action="/users"]');
    await f.locator("[name=username]").fill(username);
    await f.locator("[name=email]").fill(email);
    await f.locator("[name=password]").fill("test-c-pass");
    if (allow) await f.locator("[name=allow_a]").check();
    await f.locator("[name=allow_b]").check();
    await f.locator("button").click();
    await mp.waitForURL(/\/users\?saved=1/);
  }
  const denied = await ctx(),
    dp = await sso(denied, 4001, deniedName);
  await dp.waitForURL("http://localhost:4001/login");
  await dp.locator("#access-denied[open]").waitFor();
  assert.match(await dp.locator("#access-denied").innerText(), /ไม่มีสิทธิ/);
  await dp.reload();
  assert.equal(await dp.locator("#access-denied").count(), 0);
  const missing = await ctx(),
    np = await sso(missing, 4001, missingName);
  await np.waitForURL("http://localhost:4001/login");
  await np.locator("#access-denied[open]").waitFor();
  assert.match(await np.locator("#access-denied").innerText(), /ไม่มีผู้ใช้ที่ตรงกัน/);
  pass(
    "C user management saves without Keycloak sync; denied and missing-local-user modals appear once after explicit SSO",
  );
  const row = mp.locator("input[name=username][value=admin]");
  const form = await row.getAttribute("form");
  await mp.locator(`input[form="${form}"][name=allow_a_write]`).check();
  await mp.locator(`input[form="${form}"][name=allow_a_delete]`).check();
  await mp.locator(`button[form="${form}"]`).click();
  await mp.waitForURL(/\/users\?saved=1/);
  const permissions = await ctx(),
    perTokens = [];
  permissions.on("request", (r) => {
    if (r.url() === "http://localhost:4001/sso/callback" && r.method() === "POST")
      perTokens.push(Object.fromEntries(new URLSearchParams(r.postData())));
  });
  await dashboard(await sso(permissions), 4001);
  const pp = JSON.parse(Buffer.from(perTokens[0].access_token.split(".")[1], "base64url"));
  assert.deepEqual(pp.app_permissions["app-a"], ["read", "write", "delete"]);
  pass(
    "Read/write/delete set in C appear in the shared JWT after re-login, with no Keycloak role mappings",
  );
  // Real expiry, accelerated timer without changing application source or its one-hour interval.
  await admin("PUT", "", { accessTokenLifespan: 3 });
  const exp = await ctx();
  await exp.addInitScript(() => {
    const original = window.setInterval;
    window.setInterval = (fn, ms, ...args) => original(fn, ms === 3600000 ? 250 : ms, ...args);
  });
  const ep = await sso(exp);
  await dashboard(ep, 4001);
  await ep.waitForURL("http://localhost:4001/login", { timeout: 12000 });
  assert.match(await ep.locator("body").innerText(), /หมดอายุ/);
  await admin("PUT", "", { accessTokenLifespan: originalRealm.accessTokenLifespan });
  pass(
    "Real token expiry removes the app session on heartbeat and returns login; one-hour browser timer accelerated only by test injection",
  );
  // Lost connection AFTER successful preflight: the parent handoff page must recover.
  const failed = await ctx();
  await failed.route("**/temporary-sso-poc/authorize", (r) => r.abort("connectionfailed"));
  const fp = await sso(failed);
  await fp.bringToFront();
  await fp.waitForURL("http://localhost:4001/login", { timeout: 35000 });
  await fp.locator("#sso-unavailable[open]").waitFor();
  pass(
    "Keycloak handoff connection failure returns to A login with connection modal instead of a browser error page",
  );
  // Real Keycloak outage: no redirect away from A/B login after three probes.
  const outage = await ctx();
  await outage.addInitScript(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (String(args[0]).endsWith("/sso/preflight"))
        window.__preflightResult = await response.clone().json();
      return response;
    };
  });
  const op = await loginForm(outage, 4001),
    oq = await loginForm(outage, 4002);
  compose("stop", "keycloak");
  stopped = true;
  for (const [page, port] of [
    [op, 4001],
    [oq, 4002],
  ]) {
    await page.locator("[data-sso-link]").click();
    await page.waitForFunction(() => window.__preflightResult?.attempts === 3);
    await page.locator("#sso-unavailable[open]").waitFor();
    assert.equal(new URL(page.url()).port, String(port));
  }
  const offlineC = await ctx(),
    offlinePage = await cLogin(offlineC);
  let failedC;
  for (let i = 0; i < 30; i++) {
    failedC = await (await offlineC.request.get("http://localhost:4003/sso/status")).json();
    if (failedC.status === "failed") break;
    await pause(500);
  }
  assert.equal(failedC.status, "failed");
  assert.equal(failedC.attempts, 3);
  assert.equal(failedC.tokenIssued, false);
  assert.equal(new URL(offlinePage.url()).port, "4003");
  pass(
    "Keycloak outage during Login C retries actual token issuance three times, reports failure without claiming SSO success, and keeps C local login usable",
  );
  compose("start", "keycloak");
  stopped = false;
  await ready();
  await adminLogin();
  pass(
    "Actual Keycloak container outage: A/B each retry three checks, remain at their own login and display modal",
  );
  assert.equal(await admin("GET", "/users/count"), 0);
  for (const client of ["app-a", "app-b"]) {
    const list = await admin("GET", "/clients?clientId=" + client);
    assert.equal((await admin("GET", "/clients/" + list[0].id + "/roles")).length, 0);
  }
  pass("Final realm users remain zero; app-a/app-b role definitions remain empty");
  fs.writeFileSync(
    "docs/flows/TEST-RESULTS.json",
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        mode: "real Compose A/B/C + PostgreSQL + Keycloak 26.8.1 custom extension",
        keycloakUsersBefore: 0,
        keycloakUsersAfter: 0,
        tests: results,
      },
      null,
      2,
    ) + "\n",
  );
}
(async () => {
  try {
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      headless: true,
      args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
    });
    await run();
  } catch (e) {
    console.error(e.stack);
    for (const context of contexts.slice(-2)) {
      for (const page of context.pages()) {
        try {
          console.error(
            "PAGE",
            new URL(page.url()).origin + new URL(page.url()).pathname,
            (await page.locator("body").innerText()).slice(0, 180),
          );
        } catch {}
      }
    }
    process.exitCode = 1;
  } finally {
    if (stopped) {
      try {
        compose("start", "keycloak");
        await ready();
      } catch {}
    }
    if (originalRealm) {
      try {
        await adminLogin();
        await admin("PUT", "", { accessTokenLifespan: originalRealm.accessTokenLifespan });
      } catch {}
    }
    // Remove only test fixture accounts created by this script, not ordinary user data.
    try {
      sql(
        "app-control",
        "DELETE FROM users WHERE username=ANY($1::text[]) AND email=ANY($2::text[])",
        [
          [deniedName, missingName],
          [deniedName + "@example.test", missingName + "@example.test"],
        ],
      );
    } catch {}
    if (originalPermissions) {
      try {
        sql(
          "app-control",
          "UPDATE users SET allow_a_write=$1,allow_a_delete=$2 WHERE username='admin'",
          [originalPermissions.allow_a_write, originalPermissions.allow_a_delete],
        );
      } catch {}
    }
    if (browser) {
      await Promise.race([browser.close(), pause(5000)]);
    }
  }
  process.exit(process.exitCode || 0);
})();
