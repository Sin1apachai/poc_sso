package lab.sso.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Arrays;
import java.util.List;
import org.keycloak.models.RealmModel;

/** Realm-wide URL list: logout destinations do not require a Client ID. */
public final class RealmLogoutTargets {
    public static final String ATTRIBUTE = "temporary.sso.logout-urls";
    private final RealmModel realm;

    public RealmLogoutTargets(RealmModel realm) { this.realm = realm; }

    public List<String> read() {
        String value = realm.getAttribute(ATTRIBUTE);
        if (value == null || value.isBlank()) return List.of();
        try {
            return List.copyOf(Arrays.asList(new ObjectMapper().readValue(value, String[].class)));
        } catch (Exception error) {
            throw new IllegalArgumentException("Invalid logout URL configuration", error);
        }
    }

    public void replace(List<String> urls) {
        try {
            realm.setAttribute(ATTRIBUTE, new ObjectMapper().writeValueAsString(urls));
        } catch (Exception error) {
            throw new IllegalArgumentException("Unable to store logout URLs", error);
        }
    }
}
