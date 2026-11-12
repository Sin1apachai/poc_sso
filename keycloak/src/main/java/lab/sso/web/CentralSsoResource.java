package lab.sso.web;

import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.FormParam;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Map;
import java.util.LinkedHashMap;
import org.keycloak.models.ClientModel;
import lab.sso.heartbeat.HeartbeatLog;
import lab.sso.security.SsoClientAuthenticator;
import lab.sso.service.CentralTokenService;

/** HTTP adapter for the existing SSO endpoints. Business rules live in the service. */
@jakarta.ws.rs.ext.Provider
public class CentralSsoResource {
    private final CentralTokenService tokenService;
    private final SsoClientAuthenticator clientAuthenticator;
    private final TokenHandoffPage handoffPage;

    // Required by REST discovery; the provider supplies the wired instance for requests.
    public CentralSsoResource() {
        this(null, null, null);
    }

    public CentralSsoResource(
            CentralTokenService tokenService, SsoClientAuthenticator clientAuthenticator,
            TokenHandoffPage handoffPage) {
        this.tokenService = tokenService;
        this.clientAuthenticator = clientAuthenticator;
        this.handoffPage = handoffPage;
    }

    @GET
    @Path("status")
    @Produces(MediaType.APPLICATION_JSON)
    public Response getStatus() {
        return json(Map.of("issuer", tokenService.getIssuer(), "temporary_sso", true));
    }

    @GET
    @Path("submit.js")
    @Produces("application/javascript")
    public Response getSubmitScript() {
        return Response.ok("document.getElementById('handoff').submit();", "application/javascript")
                .header("Cache-Control", "no-store").build();
    }

    @POST
    @Path("bootstrap")
    @Consumes(MediaType.APPLICATION_FORM_URLENCODED)
    @Produces(MediaType.APPLICATION_JSON)
    public Response bootstrap(@FormParam("assertion") String assertion) {
        return json(tokenService.issueCentralToken(clientAuthenticator.authenticate(), assertion));
    }

    @POST
    @Path("authorize")
    @Consumes(MediaType.APPLICATION_FORM_URLENCODED)
    @Produces(MediaType.TEXT_HTML)
    public Response authorize(@FormParam("assertion") String assertion) {
        try {
            String html = handoffPage.render(tokenService.prepareHandoff(assertion));
            return Response.ok(html, MediaType.TEXT_HTML_TYPE)
                    .header("Cache-Control", "no-store").header("Referrer-Policy", "origin").build();
        } catch (WebApplicationException error) {
            throw error;
        } catch (Exception error) {
            throw new BadRequestException("Handoff validation failed");
        }
    }

    @POST
    @Path("introspect")
    @Consumes(MediaType.APPLICATION_FORM_URLENCODED)
    @Produces(MediaType.APPLICATION_JSON)
    public Response introspect(@FormParam("token") String token) {
        long started = System.nanoTime();
        ClientModel client = null;
        int status = 500;
        Boolean active = null;
        try {
            client = clientAuthenticator.authenticate();
            Map<String, Object> result = tokenService.introspectToken(client, token);
            active = Boolean.TRUE.equals(result.get("active"));
            status = 200;
            return json(result);
        } catch (WebApplicationException error) {
            status = error.getResponse().getStatus();
            throw error;
        } finally {
            Map<String, Object> fields = new LinkedHashMap<>();
            fields.put("from", client == null ? "unknown" : client.getClientId());
            fields.put("to", "keycloak");
            fields.put("realm", client == null ? "unknown" : client.getRealm().getName());
            fields.put("method", "POST");
            fields.put("path", "/temporary-sso-poc/introspect");
            fields.put("status", status);
            fields.put("active", active);
            fields.put("outcome", active == null ? "error" : active ? "active" : "inactive");
            fields.put("durationMs", (System.nanoTime() - started) / 1_000_000);
            HeartbeatLog.write("token_introspection", fields);
        }
    }

    @POST
    @Path("revoke")
    @Consumes(MediaType.APPLICATION_FORM_URLENCODED)
    public Response revoke(@FormParam("token") String token) {
        tokenService.revokeToken(clientAuthenticator.authenticate(), token);
        return json(Map.of("revoked", true));
    }

    @POST
    @Path("logout-user")
    @Consumes(MediaType.APPLICATION_FORM_URLENCODED)
    @Produces(MediaType.APPLICATION_JSON)
    public Response logoutUser(@FormParam("assertion") String assertion) {
        int revoked = tokenService.revokeUserTokens(assertion);
        return json(Map.of("revoked", revoked, "logout_urls", tokenService.getLogoutUrls()));
    }

    private Response json(Object value) {
        return Response.ok(value, MediaType.APPLICATION_JSON_TYPE).header("Cache-Control", "no-store").build();
    }
}
