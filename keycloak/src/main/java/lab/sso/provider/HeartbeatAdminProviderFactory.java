package lab.sso.provider;

import lab.sso.heartbeat.HeartbeatProbe;
import lab.sso.web.HeartbeatTestResource;
import org.keycloak.Config;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.models.RealmModel;
import org.keycloak.services.resources.admin.AdminEventBuilder;
import org.keycloak.services.resources.admin.ext.AdminRealmResourceProvider;
import org.keycloak.services.resources.admin.ext.AdminRealmResourceProviderFactory;
import org.keycloak.services.resources.admin.fgap.AdminPermissionEvaluator;

/** Registers the authenticated IdP heartbeat test under the native realm admin API. */
public final class HeartbeatAdminProviderFactory
        implements AdminRealmResourceProvider, AdminRealmResourceProviderFactory {
    private final HeartbeatProbe probe = new HeartbeatProbe();

    @Override
    public String getId() { return "idp-heartbeat"; }

    @Override
    public AdminRealmResourceProvider create(KeycloakSession session) { return this; }

    @Override
    public Object getResource(KeycloakSession session, RealmModel realm,
            AdminPermissionEvaluator permissions, AdminEventBuilder event) {
        return new HeartbeatTestResource(session, probe, permissions);
    }

    @Override
    public void init(Config.Scope configuration) {}

    @Override
    public void postInit(KeycloakSessionFactory factory) {}

    @Override
    public void close() {}
}
