import json
from uuid import UUID
import httpx
import pytest
from macrofold import Macrofold, RunFailedError, WaitTimeoutError, ApiError
from macrofold.models import RunResult

ID = '00000000-0000-4000-8000-000000000001'

def result(persistence='verified', outcome='success', final=True):
    return dict(run_id=ID, final=final, execution_outcome=outcome, persistence_status=persistence, output_text='Hello 🌍', checkpoint_id=ID)

def state(status):
    return dict(id=ID, organization_id=ID, session_id=ID, workspace_id=ID, harness='codex', model='fixture', status=status, created_at='2026-09-07T00:00:00Z', failure_code='fixture_failure')

def event(sequence, kind, text):
    return dict(id=ID, run_id=ID, schema_version=1, sequence=sequence, type=kind, occurred_at='2026-09-07T00:00:00Z', ingested_at='2026-09-07T00:00:00Z', data={'text':text})

def frame(sequence, kind, text):
    return 'data: ' + json.dumps(event(sequence,kind,text)) + '\n\n'


def test_text_reconnect_filters_payloads_and_structured_events_remain(monkeypatch):
    monkeypatch.setattr('macrofold.client.time.sleep', lambda _: None)
    cursors, gets = [], []
    def respond(request):
        assert request.method == 'GET' and request.headers['X-Organization-Id'] == ID
        if request.url.path.endswith('/stream'):
            cursors.append(request.headers['Last-Event-ID'])
            text = frame('1','output.delta','Hello ') + frame('2','tool.completed','TOOL SECRET')
            if len(cursors) > 1:
                text += frame('3','output.delta','🌍') + frame('4','reasoning.delta','REASONING') + frame('5','output.delta',{}) + frame('6','run.succeeded','FULL RESPONSE')
            return httpx.Response(200,text=text)
        if request.url.path.endswith('/result'):
            return httpx.Response(200,json=result())
        gets.append(True)
        return httpx.Response(200,json=state('running' if len(gets)==1 else 'succeeded'))
    client=Macrofold(api_key='fixture',organization=ID,transport=httpx.MockTransport(respond))
    try:
        assert list(client.runs.stream_text(ID)) == ['Hello ','🌍']
        assert cursors == ['0','2']
        assert [e.type for e in client.runs.events(ID,after='3')] == ['reasoning.delta','output.delta','run.succeeded']
    finally:
        client.close()


@pytest.mark.parametrize('status,persistence,outcome', [('failed','verified','failure'),('cancelled','not_required','cancelled'),('timed_out','verified','timed_out'),('succeeded','failed','success')])
def test_unsuccessful_run_after_terminal_cursor_raises_typed_error(status,persistence,outcome):
    def respond(request):
        assert request.method == 'GET'
        if request.url.path.endswith('/stream'): return httpx.Response(200,text='')
        if request.url.path.endswith('/events'): return httpx.Response(200,json={'data':[],'next_cursor':None})
        if request.url.path.endswith('/result'): return httpx.Response(200,json=result(persistence,outcome))
        return httpx.Response(200,json=state(status))
    client=Macrofold(api_key='fixture',transport=httpx.MockTransport(respond))
    try:
        with pytest.raises(RunFailedError) as raised:
            list(client.runs.stream_text(UUID(ID),after='99'))
        assert raised.value.run_id == ID and raised.value.status == status
        assert raised.value.failure_code == 'fixture_failure' and ID in str(raised.value)
    finally:
        client.close()


def test_wait_retains_typed_metadata_after_persistence_without_streaming(monkeypatch):
    monkeypatch.setattr('macrofold.run_helpers.time.sleep', lambda _: None)
    states=iter(['persisting','succeeded','succeeded'])
    results=iter([result('pending',final=False),result()])
    def respond(request):
        assert '/stream' not in request.url.path
        value=next(results) if request.url.path.endswith('/result') else state(next(states))
        return httpx.Response(200,json=value)
    client=Macrofold(api_key='fixture',transport=httpx.MockTransport(respond))
    try:
        response=client.runs.wait(ID)
        assert isinstance(response,RunResult)
        assert response.output_text == 'Hello 🌍' and response.checkpoint_id == UUID(ID)
    finally:
        client.close()


def test_closing_text_generator_closes_connection_without_cancel_or_completion():
    closed=[]
    class Stream(httpx.SyncByteStream):
        def __iter__(self): yield frame('1','output.delta','Hello').encode()
        def close(self): closed.append(True)
    requests=[]
    def respond(request):
        requests.append(request)
        return httpx.Response(200,stream=Stream())
    client=Macrofold(api_key='fixture',transport=httpx.MockTransport(respond))
    try:
        stream=client.runs.stream_text(ID)
        assert next(stream)=='Hello'
        stream.close()
        assert closed==[True] and len(requests)==1
    finally:
        client.close()


@pytest.mark.parametrize('mode',['poll','retry','body','transport'])
def test_wait_deadline_caps_requests_retries_and_reads(monkeypatch,mode):
    now=[0.0]
    monkeypatch.setattr('macrofold.client.time.monotonic',lambda:now[0])
    monkeypatch.setattr('macrofold.client.time.sleep',lambda seconds:now.__setitem__(0,now[0]+seconds))
    closed=[]
    class SlowBody(httpx.SyncByteStream):
        def __iter__(self):
            yield b'{'
            now[0]=2
            yield b'}'
        def close(self): closed.append(True)
    requests=[]
    def respond(request):
        requests.append(request)
        assert request.method=='GET' and request.extensions['timeout']['read'] <= 1
        if mode=='body': return httpx.Response(200,stream=SlowBody())
        if mode=='retry': return httpx.Response(503,headers={'Retry-After':'60'})
        if mode=='transport':
            now[0]=2
            raise httpx.ReadTimeout('fixture',request=request)
        return httpx.Response(200,json=state('persisting'))
    client=Macrofold(api_key='fixture',transport=httpx.MockTransport(respond))
    try:
        with pytest.raises(WaitTimeoutError) as raised: client.runs.wait(ID,timeout=1)
        assert raised.value.run_id==ID and len(requests)==1
        if mode=='body': assert closed==[True]
        with pytest.raises(WaitTimeoutError): client.runs.wait(ID,timeout=0)
        assert len(requests)==1
        with pytest.raises(ValueError): client.runs.wait(ID,poll_interval=0)
        with pytest.raises(ValueError): client.runs.wait(ID,timeout=float('nan'))
    finally:
        client.close()


def test_wait_and_text_stream_surface_revoked_authorization():
    client=Macrofold(api_key='fixture',transport=httpx.MockTransport(lambda _:httpx.Response(403,json={'error':{'code':'forbidden','message':'Revoked'}})))
    try:
        with pytest.raises(ApiError) as raised: client.runs.wait(ID)
        assert raised.value.status==403
        with pytest.raises(ApiError): list(client.runs.stream_text(ID))
    finally:
        client.close()
