import json
import os
import httpx
import pytest
from macrofold import Client, RequestOptions, ApiError, TransportError

ID = '01900000-0000-7000-8000-000000000001'
URLS = {key: f'https://example.test/{key}' for key in ('status','result','events','stream','cancel')}
RECOVERY = {'run_id':ID,'session_id':None,'worktree_id':None,'status':'running','recovery_reason':'finalization_pending','urls':URLS}
BUSY = {'error':{'code':'inference_service_unavailable','message':'Busy','retryable':True,'request_id':ID,'details':{'reason':'local_capacity'}}}
BODY = {'input':{},'model_binding':{'provider':'openrouter','model':'fixture','billing_mode':'managed'},'limits':{'max_cost_micro_usd':'1000','max_output_tokens':10,'timeout_seconds':10}}

@pytest.mark.skipif(not os.getenv('MACROFOLD_FIXTURE_ORIGIN'), reason='Run pnpm test:sdks for isolated application acceptance')
def test_application_immediate_json_and_sse():
    with open(os.environ['MACROFOLD_FIXTURE_INFERENCE_INPUT']) as source:
        body = json.load(source)
    def receipt(result):
        assert result.final and result.persistence_status == 'not_required'
        value = result.inference
        assert value and value.outcome == 'value'
        assert value.usage.input_tokens == '100' and value.usage.output_tokens == '10'
        assert value.usage.completeness == 'complete'
        assert value.billing.billing_mode == 'managed' and not value.billing.provisional
        assert int(value.billing.charged_micro_usd) > 0
    with Client(base_url=os.environ['MACROFOLD_FIXTURE_ORIGIN'], api_key=os.environ['MACROFOLD_FIXTURE_KEY']) as client:
        deployment_id = os.environ['MACROFOLD_FIXTURE_DEPLOYMENT']
        deployment = client.model_deployments.get(deployment_id)
        assert deployment.state == 'stopped' and deployment.serving_revision_id is None
        assert deployment.infrastructure_cost.estimated_micro_usd is None
        assert deployment.cost_policy.request_charge_micro_usd == '0'
        selected = client.model_deployments.get_revision(deployment_id, os.environ['MACROFOLD_FIXTURE_DEPLOYMENT_REVISION'])
        assert selected.source.actual_instance.kind == 'external'
        assert selected.hosting.actual_instance.kind == 'external_openai'
        assert len(client.model_deployments.list_grants(deployment_id).data) == 1
        with open(os.environ['MACROFOLD_FIXTURE_DEPLOYMENT_INFERENCE_INPUT']) as source:
            stopped_body = json.load(source)
        with pytest.raises(ApiError) as stopped:
            client.inferences.create(**stopped_body)
        assert stopped.value.status == 409 and stopped.value.code == 'deployment_not_ready'
        ready_id = os.environ['MACROFOLD_FIXTURE_READY_DEPLOYMENT_PYTHON']
        ready_revision = os.environ['MACROFOLD_FIXTURE_READY_DEPLOYMENT_REVISION_PYTHON']
        with open(os.environ['MACROFOLD_FIXTURE_READY_DEPLOYMENT_INPUT_PYTHON']) as source:
            ready_body = json.load(source)
        def deployment_receipt(result, native_extra):
            assert result.final and result.inference and result.inference.outcome == 'value'
            value = result.inference
            assert str(value.deployment.deployment_id) == ready_id
            assert str(value.deployment.deployment_revision_id) == ready_revision
            assert value.cost_attribution.basis == 'deployment' and not value.cost_attribution.infrastructure_cost_included
            assert value.billing.billing_mode == 'byok'
            assert value.billing.charged_micro_usd == value.billing.budget_cost_micro_usd == value.billing.reported_micro_usd == '0'
            assert value.billing.provider_cost_micro_usd is value.billing.provider_reported_cost_usd is value.billing.upstream_inference_cost_usd is None
            assert value.usage.input_tokens == '11' and value.usage.output_tokens == '4'
            assert value.value['choices'][0]['message']['content'] == 'Hello from the deployment SDK fixture.'
            if native_extra:
                assert value.value['provider_native_extra'] == {'retained': True}
                assert value.value['choices'][0]['message']['annotations'] == []
        ready_options = RequestOptions(idempotency_key='python-deployment-'+os.urandom(8).hex())
        ready_response = client.inferences.create(**ready_body, request_options=ready_options)
        ready_result = client.runs.wait(ready_response.run_id) if ready_response.status == 'running' else ready_response.result
        deployment_receipt(ready_result, True)
        deployed_text, deployed_terminal = '', False
        for event in client.inferences.stream(ready_body):
            if event.type == 'output.delta': deployed_text += event.data.text
            if event.type == 'run.succeeded':
                deployment_receipt(event.data.result, False)
                deployed_terminal = True
        assert deployed_text == 'Hello from the deployment SDK fixture.' and deployed_terminal
        client.model_deployments.set_service(ready_id, deployment_revision_id=ready_revision, desired_state='stopped', policy={'max_concurrent_requests': 2, 'stop_at': None})
        recovered = client.inferences.create(**ready_body, request_options=ready_options)
        assert recovered.run_id == ready_response.run_id
        deployment_receipt(recovered.result, True)
        options = RequestOptions(idempotency_key='python-immediate-'+os.urandom(8).hex())
        response = client.inferences.create(**body, request_options=options)
        assert response.status == 'succeeded' and response.result
        receipt(response.result)
        assert client.inferences.create(**body, request_options=options).run_id == response.run_id
        text, terminal = '', False
        for event in client.inferences.stream(body):
            if event.type == 'output.delta': text += event.data.text
            if event.type == 'run.succeeded':
                receipt(event.data.result)
                terminal = True
        assert text == 'Hello from the SDK fixture.' and terminal
        rejected_body = {**body, 'input': {'messages': [{'role': 'user', 'content': 'sdk-provider-error'}]}}
        def rejected_receipt(result):
            assert result.execution_outcome == 'failure' and result.inference.reason_code
            error = result.inference.provider_error
            assert error.http_status == 402
            assert error.message == 'SDK provider spending limit reached.'
            assert error.code == 'insufficient_quota' and error.truncated is None
        rejected = client.inferences.create(**rejected_body)
        assert rejected.status == 'failed'
        rejected_receipt(rejected.result)
        failed = False
        for event in client.inferences.stream(rejected_body):
            if event.type == 'run.failed':
                rejected_receipt(event.data.result)
                failed = True
        assert failed

