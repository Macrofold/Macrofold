'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { Box, Plus } from 'lucide-react';
import { request, useData, useDataPages } from '../lib/dashboard-data';
import { money, type Schema } from '../lib/client';
import { Badge, Button, Empty, ErrorState, Field, Loading, Modal, More, PageHeading, Select } from './ui';
import { CopyButton } from './copy-button';
import {
  ModelHostingConnectionForm,
  hostingConnectionLabels,
  type HostingConnectionKind,
} from './model-hosting-connection';

type Deployment = Schema['ModelDeployment'];
type Revision = Schema['ModelDeploymentRevision'];
type Inspection = Schema['ModelDeploymentInspection'];
type Policy = Schema['ModelDeploymentServiceInput']['policy'];
type ReadinessProbe = Schema['ModelDeploymentProbe'];
type RuntimeProfile = Extract<Schema['ModelDeploymentRuntime'], { profile_id: string }>['profile_id'];
type ModelTask = Schema['ModelDeploymentInspectionInput']['task'];
const runtimeProfiles: Record<ModelTask, { id: RuntimeProfile; label: string }> = {
  decision: { id: 'kev-systemone-v1', label: 'Native Kev · SystemOne decisions' },
  text_generation: { id: 'vllm-0.32.0-text', label: 'vLLM · chat generation' },
};
const dtypes = ['auto', 'half', 'bfloat16', 'float'] as const;
const quantizations = ['awq', 'gptq', 'fp8', 'compressed-tensors'] as const;
const toolParsers = ['hermes', 'llama3_json', 'mistral'] as const;
const reasoningParsers = ['deepseek_r1', 'qwen3'] as const;
const readinessStages: Record<ReadinessProbe['stage'], string> = {
  worker: 'Worker availability',
  transport: 'Endpoint connection',
  authentication: 'Endpoint authentication',
  worker_identity: 'Worker identity',
  model_identity: 'Model identity',
  response: 'Endpoint response',
};
const failureMessage = (failure: unknown) =>
  failure instanceof Error
    ? failure.message
    : 'The operation could not be confirmed. Refresh the deployment before trying again.';
const values = (text: string) =>
  text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
const usd = (value: string) => {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value))
    throw new Error('Enter a USD amount with at most six decimal places.');
  const [whole, fraction = ''] = value.split('.');
  return (BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'))).toString();
};
const dollars = (value: string) =>
  `${BigInt(value) / 1000000n}.${(BigInt(value) % 1000000n).toString().padStart(6, '0')}`;

async function refreshDeployments(client: ReturnType<typeof useQueryClient>) {
  await client.invalidateQueries({
    predicate: (query) =>
      typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/v1/model-deployments'),
  });
}

function ConnectionPicker({
  kind,
  value,
  onChange,
  optional = false,
}: {
  kind: HostingConnectionKind;
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
}) {
  const identity = useData({ operation: 'getIdentity' });
  const connections = useDataPages({ operation: 'listConnections', params: { query: { limit: 100 } } });
  const [create, setCreate] = useState(false);
  const label = hostingConnectionLabels[kind];
  const owned =
    connections.data?.data.filter(
      (item) => item.kind === kind && item.owner_subject_id === identity.data?.user_id,
    ) ?? [];
  return (
    <div>
      <Field
        label={label}
        hint="Only your own connections can authorize this deployment. Credentials stay in encrypted Connections."
      >
        <Select
          value={value || '__none'}
          onValueChange={(next) => onChange(next === '__none' ? '' : next)}
          disabled={connections.isPending || !!connections.error || !identity.data}
          options={[
            { value: '__none', label: optional ? 'Public source · no credential' : 'Choose a connection' },
            ...owned.map((item) => ({ value: item.id, label: `${item.name} · ${item.status}` })),
          ]}
        />
      </Field>
      {connections.isPending && <Loading label="Loading your connections…" />}
      {connections.error && <ErrorState error={connections.error} retry={() => void connections.refetch()} />}
      {identity.error && <ErrorState error={identity.error} retry={() => void identity.refetch()} />}
      <More query={connections} label="Load more connections" />
      {value && (
        <p className="form-hint">
          <Link href="/connections">Manage connection or rotate its token</Link>. Keep the same authorized
          provider account; changing accounts requires a new connection.
        </p>
      )}
      {create ? (
        <div className="panel">
          <ModelHostingConnectionForm
            kind={kind}
            onCreated={(connection) => {
              setCreate(false);
              onChange(connection.id);
            }}
            onCancel={() => setCreate(false)}
          />
        </div>
      ) : (
        <Button type="button" variant="ghost" onClick={() => setCreate(true)}>
          Add {label.toLowerCase()}
        </Button>
      )}
    </div>
  );
}

