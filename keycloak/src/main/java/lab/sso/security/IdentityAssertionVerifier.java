package lab.sso.security;

import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.ForbiddenException;
import jakarta.ws.rs.WebApplicationException;
import java.util.Arrays;
import java.util.Objects;
import lab.sso.config.RealmSsoConfiguration;
import lab.sso.model.IdentityAssertion;
import org.keycloak.TokenVerifier;
import org.keycloak.broker.provider.util.SimpleHttp;
import org.keycloak.jose.jwk.JWK;
import org.keycloak.jose.jwk.JWKParser;
import org.keycloak.jose.jwk.JSONWebKeySet;
import org.keycloak.models.IdentityProviderModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.representations.JsonWebToken;

/** Verifies the identity provider's signature, issuer, audience, purpose and lifetime. */
public final class IdentityAssertionVerifier {
    private final KeycloakSession session;
    private final RealmModel realm;
    private final RealmSsoConfiguration configuration;

    public IdentityAssertionVerifier(
            KeycloakSession session, RealmModel realm, RealmSsoConfiguration configuration) {
        this.session = session;
        this.realm = realm;
        this.configuration = configuration;
    }

    public IdentityAssertion verify(String encodedAssertion, String expectedPurpose) {
        try {
            if (!realm.isEnabled() || encodedAssertion == null || encodedAssertion.length() > 16384) {
                throw new BadRequestException("Invalid proof");
            }
            IdentityProviderModel provider = session.identityProviders()
                    .getByAlias(configuration.getIdentityProviderAlias());
            if (provider == null || !provider.isEnabled()) {
                throw new ForbiddenException("Identity provider disabled");
            }
            TokenVerifier<JsonWebToken> verifier = TokenVerifier.create(encodedAssertion, JsonWebToken.class);
            verifier.parse();
            if (!"RS256".equals(verifier.getHeader().getRawAlgorithm())) {
                throw new BadRequestException("Invalid algorithm");
            }
            JSONWebKeySet keys = SimpleHttp.doGet(provider.getConfig().get("jwksUrl"), session)
                    .connectTimeoutMillis(3000).socketTimeOutMillis(3000)
                    .setMaxConsumedResponseSize(65536).asJson(JSONWebKeySet.class);
            String signingKeyId = verifier.getHeader().getKeyId();
            JWK signingKey = Arrays.stream(keys.getKeys())
                    .filter(key -> Objects.equals(key.getKeyId(), signingKeyId))
                    .findFirst().orElseThrow(() -> new BadRequestException("Unknown signing key"));
            verifier.publicKey(JWKParser.create(signingKey).toPublicKey()).verify();
            JsonWebToken claims = verifier.getToken();
            validateClaims(claims, provider.getConfig().get("issuer"), expectedPurpose);
            return new IdentityAssertion(claims);
        } catch (WebApplicationException error) {
            throw error;
        } catch (Exception error) {
            // Never return assertions, credentials or internal exception details.
            throw new BadRequestException("Proof validation failed");
        }
    }

    private void validateClaims(JsonWebToken claims, String trustedIssuer, String expectedPurpose) {
        long now = System.currentTimeMillis() / 1000;
        if (!Objects.equals(trustedIssuer, claims.getIssuer())
                || !claims.hasAudience(configuration.getIssuer()) || claims.getAudience().length != 1
                || claims.getSubject() == null || claims.getSubject().isBlank() || claims.getId() == null
                || claims.getIat() == null || claims.getExp() == null || claims.getExp() <= now
                || claims.getIat() > now || claims.getExp() - claims.getIat() > 60
                || !expectedPurpose.equals(claims.getOtherClaims().get("token_use"))) {
            throw new BadRequestException("Invalid proof claims");
        }
    }
}
