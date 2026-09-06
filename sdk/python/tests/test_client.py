import json

import httpx
import pytest

from hosted_agents import ApiError, Client, TransportError


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
