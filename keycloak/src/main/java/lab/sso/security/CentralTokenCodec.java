package lab.sso.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.Objects;
import java.util.UUID;
import lab.sso.config.RealmSsoConfiguration;
import lab.sso.model.ApplicationPermissions;
import lab.sso.model.IdentityAssertion;
import org.keycloak.models.ClientModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.representations.AccessToken;

/** Encodes central tokens and delivery proofs using the realm's signing keys. */
public final class CentralTokenCodec {
    private final KeycloakSession session;
    private final RealmSsoConfiguration configuration;

    public CentralTokenCodec(KeycloakSession session, RealmSsoConfiguration configuration) {
        this.session = session;
        this.configuration = configuration;
    }

    public AccessToken createCentralToken(
            IdentityAssertion assertion, ClientModel authority, ApplicationPermissions permissions,
            String generation, int lifetimeSeconds) {
        long now = System.currentTimeMillis() / 1000;
        AccessToken token = new AccessToken();
        token.id(UUID.randomUUID().toString());
        token.subject(assertion.getCentralSubject());
        token.issuer(configuration.getIssuer());
        token.audience(configuration.getAudience());
        token.issuedFor(authority.getClientId());
        token.type("Bearer");
        token.iat(now);
        token.exp(now + lifetimeSeconds);
        token.setEmail(assertion.getEmail());
        token.setOtherClaims("idp", configuration.getIdentityProviderAlias());
        token.setOtherClaims("app_permissions", permissions.asClaim());
        token.setOtherClaims("temporary_identity", true);
        token.setOtherClaims("central_shared", true);
        token.setOtherClaims("bootstrap_generation", generation);
        return token;
    }

    public String encode(AccessToken token, ClientModel client) {
        session.getContext().setClient(client);
        return session.tokens().encode(token);
    }

    public AccessToken decodeActiveCentralToken(String encodedToken) {
        try {
            AccessToken token = session.tokens().decode(encodedToken, AccessToken.class);
            if (token == null || !Objects.equals(token.getIssuer(), configuration.getIssuer())
                    || !token.hasAudience(configuration.getAudience())
                    || !Objects.equals(token.getIssuedFor(), configuration.getAuthorityClientId())
                    || token.getExp() == null || token.getExp() <= System.currentTimeMillis() / 1000
                    || !token.isActive()
                    || !Boolean.TRUE.equals(token.getOtherClaims().get("temporary_identity"))
                    || !Boolean.TRUE.equals(token.getOtherClaims().get("central_shared"))) {
                return null;
            }
            return token;
        } catch (Exception error) {
            return null;
        }
    }

    public String createDeliveryProof(
            AccessToken centralToken, String encodedToken, ClientModel target,
            IdentityAssertion assertion, String state, String challenge) {
        long now = System.currentTimeMillis() / 1000;
        AccessToken proof = new AccessToken();
        proof.id(UUID.randomUUID().toString());
        proof.subject(centralToken.getSubject());
        proof.issuer(configuration.getIssuer());
        proof.audience(target.getClientId());
        proof.type("sso_handoff");
        proof.iat(now);
        proof.exp(Math.min(now + 60, centralToken.getExp()));
        proof.setOtherClaims("token_use", "sso_handoff");
        proof.setOtherClaims("sso_state", state);
        proof.setOtherClaims("sso_challenge", challenge);
        proof.setOtherClaims("central_jti", centralToken.getId());
        proof.setOtherClaims("source_issued_ms", assertion.getSourceIssuedAtMillis());
        proof.setOtherClaims("token_hash", tokenHash(encodedToken));
        return encode(proof, target);
    }

    private String tokenHash(String encodedToken) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(encodedToken.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is unavailable", error);
        }
    }
}
