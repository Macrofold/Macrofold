import json

import httpx
import pytest

from macrofold import ApiError, Client, TransportError


def test_mutation_reuses_idempotency_after_lost_response(monkeypatch):
    monkeypatch.setattr("time.sleep", lambda _: None)
    keys = []

    def handler(request):
        keys.append(request.headers["Idempotency-Key"])
        if len(keys) == 1:
            raise httpx.ReadError("lost response")
        return httpx.Response(201, json={"id": "project"})

    with Client("https://agents.example.test", "fixture", transport=httpx.MockTransport(handler)) as client:
        assert client.request("createProject", body={"name": "Test"}) == {"id": "project"}
    assert len(keys) == 2 and keys[0] == keys[1]


def test_stream_rotates_and_deduplicates(monkeypatch):
    monkeypatch.setattr("time.sleep", lambda _: None)
    cursors = []

    def handler(request):
        if request.url.path.endswith("/stream"):
            cursors.append(request.headers["Last-Event-ID"])
            events = [{"sequence": "1", "type": "output.delta", "data": {"text": "Hello"}}]
            if len(cursors) > 1:
                events.append({"sequence": "2", "type": "run.succeeded", "data": {}})
            return httpx.Response(200, text="".join(f"data: {json.dumps(event)}\n\n" for event in events))
        return httpx.Response(200, json={"status": "running"})

    with Client("https://agents.example.test", "fixture", transport=httpx.MockTransport(handler)) as client:
        assert [event["sequence"] for event in client.stream("run")] == ["1", "2"]
    assert cursors == ["0", "1"]


def test_errors_and_redirects_never_expose_credentials():
    with pytest.raises(ValueError):
        Client("http://untrusted.example.test", "fixture")
    with Client("https://agents.example.test", "fixture", transport=httpx.MockTransport(lambda _: httpx.Response(302, headers={"Location": "https://elsewhere.test"}))) as client:
        with pytest.raises(ApiError) as error:
            client.request("getIdentity")
        assert error.value.status == 302
    with Client("https://agents.example.test", "fixture", retries=0, transport=httpx.MockTransport(lambda _: httpx.Response(403, headers={"X-Request-Id": "request"}, json={"error": {"code": "forbidden", "message": "Missing scope"}}))) as client:
        with pytest.raises(ApiError) as error:
            client.request("getIdentity")
        assert error.value.request_id == "request" and error.value.code == "forbidden"


def test_truncated_mutation_body_preserves_recovery_identity():
    identities = []

    def handler(request):
        identities.append(request.headers["Idempotency-Key"])
        return httpx.Response(201, text='{"id":')

    with Client("https://agents.example.test", "fixture", transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(TransportError) as error:
            client.request("createProject", body={"name": "Test"})
        assert identities == [error.value.idempotency_key]
        assert error.value.idempotency_key


@pytest.mark.parametrize('origin', ['https://u:p@example.test', 'https://example.test/path', 'https://example.test?secret=1', 'https://example.test#fragment', 'https://'])
def test_invalid_origins_cannot_send_credentials(origin):
    with pytest.raises(ValueError):
        Client(origin, 'fixture')


def test_retry_refreshes_supplier_preserving_identity_and_honoring_bounded_retry_after(monkeypatch):
    waits, calls, tokens = [], [], iter(['old', 'fresh'])
    monkeypatch.setattr('time.sleep', waits.append)

    def handler(request):
        calls.append(request)
        return httpx.Response(429, headers={'Retry-After': '99999'}) if len(calls) == 1 else httpx.Response(201, json={'id': 'p'})

    with Client('https://agents.example.test', lambda: next(tokens), organization='org-a', transport=httpx.MockTransport(handler)) as client:
        assert client.request('createProject', body={'name': 'p'}, idempotency_key='stable') == {'id': 'p'}
    assert waits == [60]
    assert [c.headers['authorization'] for c in calls] == ['Bearer old', 'Bearer fresh']
    assert [c.headers['idempotency-key'] for c in calls] == ['stable', 'stable']
    assert all(c.headers['x-organization-id'] == 'org-a' for c in calls)


def test_timeout_retains_operation_id_for_later_recovery():
    with Client('https://agents.example.test', 'fixture', transport=httpx.MockTransport(lambda _: pytest.fail('No request after deadline'))) as client:
        with pytest.raises(TransportError, match='operation-123 is still pending'):
            client.wait_operation('operation-123', timeout=0)


def test_stream_does_not_retry_revoked_authority(monkeypatch):
    calls = []
    monkeypatch.setattr('time.sleep', lambda _: pytest.fail('Revocation must not reconnect'))

    def handler(request):
        calls.append(request)
        return httpx.Response(401, json={'error': {'code': 'unauthenticated'}})

    with Client('https://agents.example.test', 'revoked', transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ApiError) as denied:
            list(client.stream('run'))
        assert denied.value.status == 401
        assert len(calls) == 1


def test_binary_response_path_encoding_and_validation():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, content=b'\x00\xff\x10')

    with Client('https://agents.example.test', 'fixture', transport=httpx.MockTransport(handler)) as client:
        assert client.request('readFile', path={'workspace_id': 'space / one'}, query={'path': 'dir/a.txt'}) == b'\x00\xff\x10'
        assert 'space%20%2F%20one' in str(calls[0].url)
        with pytest.raises(ValueError, match='Missing path parameter'):
            client.request('readFile')
        with pytest.raises(ValueError, match='Unknown operation'):
            client.request('missing')
        with pytest.raises(ValueError, match='numeric event cursor'):
            list(client.stream('run', after='bad'))
        assert len(calls) == 1


def test_invalid_retry_header_uses_backoff_and_no_content_returns_none(monkeypatch):
    waits, calls = [], []
    monkeypatch.setattr('time.sleep', waits.append)

    def handler(request):
        calls.append(request)
        return httpx.Response(503, headers={'retry-after': 'invalid'}) if len(calls) == 1 else httpx.Response(204)

    with Client('https://agents.example.test', 'fixture', transport=httpx.MockTransport(handler)) as client:
        assert client.request('revokeApiKey', path={'key_id': 'key'}) is None
    assert waits == [0.2]
    assert calls[0].headers['idempotency-key'] == calls[1].headers['idempotency-key']


def test_non_json_failure_is_a_stable_api_error():
    with Client('https://agents.example.test', 'fixture', retries=0, transport=httpx.MockTransport(lambda _: httpx.Response(502, text='upstream unavailable'))) as client:
        with pytest.raises(ApiError) as error:
            client.request('getIdentity')
        assert (error.value.status, error.value.code) == (502, 'http_error')


def test_wait_operation_returns_terminal_failure_for_inspection(monkeypatch):
    monkeypatch.setattr('time.sleep', lambda _: None)
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={'id': 'op', 'status': 'pending' if len(calls) == 1 else 'failed', 'error': 'restore_failed'})

    with Client('https://agents.example.test', 'fixture', transport=httpx.MockTransport(handler)) as client:
        assert client.wait_operation('op') == {'id': 'op', 'status': 'failed', 'error': 'restore_failed'}
    assert len(calls) == 2
