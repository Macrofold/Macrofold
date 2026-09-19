from typing import assert_type
from uuid import UUID
from macrofold import Macrofold
from macrofold.models import Workspace, NativeRunAccepted, RunResult, Event
from collections.abc import Generator


def contract(client: Macrofold) -> None:
    workspace = client.workspaces.create(name='Research')
    assert_type(workspace, Workspace)
    assert_type(workspace.id, UUID)
    run = client.runs.create(workspace_id=workspace.id, harness='codex', model='fixture', prompt='Test', limits={'timeout_seconds': 30})
    assert_type(run, NativeRunAccepted)
    assert_type(client.runs.create(workspace_id=workspace.id, agent_id=workspace.id, prompt='Test'), NativeRunAccepted)
    assert_type(client.runs.stream_text(run.run_id), Generator[str, None, None])
    assert_type(client.runs.events(run.run_id), Generator[Event, None, None])
    assert_type(client.runs.wait(run.run_id), RunResult)
    client.runs.cancel(run.run_id)
    client.workspaces.create()  # pyright: ignore[reportCallIssue]
    client.workspaces.create(body={'name': 'Wrong'})  # pyright: ignore[reportCallIssue]
    client.runs.create(workspace_id=workspace.id, harness='unknown', prompt='Test')  # pyright: ignore[reportArgumentType]
    client.worktrees.write_file(run.worktree_id, path='a', content=b'file')  # pyright: ignore[reportCallIssue]
    client.runs.create(prompt='Test', limits={'max_cost_micro_usd': 100})  # pyright: ignore[reportArgumentType]
