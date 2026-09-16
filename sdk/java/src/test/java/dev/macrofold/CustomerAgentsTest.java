package dev.macrofold;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.*;

import java.nio.file.Files;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class CustomerAgentsTest {
  @Test
  void customerPathStreamFilesAndOwnership() throws Exception {
    assumeTrue(System.getenv("MACROFOLD_FIXTURE_CUSTOMER_AGENT") != null);
    var binding = UUID.fromString(System.getenv("MACROFOLD_FIXTURE_CUSTOMER_AGENT"));
    var run = UUID.fromString(System.getenv("MACROFOLD_FIXTURE_CUSTOMER_RUN"));
    var client =
        new Client(
            System.getenv("MACROFOLD_FIXTURE_ORIGIN"), System.getenv("MACROFOLD_FIXTURE_KEY"));
    var api = client.customerAgents();
    String customer = "customer / 日本語";
    assertEquals(customer, api.get(customer, binding).getCustomerId());
    String[] last = {""};
    api.streamRun(
        customer,
        binding,
        run,
        "0",
        event -> {
          last[0] = event.getType();
          return true;
        });
    assertEquals("run.succeeded", last[0]);
    var file =
        api.readFile(
            customer,
            binding,
            new Resources.ReadCustomerAgentFileParams("notes/run-" + run + ".md"));
    try {
      assertTrue(Files.readString(file.toPath()).contains("optional customer-agent path"));
    } finally {
      Files.deleteIfExists(file.toPath());
    }
    var error = assertThrows(ApiException.class, () -> api.getRun("wrong customer", binding, run));
    assertEquals(404, error.getCode());
  }
}
