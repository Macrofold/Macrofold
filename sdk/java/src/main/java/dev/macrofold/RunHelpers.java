package dev.macrofold;

import dev.macrofold.api.RunsApi;
import dev.macrofold.model.RunResult;
import java.io.*;
import java.net.http.*;
import java.time.Duration;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.util.function.Predicate;

/** SDK presentation policy; SSE and HTTP stay in their existing transports. */
final class RunHelpers {
  private RunHelpers() {}

  static void streamText(Resources.RunsResource runs, UUID id, String after, Predicate<String> receive)
      throws IOException, InterruptedException, ApiException, RunFailedException, WaitTimeoutException {
    boolean[] detached = {false};
    runs.events(id, after, event -> {
      Object text = event.getData().get("text");
      if ("output.delta".equals(event.getType()) && text instanceof String && !((String) text).isEmpty())
        detached[0] = !receive.test((String) text);
      return !detached[0];
    });
    if (!detached[0]) runs.wait(id);
  }

  static RunResult waitForRun(Resources client, UUID id, UUID organization, Duration timeout)
      throws ApiException, InterruptedException, RunFailedException, WaitTimeoutException {
    if (timeout != null && timeout.isNegative()) throw new IllegalArgumentException("Timeout must be non-negative");
    long started = System.nanoTime();
    long budget = timeout == null ? Long.MAX_VALUE : timeout.toNanos();
    AtomicReference<InputStream> body = new AtomicReference<>();
    ScheduledExecutorService deadlines = timeout == null ? null : Executors.newSingleThreadScheduledExecutor();
    ScheduledFuture<?> deadline = deadlines == null ? null : deadlines.schedule(() -> close(body.get()), budget, TimeUnit.NANOSECONDS);
    HttpClient http = client.getHttpClient();
    // A per-wait view caps requests without mutating shared client configuration.
    ApiClient bounded = new ApiClient() {
      @Override public HttpClient getHttpClient() { return http; }
      @Override public com.fasterxml.jackson.databind.ObjectMapper getObjectMapper() { return client.getObjectMapper(); }
      @Override public String getBaseUri() { return client.getBaseUri(); }
      @Override public Duration getReadTimeout() { return client.getReadTimeout(); }
      @Override public Consumer<HttpRequest.Builder> getRequestInterceptor() {
        return request -> {
          if (client.getRequestInterceptor() != null) client.getRequestInterceptor().accept(request);
          if (timeout != null) request.timeout(Duration.ofNanos(Math.max(1, budget - (System.nanoTime() - started))));
        };
      }
      @Override public Consumer<HttpResponse<InputStream>> getResponseInterceptor() {
        return response -> {
          body.set(response.body());
          if (timeout != null && System.nanoTime() - started >= budget) close(response.body());
          if (client.getResponseInterceptor() != null) client.getResponseInterceptor().accept(response);
        };
      }
    };
    RunsApi runs = new RunsApi(bounded);
    try {
      while (true) {
        check(id, started, budget);
        var run = runs.getRun(id, organization);
        check(id, started, budget);
        if (Set.of("succeeded", "failed", "cancelled", "timed_out").contains(run.getStatus().getValue())) {
          var result = runs.getRunResult(id, organization);
          check(id, started, budget);
          if (Boolean.TRUE.equals(result.getFinal()) && !"pending".equals(result.getPersistenceStatus())) {
            if (!"succeeded".equals(run.getStatus().getValue()) || !"success".equals(result.getExecutionOutcome())
                || !("verified".equals(result.getPersistenceStatus()) || "not_required".equals(result.getPersistenceStatus())))
              throw new RunFailedException(id, run.getStatus().getValue(), run.getFailureCode(), result);
            return result;
          }
        }
        TimeUnit.NANOSECONDS.sleep(Math.min(TimeUnit.SECONDS.toNanos(1), Math.max(0, budget - (System.nanoTime() - started))));
      }
    } catch (ApiException error) {
      check(id, started, budget);
      throw error;
    } finally {
      if (deadline != null) deadline.cancel(false);
      if (deadlines != null) deadlines.shutdownNow();
      close(body.get());
    }
  }

  private static void check(UUID id, long started, long budget) throws WaitTimeoutException, InterruptedException {
    if (Thread.currentThread().isInterrupted()) throw new InterruptedException("Waiting detached");
    if (System.nanoTime() - started >= budget) throw new WaitTimeoutException(id);
  }
  private static void close(InputStream body) {
    if (body != null) try { body.close(); } catch (IOException ignored) { /* Reader observes closure. */ }
  }
}
