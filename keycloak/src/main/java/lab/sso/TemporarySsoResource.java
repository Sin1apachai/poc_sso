package lab.sso;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.*;
import org.keycloak.events.EventBuilder;
import org.keycloak.events.EventType;
import org.keycloak.models.*;
import org.keycloak.protocol.oidc.utils.AuthorizeClientUtil;
import org.keycloak.representations.AccessToken;
import org.keycloak.representations.JsonWebToken;
import org.keycloak.services.cors.Cors;
import org.keycloak.services.Urls;

/** One central JWT per source session, delivered unchanged to entitled applications. */
@jakarta.ws.rs.ext.Provider
public class TemporarySsoResource {
    private final KeycloakSession session;
    private final RealmModel realm;
    private final SsoConfiguration configuration;
    private final TemporaryTokenStore store;
    private final SsoProofVerifier proofs;
    public TemporarySsoResource(KeycloakSession session) {
        this.session=session;this.realm=session.getContext().getRealm();
        configuration=new SsoConfiguration(session,realm);
        store=new TemporaryTokenStore(session,realm);
        proofs=new SsoProofVerifier(session,realm,issuer());
    }
    private String issuer(){return Urls.realmIssuer(session.getContext().getUri().getBaseUri(),realm.getName());}
    private Response json(Object value){return Response.ok(value,MediaType.APPLICATION_JSON_TYPE).header("Cache-Control","no-store").build();}
    private static String escape(String value){return value.replace("&","&amp;").replace("\"","&quot;").replace("<","&lt;").replace(">","&gt;");}
    private static String claim(JsonWebToken value,String name){return SsoProofVerifier.claim(value,name);}
    private ClientModel authenticateClient(){
        var event=new EventBuilder(realm,session).event(EventType.CLIENT_LOGIN);
        return configuration.client(AuthorizeClientUtil.authorizeClient(session,event,Cors.builder()).getClient().getClientId());
    }
    private boolean authority(ClientModel client){return configuration.authorityClient().getId().equals(client.getId());}
    private boolean readable(AccessToken token,ClientModel client){
        if(!(token.getOtherClaims().get("app_permissions") instanceof Map<?,?> permissions))return false;
        return permissions.get(configuration.systemId(client)) instanceof List<?> actions && actions.contains("read");
    }
    private AccessToken sharedToken(String raw){
        try {
            AccessToken token=session.tokens().decode(raw,AccessToken.class);
            if(token==null || !Objects.equals(token.getIssuer(),issuer()) || !token.hasAudience(configuration.audience())
                || !Objects.equals(token.getIssuedFor(),configuration.authority()) || token.getExp()==null
                || token.getExp()<=System.currentTimeMillis()/1000 || !token.isActive()
                || !Boolean.TRUE.equals(token.getOtherClaims().get("temporary_identity"))
                || !Boolean.TRUE.equals(token.getOtherClaims().get("central_shared")))return null;
            Map<String,String> cached=store.get(token.getId());
            if(cached==null || !MessageDigest.isEqual(raw.getBytes(StandardCharsets.UTF_8),cached.getOrDefault("jwt","").getBytes(StandardCharsets.UTF_8)))return null;
            return token;
        }catch(Exception error){return null;}
    }
    @GET @Path("status") @Produces(MediaType.APPLICATION_JSON)
    public Response status(){return json(Map.of("issuer",issuer(),"temporary_sso",true));}
    @GET @Path("submit.js") @Produces("application/javascript")
    public Response submitScript(){return Response.ok("document.getElementById('handoff').submit();","application/javascript").header("Cache-Control","no-store").build();}

    @POST @Path("bootstrap") @Consumes(MediaType.APPLICATION_FORM_URLENCODED) @Produces(MediaType.APPLICATION_JSON)
    public Response bootstrap(@FormParam("assertion") String raw){
        ClientModel client=authenticateClient();
        if(!authority(client))throw new ForbiddenException("Authority client required");
        JsonWebToken proof=proofs.verify(raw,"sso_bootstrap");
        if(!configuration.authority().equals(claim(proof,"target_client")))throw new BadRequestException("Invalid bootstrap target");
        String generation=claim(proof,"bootstrap_generation");
        try{UUID.fromString(generation);}catch(Exception error){throw new BadRequestException("Invalid generation");}
        if(!(proof.getOtherClaims().get("app_permissions") instanceof Map<?,?> provided)
            || !configuration.systems().containsAll(provided.keySet()))throw new BadRequestException("Unknown permissions");
        Map<String,List<String>> permissions=new LinkedHashMap<>();List<String> display=new ArrayList<>();
        for(var entry:provided.entrySet()){
            if(!(entry.getKey() instanceof String app) || !(entry.getValue() instanceof List<?> actions))throw new BadRequestException("Invalid permissions");
            List<String> accepted=new ArrayList<>();
            for(Object action:actions){
                if(!(action instanceof String text) || !Set.of("read","write","delete").contains(text))throw new BadRequestException("Unsupported permission");
                if(!accepted.contains(text)){accepted.add(text);display.add(app+":"+text);}
            }
            permissions.put(app,accepted);
        }
        long now=System.currentTimeMillis()/1000;
        int ttl=Math.max(1,Math.min(900,realm.getAccessTokenLifespan()));
        AccessToken token=new AccessToken();
        token.id(UUID.randomUUID().toString());token.subject(SsoProofVerifier.subject(proof));token.issuer(issuer());
        token.audience(configuration.audience());token.issuedFor(client.getClientId());token.type("Bearer");token.iat(now);token.exp(now+ttl);
        token.setEmail(claim(proof,"email"));token.setOtherClaims("idp",configuration.idp());
        token.setOtherClaims("app_permissions",permissions);token.setOtherClaims("temporary_identity",true);
        token.setOtherClaims("central_shared",true);token.setOtherClaims("bootstrap_generation",generation);
        session.getContext().setClient(client);
        String encoded=session.tokens().encode(token);
        store.add(proof,token,encoded,display);
        return json(Map.of("access_token",encoded,"token_type","Bearer","expires_in",ttl));
    }

