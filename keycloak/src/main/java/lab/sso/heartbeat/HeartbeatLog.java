package lab.sso.heartbeat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.lang.System.Logger;
import java.lang.System.Logger.Level;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/** Structured operational metadata only: never log tokens, subjects, credentials or health URL queries. */
public final class HeartbeatLog {
    private static final Logger LOG = System.getLogger(HeartbeatLog.class.getName());
    private static final ObjectMapper JSON = new ObjectMapper();

    private HeartbeatLog() {}

    public static void write(String event, Map<String, ?> fields) {
        Map<String, Object> record = new LinkedHashMap<>();
        record.put("timestamp", Instant.now().toString());
        record.put("event", event);
        record.put("system", "keycloak");
        record.putAll(fields);
        try {
            LOG.log(Level.INFO, JSON.writeValueAsString(record));
        } catch (Exception error) {
            LOG.log(Level.WARNING, "Unable to serialize heartbeat metadata");
        }
    }

    public static void idpCheck(String realm, String alias, HeartbeatProbe.Source source,
            HeartbeatProbe.Result result, Map<String, ?> details) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("from", "keycloak");
        fields.put("to", alias);
        fields.put("realm", realm);
        fields.put("source", source.name().toLowerCase(Locale.ROOT));
        fields.put("method", "GET");
        fields.put("healthy", result.healthy());
        fields.put("status", result.httpStatus());
        fields.put("durationMs", result.durationMillis());
        fields.put("error", result.error());
        fields.putAll(details);
        write("idp_heartbeat_check", fields);
    }
}
