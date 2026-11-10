package lab.sso.config;

import jakarta.ws.rs.ForbiddenException;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import org.keycloak.models.ClientModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.services.Urls;

/** Reads the realm's SSO settings and resolves registered, confidential clients. */
public final class RealmSsoConfiguration {
    private static final String ATTRIBUTE_PREFIX = "temporary.sso.";
    private final KeycloakSession session;
    private final RealmModel realm;

    public RealmSsoConfiguration(KeycloakSession session, RealmModel realm) {
        this.session = session;
        this.realm = realm;
    }

    public String getIssuer() {
        return Urls.realmIssuer(session.getContext().getUri().getBaseUri(), realm.getName());
    }

    public String getAudience() {
        return requireAttribute("audience");
    }

    public String getIdentityProviderAlias() {
        return requireAttribute("idp");
    }

    public String getAuthorityClientId() {
        return requireAttribute("authority-client");
    }

    public ClientModel requireSsoClient(String clientId) {
        ClientModel client = session.clients().getClientByClientId(realm, clientId);
        if (client == null || !client.isEnabled() || client.isPublicClient()
                || !"openid-connect".equals(client.getProtocol()) || !isSsoEnabled(client)) {
            throw new ForbiddenException("SSO client not allowed");
        }
        return client;
    }

    public ClientModel requireAuthorityClient() {
        ClientModel client = requireSsoClient(getAuthorityClientId());
        if (!hasRole(client, "authority")) {
            throw new ForbiddenException("Authority client required");
        }
        return client;
    }

    public boolean isAuthorityClient(ClientModel client) {
        return requireAuthorityClient().getId().equals(client.getId());
    }

    public ClientModel requireApplicationClient(String clientId) {
        ClientModel client = requireSsoClient(clientId);
        if (!hasRole(client, "application")) {
            throw new ForbiddenException("Application client required");
        }
        getSystemId(client);
        return client;
    }

    public String getSystemId(ClientModel client) {
        String systemId = client.getAttribute(ATTRIBUTE_PREFIX + "system-id");
        if (systemId == null || !systemId.matches("[a-zA-Z0-9_.-]{1,100}")) {
            throw new ForbiddenException("Application system ID missing");
        }
        return systemId;
    }

    public Set<String> getApplicationSystemIds() {
        return session.clients().getClientsStream(realm)
                .filter(client -> client.isEnabled() && isSsoEnabled(client)
                        && hasRole(client, "application"))
                .map(this::getSystemId)
                .collect(Collectors.toSet());
    }

    public List<Map<String, String>> describeSsoClients() {
        return session.clients().getClientsStream(realm)
                .filter(client -> client.isEnabled() && isSsoEnabled(client))
                .map(client -> Map.of(
                        "clientId", client.getClientId(),
                        "name", client.getName() == null || client.getName().isBlank()
                                ? client.getClientId() : client.getName(),
                        "systemId", Optional.ofNullable(
                                client.getAttribute(ATTRIBUTE_PREFIX + "system-id")).orElse("")))
                .sorted(Comparator.comparing(client -> client.get("clientId")))
                .toList();
    }

    private String requireAttribute(String name) {
        String value = realm.getAttribute(ATTRIBUTE_PREFIX + name);
        if (value == null || value.isBlank()) {
            throw new ForbiddenException("SSO configuration missing");
        }
        return value;
    }

    private boolean isSsoEnabled(ClientModel client) {
        return "true".equals(client.getAttribute(ATTRIBUTE_PREFIX + "enabled"));
    }

    private boolean hasRole(ClientModel client, String role) {
        return role.equals(client.getAttribute(ATTRIBUTE_PREFIX + "role"));
    }
}
