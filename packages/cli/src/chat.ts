import type { Schema } from '../../../sdk/typescript/src/client';
import { Context, execution, limits, scheduling } from './context';
import { CliError, prompt, terminalText } from './output';
import { terminal, type TerminalState } from './terminal';
import { eventLine, followRun, streamCommand, waitingLine } from './stream';

export async function chat(context: Context, existing?: Schema['Session']) {
  if (context.flags.json || context.flags.jsonl)
    throw new CliError('Use agent run --json or --jsonl for noninteractive prompts.');
  if (!process.stdin.isTTY)
    throw new CliError('Chat requires a terminal. Use agent run --prompt-file - for stdin.');
  const client = context.client,
    settings = execution(context.flags);
  let session = existing || (await context.session());
  const workspace = session
    ? await client.request('getWorkspace', { params: { path: { workspace_id: session.workspace_id } } })
    : await context.workspace();
  async function ensureSession() {
    if (session) return session;
    if (!settings.harness || !settings.model)
      throw new CliError('A new chat needs --harness and --model. agent doctor lists the available catalog.');
    session = await client.request('createSession', {
      body: { ...settings, harness: settings.harness, model: settings.model, workspace_id: workspace.id },
    });
    if (context.linked) await context.link(workspace, context.linked.root, session.id);
    return session;
  }
  await ensureSession();
  if (context.flags.plain || process.env.TERM === 'dumb' || !process.stdout.isTTY) {
    process.stderr.write(
      `Hosted chat · ${terminalText(workspace.name)} · ${session!.harness}/${session!.model}\n/help for commands.\n`,
    );
    while (true) {
      const text = (await prompt('› ')).trim();
      if (!text) continue;
      if (['/exit', '/detach'].includes(text)) return { session_id: session!.id, detached: true };
      if (text === '/help') {
        process.stderr.write('/status /connections /diff /model MODEL /new /exit\n');
        continue;
      }
      if (text === '/new') {
        session = undefined;
        await ensureSession();
        continue;
      }
      if (text.startsWith('/model ')) {
        settings.model = text.slice(7).trim();
        continue;
      }
      if (text.startsWith('/')) {
        const value =
          text === '/diff'
            ? await client.request('getWorkspaceDiff', { params: { path: { workspace_id: workspace.id } } })
            : text === '/connections'
              ? await client.request('listConnections')
              : text === '/status'
                ? await client.request('getWorkspace', { params: { path: { workspace_id: workspace.id } } })
                : { message: 'Unknown command. Use /help.' };
        process.stderr.write(terminalText(JSON.stringify(value, null, 2)) + '\n');
        continue;
      }
      const run = await client.request('continueSession', {
        params: { path: { session_id: session!.id } },
        body: {
          ...scheduling(context.flags),
          prompt: text,
          queue_if_busy: true,
          model: settings.model,
          limits: limits(context.flags),
        },
      });
      await streamCommand(client, run.run_id, { plain: true });
    }
  }
  const state: TerminalState = {
    title: `${workspace.name} · hosted workspace`,
    subtitle: `${workspace.branch || 'main'} · ${session!.harness} / ${session!.model} · session ${session!.id}`,
    status: 'Ready · files stay in the cloud',
    lines: [],
    busy: false,
  };
  const active = new Map<string, AbortController>();
  const pendingInputs = new Map<string, { runId: string; question: string }>();
  let foreground: string | undefined,
    closed = false,
    interrupts = 0,
    submission = Promise.resolve();
  let finish: (value: unknown) => void = () => {};
  const done = new Promise((resolve) => {
    finish = resolve;
  });
  const add = (text: string) => {
    state.lines.push(terminalText(text));
    if (state.lines.length > 1000) state.lines.splice(0, state.lines.length - 1000);
    ui.update(state);
  };
  const detach = () => {
    if (closed) return;
    closed = true;
    for (const controller of active.values()) controller.abort();
    finish({ session_id: session!.id, detached: true, active_run_ids: [...active.keys()] });
  };
  const cancel = () => {
    const target = foreground || [...pendingInputs.values()][0]?.runId;
    if (!target) {
      detach();
      return;
    }
    if (++interrupts > 1) {
      detach();
      return;
    }
    add(`Requesting cancellation of ${target}. Queued follow-ups keep their own run IDs.`);
    void client.request('cancelRun', { params: { path: { run_id: target } } }).then(
      () => add(`Cancellation acknowledged for ${target}; preserving files.`),
      () => add('Cancellation not confirmed. Ctrl-C again to detach.'),
    );
  };
  async function follow(run: Schema['RunAccepted'], resume = false) {
    const controller = new AbortController();
    active.set(run.run_id, controller);
    foreground = run.run_id;
    state.busy = true;
    state.status = `${run.status} · ${run.run_id}`;
    ui.update(state);
    try {
      const result = await followRun(client, run.run_id, {
        after: resume ? undefined : '0',
        signal: controller.signal,
        interactiveInput: false,
        onWaiting: (queued) => {
          if (!closed && foreground === run.run_id) {
            state.status = waitingLine(queued);
            ui.update(state);
          }
        },
        onEvent: (event) => {
          if (closed) return;
          if (event.type === 'input.requested') {
            pendingInputs.set(String(event.data.input_request_id), {
              runId: run.run_id,
              question: String(event.data.question || event.data.prompt || 'Agent input'),
            });
            state.status = 'Waiting for your answer · /answer REQUEST_ID TEXT';
          }
          const line = eventLine(event);
          if (event.type === 'output.delta') {
            const last = state.lines.length - 1;
            if (last < 0) state.lines.push('');
            state.lines[Math.max(0, last)] += line;
            ui.update(state);
          } else if (line) add(line);
        },
      });
      add(`Run ${run.run_id} · ${result.execution_outcome} · files ${result.persistence_status}`);
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof CliError && error.exitCode === 4) add(error.message);
        else
          add(
            `Stream interrupted: ${(error as Error).message}. Reconnect with agent run attach ${run.run_id}`,
          );
      }
    } finally {
      active.delete(run.run_id);
      foreground = [...active.keys()].at(-1);
      state.busy = active.size > 0;
      state.status = pendingInputs.size
        ? 'Waiting for your answer · /answer REQUEST_ID TEXT'
        : active.size
          ? `${active.size} runs active or queued`
          : 'Ready';
      interrupts = 0;
      if (!closed) ui.update(state);
    }
  }
  async function submit(text: string) {
    if (closed) return;
    if (text.startsWith('/')) {
      const [command, ...args] = text.split(/\s+/);
      if (['/exit', '/detach'].includes(command)) {
        detach();
        return;
      }
      if (command === '/cancel') {
        cancel();
        return;
      }
      if (command === '/clear') {
        state.lines = [];
        ui.update(state);
        return;
      }
      if (command === '/help') {
        add(
          '/status /connections /diff /worktree /model MODEL /answer REQUEST_ID TEXT /cancel /detach /new /clear /exit',
        );
        return;
      }
      if (command === '/model') {
        if (!args.length) {
          add(`Model: ${settings.model || session!.model}`);
          return;
        }
        settings.model = args.join(' ');
        add(`Next run model: ${settings.model}. The API validates compatibility.`);
        return;
      }
      if (command === '/new') {
        if (active.size || pendingInputs.size) {
          add('Detach or finish the active conversation before /new.');
          return;
        }
        session = undefined;
        await ensureSession();
        state.subtitle = `${workspace.branch || 'main'} · ${session!.harness}/${session!.model} · session ${session!.id}`;
        add('New conversation ready.');
        return;
      }
      if (command === '/worktree') {
        add(
          `Selected: ${workspace.name} (${workspace.id}). Detach and use agent worktree use NAME to switch.`,
        );
        return;
      }
      if (command === '/answer') {
        const [requestId, ...words] = args,
          entry = pendingInputs.get(requestId);
        if (!entry || !words.length) {
          add('Use /answer REQUEST_ID TEXT for a pending request.');
          return;
        }
        await client.request('submitRunInput', {
          params: { path: { run_id: entry.runId } },
          body: { input_request_id: requestId, answer: { text: words.join(' ') } },
        });
        pendingInputs.delete(requestId);
        // Input intentionally releases a foreground stream; resume from its durable cursor after answering.
        void follow(
          {
            run_id: entry.runId,
            session_id: session!.id,
            workspace_id: workspace.id,
            status: 'running',
            urls: { status: '', events: '', stream: '', result: '' },
          },
          true,
        );
        return;
      }
      const value =
        command === '/status'
          ? await client.request('getWorkspace', { params: { path: { workspace_id: workspace.id } } })
          : command === '/connections'
            ? await client.request('listConnections')
            : command === '/diff'
              ? await client.request('getWorkspaceDiff', { params: { path: { workspace_id: workspace.id } } })
              : { message: 'Unknown command. Use /help.' };
      add(JSON.stringify(value, null, 2));
      return;
    }
    add(`You › ${text}`);
    const run = await client.request('continueSession', {
      params: { path: { session_id: (await ensureSession()).id } },
      body: {
        ...scheduling(context.flags),
        prompt: text,
        queue_if_busy: true,
        model: settings.model,
        limits: limits(context.flags),
      },
    });
    add(`Accepted ${run.run_id} · deadline ${run.queue_expires_at}`);
    void follow(run);
  }
  const ui = terminal(
    state,
    (text) => {
      submission = submission
        .then(() => submit(text))
        .catch((error) => {
          add((error as Error).message);
        });
    },
    cancel,
    detach,
  );
  process.on('SIGINT', cancel);
  process.on('SIGHUP', detach);
  process.on('SIGTERM', detach);
  try {
    return await done;
  } finally {
    closed = true;
    ui.close();
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGHUP', detach);
    process.removeListener('SIGTERM', detach);
  }
}
