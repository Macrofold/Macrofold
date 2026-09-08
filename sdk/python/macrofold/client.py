"""Public HTTP API only. This module has no cloud credentials or provider SDKs."""

from __future__ import annotations

import json
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
                raise TimeoutError('Wait deadline expired')
            return min(65, value)

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
                **({'timeout': remaining()} if _deadline is not None else {}),
            )
            try:
                response = self._http.send(request, stream=stream or _deadline is not None)
                if _deadline is not None and not response.is_stream_consumed:
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
        if operation in ROUTES and ROUTES[operation]["method"] not in {"GET", "HEAD"}:
            kwargs["idempotency_key"] = kwargs.get("idempotency_key") or str(uuid.uuid4())
        response = self._raw(operation, **kwargs)
        try:
            if response.status_code == 204:
                return None
            if operation == "readFile":
                return response.content
            return response.json()
        except (ValueError, httpx.TransportError) as error:
            raise TransportError("The service response was incomplete. Reuse the idempotency key for a mutation.", kwargs.get("idempotency_key")) from error
        finally:
            response.close()

    def wait_operation(self, operation_id: str, *, timeout: float = 300) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            operation = self.request("getOperation", path={"operation_id": operation_id})
            if operation["status"] in {"succeeded", "failed", "cancelled"}:
                return operation
            time.sleep(0.75)
        raise TransportError(f"Operation {operation_id} is still pending; inspect its ID later")

    def stream(self, run_id: str, *, after: str = "0") -> Generator[dict[str, Any], None, None]:
        """Yield normalized durable events once per sequence; closing the iterator detaches."""
        if not re.fullmatch(r"\d+", after):
            raise ValueError("Use a numeric event cursor")
        cursor, failures = int(after), 0
        while True:
            try:
                response = self._raw("streamRun", path={"run_id": run_id}, query={"after": str(cursor)}, headers={"Accept": "text/event-stream", "Last-Event-ID": str(cursor)}, stream=True)
                try:
                    data: list[str] = []
                    size = 0
                    for line in response.iter_lines():
                        size += len(line.encode())
                        if size > 4 * 1024 * 1024:
                            raise ValueError("SSE frame exceeds 4 MiB")
                        if not line:
                            if data:
                                event = json.loads("\n".join(data))
                                sequence = str(event.get("sequence", ""))
                                if re.fullmatch(r"\d+", sequence) and int(sequence) > cursor:
                                    cursor, failures = int(sequence), 0
                                    yield event
                                    if event.get("type") in {f"run.{status}" for status in TERMINAL}:
                                        return
                            data, size = [], 0
                        elif line.startswith("data:"):
                            data.append(line[5:].removeprefix(" "))
                finally:
                    response.close()
                run = self.request("getRun", path={"run_id": run_id})
                if run["status"] in TERMINAL:
                    remaining = self.request("listRunEvents", path={"run_id": run_id}, query={"after": str(cursor), "limit": 100})
                    if not remaining["data"]:
                        return
            except (httpx.TransportError, TransportError, ApiError) as error:
                if isinstance(error, ApiError) and error.status not in {429, 500, 502, 503, 504}:
                    raise
                failures += 1
                if failures > 8:
                    raise TransportError(f"Stream for {run_id} disconnected. Reattach after {cursor}.") from error
            time.sleep(min(10, 0.25 * 2**failures))
