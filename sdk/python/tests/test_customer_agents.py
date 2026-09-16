import os
import pytest
from macrofold import Macrofold, ApiError


@pytest.mark.skipif(not os.getenv('MACROFOLD_FIXTURE_CUSTOMER_AGENT'), reason='Run pnpm test:sdks for isolated application acceptance')
def test_customer_path_stream_files_and_ownership():
    client = Macrofold(base_url=os.environ['MACROFOLD_FIXTURE_ORIGIN'], api_key=os.environ['MACROFOLD_FIXTURE_KEY'])
    customer, binding, run = 'customer / 日本語', os.environ['MACROFOLD_FIXTURE_CUSTOMER_AGENT'], os.environ['MACROFOLD_FIXTURE_CUSTOMER_RUN']
    try:
        assert client.customer_agents.get(customer, binding).integration_path == 'customer-agents'
        assert list(client.customer_agents.stream_run(customer, binding, run))[-1].type == 'run.succeeded'
        assert b'optional customer-agent path' in client.customer_agents.read_file(customer, binding, path=f'notes/run-{run}.md')
        with pytest.raises(ApiError) as error:
            client.customer_agents.get_run('wrong customer', binding, run)
        assert error.value.status == 404
    finally:
        client.close()
