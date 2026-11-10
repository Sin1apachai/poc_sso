package lab.sso;

import java.util.*;
import jakarta.ws.rs.*;
import org.keycloak.models.*;
import org.keycloak.representations.*;

/** Single-node PoC TTL cache; never writes users, permissions or JWTs to user storage. */
final class TemporaryTokenStore {
    private final KeycloakSession session;
    private final RealmModel realm;
    TemporaryTokenStore(KeycloakSession session,RealmModel realm){this.session=session;this.realm=realm;}
    private String key(String kind,String id){return "temporary-sso-poc:"+realm.getId()+":"+kind+":"+id;}
    private long now(){return System.currentTimeMillis()/1000;}
    Map<String,String> get(String id) {
        Map<String,String> token=session.singleUseObjects().get(key("token",id));
        if(token==null || Long.parseLong(token.get("expires"))<=now())return null;
        return token;
    }
    private void consume(JsonWebToken proof) {
        String cSession=SsoProofVerifier.claim(proof,"c_session");
        if(session.singleUseObjects().contains(key("closed-session",cSession)))throw new BadRequestException("Source session closed");
        Map<String,String> fence=session.singleUseObjects().get(key("cutoff",SsoProofVerifier.subject(proof)));
        Object issued=proof.getOtherClaims().get("source_issued_ms");
        if(!(issued instanceof Number) || ((Number)issued).longValue()>System.currentTimeMillis()+1000
            || ((Number)issued).longValue()<System.currentTimeMillis()-61000
            || (fence!=null && ((Number)issued).longValue()<=Long.parseLong(fence.get("ms"))))throw new BadRequestException("Stale proof");
        if(!session.singleUseObjects().putIfAbsent(key("assertion",proof.getId()),Math.max(1,proof.getExp()-now()+1)))throw new BadRequestException("Proof already used");
    }
    void add(JsonWebToken proof,AccessToken token,String raw,List<String> permissions) {
        synchronized(TemporaryTokenStore.class) {
            consume(proof);
            String source=SsoProofVerifier.claim(proof,"c_session");
            Map<String,String> prior=session.singleUseObjects().get(key("source",source));
            if(prior!=null)session.singleUseObjects().remove(key("token",prior.get("id")));
            long ttl=token.getExp()-now();if(ttl<=0)throw new BadRequestException("Expired token");
            session.singleUseObjects().put(key("token",token.getId()),ttl,Map.of("sub",token.getSubject(),"email",token.getEmail(),
                "client",token.getIssuedFor(),"permissions",String.join(",",permissions),"issued",Long.toString(token.getIat()),
                "expires",Long.toString(token.getExp()),"jwt",raw));
            index("user",token.getSubject(),token.getId());index("catalog","active",token.getId());
            session.singleUseObjects().put(key("source",source),ttl,Map.of("id",token.getId()));
        }
    }
    private void index(String kind,String id,String added) {
        Map<String,String> previous=session.singleUseObjects().get(key(kind,id));
        Set<String> ids=new LinkedHashSet<>();long until=now();
        if(previous!=null)ids.addAll(Arrays.asList(previous.getOrDefault("tokens","").split(",")));
        ids.add(added);
        Iterator<String> iterator=ids.iterator();
        while(iterator.hasNext()) {Map<String,String> value=get(iterator.next());if(value==null)iterator.remove();else until=Math.max(until,Long.parseLong(value.get("expires")));}
        if(!ids.isEmpty())session.singleUseObjects().put(key(kind,id),Math.max(1,until-now()),Map.of("tokens",String.join(",",ids)));
    }
    Map<String,String> handoff(JsonWebToken proof,String tokenId) {
        synchronized(TemporaryTokenStore.class) {
            Map<String,String> value=get(tokenId);
            if(value==null || !SsoProofVerifier.subject(proof).equals(value.get("sub"))
                || !SsoProofVerifier.claim(proof,"email").equals(value.get("email")))throw new BadRequestException("Central token unavailable");
            consume(proof);return value;
        }
    }
    void revoke(String id){synchronized(TemporaryTokenStore.class){session.singleUseObjects().remove(key("token",id));}}
    int logout(JsonWebToken proof) {
        synchronized(TemporaryTokenStore.class) {
            // Logout proofs do not carry source_issued_ms; verify replay separately.
            if(!session.singleUseObjects().putIfAbsent(key("assertion",proof.getId()),Math.max(1,proof.getExp()-now()+1)))throw new BadRequestException("Proof already used");
            String sub=SsoProofVerifier.subject(proof);
            Map<String,String> previous=session.singleUseObjects().get(key("cutoff",sub));
            long cutoff=Math.max(System.currentTimeMillis(),previous==null?0:Long.parseLong(previous.get("ms")));
            session.singleUseObjects().put(key("cutoff",sub),62,Map.of("ms",Long.toString(cutoff)));
            session.singleUseObjects().put(key("closed-session",SsoProofVerifier.claim(proof,"c_session")),60,Map.of("closed","true"));
            Map<String,String> user=session.singleUseObjects().remove(key("user",sub));int count=0;
            if(user!=null)for(String id:user.getOrDefault("tokens","").split(","))if(!id.isBlank()&&session.singleUseObjects().remove(key("token",id))!=null)count++;
            return count;
        }
    }
    List<Map<String,Object>> list() {
        Map<String,String> catalog=session.singleUseObjects().get(key("catalog","active"));
        if(catalog==null)return List.of();List<Map<String,Object>> result=new ArrayList<>();
        for(String id:catalog.getOrDefault("tokens","").split(",")) {
            Map<String,String> value=id.isBlank()?null:get(id);if(value==null)continue;
            result.add(Map.of("id",id,"sub",value.get("sub"),"email",value.get("email"),"clientId",value.get("client"),
                "permissions",value.get("permissions").isBlank()?List.of():List.of(value.get("permissions").split(",")),
                "issuedAt",Long.parseLong(value.get("issued")),"expiresAt",Long.parseLong(value.get("expires")),"status","active"));
        }
        result.sort(Comparator.<Map<String,Object>,Long>comparing(row->(Long)row.get("issuedAt")).reversed().thenComparing(row->(String)row.get("id")));
        return result;
    }
}
