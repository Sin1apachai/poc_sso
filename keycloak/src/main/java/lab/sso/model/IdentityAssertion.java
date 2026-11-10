package lab.sso.model;

import jakarta.ws.rs.BadRequestException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.keycloak.representations.JsonWebToken;

/** A verified assertion from the identity provider, with typed claim access. */
public final class IdentityAssertion {
    private final JsonWebToken claims;

    public IdentityAssertion(JsonWebToken claims) {
        this.claims = claims;
    }

    public String getId() {
        return claims.getId();
    }

    public long getExpiresAt() {
        return claims.getExp();
    }

    public String getCentralSubject() {
        String identity = claims.getIssuer() + "::" + claims.getSubject();
        return UUID.nameUUIDFromBytes(identity.getBytes(StandardCharsets.UTF_8)).toString();
    }

    public String getSourceSessionId() {
        return requireText("c_session");
    }

    public String getEmail() {
        return requireText("email");
    }

    public long getSourceIssuedAtMillis() {
        Object value = claims.getOtherClaims().get("source_issued_ms");
        if (!(value instanceof Number timestamp)) {
            throw new BadRequestException("Invalid source timestamp");
        }
        return timestamp.longValue();
    }

    public String requireText(String name) {
        Object value = claims.getOtherClaims().get(name);
        if (!(value instanceof String text) || text.isBlank()) {
            throw new BadRequestException("Missing proof claim");
        }
        return text;
    }

    public Object getPermissionsClaim() {
        return claims.getOtherClaims().get("app_permissions");
    }
}
