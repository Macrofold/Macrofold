import { enabledConnector } from './connector-enablement';
import { runtimeConnectionTools, type RuntimeConnectionRun } from './connection-access-resolution';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { validateToolArguments } from './tool-arguments';
import { transaction, type Tx } from '../../db';
import { verifyRuntime, type RuntimeCapability } from './runtime-auth';
import { getNativeRun, currentRunControl, runControlColumns, type NativeRunRow } from './runs';
import { realExecutionEnabled } from './config';
import { assert, errorBody } from './errors';
import { id, seal, unseal, sha256, canonical } from './crypto';
import * as resources from './resources';
import { connectionTools, composio, withMcp } from './connections';
import { computeMaximum } from './catalog';
import { reserve } from './ledger';
import { emit } from './events';
import { requireRunActor } from './actor-authorization';
import { boundedBody } from './body';
import type { components } from '../../contracts/api';
import { approvedStdio } from './stdio-catalog';
import type { MachineTools, MachineBinding } from './ports';
import { searchWeb, searchKey } from './search';
type Tool = components['schemas']['Tool'];
type ToolRunConfig = RuntimeConnectionRun['config'] &
  Pick<NativeRunRow['config'], 'limits' | 'compute_rate_micro_usd_per_minute'>;
type ToolRun = Omit<NativeRunRow, 'config'> & { config: ToolRunConfig };
const toolConfigKeys = [
  'connection_access',
  'connection_grants',
  'permission_layers',
  'principal_id',
  'principal_kind',
  'user_id',
  'workspace_ids',
  'oauth_token_id',
  'oauth_audience',
  'worker_id',
  'agent_id',
  'limits',
  'compute_rate_micro_usd_per_minute',
] as const satisfies readonly (keyof ToolRunConfig)[];
/** Native prompts/attachments are executable payload, not tool authority. Keep
 * this projection explicit so adding a large config field cannot slow each call. */
async function getToolRun(tx: Tx, runId: string): Promise<ToolRun> {
  const row = (
    await tx.query<ToolRun>(
      `SELECT ${runControlColumns},jsonb_build_object(${toolConfigKeys
        .map((key) => `'${key}',config->'${key}'`)
        .join(',')}) AS config FROM runs WHERE id=$1 AND kind='native_agent'`,
      [runId],
    )
  ).rows[0];
  assert(row, 404, 'not_found', 'Run not found.');
  return row;
}
export const exposedToolName = (connectionId: string, name: string) =>
  `c_${connectionId.replaceAll('-', '').slice(0, 16)}_${sha256(name).slice(0, 16)}`;
async function authorize(
  cap: RuntimeCapability,
  connectionId?: string,
  tool?: string,
  exposedPrefix?: string,
  preparedRun?: ToolRun,
) {
  return transaction(cap.organization, async (tx) => {
    const run = preparedRun ?? (await getToolRun(tx, cap.run));
    if (!preparedRun) await requireRunActor(tx, run);
    assert(
      run.lease_generation === cap.lease &&
        ['running', 'waiting_for_input'].includes(run.status) &&
        !run.cancel_requested &&
        run.deadline!.getTime() > Date.now(),
      403,
      'run_unavailable',
      'This run can no longer invoke tools.',
    );
    const connections: (resources.Document<'connections'> & { run_tools: string[] })[] = [];
    for (const grant of run.config.connection_grants || []) {
      if (connectionId && connectionId !== grant.connection_id) continue;
      if (exposedPrefix && grant.connection_id.replaceAll('-', '').slice(0, 16) !== exposedPrefix) continue;
      const connection = await resources.get(tx, 'connections', grant.connection_id);
      const allowed = await runtimeConnectionTools(tx, run, connection);
      if (!allowed.length || (tool && !allowed.includes(tool))) continue;
      connections.push({ ...connection, run_tools: allowed });
    }
    if (connectionId || exposedPrefix)
      assert(
        connections.length === 1,
        403,
        'tool_not_granted',
        'This connection or tool is no longer granted to the run.',
      );
    return { run, connections };
  });
}
export function runtimeTools(cap: RuntimeCapability) {
  return runtimeToolCatalog(cap);
}
async function runtimeToolCatalog(cap: RuntimeCapability, preparedRun?: ToolRun) {
  const { connections } = await authorize(cap, undefined, undefined, undefined, preparedRun);
  const tools: { connection: resources.Document<'connections'> & { run_tools: string[] }; tool: Tool }[] = [];
  for (const connection of connections) {
    const catalog = await connectionTools(connection);
    for (const tool of catalog)
      if ((connection.run_tools as string[]).includes(tool.name)) tools.push({ connection, tool });
  }
  return tools;
}
/** The exposed connection prefix narrows discovery to one authorized account.
 * The hash is a selector only; current grants still authorize the actual tool. */
