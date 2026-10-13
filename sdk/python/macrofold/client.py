"""Public HTTP API only. This module has no cloud credentials or provider SDKs."""

from __future__ import annotations

import json
import math
import re
import time
import uuid
import os
from collections.abc import Callable, Generator, Mapping
from importlib.resources import files
from typing import Any
from urllib.parse import quote, urlsplit

import httpx
from .resources import Resources, DEFAULT_ORIGIN

ROUTES: dict[str, dict[str, str]] = json.loads(
    files("macrofold").joinpath("routes.json").read_text()
)
TERMINAL = {"succeeded", "failed", "cancelled", "timed_out"}


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, request_id: str | None = None):
        super().__init__(message)
        self.status, self.code, self.request_id = status, code, request_id


class TransportError(Exception):
    def __init__(self, message: str, idempotency_key: str | None = None):
        super().__init__(message)
        self.idempotency_key = idempotency_key


def _origin(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise ValueError("Use a service origin without credentials, query or path")
    if parsed.scheme != "https" and not (
        parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    ):
        raise ValueError("HTTPS is required except for local development")
    if not parsed.hostname:
        raise ValueError("A service hostname is required")
    return f"{parsed.scheme}://{parsed.netloc}"


class Client(Resources):
    """Typed resource methods and resumable streaming over the public API.

    A callable token supplier can refresh OAuth credentials before each request. The SDK
    never switches credential providers automatically. Call close() when finished.
    """

    def __init__(
        self,
        base_url: str = DEFAULT_ORIGIN,
        token: str | Callable[[], str] | None = None,
        *,
        api_key: str | None = None,
        organization: str | None = None,
        retries: int = 2,
        transport: httpx.BaseTransport | None = None,
    ):
        self.base_url = _origin(base_url)
        if token is not None and api_key is not None:
            raise ValueError("Pass api_key or token, not both")
        credential = api_key if api_key is not None else token if token is not None else os.environ.get("MACROFOLD_API_KEY", "")
        if not callable(credential) and not credential.strip():
            raise ValueError("Missing Macrofold API key. Pass api_key or set MACROFOLD_API_KEY.")
        if not isinstance(retries, int) or isinstance(retries, bool) or not 0 <= retries <= 8:
            raise ValueError('retries must be an integer between 0 and 8')
        self._token, self.organization, self.retries = credential, organization, retries
        self._init_resources(self)
        self._http = httpx.Client(
            timeout=httpx.Timeout(65, connect=15), follow_redirects=False, transport=transport
        )

    def __enter__(self) -> Client:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    def close(self) -> None:
        self._http.close()

    def _raw(
        self,
        operation: str,
        *,
        path: Mapping[str, str] | None = None,
        query: Mapping[str, Any] | None = None,
        body: Any = None,
        headers: Mapping[str, str] | None = None,
        idempotency_key: str | None = None,
        stream: bool = False,
        _deadline: float | None = None,
    ) -> httpx.Response:
        if operation not in ROUTES:
            raise ValueError(f"Unknown operation: {operation}")
        route = ROUTES[operation]
        # HTTPX read timeouts apply per chunk. An absolute deadline also bounds
        # a response that trickles bytes forever; event streams enforce their own.
        wait_deadline = _deadline
        request_seconds = 300 if operation == 'createInference' else 70
        _deadline = min(_deadline, time.monotonic() + request_seconds) if _deadline is not None else time.monotonic() + request_seconds

        def parameter(match: re.Match[str]) -> str:
            name = match.group(1)
            if not path or name not in path:
                raise ValueError(f"Missing path parameter: {name}")
            return quote(str(path[name]), safe="")

        endpoint = re.sub(r"\{([^}]+)\}", parameter, route["path"])
        mutation = route["method"] not in {"GET", "HEAD"}
        identity = idempotency_key or str(uuid.uuid4()) if mutation else None
        payload = body if isinstance(body, bytes) else json.dumps(body).encode() if body is not None else None
        def remaining() -> float:
            value = 65 if _deadline is None else _deadline - time.monotonic()
            if value <= 0:
                if wait_deadline is not None and time.monotonic() >= wait_deadline:
                    raise TimeoutError('Wait deadline expired')
                raise TransportError('Request deadline expired. Inspect the resource or reuse the mutation identity.', identity)
            return min(request_seconds, value)

        def pause(seconds: float) -> None:
            time.sleep(seconds if _deadline is None else min(seconds, remaining()))
            if _deadline is not None:
                remaining()

        for attempt in range(self.retries + 1):
            if _deadline is not None:
                remaining()
            token = self._token() if callable(self._token) else self._token
            if not token or not token.strip():
                raise ValueError("Missing Macrofold API key. Pass api_key or set MACROFOLD_API_KEY.")
            request_headers = {"X-Client-Type": "sdk", **(headers or {}), "Authorization": f"Bearer {token}"}
            if self.organization:
                request_headers["X-Organization-Id"] = self.organization
            if identity:
                request_headers["Idempotency-Key"] = identity
            if payload is not None:
                request_headers["Content-Type"] = "application/octet-stream" if isinstance(body, bytes) else "application/json"
            request = self._http.build_request(
                route["method"], self.base_url + endpoint, headers=request_headers,
                params={k: str(v).lower() if isinstance(v, bool) else v for k, v in (query or {}).items() if v is not None}, content=payload,
                timeout=httpx.Timeout(remaining(), connect=min(15, remaining())),
            )
            try:
                response = self._http.send(request, stream=stream or _deadline is not None)
                if (not stream or not 200 <= response.status_code < 300) and not response.is_stream_consumed:
                    # Enforce the wait deadline while reading too, including a slowly arriving body.
                    try:
                        chunks = []
                        for chunk in response.iter_raw():
                            remaining()
                            chunks.append(chunk)
                        remaining()
                        buffered = httpx.Response(response.status_code, headers=response.headers, content=b''.join(chunks), request=request)
                    finally:
                        response.close()
                    response = buffered
                if _deadline is not None:
                    remaining()
            except httpx.TransportError as error:
                if _deadline is not None:
                    remaining()
                if attempt < self.retries:
                    pause(0.2 * 2**attempt)
                    continue
                raise TransportError("Request outcome is unknown. Reuse the idempotency key for a mutation.", identity) from error
            if 200 <= response.status_code < 300:
                return response
            if response.status_code in {429, 502, 503, 504} and attempt < self.retries:
                try:
                    retry_after = min(60, max(0, float(response.headers.get("retry-after", "0"))))
                except ValueError:
                    retry_after = 0
                response.close()
                pause(max(retry_after, 0.2 * 2**attempt))
                continue
            try:
                response.read()
                error_body = response.json().get("error", {})
            except (ValueError, AttributeError):
                error_body = {}
            finally:
                response.close()
            raise ApiError(response.status_code, error_body.get("code", "http_error"), error_body.get("message", f"Request failed ({response.status_code})"), response.headers.get("x-request-id"))
        raise AssertionError("Unreachable retry state")

    def request(self, operation: str, **kwargs: Any) -> Any:
        """`path`, `query`, `body`, `headers`, `idempotency_key` map directly to OpenAPI."""
        if operation == "createInference" and isinstance(kwargs.get("body"), dict) and kwargs["body"].get("stream") is True:
            raise ValueError("Use inferences.stream(request) for incremental inference output.")
        if operation in ROUTES and ROUTES[operation]["method"] not in {"GET", "HEAD"}:
            kwargs["idempotency_key"] = kwargs.get("idempotency_key") or str(uuid.uuid4())
        response = self._raw(operation, **kwargs)
        try:
            if response.status_code == 204:
                return None
            if operation in {"readFile", "readCustomerAgentFile"}:
                return response.content
            return response.json()
        except (ValueError, httpx.TransportError) as error:
            raise TransportError("The service response was incomplete. Reuse the idempotency key for a mutation.", kwargs.get("idempotency_key")) from error
        finally:
            response.close()

    def wait_operation(self, operation_id: str, *, timeout: float = 300) -> dict[str, Any]:
        if not math.isfinite(timeout) or timeout < 0:
            raise ValueError('timeout must be finite and non-negative')
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            operation = self.request("getOperation", path={"operation_id": operation_id}, _deadline=deadline)
            if operation["status"] in {"succeeded", "failed", "cancelled"}:
                return operation
            time.sleep(min(0.75, max(0, deadline - time.monotonic())))
        raise TransportError(f"Operation {operation_id} is still pending; inspect its ID later")

    def stream_inference(self, body: Mapping[str, Any], *, idempotency_key: str | None = None, headers: Mapping[str, str] | None = None) -> Generator[dict[str, Any], None, None]:
        """Deliver a single POST stream. Closing detaches; recover using its run ID."""
        identity = idempotency_key or str(uuid.uuid4())
        response = self._raw("createInference", body={**body, "stream": True}, idempotency_key=identity, headers={**(headers or {}), "Accept": "text/event-stream"}, stream=True)
        try:
            if "text/event-stream" not in response.headers.get("content-type", ""):
                raise TransportError("Expected a direct event stream.", identity)
            for event in _sse_events(response, lifetime=300):
                yield event
                if event.get("type") == "transport.error":
                    raise TransportError("Stream interrupted; retrieve the saved run result.", identity)
                if event.get("type") in {f"run.{status}" for status in TERMINAL} | {"run.recovery_required"}:
                    return
            raise TransportError("Stream ended before its terminal result; retrieve the saved run result.", identity)
        except (ValueError, httpx.TransportError) as error:
            raise TransportError("Stream interrupted; retrieve the saved run result.", identity) from error
        finally:
            response.close()

    def stream(self, run_id: str, *, after: str = "0") -> Generator[dict[str, Any], None, None]:
        return self._stream_path(run_id, {"run_id": run_id}, ("streamRun", "getRun", "listRunEvents"), after)

    def stream_customer_agent(self, customer_id: str, customer_agent_id: str, run_id: str, *, after: str = "0") -> Generator[dict[str, Any], None, None]:
        return self._stream_path(run_id, {"customer_id": customer_id, "customer_agent_id": customer_agent_id, "run_id": run_id}, ("streamCustomerAgentRun", "getCustomerAgentRun", "listCustomerAgentRunEvents"), after)

    def _stream_path(self, run_id: str, path: dict[str, str], operations: tuple[str, str, str], after: str) -> Generator[dict[str, Any], None, None]:
        """Yield normalized durable events once per sequence; closing the iterator detaches."""
        if not re.fullmatch(r"\d+", after):
            raise ValueError("Use a numeric event cursor")
        cursor, failures = int(after), 0
        for _connection in range(2048):
            try:
                response = self._raw(operations[0], path=path, query={"after": str(cursor)}, headers={"Accept": "text/event-stream", "Last-Event-ID": str(cursor)}, stream=True)
                try:
                    for event in _sse_events(response):
                        sequence = str(event.get("sequence", ""))
                        if re.fullmatch(r"\d+", sequence) and int(sequence) > cursor:
                            cursor, failures = int(sequence), 0
                            yield event
                            if event.get("type") in {f"run.{status}" for status in TERMINAL} | {"run.recovery_required"}:
                                return
                finally:
                    response.close()
                run = self.request(operations[1], path=path)
                if run.get("failure_code") == "run_recovery_required":
                    return
                if run["status"] in TERMINAL:
                    remaining = self.request(operations[2], path=path, query={"after": str(cursor), "limit": 100})
                    if not remaining["data"]:
                        return
            except (httpx.TransportError, TransportError, ApiError) as error:
                if isinstance(error, ApiError) and error.status not in {429, 500, 502, 503, 504}:
                    raise
                failures += 1
                if failures > 8:
                    raise TransportError(f"Stream for {run_id} disconnected. Reattach after {cursor}.") from error
            time.sleep(min(10, 0.25 * 2**failures))
        raise TransportError(f'Stream attachment limit reached. Reattach after {cursor}; the run has not been cancelled.')


def _sse_events(response: httpx.Response, *, lifetime: float = 70) -> Generator[dict[str, Any], None, None]:
    data: list[str] = []
    pending = b''
    size = 0
    deadline = time.monotonic() + lifetime
    for chunk in response.iter_bytes():
        if time.monotonic() >= deadline:
            raise httpx.ReadTimeout('Stream connection deadline exceeded')
        pending += chunk
        while b'\n' in pending:
            raw, pending = pending.split(b'\n', 1)
            size += len(raw) + 1
            if size > 4 * 1024 * 1024:
                raise ValueError('SSE frame exceeds 4 MiB')
            line = raw.rstrip(b'\r').decode('utf-8')
            if not line:
                if data:
                    yield json.loads('\n'.join(data))
                data, size = [], 0
            elif line.startswith('data:'):
                data.append(line[5:].removeprefix(' '))
        if len(pending) + size > 4 * 1024 * 1024:
            raise ValueError('SSE frame exceeds 4 MiB')
