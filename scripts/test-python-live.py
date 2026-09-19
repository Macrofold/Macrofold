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
def assert_succeeded(run_id):
    final = list(client.runs.stream(run_id))[-1]
    assert final.type == 'run.succeeded', (final.type, (final.data or {}).get('code'))

try:
    assert client.me.get()
    workspace = client.workspaces.create(name=f'Python SDK {time.time_ns()}')
    ws = client.worktrees.get(workspace.default_worktree_id)
    content = b'Persisted by the installed Python wheel.\n'
    client.worktrees.write_file(ws.id, path='python.txt', if_match=ws.revision, content=content)
    assert client.worktrees.read_file(ws.id, path='python.txt') == content
    run = client.runs.create(worktree_id=ws.id, harness='codex', model='fixture-model', billing_mode='managed', prompt='Verify Python SDK session persistence.')
    assert_succeeded(run.run_id)
    result = client.runs.get_result(run.run_id)
    assert 'Simulation completed' in result.output_text
    followup = client.sessions.continue_run(run.session_id, prompt='Continue the same saved workspace.', queue_if_busy=True)
    assert_succeeded(followup.run_id)
    assert client.worktrees.read_file(ws.id, path='python.txt') == content
finally:
    client.close()
print('Python SDK: scoped identity, workspace/files, local SSE and persisted session continuation passed. No paid provider call.')
