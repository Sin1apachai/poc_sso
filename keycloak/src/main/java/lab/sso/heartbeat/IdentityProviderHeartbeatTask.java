package lab.sso.heartbeat;

import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import lab.sso.config.RealmSsoConfiguration;
import lab.sso.repository.TemporaryTokenRepository;
import lab.sso.service.IdentityProviderLogoutService;
import java.lang.System.Logger;
import java.lang.System.Logger.Level;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.timer.ScheduledTask;

/** Single-node PoC monitor. Keycloak's scheduler opens a fresh session/transaction per tick. */
public final class IdentityProviderHeartbeatTask implements ScheduledTask {
    public static final String TASK_NAME = "sso-idp-heartbeat";
    private static final Logger LOG = System.getLogger(IdentityProviderHeartbeatTask.class.getName());
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build();
    private final Map<String, ProbeState> states = new HashMap<>();

    @Override
    public String getTaskName() {
        return TASK_NAME;
    }

    @Override
    public void run(KeycloakSession session) {
        Set<String> existingRealms = new LinkedHashSet<>();
        for (RealmModel realm : session.realms().getRealmsStream().toList()) {
            existingRealms.add(realm.getId());
            if (!realm.isEnabled() || realm.getAttribute("temporary.sso.idp") == null) continue;
            try {
                session.getContext().setRealm(realm);
                checkRealm(session, realm);
            } catch (RuntimeException error) {
                // A configuration error is not evidence of an IdP outage.
                LOG.log(Level.WARNING, "Unable to run IdP heartbeat for realm {0} ({1})", realm.getName(), error.getClass().getSimpleName());
            }
        }
        states.keySet().retainAll(existingRealms);
    }

    private void checkRealm(KeycloakSession session, RealmModel realm) {
        IdpHeartbeatSettings settings = IdpHeartbeatSettings.fromRealm(realm);
        TemporaryTokenRepository repository = new TemporaryTokenRepository(session, realm);
        if (!settings.enabled()) {
            repository.markIdentityProviderAvailable();
            states.remove(realm.getId());
            return;
        }
        ProbeState state = states.computeIfAbsent(realm.getId(), ignored -> new ProbeState());
        long now = System.currentTimeMillis();
        if (!settings.equals(state.settings)) {
            state.settings = settings;
            state.lastCheckedMillis = 0;
            state.failures = 0;
        }
        if (now - state.lastCheckedMillis < settings.intervalSeconds() * 1000L) return;
        state.lastCheckedMillis = now;
        boolean healthy = isHealthy(settings);
        if (healthy) {
            state.failures = 0;
            if (state.down) LOG.log(Level.INFO, "IdP recovered for realm {0}", realm.getName());
            state.down = false;
        } else {
            state.failures = Math.min(settings.failureThreshold(), state.failures + 1);
            if (state.failures >= settings.failureThreshold()) {
                if (!state.down) {
                    state.down = true;
                    state.logoutCutoffMillis = System.currentTimeMillis();
                    state.pendingClients.clear();
                    new RealmSsoConfiguration(session, realm).describeSsoClients()
                            .forEach(client -> state.pendingClients.add(client.get("clientId")));
                    LOG.log(Level.WARNING, "IdP unavailable for realm {0}; revoking central tokens and notifying clients", realm.getName());
                }
                repository.markIdentityProviderUnavailable(state.logoutCutoffMillis);
            }
        }
        IdentityProviderLogoutService logout = new IdentityProviderLogoutService(session, realm, httpClient);
        state.pendingClients.removeIf(clientId -> logout.notifyClient(clientId, state.logoutCutoffMillis));
        if (healthy) repository.markIdentityProviderAvailable();
    }

    private boolean isHealthy(IdpHeartbeatSettings settings) {
        try {
            HttpRequest request = HttpRequest.newBuilder(settings.healthUrl()).timeout(Duration.ofSeconds(3)).GET().build();
            int status = httpClient.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
            return status >= 200 && status < 300;
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return false;
        } catch (Exception error) {
            return false;
        }
    }

    private static final class ProbeState {
        private IdpHeartbeatSettings settings;
        private long lastCheckedMillis;
        private int failures;
        private boolean down;
        private long logoutCutoffMillis;
        private final Set<String> pendingClients = new LinkedHashSet<>();
    }
}
