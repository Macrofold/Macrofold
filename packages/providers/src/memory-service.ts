import { z } from 'zod';
import { memoryServiceFetch } from './network';
import { redactText } from './trace-content';
import { assert } from '../../core/src/errors';
import { boundedBody } from '../../core/src/body';

/** Strip private sections before projection, including an unfinished final tag.
 * Otherwise head/tail clipping could remove the closing tag before redaction. */
export const memoryText = (value: string) =>
  redactText(value.replace(/<private>(?:[\s\S]*?<\/private>|[\s\S]*$)/gi, '[private content omitted]'));

const reference = (value: unknown) =>
  typeof value === 'string' && value.length <= 256 && memoryText(value) === value ? value : null;
const reportedTime = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
const reportedEpoch = (value: unknown) => {
  const time =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d{1,16}$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isFinite(time) && Math.abs(time) <= 8640000000000000 ? new Date(time).toISOString() : null;
};

/** Vendor references allow authorized detail expansion, not execution proof.
 * Never copy arbitrary metadata or invent a canonical Run/source relationship. */
function recallProvenance(provider: MemoryServiceConfiguration['provider'], value: Record<string, unknown>) {
  if (provider === 'hindsight')
    return {
      provider_reported: true,
      document_id: reference(value.document_id),
      chunk_id: reference(value.chunk_id),
      fact_type: reference(value.type),
      occurred_start: reportedTime(value.occurred_start),
      occurred_end: reportedTime(value.occurred_end),
      mentioned_at: reportedTime(value.mentioned_at),
      source_fact_ids: Array.isArray(value.source_fact_ids)
        ? value.source_fact_ids
            .slice(0, 8)
            .map(reference)
            .filter((id) => id !== null)
        : null,
      source_fact_ids_omitted: Array.isArray(value.source_fact_ids)
        ? Math.max(0, value.source_fact_ids.length - 8)
        : 0,
    };
  return {
    provider_reported: true,
    project_id: reference(value.projectId),
    server_session_id: reference(value.serverSessionId),
    content_session_id: reference(value.contentSessionId),
    observation_kind: reference(value.kind),
    created_at: reportedEpoch(value.createdAtEpoch),
    updated_at: reportedEpoch(value.updatedAtEpoch),
    source_event_id: null,
  };
}

export type MemoryServiceConfiguration = {
  provider: 'hindsight' | 'claude-mem';
  baseURL: string;
  namespace: string;
  headers: Record<string, string>;
};
export type MemoryReceipt = {
  state: 'pending' | 'complete' | 'failed';
  operation_id?: string;
  external_cost_micro_usd: string | null;
  input_tokens: string | null;
  output_tokens: string | null;
};
const object = z.record(z.string(), z.unknown());
const string = (value: unknown) => (typeof value === 'string' ? value : undefined);
const count = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : typeof value === 'string' && /^\d+$/.test(value)
      ? value
      : null;
const receipt = (state: MemoryReceipt['state'], operation_id?: string, usage?: unknown): MemoryReceipt => {
  const data = object.safeParse(usage).data;
  return {
    state,
    operation_id,
    external_cost_micro_usd: count(data?.cost_micro_usd),
    input_tokens: count(data?.input_tokens),
    output_tokens: count(data?.output_tokens),
  };
};

/** The hosted generator clips pretty-printed event payloads at 16 KiB. Keep
 * both roles/outcomes, with explicit omissions and the complete source ID. */
export function boundedMemoryExcerpt(value: string, limit: number, marker = '\n[excerpt: middle omitted]\n') {
  if (value.length <= limit) return value;
  const remaining = Math.max(0, limit - marker.length);
  const head = Math.ceil(remaining / 2),
    tail = remaining - head;
  return value.slice(0, head) + marker.slice(0, limit) + (tail ? value.slice(-tail) : '');
}

