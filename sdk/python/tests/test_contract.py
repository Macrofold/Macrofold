"""Every documented Python resource traverses HTTPX with an OpenAPI-shaped response.

These are adapter contract checks, not simulations of endpoint business policy. Real
authorization, accounting, and persisted execution are covered by the local journey.
"""
import json
import pathlib
import re
from typing import get_type_hints
from urllib.parse import quote

import httpx
import pytest
from macrofold import Client, RequestOptions

ROOT = pathlib.Path(__file__).resolve().parents[3]
SPEC = json.loads((ROOT / 'docs/api/openapi.json').read_text())
ID = '00000000-0000-4000-8000-000000000001'


def resolve(schema):
    if '$ref' not in schema:
        return schema
    value = SPEC
    for part in schema['$ref'].removeprefix('#/').split('/'):
        value = value[part]
    return value


def example(schema):
    """Minimal synthetic values from the authoritative response schema, without SDK internals."""
    schema = resolve(schema)
    if 'const' in schema:
        return schema['const']
    if 'enum' in schema:
        return schema['enum'][0]
    if 'oneOf' in schema and not schema.get('properties'):
        return example(schema['oneOf'][0])
    kind = schema.get('type', 'object')
    if isinstance(kind, list):
        kind = next((value for value in kind if value != 'null'), 'null')
    if kind == 'object':
        return {key: example(value) for key, value in schema.get('properties', {}).items() if key in schema.get('required', [])}
    if kind == 'array':
        return [example(schema['items']) for _ in range(schema.get('minItems', 0))]
    if kind == 'null':
        return None
    if kind == 'boolean':
        return False
    if kind in ('integer', 'number'):
        return schema.get('minimum', 1)
    if kind == 'string':
        if schema.get('format') == 'uuid':
            return ID
        if schema.get('format') == 'date-time':
            return '2026-09-07T00:00:00Z'
        if schema.get('format') == 'date':
            return '2026-09-07'
        if schema.get('format') in ('uri', 'url'):
            return 'https://fixture.invalid'
        if 'pattern' in schema and '0-9' in schema['pattern']:
            return '1'
        return 'fixture' * max(1, (schema.get('minLength', 0) + 6) // 7)
    raise AssertionError(f'Add a reviewed fixture for {schema}')


def snake(value):
    return re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', value).replace('-', '_').lower()


OPERATIONS = [(path, verb, op) for path, item in SPEC['paths'].items() for verb, op in item.items() if isinstance(op, dict) and op.get('operationId') != 'streamRun' and 'operationId' in op]


@pytest.mark.parametrize('path,verb,operation', OPERATIONS, ids=[op['operationId'] for _, _, op in OPERATIONS])
def test_resource_http_contract(path, verb, operation):
    group = operation['tags'][0]
    plural = ''.join(part[0].upper() + part[1:] for part in re.split(r'[-_ ]', group))
    singular = re.sub(r'ies$', 'y', plural)
    singular = singular.removesuffix('s')
    name = operation['operationId'].replace(plural, '').replace(singular, '')
    name = {'getIdentity': 'get', 'continueSession': 'continue_run', 'exportCheckpoint': 'export_archive'}.get(operation['operationId'], snake(name))
    kwargs, query, headers = {}, {}, {}
    for parameter in operation.get('parameters', []):
        parameter = resolve(parameter)
        wire = parameter['name']
        if wire in ('X-Organization-Id', 'Idempotency-Key', 'Last-Event-ID'):
            continue
        value = example(parameter.get('schema', {}))
        key = snake(wire)
        kwargs[key + '_' if key == 'from' else key] = value
        if parameter['in'] == 'path':
            path = path.replace('{' + wire + '}', quote(str(value), safe=''))
        elif parameter['in'] == 'query':
            query[wire] = str(value).lower() if isinstance(value, bool) else str(value)
        else:
            headers[wire] = value
    body = None
    if operation.get('requestBody'):
        request = resolve(operation['requestBody'])
        if 'application/octet-stream' in request['content']:
            body = b'\x00fixture\xff'
            kwargs['content'] = body
        else:
            schema = resolve(request['content']['application/json']['schema'])
            body = {key: example(value) for key, value in schema.get('properties', {}).items()}
            kwargs.update({snake(key): value for key, value in body.items()})
    status, response = next((int(code), resolve(value)) for code, value in operation['responses'].items() if code.startswith('2'))
    content = response.get('content', {})
    output = example(content['application/json']['schema']) if 'application/json' in content else b'\x00download\xff' if content else None
    calls = []

    def handler(request):
        calls.append(request)
        assert request.method == verb.upper() and request.url.path == path
        assert dict(request.url.params) == query
        assert request.headers['Authorization'] == 'Bearer contract-fixture'
        for key, value in headers.items():
            assert request.headers[key] == value
        if verb.upper() not in ('GET', 'HEAD'):
            assert request.headers['Idempotency-Key'] == 'contract-action'
        if isinstance(body, bytes):
            assert request.content == body and request.headers['Content-Type'] == 'application/octet-stream'
        elif body is not None:
            assert json.loads(request.content) == body
        else:
            assert request.content == b''
        return httpx.Response(status, content=output) if output is None or isinstance(output, bytes) else httpx.Response(status, json=output)

    client = Client(api_key='contract-fixture', transport=httpx.MockTransport(handler))
    try:
        method = getattr(getattr(client, snake(group)), name)
        result = method(**kwargs, request_options=RequestOptions(idempotency_key='contract-action'))
        if output is None or isinstance(output, bytes):
            assert result == output
        else:
            assert isinstance(result, get_type_hints(method)['return'])
            # Required scalar fields retain their values through the generated decoder.
            decoded = result.model_dump(mode='json', by_alias=True)
            for key, value in output.items():
                if not isinstance(value, (dict, list)):
                    assert decoded[key] == value
        assert len(calls) == 1
    finally:
        client.close()
