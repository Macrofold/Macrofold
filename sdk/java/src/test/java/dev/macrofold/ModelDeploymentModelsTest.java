package dev.macrofold;

import static org.junit.jupiter.api.Assertions.*;

import dev.macrofold.model.*;
import org.junit.jupiter.api.Test;

class ModelDeploymentModelsTest {
  @Test
  void bindingSelectsTheDeclaredRequiredShape() throws Exception {
    var mapper = new Client("https://example.test", "fixture").getObjectMapper();
    var deployment = mapper.readValue("{\"deployment_id\":\"01900000-0000-7000-8000-000000000001\"}", InferenceBinding.class);
    assertInstanceOf(ModelDeploymentBinding.class, deployment.getActualInstance());
    var decision = mapper.readValue("{\"provider\":\"openrouter\",\"model\":\"fixture\",\"billing_mode\":\"managed\"}", InferenceBinding.class);
    assertInstanceOf(DecisionBinding.class, decision.getActualInstance());
    assertThrows(Exception.class, () -> mapper.readValue("{}", InferenceBinding.class));
  }

  @Test
  void runtimeAndPolicyRetainExactlyTheirBranch() throws Exception {
    var mapper = new Client("https://example.test", "fixture").getObjectMapper();
    var external = mapper.readValue("{\"kind\":\"external\",\"engine\":null,\"version\":null}", ModelDeploymentRuntime.class);
    assertInstanceOf(ModelDeploymentRuntimeOneOf1.class, external.getActualInstance());
    var managed = mapper.readValue("{\"profile_id\":\"vllm-0.32.0-text\",\"parameters\":{\"context_window_tokens\":8192,\"max_output_tokens\":2048,\"max_concurrent_requests\":2}}", ModelDeploymentRuntime.class);
    assertInstanceOf(ModelDeploymentRuntimeOneOf.class, managed.getActualInstance());
    var policy = mapper.readValue("{\"max_concurrent_requests\":2,\"stop_at\":null}", ModelDeploymentServicePolicy.class);
    assertInstanceOf(ModelDeploymentServicePolicyOneOf1.class, policy.getActualInstance());
    var capacity = mapper.readValue("{\"min_replicas\":1,\"max_replicas\":2,\"max_concurrent_requests\":2,\"max_hourly_cost_micro_usd\":\"1000000\",\"stop_at\":null}", ModelDeploymentServicePolicy.class);
    assertInstanceOf(ModelDeploymentServicePolicyOneOf.class, capacity.getActualInstance());
    assertThrows(Exception.class, () -> mapper.readValue("{\"max_concurrent_requests\":2,\"min_replicas\":1}", ModelDeploymentServicePolicy.class));
  }

  @Test
  void sourceHostingAndCostRetainLiteralTypes() throws Exception {
    var mapper = new Client("https://example.test", "fixture").getObjectMapper();
    String capabilities = "{\"protocol\":\"openai_chat\",\"input_modalities\":[\"text\"],\"chat_completions\":true,\"json_object\":false,\"json_schema\":false,\"tools\":false,\"streaming\":true,\"stream_usage\":true,\"schema_keywords\":[],\"accepted_parameters\":[],\"schema_dialect\":null,\"context_window_tokens\":8192,\"max_output_tokens\":2048,\"max_concurrent_requests\":2}";
    var source = mapper.readValue("{\"kind\":\"external\",\"repository\":null,\"revision\":null,\"capabilities\":"+capabilities+"}", ModelDeploymentSource.class);
    assertInstanceOf(ModelDeploymentExternalSource.class, source.getActualInstance());
    var hf = mapper.readValue("{\"kind\":\"hugging_face\",\"repository\":\"owner/model\"}", ModelDeploymentSource.class);
    assertInstanceOf(ModelDeploymentHuggingFaceSource.class, hf.getActualInstance());
    assertThrows(Exception.class, () -> mapper.readValue("{\"kind\":\"hugging_face\",\"repository\":\"owner/model\",\"capabilities\":"+capabilities+"}", ModelDeploymentSource.class));
    String hosting = "{\"kind\":\"external_openai\",\"endpoint_connection_id\":\"01900000-0000-7000-8000-000000000001\",\"model_alias\":\"fixture\",\"lifecycle\":\"external\",\"external_hosting_acknowledged\":true}";
    var external = mapper.readValue(hosting, ModelDeploymentHosting.class);
    assertInstanceOf(ModelDeploymentHostingOneOf1.class, external.getActualInstance());
    assertTrue(mapper.valueToTree(external).path("external_hosting_acknowledged").isBoolean());
    assertThrows(Exception.class, () -> mapper.readValue(hosting.replace(":true", ":false"), ModelDeploymentHosting.class));
    var cost = mapper.readValue("{\"basis\":\"deployment\",\"request_charge_micro_usd\":\"0\",\"infrastructure_cost_included\":false}", ModelDeploymentCostPolicy.class);
    assertTrue(mapper.valueToTree(cost).path("infrastructure_cost_included").isBoolean());
    assertFalse(mapper.valueToTree(cost).path("infrastructure_cost_included").asBoolean());
  }

  @Test
  void onlyTheNullableResponsePolicyAcceptsNull() throws Exception {
    var mapper = new Client("https://example.test", "fixture").getObjectMapper();
    var policy = mapper.readValue("{\"max_concurrent_requests\":2}", ModelDeploymentServicePolicy.class);
    var deployment = new ModelDeployment().policy(policy);
    mapper.readerForUpdating(deployment).readValue("{\"policy\":null}");
    assertNull(deployment.getPolicy());
    mapper.readerForUpdating(deployment).readValue("{\"policy\":{\"max_concurrent_requests\":2}}");
    assertInstanceOf(ModelDeploymentServicePolicyOneOf1.class, deployment.getPolicy().getActualInstance());
    assertThrows(Exception.class, () -> mapper.readValue("{\"deployment_revision_id\":\"01900000-0000-7000-8000-000000000001\",\"desired_state\":\"running\",\"policy\":null}", ModelDeploymentServiceInput.class));
  }
}
