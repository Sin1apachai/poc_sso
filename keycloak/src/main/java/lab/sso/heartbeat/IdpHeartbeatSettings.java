package lab.sso.heartbeat;

import java.net.URI;
import org.keycloak.models.RealmModel;

/** Realm-level settings edited under Realm settings > Sessions > Logout. */
public record IdpHeartbeatSettings(boolean enabled, int intervalSeconds, int failureThreshold, URI healthUrl) {
    public static final String PREFIX = "temporary.sso.idp-heartbeat.";

    public static IdpHeartbeatSettings fromRealm(RealmModel realm) {
        boolean enabled = "true".equals(realm.getAttribute(PREFIX + "enabled"));
        if (!enabled) return new IdpHeartbeatSettings(false, 60, 3, null);
        int interval = readPositiveInteger(realm, "interval-seconds", 60, 86400);
        int threshold = readPositiveInteger(realm, "failure-threshold", 3, 100);
        URI healthUrl = requireHttpUrl(realm.getAttribute(PREFIX + "health-url"));
        requireHttpUrl(realm.getAttribute("temporary.sso.issuer"));
        return new IdpHeartbeatSettings(true, interval, threshold, healthUrl);
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
