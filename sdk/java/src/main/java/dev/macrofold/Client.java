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
  // One bounded daemon timer serves all callers; cancelled tasks release response bodies.
  private static final java.util.concurrent.ScheduledThreadPoolExecutor INFERENCE_DEADLINES =
      inferenceDeadlines();

  private static java.util.concurrent.ScheduledThreadPoolExecutor inferenceDeadlines() {
    var executor =
        new java.util.concurrent.ScheduledThreadPoolExecutor(
            2,
            task -> {
              var thread = new Thread(task, "macrofold-inference-deadline");
              thread.setDaemon(true);
              return thread;
            });
    executor.setRemoveOnCancelPolicy(true);
    return executor;
  }

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

  private HttpResponse<InputStream> openInference(
      dev.macrofold.model.InferenceCreate input,
      RequestOptions options,
      String key,
      boolean stream,
      long deadline,
      java.util.concurrent.ScheduledExecutorService deadlines)
      throws IOException, InterruptedException, ApiException {
    var payload = getObjectMapper().valueToTree(input);
    if (stream) ((com.fasterxml.jackson.databind.node.ObjectNode) payload).put("stream", true);
    String body = getObjectMapper().writeValueAsString(payload);
    for (int attempt = 0; ; attempt++) {
      long remaining = deadline - System.nanoTime();
      if (remaining <= 0)
        throw new java.net.http.HttpTimeoutException("Inference deadline expired");
      var request =
          HttpRequest.newBuilder(URI.create(getBaseUri() + "/v1/inferences"))
              .header("Authorization", "Bearer " + token)
              .header("X-Client-Type", "sdk")
              .header("Idempotency-Key", key)
              .header("Content-Type", "application/json")
              .timeout(Duration.ofNanos(remaining))
              .POST(HttpRequest.BodyPublishers.ofString(body));
      if (stream) request.header("Accept", "text/event-stream");
      if (options.organization() != null)
        request.header("X-Organization-Id", options.organization().toString());
      var response =
          getHttpClient().send(request.build(), HttpResponse.BodyHandlers.ofInputStream());
      if (response.statusCode() >= 200 && response.statusCode() < 300) return response;
      String responseBody;
      var bodyTimer =
          deadlines.schedule(
              () -> {
                try {
                  response.body().close();
                } catch (IOException ignored) {
                }
              },
              Math.max(0, deadline - System.nanoTime()),
              java.util.concurrent.TimeUnit.NANOSECONDS);
      try (var inputBody = response.body()) {
        responseBody = new String(inputBody.readNBytes(65536), StandardCharsets.UTF_8);
      } catch (IOException error) {
        throw new ApiException(error.getMessage(), error, response.statusCode(), response.headers(), null);
      } finally {
        bodyTimer.cancel(false);
      }
      var error =
          new ApiException(
              response.statusCode(),
              "Inference request rejected",
              response.headers(),
              responseBody);
      com.fasterxml.jackson.databind.JsonNode detail;
      try {
        var node = getObjectMapper().readTree(responseBody);
        detail =
            node == null
                ? com.fasterxml.jackson.databind.node.MissingNode.getInstance()
                : node.path("error");
      } catch (IOException malformed) {
        throw error;
      }
      boolean safe =
          detail.path("retryable").asBoolean(false)
              && !detail.path("details").hasNonNull("run_id")
              && response.headers().firstValue("x-run-id").isEmpty()
              && java.util.Set.of(
                      "rate_limited",
                      "inference_capacity_unavailable",
                      "streaming_capacity_unavailable",
                      "inference_service_unavailable",
                      "inference_admission_timeout",
                      "inference_host_budget_exhausted")
                  .contains(detail.path("code").asText());
      if (attempt >= options.inferenceRetries()
          || !java.util.Set.of(429, 503).contains(response.statusCode())
          || !safe) throw error;
      String hint = response.headers().firstValue("retry-after").orElse("0");
      double seconds;
      try {
        seconds = Double.parseDouble(hint);
      } catch (NumberFormatException invalid) {
        try {
          seconds =
              Math.max(
                  0,
                  Duration.between(
                              java.time.Instant.now(),
                              java.time.ZonedDateTime.parse(
                                      hint, java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME)
                                  .toInstant())
                          .toMillis()
                      / 1000.0);
        } catch (java.time.format.DateTimeParseException malformed) {
          seconds = 0;
        }
      }
      if (Double.isInfinite(seconds) && seconds > 0) throw error;
      if (!Double.isFinite(seconds)) seconds = 0;
      double wait =
          Math.max(seconds, 0.2 * Math.pow(2, attempt)) * 1000
              + java.util.concurrent.ThreadLocalRandom.current().nextInt(1, 101);
      if (wait >= (deadline - System.nanoTime()) / 1000000.0) throw error;
      Thread.sleep((long) Math.ceil(wait));
    }
  }

  @Override
  protected dev.macrofold.model.InferenceResponse createImmediateInference(
      dev.macrofold.model.InferenceCreate input, RequestOptions options) throws ApiException {
    String key = options.identity();
    long deadline = System.nanoTime() + options.inferenceTimeout().toNanos();
    var deadlines = INFERENCE_DEADLINES;
    HttpHeaders responseHeaders = null;
    try {
      if (Boolean.TRUE.equals(input.getStream()))
        throw new IllegalArgumentException("use inferences().stream for incremental output");
      var response = openInference(input, options, key, false, deadline, deadlines);
      responseHeaders = response.headers();
      var timer =
          deadlines.schedule(
              () -> {
                try {
                  response.body().close();
                } catch (IOException ignored) {
                }
              },
              Math.max(0, deadline - System.nanoTime()),
              java.util.concurrent.TimeUnit.NANOSECONDS);
      try (var body = response.body()) {
        return getObjectMapper().readValue(body, dev.macrofold.model.InferenceResponse.class);
      } finally {
        timer.cancel(false);
      }
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      throw new RequestException(
          new ApiException(error.getMessage(), error, 0, responseHeaders, null), key);
    } catch (IOException error) {
      throw new RequestException(
          new ApiException(error.getMessage(), error, 0, responseHeaders, null), key);
    } catch (ApiException error) {
      throw new RequestException(error, key);
    }
  }

  @Override
  protected void streamInference(
      dev.macrofold.model.InferenceCreate input,
      RequestOptions options,
      Predicate<dev.macrofold.model.InferenceStreamEvent> receive)
      throws IOException, InterruptedException, ApiException {
    String key = options.identity();
    long deadline = System.nanoTime() + options.inferenceTimeout().toNanos();
    var deadlines = INFERENCE_DEADLINES;
    HttpHeaders responseHeaders = null;
    var identity =
        new java.util.concurrent.atomic.AtomicReference<com.fasterxml.jackson.databind.JsonNode>();
    try {
      var response = openInference(input, options, key, true, deadline, deadlines);
      responseHeaders = response.headers();
      if (response.headers().firstValue("x-run-id").isPresent()) {
        var initial = getObjectMapper().createObjectNode();
        initial.put("run_id", response.headers().firstValue("x-run-id").orElseThrow());
        identity.set(initial);
      }
      var timer =
          deadlines.schedule(
              () -> {
                try {
                  response.body().close();
                } catch (IOException ignored) {
                }
              },
              Math.max(0, deadline - System.nanoTime()),
              java.util.concurrent.TimeUnit.NANOSECONDS);
      try (var body = response.body()) {
        if (!response.headers().firstValue("content-type").orElse("").contains("text/event-stream"))
          throw new IOException("Expected an event stream");
        boolean ended =
            SseReader.read(
                body,
                data -> {
                  var raw = getObjectMapper().readTree(data);
                  if (raw == null
                      || !raw.isObject()
                      || raw.path("schema_version").asInt() != 1
                      || !raw.path("run_id").isTextual()
                      || !raw.path("type").isTextual()
                      || !raw.path("data").isObject())
                    throw new IOException("Invalid inference stream frame");
                  var event =
                      getObjectMapper()
                          .treeToValue(raw, dev.macrofold.model.InferenceStreamEvent.class);
                  var known = identity.get();
                  if (known != null
                      && !raw.path("data").has("urls")
                      && known.path("data").has("urls"))
                    ((com.fasterxml.jackson.databind.node.ObjectNode) raw.path("data"))
                        .set("urls", known.path("data").path("urls"));
                  identity.set(raw);
                  if (!receive.test(event)) return true;
                  String type = raw.path("type").asText();
                  if ("transport.error".equals(type))
                    throw new IOException("Stream interrupted; retrieve the saved run result");
                  return java.util.Set.of(
                          "run.succeeded", "run.failed", "run.cancelled", "run.timed_out")
                      .contains(type);
                });
        if (!ended)
          throw new IOException(
              "Stream ended before terminal result; retrieve the saved run result");
      } finally {
        timer.cancel(false);
      }
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      throw new RequestException(
          new ApiException(error.getMessage(), error, 0, responseHeaders, null),
          key,
          identity.get());
    } catch (IOException error) {
      throw new RequestException(
          new ApiException(error.getMessage(), error, 0, responseHeaders, null),
          key,
          identity.get());
    } catch (ApiException error) {
      throw new RequestException(error, key, identity.get());
    }
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
      for (int connections = 0; connections < 2048; connections++) {
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
            try {
              ended =
                  SseReader.read(
                      body,
                      data -> {
                        Event event;
                        try {
                          event = getObjectMapper().readValue(data, Event.class);
                        } catch (com.fasterxml.jackson.core.JsonProcessingException ignored) {
                          return false;
                        }
                        if (event.getSequence() == null || !event.getSequence().matches("[0-9]+"))
                          return false;
                        BigInteger sequence = new BigInteger(event.getSequence());
                        if (sequence.compareTo(delivered[0]) <= 0) return false;
                        delivered[0] = sequence;
                        return !receive.test(event)
                            || java.util.Set.of(
                                    "run.succeeded",
                                    "run.failed",
                                    "run.cancelled",
                                    "run.timed_out",
                                    "run.recovery_required")
                                .contains(event.getType());
                      });
            } finally {
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
        if ("run_recovery_required".equals(run.getFailureCode())) return;
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
      throw new IOException(
          "Stream attachment limit reached. Reattach after "
              + cursor
              + "; the run has not been cancelled.");
    } finally {
      deadlines.shutdownNow();
    }
  }
}
