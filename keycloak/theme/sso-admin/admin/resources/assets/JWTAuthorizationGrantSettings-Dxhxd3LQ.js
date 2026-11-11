// Keycloak 26.8.1: extend the native IdP form and keep its existing Save action.
import { createElement as h, Fragment } from "react";
import { a5 as TextControl } from "./main-Y-5lkOv4.js";
import { a as OriginalSettings } from "./JWTAuthorizationGrantSettings-original.js";
export { J } from "./JWTAuthorizationGrantSettings-original.js";

function validateHealthUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.hash)
      return true;
  } catch {}
  return "Enter an HTTP or HTTPS Health Check URL that Keycloak can reach.";
}

export function a() {
  return h(
    Fragment,
    null,
    h(TextControl, {
      name: "config.ssoHealthCheckUrl",
      label: "Health Check URL",
      labelIcon:
        "IdP availability endpoint called by Keycloak. Save this URL, then test it in Realm settings > Heartbeat.",
      rules: { validate: validateHealthUrl },
    }),
    h(OriginalSettings),
  );
}
