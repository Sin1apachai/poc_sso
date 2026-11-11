package lab.sso.provider;

import lab.sso.config.RealmSsoConfiguration;
import lab.sso.heartbeat.IdentityProviderHeartbeatTask;
import org.keycloak.timer.TimerProvider;
import lab.sso.repository.TemporaryTokenRepository;
import lab.sso.security.CentralTokenCodec;
import lab.sso.security.IdentityAssertionVerifier;
import lab.sso.security.SsoClientAuthenticator;
import lab.sso.service.CentralTokenService;
import lab.sso.web.CentralSsoResource;
import lab.sso.web.TokenHandoffPage;
import org.keycloak.Config;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.models.RealmModel;
import org.keycloak.services.resource.RealmResourceProvider;
import org.keycloak.services.resource.RealmResourceProviderFactory;

/** Composition root: wires request-scoped objects without a shared session or mutable singleton. */
public class CentralSsoResourceProviderFactory implements RealmResourceProviderFactory {
    @Override
    public String getId() {
        return "temporary-sso-poc";
    }

    @Override
    public RealmResourceProvider create(KeycloakSession session) {
        RealmModel realm = session.getContext().getRealm();
        RealmSsoConfiguration configuration = new RealmSsoConfiguration(session, realm);
        TemporaryTokenRepository repository = new TemporaryTokenRepository(session, realm);
        IdentityAssertionVerifier verifier = new IdentityAssertionVerifier(session, realm, configuration);
        CentralTokenCodec codec = new CentralTokenCodec(session, configuration);
        CentralTokenService tokenService = new CentralTokenService(realm, configuration, verifier, codec, repository);
        SsoClientAuthenticator authenticator = new SsoClientAuthenticator(session, realm, configuration);
        CentralSsoResource resource = new CentralSsoResource(
                tokenService, authenticator, new TokenHandoffPage(configuration.getIssuer()));
        return new RealmResourceProvider() {
            @Override
            public Object getResource() {
                return resource;
            }

            @Override
            public void close() {
                // Request-scoped collaborators own no external resources.
            }
        };
    }

    @Override
    public void init(Config.Scope configuration) {
        // Settings are read from the realm, not factory configuration.
    }

    @Override
    public void postInit(KeycloakSessionFactory factory) {
        try (KeycloakSession session = factory.create()) {
            session.getProvider(TimerProvider.class).scheduleTask(
                    new IdentityProviderHeartbeatTask(), 1000L, IdentityProviderHeartbeatTask.TASK_NAME);
        }
    }

    @Override
    public void close() {
        // The factory holds no resources.
    }
}
