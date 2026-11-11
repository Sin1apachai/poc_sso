package lab.sso.web;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Map;
import lab.sso.service.SessionLogoutSettingsService;
import org.keycloak.events.admin.OperationType;
import org.keycloak.events.admin.ResourceType;
import org.keycloak.services.resources.admin.AdminEventBuilder;
import org.keycloak.services.resources.admin.fgap.AdminPermissionEvaluator;

@jakarta.ws.rs.ext.Provider
public final class SessionLogoutSettingsResource {
    private final SessionLogoutSettingsService settings;
    private final AdminPermissionEvaluator permissions;
    private final AdminEventBuilder event;

    public SessionLogoutSettingsResource() { this(null, null, null); }

    public SessionLogoutSettingsResource(SessionLogoutSettingsService settings,
            AdminPermissionEvaluator permissions, AdminEventBuilder event) {
        this.settings = settings;
        this.permissions = permissions;
        this.event = event;
    }

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Response read() {
        permissions.requireRealmAdmin();
        return Response.ok(settings.read()).header("Cache-Control", "no-store").build();
    }

    @PUT
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response update(Map<String, Object> body) {
        permissions.requireRealmAdmin();
        settings.update(body);
        event.operation(OperationType.UPDATE).resource(ResourceType.REALM)
                .resourcePath("sso-session-settings").representation(body).success();
        return Response.noContent().header("Cache-Control", "no-store").build();
    }
}
