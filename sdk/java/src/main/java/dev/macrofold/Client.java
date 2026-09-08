package dev.macrofold;

import dev.macrofold.api.RunsApi;
import dev.macrofold.model.Event;
import dev.macrofold.model.Run;
import java.io.*;
import java.math.BigInteger;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import java.util.function.Predicate;

/** Authenticated typed API client. Redirects never forward its credential. */
public class Client extends Resources {
  private final String token;

  public Client() {this(DEFAULT_ORIGIN,environmentKey());}
  public Client(String apiKey) {this(DEFAULT_ORIGIN,apiKey);}
  public static Builder builder(){return new Builder();}
  public static final class Builder {
    private String origin=DEFAULT_ORIGIN;
    private String apiKey;
    public Builder baseURL(String value){origin=value;return this;}
    public Builder apiKey(String value){apiKey=value;return this;}
    public Client build(){return new Client(origin,apiKey == null ? environmentKey() : apiKey);}
  }
  private static String environmentKey(){return System.getenv("MACROFOLD_API_KEY");}

  public Client(String origin, String token) {
    super(
        HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER),
        createDefaultObjectMapper(),
        validateOrigin(origin));
    if(token == null || token.isBlank())
      throw new IllegalArgumentException("Missing Macrofold API key. Pass apiKey or set MACROFOLD_API_KEY.");
    this.token = token;
    setReadTimeout(Duration.ofSeconds(70));
    setConnectTimeout(Duration.ofSeconds(15));
    setRequestInterceptor(
        request ->
            request.header("Authorization", "Bearer " + token).header("X-Client-Type", "sdk"));
  }

  private static String validateOrigin(String origin) {
    URI uri = URI.create(origin);
    boolean local =
        "localhost".equals(uri.getHost())
            || "127.0.0.1".equals(uri.getHost())
            || "[::1]".equals(uri.getHost());
    if (uri.getHost() == null
        || uri.getUserInfo() != null
        || uri.getQuery() != null
        || uri.getFragment() != null
        || (!uri.getPath().isEmpty() && !"/".equals(uri.getPath()))
        || (!"https".equals(uri.getScheme()) && !("http".equals(uri.getScheme()) && local)))
      throw new IllegalArgumentException(
          "Use an HTTPS service origin (HTTP is allowed for localhost)");
    return origin.replaceAll("/$", "");
  }

  /**
   * Incremental SSE with replay cursors. Return false from receive to detach without cancelling the
   * run.
   */
  public void stream(UUID runId, String after, Predicate<Event> receive)
      throws IOException, InterruptedException, ApiException {
    streamInOrganization(runId, after, null, receive);
  }

  @Override
  protected void streamInOrganization(UUID runId, String after, UUID organization, Predicate<Event> receive)
      throws IOException, InterruptedException, ApiException {
    if (after == null || !after.matches("[0-9]+"))
      throw new IllegalArgumentException("Use a numeric event cursor");
    BigInteger cursor = new BigInteger(after);
    int failures = 0;
    RunsApi runs = new RunsApi(this);
    java.util.concurrent.ScheduledExecutorService deadlines =
        java.util.concurrent.Executors.newSingleThreadScheduledExecutor();
    try {
      while (true) {
        HttpRequest.Builder request =
            HttpRequest.newBuilder(
                    URI.create(getBaseUri() + "/v1/runs/" + runId + "/stream?after=" + cursor))
                .header("Authorization", "Bearer " + token)
                .header("X-Client-Type", "sdk")
                .header("Accept", "text/event-stream")
                .header("Last-Event-ID", cursor.toString())
                .timeout(Duration.ofSeconds(70));
        if (organization != null) request.header("X-Organization-Id", organization.toString());
        try {
          HttpResponse<InputStream> response =
              getHttpClient().send(request.build(), HttpResponse.BodyHandlers.ofInputStream());
          java.util.concurrent.ScheduledFuture<?> deadline =
              deadlines.schedule(
                  () -> {
                    try {
                      response.body().close();
                    } catch (IOException ignored) {
                      /* The caller observes the closed stream. */
                    }
                  },
                  70,
                  java.util.concurrent.TimeUnit.SECONDS);
          try (InputStream body = response.body()) {
            if (response.statusCode() != 200) {
              if (response.statusCode() != 429 && response.statusCode() < 500)
                throw new ApiException(response.statusCode(), "Event stream rejected");
              throw new IOException("Event stream unavailable: HTTP " + response.statusCode());
            }
            BufferedReader reader =
                new BufferedReader(new InputStreamReader(body, StandardCharsets.UTF_8));
            StringBuilder line = new StringBuilder(), data = new StringBuilder();
            int character;
            while ((character = reader.read()) != -1) {
              if (Thread.currentThread().isInterrupted())
                throw new InterruptedException("Stream detached");
              if (character != '\n') {
                line.append((char) character);
                if (line.length() + data.length() > 4 * 1024 * 1024)
                  throw new ApiException(413, "SSE frame exceeds client limit");
                continue;
              }
              if (line.length() > 0 && line.charAt(line.length() - 1) == '\r')
                line.setLength(line.length() - 1);
              if (line.length() == 0) {
                Event event = null;
                try {
                  if (data.length() > 0)
                    event = getObjectMapper().readValue(data.toString(), Event.class);
                } catch (com.fasterxml.jackson.core.JsonProcessingException ignored) {
                  /* Ignore invalid frames; replay remains authoritative. */
                }
                data.setLength(0);
                if (event != null
                    && event.getSequence() != null
                    && event.getSequence().matches("[0-9]+")) {
                  BigInteger sequence = new BigInteger(event.getSequence());
                  if (sequence.compareTo(cursor) > 0) {
                    if (!receive.test(event)) return;
                    cursor = sequence;
                    failures = 0;
                    if (java.util.Set.of(
                            "run.succeeded", "run.failed", "run.cancelled", "run.timed_out")
                        .contains(event.getType())) return;
                  }
                }
              } else if (line.indexOf("data:") == 0) {
                String value = line.substring(5);
                data.append(value.startsWith(" ") ? value.substring(1) : value).append('\n');
              }
              line.setLength(0);
            }
          } finally {
            deadline.cancel(false);
          }
        } catch (IOException error) {
          if (++failures > 8) throw error;
          Thread.sleep(Math.min(10000, 250L << failures));
          continue;
        }
        Run run = runs.getRun(runId, organization);
        if (java.util.Set.of("succeeded", "failed", "cancelled", "timed_out")
                .contains(run.getStatus().getValue())
            && runs.listRunEvents(runId, cursor.toString(), null, 1, organization).getData().isEmpty())
          return;
        Thread.sleep(250);
      }
    } finally {
      deadlines.shutdownNow();
    }
  }
}
