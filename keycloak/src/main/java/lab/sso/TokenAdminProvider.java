package lab.sso;

import org.keycloak.Config;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.models.RealmModel;
import org.keycloak.services.resources.admin.AdminEventBuilder;
import org.keycloak.services.resources.admin.fgap.AdminPermissionEvaluator;
import org.keycloak.services.resources.admin.ext.AdminRealmResourceProvider;
import org.keycloak.services.resources.admin.ext.AdminRealmResourceProviderFactory;

public class TokenAdminProvider implements AdminRealmResourceProvider, AdminRealmResourceProviderFactory {
    @Override public String getId() { return "temporary-sso-tokens"; }
    @Override public AdminRealmResourceProvider create(KeycloakSession session) { return this; }
    @Override public Object getResource(KeycloakSession session, RealmModel realm,
            AdminPermissionEvaluator auth, AdminEventBuilder event) {
        return new TokenAdminResource(session, realm, auth);
    }
    @Override public void init(Config.Scope config) { }
    @Override public void postInit(KeycloakSessionFactory factory) { }
    @Override public void close() { }
}
