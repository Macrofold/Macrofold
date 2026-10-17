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
