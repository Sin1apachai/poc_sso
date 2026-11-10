package lab.sso.provider;

import lab.sso.config.RealmSsoConfiguration;
import lab.sso.repository.TemporaryTokenRepository;
import lab.sso.service.TokenCatalogService;
import lab.sso.web.TokenCatalogResource;
import org.keycloak.Config;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.models.RealmModel;
import org.keycloak.services.resources.admin.AdminEventBuilder;
import org.keycloak.services.resources.admin.ext.AdminRealmResourceProvider;
import org.keycloak.services.resources.admin.ext.AdminRealmResourceProviderFactory;
import org.keycloak.services.resources.admin.fgap.AdminPermissionEvaluator;

/** Wires the metadata API to the native Admin REST permission evaluator. */
public class SsoTokenAdminProviderFactory implements AdminRealmResourceProvider, AdminRealmResourceProviderFactory {
    @Override
    public String getId() {
        return "temporary-sso-tokens";
    }

    @Override
    public AdminRealmResourceProvider create(KeycloakSession session) {
        return this;
    }

    @Override
    public Object getResource(KeycloakSession session, RealmModel realm,
            AdminPermissionEvaluator permissions, AdminEventBuilder event) {
        RealmSsoConfiguration configuration = new RealmSsoConfiguration(session, realm);
        TemporaryTokenRepository repository = new TemporaryTokenRepository(session, realm);
        return new TokenCatalogResource(new TokenCatalogService(configuration, repository), permissions);
    }

    @Override
    public void init(Config.Scope configuration) {
        // Realm settings are resolved for each request.
    }

    @Override
    public void postInit(KeycloakSessionFactory factory) {
        // No global initialization is required.
    }

    @Override
    public void close() {
        // The provider is stateless.
    }
}
