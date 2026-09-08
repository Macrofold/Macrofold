"""Exercise Python resource methods against the unpaid local web and worker."""
import json
import os
import pathlib
import time
import httpx
from macrofold import Client

origin = os.environ.get('APP_ORIGIN', 'http://localhost:3210')
assert httpx.get(origin + '/health').json()['mode'] == 'local_simulation'
seed = json.loads((pathlib.Path(os.environ.get('DATA_DIR', pathlib.Path(__file__).resolve().parent.parent / '.data')) / 'demo.json').read_text())
client = Client(base_url=origin, api_key=seed['api_key'])
try:
    assert client.me.get()
    project = client.projects.create(name=f'Python SDK {time.time_ns()}')
    ws = client.workspaces.get(project.default_workspace_id)
    content = b'Persisted by the installed Python wheel.\n'
    client.workspaces.write_file(ws.id, path='python.txt', if_match=ws.revision, content=content)
    assert client.workspaces.read_file(ws.id, path='python.txt') == content
    run = client.runs.create(workspace_id=ws.id, harness='codex', model='fixture-model', billing_mode='managed', prompt='Verify Python SDK session persistence.')
    assert list(client.runs.stream(run.run_id))[-1].type == 'run.succeeded'
    result = client.runs.get_result(run.run_id)
    assert 'Simulation completed' in result.output_text
    followup = client.sessions.continue_run(run.session_id, prompt='Continue the same saved project.', queue_if_busy=True)
    assert list(client.runs.stream(followup.run_id))[-1].type == 'run.succeeded'
    assert client.workspaces.read_file(ws.id, path='python.txt') == content
finally:
    client.close()
print('Python SDK: scoped identity, project/files, local SSE and persisted session continuation passed. No paid provider call.')
