package lab.sso.model;

import jakarta.ws.rs.BadRequestException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Validated, immutable permissions, preserving the identity provider's action order. */
public final class ApplicationPermissions {
    private static final Set<String> SUPPORTED_ACTIONS = Set.of("read", "write", "delete");
    private final Map<String, List<String>> permissions;

    private ApplicationPermissions(Map<String, List<String>> permissions) {
        this.permissions = Collections.unmodifiableMap(permissions);
    }

    public static ApplicationPermissions fromClaim(Object claim, Set<String> allowedSystems) {
        if (!(claim instanceof Map<?, ?> provided)
                || !allowedSystems.containsAll(provided.keySet())) {
            throw new BadRequestException("Unknown permissions");
        }
        Map<String, List<String>> validated = new LinkedHashMap<>();
        for (var entry : provided.entrySet()) {
            if (!(entry.getKey() instanceof String systemId)
                    || !(entry.getValue() instanceof List<?> actions)) {
                throw new BadRequestException("Invalid permissions");
            }
            List<String> accepted = new ArrayList<>();
            for (Object action : actions) {
                if (!(action instanceof String text) || !SUPPORTED_ACTIONS.contains(text)) {
                    throw new BadRequestException("Unsupported permission");
                }
                if (!accepted.contains(text)) {
                    accepted.add(text);
                }
            }
            validated.put(systemId, List.copyOf(accepted));
        }
        return new ApplicationPermissions(validated);
    }

    public Map<String, List<String>> asClaim() {
        return permissions;
    }

    public List<String> getDisplayLabels() {
        return permissions.entrySet().stream()
                .flatMap(entry -> entry.getValue().stream().map(action -> entry.getKey() + ":" + action))
                .toList();
    }

    public static boolean hasReadPermission(Object claim, String systemId) {
        return claim instanceof Map<?, ?> systems
                && systems.get(systemId) instanceof List<?> actions && actions.contains("read");
    }
}
