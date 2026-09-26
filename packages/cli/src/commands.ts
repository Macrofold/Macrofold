import { readFile, writeFile, lstat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { Schema } from '../../../sdk/typescript/src/client';
import { Client, serviceOrigin } from '../../../sdk/typescript/src/client';
import {
  Context,
  execution,
  connectionSelection,
  limits,
  scheduling,
  stringOption,
  type Options,
  uuid,
} from './context';
import { deviceLogin, logout, profileSummaries, saveProfile } from './profiles';
import { findLink, unlinkWorkspace } from './local-workspace';
import { release } from './settings';
import { CliError, confirm, prompt, readStdin, terminalText } from './output';
import { streamCommand, outcomeExit } from './stream';
import { transferFiles } from './transfers';
import { checkout } from './checkout';
import { chat } from './chat';
import { workerCommands, workerRunOptions } from './workers';

export type CommandResult = { data: unknown; exitCode?: number; printed?: boolean };
export type Invocation = { args: string[]; flags: Options; context: () => Promise<Context> };
export type Handler = (invocation: Invocation) => Promise<CommandResult>;
const required = (value: string | undefined, label: string) => {
  if (!value) throw new CliError(`${label} is required. Use --help for examples.`);
  return value;
};
const result = (data: unknown): CommandResult => ({ data });
const page = (flags: Options) => ({
  cursor: stringOption(flags, 'cursor'),
  limit: flags.limit ? Number(flags.limit) : 20,
});
async function completed(context: Context, operation: Schema['Operation']) {
  const value = await context.client.waitOperation(operation.id);
  if (value.status !== 'succeeded')
    throw new CliError(value.error?.message || `Operation ${value.id} failed.`, 5);
  return value;
}
async function promptText(args: string[], flags: Options) {
  const file = stringOption(flags, 'prompt-file');
  const text = file ? (file === '-' ? await readStdin() : await readFile(file, 'utf8')) : args.join(' ');
  if (file && args.length) throw new CliError('Use a prompt argument or --prompt-file, not both.');
  if (!text.trim()) throw new CliError('Provide a prompt or --prompt-file.');
  if (text.length > 100000) throw new CliError('Prompt exceeds 100,000 characters.');
  return text;
}
async function protectedJSON(file: string) {
  if (file === '-') return JSON.parse(await readStdin()) as unknown;
  const stat = await lstat(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new CliError('Use an ordinary protected JSON file.');
  if (process.platform !== 'win32' && stat.mode & 0o077)
    throw new CliError('Secret input files must have private permissions (chmod 600 FILE).');
  if (stat.size > 4 * 1024 * 1024) throw new CliError('Input file exceeds 4 MiB.');
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}
function openBrowser(url: string) {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}

export const handlers: Record<string, Handler> = {
  ...workerCommands,
  version: async () =>
    result({ version: release.version, executable: release.executable, node: process.versions.node }),
  config: async () => result(await profileSummaries()),
  login: async ({ flags }) => {
    const origin = serviceOrigin(
      required(
        stringOption(flags, 'host') || process.env.AGENT_HOST || (await prompt('Service URL: ')),
        '--host URL',
      ),
    );
    const profile = stringOption(flags, 'profile') || 'default';
    if (flags['api-key-stdin']) {
      const apiKey = (await readStdin()).trim();
      if (!apiKey.startsWith('sk_')) throw new CliError('Expected an API key on stdin.');
      const identity = await new Client({
        baseURL: origin,
        token: apiKey,
        organization: stringOption(flags, 'organization'),
        clientType: 'cli',
      }).request('getIdentity');
      await saveProfile(profile, { origin, apiKey, organization: stringOption(flags, 'organization') });
      return result({ profile, origin, identity });
    }
    await deviceLogin({
      origin,
      profile,
      scope: Array.isArray(flags.scope) ? flags.scope : [],
      onCode: (url, code) => {
        process.stderr.write(`Open ${terminalText(url)}\nVerification code: ${terminalText(code)}\n`);
        if (process.stdin.isTTY && !flags['no-browser']) openBrowser(url);
      },
    });
    return result({ authenticated: true, profile, origin });
  },
  logout: async ({ flags }) => result(await logout(stringOption(flags, 'profile'))),
  whoami: async ({ context }) => result(await (await context()).identity()),
  'workspace list': async ({ context, flags }) =>
    result(await (await context()).client.request('listWorkspaces', { params: { query: page(flags) } })),
  'workspace create': async ({ context, args, flags }) =>
    result(
      await (
        await context()
      ).client.request('createWorkspace', {
        body: {
          name: required(args.join(' '), 'Workspace name'),
          persistence: flags.ephemeral ? 'ephemeral' : 'persistent',
        },
      }),
    ),
  'workspace show': async ({ context, args }) => result(await (await context()).workspace(args[0])),
  link: async ({ context, args, flags }) => {
    const ctx = await context(),
      workspace = await ctx.workspace(required(args[0] || stringOption(flags, 'workspace'), 'Workspace'));
    const worktree = await ctx.worktree(stringOption(flags, 'worktree') || workspace.default_worktree_id);
    if (worktree.workspace_id !== workspace.id) throw new CliError('Worktree and workspace do not match.', 5);
    return result(await ctx.link(worktree, process.cwd()));
  },
  unlink: async () => {
    const linked = await findLink();
    if (!linked) throw new CliError('This directory is not linked.');
    await unlinkWorkspace(linked.root);
    return result({ unlinked: true, directory: linked.root });
  },
  'worktree list': async ({ context, flags }) => {
    const ctx = await context();
    return result(
      await ctx.client.request('listWorktrees', {
        params: { path: { workspace_id: (await ctx.workspace()).id }, query: page(flags) },
      }),
    );
  },
  'worktree create': async ({ context, args, flags }) => {
    const ctx = await context(),
      from = stringOption(flags, 'from');
    const operation = await ctx.client.request('createWorktree', {
      params: { path: { workspace_id: (await ctx.workspace()).id } },
      body: {
        name: required(args[0], 'Worktree name'),
        branch: stringOption(flags, 'branch'),
        ...(from
          ? {
              source: uuid(from)
                ? { kind: 'checkpoint', checkpoint_id: from }
                : { kind: 'git_ref', ref: from },
            }
          : {}),
      },
    });
    const value = await completed(ctx, operation);
    if (flags.use) {
      const worktreeId = String(value.result?.worktree_id || value.result?.id || '');
      if (!uuid(worktreeId)) throw new CliError('Worktree creation returned no worktree ID.', 7);
      await ctx.link(await ctx.worktree(worktreeId));
    }
    return result(value);
  },
  'worktree use': async ({ context, args }) => {
    const ctx = await context();
    return result(await ctx.link(await ctx.worktree(required(args[0], 'Worktree'))));
  },
  'worktree remove': async ({ context, args, flags }) => {
    const ctx = await context(),
      worktree = await ctx.worktree(required(args[0], 'Worktree'));
    await confirm(`Delete remote worktree ${terminalText(worktree.name)}?`, Boolean(flags.yes));
    return result(
      await completed(
        ctx,
        await ctx.client.request('deleteWorktree', { params: { path: { worktree_id: worktree.id } } }),
      ),
    );
  },
  'worktree checkout': async ({ context, args, flags }) => {
    const ctx = await context();
    if (!ctx.linked) throw new CliError('Link this local Git repository first.');
    const worktree = await ctx.worktree(args[0]);
    const value = await checkout(
      ctx.client,
      ctx.linked.root,
      worktree,
      required(stringOption(flags, 'local'), '--local PATH'),
      stringOption(flags, 'branch'),
    );
    await ctx.link(worktree, value.directory);
    return result(value);
  },
  run: async ({ context, args, flags }) => {
    const text = await promptText(args, flags),
      ctx = await context(),
      session = await ctx.session();
    const placement = await workerRunOptions(ctx);
    let run: Schema['RunAccepted'];
    if (session) {
      if (flags.agent || flags['provider-connection'] || flags['billing-mode'])
        throw new CliError('Agent and funding changes require a new session.');
      run = await ctx.client.request('continueSession', {
        params: { path: { session_id: session.id } },
        body: {
          ...placement,
          prompt: text,
          queue_if_busy: Boolean(flags.queue),
          ...scheduling(flags),
          model: stringOption(flags, 'model'),
          connection_grants: connectionSelection(flags),
          limits: limits(flags),
        },
      });
    } else {
      const settings = execution(flags);
      const agentId = stringOption(flags, 'agent');
      if (agentId && !uuid(agentId)) throw new CliError('--agent requires a saved agent preset ID.');
      if (!agentId && (!settings.harness || !settings.model))
        throw new CliError('Choose --agent, --harness and --model, or a --session.');
      const presetLimits =
        agentId && flags.timeout && !flags['max-cost']
          ? (await ctx.client.agents.get(agentId)).limits
          : undefined;
      run = await ctx.client.request('createRun', {
        body: {
          ...placement,
          prompt: text,
          worktree_id: (await ctx.worktree()).id,
          ...(agentId
            ? {
                agent_id: agentId,
                ...(flags.timeout || flags['max-cost']
                  ? {
                      limits: {
                        ...(flags.timeout ? { timeout_seconds: settings.limits.timeout_seconds } : {}),
                        max_cost_micro_usd:
                          presetLimits?.max_cost_micro_usd || settings.limits.max_cost_micro_usd,
                      },
                    }
                  : {}),
              }
            : settings),
          connection_grants: settings.connection_grants,
          ...scheduling(flags),
        },
      });
    }
    if (flags.detach) return result(run);
    const final = await streamCommand(ctx.client, run.run_id, {
      json: Boolean(flags.json),
      jsonl: Boolean(flags.jsonl),
      plain: Boolean(flags.plain),
      after: '0',
    });
    return { data: final, exitCode: outcomeExit(final), printed: !flags.json };
  },
  'run list': async ({ context, flags }) => {
    const ctx = await context();
    return result(
      await ctx.client.request('listRuns', {
        params: {
          query: {
            ...page(flags),
            worktree_id: stringOption(flags, 'worktree') ? (await ctx.worktree()).id : undefined,
            session_id: stringOption(flags, 'session'),
            status: stringOption(flags, 'status'),
          },
        },
      }),
    );
  },
  'run show': async ({ context, args }) => {
    const ctx = await context(),
      runId = required(args[0], 'Run ID');
    const [run, resultValue] = await Promise.all([
      ctx.client.request('getRun', { params: { path: { run_id: runId } } }),
      ctx.client.request('getRunResult', { params: { path: { run_id: runId } } }),
    ]);
    return result({ run, result: resultValue });
  },
  'run attach': async ({ context, args, flags }) => {
    const ctx = await context(),
      runId = required(args[0], 'Run ID');
    await ctx.client.request('getRun', { params: { path: { run_id: runId } } });
    const final = await streamCommand(ctx.client, runId, {
      json: Boolean(flags.json),
      jsonl: Boolean(flags.jsonl),
      plain: Boolean(flags.plain),
      after: stringOption(flags, 'after'),
    });
    return { data: final, exitCode: outcomeExit(final), printed: !flags.json };
  },
  'run cancel': async ({ context, args }) =>
    result(
      await (
        await context()
      ).client.request('cancelRun', { params: { path: { run_id: required(args[0], 'Run ID') } } }),
    ),
  'run input': async ({ context, args, flags }) => {
    const file = required(stringOption(flags, 'answer-file'), '--answer-file FILE');
    const answer = JSON.parse(file === '-' ? await readStdin() : await readFile(file, 'utf8')) as Record<
      string,
      unknown
    >;
    if (!answer || typeof answer !== 'object' || Array.isArray(answer))
      throw new CliError('The answer must be a JSON object.');
    return result(
      await (
        await context()
      ).client.request('submitRunInput', {
        params: { path: { run_id: required(args[0], 'Run ID') } },
        body: { input_request_id: required(stringOption(flags, 'request'), '--request INPUT_ID'), answer },
      }),
    );
  },
  chat: async ({ context }) => result(await chat(await context())),
  'session list': async ({ context, flags }) => {
    const ctx = await context();
    return result(
      await ctx.client.request('listSessions', {
        params: {
          query: {
            ...page(flags),
            worktree_id: stringOption(flags, 'worktree')
              ? (await ctx.worktree()).id
              : ctx.linked?.link.worktreeId,
          },
        },
      }),
    );
  },
  'session resume': async ({ context, args }) => {
    const ctx = await context(),
      session = await ctx.session(required(args[0], 'Session ID'));
    return result(await chat(ctx, session));
  },
  'files list': async ({ context, flags }) => {
    const ctx = await context();
    return result(
      await ctx.client.request('listFiles', {
        params: { path: { worktree_id: (await ctx.worktree()).id }, query: page(flags) },
      }),
    );
  },
  'files cat': async ({ context, args, flags }) => {
    const ctx = await context(),
      file = required(args[0], 'File path');
    const bytes = await ctx.client.request('readFile', {
      params: { path: { worktree_id: (await ctx.worktree()).id }, query: { path: file } },
    });
    const target = stringOption(flags, 'output');
    if (target) {
      await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
      return result({ path: file, downloaded_to: target, bytes: bytes.length });
    }
    if (flags.json)
      return result({ path: file, encoding: 'base64', content: Buffer.from(bytes).toString('base64') });
    process.stdout.write(process.stdout.isTTY ? terminalText(new TextDecoder().decode(bytes)) : bytes);
    return { data: { path: file }, printed: true };
  },
  'files diff': async ({ context, args, flags }) => {
    const ctx = await context(),
      worktree = await ctx.worktree();
    if (flags.local) {
      if (!ctx.linked) throw new CliError('Link the local folder before comparing files.');
      return result(
        await transferFiles(ctx.client, ctx.linked.root, worktree.id, 'push', args, {
          dryRun: true,
          includeIgnored: Boolean(flags['include-ignored']),
          delete: Boolean(flags.delete),
          json: Boolean(flags.json),
        }),
      );
    }
    return result(
      await ctx.client.request('getWorktreeDiff', {
        params: {
          path: { worktree_id: worktree.id },
          query: { ...page(flags), path: args[0], base_checkpoint_id: stringOption(flags, 'from') },
        },
      }),
    );
  },
  'checkpoint list': async ({ context, flags }) => {
    const ctx = await context();
    return result(
      await ctx.client.request('listCheckpoints', {
        params: { path: { worktree_id: (await ctx.worktree()).id }, query: page(flags) },
      }),
    );
  },
  'checkpoint create': async ({ context, flags }) => {
    const ctx = await context();
    return result(
      await completed(
        ctx,
        await ctx.client.request('createCheckpoint', {
          params: { path: { worktree_id: (await ctx.worktree()).id } },
          body: { pinned: Boolean(flags.pin) },
        }),
      ),
    );
  },
  'checkpoint restore': async ({ context, args, flags }) => {
    const ctx = await context(),
      worktree = await ctx.worktree();
    await confirm(
      `Restore files in ${terminalText(worktree.name)} from this checkpoint?`,
      Boolean(flags.yes),
    );
    return result(
      await completed(
        ctx,
        await ctx.client.request('restoreWorktree', {
          params: { path: { worktree_id: worktree.id } },
          body: { checkpoint_id: required(args[0], 'Checkpoint ID') },
        }),
      ),
    );
  },
  'git status': async ({ context }) => {
    const ctx = await context();
    return result(
      await ctx.client.request('getSync', { params: { path: { worktree_id: (await ctx.worktree()).id } } }),
    );
  },
  'git sync': async ({ context }) => {
    const ctx = await context();
    return result(
      await completed(
        ctx,
        await ctx.client.request('syncWorktree', {
          params: { path: { worktree_id: (await ctx.worktree()).id } },
          body: {},
        }),
      ),
    );
  },
  'connection list': async ({ context, flags }) =>
    result(await (await context()).client.request('listConnections', { params: { query: page(flags) } })),
  'connection add': async ({ context, flags }) => {
    const input = await protectedJSON(
      required(stringOption(flags, 'config-file'), '--config-file FILE (or - for stdin)'),
    );
    return result(
      await (
        await context()
      ).client.request('createConnection', { body: input as Schema['ConnectionCreate'] }),
    );
  },
  'connection authorize': async ({ context, args }) =>
    result(
      await (
        await context()
      ).client.request('authorizeConnection', {
        params: { path: { connection_id: required(args[0], 'Connection ID') } },
        body: {},
      }),
    ),
  'connection tools': async ({ context, args, flags }) =>
    result(
      await (
        await context()
      ).client.request('listConnectionTools', {
        params: { path: { connection_id: required(args[0], 'Connection ID') }, query: page(flags) },
      }),
    ),
  usage: async ({ context, flags }) => {
    const ctx = await context();
    const [usage, billing] = await Promise.all([
      ctx.client.request('getUsage', {
        params: { query: { from: stringOption(flags, 'from'), to: stringOption(flags, 'to') } },
      }),
      ctx.client.request('getBilling'),
    ]);
    return result({ usage, billing });
  },
  doctor: async ({ context }) => {
    const ctx = await context();
    const [identity, harnesses, models] = await Promise.all([
      ctx.identity(),
      ctx.client.request('listHarnesses'),
      ctx.client.request('listModels'),
    ]);
    return result({
      ok: true,
      cli_version: release.version,
      origin: ctx.client.baseURL,
      identity,
      harnesses,
      models,
      inference_requests: 0,
    });
  },
};
for (const direction of ['push', 'pull'] as const)
  handlers[`files ${direction}`] = async ({ context, args, flags }) => {
    const ctx = await context();
    if (!ctx.linked) throw new CliError('Link the local folder first.');
    return result(
      await transferFiles(ctx.client, ctx.linked.root, (await ctx.worktree()).id, direction, args, {
        dryRun: Boolean(flags['dry-run']),
        includeIgnored: Boolean(flags['include-ignored']),
        delete: Boolean(flags.delete),
        yes: Boolean(flags.yes),
        json: Boolean(flags.json),
      }),
    );
  };
