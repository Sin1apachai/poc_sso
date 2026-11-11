// Uses the form controls shipped in Keycloak 26.8.1; no independent form stylesheet.
import { createElement as h, useEffect, useState } from "react";
import {
  u as useAdminClient,
  d as useRealm,
  j as useForm,
  m as FormProvider,
  P as PageSection,
  a8 as Title,
  bs as NumberControl,
  W as SelectControl,
  K as useAlerts,
  w as Loading,
  aH as FormGroup,
  L as Link,
  g as Button,
} from "./main-Y-5lkOv4.js";
import { F as FormAccess, b as FormActions } from "./FormAccess-CkNyUOob.js";
import { D as SwitchControl } from "./SwitchControl-CR2O7Xvd.js";
import { T as TimeSelectorControl } from "./TimeSelectorControl-DDubNvfP.js";

const prefix = "temporary.sso.idp-heartbeat.";
const timeRules = {
  required: true,
  min: { value: 1, message: "Enter a duration of at least 1 second." },
  max: { value: 86400, message: "Enter a duration of no more than 24 hours." },
};
function defaults(attributes) {
  const idpAlias = attributes[prefix + "idp-alias"] || attributes["temporary.sso.idp"] || "";
  return {
    enabled: attributes[prefix + "enabled"] === "true",
    failureThreshold: Number(attributes[prefix + "failure-threshold"] || 3),
    confirmationIntervalSeconds: Number(attributes[prefix + "confirmation-interval-seconds"] || 5),
    intervalSeconds: Number(attributes[prefix + "interval-seconds"] || 60),
    idpAlias,
  };
}

