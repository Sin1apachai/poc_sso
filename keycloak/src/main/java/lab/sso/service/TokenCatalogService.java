package lab.sso.service;

import jakarta.ws.rs.BadRequestException;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import lab.sso.config.RealmSsoConfiguration;
import lab.sso.model.StoredCentralToken;
import lab.sso.repository.TemporaryTokenRepository;

/** Queries safe metadata for the admin menu; never returns cached JWTs. */
public final class TokenCatalogService {
    private final RealmSsoConfiguration configuration;
    private final TemporaryTokenRepository tokenRepository;

    public TokenCatalogService(RealmSsoConfiguration configuration, TemporaryTokenRepository tokenRepository) {
        this.configuration = configuration;
        this.tokenRepository = tokenRepository;
    }

    public Map<String, Object> listTokens(int first, int max, String clientId, String search) {
        List<Map<String, String>> clients = configuration.describeSsoClients();
        if (first < 0 || max < 1 || max > 100 || search.length() > 200
                || (!clientId.isEmpty() && clients.stream().noneMatch(client -> clientId.equals(client.get("clientId"))))) {
            throw new BadRequestException("Invalid token list filter");
        }
        String systemId = clientId.isEmpty() ? "" : clients.stream()
                .filter(client -> clientId.equals(client.get("clientId")))
                .findFirst().orElseThrow().get("systemId");
        String query = search.trim().toLowerCase(Locale.ROOT);
        List<Map<String, Object>> tokens = tokenRepository.findAllActiveTokens().stream()
                .filter(token -> matchesClient(token, clientId, systemId))
                .filter(token -> matchesSearch(token, query))
                .map(StoredCentralToken::toMetadata)
                .toList();
        int start = Math.min(first, tokens.size());
        int end = start + Math.min(max, tokens.size() - start);
        return Map.of("items", tokens.subList(start, end), "total", tokens.size(), "clients", clients,
                "first", first, "max", max, "serverTime", System.currentTimeMillis() / 1000);
    }

    private boolean matchesClient(StoredCentralToken token, String clientId, String systemId) {
        return clientId.isEmpty() || clientId.equals(token.issuingClientId())
                || (!systemId.isEmpty() && token.permissions().contains(systemId + ":read"));
    }

    private boolean matchesSearch(StoredCentralToken token, String query) {
        return query.isEmpty() || (token.email() + " " + token.subject() + " " + token.id())
                .toLowerCase(Locale.ROOT).contains(query);
    }
}
