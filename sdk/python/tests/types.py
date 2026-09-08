from typing import assert_type
from uuid import UUID
from macrofold import Macrofold
from macrofold.models import Project, RunAccepted, RunResult, Event
from collections.abc import Generator


def contract(client: Macrofold) -> None:
    project = client.projects.create(name='Research')
    assert_type(project, Project)
    assert_type(project.id, UUID)
    run = client.runs.create(project_id=project.id, harness='codex', model='fixture', prompt='Test', limits={'timeout_seconds': 30})
    assert_type(run, RunAccepted)
    assert_type(client.runs.create(project_id=project.id, agent_id=project.id, prompt='Test'), RunAccepted)
    assert_type(client.runs.stream_text(run.run_id), Generator[str, None, None])
    assert_type(client.runs.events(run.run_id), Generator[Event, None, None])
    assert_type(client.runs.wait(run.run_id), RunResult)
    client.runs.cancel(run.run_id)
    client.projects.create()  # pyright: ignore[reportCallIssue]
    client.projects.create(body={'name': 'Wrong'})  # pyright: ignore[reportCallIssue]
    client.runs.create(project_id=project.id, harness='unknown', prompt='Test')  # pyright: ignore[reportArgumentType]
    client.workspaces.write_file(run.workspace_id, path='a', content=b'file')  # pyright: ignore[reportCallIssue]
    client.runs.create(prompt='Test', limits={'max_cost_micro_usd': 100})  # pyright: ignore[reportArgumentType]
