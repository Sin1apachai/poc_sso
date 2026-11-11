package lab.sso.service;

import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import lab.sso.config.RealmSsoConfiguration;
import lab.sso.heartbeat.IdpHeartbeatSettings;
import lab.sso.security.CentralTokenCodec;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.representations.AccessToken;

/** Sends realm-signed, IdP-scoped logout notifications without depending on C. */
public final class IdentityProviderLogoutService {
    private final KeycloakSession session;
    private final RealmModel realm;
    private final RealmSsoConfiguration configuration;
    private final HttpClient httpClient;

    public IdentityProviderLogoutService(KeycloakSession session, RealmModel realm, HttpClient httpClient) {
        this.session = session;
        this.realm = realm;
        this.configuration = new RealmSsoConfiguration(session, realm);
        this.httpClient = httpClient;
    }

    public boolean notifyEndpoint(String logoutUrl, long cutoffMillis) {
        try {
            var endpoint = IdpHeartbeatSettings.requireHttpUrl(logoutUrl);
            long now = System.currentTimeMillis() / 1000;
            AccessToken proof = new AccessToken();
            proof.id(UUID.randomUUID().toString());
            proof.issuer(configuration.getIssuer());
            proof.subject("idp:" + configuration.getIdentityProviderAlias());
            proof.audience(configuration.getAudience());
            proof.type("idp_logout");
            proof.iat(now);
            proof.exp(now + 60);
            proof.setOtherClaims("token_use", "idp_logout");
            proof.setOtherClaims("idp", configuration.getIdentityProviderAlias());
            proof.setOtherClaims("revoked_before", cutoffMillis);
            String encoded = new CentralTokenCodec(session, configuration).encode(proof,
                    session.clients().getClientByClientId(realm, configuration.getAuthorityClientId()));
            String body = "logout_token=" + URLEncoder.encode(encoded, StandardCharsets.UTF_8);
            HttpRequest request = HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(3))
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .POST(HttpRequest.BodyPublishers.ofString(body)).build();
            int status = httpClient.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
            return status >= 200 && status < 300;
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return false;
        } catch (Exception error) {
            return false;
        }
    }
}
