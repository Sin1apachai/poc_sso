package lab.sso.model;

import java.util.List;
import java.util.Map;
import org.keycloak.representations.AccessToken;

/** Cache representation. Only toMetadata() may be exposed by the admin API. */
public record StoredCentralToken(
        String id, String subject, String email, String issuingClientId,
        List<String> permissions, long issuedAt, long expiresAt, String encodedToken) {

    public StoredCentralToken {
        permissions = List.copyOf(permissions);
    }

    public static StoredCentralToken fromIssuedToken(
            AccessToken claims, String encodedToken, ApplicationPermissions permissions) {
        return new StoredCentralToken(claims.getId(), claims.getSubject(), claims.getEmail(),
                claims.getIssuedFor(), permissions.getDisplayLabels(), claims.getIat(),
                claims.getExp(), encodedToken);
    }

    public static StoredCentralToken fromCache(String id, Map<String, String> values) {
        String labels = values.get("permissions");
        return new StoredCentralToken(id, values.get("sub"), values.get("email"), values.get("client"),
                labels.isBlank() ? List.of() : List.of(labels.split(",")),
                Long.parseLong(values.get("issued")), Long.parseLong(values.get("expires")), values.get("jwt"));
    }

    public Map<String, String> toCache() {
        return Map.of("sub", subject, "email", email, "client", issuingClientId,
                "permissions", String.join(",", permissions), "issued", Long.toString(issuedAt),
                "expires", Long.toString(expiresAt), "jwt", encodedToken);
    }

    public Map<String, Object> toMetadata() {
        return Map.of("id", id, "sub", subject, "email", email, "clientId", issuingClientId,
                "permissions", permissions, "issuedAt", issuedAt, "expiresAt", expiresAt, "status", "active");
    }
}
