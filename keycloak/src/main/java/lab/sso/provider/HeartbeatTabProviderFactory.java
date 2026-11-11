package lab.sso.provider;

import java.util.List;
import java.util.Map;
import org.keycloak.Config;
import org.keycloak.component.ComponentModel;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.provider.ProviderConfigProperty;
import org.keycloak.services.ui.extend.UiTabProvider;
import org.keycloak.services.ui.extend.UiTabProviderFactory;

/** Registers Heartbeat alongside the native Realm settings tabs. */
public final class HeartbeatTabProviderFactory implements UiTabProvider, UiTabProviderFactory<ComponentModel> {
    @Override
    public String getId() { return "Heartbeat"; }

    @Override
    public String getPath() { return "/:realm/realm-settings/:tab"; }

    @Override
    public Map<String, String> getParams() { return Map.of("tab", "heartbeat"); }

    @Override
    public String getHelpText() { return "Identity provider health checks and SSO logout"; }

    @Override
    public List<ProviderConfigProperty> getConfigProperties() { return List.of(); }

    @Override
    public void init(Config.Scope configuration) {}

    @Override
    public void postInit(KeycloakSessionFactory factory) {}

    @Override
    public void close() {}
}
