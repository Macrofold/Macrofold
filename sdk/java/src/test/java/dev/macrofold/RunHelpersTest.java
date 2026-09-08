package dev.macrofold;

import static org.junit.jupiter.api.Assertions.*;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

class RunHelpersTest {
  static final UUID ID = UUID.fromString(ClientTest.ID);
  static String state(String status) {
    return "{\"id\":\"" + ID + "\",\"status\":\"" + status + "\",\"failure_code\":\"fixture_failure\"}";
  }
  static String result(String persistence, String outcome) {
    return "{\"run_id\":\"" + ID + "\",\"final\":true,\"output_text\":\"Hello 🌍\",\"execution_outcome\":\"" + outcome + "\",\"persistence_status\":\"" + persistence + "\",\"checkpoint_id\":\"" + ID + "\"}";
  }
  static final class Fixture implements AutoCloseable {
    final HttpServer server;
    final Client client;
    final List<String> paths = new ArrayList<>(), organizations = new ArrayList<>(), cursors = new ArrayList<>();
    Fixture(String... responses) throws Exception {
      server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
      server.createContext("/", exchange -> {
        paths.add(exchange.getRequestMethod()+" "+exchange.getRequestURI());
        organizations.add(exchange.getRequestHeaders().getFirst("X-Organization-Id"));
        cursors.add(exchange.getRequestHeaders().getFirst("Last-Event-ID"));
        boolean expected=paths.size()<=responses.length;
        String response=expected?responses[paths.size()-1]:"{}";
        byte[] bytes=response.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type",response.startsWith("data:")?"text/event-stream":"application/json");
        exchange.sendResponseHeaders(expected?200:500,bytes.length);
        try(var out=exchange.getResponseBody()){out.write(bytes);}
      });
      server.start();
      client=new Macrofold("http://127.0.0.1:"+server.getAddress().getPort(),"fixture");
    }
    public void close(){server.stop(0);}
  }
  @Test void textFiltersReconnectsAndKeepsOrganization() throws Exception {
    try(var fixture=new Fixture(
        ClientTest.event("1","output.delta")+ClientTest.event("2","tool.completed"),state("running"),
        ClientTest.event("1","output.delta")+ClientTest.event("2","tool.completed")+ClientTest.event("3","reasoning.delta")+ClientTest.event("4","run.succeeded"),
        state("succeeded"),result("verified","success"))) {
      List<String> text=new ArrayList<>();
      fixture.client.runs().withOptions(new RequestOptions(null,ID)).streamText(ID, part->{text.add(part);return true;});
      assertEquals(List.of("hello 🌍"),text);
      assertEquals("2",fixture.cursors.get(2));
      assertEquals(Collections.nCopies(5,ID.toString()),fixture.organizations);
      assertTrue(fixture.paths.stream().allMatch(path->path.startsWith("GET ")));
    }
  }
  @Test void terminalReplayRaisesTypedFailures() throws Exception {
    for(String status:List.of("failed","cancelled","timed_out","succeeded")) {
      try(var fixture=new Fixture("",state(status),"{\"data\":[],\"next_cursor\":null}",state(status),
          result(status.equals("succeeded")?"failed":"verified",status.equals("succeeded")?"success":status))) {
        RunFailedException error=assertThrows(RunFailedException.class,()->fixture.client.runs().streamText(ID,"99",text->fail("Unexpected text")));
        assertEquals(ID,error.getRunId());
        assertEquals(status,error.getStatus());
        assertEquals("fixture_failure",error.getFailureCode());
        assertTrue(error.getMessage().contains(ID.toString()));
      }
    }
  }
  @Test void waitIncludesPersistenceAndDetachmentSkipsCompletion() throws Exception {
    try(var fixture=new Fixture(ClientTest.event("1","output.delta"),state("persisting"),state("succeeded"),result("pending","success"),state("succeeded"),result("verified","success"))) {
      fixture.client.runs().streamText(ID,text->false);
      assertEquals(1,fixture.paths.size());
      var result=fixture.client.runs().wait(ID);
      assertEquals("Hello 🌍",result.getOutputText());
      assertEquals(ID,result.getCheckpointId());
      assertEquals(6,fixture.paths.size());
      assertTrue(fixture.paths.subList(1,6).stream().noneMatch(path->path.contains("/stream")));
    }
  }
  @Test void timeoutClosesSlowBodyAndNeverCancelsExecution() throws Exception {
    HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
    CountDownLatch release=new CountDownLatch(1), reached=new CountDownLatch(1);
    List<String> methods=new ArrayList<>();
    server.createContext("/",exchange->{
      methods.add(exchange.getRequestMethod());
      exchange.sendResponseHeaders(200,1000);
      exchange.getResponseBody().write('{');exchange.getResponseBody().flush();reached.countDown();
      try {release.await(5,TimeUnit.SECONDS);} catch(InterruptedException error){Thread.currentThread().interrupt();}
      finally{exchange.close();}
    });
    server.start();
    try {
      var client=new Macrofold("http://127.0.0.1:"+server.getAddress().getPort(),"fixture");
      var error=assertThrows(WaitTimeoutException.class,()->client.runs().wait(ID,Duration.ofMillis(500)));
      assertEquals(ID,error.getRunId());
      assertTrue(reached.await(1,TimeUnit.SECONDS));
      assertEquals(List.of("GET"),methods);
      assertThrows(WaitTimeoutException.class,()->client.runs().wait(ID,Duration.ZERO));
      assertEquals(1,methods.size());
      assertThrows(IllegalArgumentException.class,()->client.runs().wait(ID,Duration.ofSeconds(-1)));
    } finally {release.countDown();server.stop(0);}
  }
}
