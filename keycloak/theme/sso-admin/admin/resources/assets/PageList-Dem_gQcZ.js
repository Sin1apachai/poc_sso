// Keycloak 26.8.1 native custom-page route. Hooks come from its existing Admin Console.
import { createElement as h, useEffect, useState } from "react";
import { u as useAdminClient, c as useParams, d as useRealm } from "./main-Y-5lkOv4.js";
import OriginalPage from "./PageList-original.js";

function TemporaryTokens() {
  const { adminClient } = useAdminClient();
  const { realm } = useRealm();
  const [query, setQuery] = useState({ first: 0, client: "", search: "" });
  const [draft, setDraft] = useState("");
  const [generation, setGeneration] = useState(0);
  const [data, setData] = useState(null);
  const [clients, setClients] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    (async () => {
      const bearer = await adminClient.getAccessToken();
      if (controller.signal.aborted) return;
      const url = new URL(
        `/admin/realms/${encodeURIComponent(realm)}/temporary-sso-tokens`,
        location.origin,
      );
      url.search = new URLSearchParams({ ...query, max: "25" });
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${bearer}` },
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) {
        throw Error(
          [401, 403].includes(response.status)
            ? "The realm-admin role is required to view this list."
            : "Failed to load tokens. Please try again.",
        );
      }
      const result = await response.json();
      if (!controller.signal.aborted) {
        setData(result);
        setClients(result.clients || []);
      }
    })()
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message || "Failed to load data.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [adminClient, realm, query, generation]);
  const time = (seconds) => new Date(seconds * 1000).toLocaleString("en-GB", { hour12: false });
  const rows = (data?.items || []).map((item) =>
    h(
      "tr",
      { key: item.id, "data-token-id": item.id },
      h("td", null, h("code", null, item.id)),
      h("td", null, item.email, h("small", { title: item.sub }, item.sub)),
      h("td", null, item.clientId),
      h("td", null, item.permissions.join(", ")),
      h("td", null, time(item.issuedAt)),
      h("td", null, time(item.expiresAt)),
      h("td", null, h("span", { className: "sso-token-active" }, "Active")),
    ),
  );
  return h(
    "section",
    { className: "sso-token-menu", "data-testid": "temporary-token-page" },
    h("h1", null, "SSO Tokens"),
    h("p", null, `Realm: ${realm} · Active central tokens in the temporary cache`),
    h(
      "p",
      { className: "sso-token-note" },
      "Only token metadata is shown; JWT values are not displayed. Expired or revoked tokens are removed from this list. No permanent history is stored. Refresh to see the latest status.",
    ),
    h(
      "form",
      {
        className: "sso-token-toolbar",
        onSubmit: (event) => {
          event.preventDefault();
          setQuery({ ...query, first: 0, search: draft.trim() });
        },
      },
      h(
        "label",
        null,
        "Application ",
        h(
          "select",
          {
            value: query.client,
            onChange: (event) => setQuery({ ...query, first: 0, client: event.target.value }),
            "aria-label": "Filter by application",
          },
          h("option", { value: "" }, "All"),
          ...clients.map((client) =>
            h("option", { key: client.clientId, value: client.clientId }, client.name),
          ),
        ),
      ),
      h(
        "label",
        null,
        "Search ",
        h("input", {
          type: "search",
          maxLength: 200,
          value: draft,
          placeholder: "Email, subject or token ID",
          "aria-label": "Search tokens",
          onChange: (event) => setDraft(event.target.value),
        }),
      ),
      h("button", { type: "submit", disabled: loading }, "Search"),
      h(
        "button",
        { type: "button", disabled: loading, onClick: () => setGeneration(generation + 1) },
        "Refresh",
      ),
    ),
    error ? h("p", { role: "alert", className: "sso-token-error" }, error) : null,
    h(
      "p",
      { role: "status", "data-testid": "temporary-token-count" },
      loading ? "Loading..." : `Active tokens: ${data?.total || 0}`,
    ),
    !loading && data
      ? h(
          "div",
          { className: "sso-token-table" },
          h(
            "table",
            { "aria-label": "SSO tokens" },
            h(
              "thead",
              null,
              h(
                "tr",
                null,
                ...[
                  "Token ID (jti)",
                  "User / subject",
                  "Requesting client",
                  "Permissions",
                  "Issued at",
                  "Expires at",
                  "Status",
                ].map((label) => h("th", { key: label, scope: "col" }, label)),
              ),
            ),
            h(
              "tbody",
              null,
              ...(rows.length
                ? rows
                : [
                    h(
                      "tr",
                      { key: "empty" },
                      h("td", { colSpan: 7 }, "No active tokens match these filters."),
                    ),
                  ]),
            ),
          ),
        )
      : null,
    data
      ? h(
          "div",
          { className: "sso-token-pagination" },
          h(
            "button",
            {
              type: "button",
              disabled: loading || query.first === 0,
              onClick: () => setQuery({ ...query, first: Math.max(0, query.first - 25) }),
            },
            "Previous",
          ),
          h(
            "span",
            null,
            `${data.total ? query.first + 1 : 0}–${query.first + data.items.length} / ${data.total}`,
          ),
          h(
            "button",
            {
              type: "button",
              disabled: loading || query.first + data.items.length >= data.total,
              onClick: () => setQuery({ ...query, first: query.first + 25 }),
            },
            "Next",
          ),
        )
      : null,
  );
}

export default function TokenPageRouter() {
  const { providerId } = useParams();
  return providerId === "SSO Tokens" ? h(TemporaryTokens) : h(OriginalPage);
}
