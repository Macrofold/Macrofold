package dev.macrofold;

import static org.junit.jupiter.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;
import dev.macrofold.api.ProjectsApi;
import dev.macrofold.model.Limits;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class ClientTest {
  static final String ID = "00000000-0000-4000-8000-000000000001";

  static String event(String sequence, String type) {
    return "data: {\"id\":\""
        + ID
        + "\",\"schema_version\":1,\"run_id\":\""
        + ID
        + "\",\"sequence\":\""
        + sequence
        + "\",\"type\":\""
        + type
        + "\",\"occurred_at\":\"2026-09-07T00:00:00Z\",\"ingested_at\":\"2026-09-07T00:00:00Z\",\"data\":{\"text\":\"hello"
        + " 🌍\"}}\r\n\r\n";
  }

  @Test
  void typedRequestAndStreamRecovery() throws Exception {
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    AtomicInteger streams = new AtomicInteger();
    List<String> cursors = new ArrayList<>(), authorization = new ArrayList<>();
    server.createContext(
        "/",
        exchange -> {
          authorization.add(exchange.getRequestHeaders().getFirst("Authorization"));
          String body;
          if (exchange.getRequestURI().getPath().endsWith("/projects")) {
            assertTrue(exchange.getRequestURI().getQuery().contains("limit=3"));
            body = "{\"data\":[],\"next_cursor\":null}";
          } else if (exchange.getRequestURI().getPath().endsWith("/stream")) {
            cursors.add(exchange.getRequestHeaders().getFirst("Last-Event-ID"));
            body =
                streams.incrementAndGet() == 1
                    ? event("1", "output.delta")
                    : event("1", "output.delta") + event("2", "run.succeeded");
          } else
            body =
                "{\"id\":\""
                    + ID
                    + "\",\"organization_id\":\""
                    + ID
                    + "\",\"session_id\":\""
                    + ID
                    + "\",\"workspace_id\":\""
                    + ID
                    + "\",\"harness\":\"codex\",\"model\":\"simulator\",\"status\":\"running\",\"created_at\":\"2026-09-07T00:00:00Z\"}";
          exchange
              .getResponseHeaders()
              .set(
                  "Content-Type",
                  body.startsWith("data:") ? "text/event-stream" : "application/json");
          byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(200, bytes.length);
          try (var out = exchange.getResponseBody()) {
            for (byte b : bytes) out.write(b);
          }
        });
    server.start();
    try {
      Client client = new Client("http://127.0.0.1:" + server.getAddress().getPort(), "fixture");
      assertTrue(
          new ProjectsApi(client).listProjects(null, 3, null, null, null).getData().isEmpty());
      List<String> sequences = new ArrayList<>();
      client.stream(
          UUID.fromString(ID),
          "0",
          e -> {
            sequences.add(e.getSequence());
            assertEquals("hello 🌍", e.getData().get("text"));
            return true;
          });
      assertEquals(List.of("1", "2"), sequences);
      assertEquals(List.of("0", "1"), cursors);
      assertTrue(authorization.stream().allMatch("Bearer fixture"::equals));
    } finally {
      server.stop(0);
    }
  }

  @Test
  void deniedStreamAndOrigins() throws Exception {
    for (String origin :
        List.of(
            "http://example.com",
            "https://user:secret@example.com",
            "https://example.com/path",
            "https://example.com?key=secret"))
      assertThrows(IllegalArgumentException.class, () -> new Client(origin, "fixture"));
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    AtomicInteger calls = new AtomicInteger();
    server.createContext(
        "/",
        exchange -> {
          calls.incrementAndGet();
          exchange.sendResponseHeaders(403, -1);
          exchange.close();
        });
    server.start();
    try {
      Client client = new Client("http://127.0.0.1:" + server.getAddress().getPort(), "fixture");
      ApiException error =
          assertThrows(
              ApiException.class,
              () -> client.stream(UUID.fromString(ID), "0", e -> fail("unexpected event")));
      assertEquals(403, error.getCode());
      assertEquals(1, calls.get());
      assertTrue(
          client
              .getObjectMapper()
              .writeValueAsString(
                  new Limits().timeoutSeconds(300).maxCostMicroUsd("9007199254740993"))
              .contains("\"9007199254740993\""));
    } finally {
      server.stop(0);
    }
  }

  @Test
  void mutationAndBinaryWireContract() throws Exception {
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    List<String> bodies = new ArrayList<>(),
        types = new ArrayList<>(),
        revisions = new ArrayList<>(),
        keys = new ArrayList<>(),
        queries = new ArrayList<>();
    server.createContext(
        "/",
        exchange -> {
          bodies.add(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
          types.add(exchange.getRequestHeaders().getFirst("Content-Type"));
          revisions.add(exchange.getRequestHeaders().getFirst("If-Match"));
          keys.add(exchange.getRequestHeaders().getFirst("Idempotency-Key"));
          queries.add(exchange.getRequestURI().getQuery());
          String body =
              exchange.getRequestMethod().equals("POST")
                  ? "{\"id\":\""
                      + ID
                      + "\",\"organization_id\":\""
                      + ID
                      + "\",\"name\":\"Research\",\"persistence\":\"persistent\",\"created_at\":\"2026-09-07T00:00:00Z\"}"
                  : "{\"id\":\""
                      + ID
                      + "\",\"kind\":\"file.write\",\"status\":\"succeeded\",\"created_at\":\"2026-09-07T00:00:00Z\",\"result\":{\"revision\":\"revision-2\"}}";
          byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
          exchange.getResponseHeaders().set("Content-Type", "application/json");
          exchange.sendResponseHeaders(200, bytes.length);
          try (var out = exchange.getResponseBody()) {
            out.write(bytes);
          }
        });
    server.start();
    java.nio.file.Path file = java.nio.file.Files.createTempFile("macrofold-upload-", ".bin");
    try {
      Client client = new Client("http://127.0.0.1:" + server.getAddress().getPort(), "fixture");
      assertEquals(
          "Research",
          new ProjectsApi(client)
              .createProject(
                  "request-1", new dev.macrofold.model.ProjectCreate().name("Research"), null)
              .getName());
      java.nio.file.Files.write(
          file, new byte[] {104, 101, 108, 108, 111, 0, 119, 111, 114, 108, 100});
      var result =
          new dev.macrofold.api.WorkspacesApi(client)
              .writeFile(
                  UUID.fromString(ID),
                  "notes/a + b.bin",
                  "revision-1",
                  "request-2",
                  file.toFile(),
                  null);
      assertEquals(dev.macrofold.model.Operation.StatusEnum.SUCCEEDED, result.getStatus());
      assertEquals(List.of("application/json", "application/octet-stream"), types);
      assertEquals(List.of("request-1", "request-2"), keys);
      assertEquals("revision-1", revisions.get(1));
      assertEquals("path=notes/a + b.bin", queries.get(1));
      assertTrue(bodies.get(0).contains("\"name\":\"Research\""));
      assertEquals("hello" + (char) 0 + "world", bodies.get(1));
    } finally {
      java.nio.file.Files.delete(file);
      server.stop(0);
    }
  }

  @Test
  void applicationWorkflow() throws Exception {
    String origin = System.getenv("MACROFOLD_FIXTURE_ORIGIN");
    org.junit.jupiter.api.Assumptions.assumeTrue(
        origin != null, "Run pnpm test:sdks for isolated application acceptance");
    Client client = new Client(origin, System.getenv("MACROFOLD_FIXTURE_KEY"));
    var project =
        new ProjectsApi(client)
            .createProject(
                "java-project",
                new dev.macrofold.model.ProjectCreate().name("Java application fixture"),
                null);
    var runs = new dev.macrofold.api.RunsApi(client);
    var body =
        new dev.macrofold.model.RunCreate()
            .prompt("Verify Java persisted execution.")
            .projectId(project.getId())
            .harness(dev.macrofold.model.RunCreate.HarnessEnum.CODEX)
            .model("fixture-model")
            .billingMode(dev.macrofold.model.RunCreate.BillingModeEnum.MANAGED);
    var run = runs.createRun("java-run-fixture", body, null);
    List<String> events = new ArrayList<>();
    client.stream(
        run.getRunId(),
        "0",
        event -> {
          events.add(event.getType());
          return true;
        });
    assertEquals("run.succeeded", events.get(events.size() - 1));
    var result = runs.getRunResult(run.getRunId(), null);
    assertTrue(result.getFinal());
    assertTrue(result.getOutputText().contains("Simulation completed"));
  }
}
