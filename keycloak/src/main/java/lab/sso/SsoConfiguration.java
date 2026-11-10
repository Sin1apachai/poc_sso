package lab.sso;

import java.util.*;
import java.util.stream.*;
import jakarta.ws.rs.*;
import org.keycloak.models.*;

final class SsoConfiguration {
    private final KeycloakSession session;
    private final RealmModel realm;
    SsoConfiguration(KeycloakSession session, RealmModel realm) { this.session=session; this.realm=realm; }
    String required(String key) {
        String value=realm.getAttribute("temporary.sso."+key);
        if(value==null || value.isBlank()) throw new ForbiddenException("SSO configuration missing");
        return value;
    }
    String audience() { return required("audience"); }
    String idp() { return required("idp"); }
    String authority() { return required("authority-client"); }
    ClientModel client(String id) {
        ClientModel client=session.clients().getClientByClientId(realm,id);
        if(client==null || !client.isEnabled() || client.isPublicClient()
                || !"openid-connect".equals(client.getProtocol())
                || !"true".equals(client.getAttribute("temporary.sso.enabled"))) {
            throw new ForbiddenException("SSO client not allowed");
        }
        return client;
    }
    ClientModel authorityClient() {
        ClientModel client=client(authority());
        if(!"authority".equals(client.getAttribute("temporary.sso.role"))) throw new ForbiddenException("Authority client required");
        return client;
    }
    ClientModel application(String id) {
        ClientModel client=client(id);
        if(!"application".equals(client.getAttribute("temporary.sso.role"))) throw new ForbiddenException("Application client required");
        systemId(client);
        return client;
    }
    String systemId(ClientModel client) {
        String id=client.getAttribute("temporary.sso.system-id");
        if(id==null || !id.matches("[a-zA-Z0-9_.-]{1,100}")) throw new ForbiddenException("Application system ID missing");
        return id;
    }
    Set<String> systems() {
        return session.clients().getClientsStream(realm)
            .filter(c->c.isEnabled() && "true".equals(c.getAttribute("temporary.sso.enabled"))
                && "application".equals(c.getAttribute("temporary.sso.role")))
            .map(this::systemId).collect(Collectors.toSet());
    }
    List<Map<String,String>> clients() {
        return session.clients().getClientsStream(realm)
            .filter(c->c.isEnabled() && "true".equals(c.getAttribute("temporary.sso.enabled")))
            .map(c->Map.of("clientId",c.getClientId(),"name",c.getName()==null||c.getName().isBlank()?c.getClientId():c.getName(),
                "systemId",Optional.ofNullable(c.getAttribute("temporary.sso.system-id")).orElse("")))
            .sorted(Comparator.comparing(c->c.get("clientId"))).toList();
    }
}
