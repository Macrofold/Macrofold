package dev.macrofold;

import static org.junit.jupiter.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;
import dev.macrofold.model.Limits;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class ClientTest {
  static final String ID = "00000000-0000-4000-8000-000000000001";

  public static class CredentialProbe {
    public static void main(String[] args) {
      if (args[0].equals("missing")) {
        assertThrows(IllegalArgumentException.class, Client::new);
      } else {
        Client client = new Client();
        assertEquals(Client.DEFAULT_ORIGIN, client.getBaseUri());
        var request = java.net.http.HttpRequest.newBuilder(java.net.URI.create(Client.DEFAULT_ORIGIN));
        client.getRequestInterceptor().accept(request);
        assertEquals("Bearer environment-fixture", request.build().headers().firstValue("Authorization").orElseThrow());
        assertThrows(IllegalArgumentException.class, () -> Client.builder().apiKey("").build());
      }
    }
  }

  @Test
  void environmentCredentialsAndDefaultOrigin() throws Exception {
    for (String mode : List.of("missing", "present")) {
      var child = new ProcessBuilder(System.getProperty("java.home") + "/bin/java", "-cp", System.getProperty("java.class.path"), CredentialProbe.class.getName(), mode);
      child.environment().remove("MACROFOLD_API_KEY");
      if (mode.equals("present")) child.environment().put("MACROFOLD_API_KEY", "environment-fixture");
      var process = child.redirectErrorStream(true).start();
      String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
      assertEquals(0, process.waitFor(), output);
    }
  }

  @Test
  void resourceFailureRetainsAutomaticIdentity() throws Exception {
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    List<String> keys = new ArrayList<>();
    server.createContext("/", exchange -> {
      keys.add(exchange.getRequestHeaders().getFirst("Idempotency-Key"));
      exchange.sendResponseHeaders(503, -1);
      exchange.close();
    });
    server.start();
    try {
      Client client = Client.builder().baseURL("http://127.0.0.1:" + server.getAddress().getPort()).apiKey("fixture").build();
      RequestException error = assertThrows(RequestException.class, () -> client.projects().create(new dev.macrofold.model.ProjectCreate().name("Research")));
      assertEquals(503, error.getCode());
      assertEquals(List.of(error.getIdempotencyKey()), keys);
      assertNotNull(UUID.fromString(error.getIdempotencyKey()));
    } finally { server.stop(0); }
  }

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
    List<String> cursors = new ArrayList<>(), authorization = new ArrayList<>(), organizations = new ArrayList<>();
    AtomicInteger historyChecks = new AtomicInteger();
    server.createContext(
        "/",
        exchange -> {
          authorization.add(exchange.getRequestHeaders().getFirst("Authorization"));
          organizations.add(exchange.getRequestHeaders().getFirst("X-Organization-Id"));
          String body;
          if (exchange.getRequestURI().getPath().endsWith("/projects")) {
            assertTrue(exchange.getRequestURI().getQuery().contains("limit=3"));
            body = "{\"data\":[],\"next_cursor\":null}";
          } else if (exchange.getRequestURI().getPath().endsWith("/events")) {
            historyChecks.incrementAndGet();
            body = "{\"data\":[" + event("2", "run.succeeded").substring(6).trim() + "],\"next_cursor\":null}";
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
                    + "\",\"harness\":\"codex\",\"model\":\"simulator\",\"status\":\"succeeded\",\"created_at\":\"2026-09-07T00:00:00Z\"}";
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
          client.projects().list(new Resources.ListProjectsParams().limit(3)).getData().isEmpty());
      List<String> sequences = new ArrayList<>();
      client.runs().withOptions(new RequestOptions(null, UUID.fromString(ID))).stream(
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
      assertNull(organizations.get(0));
      assertEquals(List.of(ID, ID, ID, ID), organizations.subList(1, organizations.size()));
      assertEquals(1, historyChecks.get());
      client.projects().list(new Resources.ListProjectsParams().limit(3));
      assertNull(organizations.get(organizations.size() - 1));
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
              () -> client.runs().stream(UUID.fromString(ID), "0", e -> fail("unexpected event")));
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
          client.projects().withOptions(new RequestOptions("request-1", null))
              .create(new dev.macrofold.model.ProjectCreate().name("Research"))
              .getName());
      java.nio.file.Files.write(
          file, new byte[] {104, 101, 108, 108, 111, 0, 119, 111, 114, 108, 100});
      var result =
          client.workspaces().withOptions(new RequestOptions("request-2", null))
              .writeFile(UUID.fromString(ID), file.toFile(), new Resources.WriteFileParams("notes/a + b.bin", "revision-1"));
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
    var filesWorkspace = UUID.fromString(System.getenv("MACROFOLD_FIXTURE_FILES_WORKSPACE"));
    for (var entry : Map.of("notes/日本語 + #?.bin", new byte[]{0, (byte)255, 10, (byte)128}, "empty.txt", new byte[0]).entrySet()) {
      var file = client.workspaces().readFile(filesWorkspace, new Resources.ReadFileParams(entry.getKey()));
      assertNotNull(file);
      try { assertArrayEquals(entry.getValue(), java.nio.file.Files.readAllBytes(file.toPath())); }
      finally { java.nio.file.Files.delete(file.toPath()); }
    }
    var missing = assertThrows(dev.macrofold.ApiException.class, () -> client.workspaces().readFile(filesWorkspace, new Resources.ReadFileParams("missing.txt")));
    assertEquals(404, missing.getCode());
    var project =
        client.projects().create(new dev.macrofold.model.ProjectCreate().name("Java application fixture"));
    var runs = client.runs();
    var agent = client.agents().create(new dev.macrofold.model.AgentCreate().name("Java preset")
        .harness(dev.macrofold.model.AgentCreate.HarnessEnum.CODEX).model("fixture-model")
        .billingMode(dev.macrofold.model.AgentCreate.BillingModeEnum.MANAGED));
    var body =
        new dev.macrofold.model.RunCreate()
            .prompt("Verify Java persisted execution.")
            .projectId(project.getId())
            .agentId(agent.getId());
    var run = runs.create(body);
    StringBuilder text = new StringBuilder();
    client.runs().streamText(
        run.getRunId(),
        "0",
        part -> {
          text.append(part);
          return true;
        });
    var result = runs.wait(run.getRunId());
    assertEquals(text.toString(), result.getOutputText());
    assertEquals("verified", result.getPersistenceStatus());
    assertEquals(dev.macrofold.model.Run.StatusEnum.SUCCEEDED, runs.get(run.getRunId()).getStatus());
    assertFalse(client.workspaces().listCheckpoints(run.getWorkspaceId()).getData().isEmpty());
    var note = client.workspaces().readFile(run.getWorkspaceId(), new Resources.ReadFileParams("notes/run-" + run.getRunId() + ".md"));
    try { assertTrue(java.nio.file.Files.readString(note.toPath()).contains("Verify Java persisted execution")); }
    finally { java.nio.file.Files.delete(note.toPath()); }
    assertTrue(result.getFinal());
    assertTrue(result.getOutputText().contains("Simulation completed"));
  }
}
