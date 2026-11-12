package lab.sso.web;

import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import lab.sso.heartbeat.HeartbeatProbe;
import lab.sso.heartbeat.HeartbeatLog;
import lab.sso.heartbeat.IdpHeartbeatSettings;
import org.keycloak.models.IdentityProviderModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.services.resources.admin.fgap.AdminPermissionEvaluator;

/** Tests only the saved IdP URL; never changes monitor state or revokes sessions. */
@jakarta.ws.rs.ext.Provider
public final class HeartbeatTestResource {
    private final KeycloakSession session;
    private final HeartbeatProbe probe;
    private final AdminPermissionEvaluator permissions;

    public HeartbeatTestResource() {
        this(null, null, null);
    }

    public HeartbeatTestResource(KeycloakSession session, HeartbeatProbe probe,
            AdminPermissionEvaluator permissions) {
        this.session = session;
        this.probe = probe;
        this.permissions = permissions;
    }

    @POST
    @Path("{alias}/test")
    @Produces(MediaType.APPLICATION_JSON)
    public Response test(@PathParam("alias") String alias) {
        permissions.requireRealmAdmin();
        IdentityProviderModel provider = session.identityProviders().getByAlias(alias);
        if (provider == null) return response(404, Map.of("error", "Identity provider not found."));
        URI healthUrl;
        try {
            healthUrl = IdpHeartbeatSettings.requireHttpUrl(
                    provider.getConfig().get(IdpHeartbeatSettings.HEALTH_URL_CONFIG));
        } catch (IllegalArgumentException error) {
            return response(400, Map.of("error", "Save a valid HTTP or HTTPS Health Check URL first."));
        }
        HeartbeatProbe.Result result = probe.check(healthUrl, HeartbeatProbe.Source.MANUAL);
        HeartbeatLog.idpCheck(session.getContext().getRealm().getName(), alias,
                HeartbeatProbe.Source.MANUAL, result, Map.of());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("idpAlias", alias);
        body.put("healthy", result.healthy());
        body.put("httpStatus", result.httpStatus());
        body.put("durationMillis", result.durationMillis());
        body.put("error", result.error());
        return response(200, body);
    }

    private Response response(int status, Map<String, ?> body) {
        return Response.status(status).entity(body).type(MediaType.APPLICATION_JSON_TYPE)
                .header("Cache-Control", "no-store").build();
    }
}
