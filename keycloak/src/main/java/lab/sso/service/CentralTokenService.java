package lab.sso.service;

import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.ForbiddenException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lab.sso.config.RealmSsoConfiguration;
import lab.sso.model.ApplicationPermissions;
import lab.sso.model.IdentityAssertion;
import lab.sso.model.StoredCentralToken;
import lab.sso.model.TokenHandoff;
import lab.sso.repository.TemporaryTokenRepository;
import lab.sso.security.CentralTokenCodec;
import lab.sso.security.IdentityAssertionVerifier;
import org.keycloak.models.ClientModel;
import org.keycloak.models.RealmModel;
import org.keycloak.representations.AccessToken;

/** Coordinates token issuance, unchanged-token handoff, introspection and revocation. */
public final class CentralTokenService {
    private final RealmModel realm;
    private final RealmSsoConfiguration configuration;
    private final IdentityAssertionVerifier assertionVerifier;
    private final CentralTokenCodec tokenCodec;
    private final TemporaryTokenRepository tokenRepository;

    public CentralTokenService(
            RealmModel realm, RealmSsoConfiguration configuration,
            IdentityAssertionVerifier assertionVerifier, CentralTokenCodec tokenCodec,
            TemporaryTokenRepository tokenRepository) {
        this.realm = realm;
        this.configuration = configuration;
        this.assertionVerifier = assertionVerifier;
        this.tokenCodec = tokenCodec;
        this.tokenRepository = tokenRepository;
    }

    public String getIssuer() {
        return configuration.getIssuer();
    }

    public Map<String, Object> issueCentralToken(ClientModel client, String encodedAssertion) {
        requireAuthority(client);
        IdentityAssertion assertion = assertionVerifier.verify(encodedAssertion, "sso_bootstrap");
        if (!configuration.getAuthorityClientId().equals(assertion.requireText("target_client"))) {
            throw new BadRequestException("Invalid bootstrap target");
        }
        String generation = assertion.requireText("bootstrap_generation");
        try {
            UUID.fromString(generation);
        } catch (IllegalArgumentException error) {
            throw new BadRequestException("Invalid generation");
        }
        ApplicationPermissions permissions = ApplicationPermissions.fromClaim(
                assertion.getPermissionsClaim(), configuration.getApplicationSystemIds());
        int lifetimeSeconds = Math.max(1, Math.min(900, realm.getAccessTokenLifespan()));
        AccessToken claims = tokenCodec.createCentralToken(
                assertion, client, permissions, generation, lifetimeSeconds);
        String encodedToken = tokenCodec.encode(claims, client);
        tokenRepository.storeToken(assertion, StoredCentralToken.fromIssuedToken(claims, encodedToken, permissions));
        return Map.of("access_token", encodedToken, "token_type", "Bearer", "expires_in", lifetimeSeconds);
    }

    public TokenHandoff prepareHandoff(String encodedAssertion) {
        IdentityAssertion assertion = assertionVerifier.verify(encodedAssertion, "sso_login");
        ClientModel application = configuration.requireApplicationClient(assertion.requireText("target_client"));
        String callbackUrl = assertion.requireText("redirect_uri");
        validateCallback(application, callbackUrl);
        String state = assertion.requireText("sso_state");
        String challenge = assertion.requireText("sso_challenge");
        validateRequestBinding(state, challenge);
        StoredCentralToken storedToken = tokenRepository.consumeHandoffAssertion(
                assertion, assertion.requireText("central_jti"));
        AccessToken centralToken = findValidatedToken(storedToken.encodedToken());
        if (centralToken == null || !hasApplicationAccess(centralToken, application)) {
            throw new ForbiddenException("Central permission missing");
        }
        String deliveryProof = tokenCodec.createDeliveryProof(
                centralToken, storedToken.encodedToken(), application, assertion, state, challenge);
        return new TokenHandoff(callbackUrl, state, storedToken.encodedToken(), deliveryProof);
    }

    public Map<String, Object> introspectToken(ClientModel client, String encodedToken) {
        AccessToken token = findValidatedToken(encodedToken);
        if (token == null || (!configuration.isAuthorityClient(client)
                && !hasApplicationAccess(token, configuration.requireApplicationClient(client.getClientId())))) {
            return Map.of("active", false);
        }
        return Map.of("active", true, "sub", token.getSubject(), "aud", configuration.getAudience(),
                "exp", token.getExp(), "email", token.getEmail(),
                "app_permissions", token.getOtherClaims().get("app_permissions"));
    }

    public void revokeToken(ClientModel client, String encodedToken) {
        requireAuthority(client);
        AccessToken token = findValidatedToken(encodedToken);
        if (token != null) {
            tokenRepository.revokeToken(token.getId());
        }
    }

    public int revokeUserTokens(String encodedAssertion) {
        IdentityAssertion assertion = assertionVerifier.verify(encodedAssertion, "sso_logout");
        return tokenRepository.revokeUserTokens(assertion);
    }

    private AccessToken findValidatedToken(String encodedToken) {
        AccessToken token = tokenCodec.decodeActiveCentralToken(encodedToken);
        if (token == null) {
            return null;
        }
        StoredCentralToken cachedToken = tokenRepository.findActiveToken(token.getId());
        if (cachedToken == null || cachedToken.encodedToken() == null
                || !MessageDigest.isEqual(encodedToken.getBytes(StandardCharsets.UTF_8),
                        cachedToken.encodedToken().getBytes(StandardCharsets.UTF_8))) {
            return null;
        }
        return token;
    }

    private boolean hasApplicationAccess(AccessToken token, ClientModel client) {
        return ApplicationPermissions.hasReadPermission(
                token.getOtherClaims().get("app_permissions"), configuration.getSystemId(client));
    }

    private void requireAuthority(ClientModel client) {
        if (!configuration.isAuthorityClient(client)) {
            throw new ForbiddenException("Authority client required");
        }
    }

    private void validateCallback(ClientModel application, String callbackUrl) {
        URI callback = URI.create(callbackUrl);
        if (!application.getRedirectUris().contains(callbackUrl) || callbackUrl.contains("*")
                || callback.getHost() == null || !Set.of("http", "https").contains(callback.getScheme())
                || callback.getUserInfo() != null || callback.getFragment() != null) {
            throw new BadRequestException("Unregistered callback");
        }
    }

    private void validateRequestBinding(String state, String challenge) {
        if (!state.matches("[A-Za-z0-9_-]{43}") || !challenge.matches("[A-Za-z0-9_-]{43}")) {
            throw new BadRequestException("Invalid binding");
        }
    }
}
