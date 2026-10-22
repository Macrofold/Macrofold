import type { Schema } from '../../../sdk/typescript/src/client';
import type { Handler } from './commands';
import { Context, stringOption, type Options, uuid } from './context';
import { protectedJSON } from './json-input';
import { CliError, confirm, terminalText } from './output';

function required(value: string | undefined, label: string): string {
  if (!value) throw new CliError(`${label} is required. Use --help for examples.`);
  return value;
}
function identifier(value: string | undefined, label: string): string {
  const result = required(value, label);
  if (!uuid(result)) throw new CliError(`${label} must be a UUID.`);
  return result;
}
function deployment(args: string[]): string {
  return identifier(args[0], 'Deployment ID');
}
function pagination(flags: Options) {
  return { limit: typeof flags.limit === 'number' ? flags.limit : 25, cursor: stringOption(flags, 'cursor') };
}
function mutation(flags: Options) {
  return { idempotencyKey: stringOption(flags, 'idempotency-key') };
}
async function objectFile(flags: Options, name = 'config-file'): Promise<Record<string, unknown>> {
  const input = await protectedJSON(required(stringOption(flags, name), `--${name} FILE (or - for stdin)`));
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new CliError(`--${name} must contain a JSON object.`);
  return input as Record<string, unknown>;
}
async function workspace(context: Context) {
  return stringOption(context.flags, 'workspace') || context.linked?.link.workspaceId
    ? { workspace_id: (await context.workspace()).id }
    : {};
}

async function service(context: Context, args: string[], flags: Options, desired: 'running' | 'stopped') {
  const id = deployment(args);
  const current = await context.client.request('getModelDeployment', {
    params: { path: { deployment_id: id }, query: await workspace(context) },
  });
  const revision = stringOption(flags, 'revision') || current.desired_revision_id;
  const selected = identifier(revision ?? undefined, '--revision ID');
  const suppliedPolicy = stringOption(flags, 'policy-file');
  const policy = suppliedPolicy ? await objectFile(flags, 'policy-file') : current.policy;
  if (!policy)
    throw new CliError('Supply --policy-file FILE with the explicit operating limits before starting.');
  // The public validator owns the policy union; the CLI sends no provider secrets
  // or privileged management calls. Stop reuses persisted configuration during outages.
  const body = {
    deployment_revision_id: selected,
    desired_state: desired,
    policy,
  } as Schema['ModelDeploymentServiceInput'];
  return context.client.request('setModelDeploymentService', {
    params: { path: { deployment_id: id } },
    body,
    ...mutation(flags),
  });
}

export const modelDeploymentCommands: Record<string, Handler> = {
  'model-deployment inspect': async ({ context, args, flags }) => {
    const file = stringOption(flags, 'config-file');
    if (file && args.length) throw new CliError('Use a repository argument or --config-file, not both.');
    const body = file
      ? await objectFile(flags)
      : {
          source: {
            kind: 'hugging_face',
            repository: required(args[0], 'Hugging Face repository or URL'),
            ...(stringOption(flags, 'source-connection')
              ? {
                  source_connection_id: identifier(
                    stringOption(flags, 'source-connection'),
                    '--source-connection',
                  ),
                }
              : {}),
            ...(stringOption(flags, 'revision') ? { revision: stringOption(flags, 'revision') } : {}),
          },
          task: 'text_generation',
          ...(stringOption(flags, 'compute-connection')
            ? {
                compute_connection_id: identifier(
                  stringOption(flags, 'compute-connection'),
                  '--compute-connection',
                ),
              }
            : {}),
        };
    return {
      data: await (
        await context()
      ).client.request('inspectModelDeployment', { body: body as Schema['ModelDeploymentInspectionInput'] }),
    };
  },
  'model-deployment create': async ({ context, flags }) => ({
    data: await (
      await context()
    ).client.request('createModelDeployment', {
      body: (await objectFile(flags)) as Schema['ModelDeploymentCreate'],
      ...mutation(flags),
    }),
  }),
  'model-deployment list': async ({ context, flags }) => {
    const ctx = await context();
    return {
      data: await ctx.client.request('listModelDeployments', {
        params: { query: { ...pagination(flags), ...(await workspace(ctx)) } },
      }),
    };
  },
  'model-deployment show': async ({ context, args }) => {
    const ctx = await context();
    return {
      data: await ctx.client.request('getModelDeployment', {
        params: { path: { deployment_id: deployment(args) }, query: await workspace(ctx) },
      }),
    };
  },
  'model-deployment revisions': async ({ context, args, flags }) => ({
    data: await (
      await context()
    ).client.request('listModelDeploymentRevisions', {
      params: { path: { deployment_id: deployment(args) }, query: pagination(flags) },
    }),
  }),
  'model-deployment revision': async ({ context, args, flags }) => {
    const ctx = await context();
    return {
      data: await ctx.client.request('getModelDeploymentRevision', {
        params: {
          path: {
            deployment_id: deployment(args),
            revision_id: identifier(stringOption(flags, 'revision'), '--revision ID'),
          },
          query: await workspace(ctx),
        },
      }),
    };
  },
  'model-deployment revise': async ({ context, args, flags }) => ({
    data: await (
      await context()
    ).client.request('createModelDeploymentRevision', {
      params: { path: { deployment_id: deployment(args) } },
      body: (await objectFile(flags)) as Schema['ModelDeploymentRevisionCreate'],
      ...mutation(flags),
    }),
  }),
  'model-deployment grants': async ({ context, args, flags }) => ({
    data: await (
      await context()
    ).client.request('listModelDeploymentGrants', {
      params: { path: { deployment_id: deployment(args) }, query: pagination(flags) },
    }),
  }),
  'model-deployment grant': async ({ context, args, flags }) => ({
    data: await (
      await context()
    ).client.request('createModelDeploymentGrant', {
      params: { path: { deployment_id: deployment(args) } },
      body: (await objectFile(flags)) as Schema['ModelDeploymentGrantInput'],
      ...mutation(flags),
    }),
  }),
  'model-deployment revoke': async ({ context, args, flags }) => ({
    data: await (
      await context()
    ).client.request('revokeModelDeploymentGrant', {
      params: {
        path: {
          deployment_id: deployment(args),
          grant_id: identifier(stringOption(flags, 'grant'), '--grant ID'),
        },
      },
      ...mutation(flags),
    }),
  }),
  'model-deployment start': async ({ context, args, flags }) => ({
    data: await service(await context(), args, flags, 'running'),
  }),
  'model-deployment update': async ({ context, args, flags }) => ({
    data: await service(await context(), args, flags, 'running'),
  }),
  'model-deployment rollback': async ({ context, args, flags }) => {
    identifier(stringOption(flags, 'revision'), '--revision ID');
    return { data: await service(await context(), args, flags, 'running') };
  },
  'model-deployment stop': async ({ context, args, flags }) => ({
    data: await service(await context(), args, flags, 'stopped'),
  }),
  'model-deployment delete': async ({ context, args, flags }) => {
    const id = deployment(args);
    await confirm(
      `Retire deployment ${terminalText(id)} and reconcile owned capacity? Externally operated hosting continues until its owner stops it.`,
      Boolean(flags.yes),
    );
    return {
      data: await (
        await context()
      ).client.request('deleteModelDeployment', {
        params: { path: { deployment_id: id } },
        ...mutation(flags),
      }),
    };
  },
};