@pytest.mark.parametrize('retries',[0,1])
def test_immediate_inference_retry_is_explicit_and_preserves_identity(retries):
    keys=[]
    def respond(request):
        keys.append(request.headers['idempotency-key'])
        return httpx.Response(503,json=BUSY,headers={} if retries else {'X-Run-Id':ID}) if len(keys)==1 else httpx.Response(202,json=RECOVERY)
    client=Client(api_key='fixture',transport=httpx.MockTransport(respond))
    try:
        if retries:
            receipt=client.inferences.create(**BODY,request_options=RequestOptions(idempotency_key='saved',inference_retries=retries))
            assert receipt.status=='running' and receipt.recovery_reason=='finalization_pending'
        else:
            with pytest.raises(ApiError) as failure:
                client.inferences.create(**BODY,request_options=RequestOptions(idempotency_key='saved'))
            assert failure.value.idempotency_key=='saved' and failure.value.run_id==ID
        assert keys==['saved']*(retries+1)
    finally:client.close()

def test_immediate_inference_does_not_retry_ambiguous_network_failure():
    keys=[]
    def respond(request):
        keys.append(request.headers['idempotency-key'])
        raise httpx.ReadError('Interrupted',request=request)
    client=Client(api_key='fixture',transport=httpx.MockTransport(respond))
    try:
        with pytest.raises(TransportError) as failure:
            client.inferences.create(**BODY,request_options=RequestOptions(idempotency_key='saved',inference_retries=2))
        assert failure.value.idempotency_key=='saved' and isinstance(failure.value.__cause__,httpx.ReadError)
        assert keys==['saved']
    finally:client.close()

def test_immediate_inference_does_not_shorten_retry_after():
    calls=[]
    client=Client(api_key='fixture',transport=httpx.MockTransport(lambda request:(calls.append(request),httpx.Response(503,json=BUSY,headers={'Retry-After':'3600'}))[1]))
    try:
        with pytest.raises(ApiError):client.inferences.create(**BODY,request_options=RequestOptions(inference_retries=2,timeout=1))
        assert len(calls)==1
    finally:client.close()

def test_immediate_inference_stream_eof_preserves_accepted_receipt():
    event={'schema_version':1,'run_id':ID,'type':'run.accepted','occurred_at':'2026-10-16T00:00:00Z','data':{**{key:value for key,value in RECOVERY.items() if key!='recovery_reason'},'delivery':'live'}}
    client=Client(api_key='fixture',transport=httpx.MockTransport(lambda request:httpx.Response(200,headers={'Content-Type':'text/event-stream','X-Request-Id':ID},content='data: '+json.dumps(event)+'\n\n')))
    try:
        stream=client.inferences.stream(BODY,request_options=RequestOptions(idempotency_key='saved'))
        assert next(stream).type=='run.accepted'
        with pytest.raises(TransportError) as failure:next(stream)
        assert failure.value.idempotency_key=='saved' and failure.value.run_id==ID and failure.value.urls==URLS and failure.value.request_id==ID
    finally:client.close()
