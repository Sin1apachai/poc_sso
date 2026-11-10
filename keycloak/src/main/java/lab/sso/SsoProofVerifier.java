package lab.sso;

import java.util.*;
import java.nio.charset.StandardCharsets;
import jakarta.ws.rs.*;
import org.keycloak.TokenVerifier;
import org.keycloak.broker.provider.util.SimpleHttp;
import org.keycloak.jose.jwk.*;
import org.keycloak.models.*;
import org.keycloak.representations.JsonWebToken;

final class SsoProofVerifier {
    private final KeycloakSession session;
    private final RealmModel realm;
    private final SsoConfiguration configuration;
    private final String issuer;
    SsoProofVerifier(KeycloakSession session, RealmModel realm, String issuer) {
        this.session=session;this.realm=realm;this.issuer=issuer;this.configuration=new SsoConfiguration(session,realm);
    }
    static String claim(JsonWebToken token,String name) {
        Object value=token.getOtherClaims().get(name);
        if(!(value instanceof String text) || text.isBlank())throw new BadRequestException("Missing proof claim");
        return text;
    }
    static String subject(JsonWebToken proof) {
        return UUID.nameUUIDFromBytes((proof.getIssuer()+"::"+proof.getSubject()).getBytes(StandardCharsets.UTF_8)).toString();
    }
    JsonWebToken verify(String raw,String purpose) {
        try {
            if(!realm.isEnabled() || raw==null || raw.length()>16384)throw new BadRequestException("Invalid proof");
            IdentityProviderModel idp=session.identityProviders().getByAlias(configuration.idp());
            if(idp==null || !idp.isEnabled())throw new ForbiddenException("Identity provider disabled");
            var verifier=TokenVerifier.create(raw,JsonWebToken.class);
            verifier.parse();
            if(!"RS256".equals(verifier.getHeader().getRawAlgorithm()))throw new BadRequestException("Invalid algorithm");
            JSONWebKeySet keys=SimpleHttp.doGet(idp.getConfig().get("jwksUrl"),session)
                .connectTimeoutMillis(3000).socketTimeOutMillis(3000).setMaxConsumedResponseSize(65536).asJson(JSONWebKeySet.class);
            String kid=verifier.getHeader().getKeyId();
            JWK key=Arrays.stream(keys.getKeys()).filter(k->Objects.equals(k.getKeyId(),kid)).findFirst()
                .orElseThrow(()->new BadRequestException("Unknown signing key"));
            verifier.publicKey(JWKParser.create(key).toPublicKey()).verify();
            JsonWebToken proof=verifier.getToken();long now=System.currentTimeMillis()/1000;
            if(!Objects.equals(idp.getConfig().get("issuer"),proof.getIssuer()) || !proof.hasAudience(issuer)
                || proof.getAudience().length!=1 || proof.getSubject()==null || proof.getSubject().isBlank()
                || proof.getId()==null || proof.getIat()==null || proof.getExp()==null || proof.getExp()<=now
                || proof.getIat()>now || proof.getExp()-proof.getIat()>60 || !purpose.equals(proof.getOtherClaims().get("token_use"))) {
                throw new BadRequestException("Invalid proof claims");
            }
            return proof;
        } catch(WebApplicationException error){throw error;}
        catch(Exception error){throw new BadRequestException("Proof validation failed");}
    }
}
