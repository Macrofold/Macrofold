import { readFile } from 'node:fs/promises';
import type { Handler } from './commands';
import { stringOption, uuid } from './context';
import { CliError, confirm } from './output';
import { protectedJSON } from './json-input';
import type { Schema } from '../../../sdk/typescript/src/client';

const identifier = (args: string[]) => {
  if (!args[0] || !uuid(args[0]))
    throw new CliError('Supply an installation ID from macrofold integration list.');
  return args[0];
};

export const integrationCommands: Record<string, Handler> = {
  'integration catalog': async ({ context }) => ({
    data: await (await context()).client.request('listIntegrationPacks'),
  }),
  'integration list': async ({ context, flags }) => ({
    data: await (
      await context()
    ).client.request('listAgentIntegrations', {
      params: {
        query: {
          workspace_id: (await (await context()).workspace()).id,
          cursor: stringOption(flags, 'cursor'),
          limit: typeof flags.limit === 'number' ? flags.limit : 25,
        },
      },
    }),
  }),
  'integration add': async ({ context, args, flags }) => {
    const pack = args[0];
    if (!['file-memory', 'hindsight', 'claude-mem'].includes(pack))
      throw new CliError('Choose file-memory, hindsight or claude-mem.');
    const file = stringOption(flags, 'config-file');
    if (pack !== 'file-memory' && !file)
      throw new CliError(
        'Service memory requires --config-file FILE with connection_id, dedicated namespace and explicit external-cost approval. See /docs/customer-agents/agent-library.',
      );
    const service = file
      ? ((await protectedJSON(file)) as Schema['AgentIntegrationCreate']['service'])
      : undefined;
    const c = await context(),
      worktree = await c.worktree();
    return {
      data: await c.client.request('createAgentIntegration', {
        body: {
          pack_id: pack as Schema['AgentIntegrationCreate']['pack_id'],
          workspace_id: worktree.workspace_id,
          worktree_id: worktree.id,
          ...(service ? { service } : {}),
        },
      }),
    };
  },
  'integration get': async ({ context, args }) => ({
    data: await (
      await context()
    ).client.request('getAgentIntegration', { params: { path: { integration_id: identifier(args) } } }),
  }),
  'integration state': async ({ context, args }) => {
    const c = await context(),
      integration_id = identifier(args),
      state = args[1];
    if (!['active', 'paused', 'disabled'].includes(state))
      throw new CliError('Choose active, paused or disabled after the installation ID.');
    const current = await c.client.request('getAgentIntegration', { params: { path: { integration_id } } });
    return {
      data: await c.client.request('updateAgentIntegration', {
        params: { path: { integration_id }, header: { 'If-Match': `"${current.revision}"` } },
        body: { state: state as 'active' | 'paused' | 'disabled' },
      }),
    };
  },
  'integration memories': async ({ context, args, flags }) => ({
    data: await (
      await context()
    ).client.request('listAgentIntegrationMemories', {
      params: {
        path: { integration_id: identifier(args) },
        query: {
          cursor: stringOption(flags, 'cursor'),
          limit: typeof flags.limit === 'number' ? flags.limit : 25,
        },
      },
    }),
  }),
  'integration export': async ({ context, args }) => ({
    data: await (
      await context()
    ).client.request('exportAgentIntegrationMemory', {
      params: { path: { integration_id: identifier(args) } },
    }),
  }),
  'integration activity': async ({ context, args, flags }) => ({
    data: await (
      await context()
    ).client.request('listAgentIntegrationActivity', {
      params: {
        path: { integration_id: identifier(args) },
        query: {
          cursor: stringOption(flags, 'cursor'),
          limit: typeof flags.limit === 'number' ? flags.limit : 25,
        },
      },
    }),
  }),
  'integration note': async ({ context, args, flags }) => {
    const file = stringOption(flags, 'file');
    if (!file) throw new CliError('Supply --file FILE containing the confirmed note or correction.');
    return {
      data: await (
        await context()
      ).client.request('createAgentIntegrationNote', {
        params: { path: { integration_id: identifier(args) } },
        body: { content: await readFile(file, 'utf8') },
      }),
    };
  },
  'integration search': async ({ context, args }) => {
    const integration_id = identifier(args),
      query = args.slice(1).join(' ');
    if (!query)
      throw new CliError(
        'Supply a query after the installation ID. This may incur external service read charges.',
      );
    return {
      data: await (
        await context()
      ).client.request('searchAgentIntegrationMemory', {
        params: { path: { integration_id } },
        body: { query },
      }),
    };
  },
  'integration check': async ({ context, args, flags }) => {
    const source_id = stringOption(flags, 'source');
    if (!source_id || !uuid(source_id))
      throw new CliError(
        'Supply --source SOURCE_ID from integration activity. This checks an acknowledged job without resubmitting generation.',
      );
    return {
      data: await (
        await context()
      ).client.request('retryAgentIntegrationCheck', {
        params: { path: { integration_id: identifier(args), source_id } },
      }),
    };
  },
  'integration forget': async ({ context, args, flags }) => {
    const c = await context(),
      integration_id = identifier(args);
    const installed = await c.client.request('getAgentIntegration', { params: { path: { integration_id } } });
    await confirm(
      'Disable recall and request deletion of this entire dedicated service collection? Past Run records and provider backups have separate retention.',
      !!flags.yes,
    );
    return {
      data: await c.client.request('forgetAgentIntegrationMemory', {
        params: { path: { integration_id }, header: { 'If-Match': `"${installed.revision}"` } },
        body: { confirm_delete_all: true },
      }),
    };
  },
  'integration write': async ({ context, args, flags }) => {
    const c = await context(),
      integration_id = identifier(args),
      path = args[1],
      file = stringOption(flags, 'file'),
      revision = stringOption(flags, 'revision');
    if (!path || !file || !revision)
      throw new CliError(
        'Use integration write ID PATH --file FILE --revision WORKTREE_REVISION. Read current revisions with integration memories.',
      );
    return {
      data: await c.client.request('writeAgentIntegrationMemory', {
        params: { path: { integration_id }, query: { path }, header: { 'If-Match': `"${revision}"` } },
        body: { content: await readFile(file, 'utf8') },
      }),
    };
  },
  'integration remove': async ({ context, args, flags }) => {
    const integration_id = identifier(args);
    if (!flags.yes)
      await confirm('Remove this installation? Current memory files and past conversations will remain.');
    return {
      data: await (
        await context()
      ).client.request('deleteAgentIntegration', { params: { path: { integration_id } } }),
    };
  },
};