function DeploymentForm({
  deploymentId,
  initial,
  onSaved,
}: {
  deploymentId?: string;
  initial?: Revision;
  onSaved: (id: string) => void;
}) {
  const initialHf = initial?.source.kind === 'hugging_face' ? initial.source : undefined;
  const initialManaged = initial?.hosting.kind === 'runpod_serverless' ? initial.hosting : undefined;
  const initialExternal =
    initial && 'endpoint_connection_id' in initial.hosting ? initial.hosting : undefined;
  const initialParameters =
    initial?.runtime && 'profile_id' in initial.runtime ? initial.runtime.parameters : undefined;
  const initialCapabilities = initial?.source.kind === 'external' ? initial.source.capabilities : undefined;
  const [kind, setKind] = useState(initialExternal ? 'external' : 'managed');
  const [protocol, setProtocol] = useState<Schema['ModelDeploymentCapabilities']['protocol']>(
    initialCapabilities?.protocol ?? 'openai_chat',
  );
  const [name, setName] = useState(''),
    [repository, setRepository] = useState(initialHf?.repository ?? ''),
    [revision, setRevision] = useState(initialHf?.revision ?? '');
  const [sourceConnection, setSourceConnection] = useState(initialHf?.source_connection_id ?? ''),
    [computeConnection, setComputeConnection] = useState(initialManaged?.compute_connection_id ?? ''),
    [endpoint, setEndpoint] = useState(initialExternal?.endpoint_connection_id ?? '');
  const [task, setTask] = useState<ModelTask>(
    initial?.runtime && 'profile_id' in initial.runtime
      ? initial.runtime.profile_id === 'kev-systemone-v1'
        ? 'decision'
        : 'text_generation'
      : 'decision',
  );
  const native = kind === 'managed' && task === 'decision';
  const [profile, setProfile] = useState<RuntimeProfile | ''>(
    initial?.runtime && 'profile_id' in initial.runtime ? initial.runtime.profile_id : '',
  );
  const [context, setContext] = useState(
      String(initialParameters?.context_window_tokens ?? initialCapabilities?.context_window_tokens ?? 8192),
    ),
    [output, setOutput] = useState(
      String(
        initialParameters?.max_output_tokens ??
          initialCapabilities?.max_output_tokens ??
          (native ? 1024 : 2048),
      ),
    ),
    [concurrency, setConcurrency] = useState(
      String(initialParameters?.max_concurrent_requests ?? initialCapabilities?.max_concurrent_requests ?? 1),
    );
  const [dtype, setDtype] = useState<NonNullable<typeof initialParameters>['dtype']>(
      initialParameters?.dtype ?? (native ? 'bfloat16' : 'auto'),
    ),
    [quantization, setQuantization] = useState<NonNullable<typeof initialParameters>['quantization']>(
      initialParameters?.quantization,
    ),
    [parallel, setParallel] = useState(String(initialParameters?.tensor_parallel_size ?? 1));
  const [toolParser, setToolParser] = useState<NonNullable<typeof initialParameters>['tool_call_parser']>(
      initialParameters?.tool_call_parser,
    ),
    [reasoningParser, setReasoningParser] = useState<
      NonNullable<typeof initialParameters>['reasoning_parser']
    >(initialParameters?.reasoning_parser),
    [gpuMemory, setGpuMemory] = useState(String(initialParameters?.gpu_memory_utilization ?? 0.9));
  const [gpuPools, setGpuPools] = useState(initialManaged?.placement.gpu_pool_ids.join(', ') ?? ''),
    [regions, setRegions] = useState(initialManaged?.placement.region_ids.join(', ') ?? ''),
    [gpuCount, setGpuCount] = useState(String(initialManaged?.placement.gpu_count ?? 1));
  const [weightFiles, setWeightFiles] = useState(initialHf?.weight_files?.join(', ') ?? ''),
    [tokenizer, setTokenizer] = useState(initialHf?.tokenizer?.repository ?? ''),
    [tokenizerRevision, setTokenizerRevision] = useState(initialHf?.tokenizer?.revision ?? ''),
    [template, setTemplate] = useState<'tokenizer' | undefined>(initialHf?.chat_template);
  const [alias, setAlias] = useState(initialExternal?.model_alias ?? ''),
    [engine, setEngine] = useState(
      initial?.runtime && 'kind' in initial.runtime ? (initial.runtime.engine ?? '') : '',
    );
  const [engineVersion, setEngineVersion] = useState(
    initial?.runtime && 'kind' in initial.runtime ? (initial.runtime.version ?? '') : '',
  );
  const [externalRepository, setExternalRepository] = useState(
    initial?.source.kind === 'external' ? (initial.source.repository ?? '') : '',
  );
  const [externalRevision, setExternalRevision] = useState(
    initial?.source.kind === 'external' ? (initial.source.revision ?? '') : '',
  );
  const [license, setLicense] = useState(false),
    [responsibility, setResponsibility] = useState(false);
  const [jsonObject, setJsonObject] = useState(initialCapabilities?.json_object ?? false),
    [jsonSchema, setJsonSchema] = useState(initialCapabilities?.json_schema ?? false),
    [tools, setTools] = useState(initialCapabilities?.tools ?? false),
    [streaming, setStreaming] = useState(initialCapabilities?.streaming ?? false),
    [streamUsage, setStreamUsage] = useState(initialCapabilities?.stream_usage ?? false);
  const [acceptedParameters, setAcceptedParameters] = useState(
    initialCapabilities?.accepted_parameters.join(', ') ??
      'temperature, top_p, stop, seed, max_tokens, response_format',
  );
  const [schemaKeywords, setSchemaKeywords] = useState(initialCapabilities?.schema_keywords.join(', ') ?? ''),
    [schemaDialect, setSchemaDialect] = useState(initialCapabilities?.schema_dialect ?? '');
  const [inspection, setInspection] = useState<Inspection>(),
    [busy, setBusy] = useState(false),
    [inspecting, setInspecting] = useState(false),
    [error, setError] = useState('');
  const inspectionGeneration = useRef(0);
  function invalidateInspection() {
    inspectionGeneration.current += 1;
    setInspection(undefined);
    setLicense(false);
  }
  const parameters: Schema['ModelDeploymentRuntimeParameters'] = {
    context_window_tokens: Number(context),
    max_output_tokens: Number(output),
    max_concurrent_requests: Number(concurrency),
    dtype,
    ...(!native && quantization ? { quantization } : {}),
    tensor_parallel_size: native ? 1 : Number(parallel),
    gpu_memory_utilization: Number(gpuMemory),
    ...(!native && toolParser ? { tool_call_parser: toolParser } : {}),
    ...(!native && reasoningParser ? { reasoning_parser: reasoningParser } : {}),
  };
  const source: Schema['ModelDeploymentSource'] =
    kind === 'managed'
      ? {
          kind: 'hugging_face',
          repository,
          ...(revision ? { revision } : {}),
          ...(sourceConnection ? { source_connection_id: sourceConnection } : {}),
          ...(!native && weightFiles ? { weight_files: values(weightFiles) } : {}),
          ...(!native && tokenizer
            ? {
                tokenizer: {
                  repository: tokenizer,
                  ...(tokenizerRevision ? { revision: tokenizerRevision } : {}),
                },
              }
            : {}),
          ...(!native && template ? { chat_template: template } : {}),
          license_acknowledged: license,
        }
      : {
          kind: 'external',
          repository: externalRepository || null,
          revision: externalRevision || null,
          capabilities: {
            protocol,
            input_modalities: ['text'],
            ...(protocol === 'systemone'
              ? {
                  chat_completions: false,
                  json_object: false,
                  json_schema: false,
                  tools: false,
                  streaming: false,
                  stream_usage: false,
                  schema_keywords: [],
                  accepted_parameters: ['state', 'questions'],
                  schema_dialect: null,
                }
              : {
                  chat_completions: true,
                  json_object: jsonObject,
                  json_schema: jsonSchema,
                  tools,
                  streaming,
                  stream_usage: streamUsage,
                  schema_keywords: values(schemaKeywords),
                  accepted_parameters: values(acceptedParameters),
                  schema_dialect: schemaDialect || null,
                }),
            context_window_tokens: Number(context),
            max_output_tokens: Number(output),
            max_concurrent_requests: Number(concurrency),
          },
        };
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
          if (kind === 'external' && !responsibility)
            throw new Error('Confirm your responsibility for the external host and its costs.');
          if (
            kind === 'managed' &&
            (!inspection?.supported || (inspection.license_acknowledgement_required && !license))
          )
            throw new Error('Inspect the selected source and acknowledge its terms before saving.');
          if (kind === 'managed' && !profile) throw new Error('Select a compatible registered runtime.');
          const configuration: Schema['ModelDeploymentRevisionCreate'] = {
            source:
              kind === 'managed' && inspection?.source
                ? { ...inspection.source, license_acknowledged: license }
                : source,
            runtime:
              kind === 'managed'
                ? { profile_id: profile as RuntimeProfile, parameters }
                : { kind: 'external', engine: engine || null, version: engineVersion || null },
            hosting:
              kind === 'managed'
                ? {
                    kind: 'runpod_serverless',
                    compute_connection_id: computeConnection,
                    placement: {
                      region_ids: values(regions),
                      gpu_pool_ids: values(gpuPools),
                      gpu_count: native ? 1 : Number(gpuCount),
                    },
                  }
                : {
                    kind: protocol === 'systemone' ? 'external_systemone' : 'external_openai',
                    endpoint_connection_id: endpoint,
                    model_alias: alias,
                    lifecycle: 'external',
                    external_hosting_acknowledged: true,
                  },
          };
          if (deploymentId) {
            await request('createModelDeploymentRevision', {
              params: { path: { deployment_id: deploymentId } },
              body: configuration,
            });
            onSaved(deploymentId);
          } else {
            const created = await request('createModelDeployment', {
              body: { name: name.trim(), ...configuration, access: { grants: [] } },
            });
            onSaved(created.deployment_id);
          }
        } catch (failure) {
          setError(failureMessage(failure));
        } finally {
          setBusy(false);
        }
      }}
    >
      {!deploymentId && (
        <Field label="Deployment name">
          <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} />
        </Field>
      )}
      <Field label="Hosting">
        <Select
          value={kind}
          onValueChange={(next) => {
            setKind(next);
            invalidateInspection();
          }}
          options={[
            { value: 'managed', label: 'Host a Hugging Face model with RunPod' },
            { value: 'external', label: 'Use an existing model endpoint' },
          ]}
        />
      </Field>
      {kind === 'managed' ? (
        <>
          <Field
            label="Model task"
            hint="Native decisions use the publisher's scoring head, not chat generation."
          >
            <Select
              value={task}
              onValueChange={(value) => {
                if (value !== 'decision' && value !== 'text_generation') return;
                setTask(value);
                setProfile('');
                if (value === 'decision') setGpuCount('1');
                setDtype(value === 'decision' ? 'bfloat16' : 'auto');
                setOutput(value === 'decision' ? '1024' : '2048');
                invalidateInspection();
              }}
              options={[
                { value: 'decision', label: 'Native decisions · Kev / Jev-compatible' },
                { value: 'text_generation', label: 'Chat generation' },
              ]}
            />
          </Field>
          {native && (
            <p className="form-hint">
              Start with <code>jaredpalmer/kev-4b</code>. Inspection pins its base model, adapter, scoring
              head and calibration. Community checkpoints must match the supported native format.
            </p>
          )}
          <Field
            label="Hugging Face model"
            hint="Repository ID or huggingface.co model URL. Inspection creates no compute."
          >
            <input
              required
              value={repository}
              placeholder={native ? 'jaredpalmer/kev-4b' : 'Qwen/Qwen3-0.6B'}
              onChange={(event) => {
                setRepository(event.target.value);
                invalidateInspection();
              }}
            />
          </Field>
          <Field label="Source revision (optional)" hint="A branch or tag is resolved once to a full commit.">
            <input
              value={revision}
              onChange={(event) => {
                setRevision(event.target.value);
                invalidateInspection();
              }}
            />
          </Field>
          <ConnectionPicker
            kind="hugging_face"
            value={sourceConnection}
            onChange={(next) => {
              setSourceConnection(next);
              invalidateInspection();
            }}
            optional
          />
          <ConnectionPicker
            kind="runpod"
            value={computeConnection}
            onChange={(next) => {
              setComputeConnection(next);
              invalidateInspection();
            }}
          />
        </>
      ) : (
        <>
          <Field label="Endpoint protocol">
            <Select
              value={protocol}
              onValueChange={(next) => setProtocol(next === 'systemone' ? 'systemone' : 'openai_chat')}
              options={[
                { value: 'openai_chat', label: 'OpenAI-compatible chat' },
                { value: 'systemone', label: 'SystemOne decisions (Kev / Jev)' },
              ]}
            />
          </Field>
          <ConnectionPicker kind="external_model" value={endpoint} onChange={setEndpoint} />
          <Field label="Served model alias">
            <input value={alias} onChange={(event) => setAlias(event.target.value)} required />
          </Field>
          <Field label="Declared engine (optional)">
            <input value={engine} onChange={(event) => setEngine(event.target.value)} />
          </Field>
          <Field label="Declared engine version (optional)">
            <input value={engineVersion} onChange={(event) => setEngineVersion(event.target.value)} />
          </Field>
          <details>
            <summary>Declared model provenance</summary>
            <Field label="Declared source repository (optional)">
              <input
                value={externalRepository}
                onChange={(event) => setExternalRepository(event.target.value)}
              />
            </Field>
            <Field label="Declared source revision (optional)">
              <input value={externalRevision} onChange={(event) => setExternalRevision(event.target.value)} />
            </Field>
          </details>
          <p className="form-hint">
            Source, engine and capabilities are your declarations. Unknown artifact identity and hosting costs
            remain unknown.
          </p>
        </>
      )}
      <div className="form-grid">
        <Field label="Context capacity (tokens)">
          <input
            type="number"
            min="1"
            required
            value={context}
            onChange={(event) => {
              setContext(event.target.value);
              invalidateInspection();
            }}
          />
        </Field>
        <Field
          label="Maximum output (tokens)"
          hint={
            native
              ? 'Bounds the serialized decision result; native scoring does not generate answer tokens.'
              : undefined
          }
        >
          <input
            type="number"
            min="1"
            required
            value={output}
            onChange={(event) => {
              setOutput(event.target.value);
              invalidateInspection();
            }}
          />
        </Field>
        <Field label="Runtime concurrency">
          <input
            type="number"
            min="1"
            required
            value={concurrency}
            onChange={(event) => {
              setConcurrency(event.target.value);
              invalidateInspection();
            }}
          />
        </Field>
      </div>
      {kind === 'managed' ? (
        <>
          <details>
            <summary>Model and runtime settings</summary>
            {!native && (
              <>
                <Field label="Exact weight files (comma-separated, optional)">
                  <input
                    value={weightFiles}
                    onChange={(event) => {
                      setWeightFiles(event.target.value);
                      invalidateInspection();
                    }}
                  />
                </Field>
                <Field label="Tokenizer repository (optional)">
                  <input
                    value={tokenizer}
                    onChange={(event) => {
                      setTokenizer(event.target.value);
                      invalidateInspection();
                    }}
                  />
                </Field>
                <Field label="Tokenizer revision (optional)">
                  <input
                    value={tokenizerRevision}
                    onChange={(event) => {
                      setTokenizerRevision(event.target.value);
                      invalidateInspection();
                    }}
                  />
                </Field>
                <Field label="Reviewed chat template (optional)">
                  <Select
                    value={template ?? '__default'}
                    onValueChange={(value) => {
                      setTemplate(value === 'tokenizer' ? 'tokenizer' : undefined);
                      invalidateInspection();
                    }}
                    options={[
                      { value: '__default', label: 'Runtime default' },
                      { value: 'tokenizer', label: 'Pinned tokenizer template' },
                    ]}
                  />
                </Field>
              </>
            )}
            <Field label="Dtype">
              <Select
                key={native ? 'native-dtype' : 'chat-dtype'}
                value={dtype}
                onValueChange={(next) => {
                  const selected = dtypes.find((item) => item === next);
                  if (!selected) return;
                  setDtype(selected);
                  invalidateInspection();
                }}
                options={(native ? (['bfloat16', 'float'] as const) : dtypes).map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </Field>
            {!native && (
              <>
                <Field label="Quantization (optional)">
                  <Select
                    value={quantization ?? '__default'}
                    onValueChange={(next) => {
                      setQuantization(quantizations.find((item) => item === next));
                      invalidateInspection();
                    }}
                    options={[
                      { value: '__default', label: 'Model default' },
                      ...quantizations.map((value) => ({ value, label: value })),
                    ]}
                  />
                </Field>
                <Field label="Tensor parallel size">
                  <input
                    type="number"
                    min="1"
                    value={parallel}
                    onChange={(event) => {
                      setParallel(event.target.value);
                      invalidateInspection();
                    }}
                  />
                </Field>
              </>
            )}
            <Field label="GPU memory utilization">
              <input
                type="number"
                min="0.1"
                max="0.95"
                step="0.01"
                value={gpuMemory}
                onChange={(event) => {
                  setGpuMemory(event.target.value);
                  invalidateInspection();
                }}
              />
            </Field>
            {!native && (
              <>
                <Field label="Tool call parser (optional)">
                  <Select
                    value={toolParser ?? '__none'}
                    onValueChange={(next) => {
                      setToolParser(toolParsers.find((item) => item === next));
                      invalidateInspection();
                    }}
                    options={[
                      { value: '__none', label: 'No parser' },
                      ...toolParsers.map((value) => ({ value, label: value })),
                    ]}
                  />
                </Field>
                <Field label="Reasoning parser (optional)">
                  <Select
                    value={reasoningParser ?? '__none'}
                    onValueChange={(next) => {
                      setReasoningParser(reasoningParsers.find((item) => item === next));
                      invalidateInspection();
                    }}
                    options={[
                      { value: '__none', label: 'No parser' },
                      ...reasoningParsers.map((value) => ({ value, label: value })),
                    ]}
                  />
                </Field>
              </>
            )}
          </details>
          <Button
            type="button"
            variant="secondary"
            busy={inspecting}
            disabled={!repository || busy}
            onClick={async () => {
              setInspecting(true);
              setError('');
              invalidateInspection();
              const generation = inspectionGeneration.current;
              try {
                if (source.kind !== 'hugging_face') return;
                const result = await request('inspectModelDeployment', {
                  body: {
                    source,
                    task,
                    ...(computeConnection ? { compute_connection_id: computeConnection } : {}),
                    runtime_preferences: { ...(profile ? { profile_id: profile } : {}), parameters },
                  },
                });
                if (generation !== inspectionGeneration.current) return;
                setInspection(result);
                setProfile(
                  result.runtime_profiles.some((item) => item.profile_id === runtimeProfiles[task].id)
                    ? runtimeProfiles[task].id
                    : '',
                );
              } catch (failure) {
                if (generation === inspectionGeneration.current) setError(failureMessage(failure));
              } finally {
                setInspecting(false);
              }
            }}
          >
            Inspect compatibility and hosting
          </Button>
          {inspection && (
            <section aria-label="Compatibility findings" role="status">
              <h3>
                {inspection.supported
                  ? 'Compatible serving configuration'
                  : 'Source cannot be deployed with this configuration'}
              </h3>
              {inspection.findings.map((finding, index) => (
                <p key={`${finding.code}-${index}`}>{finding.message}</p>
              ))}
              {inspection.source?.kind === 'hugging_face' && (
                <p>
                  Resolved commit: <code>{inspection.source.revision}</code>
                </p>
              )}
              <p>
                Estimated memory:{' '}
                {inspection.memory_estimate_bytes === null
                  ? 'Unavailable'
                  : `${(Number(inspection.memory_estimate_bytes) / 1073741824).toFixed(1)} GiB`}
                . Actual loading must still succeed.
              </p>
              <Field label="Runtime profile">
                <Select
                  value={profile}
                  onValueChange={(value) =>
                    setProfile(value === runtimeProfiles[task].id ? runtimeProfiles[task].id : '')
                  }
                  options={inspection.runtime_profiles.map((item) => ({
                    value: item.profile_id,
                    label: runtimeProfiles[task].label,
                  }))}
                />
              </Field>
              {inspection.hosting_options.length > 0 && (
                <Field label="Compatible GPU offer">
                  <Select
                    value={gpuPools}
                    onValueChange={setGpuPools}
                    placeholder="Choose compatible hardware"
                    options={inspection.hosting_options.map((item) => ({
                      value: item.gpu_pool_id,
                      label: `${item.name} · ${item.hourly_cost_micro_usd === null ? 'Unknown price' : `${money(item.hourly_cost_micro_usd)}/GPU-hour`}`,
                    }))}
                  />
                </Field>
              )}
              {(() => {
                const selected = values(gpuPools).map((id) =>
                  inspection.hosting_options.find((offer) => offer.gpu_pool_id === id),
                );
                const prices = selected.map((offer) => offer?.hourly_cost_micro_usd);
                const count = native ? 1 : Number(gpuCount);
                if (
                  !selected.length ||
                  prices.some((price) => price === null || price === undefined) ||
                  !Number.isSafeInteger(count) ||
                  count < 1
                )
                  return (
                    <p>GPU cost estimate: Unknown. Choose priced hardware and a GPU count before starting.</p>
                  );
                const hourly = prices.map((price) => BigInt(price!) * BigInt(count));
                const low = hourly.reduce((a, b) => (a < b ? a : b));
                const high = hourly.reduce((a, b) => (a > b ? a : b));
                const amount = (multiplier: bigint) =>
                  low === high
                    ? money((low * multiplier).toString())
                    : `${money((low * multiplier).toString())}–${money((high * multiplier).toString())}`;
                return (
                  <p>
                    Selected hardware estimate per active replica ({count} GPU{count === 1 ? '' : 's'}):{' '}
                    {amount(1n)}/hour · {amount(24n)}/day · {amount(720n)}/30 days at continuous operation.
                    Multiply by active replicas. Storage, data transfer and other provider charges are
                    additional; prices and actual usage can change.
                  </p>
                );
              })()}
              {inspection.license_acknowledgement_required && (
                <label>
                  <input
                    type="checkbox"
                    checked={license}
                    onChange={(event) => setLicense(event.target.checked)}
                  />{' '}
                  I have reviewed and accept this model's license and terms (
                  {inspection.license ?? 'see its repository'}), and have any required upstream access.
                </label>
              )}
            </section>
          )}
          <Field
            label="GPU pool IDs"
            hint="Comma-separated compatible alternatives. Starting validates current rates and fit."
          >
            <input value={gpuPools} required onChange={(event) => setGpuPools(event.target.value)} />
          </Field>
          <Field
            label="GPU count per replica"
            hint={native ? 'Native Kev uses one GPU per replica. Increase replicas to scale.' : undefined}
          >
            <input
              type="number"
              min="1"
              required
              value={native ? '1' : gpuCount}
              readOnly={native}
              onChange={(event) => setGpuCount(event.target.value)}
            />
          </Field>
          <Field
            label="Preferred region IDs (optional)"
            hint="Placement preferences do not guarantee regional residency."
          >
            <input value={regions} onChange={(event) => setRegions(event.target.value)} />
          </Field>
        </>
      ) : (
        <>
          {protocol === 'systemone' ? (
            <p className="form-hint">
              Send state and named questions for native noul, choice and score answers. This protocol returns
              a complete decision response and does not stream.
            </p>
          ) : (
            <>
              <fieldset>
                <legend>Declared endpoint capabilities</legend>
                {[
                  ['JSON object', jsonObject, setJsonObject],
                  ['JSON schema', jsonSchema, setJsonSchema],
                  ['Tool calls', tools, setTools],
                  ['Streaming', streaming, setStreaming],
                  ['Streaming usage', streamUsage, setStreamUsage],
                ].map(([label, checked, change]) => (
                  <label key={String(label)}>
                    <input
                      type="checkbox"
                      checked={Boolean(checked)}
                      onChange={(event) => {
                        if (typeof change === 'function') change(event.target.checked);
                      }}
                    />{' '}
                    {String(label)}
                  </label>
                ))}
              </fieldset>
              <Field label="Accepted native parameters (comma-separated)">
                <input
                  value={acceptedParameters}
                  onChange={(event) => setAcceptedParameters(event.target.value)}
                />
              </Field>
              <Field label="Supported schema keywords (comma-separated)">
                <input value={schemaKeywords} onChange={(event) => setSchemaKeywords(event.target.value)} />
              </Field>
              <Field label="Schema dialect (optional)">
                <input value={schemaDialect} onChange={(event) => setSchemaDialect(event.target.value)} />
              </Field>
            </>
          )}
          <label>
            <input
              type="checkbox"
              checked={responsibility}
              onChange={(event) => setResponsibility(event.target.checked)}
            />{' '}
            I operate and pay for this host separately, with no additional per-request tariff. Macrofold
            cannot stop its infrastructure or cap its bill.
          </label>
        </>
      )}
      <p className="form-hint">
        Saving creates{' '}
        {deploymentId
          ? 'an immutable revision without switching the serving model'
          : 'a stopped deployment with no application grants'}
        . Start and grant access separately.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Button
        type="submit"
        busy={busy}
        disabled={
          inspecting ||
          (kind === 'managed'
            ? !inspection?.supported || !profile || !computeConnection
            : !endpoint || !responsibility)
        }
      >
        {deploymentId ? 'Create revision' : 'Create deployment'}
      </Button>
    </form>
  );
}

