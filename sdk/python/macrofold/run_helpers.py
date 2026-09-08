"""Presentation and completion helpers over the maintained transport and typed resources."""
import math
import time
from collections.abc import Callable, Generator
from typing import TYPE_CHECKING
from .models import Event, Run, RunResult
from .resource_options import decode

if TYPE_CHECKING:
    from .client import Client


class RunFailedError(Exception):
    def __init__(self, run_id: str, status: str, result: RunResult, failure_code: str | None = None):
        self.run_id, self.status, self.result, self.failure_code = run_id, status, result, failure_code
        super().__init__(f'Run {run_id} ended with status {status} (persistence: {result.persistence_status}).')


class WaitTimeoutError(TimeoutError):
    def __init__(self, run_id: str):
        self.run_id = run_id
        super().__init__(f'Timed out waiting for run {run_id}. The agent has not been cancelled.')


def wait_for_run(client: 'Client', run_id: str, *, timeout: float | None = None, poll_interval: float = 1) -> RunResult:
    if not math.isfinite(poll_interval) or poll_interval <= 0:
        raise ValueError('poll_interval must be positive')
    if timeout is not None and (not math.isfinite(timeout) or timeout < 0):
        raise ValueError('timeout must be a non-negative number')
    deadline = None if timeout is None else time.monotonic() + timeout
    try:
        while True:
            if deadline is not None and time.monotonic() >= deadline:
                raise WaitTimeoutError(run_id)
            run = decode(Run, client.request('getRun', path={'run_id': run_id}, _deadline=deadline), None)
            if run.status in {'succeeded', 'failed', 'cancelled', 'timed_out'}:
                result = decode(RunResult, client.request('getRunResult', path={'run_id': run_id}, _deadline=deadline), None)
                if result.final and result.persistence_status != 'pending':
                    if run.status != 'succeeded' or result.execution_outcome != 'success' or result.persistence_status not in {'verified', 'not_required'}:
                        raise RunFailedError(run_id, run.status, result, run.failure_code)
                    return result
            delay = poll_interval if deadline is None else min(poll_interval, max(0, deadline - time.monotonic()))
            time.sleep(delay)
    except TimeoutError as error:
        if isinstance(error, WaitTimeoutError):
            raise
        raise WaitTimeoutError(run_id) from error


def stream_run_text(events: Generator[Event, None, None], complete: Callable[[], RunResult]) -> Generator[str, None, None]:
    try:
        for event in events:
            text = event.data.get('text')
            if event.type == 'output.delta' and isinstance(text, str) and text:
                yield text
    finally:
        events.close()
    complete()
