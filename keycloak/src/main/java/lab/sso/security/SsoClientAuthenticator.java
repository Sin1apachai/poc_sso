package lab.sso.security;

import lab.sso.config.RealmSsoConfiguration;
import org.keycloak.events.EventBuilder;
import org.keycloak.events.EventType;
import org.keycloak.models.ClientModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.protocol.oidc.utils.AuthorizeClientUtil;
import org.keycloak.services.cors.Cors;

public final class SsoClientAuthenticator {
    private final KeycloakSession session;
    private final RealmModel realm;
    private final RealmSsoConfiguration configuration;

    public SsoClientAuthenticator(
            KeycloakSession session, RealmModel realm, RealmSsoConfiguration configuration) {
        this.session = session;
        this.realm = realm;
        this.configuration = configuration;
    }

    public ClientModel authenticate() {
        EventBuilder event = new EventBuilder(realm, session).event(EventType.CLIENT_LOGIN);
        ClientModel client = AuthorizeClientUtil.authorizeClient(session, event, Cors.builder()).getClient();
        return configuration.requireSsoClient(client.getClientId());
    }
}
