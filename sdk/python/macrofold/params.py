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

LimitsParams = TypedDict('LimitsParams', {"timeout_seconds": "NotRequired[int]", "max_cost_micro_usd": "NotRequired[str]"})

AgentPermissionsParams = TypedDict('AgentPermissionsParams', {"version": "Literal[1]", "files": "NotRequired[AgentPermissionsFilesParams]", "shell": "NotRequired[Literal[\"allow\", \"deny\"]]", "tools": "NotRequired[PermissionPatternsParams]"})

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

InferenceCreateParams = TypedDict('InferenceCreateParams', {"workspace_id": "NotRequired[str | UUID]", "definition": "NotRequired[InferenceDefinitionParams | DefinitionReferenceParams]", "input": "object", "context": "NotRequired[ExplicitContextParams | ContextReferenceParams]", "model_binding": "DecisionBindingParams", "limits": "NotRequired[InferenceLimitsParams]", "queue_timeout_seconds": "NotRequired[int]", "model_parameters": "NotRequired[ModelParametersParams]", "stream": "NotRequired[bool]"})

DecisionQuestionParams = DecisionQuestionChoice1Params | DecisionQuestionChoice2Params | DecisionQuestionChoice3Params | DecisionQuestionChoice4Params

ConnectionAccessRuleInputParams = ConnectionAccessRuleInputChoice1Params | ConnectionAccessRuleInputChoice2Params | ConnectionAccessRuleInputChoice3Params

WorktreeSourceParams = WorktreeSourceChoice1Params | WorktreeSourceChoice2Params
