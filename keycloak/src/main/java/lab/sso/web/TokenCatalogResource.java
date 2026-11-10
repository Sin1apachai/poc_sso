package lab.sso.web;

import jakarta.ws.rs.DefaultValue;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import lab.sso.service.TokenCatalogService;
import org.keycloak.services.resources.admin.fgap.AdminPermissionEvaluator;

@jakarta.ws.rs.ext.Provider
public class TokenCatalogResource {
    private final TokenCatalogService catalogService;
    private final AdminPermissionEvaluator permissions;

    // CDI discovery requires this constructor; the provider supplies the authenticated instance.
    public TokenCatalogResource() {
        this(null, null);
    }

    public TokenCatalogResource(TokenCatalogService catalogService, AdminPermissionEvaluator permissions) {
        this.catalogService = catalogService;
        this.permissions = permissions;
    }

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Response listTokens(
            @QueryParam("first") @DefaultValue("0") int first,
            @QueryParam("max") @DefaultValue("25") int max,
            @QueryParam("client") @DefaultValue("") String clientId,
            @QueryParam("search") @DefaultValue("") String search) {
        permissions.requireRealmAdmin();
        return Response.ok(catalogService.listTokens(first, max, clientId, search), MediaType.APPLICATION_JSON_TYPE)
                .header("Cache-Control", "no-store").build();
    }
}
