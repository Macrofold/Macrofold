import { z } from 'zod';
import { boundedBody } from '../../core/src/body';
import { canonical } from '../../core/src/crypto';
import { AppError, assert } from '../../core/src/errors';
import {
  DecisionProviderError,
  type DecisionProtocol,
  type DecisionRequest,
  type ProviderEvidence,
} from '../../core/src/decision';
import type { DeploymentTarget } from '../../core/src/model-deployment-types';
import { emptyUsage } from '../../core/src/model-protocol';
import { independentUsage, nativeSystemOneResponse, prepareSystemOne } from './decision-protocols';
import { readInferenceStream } from './inference-stream';
import { modelEndpointFetch } from './network';
import { requireClientTools } from './model-protocols';
import { extractProviderError, isProviderErrorEnvelope } from './provider-error';

const object = z.record(z.string(), z.unknown());
const identity = z.object({ id: z.string().optional(), model: z.string().optional() });
const completion = identity.extend({
  choices: z
    .array(
      z.object({
        index: z.number().int().nonnegative().optional(),
        message: object,
        finish_reason: z.string().nullable(),
      }),
    )
    .min(1),
});
const structural = new Set([
  'messages',
  'model',
  'stream',
  'stream_options',
  'max_tokens',
  'max_completion_tokens',
  'response_format',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
]);

function capability(allowed: unknown, message: string): asserts allowed {
  assert(allowed, 422, 'unsupported_model_capability', message);
}
function requestObject(value: unknown, field: string) {
  const parsed = object.safeParse(value);
  assert(parsed.success, 400, 'invalid_request', `${field} must be an object.`);
  return parsed.data;
}

/** Preserve native scoring inputs; only the selected model and transport
 * capabilities belong to Macrofold. No chat prompt or context is injected. */
export function prepareDeploymentSystemOne(target: DeploymentTarget, request: DecisionRequest) {
  capability(target.capabilities.protocol === 'systemone', 'This deployment does not serve SystemOne.');
  capability(request.definition.question.kind === 'provider', 'Custom deployments accept native input.');
  capability(!request.stream, 'SystemOne deployments do not support streaming.');
  capability(request.modelParameters === undefined, 'Supply native SystemOne parameters in input.');
  capability(
    request.maxOutputTokens <= target.capabilities.max_output_tokens,
    'The output limit exceeds this deployment’s supported maximum.',
  );
  const body = prepareSystemOne({ ...request, model: target.model_alias });
  // The transport selector is not a native scoring parameter. A caller may
  // explicitly choose false; never forward it as an unsupported model field.
  delete body.stream;
  assert(body.state !== undefined, 400, 'invalid_request', 'Supply native SystemOne state.');
  const questions = requestObject(body.questions, 'questions');
  assert(Object.keys(questions).length > 0, 400, 'invalid_request', 'Supply at least one named question.');
  for (const key of Object.keys(body))
    capability(
      ['model', 'state', 'questions', 'stream'].includes(key) ||
        target.capabilities.accepted_parameters.includes(key),
      `This deployment does not support the ${key} parameter.`,
    );
  return body;
}

/** Validate the advertised recipe, without implementing the engine's tokenizer
 * or structured decoder. Native fields stay intact after these boundary checks. */
