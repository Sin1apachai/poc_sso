package lab.sso;

import java.util.*;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.*;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.services.resources.admin.fgap.AdminPermissionEvaluator;

@jakarta.ws.rs.ext.Provider
public class TokenAdminResource {
    private final TemporaryTokenStore tokens;
    private final AdminPermissionEvaluator auth;
    private final SsoConfiguration configuration;

    // Required for CDI discovery; the admin provider constructs the authenticated instance.
    public TokenAdminResource() {
        this.tokens = null;
        this.auth = null;
        this.configuration = null;
    }

    TokenAdminResource(KeycloakSession session, RealmModel realm, AdminPermissionEvaluator auth) {
        this.tokens = new TemporaryTokenStore(session, realm);
        this.auth = auth;
        this.configuration = new SsoConfiguration(session,realm);
    }

    @GET @Produces(MediaType.APPLICATION_JSON)
    public Response list(@QueryParam("first") @DefaultValue("0") int first,
            @QueryParam("max") @DefaultValue("25") int max,
            @QueryParam("client") @DefaultValue("") String client,
            @QueryParam("search") @DefaultValue("") String search) {
        // The Admin REST pipeline authenticates the bearer. Require full realm administration
        // before returning user-identifying metadata, not merely permission to query configuration.
        auth.requireRealmAdmin();
        if (first < 0 || max < 1 || max > 100 || search.length() > 200
                || (!client.isEmpty() && configuration.clients().stream().noneMatch(c -> client.equals(c.get("clientId"))))) {
            throw new BadRequestException("Invalid token list filter");
        }
        String systemId = client.isEmpty() ? "" : configuration.clients().stream().filter(c -> client.equals(c.get("clientId"))).findFirst().orElseThrow().get("systemId");
        String query = search.trim().toLowerCase(Locale.ROOT);
        List<Map<String,Object>> items = tokens.list().stream()
                .filter(item -> client.isEmpty() || client.equals(item.get("clientId")) || (!systemId.isEmpty() && ((List<?>)item.get("permissions")).contains(systemId+":read")))
                .filter(item -> query.isEmpty() || (item.get("email") + " " + item.get("sub") + " " + item.get("id"))
                        .toLowerCase(Locale.ROOT).contains(query))
                .toList();
        int start = Math.min(first, items.size());
        int end = start + Math.min(max, items.size() - start);
        return Response.ok(Map.of("items", items.subList(start, end), "total", items.size(),
                "clients", configuration.clients(), "first", first, "max", max, "serverTime", System.currentTimeMillis() / 1000), MediaType.APPLICATION_JSON_TYPE)
                .header("Cache-Control", "no-store").build();
    }
}
