package dev.macrofold;

import static org.junit.jupiter.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;
import dev.macrofold.model.InferenceCreate;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class ImmediateInferenceTest {
  @Test
  void applicationImmediate() throws Exception {
    String origin = System.getenv("MACROFOLD_FIXTURE_ORIGIN");
    org.junit.jupiter.api.Assumptions.assumeTrue(
        origin != null, "Run pnpm test:sdks for isolated application acceptance");
    var client = new Client(origin, System.getenv("MACROFOLD_FIXTURE_KEY"));
    var input =
        client
            .getObjectMapper()
            .readValue(
                java.nio.file.Files.readString(
                    java.nio.file.Path.of(System.getenv("MACROFOLD_FIXTURE_INFERENCE_INPUT"))),
                InferenceCreate.class);
    java.util.function.Consumer<dev.macrofold.model.RunResult> receipt =
        result -> {
          assertNotNull(result);
          assertEquals(true, result.getFinal());
          assertEquals("not_required", result.getPersistenceStatus());
          var value = client.getObjectMapper().valueToTree(result.getInference());
          assertEquals("value", value.path("outcome").asText());
          assertEquals("100", value.path("usage").path("input_tokens").asText());
          assertEquals("10", value.path("usage").path("output_tokens").asText());
          assertEquals("complete", value.path("usage").path("completeness").asText());
          assertEquals("managed", value.path("billing").path("billing_mode").asText());
          assertFalse(value.path("billing").path("provisional").asBoolean());
          assertTrue(
              new java.math.BigInteger(value.path("billing").path("charged_micro_usd").asText())
                      .signum()
                  > 0);
        };
    var scoped =
        client
            .inferences()
            .withOptions(new RequestOptions(java.util.UUID.randomUUID().toString(), null));
    var response = scoped.create(input);
    assertEquals("succeeded", response.getStatus().toString());
    receipt.accept(response.getResult());
    assertEquals(response.getRunId(), scoped.create(input).getRunId());
    var text = new StringBuilder();
    var terminal = new java.util.concurrent.atomic.AtomicBoolean();
    client.inferences().stream(
        input,
        event -> {
          if ("output.delta".equals(event.getType().toString()))
            text.append(event.getData().getText());
          if ("run.succeeded".equals(event.getType().toString())) {
            receipt.accept(event.getData().getResult());
            terminal.set(true);
          }
          return true;
        });
    assertEquals("Hello from the SDK fixture.", text.toString());
    assertTrue(terminal.get());
  }

  static final String ID = "01900000-0000-7000-8000-000000000001";
  static final String URLS =
      "{\"status\":\"https://example.test/status\",\"result\":\"https://example.test/result\",\"events\":\"https://example.test/events\",\"stream\":\"https://example.test/stream\",\"cancel\":\"https://example.test/cancel\"}";
  static final String RECOVERY =
      "{\"run_id\":\""
          + ID
          + "\",\"session_id\":null,\"worktree_id\":null,\"status\":\"running\",\"recovery_reason\":\"finalization_pending\",\"urls\":"
          + URLS
          + "}";
  static final String BUSY =
      "{\"error\":{\"code\":\"inference_service_unavailable\",\"message\":\"Busy\",\"retryable\":true,\"request_id\":\""
          + ID
          + "\",\"details\":{\"reason\":\"local_capacity\"}}}";

  static InferenceCreate input(Client client) throws Exception {
    return client
        .getObjectMapper()
        .readValue(
            "{\"input\":{},\"model_binding\":{\"provider\":\"openrouter\",\"model\":\"fixture\",\"billing_mode\":\"managed\"},\"limits\":{\"max_cost_micro_usd\":\"1000\",\"max_output_tokens\":10,\"timeout_seconds\":10}}",
            InferenceCreate.class);
  }

  static Client client(HttpServer server) {
    return new Client("http://127.0.0.1:" + server.getAddress().getPort(), "fixture");
  }

  @Test
  void defaultsToOneAttemptAndPreservesIdentity() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    var keys = new ArrayList<String>();
    server.createContext(
        "/",
        exchange -> {
          keys.add(exchange.getRequestHeaders().getFirst("Idempotency-Key"));
          byte[] body = BUSY.getBytes(StandardCharsets.UTF_8);
          exchange.getResponseHeaders().add("Content-Type", "application/json");
          exchange.getResponseHeaders().add("X-Run-Id", ID);
          exchange.sendResponseHeaders(503, body.length);
          exchange.getResponseBody().write(body);
          exchange.close();
        });
    server.start();
    try {
      var client = client(server);
      var input = input(client);
      var error =
          assertThrows(
              RequestException.class,
              () ->
                  client.inferences().withOptions(new RequestOptions("saved", null)).create(input));
      assertEquals("saved", error.getIdempotencyKey());
      assertEquals(ID, error.getRunId());
      assertEquals(List.of("saved"), keys);
    } finally {
      server.stop(0);
    }
  }

  @Test
  void explicitRetryPreservesKeyAndReturnsRecovery() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    var keys = new ArrayList<String>();
    server.createContext(
        "/",
        exchange -> {
          keys.add(exchange.getRequestHeaders().getFirst("Idempotency-Key"));
          boolean first = keys.size() == 1;
          byte[] body = (first ? BUSY : RECOVERY).getBytes(StandardCharsets.UTF_8);
          exchange.getResponseHeaders().add("Content-Type", "application/json");
          exchange.sendResponseHeaders(first ? 503 : 202, body.length);
          exchange.getResponseBody().write(body);
          exchange.close();
        });
    server.start();
    try {
      var client = client(server);
      var value =
          client
              .inferences()
              .withOptions(new RequestOptions("saved", null, 1, Duration.ofSeconds(5)))
              .create(input(client));
      assertEquals(ID, value.getRunId().toString());
      assertNull(value.getResult());
      assertEquals(List.of("saved", "saved"), keys);
    } finally {
      server.stop(0);
    }
  }

  @Test
  void honorsRetryHintWithoutStartingAnotherTimeoutWindow() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    var calls = new AtomicInteger();
    server.createContext(
        "/",
        exchange -> {
          calls.incrementAndGet();
          byte[] body = BUSY.getBytes(StandardCharsets.UTF_8);
          exchange.getResponseHeaders().add("Retry-After", "3600");
          exchange.sendResponseHeaders(503, body.length);
          exchange.getResponseBody().write(body);
          exchange.close();
        });
    server.start();
    try {
      var client = client(server);
      var input = input(client);
      assertThrows(
          RequestException.class,
          () ->
              client
                  .inferences()
                  .withOptions(new RequestOptions("saved", null, 2, Duration.ofSeconds(1)))
                  .create(input));
      assertEquals(1, calls.get());
    } finally {
      server.stop(0);
    }
  }

  @Test
  void interruptedStreamRetainsAcceptedReceipt() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    String accepted =
        "data: {\"schema_version\":1,\"run_id\":\""
            + ID
            + "\",\"type\":\"run.accepted\",\"occurred_at\":\"2026-10-16T00:00:00Z\",\"data\":{\"run_id\":\""
            + ID
            + "\",\"session_id\":null,\"worktree_id\":null,\"status\":\"running\",\"delivery\":\"live\",\"urls\":"
            + URLS
            + "}}\n\n";
    server.createContext(
        "/",
        exchange -> {
          byte[] body = accepted.getBytes(StandardCharsets.UTF_8);
          exchange.getResponseHeaders().add("Content-Type", "text/event-stream");
          exchange.getResponseHeaders().add("X-Request-Id", ID);
          exchange.sendResponseHeaders(200, body.length);
          exchange.getResponseBody().write(body);
          exchange.close();
        });
    server.start();
    try {
      var client = client(server);
      var input = input(client);
      var error =
          assertThrows(
              RequestException.class,
              () ->
                  client.inferences().withOptions(new RequestOptions("saved", null)).stream(
                      input, event -> true));
      assertEquals(ID, error.getRunId());
      assertEquals(ID, error.getRequestId());
      assertEquals("https://example.test/result", error.getUrls().path("result").asText());
      assertEquals("saved", error.getIdempotencyKey());
    } finally {
      server.stop(0);
    }
  }
}
