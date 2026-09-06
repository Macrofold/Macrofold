#!/usr/bin/env node
import { Flags, Parser, type Interfaces } from '@oclif/core';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { handlers } from './commands';
import { Context, type Options } from './context';
import { ApiError, TransportError } from '../../../sdk/typescript/src/client';
import { CliError, exitFor, output, terminalText } from './output';
import { release } from './settings';

const globalFlags = {
  profile: Flags.string({ description: 'Saved credential profile' }),
  organization: Flags.string({ description: 'Authorized organization ID' }),
  project: Flags.string({ description: 'Project ID or exact name' }),
  workspace: Flags.string({ description: 'Hosted workspace ID or name' }),
  session: Flags.string({ description: 'Continuing session ID' }),
  plain: Flags.boolean(),
  json: Flags.boolean({ exclusive: ['jsonl'] }),
  jsonl: Flags.boolean({ exclusive: ['json'] }),
  'no-color': Flags.boolean(),
  help: Flags.boolean({ char: 'h' }),
};
const executionFlags = {
  harness: Flags.string({ options: ['codex', 'claude-code', 'opencode'] }),
  model: Flags.string(),
  'billing-mode': Flags.string({ options: ['managed', 'byok'] }),
  'provider-connection': Flags.string(),
  connection: Flags.string({ multiple: true }),
  timeout: Flags.integer({
    min: 1,
    max: 7200,
    description: 'Execution seconds, capped by your account plan',
  }),
  'queue-timeout': Flags.integer({
    min: 1,
    max: 86400,
    description: 'Maximum seconds to wait before start (default 86400)',
  }),
  scheduling: Flags.string({
    options: ['interactive', 'background'],
    description: 'Interactive for attached terminal work, background for detached runs',
  }),
  'max-cost': Flags.string({ description: 'Maximum USD charge, e.g. 2.00' }),
  detach: Flags.boolean(),
  'prompt-file': Flags.string(),
};
const pagination = { cursor: Flags.string(), limit: Flags.integer({ min: 1, max: 100 }) };
const transferFlags = {
  'dry-run': Flags.boolean(),
  yes: Flags.boolean(),
  'include-ignored': Flags.boolean(),
  delete: Flags.boolean(),
};
const specialFlags: Record<string, Interfaces.FlagInput> = {
  login: {
    host: Flags.string(),
    scope: Flags.string({ multiple: true }),
    'api-key-stdin': Flags.boolean(),
    'no-browser': Flags.boolean(),
  },
  'project create': { ephemeral: Flags.boolean() },
  'worktree create': { from: Flags.string(), branch: Flags.string(), use: Flags.boolean() },
  'worktree remove': { yes: Flags.boolean() },
  'worktree checkout': { local: Flags.string(), branch: Flags.string() },
  run: { ...executionFlags, queue: Flags.boolean() },
  chat: executionFlags,
  'session resume': executionFlags,
  'run list': { status: Flags.string() },
  'run attach': { after: Flags.string() },
  'run input': { request: Flags.string(), 'answer-file': Flags.string() },
  'files cat': { output: Flags.string() },
  'files diff': { local: Flags.boolean(), from: Flags.string(), ...transferFlags },
  'files push': transferFlags,
  'files pull': transferFlags,
  'checkpoint create': { pin: Flags.boolean() },
  'checkpoint restore': { yes: Flags.boolean() },
  'connection add': { 'config-file': Flags.string() },
  usage: { from: Flags.string(), to: Flags.string() },
};
const listCommands = new Set([
  'project list',
  'worktree list',
  'run list',
  'session list',
  'files list',
  'files diff',
  'checkpoint list',
  'connection list',
  'connection tools',
]);
const unlimitedArgs = new Set(['run', 'project create', 'files push', 'files pull', 'files diff']);
const noArgs = new Set([
  'login',
  'logout',
  'whoami',
  'project list',
  'worktree list',
  'chat',
  'run list',
  'session list',
  'files list',
  'checkpoint list',
  'checkpoint create',
  'git status',
  'git sync',
  'connection list',
  'connection add',
  'usage',
  'config',
  'doctor',
  'version',
]);
const examples: Record<string, string> = {
  run: 'agent run "Update the report" --harness codex --model MODEL\nagent run --prompt-file - --session SESSION_ID --json',
  login:
    'agent login --host https://agents.example.com\nagent login --host http://localhost:3210 --api-key-stdin',
  link: 'agent link PROJECT --workspace WORKSPACE_ID',
  'worktree create': 'agent worktree create experiment --from main --use',
  'worktree checkout': 'agent worktree checkout experiment --local ../review',
  chat: 'agent chat --harness codex --model MODEL',
  'files push': 'agent files push src --dry-run\nagent files push src --yes',
  'files pull': 'agent files pull notes --dry-run\nagent files pull notes --yes',
  'connection add': 'agent connection add --config-file private-connection.json',
  'run input': 'agent run input RUN_ID --request REQUEST_ID --answer-file answer.json',
};
function help(command?: string) {
  const keys = command
    ? Object.keys({
        ...globalFlags,
        ...(listCommands.has(command) ? pagination : {}),
        ...specialFlags[command],
      })
    : Object.keys(globalFlags);
  return `${release.name} · ${release.version}\n\n${
    command
      ? `Usage: ${release.executable} ${command} [arguments] [flags]`
      : `Usage: ${release.executable} <command> [arguments] [flags]\n\n${Object.keys(handlers)
          .sort()
          .map((name) => '  ' + name)
          .join('\n')}\n  completion bash|zsh|fish|powershell`
  }\n\nFlags: ${keys.map((k) => '--' + k).join(', ')}\n${command && examples[command] ? `\n${examples[command]}\n` : ''}\nLinking selects a remote project; file movement is always explicit.\nCredentials come from login profiles or AGENT_API_KEY + AGENT_HOST.\nUse agent doctor to inspect the model catalog without starting inference.\n`;
}
function completion(shell: string) {
  const words = [
    ...new Set(
      Object.keys(handlers)
        .flatMap((v) => v.split(' '))
        .concat(Object.keys(globalFlags).map((v) => '--' + v)),
    ),
  ].join(' ');
  if (shell === 'bash') return `complete -W '${words}' ${release.executable}\n`;
  if (shell === 'zsh') return `#compdef ${release.executable}\n_arguments '*:command:(${words})'\n`;
  if (shell === 'fish') return `complete -c ${release.executable} -f -a '${words}'\n`;
  if (shell === 'powershell')
    return `Register-ArgumentCompleter -Native -CommandName ${release.executable} -ScriptBlock { param($wordToComplete) '${words}'.Split(' ') | Where-Object { $_.StartsWith($wordToComplete) } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_,$_, 'ParameterValue',$_) } }\n`;
  throw new CliError('Choose bash, zsh, fish, or powershell.');
}
/** Only command words are normalized here; oclif owns option values, validation and -- semantics. */
export async function main(argv = process.argv.slice(2)) {
  let command = 'help',
    json = argv.includes('--json'),
    jsonl = argv.includes('--jsonl');
  try {
    if (!argv.length && (!process.stdin.isTTY || !process.stdout.isTTY)) {
      process.stdout.write(help());
      return 0;
    }
    if (argv[0] === 'completion') {
      process.stdout.write(completion(argv[1] || ''));
      return 0;
    }
    if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
      process.stdout.write(help(argv.slice(1).join(' ') || undefined));
      return 0;
    }
    // Accept global options before command words without interpreting secret-valued inputs as shell text.
    const leading: string[] = [];
    const rest = [...argv];
    while (rest[0]?.startsWith('--')) {
      const flag = rest.shift()!;
      const name = flag.slice(2).split('=')[0];
      if (!(name in globalFlags)) throw new CliError('Put command-specific flags after the command.');
      leading.push(flag);
      if (
        ['profile', 'organization', 'project', 'workspace', 'session'].includes(name) &&
        !flag.includes('=')
      ) {
        if (!rest.length) throw new CliError(`Missing value for --${name}.`);
        leading.push(rest.shift()!);
      }
    }
    if (rest[0] === '--') rest.shift();
    const first = rest.shift() || 'chat',
      pair = `${first} ${rest[0] || ''}`;
    command = pair in handlers ? pair : first;
    if (pair in handlers) rest.shift();
    if (!(command in handlers)) throw new CliError(`Unknown command: ${command}. Run agent --help.`);
    let parsed;
    try {
      parsed = await Parser.parse([...leading, ...rest], {
        flags: { ...globalFlags, ...(listCommands.has(command) ? pagination : {}), ...specialFlags[command] },
        strict: false,
      });
    } catch (error) {
      throw new CliError((error as Error).message);
    }
    const flags = parsed.flags as Options,
      args = parsed.argv.map(String);
    json = Boolean(flags.json);
    jsonl = Boolean(flags.jsonl);
    if (flags.help) {
      process.stdout.write(help(command));
      return 0;
    }
    if (args.length > (noArgs.has(command) ? 0 : unlimitedArgs.has(command) ? Infinity : 1))
      throw new CliError(`Unexpected arguments for ${command}.`);
    if (jsonl && !['run', 'run attach'].includes(command))
      throw new CliError('--jsonl is supported by run and run attach.');
    if (flags['no-color']) process.env.NO_COLOR = '1';
    let context: Promise<Context> | undefined;
    const value = await handlers[command]({ args, flags, context: () => (context ??= Context.open(flags)) });
    const code = value.exitCode || 0;
    if (json) output({ schema_version: '1', command, ok: true, data: value.data, exit_code: code }, true);
    else if (!value.printed && !jsonl) output(value.data);
    return code;
  } catch (error) {
    const code =
      error instanceof CliError
        ? error.exitCode
        : error instanceof ApiError || error instanceof TransportError
          ? exitFor(error)
          : error instanceof SyntaxError
            ? 2
            : typeof error === 'object' && error !== null && 'oclif' in error
              ? 2
              : exitFor(error);
    const detail = {
      code:
        error instanceof ApiError
          ? error.code
          : error instanceof TransportError
            ? 'transport_unknown'
            : code === 2
              ? 'invalid_invocation'
              : 'cli_error',
      message: terminalText((error as Error).message || 'Command failed.'),
      ...(error instanceof ApiError && error.requestId ? { request_id: error.requestId } : {}),
      ...(error instanceof TransportError && error.idempotencyKey
        ? { idempotency_key: error.idempotencyKey }
        : {}),
    };
    if (json) output({ schema_version: '1', command, ok: false, error: detail, exit_code: code }, true);
    else {
      process.stderr.write(`${detail.message}\n`);
      if (detail.idempotency_key)
        process.stderr.write(`Recovery idempotency key: ${detail.idempotency_key}\n`);
    }
    return code;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]))
  void main().then((code) => {
    process.exitCode = code;
  });
