import inspect
import json
import os
from datetime import datetime, timezone
from typing import get_type_hints
from uuid import UUID

import httpx
import pytest
from macrofold import ApiError, Client, DEFAULT_ORIGIN, RequestOptions, TransportError
from macrofold import models, params

ID = '00000000-0000-4000-8000-000000000001'
PROJECT = dict(id=ID, organization_id=ID, name='Research', persistence='persistent', created_at='2026-09-07T00:00:00Z')


def test_defaults_explicit_overrides_and_missing_credentials(monkeypatch):
    monkeypatch.setenv('MACROFOLD_API_KEY', 'environment-fixture')
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={'data': [], 'next_cursor': None})
    client = Client(transport=httpx.MockTransport(handler))
    try:
        assert client.projects.list().data == []
        assert str(calls[0].url) == DEFAULT_ORIGIN + '/v1/projects'
        assert calls[0].headers['authorization'] == 'Bearer environment-fixture'
    finally:
        client.close()
    client = Client(base_url='http://localhost:3210', api_key='explicit', transport=httpx.MockTransport(handler))
    try:
        client.projects.list()
        assert str(calls[-1].url).startswith('http://localhost:3210/')
        assert calls[-1].headers['authorization'] == 'Bearer explicit'
    finally:
        client.close()
    with pytest.raises(ValueError, match='Missing Macrofold API key'):
        Client(api_key='')
    monkeypatch.delenv('MACROFOLD_API_KEY')
    with pytest.raises(ValueError, match='MACROFOLD_API_KEY'):
        Client()
    with pytest.raises(ValueError, match='not both'):
        Client(api_key='explicit', token='other')
    client = Client(token=lambda: '', transport=httpx.MockTransport(lambda _: pytest.fail('Missing supplier credentials must not reach HTTP')))
    try:
        with pytest.raises(ValueError, match='Missing Macrofold API key'):
            client.projects.list()
    finally:
        client.close()


def test_keywords_typed_responses_uuid_dates_null_and_binary(monkeypatch):
    calls = []
    def handler(request):
        calls.append(request)
        if request.url.path.endswith('/file'):
            return httpx.Response(200, content=b'\x00\xff')
        if request.method == 'GET':
            return httpx.Response(200, json={'data': [], 'next_cursor': None})
        return httpx.Response(201, json=PROJECT)
    client = Client(api_key='fixture', transport=httpx.MockTransport(handler))
    try:
        project = client.projects.create(name='Research', github={'installation_id': '1', 'repository_id': '2', 'target_branch': 'main'})
        assert isinstance(project, models.Project) and project.id == UUID(ID)
        assert json.loads(calls[0].content) == {'name': 'Research', 'github': {'installation_id': '1', 'repository_id': '2', 'target_branch': 'main'}}
        client.projects.list(archived=False, limit=1)
        assert calls[-1].url.params['archived'] == 'false'
        client.runs.list(project_id=project.id, from_=datetime(2026, 9, 7, tzinfo=timezone.utc))
        assert calls[-1].url.params['project_id'] == ID
        assert calls[-1].url.params['from'].startswith('2026-09-07T00:00:00')
        assert client.workspaces.read_file('space / one', path='notes/a + b') == b'\x00\xff'
        assert 'space%20%2F%20one' in str(calls[-1].url)
        client.projects.update(ID, name='Renamed')
        assert json.loads(calls[-1].content) == {'name': 'Renamed'}
        with pytest.raises(TypeError, match='name'):
            client.projects.create()
        with pytest.raises(TypeError, match='unexpected keyword'):
            client.projects.create(body={'name': 'Wrong'})
        # Nested references and keyword types are usable by editors and runtime introspection.
        for resource in vars(client).values():
            if resource.__class__.__module__ == 'macrofold.resources':
                for name, method in inspect.getmembers(resource, inspect.ismethod):
                    if not name.startswith('_'):
                        get_type_hints(method)
        for value in vars(params).values():
            if hasattr(value, '__required_keys__'):
                get_type_hints(value)
    finally:
        client.close()


