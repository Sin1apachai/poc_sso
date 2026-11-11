package lab.sso.heartbeat;

import java.net.URI;
import org.keycloak.models.IdentityProviderModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;

/** Timing/target selection belongs to the realm; the health URL belongs to the selected IdP. */
public record IdpHeartbeatSettings(
        boolean enabled, int intervalSeconds, int confirmationIntervalSeconds,
        int failureThreshold, String identityProviderAlias, URI healthUrl) {
    public static final String PREFIX = "temporary.sso.idp-heartbeat.";
    public static final String HEALTH_URL_CONFIG = "ssoHealthCheckUrl";

    public static IdpHeartbeatSettings fromRealm(KeycloakSession session, RealmModel realm) {
        boolean enabled = "true".equals(realm.getAttribute(PREFIX + "enabled"));
        if (!enabled) return new IdpHeartbeatSettings(false, 60, 5, 3, null, null);
        int interval = readPositiveInteger(realm, "interval-seconds", 60, 86400);
        int confirmationInterval = readPositiveInteger(realm, "confirmation-interval-seconds", 5, 86400);
        int threshold = readPositiveInteger(realm, "failure-threshold", 3, 100);
        String trustedAlias = realm.getAttribute("temporary.sso.idp");
        String alias = realm.getAttribute(PREFIX + "idp-alias");
        if (alias == null || alias.isBlank()) alias = trustedAlias;
        // This lab authenticates through one IdP. A different target must not revoke its tokens.
        if (trustedAlias == null || !trustedAlias.equals(alias)) {
            throw new IllegalArgumentException("Heartbeat target must be the SSO identity provider");
        }
        IdentityProviderModel provider = session.identityProviders().getByAlias(alias);
        if (provider == null || !provider.isEnabled()) {
            throw new IllegalArgumentException("Heartbeat identity provider unavailable");
        }
        URI healthUrl = requireHttpUrl(provider.getConfig().get(HEALTH_URL_CONFIG));
        requireHttpUrl(realm.getAttribute("temporary.sso.issuer"));
        return new IdpHeartbeatSettings(true, interval, confirmationInterval, threshold, alias, healthUrl);
    }

    public int nextCheckIntervalSeconds(int consecutiveFailures, boolean unavailable) {
        return consecutiveFailures > 0 && !unavailable ? confirmationIntervalSeconds : intervalSeconds;
    }

    public static URI requireHttpUrl(String value) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException("Heartbeat URL missing");
        URI uri = URI.create(value);
        if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
                || uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null) {
            throw new IllegalArgumentException("Invalid heartbeat URL");
        }
        return uri;
    }

    private static int readPositiveInteger(RealmModel realm, String key, int fallback, int maximum) {
        String configured = realm.getAttribute(PREFIX + key);
        int value = configured == null ? fallback : Integer.parseInt(configured);
        if (value < 1 || value > maximum) throw new IllegalArgumentException("Invalid heartbeat setting");
        return value;
    }
}
