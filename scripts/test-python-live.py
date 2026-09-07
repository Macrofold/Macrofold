"""Exercise the Python client against the unpaid local web and worker."""
import json
import os
import pathlib
import time
import httpx
from hosted_agents import Client

origin = os.environ.get('APP_ORIGIN', 'http://localhost:3210')
assert httpx.get(origin + '/health').json()['mode'] == 'local_simulation'
seed = json.loads((pathlib.Path(os.environ.get('DATA_DIR', pathlib.Path(__file__).resolve().parent.parent / '.data')) / 'demo.json').read_text())
with Client(origin, seed['api_key']) as client:
    assert client.request('getIdentity')
    project = client.request('createProject', body={'name': f'Python SDK {time.time_ns()}'})
    ws = client.request('getWorkspace', path={'workspace_id': project['default_workspace_id']})
    content = b'Persisted by the installed Python wheel.\n'
    client.request('writeFile', path={'workspace_id': ws['id']}, query={'path': 'python.txt'}, body=content, headers={'If-Match': ws['revision'], 'Content-Type': 'application/octet-stream'})
    assert client.request('readFile', path={'workspace_id': ws['id']}, query={'path': 'python.txt'}) == content
    run = client.request('createRun', body={'workspace_id': ws['id'], 'harness': 'codex', 'model': 'fixture-model', 'billing_mode': 'managed', 'prompt': 'Verify Python SDK session persistence.'})
    assert list(client.stream(run['run_id']))[-1]['type'] == 'run.succeeded'
    result = client.request('getRunResult', path={'run_id': run['run_id']})
    assert 'Simulation completed' in result['output_text']
    followup = client.request('continueSession', path={'session_id': run['session_id']}, body={'prompt': 'Continue the same saved project.', 'queue_if_busy': True})
    assert list(client.stream(followup['run_id']))[-1]['type'] == 'run.succeeded'
    assert client.request('readFile', path={'workspace_id': ws['id']}, query={'path': 'python.txt'}) == content
print('Python SDK: scoped identity, project/files, live local SSE and persisted session continuation passed. No paid provider call.')