function claudeMemoryPayload(sourceId: string, text: string): Record<string, unknown> {
  let source: Record<string, unknown>;
  try {
    source = object.parse(JSON.parse(text));
  } catch {
    source = { content: text };
  }
  const excerpt = (input: unknown, limit: number) => {
    const value = typeof input === 'string' ? input : input === undefined ? '' : JSON.stringify(input);
    return boundedMemoryExcerpt(value, limit, `\n[excerpt; full source: ${sourceId}]\n`);
  };
  for (const limit of [5000, 3500, 2000, 1000, 500, 250]) {
    const payload = {
      source_id: sourceId,
      source_run_id: source.source_run_id,
      user: excerpt(source.user, limit),
      assistant: excerpt(source.assistant, limit),
      content: excerpt(source.content, limit),
      kind: excerpt(source.kind, 100),
      ...(source.kind === 'engineering-history'
        ? {
            engineering: {
              run_outcome: source.run_outcome,
              provenance: source.provenance,
              tool_outcomes: Array.isArray(source.tool_outcomes) ? source.tool_outcomes.slice(-8) : [],
              source_omissions: source.omissions,
              provider_tool_outcomes_omitted: Array.isArray(source.tool_outcomes)
                ? Math.max(0, source.tool_outcomes.length - 8)
                : 0,
            },
          }
        : {}),
      projection: { full_source_id: sourceId, full_source_characters: text.length, bounded_projection: true },
    };
    if (Buffer.byteLength(JSON.stringify(payload, null, 2)) <= 14 * 1024) return payload;
  }
  throw new Error('memory_projection_unavailable');
}

/** Exact REST protocols, independent of native harnesses. Injected transport is
 * used by real HTTP fixtures; production retains DNS pinning and redirect denial. */
export class MemoryService {
  constructor(
    readonly configuration: MemoryServiceConfiguration,
    private readonly transport: typeof fetch = memoryServiceFetch,
  ) {}

