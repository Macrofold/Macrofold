# Generated keyword-input types from OpenAPI. Do not edit.
from __future__ import annotations
from datetime import date, datetime
from typing import Literal, NotRequired, TypedDict
from uuid import UUID
TaskStepDefinitionParams = TypedDict('TaskStepDefinitionParams', {"definition": "InferenceDefinitionParams", "model_binding": "DecisionBindingParams"})

InferenceDefinitionParams = TypedDict('InferenceDefinitionParams', {"revision": "str", "prompt": "str", "input_schema": "dict[str, object]", "output_schema": "dict[str, object]", "question": "DecisionQuestionParams", "allowed_models": "list[InferenceDefinitionAllowedModelsItemParams]", "limits": "InferenceLimitsParams", "required_records": "NotRequired[list[str]]", "required_known": "NotRequired[list[str]]", "require_complete": "NotRequired[bool]", "require_snapshot": "NotRequired[bool]", "bounded_agent": "NotRequired[BoundedAgentPolicyParams]", "unknown_values": "NotRequired[list[object]]"})

DecisionQuestionChoice1Params = TypedDict('DecisionQuestionChoice1Params', {"kind": "Literal[\"json\"]"})

DecisionQuestionChoice2Params = TypedDict('DecisionQuestionChoice2Params', {"kind": "Literal[\"choice\"]", "criteria": "dict[str, str]"})

DecisionQuestionChoice3Params = TypedDict('DecisionQuestionChoice3Params', {"kind": "Literal[\"score\"]", "criteria": "list[str]"})

DecisionQuestionChoice4Params = TypedDict('DecisionQuestionChoice4Params', {"kind": "Literal[\"provider\"]"})

InferenceDefinitionAllowedModelsItemParams = TypedDict('InferenceDefinitionAllowedModelsItemParams', {"provider": "Literal[\"anthropic\", \"typesafe\", \"openrouter\"]", "model": "str"})

InferenceLimitsParams = TypedDict('InferenceLimitsParams', {"max_cost_micro_usd": "str", "max_output_tokens": "int", "timeout_seconds": "int"})

BoundedAgentPolicyParams = TypedDict('BoundedAgentPolicyParams', {"max_model_calls": "int", "max_tool_calls": "int", "context_artifacts": "list[ContextReferenceParams]"})

ContextReferenceParams = TypedDict('ContextReferenceParams', {"artifact_id": "str | UUID", "revision": "str", "audience": "ContextAudienceParams"})

ContextAudienceParams = TypedDict('ContextAudienceParams', {"kind": "Literal[\"application_actor\", \"application\"]", "id": "str"})

DecisionBindingParams = TypedDict('DecisionBindingParams', {"provider": "Literal[\"anthropic\", \"typesafe\", \"openrouter\"]", "model": "str", "billing_mode": "Literal[\"managed\", \"byok\"]", "provider_connection_id": "NotRequired[str | UUID]"})

ExplicitContextParams = TypedDict('ExplicitContextParams', {"schema_version": "Literal[1]", "template_revision": "str", "audience": "ContextAudienceParams", "items": "list[ContextItemParams]", "complete": "bool", "truncated": "bool", "consistency": "Literal[\"snapshot\", \"read_interval\"]", "observed_at": "str | datetime", "read_completed_at": "NotRequired[str | datetime]", "expires_at": "NotRequired[str | datetime]", "dependency_tokens": "dict[str, str]"})

ContextItemParams = TypedDict('ContextItemParams', {"id": "str", "kind": "Literal[\"observation\", \"inference\", \"correction\", \"instruction\"]", "status": "Literal[\"known\", \"unknown\", \"conflicting\", \"not_applicable\", \"omitted\"]", "value": "NotRequired[object]", "source": "str", "source_revision": "str", "observed_at": "str | datetime"})

GrantParams = TypedDict('GrantParams', {"connection_id": "str | UUID", "tools": "list[str]"})

ModelParametersParams = TypedDict('ModelParametersParams', {"reasoning": "NotRequired[ModelParametersReasoningParams]", "provider": "NotRequired[ModelParametersProviderParams]"})

ModelParametersReasoningParams = TypedDict('ModelParametersReasoningParams', {"effort": "Literal[\"none\", \"minimal\", \"low\", \"medium\", \"high\", \"xhigh\", \"max\"]"})