def test_resource_retries_keep_identity_and_truncated_response_is_not_repeated(monkeypatch):
    monkeypatch.setattr('time.sleep', lambda _: None)
    calls = []
    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(503)
        return httpx.Response(201, text='{"id":')
    client = Client(api_key='fixture', transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(TransportError) as error:
            client.projects.create(name='Research', request_options=RequestOptions(idempotency_key='stable'))
        assert error.value.idempotency_key == 'stable'
        assert [r.headers['idempotency-key'] for r in calls] == ['stable', 'stable']
    finally:
        client.close()


def test_invalid_typed_success_preserves_identity():
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(201, json={'id': ID})
    client = Client(api_key='fixture', transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(TransportError, match='API contract') as error:
            client.projects.create(name='Research')
        assert [r.headers['Idempotency-Key'] for r in calls] == [error.value.idempotency_key]
        assert error.value.idempotency_key
    finally:
        client.close()


def test_typed_stream_replays_and_closes_its_transport(monkeypatch):
    monkeypatch.setattr('time.sleep', lambda _: None)
    cursors, closed = [], []
    def frame(sequence, kind):
        event = dict(id=ID, run_id=ID, schema_version=1, sequence=sequence, type=kind, occurred_at=PROJECT['created_at'], ingested_at=PROJECT['created_at'], data={'text': 'Hello 🌍'})
        return f'data: {json.dumps(event)}\n\n'.encode()
    class Stream(httpx.SyncByteStream):
        def __init__(self, content): self.content = content
        def __iter__(self): yield self.content
        def close(self): closed.append(True)
    def handler(request):
        if not request.url.path.endswith('/stream'):
            return httpx.Response(200, json={'status':'running'})
        cursors.append(request.headers['Last-Event-ID'])
        content = frame('1', 'output.delta')
        if len(cursors) > 1: content += frame('2', 'run.succeeded')
        return httpx.Response(200, stream=Stream(content))
    client = Client(api_key='fixture', transport=httpx.MockTransport(handler))
    try:
        events = list(client.runs.stream(UUID(ID)))
        assert [e.sequence for e in events] == ['1', '2']
        assert events[0].run_id == UUID(ID) and events[0].data['text'] == 'Hello 🌍'
        assert cursors == ['0', '1'] and len(closed) == 2
        stream = client.runs.stream(UUID(ID))
        next(stream)
        stream.close()
        assert len(closed) == 3
    finally:
        client.close()


@pytest.mark.skipif(not os.getenv('MACROFOLD_FIXTURE_ORIGIN'), reason='Run pnpm test:sdks for isolated application acceptance')
def test_application_journey():
    client = Client(base_url=os.environ['MACROFOLD_FIXTURE_ORIGIN'], api_key=os.environ['MACROFOLD_FIXTURE_KEY'])
    try:
        files_workspace = os.environ['MACROFOLD_FIXTURE_FILES_WORKSPACE']
        assert client.workspaces.read_file(files_workspace, path='notes/日本語 + #?.bin') == bytes([0, 255, 10, 128])
        assert client.workspaces.read_file(files_workspace, path='empty.txt') == b''
        with pytest.raises(ApiError) as error:
            client.workspaces.read_file(files_workspace, path='missing.txt')
        assert error.value.status == 404
        project = client.projects.create(name='Python application fixture')
        agent = client.agents.create(name='Python preset', harness='codex', model='fixture-model', billing_mode='managed')
        run = client.runs.create(project_id=project.id, agent_id=agent.id, prompt='Verify Python persisted execution.')
        text = ''.join(client.runs.stream_text(run.run_id))
        events = list(client.runs.events(run.run_id))
        assert events[-1].type == 'run.succeeded'
        assert client.runs.get(run.run_id).status == 'succeeded'
        result = client.runs.wait(run.run_id)
        assert result.final and 'Simulation completed' in result.output_text
        assert text == result.output_text and result.persistence_status == 'verified'
        replay = list(client.runs.stream(run.run_id, after=events[-2].sequence))
        assert [e.sequence for e in replay] == [events[-1].sequence]
        cancelled = client.runs.cancel(run.run_id)
        assert cancelled.status == 'succeeded'  # Cancelling terminal work is idempotent.
        assert client.workspaces.list_checkpoints(run.workspace_id).data
        assert b'Verify Python persisted execution' in client.workspaces.read_file(run.workspace_id, path=f'notes/run-{run.run_id}.md')
    finally:
        client.close()