  private async request(path: string, method = 'GET', body?: unknown) {
    const base = this.configuration.baseURL.replace(/\/$/, '');
    const response = await this.transport(`${base}${path}`, {
      method,
      headers: { ...this.configuration.headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (!response.ok) void response.body?.cancel().catch(() => {});
    assert(
      response.ok,
      response.status === 401 || response.status === 403 ? 403 : 502,
      `memory_service_http_${response.status}`,
      `Memory service returned HTTP ${response.status}. Check the service credentials, namespace and server version.`,
    );
    const text = (await boundedBody(response.body, 1024 * 1024, 15000)).toString('utf8');
    if (!text) return {};
    const parsed = object.safeParse(JSON.parse(text));
    assert(
      parsed.success,
      502,
      'memory_service_response_invalid',
      'Memory service returned an incompatible response.',
    );
    return parsed.data;
  }

  private get bank() {
    return `/v1/default/banks/${encodeURIComponent(this.configuration.namespace)}`;
  }

  async probe() {
    if (this.configuration.provider === 'hindsight') return this.request(`${this.bank}/stats`);
    const result = await this.request(
      `/v1/projects/${encodeURIComponent(this.configuration.namespace)}/jobs?limit=1`,
    );
    assert(
      Array.isArray(result.jobs),
      502,
      'memory_service_response_invalid',
      'Use a compatible hosted PostgreSQL Claude-mem service and an existing dedicated project. Its scoped job listing must be available.',
    );
    return result;
  }

  async initialize() {
    if (this.configuration.provider === 'hindsight')
      await this.request(this.bank, 'PUT', { name: `Macrofold ${this.configuration.namespace}` });
    await this.probe();
  }

  async recall(query: string): Promise<{ text: string; receipt: MemoryReceipt }> {
    query = boundedMemoryExcerpt(memoryText(query), 4096);
    const result =
      this.configuration.provider === 'hindsight'
        ? await this.request(`${this.bank}/memories/recall`, 'POST', {
            query,
            budget: 'low',
            max_tokens: 2048,
          })
        : await this.request('/v1/context', 'POST', {
            projectId: this.configuration.namespace,
            query,
            limit: 10,
          });
    const rows = this.configuration.provider === 'hindsight' ? result.results : result.observations;
    assert(
      Array.isArray(rows),
      502,
      'memory_service_response_invalid',
      'Memory service did not return its expected memory list.',
    );
    const memories = rows
      .slice(0, 10)
      .map((item) => {
        const value = object.parse(item);
        const content =
          this.configuration.provider === 'hindsight' ? string(value.text) : string(value.content);
        assert(
          content !== undefined,
          502,
          'memory_service_response_invalid',
          'Memory service returned an incompatible observation.',
        );
        if (this.configuration.provider === 'claude-mem' && value.projectId !== undefined)
          assert(
            value.projectId === this.configuration.namespace,
            502,
            'memory_service_response_invalid',
            'Memory service returned a different project.',
          );
        return {
          id: reference(value.id) || '',
          content: memoryText(content),
          provenance: recallProvenance(this.configuration.provider, value),
        };
      })
      .filter((item) => item.content);
    // The vendor token budget is advisory; enforce our own actual byte bound.
    const bounded: typeof memories = [];
    const evidence = () => ({
      source: 'optional-memory-service',
      memories: bounded,
      omitted: rows.length - bounded.length,
      capture_freshness:
        'asynchronous; inspect installation activity; empty recall does not prove all captures are indexed',
    });
    for (const item of memories) {
      bounded.push(item);
      if (Buffer.byteLength(JSON.stringify(evidence())) > 16384) bounded.pop();
    }
    return {
      text: JSON.stringify(evidence()),
      receipt: receipt('complete', undefined, result.usage),
    };
  }

  async capture(
    sourceId: string,
    text: string,
    operationId: string,
    occurredAt: Date,
  ): Promise<MemoryReceipt> {
    if (this.configuration.provider === 'hindsight') {
      const result = await this.request(`${this.bank}/memories`, 'POST', {
        async: true,
        operation_id: operationId,
        items: [
          {
            content: text,
            document_id: sourceId,
            timestamp: occurredAt.toISOString(),
            metadata: { source: 'macrofold', source_id: sourceId },
          },
        ],
      });
      const operation = string(result.operation_id);
      assert(
        operation === operationId,
        502,
        'memory_service_response_invalid',
        'Hindsight did not acknowledge the expected retention operation.',
      );
      return receipt('pending', operation, result.usage);
    }
    const result = await this.request('/v1/events?generate=true&wait=false', 'POST', {
      projectId: this.configuration.namespace,
      sourceType: 'api',
      eventType: 'conversation.completed',
      contentSessionId: sourceId,
      platformSource: 'macrofold',
      occurredAtEpoch: occurredAt.getTime(),
      payload: claudeMemoryPayload(sourceId, text),
    });
    const job = object.safeParse(result.generationJob).data;
    assert(
      job && string(job.id),
      502,
      'memory_service_generation_unavailable',
      'Claude-mem stored the event without confirming generation. Check its generation worker.',
    );
    return receipt('pending', string(job.id), job.usage);
  }

  async poll(operationId: string): Promise<MemoryReceipt> {
    const result =
      this.configuration.provider === 'hindsight'
        ? await this.request(`${this.bank}/operations/${encodeURIComponent(operationId)}`)
        : await this.request(`/v1/jobs/${encodeURIComponent(operationId)}`);
    const job = this.configuration.provider === 'hindsight' ? result : object.parse(result.generationJob);
    const status = string(job.status);
    assert(
      status,
      502,
      'memory_service_response_invalid',
      'Memory service did not return a generation status.',
    );
    return receipt(
      ['completed', 'complete', 'succeeded'].includes(status)
        ? 'complete'
        : ['failed', 'cancelled', 'canceled'].includes(status)
          ? 'failed'
          : 'pending',
      operationId,
      job.usage,
    );
  }

  async purge(): Promise<void> {
    const result =
      this.configuration.provider === 'hindsight'
        ? await this.request(this.bank, 'DELETE')
        : await this.request(
            `/v1/projects/${encodeURIComponent(this.configuration.namespace)}/memory`,
            'DELETE',
          );
    if (this.configuration.provider === 'claude-mem')
      assert(
        result.purged === true,
        502,
        'memory_service_purge_unconfirmed',
        'Claude-mem did not confirm project-memory removal.',
      );
  }
}
