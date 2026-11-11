package lab.sso.provider;

import lab.sso.service.SessionLogoutSettingsService;
import lab.sso.web.SessionLogoutSettingsResource;
import org.keycloak.Config;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.models.RealmModel;
import org.keycloak.services.resources.admin.AdminEventBuilder;
import org.keycloak.services.resources.admin.ext.AdminRealmResourceProvider;
import org.keycloak.services.resources.admin.ext.AdminRealmResourceProviderFactory;
import org.keycloak.services.resources.admin.fgap.AdminPermissionEvaluator;

public final class SessionLogoutSettingsProviderFactory
        implements AdminRealmResourceProvider, AdminRealmResourceProviderFactory {
    @Override
    public String getId() { return "sso-session-settings"; }

    @Override
    public AdminRealmResourceProvider create(KeycloakSession session) { return this; }

    @Override
    public Object getResource(KeycloakSession session, RealmModel realm,
            AdminPermissionEvaluator permissions, AdminEventBuilder event) {
        return new SessionLogoutSettingsResource(new SessionLogoutSettingsService(session, realm), permissions, event);
    }

    @Override
    public void init(Config.Scope configuration) {}

    @Override
    public void postInit(KeycloakSessionFactory factory) {}

    @Override
    public void close() {}
}