    @POST @Path("authorize") @Consumes(MediaType.APPLICATION_FORM_URLENCODED) @Produces(MediaType.TEXT_HTML)
    public Response authorize(@FormParam("assertion") String raw){
        try{
            JsonWebToken proof=proofs.verify(raw,"sso_login");
            ClientModel client=configuration.application(claim(proof,"target_client"));
            String callback=claim(proof,"redirect_uri");URI uri=URI.create(callback);
            if(!client.getRedirectUris().contains(callback) || callback.contains("*") || uri.getHost()==null
                || !Set.of("http","https").contains(uri.getScheme()) || uri.getUserInfo()!=null || uri.getFragment()!=null)throw new BadRequestException("Unregistered callback");
            String state=claim(proof,"sso_state"),challenge=claim(proof,"sso_challenge");
            if(!state.matches("[A-Za-z0-9_-]{43}") || !challenge.matches("[A-Za-z0-9_-]{43}"))throw new BadRequestException("Invalid binding");
            Map<String,String> value=store.handoff(proof,claim(proof,"central_jti"));
            String encoded=value.get("jwt");AccessToken token=sharedToken(encoded);
            if(token==null || !readable(token,client))throw new ForbiddenException("Central permission missing");
            // This short-lived envelope binds delivery, and is never an access token or a token-list entry.
            long now=System.currentTimeMillis()/1000;
            AccessToken delivery=new AccessToken();
            delivery.id(UUID.randomUUID().toString());delivery.subject(token.getSubject());delivery.issuer(issuer());
            delivery.audience(client.getClientId());delivery.type("sso_handoff");delivery.iat(now);delivery.exp(Math.min(now+60,token.getExp()));
            delivery.setOtherClaims("token_use","sso_handoff");delivery.setOtherClaims("sso_state",state);
            delivery.setOtherClaims("sso_challenge",challenge);delivery.setOtherClaims("central_jti",token.getId());
            delivery.setOtherClaims("source_issued_ms",proof.getOtherClaims().get("source_issued_ms"));
            delivery.setOtherClaims("token_hash",Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(encoded.getBytes(StandardCharsets.UTF_8))));
            session.getContext().setClient(client);
            String envelope=session.tokens().encode(delivery);
            String form="<!doctype html><html><head><meta charset=\"utf-8\"></head><body><form id=\"handoff\" method=\"post\" action=\""+escape(callback)+"\">"
                +"<input type=\"hidden\" name=\"access_token\" value=\""+escape(encoded)+"\">"
                +"<input type=\"hidden\" name=\"handoff\" value=\""+escape(envelope)+"\">"
                +"<input type=\"hidden\" name=\"state\" value=\""+escape(state)+"\">"
                +"<noscript><button>Continue</button></noscript></form><script src=\""+escape(issuer()+"/temporary-sso-poc/submit.js")+"\" defer></script></body></html>";
            return Response.ok(form,MediaType.TEXT_HTML_TYPE).header("Cache-Control","no-store").header("Referrer-Policy","origin").build();
        }catch(WebApplicationException error){throw error;}catch(Exception error){throw new BadRequestException("Handoff validation failed");}
    }
    @POST @Path("introspect") @Consumes(MediaType.APPLICATION_FORM_URLENCODED) @Produces(MediaType.APPLICATION_JSON)
    public Response introspect(@FormParam("token") String raw){
        ClientModel client=authenticateClient();AccessToken token=sharedToken(raw);
        if(token==null || (!authority(client) && !readable(token,configuration.application(client.getClientId()))))return json(Map.of("active",false));
        return json(Map.of("active",true,"sub",token.getSubject(),"aud",configuration.audience(),"exp",token.getExp(),"email",token.getEmail(),"app_permissions",token.getOtherClaims().get("app_permissions")));
    }
    @POST @Path("revoke") @Consumes(MediaType.APPLICATION_FORM_URLENCODED)
    public Response revoke(@FormParam("token") String raw){
        if(!authority(authenticateClient()))throw new ForbiddenException("Authority client required");
        AccessToken token=sharedToken(raw);if(token!=null)store.revoke(token.getId());
        return json(Map.of("revoked",true));
    }
    @POST @Path("logout-user") @Consumes(MediaType.APPLICATION_FORM_URLENCODED) @Produces(MediaType.APPLICATION_JSON)
    public Response logoutUser(@FormParam("assertion") String raw){return json(Map.of("revoked",store.logout(proofs.verify(raw,"sso_logout"))));}
}