export function prepareDeploymentChat(target: DeploymentTarget, request: DecisionRequest) {
  const caps = target.capabilities;
  capability(
    caps.protocol === 'openai_chat' && caps.chat_completions,
    'This deployment does not serve OpenAI chat completions.',
  );
  capability(request.definition.question.kind === 'provider', 'Custom deployments accept native chat input.');
  capability(
    request.modelParameters === undefined,
    'Supply native chat parameters in input for a custom deployment.',
  );
  const body = requestObject(request.input, 'input');
  assert(
    body.model === undefined || body.model === target.model_alias,
    400,
    'invalid_deployment_binding',
    'input.model must agree with the deployment model.',
  );
  assert(
    body.stream === undefined || body.stream === (request.stream ?? false),
    400,
    'invalid_request',
    'input.stream must agree with top-level stream.',
  );
  capability(
    body.background === undefined && body.models === undefined && body.provider === undefined,
    'Background execution and model fallback are unsupported.',
  );
  capability(!request.stream || caps.streaming, 'This deployment does not support streaming.');
  capability(
    request.maxOutputTokens <= caps.max_output_tokens,
    'The output limit exceeds this deployment’s supported maximum.',
  );
  for (const key of Object.keys(body))
    capability(
      structural.has(key) || caps.accepted_parameters.includes(key),
      `This deployment does not support the ${key} parameter.`,
    );
  if (body.chat_template_kwargs !== undefined) {
    const kwargs = requestObject(body.chat_template_kwargs, 'chat_template_kwargs');
    // Native thinking control must not open a per-request source/template override.
    // See docs/projects/hugging-face-model-deployments-tech-design.md#customer-setup-without-image-configuration.
    capability(
      Object.entries(kwargs).every(([key, value]) => key === 'enable_thinking' && typeof value === 'boolean'),
      'chat_template_kwargs supports only the boolean enable_thinking option.',
    );
  }
  capability(Array.isArray(body.messages) && body.messages.length > 0, 'Supply native chat messages.');
  for (const item of body.messages) {
    const message = requestObject(item, 'Each chat message');
    capability(typeof message.role === 'string', 'Chat messages require a role.');
    if (message.content !== undefined && message.content !== null && typeof message.content !== 'string') {
      capability(Array.isArray(message.content), 'This deployment accepts text messages only.');
      for (const piece of message.content) {
        const part = requestObject(piece, 'Each message content part');
        capability(
          part.type === 'text' && typeof part.text === 'string',
          'This deployment accepts text messages only.',
        );
      }
    }
  }
  if (body.tools !== undefined || body.tool_choice !== undefined || body.parallel_tool_calls !== undefined)
    capability(caps.tools, 'This deployment does not support tool formatting.');
  requireClientTools(body, 'deployment', 'v1/chat/completions');
  const copies = body.n ?? 1;
  capability(
    typeof copies === 'number' && Number.isSafeInteger(copies) && copies > 0,
    'n must be a positive integer.',
  );
  const output = Math.floor(request.maxOutputTokens / copies);
  capability(output > 0, 'The aggregate output limit is too small for n.');
  for (const key of ['max_tokens', 'max_completion_tokens'])
    capability(
      body[key] === undefined || body[key] === output,
      'Native max-token fields must agree with the aggregate output limit.',
    );
  if (body.max_completion_tokens === undefined) body.max_tokens = output;
  const format = body.response_format;
  if (format !== undefined) {
    const parsed = requestObject(format, 'response_format');
    capability(
      ['text', 'json_object', 'json_schema'].includes(String(parsed.type)),
      'This response format is unsupported.',
    );
    if (parsed.type === 'json_object')
      capability(caps.json_object, 'This deployment does not support JSON-object output.');
    if (parsed.type === 'json_schema') {
      capability(caps.json_schema, 'This deployment does not support JSON-schema output.');
      const definition = requestObject(parsed.json_schema, 'response_format.json_schema');
      validateSchemaKeywords(definition.schema, caps.schema_keywords);
    }
  }
  body.model = target.model_alias;
  if (request.stream) {
    body.stream = true;
    if (caps.stream_usage)
      body.stream_options = {
        ...requestObject(body.stream_options ?? {}, 'stream_options'),
        include_usage: true,
      };
    else
      capability(body.stream_options === undefined, 'This deployment does not support stream usage options.');
  } else capability(body.stream_options === undefined, 'Stream options require streaming.');
  return body;
}

function validateSchemaKeywords(schema: unknown, keywords: string[]) {
  const pending: unknown[] = [schema];
  while (pending.length) {
    const node = pending.pop();
    if (typeof node === 'boolean') continue;
    for (const [key, child] of Object.entries(requestObject(node, 'Each JSON schema'))) {
      capability(keywords.includes(key), `This deployment does not support the ${key} schema keyword.`);
      if (['properties', '$defs', 'definitions', 'patternProperties', 'dependentSchemas'].includes(key))
        pending.push(...Object.values(requestObject(child, 'Schema properties and definitions')));
      else if (['allOf', 'anyOf', 'oneOf', 'prefixItems'].includes(key)) {
        capability(Array.isArray(child), 'A schema composition must be an array.');
        pending.push(...child);
      } else if (
        [
          'items',
          'contains',
          'additionalProperties',
          'propertyNames',
          'not',
          'if',
          'then',
          'else',
          'unevaluatedProperties',
          'unevaluatedItems',
        ].includes(key)
      )
        pending.push(child);
    }
  }
}

/** Use the accepted target and exact current credentials. No source, health,
 * inventory, pricing or serving-revision lookup belongs in this transport. */
