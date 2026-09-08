# Generated keyword-input types from OpenAPI. Do not edit.
from __future__ import annotations
from datetime import date, datetime
from typing import Literal, NotRequired, TypedDict
from uuid import UUID
CreateProjectGithubParams = TypedDict('CreateProjectGithubParams', {"installation_id": "str", "repository_id": "str", "target_branch": "str", "auto_sync": "NotRequired[bool]", "sync_mode": "NotRequired[Literal[\"push\", \"pull_request\"]]", "auto_pull": "NotRequired[bool]"})

WorkspaceSourceChoice1Params = TypedDict('WorkspaceSourceChoice1Params', {"kind": "Literal[\"git_ref\"]", "ref": "str"})

WorkspaceSourceChoice2Params = TypedDict('WorkspaceSourceChoice2Params', {"kind": "Literal[\"checkpoint\"]", "checkpoint_id": "str | UUID"})

UpdateProjectGithubParams = TypedDict('UpdateProjectGithubParams', {"installation_id": "str", "repository_id": "str", "target_branch": "str", "auto_sync": "NotRequired[bool]", "sync_mode": "NotRequired[Literal[\"push\", \"pull_request\"]]", "auto_pull": "NotRequired[bool]"})

TransferManifestEntryParams = TypedDict('TransferManifestEntryParams', {"path": "str", "local_sha256": "str | None", "local_size_bytes": "int", "baseline_known": "bool", "baseline_sha256": "str | None"})

GrantParams = TypedDict('GrantParams', {"connection_id": "str | UUID", "tools": "list[str]"})

LimitsParams = TypedDict('LimitsParams', {"timeout_seconds": "NotRequired[int]", "max_cost_micro_usd": "NotRequired[str]"})

WorkspaceSourceParams = WorkspaceSourceChoice1Params | WorkspaceSourceChoice2Params