export function HeartbeatSettings() {
  const { adminClient } = useAdminClient();
  const { realm, refresh } = useRealm();
  const { addAlert, addError } = useAlerts();
  const form = useForm({ mode: "onChange" });
  const [configuration, setConfiguration] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [testing, setTesting] = useState(false);
  const selectedAlias = form.watch("idpAlias");
  const selectedProvider = configuration?.providers.find(
    (provider) => provider.alias === selectedAlias,
  );

  useEffect(() => {
    let cancelled = false;
    setConfiguration(null);
    setLoadError("");
    Promise.all([
      adminClient.realms.findOne({ realm }),
      adminClient.identityProviders.find({ realm }),
    ])
      .then(([data, providers]) => {
        if (cancelled) return;
        const available = providers.map((provider) => ({
          alias: provider.alias,
          name: provider.displayName || provider.alias,
          providerId: provider.providerId,
          enabled: provider.enabled,
          healthUrl: provider.config?.ssoHealthCheckUrl || "",
        }));
        const values = defaults(data.attributes || {});
        setConfiguration({
          providers: available,
          trustedAlias: data.attributes?.["temporary.sso.idp"],
          values,
        });
        form.reset(values);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Failed to load heartbeat settings. Please try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [adminClient, realm, form.reset]);

  async function testHeartbeat() {
    setTesting(true);
    try {
      const bearer = await adminClient.getAccessToken();
      const response = await fetch(
        adminClient.baseUrl +
          "/admin/realms/" +
          encodeURIComponent(realm) +
          "/idp-heartbeat/" +
          encodeURIComponent(selectedAlias) +
          "/test",
        {
          method: "POST",
          headers: { Authorization: "Bearer " + bearer },
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        },
      );
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Unable to test the IdP heartbeat.");
      const status = result.httpStatus ? "HTTP " + result.httpStatus : "no HTTP response";
      addAlert(
        result.healthy
          ? "Heartbeat succeeded (" + status + ", " + result.durationMillis + " ms)."
          : "Heartbeat failed (" + status + ", " + result.durationMillis + " ms). " + result.error,
        result.healthy ? "success" : "danger",
      );
    } catch {
      addAlert(
        "Unable to test the IdP heartbeat. Check your connection and administrator permissions.",
        "danger",
      );
    } finally {
      setTesting(false);
    }
  }

  async function save(values) {
    try {
      if (
        !Number.isInteger(values.failureThreshold) ||
        values.failureThreshold < 1 ||
        values.failureThreshold > 100
      )
        throw Error("Enter a failure threshold between 1 and 100.");
      for (const seconds of [values.intervalSeconds, values.confirmationIntervalSeconds])
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86400)
          throw Error("Enter an interval between 1 second and 24 hours.");
      let healthUrl = selectedProvider?.healthUrl || "";
      if (values.enabled) {
        if (!selectedProvider?.enabled || selectedAlias !== configuration.trustedAlias)
          throw Error("Select the enabled identity provider used for SSO.");
        const provider = await adminClient.identityProviders.findOne({
          realm,
          alias: selectedAlias,
        });
        healthUrl = provider.config?.ssoHealthCheckUrl || "";
        if (!healthUrl)
          throw Error("Set the Health Check URL in the identity provider settings first.");
        const url = new URL(healthUrl);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
          throw Error(
            "The Health Check URL must use HTTP or HTTPS and be reachable from Keycloak.",
          );
      }
      const latest = await adminClient.realms.findOne({ realm });
      const attributes = {
        ...latest.attributes,
        [prefix + "enabled"]: String(values.enabled),
        [prefix + "failure-threshold"]: String(values.failureThreshold),
        [prefix + "confirmation-interval-seconds"]: String(values.confirmationIntervalSeconds),
        [prefix + "interval-seconds"]: String(values.intervalSeconds),
        [prefix + "idp-alias"]: values.idpAlias,
      };
      delete attributes[prefix + "health-url"];
      await adminClient.realms.update({ realm }, { attributes });
      const saved = { ...values };
      setConfiguration((current) => ({
        ...current,
        values: saved,
        providers: current.providers.map((provider) =>
          provider.alias === saved.idpAlias ? { ...provider, healthUrl } : provider,
        ),
      }));
      form.reset(saved);
      refresh();
      addAlert("Heartbeat settings saved.", "success");
    } catch (error) {
      addError("Failed to save heartbeat settings.", error);
    }
  }

  if (loadError) return h(PageSection, { variant: "light" }, h("p", { role: "alert" }, loadError));
  if (!configuration) return h(Loading);
  const options = configuration.providers
    .filter((provider) => provider.enabled && provider.alias === configuration.trustedAlias)
    .map((provider) => ({ key: provider.alias, value: provider.name }));

  return h(
    FormProvider,
    { ...form },
    h(
      PageSection,
      { variant: "light", "data-testid": "idp-heartbeat-settings" },
      h(
        Title,
        { headingLevel: "h2", size: "lg", className: "pf-v5-u-mb-lg" },
        "IdP heartbeat / Global logout",
      ),
      h(
        FormAccess,
        { role: "manage-realm", isHorizontal: true, onSubmit: form.handleSubmit(save) },
        h(SwitchControl, {
          name: "enabled",
          label: "Enable heartbeat",
          labelIcon:
            "Check IdP availability in the background and revoke SSO after an outage is confirmed.",
        }),
        h(NumberControl, {
          name: "failureThreshold",
          label: "1. Failure threshold",
          labelIcon:
            "Consecutive failed checks required to confirm an outage, including the first failure. A successful check resets the count.",
          controller: { defaultValue: 3, rules: { required: true, min: 1, max: 100 } },
        }),
        h(TimeSelectorControl, {
          name: "confirmationIntervalSeconds",
          label: "2. Retry interval",
          labelIcon: "Time between failed checks while confirming an outage.",
          units: ["second", "minute", "hour"],
          min: 1,
          controller: { defaultValue: 5, rules: timeRules },
        }),
        h(TimeSelectorControl, {
          name: "intervalSeconds",
          label: "3. Check interval",
          labelIcon: "Time between normal checks and recovery checks after an outage is confirmed.",
          units: ["second", "minute", "hour"],
          min: 1,
          controller: { defaultValue: 60, rules: timeRules },
        }),
        h(SelectControl, {
          name: "idpAlias",
          label: "4. Target IdP",
          labelIcon:
            "Select the SSO identity provider. Configure its Health Check URL in the identity provider settings.",
          options,
          controller: { defaultValue: "", rules: { required: true } },
        }),
        h(
          FormGroup,
          { label: "Heartbeat test", fieldId: "heartbeat-test" },
          h(
            Button,
            {
              id: "heartbeat-test",
              "aria-label": "Test heartbeat",
              type: "button",
              variant: "secondary",
              isLoading: testing,
              isDisabled: testing || !selectedProvider,
              onClick: testHeartbeat,
            },
            testing ? "Testing heartbeat" : "Test heartbeat",
          ),
          h(
            "p",
            { className: "pf-v5-u-mt-sm" },
            "Tests the selected IdP once using its saved Health Check URL. Does not log users out.",
          ),
        ),
        selectedProvider &&
          h(
            FormGroup,
            { label: "IdP settings", fieldId: "heartbeat-idp-link" },
            h(
              Link,
              {
                id: "heartbeat-idp-link",
                to:
                  "/" +
                  realm +
                  "/identity-providers/" +
                  selectedProvider.providerId +
                  "/" +
                  selectedProvider.alias +
                  "/settings",
              },
              "Configure IdP heartbeat",
            ),
          ),
        h(FormActions, {
          name: "heartbeat",
          isSubmit: true,
          isDisabled: !form.formState.isDirty || form.formState.isSubmitting,
          reset: () => form.reset(configuration.values),
        }),
      ),
    ),
  );
}