export function deploymentProtocol(
  target: DeploymentTarget,
  // deploymentCredentialTx supplies only encrypted connection/resource credentials;
  // transport metadata (content type, deadline) is added separately below.
  headers: Record<string, string> = {},
  timeoutSeconds = 240,
  transport: typeof modelEndpointFetch = modelEndpointFetch,
): DecisionProtocol {
  const systemOne = target.capabilities.protocol === 'systemone';
  return {
    version: systemOne ? 'deployment-systemone/1' : 'deployment-openai-chat/1',
    kinds: ['provider'],
    capabilities: {
      structuredOutput: !systemOne && target.capabilities.json_schema,
      brokeredTools: false,
      streaming: !systemOne && target.capabilities.streaming,
      immutableModelRevision: true,
    },
    prepare: (request) =>
      systemOne ? prepareDeploymentSystemOne(target, request) : prepareDeploymentChat(target, request),
    async invoke(body, _secret, signal, observeResponse, _nativeResponse, output, preparedJSON) {
      let evidence: ProviderEvidence = {
        response: null,
        httpStatus: 0,
        requestId: null,
        modelRevision: null,
        usage: emptyUsage(),
        complete: false,
        completedAt: null,
        completedAtMonotonicMs: null,
      };
      try {
        const endpoint = new URL(target.endpoint_url);
        endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/${systemOne ? 'systemone' : 'chat/completions'}`;
        const upstream = await transport(
          endpoint,
          {
            method: 'POST',
            redirect: 'error',
            signal,
            headers: {
              ...headers,
              'content-type': 'application/json',
              'x-macrofold-deadline-ms': String(Date.now() + timeoutSeconds * 1000),
            },
            body: preparedJSON ?? canonical(body),
          },
          { timeoutMs: timeoutSeconds * 1000, maximumResponseBytes: 8 * 1024 * 1024 },
        );
        evidence.httpStatus = upstream.status;
        evidence.requestId =
          upstream.headers.get('x-request-id') ?? upstream.headers.get('x-typesafe-request-id');
        let raw: unknown;
        let incomplete: string | undefined;
        if (upstream.ok && body.stream === true) {
          const streamed = await readInferenceStream(upstream, true, output, Object.values(headers));
          raw = streamed.raw;
          incomplete = streamed.incomplete;
          evidence.completedAt = streamed.completedAt ?? null;
          evidence.completedAtMonotonicMs = streamed.completedAtMonotonicMs ?? null;
          evidence.complete = !incomplete;
          evidence.providerError = streamed.providerError;
        } else {
          let text: string;
          try {
            text = (await boundedBody(upstream.body, upstream.ok ? 512 * 1024 : 16 * 1024)).toString('utf8');
          } catch (error) {
            // A bounded/unreadable body must not hide an already received rejection.
            if (!upstream.ok)
              throw new AppError(
                502,
                'decision_provider_failed',
                'The deployment rejected the inference request.',
              );
            throw error;
          }
          evidence.complete = true;
          evidence.completedAt = new Date().toISOString();
          evidence.completedAtMonotonicMs = performance.now();
          evidence.response = text;
          let plainText = false;
          try {
            raw = JSON.parse(text);
            plainText = typeof raw === 'string';
          } catch (error) {
            if (upstream.ok) throw error;
            raw = text;
            plainText =
              !upstream.headers.get('content-type') ||
              Boolean(upstream.headers.get('content-type')?.startsWith('text/plain'));
          }
          evidence.providerError = extractProviderError(
            raw,
            upstream.status,
            Object.values(headers),
            plainText,
          );
        }
        evidence.response = raw;
        evidence.usage = independentUsage(raw, !systemOne, 'deployment');
        assert(
          upstream.ok && !isProviderErrorEnvelope(raw),
          502,
          'decision_provider_failed',
          'The deployment rejected the inference request.',
        );
        const parsedIdentity = identity.safeParse(raw);
        if (parsedIdentity.success) {
          evidence.requestId = parsedIdentity.data.id ?? evidence.requestId;
          evidence.modelRevision = parsedIdentity.data.model ?? null;
          assert(
            !parsedIdentity.data.model || parsedIdentity.data.model === target.model_alias,
            502,
            'model_not_authorized',
            'The endpoint returned a different model.',
          );
        }
        if (systemOne) nativeSystemOneResponse(raw, evidence.usage);
        else if (!incomplete) {
          const parsed = completion.parse(raw);
          assert(
            parsed.choices.every((choice) => choice.finish_reason !== null),
            502,
            'incomplete_provider_response',
            'The endpoint returned an unfinished completion.',
          );
        }
        try {
          observeResponse?.(raw);
        } catch {
          /* Diagnostics do not own inference. */
        }
        return {
          value: raw,
          refused: false,
          usage: { ...evidence.usage, complete: evidence.usage.complete && !incomplete },
          requestId: evidence.requestId,
          modelRevision: target.deployment_revision_id,
          httpStatus: upstream.status,
          ...(evidence.providerError ? { providerError: evidence.providerError } : {}),
          ...(incomplete ? { incomplete } : {}),
          ...(evidence.completedAt ? { completedAt: evidence.completedAt } : {}),
          ...(evidence.completedAtMonotonicMs !== null
            ? { completedAtMonotonicMs: evidence.completedAtMonotonicMs }
            : {}),
        };
      } catch (error) {
        throw new DecisionProviderError(
          error instanceof AppError
            ? error.code
            : signal.aborted
              ? 'provider_interrupted'
              : 'invalid_provider_response',
          error instanceof AppError ? error.message : 'The deployment response was interrupted or malformed.',
          evidence,
        );
      }
    },
  };
}
