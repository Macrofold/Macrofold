package dev.macrofold;

import dev.macrofold.api.CustomerAgentsApi;
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

  public Client() {
    this(DEFAULT_ORIGIN, environmentKey());
  }

  public Client(String apiKey) {
    this(DEFAULT_ORIGIN, apiKey);
  }

  public static Builder builder() {
    return new Builder();
  }

  public static final class Builder {
    private String origin = DEFAULT_ORIGIN;
    private String apiKey;

    public Builder baseURL(String value) {
      origin = value;
      return this;
    }

    public Builder apiKey(String value) {
      apiKey = value;
      return this;
    }

    public Client build() {
      return new Client(origin, apiKey == null ? environmentKey() : apiKey);
    }
  }

  private static String environmentKey() {
    return System.getenv("MACROFOLD_API_KEY");
  }

  public Client(String origin, String token) {
    super(
        HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER),
        createDefaultObjectMapper(),
        validateOrigin(origin));
    if (token == null || token.isBlank())
      throw new IllegalArgumentException(
          "Missing Macrofold API key. Pass apiKey or set MACROFOLD_API_KEY.");
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
  protected void streamInOrganization(
      UUID runId, String after, UUID organization, Predicate<Event> receive)
      throws IOException, InterruptedException, ApiException {
    streamTarget(null, null, runId, after, organization, receive);
  }

  @Override
  protected void streamCustomerInOrganization(
      String customerId,
      UUID customerAgentId,
      UUID runId,
      String after,
      UUID organization,
      Predicate<Event> receive)
      throws IOException, InterruptedException, ApiException {
    streamTarget(customerId, customerAgentId, runId, after, organization, receive);
  }

  @Override
  protected void streamInference(dev.macrofold.model.InferenceCreate input, RequestOptions options, Predicate<dev.macrofold.model.InferenceStreamEvent> receive)
      throws IOException, InterruptedException, ApiException {
    String key = options.identity();
    var payload = getObjectMapper().valueToTree(input);
    ((com.fasterxml.jackson.databind.node.ObjectNode) payload).put("stream", true);
    var request = HttpRequest.newBuilder(URI.create(getBaseUri()+"/v1/inferences"))
        .header("Authorization", "Bearer "+token).header("X-Client-Type", "sdk")
        .header("Idempotency-Key", key).header("Content-Type", "application/json")
        .header("Accept", "text/event-stream").timeout(Duration.ofSeconds(300))
        .POST(HttpRequest.BodyPublishers.ofString(getObjectMapper().writeValueAsString(payload)));
    if (options.organization() != null) request.header("X-Organization-Id", options.organization().toString());
    var deadlines = java.util.concurrent.Executors.newSingleThreadScheduledExecutor();
    try {
      var response = getHttpClient().send(request.build(), HttpResponse.BodyHandlers.ofInputStream());
      var deadline = deadlines.schedule(() -> { try { response.body().close(); } catch (IOException ignored) {} }, 300, java.util.concurrent.TimeUnit.SECONDS);
      try (var body = response.body()) {
        if (response.statusCode() != 200) throw new ApiException(response.statusCode(), "Inference stream rejected", response.headers(), new String(body.readNBytes(65536), StandardCharsets.UTF_8));
        if (!response.headers().firstValue("content-type").orElse("").contains("text/event-stream")) throw new IOException("Expected an event stream");
        boolean ended = SseReader.read(body, data -> {
          var event = getObjectMapper().readValue(data, dev.macrofold.model.InferenceStreamEvent.class);
          if (!receive.test(event)) return true;
          if ("transport.error".equals(event.getType())) throw new IOException("Stream interrupted; retrieve the saved run result");
          return java.util.Set.of("run.succeeded", "run.failed", "run.cancelled", "run.timed_out").contains(event.getType());
        });
        if (!ended) throw new IOException("Stream ended before terminal result; retrieve the saved run result");
      } finally { deadline.cancel(false); }
    } catch (ApiException error) { throw new RequestException(error, key); }
      catch (IOException error) { throw new IOException("Inference stream interrupted; idempotency key: "+key, error); }
    finally { deadlines.shutdownNow(); }
  }

  private void streamTarget(
      String customerId,
      UUID customerAgentId,
      UUID runId,
      String after,
      UUID organization,
      Predicate<Event> receive)
      throws IOException, InterruptedException, ApiException {
    String path =
        customerAgentId == null
            ? "/v1/runs/" + runId
            : "/v1/integration-paths/customer-agents/"
                + java.net.URLEncoder.encode(customerId, StandardCharsets.UTF_8).replace("+", "%20")
                + "/"
                + customerAgentId
                + "/runs/"
                + runId;
    if (after == null || !after.matches("[0-9]+"))
      throw new IllegalArgumentException("Use a numeric event cursor");
    BigInteger cursor = new BigInteger(after);
    int failures = 0;
    RunsApi runs = new RunsApi(this);
    CustomerAgentsApi customers = new CustomerAgentsApi(this);
    java.util.concurrent.ScheduledExecutorService deadlines =
        java.util.concurrent.Executors.newSingleThreadScheduledExecutor();
    try {
      while (true) {
        HttpRequest.Builder request =
            HttpRequest.newBuilder(URI.create(getBaseUri() + path + "/stream?after=" + cursor))
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
            final BigInteger current = cursor;
            final BigInteger[] delivered = {cursor};
            boolean ended;
            try { ended = SseReader.read(body, data -> {
              Event event;
              try { event = getObjectMapper().readValue(data, Event.class); }
              catch (com.fasterxml.jackson.core.JsonProcessingException ignored) { return false; }
              if (event.getSequence() == null || !event.getSequence().matches("[0-9]+")) return false;
              BigInteger sequence = new BigInteger(event.getSequence());
              if (sequence.compareTo(delivered[0]) <= 0) return false;
              delivered[0] = sequence;
              return !receive.test(event) || java.util.Set.of("run.succeeded", "run.failed", "run.cancelled", "run.timed_out").contains(event.getType());
            }); } finally {
              // Preserve delivered identity even if the next network read fails.
              cursor = delivered[0];
              if (cursor.compareTo(current) > 0) failures = 0;
            }
            if (ended) return;
          } finally {
            deadline.cancel(false);
          }
        } catch (IOException error) {
          if (++failures > 8) throw error;
          Thread.sleep(Math.min(10000, 250L << failures));
          continue;
        }
        Run run =
            customerAgentId == null
                ? runs.getRun(runId, organization)
                : customers.getCustomerAgentRun(customerId, customerAgentId, runId, organization);
        if (java.util.Set.of("succeeded", "failed", "cancelled", "timed_out")
                .contains(run.getStatus().getValue())
            && (customerAgentId == null
                    ? runs.listRunEvents(runId, cursor.toString(), null, 1, organization)
                    : customers.listCustomerAgentRunEvents(
                        customerId,
                        customerAgentId,
                        runId,
                        organization,
                        cursor.toString(),
                        null,
                        1))
                .getData()
                .isEmpty()) return;
        Thread.sleep(250);
      }
    } finally {
      deadlines.shutdownNow();
    }
  }
}
