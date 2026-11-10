package lab.sso;

import java.util.List;
import org.keycloak.Config;
import org.keycloak.component.ComponentModel;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.provider.ProviderConfigProperty;
import org.keycloak.services.ui.extend.UiPageProvider;
import org.keycloak.services.ui.extend.UiPageProviderFactory;

/** Register a native navigation item; its view is rendered by the sso-admin theme. */
public class TokenMenuProvider implements UiPageProvider, UiPageProviderFactory<ComponentModel> {
    @Override public String getId() { return "SSO Tokens"; }
    @Override public String getHelpText() { return "Active tokens in the temporary SSO cache"; }
    @Override public List<ProviderConfigProperty> getConfigProperties() { return List.of(); }
    @Override public void init(Config.Scope config) { }
    @Override public void postInit(KeycloakSessionFactory factory) { }
    @Override public void close() { }
}
