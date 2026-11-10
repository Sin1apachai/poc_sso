package lab.sso.repository;

import jakarta.ws.rs.BadRequestException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lab.sso.model.IdentityAssertion;
import lab.sso.model.StoredCentralToken;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;

/** Owns the single-node TTL cache, replay receipts, source sessions and logout fences. */
public final class TemporaryTokenRepository {
    private static final String CACHE_NAMESPACE = "temporary-sso-poc:";
    private final KeycloakSession session;
    private final String realmId;

    public TemporaryTokenRepository(KeycloakSession session, RealmModel realm) {
        this.session = session;
        this.realmId = realm.getId();
    }

    public StoredCentralToken findActiveToken(String tokenId) {
        Map<String, String> values = session.singleUseObjects().get(cacheKey("token", tokenId));
        if (values == null || Long.parseLong(values.get("expires")) <= currentTimeSeconds()) {
            return null;
        }
        return StoredCentralToken.fromCache(tokenId, values);
    }

    public void storeToken(IdentityAssertion assertion, StoredCentralToken token) {
        synchronized (TemporaryTokenRepository.class) {
            consumeLoginAssertion(assertion);
            String sourceSessionId = assertion.getSourceSessionId();
            Map<String, String> previous = session.singleUseObjects()
                    .get(cacheKey("source", sourceSessionId));
            if (previous != null) {
                session.singleUseObjects().remove(cacheKey("token", previous.get("id")));
            }
            long lifetimeSeconds = token.expiresAt() - currentTimeSeconds();
            if (lifetimeSeconds <= 0) {
                throw new BadRequestException("Expired token");
            }
            session.singleUseObjects().put(cacheKey("token", token.id()), lifetimeSeconds, token.toCache());
            addToIndex("user", token.subject(), token.id());
            addToIndex("catalog", "active", token.id());
            session.singleUseObjects().put(cacheKey("source", sourceSessionId),
                    lifetimeSeconds, Map.of("id", token.id()));
        }
    }

    public StoredCentralToken consumeHandoffAssertion(IdentityAssertion assertion, String tokenId) {
        synchronized (TemporaryTokenRepository.class) {
            StoredCentralToken token = findActiveToken(tokenId);
            if (token == null || !assertion.getCentralSubject().equals(token.subject())
                    || !assertion.getEmail().equals(token.email())) {
                throw new BadRequestException("Central token unavailable");
            }
            consumeLoginAssertion(assertion);
            return token;
        }
    }

    public void revokeToken(String tokenId) {
        synchronized (TemporaryTokenRepository.class) {
            session.singleUseObjects().remove(cacheKey("token", tokenId));
        }
    }

    public int revokeUserTokens(IdentityAssertion assertion) {
        synchronized (TemporaryTokenRepository.class) {
            // Logout assertions have no source timestamp; still enforce one-time use.
            recordAssertionUse(assertion);
            String subject = assertion.getCentralSubject();
            Map<String, String> previous = session.singleUseObjects().get(cacheKey("cutoff", subject));
            long cutoffMillis = Math.max(System.currentTimeMillis(),
                    previous == null ? 0 : Long.parseLong(previous.get("ms")));
            session.singleUseObjects().put(cacheKey("cutoff", subject),
                    62, Map.of("ms", Long.toString(cutoffMillis)));
            session.singleUseObjects().put(cacheKey("closed-session", assertion.getSourceSessionId()),
                    60, Map.of("closed", "true"));
            Map<String, String> userIndex = session.singleUseObjects().remove(cacheKey("user", subject));
            int revokedCount = 0;
            if (userIndex != null) {
                for (String tokenId : userIndex.getOrDefault("tokens", "").split(",")) {
                    if (!tokenId.isBlank()
                            && session.singleUseObjects().remove(cacheKey("token", tokenId)) != null) {
                        revokedCount++;
                    }
                }
            }
            return revokedCount;
        }
    }

    public List<StoredCentralToken> findAllActiveTokens() {
        Map<String, String> catalog = session.singleUseObjects().get(cacheKey("catalog", "active"));
        if (catalog == null) {
            return List.of();
        }
        List<StoredCentralToken> tokens = new ArrayList<>();
        for (String tokenId : catalog.getOrDefault("tokens", "").split(",")) {
            StoredCentralToken token = tokenId.isBlank() ? null : findActiveToken(tokenId);
            if (token != null) {
                tokens.add(token);
            }
        }
        tokens.sort(Comparator.comparingLong(StoredCentralToken::issuedAt).reversed()
                .thenComparing(StoredCentralToken::id));
        return tokens;
    }

    private void consumeLoginAssertion(IdentityAssertion assertion) {
        if (session.singleUseObjects().contains(cacheKey("closed-session", assertion.getSourceSessionId()))) {
            throw new BadRequestException("Source session closed");
        }
        Map<String, String> fence = session.singleUseObjects()
                .get(cacheKey("cutoff", assertion.getCentralSubject()));
        long issuedAtMillis = assertion.getSourceIssuedAtMillis();
        long nowMillis = System.currentTimeMillis();
        if (issuedAtMillis > nowMillis + 1000 || issuedAtMillis < nowMillis - 61000
                || (fence != null && issuedAtMillis <= Long.parseLong(fence.get("ms")))) {
            throw new BadRequestException("Stale proof");
        }
        recordAssertionUse(assertion);
    }

    private void recordAssertionUse(IdentityAssertion assertion) {
        long lifetimeSeconds = Math.max(1, assertion.getExpiresAt() - currentTimeSeconds() + 1);
        if (!session.singleUseObjects().putIfAbsent(cacheKey("assertion", assertion.getId()), lifetimeSeconds)) {
            throw new BadRequestException("Proof already used");
        }
    }

    private void addToIndex(String kind, String indexId, String addedTokenId) {
        Map<String, String> previous = session.singleUseObjects().get(cacheKey(kind, indexId));
        Set<String> tokenIds = new LinkedHashSet<>();
        if (previous != null) {
            tokenIds.addAll(Arrays.asList(previous.getOrDefault("tokens", "").split(",")));
        }
        tokenIds.add(addedTokenId);
        long expiresAt = currentTimeSeconds();
        Iterator<String> iterator = tokenIds.iterator();
        while (iterator.hasNext()) {
            StoredCentralToken token = findActiveToken(iterator.next());
            if (token == null) {
                iterator.remove();
            } else {
                expiresAt = Math.max(expiresAt, token.expiresAt());
            }
        }
        if (!tokenIds.isEmpty()) {
            session.singleUseObjects().put(cacheKey(kind, indexId),
                    Math.max(1, expiresAt - currentTimeSeconds()), Map.of("tokens", String.join(",", tokenIds)));
        }
    }

    private String cacheKey(String kind, String identifier) {
        return CACHE_NAMESPACE + realmId + ":" + kind + ":" + identifier;
    }

    private long currentTimeSeconds() {
        return System.currentTimeMillis() / 1000;
    }
}