async function selectedRuntimeTool(cap: RuntimeCapability, name: string, preparedRun: ToolRun) {
  const prefix = /^c_([a-f0-9]{16})_[a-f0-9]{16}$/.exec(name)?.[1];
  assert(prefix, 403, 'tool_not_granted', 'This tool is not granted to the run.');
  const prepared = await authorize(cap, undefined, undefined, prefix, preparedRun);
  const connection = prepared.connections[0];
  const tool = (await connectionTools(connection)).find(
    (tool) => connection.run_tools.includes(tool.name) && exposedToolName(connection.id, tool.name) === name,
  );
  assert(tool, 403, 'tool_not_granted', 'This tool is not granted to the run.');
  return { ...prepared, tool };
}
export async function executeGrantedTool(
  cap: RuntimeCapability,
  connectionId: string,
  tool: Tool,
  args: Record<string, unknown>,
  callKey: string,
  machineTools?: MachineTools,
) {
  return executePreparedTool(cap, connectionId, tool, args, callKey, machineTools);
}
async function executePreparedTool(
  cap: RuntimeCapability,
  connectionId: string,
  tool: Tool,
  args: Record<string, unknown>,
  callKey: string,
  machineTools?: MachineTools,
  prepared?: Awaited<ReturnType<typeof authorize>>,
) {
  assert(
    realExecutionEnabled(),
    503,
    'paid_execution_disabled',
    'External connector actions are disabled in local simulation.',
  );
  validateToolArguments(tool.input_schema, args);
  const { run, connections } = prepared ?? (await authorize(cap, connectionId, tool.name));
  let connection: resources.Document<'connections'> = connections[0];
  const preparedRevision = connection.revision;
  const rate =
    connection.kind === 'composio'
      ? process.env.COMPOSIO_MICRO_USD_PER_CALL
      : connection.kind === 'search' && connection.auth_method === 'none'
        ? process.env.BRAVE_SEARCH_MICRO_USD_PER_CALL
        : '0';
  if (connection.kind === 'search') searchKey(connection);
  if (connection.kind === 'mcp_stdio') approvedStdio(connection.package, connection.package_version);
  assert(
    rate && /^\d{1,12}$/.test(rate),
    503,
    'connector_rate_required',
    'Configure the connector retail fee before enabling execution.',
  );
  const fee = BigInt(rate),
    fingerprint = sha256(canonical({ connectionId, tool: tool.name, args }));
  const setup =
    connection.kind === 'composio' ? await enabledConnector(String(connection.provider)) : undefined;
  if (connection.kind === 'composio') {
    assert(
      connection.external_account_id && connection.identity_verified,
      409,
      'authorization_required',
      'Authorize the connector account before using its tools.',
    );
  }
  const admission = await transaction(cap.organization, async (tx) => {
    const current = await currentRunControl(tx, run);
    await requireRunActor(tx, current);
    await tx.query('SELECT id FROM connections WHERE id=$1 FOR SHARE', [connectionId]);
    connection = await resources.get(tx, 'connections', connectionId);
    assert(
      (await runtimeConnectionTools(tx, current, connection)).includes(tool.name),
      403,
      'tool_not_granted',
      'This tool access changed before dispatch.',
    );
    assert(
      current.lease_generation === cap.lease &&
        current.deadline!.getTime() > Date.now() &&
        ['running', 'waiting_for_input'].includes(current.status) &&
        !current.cancel_requested,
      409,
      'run_unavailable',
      'The run stopped before tool admission.',
    );
    const prior = (
      await tx.query('SELECT * FROM tool_invocations WHERE run_id=$1 AND call_key=$2', [cap.run, callKey])
    ).rows[0];
    if (prior) {
      assert(
        prior.fingerprint === fingerprint,
        409,
        'idempotency_conflict',
        'This tool call identity was reused with different arguments.',
      );
      assert(
        prior.status === 'complete',
        409,
        'tool_outcome_unknown',
        'This tool may already have executed. Inspect its destination before retrying with a new call identity.',
      );
      return { prior: unseal<Record<string, unknown>>(prior.result_ciphertext), id: prior.id };
    }
    assert(
      connection.revision === preparedRevision,
      409,
      'connection_changed',
      'This connection changed during tool preparation. Reload its tools before retrying.',
    );
    const budget = current;
    assert(
      BigInt(budget.budget_used_micro_usd) +
        BigInt(budget.model_reserved_micro_usd) +
        fee +
        computeMaximum(run.config.limits!.timeout_seconds!, run.config.compute_rate_micro_usd_per_minute) <=
        BigInt(run.config.limits!.max_cost_micro_usd!),
      402,
      'run_budget_exhausted',
      'The connector action would exceed the remaining budget.',
    );
    const invocation = id();
    // Local BYOK runs need no upfront credits. Fund actual platform tool liability
    // before dispatch, under the same run lock as the budget and invocation writes.
    const additional = BigInt(current.cost_micro_usd) + fee - BigInt(current.reservation_micro_usd);
    if (additional > 0n) {
      await reserve(tx, cap.organization, additional);
      await tx.query('UPDATE runs SET reservation_micro_usd=reservation_micro_usd+$2::bigint WHERE id=$1', [
        cap.run,
        additional.toString(),
      ]);
    }
    // Tool action costs are fixed retail fees, charged at dispatch, including ambiguous outcomes.
    await tx.query(
      'UPDATE runs SET budget_used_micro_usd=budget_used_micro_usd+$2::bigint,cost_micro_usd=cost_micro_usd+$2::bigint WHERE id=$1',
      [cap.run, fee.toString()],
    );
    await tx.query(
      "INSERT INTO tool_invocations(id,organization_id,run_id,connection_id,call_key,fingerprint,tool_name,status,cost_micro_usd) VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$8)",
      [invocation, cap.organization, cap.run, connectionId, callKey, fingerprint, tool.name, fee.toString()],
    );
    await emit(tx, cap.organization, cap.run, 'tool.started', {
      tool_call_id: invocation,
      name: tool.name,
      connection_id: connectionId,
      arguments: args,
    });
    return { id: invocation };
  });
  if (admission.prior) return admission.prior;
  let result: Record<string, unknown>;
  try {
    if (connection.kind === 'search') {
      result = await searchWeb(
        connection,
        args,
        AbortSignal.timeout(Math.max(0, run.deadline!.getTime() - Date.now())),
      );
    } else if (connection.kind === 'mcp_stdio') {
      const entry = approvedStdio(connection.package, connection.package_version);
      const binding = (run.execution_binding as { machine?: MachineBinding } | null)?.machine;
      assert(binding, 409, 'execution_unavailable', 'The running sandbox is unavailable.');
      // Machine provider construction needs its execution configuration. Remote
      // tools never download the native prompt merely to authorize a call.
      const executor =
        machineTools ||
        (await import('../../providers/src/machines')).machines(
          await transaction(cap.organization, (tx) => getNativeRun(tx, cap.run)),
        );
      result = await executor.invokeStdio(binding, {
        id: admission.id,
        runId: run.id,
        command: entry.command,
        args: entry.args,
        environment: connection.environment_ciphertext
          ? unseal<Record<string, string>>(String(connection.environment_ciphertext))
          : {},
        tool: tool.name,
        arguments: args,
      });
    } else if (connection.kind === 'composio') {
      assert(setup, 503, 'integration_not_configured', 'This app needs operator setup.');
      const response = await composio().tools.execute(
        tool.name,
        {
          userId: connection.provider_subject_id || `${cap.organization}:${connection.owner_subject_id}`,
          connectedAccountId: String(connection.external_account_id),
          version: setup.toolkit_version,
          arguments: args,
        },
        { signal: AbortSignal.timeout(Math.min(45000, run.deadline!.getTime() - Date.now())) },
      );
      result = {
        content: [{ type: 'text', text: JSON.stringify(response.data) }],
        isError: !response.successful,
      };
    } else
      result = (await withMcp(connection, (client) =>
        client.callTool({ name: tool.name, arguments: args }, undefined, { timeout: 45000 }),
      )) as Record<string, unknown>;
    assert(
      Buffer.byteLength(JSON.stringify(result)) <= 2 * 1024 * 1024,
      502,
      'tool_result_too_large',
      'The tool returned more than 2 MiB. Its external action may have completed.',
    );
  } catch (error) {
    await transaction(cap.organization, async (tx) => {
      await tx.query("UPDATE tool_invocations SET status='unknown',completed_at=now() WHERE id=$1", [
        admission.id,
      ]);
      await emit(tx, cap.organization, cap.run, 'tool.completed', {
        tool_call_id: admission.id,
        name: tool.name,
        is_error: true,
        outcome: 'unknown',
      });
    });
    throw error;
  }
  await transaction(cap.organization, async (tx) => {
    await tx.query(
      "UPDATE tool_invocations SET status='complete',result_ciphertext=$2,completed_at=now() WHERE id=$1",
      [admission.id, seal(result)],
    );
    await emit(tx, cap.organization, cap.run, 'tool.completed', {
      tool_call_id: admission.id,
      name: tool.name,
      result,
    });
  });
  return result;
}
export async function handleRuntimeMcp(request: Request, runId: string) {
  const requestId = id();
  try {
    assert(request.method === 'POST', 405, 'method_not_allowed', 'This stateless MCP accepts POST requests.');
    const cap = verifyRuntime(request, runId);
    // Authenticate at the transport boundary, preserving HTTP denial semantics
    // for expired/revoked actors. Catalog projection reuses this preparation;
    // effect admission independently rechecks current authority after discovery.
    const preparedRun = await transaction(cap.organization, async (tx) => {
      const run = await getToolRun(tx, cap.run);
      await requireRunActor(tx, run);
      assert(
        run.lease_generation === cap.lease &&
          !run.cancel_requested &&
          ['running', 'waiting_for_input'].includes(run.status) &&
          run.deadline &&
          run.deadline.getTime() > Date.now(),
        403,
        'run_unavailable',
        'This run can no longer invoke tools.',
      );
      return run;
    });
    const bytes = await boundedBody(request.body, 1024 * 1024);
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(bytes.toString());
    } catch {
      assert(false, 400, 'invalid_json', 'MCP request must be valid JSON.');
    }
    assert(
      body && typeof body === 'object' && !Array.isArray(body),
      400,
      'invalid_request',
      'MCP request must be an object.',
    );
    if (body.method === 'tools/call')
      assert(
        typeof body.id === 'string' || typeof body.id === 'number',
        400,
        'invalid_request',
        'Tool calls require a stable JSON-RPC request ID.',
      );
    const server = new Server({ name: 'platform-tools', version: '0.1.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: (await runtimeToolCatalog(cap, preparedRun)).map(({ connection, tool }) => ({
        name: exposedToolName(connection.id, tool.name),
        description: `${connection.name}: ${tool.name}. ${tool.description || ''}`,
        inputSchema: tool.input_schema as { type: 'object'; properties?: Record<string, unknown> },
        annotations: { openWorldHint: true },
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (call) => {
      try {
        const selected = await selectedRuntimeTool(cap, call.params.name, preparedRun);
        const result = await executePreparedTool(
          cap,
          selected.connections[0].id,
          selected.tool,
          call.params.arguments || {},
          String(body.id),
          undefined,
          selected,
        );
        return result as { content: { type: 'text'; text: string }[] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify(errorBody(error, requestId).body) }],
        };
      }
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(
        new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: bytes,
          signal: request.signal,
        }),
      );
    } finally {
      await server.close();
    }
  } catch (error) {
    const result = errorBody(error, requestId);
    return Response.json(result.body, { status: result.status });
  }
}
