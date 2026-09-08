import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Ajv from 'ajv';
import { transaction } from '../../db';
import { verifyRuntime, type RuntimeCapability } from './runtime-auth';
import { getRun } from './runs';
import { realExecutionEnabled } from './config';
import { assert, errorBody } from './errors';
import { id, seal, unseal, sha256 } from './crypto';
import * as resources from './resources';
import { connectionTools, composio, withMcp } from './connections';
import { computeMaximum } from './catalog';
import { canonical } from './http-contract';
import { emit } from './events';
import { requireRunActor } from './actor-authorization';
import { boundedBody } from './body';
import type { components } from '../../contracts/api';
import { approvedStdio } from './stdio-catalog';
import type { SandboxTools, MachineBinding } from './ports';
import { searchWeb, searchKey } from './search';
type Tool = components['schemas']['Tool'];
const ajv = new Ajv({ strict: false });
export const exposedToolName = (connectionId: string, name: string) =>
  `c_${connectionId.replaceAll('-', '').slice(0, 16)}_${sha256(name).slice(0, 16)}`;
async function authorize(cap: RuntimeCapability, connectionId?: string, tool?: string) {
  return transaction(cap.organization, async (tx) => {
    const run = await getRun(tx, cap.run);
    await requireRunActor(tx, run);
    assert(
      run.lease_generation === cap.lease &&
        ['running', 'waiting_for_input'].includes(run.status) &&
        !run.cancel_requested &&
        run.deadline!.getTime() > Date.now(),
      403,
      'run_unavailable',
      'This run can no longer invoke tools.',
    );
    const connections: resources.Document[] = [];
    for (const grant of run.config.connection_grants || []) {
      if (connectionId && connectionId !== grant.connection_id) continue;
      const connection = await resources.get(tx, 'connections', grant.connection_id);
      const current = connection.grants as components['schemas']['ConnectionGrantSet'];
      if (
        connection.status !== 'healthy' ||
        !(current.subject_type === 'organization' || current.subject_id === run.config.user_id)
      )
        continue;
      const allowed = grant.tools.filter((name) => current.tools.includes(name));
      if (tool && !allowed.includes(tool)) continue;
      connections.push({ ...connection, run_tools: allowed });
    }
    if (connectionId)
      assert(
        connections.length === 1,
        403,
        'tool_not_granted',
        'This connection or tool is no longer granted to the run.',
      );
    return { run, connections };
  });
}
export async function runtimeTools(cap: RuntimeCapability) {
  const { connections } = await authorize(cap);
  const tools: { connection: resources.Document; tool: Tool }[] = [];
  for (const connection of connections) {
    const catalog = await connectionTools(connection);
    for (const tool of catalog)
      if ((connection.run_tools as string[]).includes(tool.name)) tools.push({ connection, tool });
  }
  return tools;
}
export async function executeGrantedTool(
  cap: RuntimeCapability,
  connectionId: string,
  tool: Tool,
  args: Record<string, unknown>,
  callKey: string,
  sandboxTools?: SandboxTools,
) {
  assert(
    realExecutionEnabled(),
    503,
    'paid_execution_disabled',
    'External connector actions are disabled in local simulation.',
  );
  assert(
    ajv.compile(tool.input_schema)(args),
    400,
    'invalid_tool_arguments',
    'Tool arguments do not match the connector schema.',
  );
  const { run, connections } = await authorize(cap, connectionId, tool.name);
  let connection = connections[0];
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
  const versions = JSON.parse(process.env.COMPOSIO_TOOLKIT_VERSIONS_JSON || '{}');
  if (connection.kind === 'composio') {
    assert(
      versions[String(connection.provider)] && versions[String(connection.provider)] !== 'latest',
      503,
      'connector_version_required',
      'Pin a reviewed toolkit version before execution.',
    );
    assert(
      connection.external_account_id && connection.identity_verified,
      409,
      'authorization_required',
      'Authorize the connector account before using its tools.',
    );
  }
  const admission = await transaction(cap.organization, async (tx) => {
    await tx.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE', [cap.run]);
    const current = await getRun(tx, cap.run);
    await requireRunActor(tx, current);
    await tx.query('SELECT id FROM connections WHERE id=$1 FOR SHARE', [connectionId]);
    connection = await resources.get(tx, 'connections', connectionId);
    const grants = connection.grants as components['schemas']['ConnectionGrantSet'];
    assert(
      connection.status === 'healthy' &&
        !connection.deleted &&
        (grants.subject_type === 'organization' || grants.subject_id === current.config.user_id) &&
        grants.tools.includes(tool.name) &&
        current.config.connection_grants?.some(
          (g) => g.connection_id === connectionId && g.tools.includes(tool.name),
        ),
      403,
      'tool_not_granted',
      'This tool grant changed before dispatch.',
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
    const budget = (
      await tx.query('SELECT budget_used_micro_usd,model_reserved_micro_usd FROM runs WHERE id=$1', [cap.run])
    ).rows[0];
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
      const executor = sandboxTools || (await import('../../providers/src/machines')).machines();
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
      const response = await composio().tools.execute(
        tool.name,
        {
          userId: `${cap.organization}:${connection.owner_subject_id}`,
          connectedAccountId: String(connection.external_account_id),
          version: versions[String(connection.provider)],
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
    await authorize(cap);
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
      tools: (await runtimeTools(cap)).map(({ connection, tool }) => ({
        name: exposedToolName(connection.id, tool.name),
        description: `${connection.name}: ${tool.name}. ${tool.description || ''}`,
        inputSchema: tool.input_schema as { type: 'object'; properties?: Record<string, unknown> },
        annotations: { openWorldHint: true },
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (call) => {
      try {
        const available = await runtimeTools(cap);
        const selected = available.find(
          (t) => exposedToolName(t.connection.id, t.tool.name) === call.params.name,
        );
        assert(selected, 403, 'tool_not_granted', 'This tool is not granted to the run.');
        const result = await executeGrantedTool(
          cap,
          selected.connection.id,
          selected.tool,
          call.params.arguments || {},
          String(body.id),
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
