package lab.sso.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.ws.rs.BadRequestException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lab.sso.heartbeat.IdpHeartbeatSettings;
import lab.sso.config.RealmLogoutTargets;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.utils.RepresentationToModel;
import org.keycloak.representations.idm.RealmRepresentation;

/** Saves native session fields and dynamic logout endpoints in one Keycloak transaction. */
public final class SessionLogoutSettingsService {
    private static final Set<String> SESSION_FIELDS = Set.of(
            "ssoSessionIdleTimeout", "ssoSessionMaxLifespan",
            "ssoSessionIdleTimeoutRememberMe", "ssoSessionMaxLifespanRememberMe",
            "clientSessionIdleTimeout", "clientSessionMaxLifespan",
            "offlineSessionIdleTimeout", "clientOfflineSessionIdleTimeout",
            "offlineSessionMaxLifespanEnabled", "offlineSessionMaxLifespan",
            "clientOfflineSessionMaxLifespan", "accessCodeLifespanLogin", "accessCodeLifespanUserAction");
    private final KeycloakSession session;
    private final RealmModel realm;

    public SessionLogoutSettingsService(KeycloakSession session, RealmModel realm) {
        this.session = session;
        this.realm = realm;
    }

    public Map<String, Object> read() {
        return Map.of("logoutUrls", new RealmLogoutTargets(realm).read());
    }

    public void update(Map<String, Object> body) {
        if (body == null || !(body.get("sessionSettings") instanceof Map<?, ?> settings)
                || !(body.get("logoutUrls") instanceof List<?> targets)) {
            throw new BadRequestException("Session settings and logout targets are required.");
        }
        Map<String, Object> checkedSettings = new LinkedHashMap<>();
        for (var entry : settings.entrySet()) {
            if (!(entry.getKey() instanceof String key) || !SESSION_FIELDS.contains(key)) {
                throw new BadRequestException("Unsupported session setting.");
            }
            Object value = entry.getValue();
            if (key.equals("offlineSessionMaxLifespanEnabled")) {
                if (!(value instanceof Boolean)) throw new BadRequestException("Invalid session flag.");
            } else if (!(value instanceof Number number) || number.longValue() < 0
                    || number.longValue() > Integer.MAX_VALUE || number.doubleValue() != number.longValue()) {
                throw new BadRequestException("Session durations must be non-negative whole seconds.");
            }
            checkedSettings.put(key, value);
        }
        java.util.LinkedHashSet<String> urls = new java.util.LinkedHashSet<>();
        for (Object target : targets) {
            if (!(target instanceof String value)) throw new BadRequestException("Invalid logout URL.");
            String url = value.trim();
            try { IdpHeartbeatSettings.requireHttpUrl(url); }
            catch (IllegalArgumentException error) { throw new BadRequestException("Every logout URL must be a valid HTTP or HTTPS URL."); }
            if (url.length() > 2048) throw new BadRequestException("Logout URLs must not exceed 2048 characters.");
            if (!urls.add(url)) throw new BadRequestException("Duplicate logout URL.");
        }
        RealmRepresentation representation = new ObjectMapper().convertValue(checkedSettings, RealmRepresentation.class);
        // Validate the entire request before writing session fields or logout URLs.
        RepresentationToModel.updateRealm(representation, realm, session);
        new RealmLogoutTargets(realm).replace(List.copyOf(urls));
    }
}