export function ModelDeploymentsView() {
  const client = useQueryClient();
  const deployments = useDataPages(
    { operation: 'listModelDeployments', params: { query: { limit: 25 } } },
    10000,
  );
  const identity = useData({ operation: 'getIdentity' });
  const [create, setCreate] = useState(false),
    [created, setCreated] = useState('');
  return (
    <div className="page model-deployments">
      <PageHeading
        title="Model deployments"
        description="Host a chosen model, control its service and grant applications a stable inference target."
        action={
          <Button
            onClick={() => setCreate(true)}
            disabled={!identity.data?.effective_scopes.includes('model-deployments:write')}
          >
            <Plus size={16} /> Create deployment
          </Button>
        }
      />
      <p className="form-hint">
        Deployment request fee: $0. Provider infrastructure is billed separately, including warm idle
        capacity.
      </p>
      {created && (
        <p role="status">
          Deployment created stopped.{' '}
          <Link href={`/model-deployments/${created}`}>Choose its operating policy and start</Link>.
        </p>
      )}
      {deployments.isPending ? (
        <Loading />
      ) : deployments.error ? (
        <ErrorState error={deployments.error} retry={() => void deployments.refetch()} />
      ) : !deployments.data?.data.length ? (
        <Empty
          icon={<Box />}
          title="No model deployments"
          description="Inspect a Hugging Face model or connect an existing chat or SystemOne endpoint."
        />
      ) : (
        <>
          {deployments.data.data.map((deployment) => (
            <section className="panel" key={deployment.deployment_id} aria-label={deployment.name}>
              <div className="section-heading">
                <h2>
                  <Link href={`/model-deployments/${deployment.deployment_id}`}>{deployment.name}</Link>
                </h2>
                <Badge status={deployment.state} />
              </div>
              <p>
                <code>{deployment.deployment_id}</code>{' '}
                <CopyButton text={deployment.deployment_id} variant="ghost" />
              </p>
              <p>
                {deployment.admission_open ? 'Accepting new requests' : 'New requests closed'} · desired{' '}
                {deployment.desired_state} · {deployment.ready_replicas ?? 'Unknown'} ready replicas
              </p>
              {deployment.failure_code && (
                <p className="form-error">{deployment.failure_code.replaceAll('_', ' ')}</p>
              )}
              <Link className="button secondary" href={`/model-deployments/${deployment.deployment_id}`}>
                Manage deployment
              </Link>
            </section>
          ))}
          <More query={deployments} />
        </>
      )}
      <Modal
        className="model-deployments"
        open={create}
        onOpenChange={setCreate}
        title="Create model deployment"
        description="Inspect the source, select hosting and save a stopped service."
        wide
      >
        {create && (
          <DeploymentForm
            onSaved={(id) => {
              setCreated(id);
              setCreate(false);
              void refreshDeployments(client);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function ServiceForm({
  deployment,
  revisions,
  onSaved,
}: {
  deployment: Deployment;
  revisions: Revision[];
  onSaved: () => void;
}) {
  const [revision, setRevision] = useState(
    deployment.desired_revision_id ?? revisions[0]?.deployment_revision_id ?? '',
  );
  const selected = revisions.find((item) => item.deployment_revision_id === revision);
  const managed = selected?.hosting.kind === 'runpod_serverless';
  const existingPolicy = deployment.policy;
  const [minimum, setMinimum] = useState(
    String(existingPolicy && 'min_replicas' in existingPolicy ? existingPolicy.min_replicas : 1),
  );
  const [maximum, setMaximum] = useState(
    String(existingPolicy && 'max_replicas' in existingPolicy ? existingPolicy.max_replicas : 1),
  );
  const [concurrency, setConcurrency] = useState(String(existingPolicy?.max_concurrent_requests ?? 1));
  const [ceiling, setCeiling] = useState(
    existingPolicy && 'max_hourly_cost_micro_usd' in existingPolicy
      ? dollars(existingPolicy.max_hourly_cost_micro_usd)
      : '',
  );
  const [stopAt, setStopAt] = useState(existingPolicy?.stop_at ?? '');
  const [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
          const policy: Policy = {
            max_concurrent_requests: Number(concurrency),
            stop_at: stopAt ? new Date(stopAt).toISOString() : null,
            ...(managed
              ? {
                  min_replicas: Number(minimum),
                  max_replicas: Number(maximum),
                  max_hourly_cost_micro_usd: usd(ceiling),
                }
              : {}),
          };
          await request('setModelDeploymentService', {
            params: { path: { deployment_id: deployment.deployment_id } },
            body: { deployment_revision_id: revision, desired_state: 'running', policy },
          });
          onSaved();
        } catch (failure) {
          setError(failureMessage(failure));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field
        label="Serving revision"
        hint="Selecting an older revision rolls back through the same drain and reload process."
      >
        <Select
          value={revision}
          onValueChange={(value) => {
            setRevision(value);
            setConfirmed(false);
          }}
          options={revisions.map((item) => ({
            value: item.deployment_revision_id,
            label: `${item.deployment_revision_id}${item.deployment_revision_id === deployment.serving_revision_id ? ' · currently serving' : ''}`,
          }))}
        />
      </Field>
      {managed ? (
        <>
          <div className="form-grid">
            <Field label="Minimum warm replicas">
              <input
                type="number"
                min="1"
                required
                value={minimum}
                onChange={(event) => {
                  setMinimum(event.target.value);
                  setConfirmed(false);
                }}
              />
            </Field>
            <Field label="Maximum replicas">
              <input
                type="number"
                min={minimum}
                required
                value={maximum}
                onChange={(event) => {
                  setMaximum(event.target.value);
                  setConfirmed(false);
                }}
              />
            </Field>
          </div>
          <Field
            label="Maximum infrastructure rate (USD/hour)"
            hint="Authorizes planned GPU and storage capacity. This is a rate guard, not a lifetime or provider-guaranteed dollar cap."
          >
            <input
              inputMode="decimal"
              required
              value={ceiling}
              onChange={(event) => {
                setCeiling(event.target.value);
                setConfirmed(false);
              }}
            />
          </Field>
          {/^\d+(?:\.\d{1,6})?$/.test(ceiling) && (
            <p className="form-hint">
              At the ceiling continuously: {money((BigInt(usd(ceiling)) * 24n).toString())}/day or{' '}
              {money((BigInt(usd(ceiling)) * 720n).toString())}/30 days. These are illustrative maximum
              planned-rate projections, not provider invoices. Startup, idle time and shutdown tails can be
              billable. Configure spending controls in your RunPod account.
            </p>
          )}
        </>
      ) : (
        <p className="form-hint">
          You operate and pay for the external host. Macrofold limits access concurrency; replica capacity and
          hosting costs remain under your control. Stopping this service closes Macrofold access and does not
          stop that host.
        </p>
      )}
      <Field label="Maximum concurrent requests">
        <input
          type="number"
          min="1"
          required
          value={concurrency}
          onChange={(event) => {
            setConcurrency(event.target.value);
            setConfirmed(false);
          }}
        />
      </Field>
      <Field
        label="Stop at (optional UTC timestamp)"
        hint="Leave empty for ongoing service. New inference cannot start a stopped service."
      >
        <input
          value={stopAt}
          placeholder="2026-12-01T00:00:00Z"
          onChange={(event) => {
            setStopAt(event.target.value);
            setConfirmed(false);
          }}
        />
      </Field>
      {revision !== deployment.serving_revision_id && deployment.serving_revision_id && (
        <p className="form-hint">
          Changing revisions closes new admissions, drains accepted calls, then stops the old capacity before
          loading the selected model. Availability is interrupted; valid earlier results retain their original
          revision.
        </p>
      )}
      <label>
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{' '}
        {managed
          ? 'I authorize continuing hosting and automatic recovery within these operating limits.'
          : 'I confirm the declared endpoint capabilities and my responsibility for its separately billed infrastructure.'}
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" busy={busy} disabled={!revision || !selected || !confirmed}>
        Apply and start service
      </Button>
    </form>
  );
}

function DeploymentAccess({ deploymentId }: { deploymentId: string }) {
  const client = useQueryClient();
  const grants = useDataPages({
    operation: 'listModelDeploymentGrants',
    params: { path: { deployment_id: deploymentId }, query: { limit: 25 } },
  });
  const keys = useDataPages({ operation: 'listApiKeys', params: { query: { limit: 100 } } });
  const workspaces = useDataPages({ operation: 'listWorkspaces', params: { query: { limit: 100 } } });
  const [kind, setKind] = useState('api_key'),
    [subject, setSubject] = useState(''),
    [all, setAll] = useState(false),
    [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <section className="panel" aria-label="Application access">
      <h2>Application access</h2>
      <p>
        Grants permit read and use. The application also needs deployment scopes and its ordinary Run scopes.
        Changes apply immediately without restarting hosting.
      </p>
      {grants.isPending ? (
        <Loading />
      ) : grants.error ? (
        <ErrorState error={grants.error} retry={() => void grants.refetch()} />
      ) : !grants.data?.data.length ? (
        <p>No application grants. The owner must explicitly grant the identity used for inference.</p>
      ) : (
        <>
          {grants.data.data.map((grant) => (
            <div key={grant.grant_id}>
              <p>
                <code>
                  {grant.subject.kind === 'api_key' ? grant.subject.api_key_id : grant.subject.subject_id}
                </code>{' '}
                ·{' '}
                {grant.workspace_scope.kind === 'all'
                  ? 'All authorized workspaces'
                  : `${grant.workspace_scope.workspace_ids.length} selected workspaces`}{' '}
                · {grant.revoked_at ? 'Revoked' : 'Active'}
              </p>
              {!grant.revoked_at && (
                <Button
                  variant="danger"
                  busy={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      await request('revokeModelDeploymentGrant', {
                        params: { path: { deployment_id: deploymentId, grant_id: grant.grant_id } },
                      });
                      await refreshDeployments(client);
                    } catch (failure) {
                      setError(failureMessage(failure));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Revoke grant {grant.grant_id}
                </Button>
              )}
            </div>
          ))}
          <More query={grants} />
        </>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            await request('createModelDeploymentGrant', {
              params: { path: { deployment_id: deploymentId } },
              body: {
                subject:
                  kind === 'api_key'
                    ? { kind: 'api_key', api_key_id: subject }
                    : { kind: 'subject', subject_id: subject },
                workspace_scope: all ? { kind: 'all' } : { kind: 'selected', workspace_ids: workspaceIds },
              },
            });
            await refreshDeployments(client);
            setSubject('');
            setWorkspaceIds([]);
            setAll(false);
          } catch (failure) {
            setError(failureMessage(failure));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Application identity type">
          <Select
            value={kind}
            onValueChange={(value) => {
              setKind(value);
              setSubject('');
            }}
            options={[
              { value: 'api_key', label: 'API key' },
              { value: 'subject', label: 'Organization member' },
            ]}
          />
        </Field>
        {kind === 'api_key' ? (
          <>
            <Field label="API key">
              <Select
                value={subject || '__none'}
                onValueChange={(value) => setSubject(value === '__none' ? '' : value)}
                disabled={!keys.data || !!keys.error}
                options={[
                  { value: '__none', label: 'Choose an active application key' },
                  ...(keys.data?.data
                    .filter((key) => !key.revoked_at)
                    .map((key) => ({ value: key.id, label: key.name })) ?? []),
                ]}
              />
            </Field>
            {keys.isPending && <Loading label="Loading application keys…" />}
            {keys.error && <ErrorState error={keys.error} retry={() => void keys.refetch()} />}
            <More query={keys} label="Load more keys" />
          </>
        ) : (
          <Field
            label="Member subject ID"
            hint="Use the current organization member's UUID. The server checks membership."
          >
            <input value={subject} onChange={(event) => setSubject(event.target.value)} required />
          </Field>
        )}
        <label>
          <input
            type="checkbox"
            checked={all}
            onChange={(event) => {
              setAll(event.target.checked);
              setWorkspaceIds([]);
            }}
          />{' '}
          Grant use across all authorized workspaces
        </label>
        {!all && (
          <fieldset>
            <legend>Selected workspaces</legend>
            {workspaces.isPending ? (
              <Loading />
            ) : workspaces.error ? (
              <ErrorState error={workspaces.error} retry={() => void workspaces.refetch()} />
            ) : (
              workspaces.data?.data.map((workspace) => (
                <label key={workspace.id}>
                  <input
                    type="checkbox"
                    checked={workspaceIds.includes(workspace.id)}
                    onChange={(event) =>
                      setWorkspaceIds((current) =>
                        event.target.checked
                          ? [...current, workspace.id]
                          : current.filter((id) => id !== workspace.id),
                      )
                    }
                  />{' '}
                  {workspace.name}
                </label>
              ))
            )}
            <More query={workspaces} label="Load more workspaces" />
          </fieldset>
        )}
        <Button
          type="submit"
          busy={busy}
          disabled={!subject || (!all && !workspaceIds.length) || !!grants.error}
        >
          Grant application access
        </Button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function ModelDeploymentDetail({ deploymentId }: { deploymentId: string }) {
  const client = useQueryClient();
  const deployment = useData(
    { operation: 'getModelDeployment', params: { path: { deployment_id: deploymentId } } },
    5000,
  );
  const revisions = useDataPages(
    deployment.data?.can_manage
      ? {
          operation: 'listModelDeploymentRevisions',
          params: { path: { deployment_id: deploymentId }, query: { limit: 25 } },
        }
      : undefined,
  );
  const desiredRevisionId = deployment.data?.desired_revision_id;
  const listedRevision = revisions.data?.data.find(
    (item) => item.deployment_revision_id === desiredRevisionId,
  );
  // A rollback may select a revision outside the current history page. Fetch
  // that immutable record directly instead of walking all intervening pages.
  const desiredRevision = useData(
    deployment.data?.can_manage && desiredRevisionId && revisions.data && !listedRevision
      ? {
          operation: 'getModelDeploymentRevision',
          params: { path: { deployment_id: deploymentId, revision_id: desiredRevisionId } },
        }
      : undefined,
  );
  const [dialog, setDialog] = useState<'service' | 'revision' | 'stop' | 'delete'>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [accepted, setAccepted] = useState('');
  if (deployment.isPending)
    return (
      <div className="page">
        <Loading />
      </div>
    );
  if (deployment.error)
    return (
      <div className="page">
        <ErrorState error={deployment.error} retry={() => void deployment.refetch()} />
      </div>
    );
  const current = deployment.data;
  if (!current) return null;
  const initial = listedRevision ?? desiredRevision.data;
  const availableRevisions =
    initial && !listedRevision ? [initial, ...(revisions.data?.data ?? [])] : (revisions.data?.data ?? []);
  const external = initial?.source.kind === 'external';
  const cost = current.infrastructure_cost;
  // Keep the last check useful after cleanup, without attributing an older revision's
  // failure to the currently selected model.
  const lastProbe = current.resources
    ?.filter((resource) => resource.deployment_revision_id === current.desired_revision_id)
    .reduce<ReadinessProbe | undefined>((latest, resource) => {
      const probe = resource.last_probe;
      return probe && (!latest || probe.checked_at > latest.checked_at) ? probe : latest;
    }, undefined);
  async function saved(message: string) {
    setDialog(undefined);
    setAccepted(message);
    await refreshDeployments(client);
  }
  return (
    <div className="page model-deployments">
      <PageHeading
        title={current.name}
        description="Persistent model service, current health and infrastructure costs."
      />
      <p>
        <Link href="/model-deployments">All model deployments</Link>
      </p>
      <section className="panel" aria-label="Service status">
        <div className="section-heading">
          <h2>Service status</h2>
          <Badge status={current.state} />
        </div>
        <p>
          <code>{current.deployment_id}</code>{' '}
          <CopyButton text={current.deployment_id} label="Copy deployment ID" variant="ghost" />
        </p>
        <p>
          {current.admission_open ? 'Accepting new requests' : 'New requests closed'} · desired{' '}
          {current.desired_state} · {current.ready_replicas ?? 'Unknown'} ready replicas
        </p>
        {current.startup && (
          <p role="status">
            {current.startup.phase === 'provisioning'
              ? 'Allocating compute and preparing the serving image.'
              : 'Loading the model and checking authenticated readiness.'}{' '}
            Phase deadline: <time dateTime={current.startup.deadline_at}>{current.startup.deadline_at}</time>.
          </p>
        )}
        <p>
          Serving revision: <code>{current.serving_revision_id ?? 'None ready'}</code>
        </p>
        <p>
          Desired revision: <code>{current.desired_revision_id ?? 'None selected'}</code>
        </p>
        <p>Last observed: {current.observed_at ?? 'No observation available'}</p>
        {current.failure_code && (
          <p className="form-error" role="status">
            {current.failure_code.replaceAll('_', ' ')}. Inspect the configuration and provider account before
            changing its policy.
          </p>
        )}
        {current.can_manage && current.failure_code && lastProbe && lastProbe.code !== 'model_ready' && (
          <p className="form-error">
            Last readiness result: {lastProbe.code.replace(/^model_/, '').replaceAll('_', ' ')}
            {lastProbe.http_status !== undefined && ` (HTTP ${lastProbe.http_status})`}. See Owned hosting
            resources for the retained check details.
          </p>
        )}
        {current.state === 'cleanup_pending' && (
          <p className="form-error" role="status">
            Shutdown is unconfirmed. Owned resources and charges may continue while cleanup reconciles; check
            the provider account.
          </p>
        )}
        {accepted && (
          <p role="status">
            {accepted} The displayed observed state is authoritative; acceptance alone does not establish
            readiness or stopped billing.
          </p>
        )}
        {current.can_manage && !current.retired && (
          <div className="button-row">
            <Button
              onClick={() => {
                setError('');
                setDialog('service');
              }}
              disabled={!availableRevisions.length || (!!desiredRevisionId && !initial)}
            >
              {current.desired_state === 'running' ? 'Operating policy and rollback' : 'Start service'}
            </Button>
            <Button variant="secondary" onClick={() => setDialog('revision')} disabled={!initial}>
              Create revision
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setError('');
                setDialog('stop');
              }}
              disabled={!current.desired_revision_id || !current.policy}
            >
              Stop service
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setError('');
                setDialog('delete');
              }}
            >
              Retire deployment
            </Button>
          </div>
        )}
      </section>
      <section className="panel" aria-label="Infrastructure costs">
        <h2>Infrastructure costs</h2>
        <p>
          Macrofold request fee: {money(current.cost_policy.request_charge_micro_usd)}. Infrastructure is
          excluded from request charges.
        </p>
        <p>
          Estimate: {cost.estimated_micro_usd === null ? 'Unknown' : money(cost.estimated_micro_usd)} ·
          Provider reported:{' '}
          {cost.provider_reported_micro_usd === null
            ? 'Unavailable'
            : money(cost.provider_reported_micro_usd)}
        </p>
        <p>
          Status: {cost.status.replaceAll('_', ' ')} · As of: {cost.as_of ?? 'Unavailable'}
        </p>
        <p>
          Period: {cost.period_start ?? 'Unknown'} to {cost.period_end ?? 'Unknown'}. Estimates and reported
          costs can overlap and are never added together.
        </p>
        {cost.unresolved_liability && (
          <p className="form-error">
            Infrastructure liability remains unresolved. A missing observation does not mean zero cost or
            completed shutdown.
          </p>
        )}
        {external && (
          <p>
            External hosting is separately operated and billed. Stopping Macrofold access does not stop its
            host or its bill.
          </p>
        )}
      </section>
      {current.can_manage && current.resources && (
        <section className="panel" aria-label="Owned hosting resources">
          <h2>Owned hosting resources</h2>
          {current.state === 'cleanup_pending' && (
            <p className="form-error">
              Check these exact resources in the authorized provider account. If automatic cleanup cannot
              confirm shutdown, stop or delete the identified resource there and retain its attempt ID for
              recovery. An unknown provider ID requires account inventory inspection; do not create a
              replacement while the original resource is unresolved.
            </p>
          )}
          {!current.resources.length && <p>No managed provider resources have been recorded.</p>}
          {current.resources.map((resource) => (
            <details key={resource.resource_id}>
              <summary>
                {resource.provider_id ?? 'Provider ID unconfirmed'} · {resource.state}
              </summary>
              <p>
                Provider resource: <code>{resource.provider_id ?? 'Unknown'}</code>{' '}
                {resource.provider_id && (
                  <CopyButton text={resource.provider_id} label="Copy provider resource ID" variant="ghost" />
                )}
              </p>
              <p>
                Attempt: <code>{resource.attempt_id}</code>{' '}
                <CopyButton text={resource.attempt_id} label="Copy hosting attempt ID" variant="ghost" />
              </p>
              <p>
                Record: <code>{resource.resource_id}</code> · Revision:{' '}
                <code>{resource.deployment_revision_id}</code>
              </p>
              <p>
                Created: {resource.created_at} · Deletion confirmed: {resource.deleted_at ?? 'Unconfirmed'}
              </p>
              {resource.last_probe && (
                <p>
                  Last readiness check: {readinessStages[resource.last_probe.stage]} ·{' '}
                  <code>{resource.last_probe.code}</code>
                  {resource.last_probe.http_status !== undefined &&
                    ` · HTTP ${resource.last_probe.http_status}`}
                  {' · '}
                  {resource.last_probe.duration_ms} ms · Checked:{' '}
                  <time dateTime={resource.last_probe.checked_at}>{resource.last_probe.checked_at}</time>
                </p>
              )}
            </details>
          ))}
          <p className="form-hint">
            Shows the active resource and recent history, up to 25 records. Credentials and endpoint addresses
            remain private.
          </p>
        </section>
      )}
      {current.capabilities && (
        <section className="panel" aria-label="Serving capabilities">
          <h2>Serving capabilities</h2>
          <p>
            {current.capabilities.protocol} · {current.capabilities.context_window_tokens} context tokens ·{' '}
            {current.capabilities.max_output_tokens} maximum output tokens ·{' '}
            {current.capabilities.max_concurrent_requests} runtime concurrency
          </p>
          <p>
            JSON object {current.capabilities.json_object ? 'supported' : 'unsupported'} · JSON schema{' '}
            {current.capabilities.json_schema ? 'supported' : 'unsupported'} · Tools{' '}
            {current.capabilities.tools ? 'supported' : 'unsupported'} · Streaming{' '}
            {current.capabilities.streaming ? 'supported' : 'unsupported'}
          </p>
        </section>
      )}
      {current.can_manage && (
        <section className="panel" aria-label="Model revisions">
          <h2>Model revisions</h2>
          {revisions.isPending ? (
            <Loading />
          ) : revisions.error ? (
            <ErrorState error={revisions.error} retry={() => void revisions.refetch()} />
          ) : (
            revisions.data?.data.map((item) => (
              <details key={item.deployment_revision_id}>
                <summary>
                  {item.deployment_revision_id} · {item.created_at}
                </summary>
                <p>
                  Source:{' '}
                  {item.source.kind === 'hugging_face'
                    ? `${item.source.repository} @ ${item.source.revision}`
                    : 'Operator-declared external source'}
                </p>
                <p>
                  Runtime:{' '}
                  {'profile_id' in item.runtime
                    ? item.runtime.profile_id
                    : (item.runtime.engine ?? 'Unknown external engine')}{' '}
                  · Hosting: {item.hosting.kind}
                </p>
                <pre className="code-block">
                  {JSON.stringify(
                    {
                      source: item.source,
                      runtime: item.runtime,
                      hosting: item.hosting,
                      capabilities: item.capabilities,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            ))
          )}
          {desiredRevision.error && (
            <ErrorState error={desiredRevision.error} retry={() => void desiredRevision.refetch()} />
          )}
          <More query={revisions} label="Load more revisions" />
        </section>
      )}
      {current.can_manage && !current.retired && <DeploymentAccess deploymentId={deploymentId} />}
      <Modal
        className="model-deployments"
        open={dialog === 'service'}
        onOpenChange={(open) => {
          if (!open) setDialog(undefined);
        }}
        title="Operating policy and revision"
        description="Apply explicit limits and select the immutable revision to run."
        wide
      >
        {dialog === 'service' && revisions.data && (
          <ServiceForm
            deployment={current}
            revisions={availableRevisions}
            onSaved={() => void saved('Service update accepted.')}
          />
        )}
      </Modal>
      <Modal
        className="model-deployments"
        open={dialog === 'revision'}
        onOpenChange={(open) => {
          if (!open) setDialog(undefined);
        }}
        title="Create model revision"
        description="Prepare immutable model settings. Creating a revision does not switch the running model."
        wide
      >
        {dialog === 'revision' && initial && (
          <DeploymentForm
            deploymentId={deploymentId}
            initial={initial}
            onSaved={() => void saved('Revision saved. Select it in operating policy to roll it out.')}
          />
        )}
      </Modal>
      <Modal
        className="model-deployments"
        open={dialog === 'stop' || dialog === 'delete'}
        onOpenChange={(open) => {
          if (!busy && !open) setDialog(undefined);
        }}
        title={dialog === 'delete' ? 'Retire model deployment' : 'Stop model service'}
        description="Close new admissions, drain accepted requests and reconcile owned capacity."
      >
        <p>
          Managed capacity stops after accepted work drains; provider failures may leave cleanup and charges
          pending. You must stop externally operated infrastructure and its billing yourself.
        </p>
        {dialog === 'delete' && (
          <p>Required historical results, costs and cleanup obligations are retained.</p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button
          variant={dialog === 'delete' ? 'danger' : 'primary'}
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              if (dialog === 'delete')
                await request('deleteModelDeployment', { params: { path: { deployment_id: deploymentId } } });
              else if (current.desired_revision_id && current.policy)
                await request('setModelDeploymentService', {
                  params: { path: { deployment_id: deploymentId } },
                  body: {
                    deployment_revision_id: current.desired_revision_id,
                    desired_state: 'stopped',
                    policy: current.policy,
                  },
                });
              await saved('Shutdown accepted.');
            } catch (failure) {
              setError(failureMessage(failure));
            } finally {
              setBusy(false);
            }
          }}
        >
          {dialog === 'delete' ? 'Confirm retirement' : 'Confirm stop'}
        </Button>
      </Modal>
    </div>
  );
}
