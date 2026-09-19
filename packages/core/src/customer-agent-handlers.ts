import { transaction } from '../../db';
import { input, type Context, type HandlerMap, type PreparationMap } from './api-types';
import {
  customerConversation,
  customerRun,
  ensureCustomerAgent,
  getCustomerBinding,
  listCustomerAgents,
  presentBinding,
} from './customer-agents';
import {
  createCustomerConnection,
  customerConnectionGrants,
  deleteCustomerConnection,
  getCustomerConnection,
  presentCustomerConnection,
  updateCustomerConnectionPermissions,
} from './customer-agent-connections';
import { createCustomerAuthorization, prepareCustomerCompletion } from './customer-connect';
import type { CustomerConnectorProvider } from './customer-connector-provider';
import { enabledConnector } from './connector-enablement';
import * as resources from './resources';
import { admitRun, requestClientType } from './runs';

const binding = (c: Context) =>
  getCustomerBinding(c.tx, c.p, c.params.customer_id, c.params.customer_agent_id);
type Primitives = Required<
  Pick<HandlerMap, 'getRun' | 'getRunResult' | 'listRunEvents' | 'cancelRun' | 'listFiles' | 'readFile'>
>;
export function customerAgentHandlers(core: Primitives): HandlerMap {
  const run =
    <T>(handler: (c: Context) => Promise<T>) =>
    async (c: Context) => {
      await customerRun(c.tx, c.p, await binding(c), c.params.run_id);
      return handler(c);
    };
  const file =
    <T>(handler: (c: Context) => Promise<T>) =>
    async (c: Context) => {
      const b = await binding(c);
      return handler({ ...c, params: { ...c.params, worktree_id: b.worktree_id } });
    };
  return {
    ensureCustomerAgent: (c) =>
      ensureCustomerAgent(c.tx, c.p, c.params.customer_id, input<'CustomerAgentEnsure'>(c)),
    listCustomerAgents: (c) => listCustomerAgents(c.tx, c.p, c.params.customer_id, c.query),
    getCustomerAgent: async (c) => presentBinding(await binding(c)),
    sendCustomerAgentMessage: async (c) => {
      const b = await binding(c),
        value = input<'CustomerAgentMessage'>(c);
      if (value.conversation_id) await customerConversation(c.tx, c.p, b, value.conversation_id);
      return admitRun(
        c.tx,
        c.p,
        {
          prompt: value.prompt,
          attachments: value.attachments,
          limits: value.limits,
          queue_if_busy: value.queue_if_busy,
          ...(value.conversation_id
            ? { session_id: value.conversation_id }
            : { worktree_id: b.worktree_id, agent_id: b.agent_id }),
          connection_grants: await customerConnectionGrants(c.tx, b),
        },
        requestClientType(c.request),
      );
    },
    listCustomerAgentConversations: async (c) => {
      const b = await binding(c);
      return resources.list(c.tx, 'sessions', c.p, c.query, {
        worktree_id: b.worktree_id,
        agent_id: b.agent_id,
      });
    },
    getCustomerAgentRun: run(core.getRun),
    getCustomerAgentRunResult: run(core.getRunResult),
    listCustomerAgentRunEvents: run(core.listRunEvents),
    cancelCustomerAgentRun: run(core.cancelRun),
    listCustomerAgentFiles: file(core.listFiles),
    readCustomerAgentFile: file(core.readFile),
    listCustomerAgentConnections: async (c) => {
      const b = await binding(c),
        limit = Number(c.query.get('limit') || 25);
      const rows = (
        await c.tx.query<{ connection_id: string }>(
          `SELECT l.connection_id FROM customer_agent_connections l JOIN connections c ON c.id=l.connection_id
         WHERE l.binding_id=$1 AND ($2::uuid IS NULL OR c.id<$2) AND coalesce(c.data->>'deleted','false')<>'true'
         ORDER BY c.id DESC LIMIT $3`,
          [b.id, c.query.get('cursor'), limit + 1],
        )
      ).rows;
      return {
        data: await Promise.all(
          rows.slice(0, limit).map((r) => presentCustomerConnection(c.tx, c.p, b, r.connection_id)),
        ),
        next_cursor: rows.length > limit ? rows[limit - 1].connection_id : null,
      };
    },
    deleteCustomerAgentConnection: async (c) =>
      deleteCustomerConnection(c.tx, c.p, await binding(c), c.params.connection_id),
    authorizeCustomerAgentConnection: async (c) =>
      createCustomerAuthorization(
        c.tx,
        c.p,
        await binding(c),
        c.params.connection_id,
        input<'CustomerConnectionAuthorize'>(c).return_url,
      ),
  };
}
export function customerAgentPreparations(provider: CustomerConnectorProvider): PreparationMap {
  return {
    createCustomerAgentConnection: async (c) => {
      const value = input<'CustomerAgentConnectionCreate'>(c);
      await transaction(c.p.organizationId, (tx) =>
        getCustomerBinding(tx, c.p, c.params.customer_id, c.params.customer_agent_id),
      );
      const setup = await enabledConnector(value.provider);
      const catalog = await provider.tools(setup.toolkit, setup.toolkit_version);
      return {
        async commit(tx, p) {
          return createCustomerConnection(tx, p, await binding({ ...c, tx, p }), value, catalog);
        },
        async dispose() {},
      };
    },
    updateCustomerAgentConnectionPermissions: async (c) => {
      const { connection } = await transaction(c.p.organizationId, async (tx) =>
        getCustomerConnection(tx, c.p, await binding({ ...c, tx }), c.params.connection_id),
      );
      const selected = input<'CustomerAgentConnectionPermissions'>(c).capability_ids;
      const setup = selected.length ? await enabledConnector(connection.provider!) : undefined;
      const catalog = setup ? await provider.tools(setup.toolkit, setup.toolkit_version) : [];
      return {
        async commit(tx, p) {
          return updateCustomerConnectionPermissions(
            tx,
            p,
            await binding({ ...c, tx, p }),
            connection.id,
            selected,
            c.request.headers.get('if-match') || '',
            catalog,
          );
        },
        async dispose() {},
      };
    },
    completeCustomerAgentConnection: (c) =>
      prepareCustomerCompletion(
        c.p,
        c.params.customer_id,
        c.params.customer_agent_id,
        c.params.connection_id,
        input<'CustomerConnectionComplete'>(c).code,
        provider,
      ),
  };
}
