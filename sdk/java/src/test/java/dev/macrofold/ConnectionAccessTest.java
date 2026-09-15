package dev.macrofold;

import dev.macrofold.model.AgentPatch;
import java.util.List;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ConnectionAccessTest {
  @Test void selectionPresence() throws Exception {
    var mapper = JSON.getDefault().getMapper();
    var patch = new AgentPatch();
    assertEquals("{}", mapper.writeValueAsString(patch));
    patch.connectionGrants(List.of());
    assertEquals("{\"connection_grants\":[]}", mapper.writeValueAsString(patch));
    patch.connectionGrants(null);
    assertEquals("{\"connection_grants\":null}", mapper.writeValueAsString(patch));
    assertEquals("{}", mapper.writeValueAsString(mapper.readValue("{}", AgentPatch.class)));
  }
}
