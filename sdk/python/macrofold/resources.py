# Generated from OpenAPI by pnpm sdk:generate:all. Do not edit.
from __future__ import annotations
from collections.abc import Generator
from datetime import date, datetime
from typing import TYPE_CHECKING, Literal
from uuid import UUID
from . import models
from . import params
from .resource_options import OMIT, Omit, RequestOptions, payload, parameters, decode
from .run_helpers import stream_run_text, wait_for_run
if TYPE_CHECKING:
    from .client import Client
DEFAULT_ORIGIN = "https://app.macrofold.ai"

class ProjectsResource:
    def __init__(self, client: Client):
        self._client = client

    def cancel_deletion(self, project_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.Project:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("cancelProjectDeletion",
            path=parameters({"project_id": project_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Project, result, identity)

    def create(self, *, name: str, persistence: Literal["persistent", "ephemeral"] | Omit = OMIT, github: params.CreateProjectGithubParams | Omit = OMIT, request_options: RequestOptions | None = None) -> models.Project:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("createProject",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"name": name,"persistence": persistence,"github": github}),
        )
        return decode(models.Project, result, identity)

    def create_workspace(self, project_id: str | UUID, *, name: str, checkpoint_id: str | UUID | Omit = OMIT, branch: str | Omit = OMIT, source: params.WorkspaceSourceParams | Omit = OMIT, request_options: RequestOptions | None = None) -> models.Operation:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("createWorkspace",
            path=parameters({"project_id": project_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"name": name,"checkpoint_id": checkpoint_id,"branch": branch,"source": source}),
        )
        return decode(models.Operation, result, identity)

    def delete(self, project_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.Operation:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("deleteProject",
            path=parameters({"project_id": project_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Operation, result, identity)

    def get(self, project_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.Project:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getProject",
            path=parameters({"project_id": project_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Project, result, identity)

    def list(self, *, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, query: str | Omit = OMIT, archived: bool | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ListProjects200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listProjects",
            path=parameters({}),
            query=parameters({"cursor": cursor,"limit": limit,"query": query,"archived": archived}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListProjects200Response, result, identity)

    def list_workspaces(self, project_id: str | UUID, *, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ListWorkspaces200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listWorkspaces",
            path=parameters({"project_id": project_id}),
            query=parameters({"cursor": cursor,"limit": limit}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListWorkspaces200Response, result, identity)

    def schedule_deletion(self, project_id: str | UUID, *, confirmation: str, password: str | Omit = OMIT, request_options: RequestOptions | None = None) -> models.Project:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("scheduleProjectDeletion",
            path=parameters({"project_id": project_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"confirmation": confirmation,"password": password}),
        )
        return decode(models.Project, result, identity)

    def update(self, project_id: str | UUID, *, name: str | Omit = OMIT, github: params.UpdateProjectGithubParams | Omit = OMIT, archived: bool | Omit = OMIT, request_options: RequestOptions | None = None) -> models.Project:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("updateProject",
            path=parameters({"project_id": project_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"name": name,"github": github,"archived": archived}),
        )
        return decode(models.Project, result, identity)

class WorkspacesResource:
    def __init__(self, client: Client):
        self._client = client

    def create_checkpoint(self, workspace_id: str | UUID, *, pinned: bool | Omit = OMIT, request_options: RequestOptions | None = None) -> models.Operation:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("createCheckpoint",
            path=parameters({"workspace_id": workspace_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"pinned": pinned}),
        )
        return decode(models.Operation, result, identity)

    def create_transfer(self, workspace_id: str | UUID, *, direction: Literal["push", "pull"], base_revision: str, manifest: list[params.TransferManifestEntryParams], paths: list[str], include_ignored: bool | Omit = OMIT, delete: bool | Omit = OMIT, dry_run: bool | Omit = OMIT, request_options: RequestOptions | None = None) -> models.Transfer:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("createTransfer",
            path=parameters({"workspace_id": workspace_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"direction": direction,"base_revision": base_revision,"manifest": manifest,"paths": paths,"include_ignored": include_ignored,"delete": delete,"dry_run": dry_run}),
        )
        return decode(models.Transfer, result, identity)

    def delete_file(self, workspace_id: str | UUID, *, path: str, if_match: str, request_options: RequestOptions | None = None) -> models.Operation:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("deleteFile",
            path=parameters({"workspace_id": workspace_id}),
            query=parameters({"path": path}),
            headers={**options.headers, **parameters({"If-Match": if_match})},
            idempotency_key=identity,
            
        )
        return decode(models.Operation, result, identity)

    def delete(self, workspace_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.Operation:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("deleteWorkspace",
            path=parameters({"workspace_id": workspace_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Operation, result, identity)

    def get_sync(self, workspace_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.GitSync:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getSync",
            path=parameters({"workspace_id": workspace_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.GitSync, result, identity)

    def get(self, workspace_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.Workspace:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getWorkspace",
            path=parameters({"workspace_id": workspace_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Workspace, result, identity)

    def get_diff(self, workspace_id: str | UUID, *, base_checkpoint_id: str | UUID | Omit = OMIT, path: str | Omit = OMIT, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, request_options: RequestOptions | None = None) -> models.WorkspaceDiff:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getWorkspaceDiff",
            path=parameters({"workspace_id": workspace_id}),
            query=parameters({"base_checkpoint_id": base_checkpoint_id,"path": path,"cursor": cursor,"limit": limit}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.WorkspaceDiff, result, identity)

    def list_checkpoints(self, workspace_id: str | UUID, *, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ListCheckpoints200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listCheckpoints",
            path=parameters({"workspace_id": workspace_id}),
            query=parameters({"cursor": cursor,"limit": limit}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListCheckpoints200Response, result, identity)

    def list_files(self, workspace_id: str | UUID, *, path: str | Omit = OMIT, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, query: str | Omit = OMIT, request_options: RequestOptions | None = None) -> models.FileListing:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listFiles",
            path=parameters({"workspace_id": workspace_id}),
            query=parameters({"path": path,"cursor": cursor,"limit": limit,"query": query}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.FileListing, result, identity)

    def list_transfers(self, workspace_id: str | UUID, *, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ListTransfers200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listTransfers",
            path=parameters({"workspace_id": workspace_id}),
            query=parameters({"cursor": cursor,"limit": limit}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListTransfers200Response, result, identity)

    def read_file(self, workspace_id: str | UUID, *, path: str, download: bool | Omit = OMIT, request_options: RequestOptions | None = None) -> bytes:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("readFile",
            path=parameters({"workspace_id": workspace_id}),
            query=parameters({"path": path,"download": download}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return result

    def restore(self, workspace_id: str | UUID, *, checkpoint_id: str | UUID, request_options: RequestOptions | None = None) -> models.Operation:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("restoreWorkspace",
            path=parameters({"workspace_id": workspace_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"checkpoint_id": checkpoint_id}),
        )
        return decode(models.Operation, result, identity)

    def sync(self, workspace_id: str | UUID, *, mode: Literal["push", "pull", "pull_request"] | Omit = OMIT, request_options: RequestOptions | None = None) -> models.Operation:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("syncWorkspace",
            path=parameters({"workspace_id": workspace_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"mode": mode}),
        )
        return decode(models.Operation, result, identity)

    def update(self, workspace_id: str | UUID, *, name: str, request_options: RequestOptions | None = None) -> models.Workspace:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("updateWorkspace",
            path=parameters({"workspace_id": workspace_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"name": name}),
        )
        return decode(models.Workspace, result, identity)

    def write_file(self, workspace_id: str | UUID, *, path: str, if_match: str, content: bytes, request_options: RequestOptions | None = None) -> models.Operation:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("writeFile",
            path=parameters({"workspace_id": workspace_id}),
            query=parameters({"path": path}),
            headers={**options.headers, **parameters({"If-Match": if_match})},
            idempotency_key=identity,
            body=content,
        )
        return decode(models.Operation, result, identity)

class AgentsResource:
    def __init__(self, client: Client):
        self._client = client

    def create(self, *, name: str, harness: Literal["codex", "claude-code", "opencode"], model: str, instructions: str | Omit = OMIT, billing_mode: Literal["byok", "managed"], provider_connection_id: str | UUID | Omit = OMIT, connection_grants: list[params.GrantParams] | Omit = OMIT, limits: params.LimitsParams | Omit = OMIT, request_options: RequestOptions | None = None) -> models.Agent:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("createAgent",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"name": name,"harness": harness,"model": model,"instructions": instructions,"billing_mode": billing_mode,"provider_connection_id": provider_connection_id,"connection_grants": connection_grants,"limits": limits}),
        )
        return decode(models.Agent, result, identity)

    def delete(self, agent_id: str | UUID, *, request_options: RequestOptions | None = None) -> None:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("deleteAgent",
            path=parameters({"agent_id": agent_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return None

    def get(self, agent_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.Agent:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getAgent",
            path=parameters({"agent_id": agent_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Agent, result, identity)

    def list(self, *, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ListAgents200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listAgents",
            path=parameters({}),
            query=parameters({"cursor": cursor,"limit": limit}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListAgents200Response, result, identity)

    def update(self, agent_id: str | UUID, *, name: str | Omit = OMIT, harness: Literal["codex", "claude-code", "opencode"] | Omit = OMIT, model: str | Omit = OMIT, instructions: str | Omit = OMIT, billing_mode: Literal["byok", "managed"] | Omit = OMIT, provider_connection_id: str | UUID | Omit = OMIT, connection_grants: list[params.GrantParams] | Omit = OMIT, limits: params.LimitsParams | Omit = OMIT, request_options: RequestOptions | None = None) -> models.Agent:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("updateAgent",
            path=parameters({"agent_id": agent_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"name": name,"harness": harness,"model": model,"instructions": instructions,"billing_mode": billing_mode,"provider_connection_id": provider_connection_id,"connection_grants": connection_grants,"limits": limits}),
        )
        return decode(models.Agent, result, identity)

class SessionsResource:
    def __init__(self, client: Client):
        self._client = client

    def continue_run(self, session_id: str | UUID, *, prompt: str, limits: params.LimitsParams | Omit = OMIT, webhook_endpoint_ids: list[str | UUID] | Omit = OMIT, queue_if_busy: bool | Omit = OMIT, model: str | Omit = OMIT, queue_timeout_seconds: int | Omit = OMIT, scheduling_class: Literal["background", "interactive"] | Omit = OMIT, request_options: RequestOptions | None = None) -> models.RunAccepted:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("continueSession",
            path=parameters({"session_id": session_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"prompt": prompt,"limits": limits,"webhook_endpoint_ids": webhook_endpoint_ids,"queue_if_busy": queue_if_busy,"model": model,"queue_timeout_seconds": queue_timeout_seconds,"scheduling_class": scheduling_class}),
        )
        return decode(models.RunAccepted, result, identity)

    def create(self, *, workspace_id: str | UUID, harness: Literal["codex", "claude-code", "opencode"], model: str, billing_mode: Literal["byok", "managed"], provider_connection_id: str | UUID | Omit = OMIT, connection_grants: list[params.GrantParams] | Omit = OMIT, limits: params.LimitsParams | Omit = OMIT, request_options: RequestOptions | None = None) -> models.Session:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("createSession",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"workspace_id": workspace_id,"harness": harness,"model": model,"billing_mode": billing_mode,"provider_connection_id": provider_connection_id,"connection_grants": connection_grants,"limits": limits}),
        )
        return decode(models.Session, result, identity)

    def get(self, session_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.Session:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getSession",
            path=parameters({"session_id": session_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Session, result, identity)

    def list(self, *, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, workspace_id: str | UUID | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ListSessions200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listSessions",
            path=parameters({}),
            query=parameters({"cursor": cursor,"limit": limit,"workspace_id": workspace_id}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListSessions200Response, result, identity)

class RunsResource:
    def __init__(self, client: Client):
        self._client = client

    def cancel(self, run_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.Run:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("cancelRun",
            path=parameters({"run_id": run_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({}),
        )
        return decode(models.Run, result, identity)

    def create(self, *, prompt: str, project_id: str | UUID | Omit = OMIT, workspace_id: str | UUID | Omit = OMIT, session_id: str | UUID | Omit = OMIT, agent_id: str | UUID | Omit = OMIT, harness: Literal["codex", "claude-code", "opencode"] | Omit = OMIT, model: str | Omit = OMIT, billing_mode: Literal["byok", "managed"] | Omit = OMIT, provider_connection_id: str | UUID | Omit = OMIT, connection_grants: list[params.GrantParams] | Omit = OMIT, limits: params.LimitsParams | Omit = OMIT, webhook_endpoint_ids: list[str | UUID] | Omit = OMIT, queue_timeout_seconds: int | Omit = OMIT, scheduling_class: Literal["background", "interactive"] | Omit = OMIT, queue_if_busy: bool | Omit = OMIT, request_options: RequestOptions | None = None) -> models.RunAccepted:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("createRun",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"prompt": prompt,"project_id": project_id,"workspace_id": workspace_id,"session_id": session_id,"agent_id": agent_id,"harness": harness,"model": model,"billing_mode": billing_mode,"provider_connection_id": provider_connection_id,"connection_grants": connection_grants,"limits": limits,"webhook_endpoint_ids": webhook_endpoint_ids,"queue_timeout_seconds": queue_timeout_seconds,"scheduling_class": scheduling_class,"queue_if_busy": queue_if_busy}),
        )
        return decode(models.RunAccepted, result, identity)

    def get(self, run_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.Run:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getRun",
            path=parameters({"run_id": run_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Run, result, identity)

    def get_result(self, run_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.RunResult:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getRunResult",
            path=parameters({"run_id": run_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.RunResult, result, identity)

    def list_artifacts(self, run_id: str | UUID, *, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ListArtifacts200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listArtifacts",
            path=parameters({"run_id": run_id}),
            query=parameters({"cursor": cursor,"limit": limit}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListArtifacts200Response, result, identity)

    def list_events(self, run_id: str | UUID, *, after: str | Omit = OMIT, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ListRunEvents200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listRunEvents",
            path=parameters({"run_id": run_id}),
            query=parameters({"after": after,"cursor": cursor,"limit": limit}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListRunEvents200Response, result, identity)

    def list(self, *, status: str | Omit = OMIT, project_id: str | UUID | Omit = OMIT, from_: str | datetime | Omit = OMIT, to: str | datetime | Omit = OMIT, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, workspace_id: str | UUID | Omit = OMIT, session_id: str | UUID | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ListRuns200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listRuns",
            path=parameters({}),
            query=parameters({"status": status,"project_id": project_id,"from": from_,"to": to,"cursor": cursor,"limit": limit,"workspace_id": workspace_id,"session_id": session_id}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListRuns200Response, result, identity)

    def stream(self, run_id: str | UUID, *, after: str = '0') -> Generator[models.Event, None, None]:
        stream = self._client.stream(str(run_id), after=after)
        try:
            for event in stream:
                yield models.Event.model_validate(event)
        finally:
            stream.close()

    def events(self, run_id: str | UUID, *, after: str = '0') -> Generator[models.Event, None, None]:
        return self.stream(run_id, after=after)

    def stream_text(self, run_id: str | UUID, *, after: str = '0') -> Generator[str, None, None]:
        return stream_run_text(self.events(run_id, after=after), lambda: self.wait(run_id))

    def wait(self, run_id: str | UUID, *, timeout: float | None = None, poll_interval: float = 1) -> models.RunResult:
        return wait_for_run(self._client, str(run_id), timeout=timeout, poll_interval=poll_interval)

    def submit_input(self, run_id: str | UUID, *, input_request_id: str | UUID, answer: dict[str, object], request_options: RequestOptions | None = None) -> models.Run:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("submitRunInput",
            path=parameters({"run_id": run_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"input_request_id": input_request_id,"answer": answer}),
        )
        return decode(models.Run, result, identity)

class ArtifactsResource:
    def __init__(self, client: Client):
        self._client = client

    def download(self, artifact_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.Download:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("downloadArtifact",
            path=parameters({"artifact_id": artifact_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Download, result, identity)

class ConnectionsResource:
    def __init__(self, client: Client):
        self._client = client

    def authorize(self, connection_id: str | UUID, *, return_to: str | Omit = OMIT, request_options: RequestOptions | None = None) -> models.AuthorizationLink:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("authorizeConnection",
            path=parameters({"connection_id": connection_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"return_to": return_to}),
        )
        return decode(models.AuthorizationLink, result, identity)

    def create(self, *, name: str, kind: Literal["model", "mcp_remote", "mcp_stdio", "composio", "search"], provider: str | Omit = OMIT, url: str | Omit = OMIT, auth_method: Literal["oauth", "bearer", "headers", "api_key", "none"], secret: str | Omit = OMIT, secret_headers: dict[str, str] | Omit = OMIT, package: str | Omit = OMIT, package_version: str | Omit = OMIT, args: list[str] | Omit = OMIT, subject_id: str | Omit = OMIT, secret_env: dict[str, str] | Omit = OMIT, request_options: RequestOptions | None = None) -> models.Connection:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("createConnection",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"name": name,"kind": kind,"provider": provider,"url": url,"auth_method": auth_method,"secret": secret,"secret_headers": secret_headers,"package": package,"package_version": package_version,"args": args,"subject_id": subject_id,"secret_env": secret_env}),
        )
        return decode(models.Connection, result, identity)

    def delete(self, connection_id: str | UUID, *, request_options: RequestOptions | None = None) -> None:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("deleteConnection",
            path=parameters({"connection_id": connection_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return None

    def get(self, connection_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.Connection:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getConnection",
            path=parameters({"connection_id": connection_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Connection, result, identity)

    def get_grants(self, connection_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.ConnectionGrantSet:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getConnectionGrants",
            path=parameters({"connection_id": connection_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ConnectionGrantSet, result, identity)

    def list(self, *, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ListConnections200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listConnections",
            path=parameters({}),
            query=parameters({"cursor": cursor,"limit": limit}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListConnections200Response, result, identity)

    def list_tools(self, connection_id: str | UUID, *, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ListConnectionTools200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listConnectionTools",
            path=parameters({"connection_id": connection_id}),
            query=parameters({"cursor": cursor,"limit": limit}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListConnectionTools200Response, result, identity)

    def list_connector_catalog(self, *, request_options: RequestOptions | None = None) -> models.ConnectorCatalog:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listConnectorCatalog",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ConnectorCatalog, result, identity)

    def list_stdio_packages(self, *, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, request_options: RequestOptions | None = None) -> models.StdioPackagePage:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listStdioPackages",
            path=parameters({}),
            query=parameters({"cursor": cursor,"limit": limit}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.StdioPackagePage, result, identity)

    def set_grants(self, connection_id: str | UUID, *, version: int, subject_type: Literal["organization", "user", "external_subject"], subject_id: str | Omit = OMIT, tools: list[str], request_options: RequestOptions | None = None) -> models.ConnectionGrantSet:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("setConnectionGrants",
            path=parameters({"connection_id": connection_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"version": version,"subject_type": subject_type,"subject_id": subject_id,"tools": tools}),
        )
        return decode(models.ConnectionGrantSet, result, identity)

    def test(self, connection_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.ConnectionTest:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("testConnection",
            path=parameters({"connection_id": connection_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({}),
        )
        return decode(models.ConnectionTest, result, identity)

    def update(self, connection_id: str | UUID, *, name: str | Omit = OMIT, kind: Literal["model", "mcp_remote", "mcp_stdio", "composio", "search"] | Omit = OMIT, provider: str | Omit = OMIT, url: str | Omit = OMIT, auth_method: Literal["oauth", "bearer", "headers", "api_key", "none"] | Omit = OMIT, secret: str | Omit = OMIT, secret_headers: dict[str, str] | Omit = OMIT, package: str | Omit = OMIT, package_version: str | Omit = OMIT, args: list[str] | Omit = OMIT, subject_id: str | Omit = OMIT, secret_env: dict[str, str] | Omit = OMIT, request_options: RequestOptions | None = None) -> models.Connection:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("updateConnection",
            path=parameters({"connection_id": connection_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"name": name,"kind": kind,"provider": provider,"url": url,"auth_method": auth_method,"secret": secret,"secret_headers": secret_headers,"package": package,"package_version": package_version,"args": args,"subject_id": subject_id,"secret_env": secret_env}),
        )
        return decode(models.Connection, result, identity)

class ApiKeysResource:
    def __init__(self, client: Client):
        self._client = client

    def create(self, *, name: str, scopes: list[str], project_id: str | UUID | Omit = OMIT, expires_at: str | datetime | Omit = OMIT, request_options: RequestOptions | None = None) -> models.NewApiKey:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("createApiKey",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"name": name,"scopes": scopes,"project_id": project_id,"expires_at": expires_at}),
        )
        return decode(models.NewApiKey, result, identity)

    def list(self, *, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ListApiKeys200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listApiKeys",
            path=parameters({}),
            query=parameters({"cursor": cursor,"limit": limit}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListApiKeys200Response, result, identity)

    def revoke(self, key_id: str | UUID, *, request_options: RequestOptions | None = None) -> None:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("revokeApiKey",
            path=parameters({"key_id": key_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return None

class WebhookEndpointsResource:
    def __init__(self, client: Client):
        self._client = client

    def create(self, *, url: str, events: list[Literal["run.completed", "run.failed", "run.cancelled", "git_sync.updated", "connection.expired"]], request_options: RequestOptions | None = None) -> models.NewWebhook:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("createWebhookEndpoint",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"url": url,"events": events}),
        )
        return decode(models.NewWebhook, result, identity)

    def delete(self, endpoint_id: str | UUID, *, request_options: RequestOptions | None = None) -> None:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("deleteWebhookEndpoint",
            path=parameters({"endpoint_id": endpoint_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return None

    def list(self, *, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ListWebhookEndpoints200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listWebhookEndpoints",
            path=parameters({}),
            query=parameters({"cursor": cursor,"limit": limit}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListWebhookEndpoints200Response, result, identity)

    def rotate_webhook_secret(self, endpoint_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.NewWebhook:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("rotateWebhookSecret",
            path=parameters({"endpoint_id": endpoint_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({}),
        )
        return decode(models.NewWebhook, result, identity)

    def update(self, endpoint_id: str | UUID, *, url: str | Omit = OMIT, events: list[Literal["run.completed", "run.failed", "run.cancelled", "git_sync.updated", "connection.expired"]] | Omit = OMIT, enabled: bool | Omit = OMIT, request_options: RequestOptions | None = None) -> models.Webhook:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("updateWebhookEndpoint",
            path=parameters({"endpoint_id": endpoint_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"url": url,"events": events,"enabled": enabled}),
        )
        return decode(models.Webhook, result, identity)

class WebhookDeliveriesResource:
    def __init__(self, client: Client):
        self._client = client

    def list(self, *, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ListWebhookDeliveries200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listWebhookDeliveries",
            path=parameters({}),
            query=parameters({"cursor": cursor,"limit": limit}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListWebhookDeliveries200Response, result, identity)

    def replay(self, delivery_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.Operation:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("replayWebhookDelivery",
            path=parameters({"delivery_id": delivery_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({}),
        )
        return decode(models.Operation, result, identity)

class UsageResource:
    def __init__(self, client: Client):
        self._client = client

    def get(self, *, from_: str | datetime | Omit = OMIT, to: str | datetime | Omit = OMIT, group_by: Literal["day", "hour", "organization", "model", "provider", "harness", "billing_mode"] | Omit = OMIT, request_options: RequestOptions | None = None) -> models.Report:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getUsage",
            path=parameters({}),
            query=parameters({"from": from_,"to": to,"group_by": group_by}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Report, result, identity)

class RequestsResource:
    def __init__(self, client: Client):
        self._client = client

    def list(self, *, from_: str | datetime | Omit = OMIT, to: str | datetime | Omit = OMIT, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ListRequests200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listRequests",
            path=parameters({}),
            query=parameters({"from": from_,"to": to,"cursor": cursor,"limit": limit}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListRequests200Response, result, identity)

class BillingResource:
    def __init__(self, client: Client):
        self._client = client

    def create_portal(self, *, request_options: RequestOptions | None = None) -> models.Redirect:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("createBillingPortal",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({}),
        )
        return decode(models.Redirect, result, identity)

    def create_checkout(self, *, kind: Literal["topup", "subscription"], amount_micro_usd: str | Omit = OMIT, plan: Literal["pro", "scale"] | Omit = OMIT, request_options: RequestOptions | None = None) -> models.Redirect:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("createCheckout",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"kind": kind,"amount_micro_usd": amount_micro_usd,"plan": plan}),
        )
        return decode(models.Redirect, result, identity)

    def get(self, *, request_options: RequestOptions | None = None) -> models.Billing:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getBilling",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Billing, result, identity)

    def get_storage(self, *, request_options: RequestOptions | None = None) -> models.Storage:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getStorage",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Storage, result, identity)

    def update_storage_policy(self, *, overage_enabled: bool, monthly_budget_micro_usd: str, request_options: RequestOptions | None = None) -> models.Storage:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("updateStoragePolicy",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"overage_enabled": overage_enabled,"monthly_budget_micro_usd": monthly_budget_micro_usd}),
        )
        return decode(models.Storage, result, identity)

class HarnessesResource:
    def __init__(self, client: Client):
        self._client = client

    def list(self, *, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ListHarnesses200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listHarnesses",
            path=parameters({}),
            query=parameters({"cursor": cursor,"limit": limit}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListHarnesses200Response, result, identity)

class ModelsResource:
    def __init__(self, client: Client):
        self._client = client

    def list(self, *, harness: str | Omit = OMIT, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ListModels200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listModels",
            path=parameters({}),
            query=parameters({"harness": harness,"cursor": cursor,"limit": limit}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListModels200Response, result, identity)

class OperationsResource:
    def __init__(self, client: Client):
        self._client = client

    def get(self, operation_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.Operation:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getOperation",
            path=parameters({"operation_id": operation_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Operation, result, identity)

class OperatorResource:
    def __init__(self, client: Client):
        self._client = client

    def get_account_summary(self, account_id: str | UUID, *, from_: str | datetime | Omit = OMIT, to: str | datetime | Omit = OMIT, include_contact: bool | Omit = OMIT, request_options: RequestOptions | None = None) -> models.AccountSummary:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getAccountSummary",
            path=parameters({"account_id": account_id}),
            query=parameters({"from": from_,"to": to,"include_contact": include_contact}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.AccountSummary, result, identity)

    def get_capacity_report(self, *, from_: str | datetime | Omit = OMIT, to: str | datetime | Omit = OMIT, request_options: RequestOptions | None = None) -> models.Report:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getCapacityReport",
            path=parameters({}),
            query=parameters({"from": from_,"to": to}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Report, result, identity)

    def get_growth_metrics(self, *, from_: str | datetime | Omit = OMIT, to: str | datetime | Omit = OMIT, group_by: Literal["day", "hour", "organization", "model", "provider", "harness", "billing_mode"] | Omit = OMIT, organization_id: str | UUID | Omit = OMIT, request_options: RequestOptions | None = None) -> models.Report:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getGrowthMetrics",
            path=parameters({}),
            query=parameters({"from": from_,"to": to,"group_by": group_by,"organization_id": organization_id}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Report, result, identity)

    def get_infrastructure_health(self, *, from_: str | datetime | Omit = OMIT, to: str | datetime | Omit = OMIT, service_id: str | Omit = OMIT, request_options: RequestOptions | None = None) -> models.Report:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getInfrastructureHealth",
            path=parameters({}),
            query=parameters({"from": from_,"to": to,"service_id": service_id}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Report, result, identity)

    def get_operating_report(self, *, from_: str | datetime | Omit = OMIT, to: str | datetime | Omit = OMIT, request_options: RequestOptions | None = None) -> models.Report:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getOperatingReport",
            path=parameters({}),
            query=parameters({"from": from_,"to": to}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Report, result, identity)

    def get_platform_usage_metrics(self, *, from_: str | datetime | Omit = OMIT, to: str | datetime | Omit = OMIT, group_by: Literal["day", "hour", "organization", "model", "provider", "harness", "billing_mode"] | Omit = OMIT, organization_id: str | UUID | Omit = OMIT, request_options: RequestOptions | None = None) -> models.Report:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getPlatformUsageMetrics",
            path=parameters({}),
            query=parameters({"from": from_,"to": to,"group_by": group_by,"organization_id": organization_id}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Report, result, identity)

    def get_run_diagnostics(self, run_id: str | UUID, *, from_: str | datetime | Omit = OMIT, to: str | datetime | Omit = OMIT, request_options: RequestOptions | None = None) -> models.Diagnostics:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getRunDiagnostics",
            path=parameters({"run_id": run_id}),
            query=parameters({"from": from_,"to": to}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Diagnostics, result, identity)

    def list_accounts(self, *, from_: str | datetime | Omit = OMIT, to: str | datetime | Omit = OMIT, query: str | Omit = OMIT, include_contact: bool | Omit = OMIT, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ListAccounts200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listAccounts",
            path=parameters({}),
            query=parameters({"from": from_,"to": to,"query": query,"include_contact": include_contact,"cursor": cursor,"limit": limit}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListAccounts200Response, result, identity)

    def list_platform_requests(self, *, from_: str | datetime | Omit = OMIT, to: str | datetime | Omit = OMIT, organization_id: str | UUID | Omit = OMIT, status_code: int | Omit = OMIT, route: str | Omit = OMIT, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ListRequests200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listPlatformRequests",
            path=parameters({}),
            query=parameters({"from": from_,"to": to,"organization_id": organization_id,"status_code": status_code,"route": route,"cursor": cursor,"limit": limit}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListRequests200Response, result, identity)

    def list_report_snapshots(self, *, from_: str | datetime | Omit = OMIT, to: str | datetime | Omit = OMIT, cursor: str | date | Omit = OMIT, limit: int | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ReportSnapshotPage:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listReportSnapshots",
            path=parameters({}),
            query=parameters({"from": from_,"to": to,"cursor": cursor,"limit": limit}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ReportSnapshotPage, result, identity)

class CheckpointsResource:
    def __init__(self, client: Client):
        self._client = client

    def export_archive(self, checkpoint_id: str | UUID, *, format: Literal["git_bundle", "portable_archive"], request_options: RequestOptions | None = None) -> models.ExportOperation:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("exportCheckpoint",
            path=parameters({"checkpoint_id": checkpoint_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"format": format}),
        )
        return decode(models.ExportOperation, result, identity)

    def update_retention(self, checkpoint_id: str | UUID, *, pinned: bool, request_options: RequestOptions | None = None) -> models.Checkpoint:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("updateCheckpointRetention",
            path=parameters({"checkpoint_id": checkpoint_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"pinned": pinned}),
        )
        return decode(models.Checkpoint, result, identity)

class MeResource:
    def __init__(self, client: Client):
        self._client = client

    def get(self, *, request_options: RequestOptions | None = None) -> models.Identity:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getIdentity",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Identity, result, identity)

class TransfersResource:
    def __init__(self, client: Client):
        self._client = client

    def apply(self, transfer_id: str | UUID, *, expected_revision: str, completed_paths: list[str] | Omit = OMIT, request_options: RequestOptions | None = None) -> models.Operation:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("applyTransfer",
            path=parameters({"transfer_id": transfer_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"expected_revision": expected_revision,"completed_paths": completed_paths}),
        )
        return decode(models.Operation, result, identity)

    def get(self, transfer_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.Transfer:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getTransfer",
            path=parameters({"transfer_id": transfer_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Transfer, result, identity)

class IntegrationsResource:
    def __init__(self, client: Client):
        self._client = client

    def disconnect_github(self, project_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.Project:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("disconnectGithub",
            path=parameters({"project_id": project_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Project, result, identity)

    def list_github_installations(self, *, request_options: RequestOptions | None = None) -> models.GithubInstallations:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listGithubInstallations",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.GithubInstallations, result, identity)

    def list_github_repositories(self, *, installation_id: str, request_options: RequestOptions | None = None) -> models.GithubRepositories:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listGithubRepositories",
            path=parameters({}),
            query=parameters({"installation_id": installation_id}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.GithubRepositories, result, identity)

class OrganizationsResource:
    def __init__(self, client: Client):
        self._client = client

    def create_invitation(self, *, email: str, role: Literal["admin", "member", "viewer"], request_options: RequestOptions | None = None) -> models.Invitation:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("createInvitation",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"email": email,"role": role}),
        )
        return decode(models.Invitation, result, identity)

    def create(self, *, name: str, request_options: RequestOptions | None = None) -> models.Organization:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("createOrganization",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"name": name}),
        )
        return decode(models.Organization, result, identity)

    def get_execution_policy(self, *, request_options: RequestOptions | None = None) -> models.ExecutionPolicy:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getExecutionPolicy",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ExecutionPolicy, result, identity)

    def list_invitations(self, *, request_options: RequestOptions | None = None) -> models.ListInvitations200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listInvitations",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListInvitations200Response, result, identity)

    def list_members(self, *, request_options: RequestOptions | None = None) -> models.ListMembers200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listMembers",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListMembers200Response, result, identity)

    def list_audit(self, *, request_options: RequestOptions | None = None) -> models.ListOrganizationAudit200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listOrganizationAudit",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListOrganizationAudit200Response, result, identity)

    def remove_member(self, user_id: str | UUID, *, request_options: RequestOptions | None = None) -> None:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("removeMember",
            path=parameters({"user_id": user_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return None

    def revoke_invitation(self, invitation_id: str | UUID, *, request_options: RequestOptions | None = None) -> None:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("revokeInvitation",
            path=parameters({"invitation_id": invitation_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return None

    def update_execution_policy(self, *, concurrency_limit: int | None | Omit = OMIT, max_timeout_seconds: int | None | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ExecutionPolicy:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("updateExecutionPolicy",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"concurrency_limit": concurrency_limit,"max_timeout_seconds": max_timeout_seconds}),
        )
        return decode(models.ExecutionPolicy, result, identity)

    def update_member(self, user_id: str | UUID, *, role: Literal["owner", "admin", "member", "viewer"], request_options: RequestOptions | None = None) -> None:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("updateMember",
            path=parameters({"user_id": user_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"role": role}),
        )
        return None

    def update(self, *, name: str, request_options: RequestOptions | None = None) -> models.Organization:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("updateOrganization",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"name": name}),
        )
        return decode(models.Organization, result, identity)

class TriggersResource:
    def __init__(self, client: Client):
        self._client = client

    def create(self, *, name: str, project_id: str | UUID, agent_id: str | UUID, kind: Literal["slack", "webhook", "schedule"], prompt: str, enabled: bool | Omit = OMIT, max_runs_per_day: int | Omit = OMIT, cron: str | Omit = OMIT, timezone: str | Omit = OMIT, slack_connection_id: str | UUID | Omit = OMIT, channel_id: str | Omit = OMIT, request_options: RequestOptions | None = None) -> models.NewTrigger:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("createTrigger",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"name": name,"project_id": project_id,"agent_id": agent_id,"kind": kind,"prompt": prompt,"enabled": enabled,"max_runs_per_day": max_runs_per_day,"cron": cron,"timezone": timezone,"slack_connection_id": slack_connection_id,"channel_id": channel_id}),
        )
        return decode(models.NewTrigger, result, identity)

    def delete(self, trigger_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.DeleteTrigger200Response:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("deleteTrigger",
            path=parameters({"trigger_id": trigger_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.DeleteTrigger200Response, result, identity)

    def get(self, trigger_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.Trigger:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("getTrigger",
            path=parameters({"trigger_id": trigger_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.Trigger, result, identity)

    def list_deliveries(self, trigger_id: str | UUID, *, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ListTriggerDeliveries200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listTriggerDeliveries",
            path=parameters({"trigger_id": trigger_id}),
            query=parameters({"cursor": cursor,"limit": limit}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListTriggerDeliveries200Response, result, identity)

    def list(self, *, cursor: str | Omit = OMIT, limit: int | Omit = OMIT, kind: Literal["slack", "webhook", "schedule"] | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ListTriggers200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listTriggers",
            path=parameters({}),
            query=parameters({"cursor": cursor,"limit": limit,"kind": kind}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListTriggers200Response, result, identity)

    def retry_reply(self, trigger_id: str | UUID, delivery_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.TriggerDelivery:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("retryTriggerReply",
            path=parameters({"trigger_id": trigger_id,"delivery_id": delivery_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({}),
        )
        return decode(models.TriggerDelivery, result, identity)

    def rotate_secret(self, trigger_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.TriggerSecret:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("rotateTriggerSecret",
            path=parameters({"trigger_id": trigger_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({}),
        )
        return decode(models.TriggerSecret, result, identity)

    def run(self, trigger_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.TriggerDelivery:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("runTrigger",
            path=parameters({"trigger_id": trigger_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({}),
        )
        return decode(models.TriggerDelivery, result, identity)

    def update(self, trigger_id: str | UUID, *, name: str | Omit = OMIT, project_id: str | UUID | Omit = OMIT, agent_id: str | UUID | Omit = OMIT, prompt: str | Omit = OMIT, enabled: bool | Omit = OMIT, max_runs_per_day: int | Omit = OMIT, cron: str | Omit = OMIT, timezone: str | Omit = OMIT, slack_connection_id: str | UUID | Omit = OMIT, channel_id: str | Omit = OMIT, request_options: RequestOptions | None = None) -> models.Trigger:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("updateTrigger",
            path=parameters({"trigger_id": trigger_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"name": name,"project_id": project_id,"agent_id": agent_id,"prompt": prompt,"enabled": enabled,"max_runs_per_day": max_runs_per_day,"cron": cron,"timezone": timezone,"slack_connection_id": slack_connection_id,"channel_id": channel_id}),
        )
        return decode(models.Trigger, result, identity)

class SlackConnectionsResource:
    def __init__(self, client: Client):
        self._client = client

    def create(self, *, name: str, bot_token: str, signing_secret: str, request_options: RequestOptions | None = None) -> models.SlackConnection:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("createSlackConnection",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            body=payload({"name": name,"bot_token": bot_token,"signing_secret": signing_secret}),
        )
        return decode(models.SlackConnection, result, identity)

    def delete(self, connection_id: str | UUID, *, request_options: RequestOptions | None = None) -> models.DeleteTrigger200Response:
        options = request_options or RequestOptions()
        identity = options.identity(True)
        result = self._client.request("deleteSlackConnection",
            path=parameters({"connection_id": connection_id}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.DeleteTrigger200Response, result, identity)

    def list_channels(self, connection_id: str | UUID, *, cursor: str | Omit = OMIT, request_options: RequestOptions | None = None) -> models.ListSlackConnectionChannels200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listSlackConnectionChannels",
            path=parameters({"connection_id": connection_id}),
            query=parameters({"cursor": cursor}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListSlackConnectionChannels200Response, result, identity)

    def list(self, *, request_options: RequestOptions | None = None) -> models.ListSlackConnections200Response:
        options = request_options or RequestOptions()
        identity = options.identity(False)
        result = self._client.request("listSlackConnections",
            path=parameters({}),
            query=parameters({}),
            headers={**options.headers, **parameters({})},
            idempotency_key=identity,
            
        )
        return decode(models.ListSlackConnections200Response, result, identity)

class Resources:
    def _init_resources(self, client: Client) -> None:
        self.projects = ProjectsResource(client)
        self.workspaces = WorkspacesResource(client)
        self.agents = AgentsResource(client)
        self.sessions = SessionsResource(client)
        self.runs = RunsResource(client)
        self.artifacts = ArtifactsResource(client)
        self.connections = ConnectionsResource(client)
        self.api_keys = ApiKeysResource(client)
        self.webhook_endpoints = WebhookEndpointsResource(client)
        self.webhook_deliveries = WebhookDeliveriesResource(client)
        self.usage = UsageResource(client)
        self.requests = RequestsResource(client)
        self.billing = BillingResource(client)
        self.harnesses = HarnessesResource(client)
        self.models = ModelsResource(client)
        self.operations = OperationsResource(client)
        self.operator = OperatorResource(client)
        self.checkpoints = CheckpointsResource(client)
        self.me = MeResource(client)
        self.transfers = TransfersResource(client)
        self.integrations = IntegrationsResource(client)
        self.organizations = OrganizationsResource(client)
        self.triggers = TriggersResource(client)
        self.slack_connections = SlackConnectionsResource(client)
