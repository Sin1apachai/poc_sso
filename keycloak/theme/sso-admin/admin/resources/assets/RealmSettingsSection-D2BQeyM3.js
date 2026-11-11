// Keycloak 26.8.1: retain its native realm settings and add an IdP logout panel in Sessions.
import { createElement as h, Fragment, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { u as useAdminClient, c as useParams, d as useRealm } from "./main-Y-5lkOv4.js";
import OriginalRealmSettings from "./RealmSettingsSection-original.js";

const prefix = "temporary.sso.idp-heartbeat.";

function IdentityProviderHeartbeatSettings() {
  const { adminClient } = useAdminClient();
  const { realm } = useRealm();
  const route = useParams();
  const hash = window.location.hash;
  const isSessions = /\/realm-settings\/sessions(?:\?|$)/.test(hash);
  const [host, setHost] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isSessions) return;
    let cancelled = false;
    let container;
    const observer = new MutationObserver(attach);
    function attach() {
      const anchor = document.querySelector(".kc-login-settings-template");
      if (!anchor || container) return;
      container = document.createElement("div");
      anchor.parentElement.append(container);
      setHost(container);
      observer.disconnect();
    }
    attach();
    if (!container) observer.observe(document.body, { childList: true, subtree: true });
    setSettings(null);
    setError("");
    adminClient.realms
      .findOne({ realm })
      .then((data) => {
        if (cancelled || !data?.attributes?.["temporary.sso.idp"]) return;
        const attributes = data.attributes;
        const seconds = Number(attributes[prefix + "interval-seconds"] || 60);
        const unit = seconds % 3600 === 0 ? 3600 : seconds % 60 === 0 ? 60 : 1;
        setSettings({
          enabled: attributes[prefix + "enabled"] === "true",
          interval: seconds / unit,
          unit,
          threshold: Number(attributes[prefix + "failure-threshold"] || 3),
          healthUrl: attributes[prefix + "health-url"] || "",
        });
      })
      .catch(() => {
        if (!cancelled) setError("โหลดการตั้งค่า IdP heartbeat ไม่สำเร็จ");
      });
    return () => {
      cancelled = true;
      observer.disconnect();
      container?.remove();
      setHost(null);
    };
  }, [adminClient, realm, isSessions, hash, route.tab]);

  if (!isSessions || !host || !settings) return null;
  const update = (key, value) => setSettings({ ...settings, [key]: value });
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const seconds = Number(settings.interval) * Number(settings.unit);
      const threshold = Number(settings.threshold);
      const endpoint = new URL(settings.healthUrl);
      if (
        !Number.isInteger(seconds) ||
        seconds < 1 ||
        seconds > 86400 ||
        !Number.isInteger(threshold) ||
        threshold < 1 ||
        threshold > 100 ||
        !["http:", "https:"].includes(endpoint.protocol) ||
        endpoint.username ||
        endpoint.password ||
        endpoint.hash
      ) {
        throw Error(
          "กำหนดรอบตรวจ 1 วินาที–24 ชั่วโมง และจำนวนครั้งที่ไม่ผ่าน 1–100 ครั้ง พร้อม URL แบบ HTTP/HTTPS",
        );
      }
      const latest = await adminClient.realms.findOne({ realm });
      await adminClient.realms.update(
        { realm },
        {
          attributes: {
            ...latest.attributes,
            [prefix + "enabled"]: String(settings.enabled),
            [prefix + "interval-seconds"]: String(seconds),
            [prefix + "failure-threshold"]: String(threshold),
            [prefix + "health-url"]: settings.healthUrl,
          },
        },
      );
      // Refresh the native realm form too, so its later Save cannot restore old attributes.
      window.location.reload();
    } catch (failure) {
      setError(failure.message || "บันทึกไม่สำเร็จ กรุณาตรวจสิทธิ์และลองใหม่");
      setSaving(false);
    }
  }

  const panel = h(
    "section",
    { className: "sso-heartbeat-settings", "data-testid": "idp-heartbeat-settings" },
    h("h2", null, "Logout"),
    h("h3", null, "IdP heartbeat / Global logout"),
    h(
      "p",
      null,
      "Keycloak ตรวจความพร้อมของ IdP หากไม่ผ่านตามจำนวนที่กำหนด จะเพิกถอน token กลางและแจ้งทุกแอปให้ออกจาก SSO โดยไม่กระทบ Local Login ของ A/B",
    ),
    h(
      "form",
      { onSubmit: save },
      h(
        "label",
        null,
        h("input", {
          type: "checkbox",
          checked: settings.enabled,
          disabled: saving,
          "aria-label": "เปิดใช้งาน IdP heartbeat",
          onChange: (e) => update("enabled", e.target.checked),
        }),
        " เปิดใช้งาน IdP heartbeat",
      ),
      h("label", { htmlFor: "idp-heartbeat-interval" }, "รอบตรวจ IdP"),
      h(
        "div",
        { className: "sso-heartbeat-interval" },
        h("input", {
          id: "idp-heartbeat-interval",
          type: "number",
          min: 1,
          max: 86400,
          step: 1,
          required: true,
          value: settings.interval,
          disabled: saving,
          onChange: (e) => update("interval", e.target.value),
        }),
        h(
          "select",
          {
            "aria-label": "หน่วยเวลาตรวจ IdP",
            value: settings.unit,
            disabled: saving,
            onChange: (e) => update("unit", e.target.value),
          },
          h("option", { value: 1 }, "วินาที"),
          h("option", { value: 60 }, "นาที"),
          h("option", { value: 3600 }, "ชั่วโมง"),
        ),
      ),
      h(
        "label",
        { htmlFor: "idp-heartbeat-threshold" },
        "จำนวนครั้งที่ตรวจไม่ผ่านติดต่อกันก่อน Global logout",
      ),
      h("input", {
        id: "idp-heartbeat-threshold",
        type: "number",
        min: 1,
        max: 100,
        step: 1,
        required: true,
        value: settings.threshold,
        disabled: saving,
        onChange: (e) => update("threshold", e.target.value),
      }),
      h("label", { htmlFor: "idp-heartbeat-url" }, "IdP Health URL"),
      h("input", {
        id: "idp-heartbeat-url",
        type: "url",
        required: true,
        value: settings.healthUrl,
        disabled: saving,
        onChange: (e) => update("healthUrl", e.target.value),
      }),
      h(
        "p",
        null,
        "ตั้งได้ 1 วินาที–24 ชั่วโมง ตรวจจาก Keycloak ภายใน Docker; สำเร็จเมื่อ HTTP 2xx และไม่ตาม redirect การเปลี่ยนค่ามีผลโดยไม่ต้อง restart",
      ),
      error ? h("p", { role: "alert" }, error) : null,
      h(
        "button",
        { type: "submit", disabled: saving },
        saving ? "กำลังบันทึก..." : "บันทึก IdP heartbeat",
      ),
    ),
  );
  return createPortal(panel, host);
}

export default function RealmSettingsWithHeartbeat() {
  return h(Fragment, null, h(OriginalRealmSettings), h(IdentityProviderHeartbeatSettings));
}
