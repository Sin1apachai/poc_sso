const { pool } = require("../db/database");
let cached;
async function adminRequest(method, path, data, options = {}) {
  if (!cached || cached.until < Date.now()) {
    const r = await fetch(process.env.KC_INTERNAL_URL + "/protocol/openid-connect/token", {
      method: "POST",
      signal: options.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.KC_SYNC_CLIENT_ID,
        client_secret: process.env.KC_SYNC_CLIENT_SECRET,
      }),
    });
    if (!r.ok) {
      throw new Error("เชื่อม Keycloak ไม่สำเร็จ: service account (" + r.status + ")");
    }
    const t = await r.json();
    cached = {
      token: t.access_token,
      until: Date.now() + (t.expires_in - 15) * 1000,
    };
  }
  const url = new URL(process.env.KC_INTERNAL_URL);
  const endpoint = url.origin + "/admin" + url.pathname + path;
  const r = await fetch(endpoint, {
    method,
    signal: options.signal,
    headers: {
      Authorization: "Bearer " + cached.token,
      "Content-Type": "application/json",
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (!r.ok) {
    if (r.status === 401) {
      cached = null;
    }
    const error = new Error(
      "Keycloak " + method + " " + path.split("?")[0] + " (" + r.status + ")",
    );
    error.status = r.status;
    throw error;
  }
  return r.status === 204 || r.status === 201 ? null : r.json();
}

async function syncUser(userId) {
  const connection = await pool.connect();
  try {
    await connection.query("SELECT pg_advisory_lock($1)", [Number(userId)]);
    const { rows } = await connection.query("SELECT * FROM users WHERE id=$1", [userId]);
    const user = rows[0];
    if (!user) {
      throw new Error("ไม่พบผู้ใช้");
    }
    let matches = await adminRequest(
      "GET",
      "/users?email=" + encodeURIComponent(user.email) + "&exact=true",
    );
    if (matches.length > 1) {
      throw new Error("มีอีเมลซ้ำใน Keycloak");
    }
    if (!matches[0]) {
      await adminRequest("POST", "/users", {
        username: user.email,
        email: user.email,
        emailVerified: false,
        enabled: user.enabled,
      });
      matches = await adminRequest(
        "GET",
        "/users?email=" + encodeURIComponent(user.email) + "&exact=true",
      );
    }
    const id = matches[0].id;
    await adminRequest("PUT", "/users/" + id, {
      email: user.email,
      enabled: user.enabled,
    });
    const links = await adminRequest("GET", "/users/" + id + "/federated-identity");
    const linked = links.find((x) => x.identityProvider === "app-control");
    if (linked && linked.userId !== String(user.id)) {
      throw new Error("บัญชี C เชื่อมกับตัวตนอื่นอยู่แล้ว");
    }
    if (!linked) {
      await adminRequest("POST", "/users/" + id + "/federated-identity/app-control", {
        identityProvider: "app-control",
        userId: String(user.id),
        userName: user.email,
      });
    }
    for (const [clientId, flags] of [
      ["app-a", { read: user.allow_a, write: user.allow_a_write, delete: user.allow_a_delete }],
      ["app-b", { read: user.allow_b, write: user.allow_b_write, delete: user.allow_b_delete }],
    ]) {
      const clients = await adminRequest("GET", "/clients?clientId=" + clientId);
      if (!clients[0]) {
        throw new Error("ยังไม่มี Client " + clientId);
      }
      const cid = clients[0].id;
      const definitions = await adminRequest("GET", "/clients/" + cid + "/roles");
      const endpoint = "/users/" + id + "/role-mappings/clients/" + cid;
      const assigned = await adminRequest("GET", endpoint);
      for (const name of ["read", "write", "delete"]) {
        const role = definitions.find((r) => r.name === name);
        if (!role) {
          throw new Error("ยังไม่มี role " + clientId + "/" + name);
        }
        const allowed = user.enabled && flags[name];
        const has = assigned.some((r) => r.id === role.id);
        if (allowed && !has) {
          await adminRequest("POST", endpoint, [role]);
        }
        if (!allowed && has) {
          await adminRequest("DELETE", endpoint, [role]);
        }
      }
      const effective = await adminRequest("GET", endpoint + "/composite");
      const unexpected = effective.filter(
        (r) => ["read", "write", "delete"].includes(r.name) && !(user.enabled && flags[r.name]),
      );
      if (unexpected.length) {
        throw new Error(
          "ยังได้รับสิทธิ์ " +
            clientId +
            "/" +
            unexpected.map((r) => r.name).join(",") +
            " จากกลุ่ม/Composite Role กรุณาถอนสิทธิ์ที่แหล่งนั้น",
        );
      }
    }
    // Disabling an identity is global. Normal permission edits do not log other apps out.
    if (!user.enabled) {
      await require("../sso/api-sso").revokeIssued(userId);
    }
    await connection.query(
      "UPDATE users SET kc_user_id=$2,sync_status='synced',sync_error=NULL WHERE id=$1",
      [userId, id],
    );
    return true;
  } catch (error) {
    await connection.query("UPDATE users SET sync_status='error',sync_error=$2 WHERE id=$1", [
      userId,
      error.message,
    ]);
    return false;
  } finally {
    await connection.query("SELECT pg_advisory_unlock($1)", [Number(userId)]).catch(() => {});
    connection.release();
  }
}

async function unlinkControlIdentity(userId) {
  const { rows } = await pool.query("SELECT kc_user_id FROM users WHERE id=$1", [userId]);
  if (rows[0]?.kc_user_id) {
    await adminRequest(
      "DELETE",
      "/users/" + rows[0].kc_user_id + "/federated-identity/app-control",
    );
  }
}

module.exports = { syncUser, unlinkControlIdentity };
