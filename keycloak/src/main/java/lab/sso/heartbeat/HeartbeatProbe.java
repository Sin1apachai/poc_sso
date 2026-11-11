package lab.sso.heartbeat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.Locale;

/** A single availability check shared by scheduled monitoring and the admin test. */
public final class HeartbeatProbe {
    private final HttpClient httpClient;

    public HeartbeatProbe() {
        this(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3))
                .followRedirects(HttpClient.Redirect.NEVER).build());
    }

    public HeartbeatProbe(HttpClient httpClient) {
        this.httpClient = httpClient;
    }

    public Result check(URI healthUrl, Source source) {
        long started = System.nanoTime();
        try {
            HttpRequest request = HttpRequest.newBuilder(healthUrl).timeout(Duration.ofSeconds(3))
                    .header("X-SSO-Heartbeat", source.name().toLowerCase(Locale.ROOT)).GET().build();
            int status = httpClient.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
            boolean healthy = status >= 200 && status < 300;
            return new Result(healthy, status, elapsedMillis(started),
                    healthy ? null : "The health endpoint returned a non-success HTTP status.");
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return new Result(false, null, elapsedMillis(started), "The heartbeat check was interrupted.");
        } catch (HttpTimeoutException error) {
            return new Result(false, null, elapsedMillis(started), "The heartbeat check timed out after 3 seconds.");
        } catch (Exception error) {
            return new Result(false, null, elapsedMillis(started), "Unable to reach the identity provider.");
        }
    }

    private long elapsedMillis(long started) {
        return (System.nanoTime() - started) / 1_000_000;
    }

    public enum Source { SCHEDULED, MANUAL }

    public record Result(boolean healthy, Integer httpStatus, long durationMillis, String error) {}
}
