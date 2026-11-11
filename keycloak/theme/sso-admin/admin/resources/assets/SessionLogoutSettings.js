// Shares the native Sessions form context and its existing Save/Revert buttons.
import { createElement as h, useEffect, useState } from "react";
import {
  b5 as useFormContext,
  u as useAdminClient,
  d as useRealm,
  K as useAlerts,
  b6 as Controller,
  aI as TextInput,
  aH as FormGroup,
  g as Button,
} from "./main-Y-5lkOv4.js";

const sessionFields = [
  "ssoSessionIdleTimeout",
  "ssoSessionMaxLifespan",
  "ssoSessionIdleTimeoutRememberMe",
  "ssoSessionMaxLifespanRememberMe",
  "clientSessionIdleTimeout",
  "clientSessionMaxLifespan",
  "offlineSessionIdleTimeout",
  "clientOfflineSessionIdleTimeout",
  "offlineSessionMaxLifespanEnabled",
  "offlineSessionMaxLifespan",
  "clientOfflineSessionMaxLifespan",
  "accessCodeLifespanLogin",
  "accessCodeLifespanUserAction",
];

async function request(adminClient, realm, method, body) {
  const bearer = await adminClient.getAccessToken();
  const response = await fetch(
    adminClient.baseUrl + "/admin/realms/" + encodeURIComponent(realm) + "/sso-session-settings",
    {
      method,
      headers: { Authorization: "Bearer " + bearer, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      redirect: "error",
    },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw Error(error.errorMessage || error.error || "Unable to load or save logout settings.");
  }
  return response.status === 204 ? null : response.json();
}

export function useSessionLogoutSettings(realmRepresentation, originalSave) {
  const form = useFormContext();
  const { adminClient } = useAdminClient();
  const { realm, refresh } = useRealm();
  const { addAlert } = useAlerts();
  const [state, setState] = useState({ targets: [], loading: true, error: "", saving: false });

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: "" }));
    request(adminClient, realm, "GET")
      .then(({ logoutUrls }) => {
        const targets = logoutUrls.map((logoutUrl) => ({ logoutUrl }));
        if (cancelled) return;
        form.reset({ ...form.getValues(), logoutTargets: targets }, { keepDirtyValues: true });
        setState({ targets, loading: false, error: "", saving: false });
      })
      .catch((error) => {
        if (!cancelled)
          setState({ targets: [], loading: false, error: error.message, saving: false });
      });
    return () => {
      cancelled = true;
    };
  }, [adminClient, realm, realmRepresentation, form.reset, form.getValues]);

  async function save(values) {
    if (state.loading || state.error || state.saving) return;
    if (!state.targets.length && !values.logoutTargets?.length) {
      const { logoutTargets, ...nativeValues } = values;
      return originalSave(nativeValues);
    }
    setState((current) => ({ ...current, saving: true }));
    try {
      await request(adminClient, realm, "PUT", {
        sessionSettings: Object.fromEntries(
          sessionFields.filter((key) => values[key] !== undefined).map((key) => [key, values[key]]),
        ),
        logoutUrls: values.logoutTargets.map(({ logoutUrl }) => logoutUrl.trim()),
      });
      form.reset(values);
      addAlert("Session and logout settings saved.", "success");
      refresh();
    } catch (error) {
      addAlert(error.message, "danger");
    } finally {
      setState((current) => ({ ...current, saving: false }));
    }
  }
  function revert() {
    form.reset({ ...realmRepresentation, logoutTargets: state.targets });
  }
  return { ...state, save, revert };
}

function validateUrl(value) {
  try {
    const url = new URL(value);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.hash)
      return true;
  } catch {}
  return "Enter a valid HTTP or HTTPS logout URL.";
}

export function SessionLogoutSettings({ state }) {
  const { control } = useFormContext();
  if (state.loading) return h("p", { role: "status" }, "Loading logout settings...");
  if (state.error) return h("p", { role: "alert" }, state.error);
  return h(Controller, {
    name: "logoutTargets",
    control,
    defaultValue: [],
    rules: {
      validate: (rows) => {
        const urls = new Set();
        for (const row of rows) {
          const url = row.logoutUrl?.trim();
          if (url?.length > 2048 || validateUrl(url) !== true)
            return "Enter a valid HTTP or HTTPS logout URL for every target.";
          if (urls.has(url)) return "Each logout URL can only appear once.";
          urls.add(url);
        }
        return true;
      },
    },
    render: ({ field, fieldState }) => {
      const rows = field.value || [];
      return h(
        "div",
        { "data-testid": "session-logout-settings", className: "pf-v5-c-form pf-m-horizontal" },
        h(
          "p",
          { className: "pf-v5-u-mb-md" },
          "Add the URLs that receive user logout and identity provider outage notifications. Removing a URL stops notifications to that endpoint.",
        ),
        ...rows.map((row, index) =>
          h(
            FormGroup,
            {
              key: index,
              label: "Logout URL",
              fieldId: "logout-url-" + index,
              isRequired: true,
            },
            h(
              "div",
              { className: "pf-v5-l-flex pf-m-nowrap" },
              h(
                "div",
                { className: "pf-v5-l-flex__item pf-m-grow" },
                h(TextInput, {
                  id: "logout-url-" + index,
                  "aria-label": "Logout URL " + (index + 1),
                  value: row.logoutUrl,
                  isRequired: true,
                  onBlur: field.onBlur,
                  onChange: (_event, value) =>
                    field.onChange(
                      rows.map((target, at) => (at === index ? { logoutUrl: value } : target)),
                    ),
                }),
              ),
              h(
                Button,
                {
                  type: "button",
                  variant: "link",
                  "aria-label": "Remove target " + (index + 1),
                  onClick: () => field.onChange(rows.filter((_row, at) => at !== index)),
                },
                "Remove",
              ),
            ),
          ),
        ),
        fieldState.error && h("p", { role: "alert" }, fieldState.error.message),
        h(
          FormGroup,
          null,
          h(
            Button,
            {
              type: "button",
              variant: "secondary",
              onClick: () => field.onChange([...rows, { logoutUrl: "" }]),
            },
            "Add logout target",
          ),
        ),
      );
    },
  });
}