ModelParametersProviderParams = TypedDict('ModelParametersProviderParams', {"require_parameters": "bool"})

LimitsParams = TypedDict('LimitsParams', {"timeout_seconds": "NotRequired[int]", "max_cost_micro_usd": "NotRequired[str]", "stop_on_model_error": "NotRequired[bool]", "max_output_tokens": "NotRequired[int]"})

AgentPermissionsParams = TypedDict('AgentPermissionsParams', {"version": "Literal[1]", "files": "NotRequired[AgentPermissionsFilesParams]", "shell": "NotRequired[Literal[\"allow\", \"deny\"]]", "tools": "NotRequired[PermissionPatternsParams]", "questions": "NotRequired[Literal[\"allow\", \"deny\"]]"})

PermissionPatternsParams = TypedDict('PermissionPatternsParams', {"include": "NotRequired[list[str]]", "exclude": "NotRequired[list[str]]"})

AgentPermissionsFilesParams = TypedDict('AgentPermissionsFilesParams', {"read": "NotRequired[PermissionPatternsParams]", "write": "NotRequired[PermissionPatternsParams]"})

ClaudeApiFallbackParams = TypedDict('ClaudeApiFallbackParams', {"connection_id": "NotRequired[str | UUID]", "max_cost_micro_usd": "NotRequired[str]", "enabled": "bool"})

ConnectionAccessRuleInputChoice1Params = TypedDict('ConnectionAccessRuleInputChoice1Params', {"scope": "Literal[\"workspace\"]", "workspace_id": "str | UUID"})

ConnectionAccessRuleInputChoice2Params = TypedDict('ConnectionAccessRuleInputChoice2Params', {"scope": "Literal[\"agent\"]", "agent_id": "str | UUID"})

ConnectionAccessRuleInputChoice3Params = TypedDict('ConnectionAccessRuleInputChoice3Params', {"scope": "Literal[\"workspace_agent\"]", "workspace_id": "str | UUID", "agent_id": "str | UUID"})

ConnectionCapabilityParams = TypedDict('ConnectionCapabilityParams', {"id": "str", "label": "str", "description": "NotRequired[str]", "tools": "list[str]"})

CustomerAgentConfigurationParams = TypedDict('CustomerAgentConfigurationParams', {"harness": "Literal[\"codex\", \"claude-code\", \"opencode\", \"hermes\", \"deepseek\", \"pi\"]", "model": "str", "instructions": "NotRequired[str]", "billing_mode": "Literal[\"byok\", \"managed\", \"subscription\"]", "provider_connection_id": "NotRequired[str | UUID]", "limits": "LimitsParams"})

TransferManifestEntryParams = TypedDict('TransferManifestEntryParams', {"path": "str", "local_sha256": "str | None", "local_size_bytes": "int", "baseline_known": "bool", "baseline_sha256": "str | None"})

CreateWorkspaceGithubParams = TypedDict('CreateWorkspaceGithubParams', {"installation_id": "str", "repository_id": "str", "target_branch": "str", "auto_sync": "NotRequired[bool]", "sync_mode": "NotRequired[Literal[\"push\", \"pull_request\"]]", "auto_pull": "NotRequired[bool]"})

WorktreeSourceChoice1Params = TypedDict('WorktreeSourceChoice1Params', {"kind": "Literal[\"git_ref\"]", "ref": "str"})

WorktreeSourceChoice2Params = TypedDict('WorktreeSourceChoice2Params', {"kind": "Literal[\"checkpoint\"]", "checkpoint_id": "str | UUID"})

UpdateWorkspaceGithubParams = TypedDict('UpdateWorkspaceGithubParams', {"installation_id": "str", "repository_id": "str", "target_branch": "str", "auto_sync": "NotRequired[bool]", "sync_mode": "NotRequired[Literal[\"push\", \"pull_request\"]]", "auto_pull": "NotRequired[bool]"})

DefinitionReferenceParams = TypedDict('DefinitionReferenceParams', {"definition_id": "str | UUID", "revision": "str"})

InferenceCreateParams = TypedDict('InferenceCreateParams', {"workspace_id": "NotRequired[str | UUID]", "definition": "NotRequired[InferenceDefinitionParams | DefinitionReferenceParams]", "input": "object", "context": "NotRequired[ExplicitContextParams | ContextReferenceParams]", "model_binding": "InferenceBindingParams", "limits": "NotRequired[InferenceLimitsParams]", "model_parameters": "NotRequired[ModelParametersParams]", "stream": "NotRequired[bool]"})

