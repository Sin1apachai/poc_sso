package lab.sso.web;

import lab.sso.model.TokenHandoff;

/** Renders the browser POST; it neither verifies assertions nor creates tokens. */
public final class TokenHandoffPage {
    private final String submitScriptUrl;

    public TokenHandoffPage(String issuer) {
        this.submitScriptUrl = issuer + "/temporary-sso-poc/submit.js";
    }

    public String render(TokenHandoff handoff) {
        return "<!doctype html><html><head><meta charset=\"utf-8\"></head><body>"
                + "<form id=\"handoff\" method=\"post\" action=\"" + escape(handoff.callbackUrl()) + "\">"
                + hiddenInput("access_token", handoff.accessToken())
                + hiddenInput("handoff", handoff.deliveryProof())
                + hiddenInput("state", handoff.state())
                + "<noscript><button>Continue</button></noscript></form>"
                + "<script src=\"" + escape(submitScriptUrl) + "\" defer></script></body></html>";
    }

    private String hiddenInput(String name, String value) {
        return "<input type=\"hidden\" name=\"" + name + "\" value=\"" + escape(value) + "\">";
    }

    private String escape(String value) {
        return value.replace("&", "&amp;").replace("\"", "&quot;")
                .replace("<", "&lt;").replace(">", "&gt;");
    }
}
