package lab.sso.provider;

import java.util.List;
import org.keycloak.Config;
import org.keycloak.component.ComponentModel;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.provider.ProviderConfigProperty;
import org.keycloak.services.ui.extend.UiPageProvider;
import org.keycloak.services.ui.extend.UiPageProviderFactory;

/** Registers the existing SSO Tokens page, rendered by the sso-admin theme. */
public class SsoTokenMenuProviderFactory implements UiPageProvider, UiPageProviderFactory<ComponentModel> {
    @Override
    public String getId() {
        return "SSO Tokens";
    }

    @Override
    public String getHelpText() {
        return "Active tokens in the temporary SSO cache";
    }

    @Override
    public List<ProviderConfigProperty> getConfigProperties() {
        return List.of();
    }

    @Override
    public void init(Config.Scope configuration) {
        // This page has no component configuration fields.
    }

    @Override
    public void postInit(KeycloakSessionFactory factory) {
        // No global initialization is required.
    }

    @Override
    public void close() {
        // The menu provider is stateless.
    }
}