ModelDeploymentBindingParams = TypedDict('ModelDeploymentBindingParams', {"deployment_id": "str | UUID", "deployment_revision_id": "NotRequired[str | UUID]"})

ModelDeploymentHuggingFaceSourceParams = TypedDict('ModelDeploymentHuggingFaceSourceParams', {"kind": "Literal[\"hugging_face\"]", "repository": "str", "revision": "NotRequired[str]", "source_connection_id": "NotRequired[str | UUID]", "weight_files": "NotRequired[list[str]]", "tokenizer": "NotRequired[ModelDeploymentHuggingFaceSourceTokenizerParams]", "chat_template": "NotRequired[Literal[\"tokenizer\"]]", "license_acknowledged": "NotRequired[bool]"})

ModelDeploymentHuggingFaceSourceTokenizerParams = TypedDict('ModelDeploymentHuggingFaceSourceTokenizerParams', {"repository": "str", "revision": "NotRequired[str]"})

ModelDeploymentExternalSourceParams = TypedDict('ModelDeploymentExternalSourceParams', {"kind": "Literal[\"external\"]", "repository": "NotRequired[str | None]", "revision": "NotRequired[str | None]", "capabilities": "ModelDeploymentCapabilitiesParams"})

ModelDeploymentCapabilitiesParams = TypedDict('ModelDeploymentCapabilitiesParams', {"protocol": "Literal[\"openai_chat\", \"systemone\"]", "input_modalities": "list[Literal[\"text\"]]", "chat_completions": "bool", "json_object": "bool", "json_schema": "bool", "tools": "bool", "streaming": "bool", "stream_usage": "bool", "schema_keywords": "list[str]", "accepted_parameters": "list[str]", "schema_dialect": "str | None", "context_window_tokens": "int", "max_output_tokens": "int", "max_concurrent_requests": "int"})

ModelDeploymentRuntimeParametersParams = TypedDict('ModelDeploymentRuntimeParametersParams', {"context_window_tokens": "int", "max_output_tokens": "int", "max_concurrent_requests": "int", "dtype": "NotRequired[Literal[\"auto\", \"half\", \"bfloat16\", \"float\"]]", "quantization": "NotRequired[Literal[\"awq\", \"gptq\", \"fp8\", \"compressed-tensors\"]]", "tensor_parallel_size": "NotRequired[int]", "gpu_memory_utilization": "NotRequired[float]", "tool_call_parser": "NotRequired[Literal[\"hermes\", \"llama3_json\", \"mistral\"]]", "reasoning_parser": "NotRequired[Literal[\"deepseek_r1\", \"qwen3\"]]"})

ModelDeploymentRuntimeChoice1Params = TypedDict('ModelDeploymentRuntimeChoice1Params', {"profile_id": "Literal[\"vllm-0.32.0-text\", \"kev-systemone-v1\"]", "parameters": "ModelDeploymentRuntimeParametersParams"})

ModelDeploymentRuntimeChoice2Params = TypedDict('ModelDeploymentRuntimeChoice2Params', {"kind": "Literal[\"external\"]", "engine": "NotRequired[str | None]", "version": "NotRequired[str | None]"})

ModelDeploymentHostingChoice1PlacementParams = TypedDict('ModelDeploymentHostingChoice1PlacementParams', {"region_ids": "list[str]", "gpu_pool_ids": "list[str]", "gpu_count": "int"})

ModelDeploymentHostingChoice1Params = TypedDict('ModelDeploymentHostingChoice1Params', {"kind": "Literal[\"runpod_serverless\"]", "compute_connection_id": "str | UUID", "placement": "ModelDeploymentHostingChoice1PlacementParams"})

ModelDeploymentHostingChoice2Params = TypedDict('ModelDeploymentHostingChoice2Params', {"kind": "Literal[\"external_openai\", \"external_systemone\"]", "endpoint_connection_id": "str | UUID", "model_alias": "str", "lifecycle": "Literal[\"external\"]", "external_hosting_acknowledged": "Literal[True]"})

ModelDeploymentGrantInputParams = TypedDict('ModelDeploymentGrantInputParams', {"subject": "ModelDeploymentGrantInputSubjectChoice1Params | ModelDeploymentGrantInputSubjectChoice2Params", "workspace_scope": "ModelDeploymentGrantInputWorkspaceScopeChoice1Params | ModelDeploymentGrantInputWorkspaceScopeChoice2Params"})

ModelDeploymentGrantInputSubjectChoice1Params = TypedDict('ModelDeploymentGrantInputSubjectChoice1Params', {"kind": "Literal[\"subject\"]", "subject_id": "str | UUID"})

ModelDeploymentGrantInputSubjectChoice2Params = TypedDict('ModelDeploymentGrantInputSubjectChoice2Params', {"kind": "Literal[\"api_key\"]", "api_key_id": "str | UUID"})

ModelDeploymentGrantInputWorkspaceScopeChoice1Params = TypedDict('ModelDeploymentGrantInputWorkspaceScopeChoice1Params', {"kind": "Literal[\"all\"]"})

ModelDeploymentGrantInputWorkspaceScopeChoice2Params = TypedDict('ModelDeploymentGrantInputWorkspaceScopeChoice2Params', {"kind": "Literal[\"selected\"]", "workspace_ids": "list[str | UUID]"})

CreateModelDeploymentAccessParams = TypedDict('CreateModelDeploymentAccessParams', {"grants": "list[ModelDeploymentGrantInputParams]"})

CreateModelDeploymentGrantSubjectChoice1Params = TypedDict('CreateModelDeploymentGrantSubjectChoice1Params', {"kind": "Literal[\"subject\"]", "subject_id": "str | UUID"})

CreateModelDeploymentGrantSubjectChoice2Params = TypedDict('CreateModelDeploymentGrantSubjectChoice2Params', {"kind": "Literal[\"api_key\"]", "api_key_id": "str | UUID"})

CreateModelDeploymentGrantWorkspaceScopeChoice1Params = TypedDict('CreateModelDeploymentGrantWorkspaceScopeChoice1Params', {"kind": "Literal[\"all\"]"})

CreateModelDeploymentGrantWorkspaceScopeChoice2Params = TypedDict('CreateModelDeploymentGrantWorkspaceScopeChoice2Params', {"kind": "Literal[\"selected\"]", "workspace_ids": "list[str | UUID]"})

InspectModelDeploymentRuntimePreferencesParams = TypedDict('InspectModelDeploymentRuntimePreferencesParams', {"profile_id": "NotRequired[Literal[\"vllm-0.32.0-text\", \"kev-systemone-v1\"]]", "parameters": "NotRequired[ModelDeploymentRuntimeParametersParams]"})

ModelDeploymentServicePolicyChoice1Params = TypedDict('ModelDeploymentServicePolicyChoice1Params', {"min_replicas": "int", "max_replicas": "int", "max_concurrent_requests": "int", "max_hourly_cost_micro_usd": "str", "stop_at": "NotRequired[str | datetime | None]"})

ModelDeploymentServicePolicyChoice2Params = TypedDict('ModelDeploymentServicePolicyChoice2Params', {"max_concurrent_requests": "int", "stop_at": "NotRequired[str | datetime | None]"})

CreateAgentIntegrationServiceParams = TypedDict('CreateAgentIntegrationServiceParams', {"connection_id": "str | UUID", "namespace": "str", "external_cost_acknowledged": "Literal[True]", "namespace_is_dedicated": "Literal[True]", "required": "NotRequired[bool]"})

DecisionQuestionParams = DecisionQuestionChoice1Params | DecisionQuestionChoice2Params | DecisionQuestionChoice3Params | DecisionQuestionChoice4Params

ConnectionAccessRuleInputParams = ConnectionAccessRuleInputChoice1Params | ConnectionAccessRuleInputChoice2Params | ConnectionAccessRuleInputChoice3Params

WorktreeSourceParams = WorktreeSourceChoice1Params | WorktreeSourceChoice2Params

InferenceBindingParams = DecisionBindingParams | ModelDeploymentBindingParams

ModelDeploymentSourceParams = ModelDeploymentHuggingFaceSourceParams | ModelDeploymentExternalSourceParams

ModelDeploymentRuntimeParams = ModelDeploymentRuntimeChoice1Params | ModelDeploymentRuntimeChoice2Params

ModelDeploymentHostingParams = ModelDeploymentHostingChoice1Params | ModelDeploymentHostingChoice2Params

ModelDeploymentServicePolicyParams = ModelDeploymentServicePolicyChoice1Params | ModelDeploymentServicePolicyChoice2Params
