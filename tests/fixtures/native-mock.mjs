// Run only inside `docker run --network none`; every model response is a local deterministic fixture.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
const harness = process.argv[2] || 'codex';
const questionMode = process.argv[3] === 'questions';
let answered = 0;
let calls = 0;
const observed = [];
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  let text = '';
  for await (const chunk of req) text += chunk;
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {}
  observed.push({
    path: req.url,
    tools: body.tools?.map((t) => t.name || t.function?.name),
    model: body.model,
    hasPriorPrompt: JSON.stringify(body).includes('Create native.txt with a short note'),
    hasAnswer: JSON.stringify(body).includes('Continue with the saved note'),
  });
  if (pathname.endsWith('/count_tokens')) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ input_tokens: 100 }));
    return;
  }
  if (pathname.endsWith('/messages')) {
    calls++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    send('message_start', {
      message: {
        id: `msg_fixture_${calls}`,
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 0 },
      },
    });
    if (calls === 1) {
      const name = body.tools?.find((t) => t.name === 'Write')?.name || 'Write';
      const input = { file_path: '/workspace/native.txt', content: 'native tool persisted\n' };
      send('content_block_start', {
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_fixture', name, input: {} },
      });
      send('content_block_delta', {
        index: 0,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) },
      });
      send('content_block_stop', { index: 0 });
      send('message_delta', {
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { output_tokens: 30 },
      });
    } else {
      send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      send('content_block_delta', {
        index: 0,
        delta: { type: 'text_delta', text: 'Native fixture completed.' },
      });
      send('content_block_stop', { index: 0 });
      send('message_delta', {
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 10 },
      });
    }
    send('message_stop', {});
    res.end();
    return;
  }
  if (req.url?.endsWith('/chat/completions')) {
    calls++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const base = {
      id: `chatcmpl_fixture_${calls}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: body.model,
    };
    const send = (delta, finish_reason = null) =>
      res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    if (calls === 1) {
      const tool = body.tools?.find((t) => t.function?.name === 'bash')?.function?.name || 'bash';
      send({
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'call_fixture',
            type: 'function',
            function: {
              name: tool,
              arguments: JSON.stringify({
                command: 'printf "native tool persisted\\n" > native.txt',
                description: 'Write fixture note',
              }),
            },
          },
        ],
      });
      send({}, 'tool_calls');
    } else if (questionMode && calls === 2) {
      send({
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'call_question_fixture',
            type: 'function',
            function: {
              name: 'question',
              arguments: JSON.stringify({
                questions: [
                  {
                    header: 'Next step',
                    question: 'What should I do next?',
                    options: [
                      { label: 'Continue with the saved note', description: 'Keep the persisted work' },
                    ],
                  },
                ],
              }),
            },
          },
        ],
      });
      send({}, 'tool_calls');
    } else {
      send({ role: 'assistant', content: 'Native fixture completed.' });
      send({}, 'stop');
    }
    res.write(
      `data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } })}\n\ndata: [DONE]\n\n`,
    );
    res.end();
    return;
  }
  if (!req.url?.endsWith('/responses')) {
    res.writeHead(404);
    res.end('{}');
    return;
  }
  calls++;
  const responseId = `resp_fixture_${calls}`;
  let sequence = 0;
  const send = (type, data) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...data })}\n\n`);
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const base = {
    id: responseId,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model: body.model,
    status: 'in_progress',
    output: [],
  };
  send('response.created', { response: base });
  if (calls === 1) {
    const tools = body.tools || [];
    const name =
      tools.find((t) => t.name === 'exec_command')?.name ||
      tools.find((t) => t.name === 'shell')?.name ||
      'exec_command';
    const args =
      name === 'shell'
        ? {
            command: ['bash', '-lc', 'printf "native tool persisted\\n" > native.txt'],
            workdir: '/workspace',
          }
        : { cmd: 'printf "native tool persisted\\n" > native.txt', workdir: '/workspace' };
    const item = {
      type: 'function_call',
      id: 'fc_fixture',
      call_id: 'call_fixture',
      name,
      arguments: JSON.stringify(args),
      status: 'completed',
    };
    send('response.output_item.added', {
      output_index: 0,
      item: { ...item, status: 'in_progress', arguments: '' },
    });
    send('response.function_call_arguments.delta', {
      item_id: item.id,
      output_index: 0,
      delta: item.arguments,
    });
    send('response.function_call_arguments.done', {
      item_id: item.id,
      output_index: 0,
      arguments: item.arguments,
    });
    send('response.output_item.done', { output_index: 0, item });
    send('response.completed', {
      response: {
        ...base,
        status: 'completed',
        output: [item],
        usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 },
      },
    });
  } else {
    const content = { type: 'output_text', text: 'Native fixture completed.', annotations: [] };
    const item = {
      id: 'msg_fixture',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [content],
    };
    send('response.output_item.added', {
      output_index: 0,
      item: { ...item, status: 'in_progress', content: [] },
    });
    send('response.content_part.added', {
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: { ...content, text: '' },
    });
    send('response.output_text.delta', {
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      delta: content.text,
    });
    send('response.output_text.done', {
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      text: content.text,
    });
    send('response.output_item.done', { output_index: 0, item });
    send('response.completed', {
      response: {
        ...base,
        status: 'completed',
        output: [item],
        usage: { input_tokens: 120, output_tokens: 10, total_tokens: 130 },
      },
    });
  }
  res.end();
});
server.listen(8787, '127.0.0.1');
await mkdir('/platform-control', { recursive: true });
const configuration = {
  runId: crypto.randomUUID(),
  harness,
  provider: harness === 'claude-code' ? 'anthropic' : 'openai',
  model: harness === 'claude-code' ? 'claude-sonnet-4-6' : 'gpt-5.4',
  prompt: 'Create native.txt with a short note, then finish.',
  workspace: '/workspace',
  stateHome: '/agent-home',
  gatewayURL: 'http://127.0.0.1:8787',
  toolURL: 'http://127.0.0.1:8787/mcp',
  token: 'fixture-local-only',
  deadline: new Date(Date.now() + 60000).toISOString(),
  toolGrants: false,
};
await writeFile('/platform-control/config.json', JSON.stringify(configuration));
const child = spawn('node', ['/opt/platform/entry.mjs'], { stdio: 'inherit' });
let checking = false;
const answering = setInterval(async () => {
  if (!questionMode || checking) return;
  checking = true;
  try {
    const input = JSON.parse(await readFile('/platform-control/input.json', 'utf8'));
    if (!answered) {
      await writeFile(
        '/platform-control/answer.json',
        JSON.stringify({ id: input.id, answer: { text: 'Continue with the saved note' } }),
      );
      answered++;
    }
  } catch {
  } finally {
    checking = false;
  }
}, 100);
await new Promise((resolve) => child.on('exit', resolve));
clearInterval(answering);
if (questionMode) {
  assert.equal(answered, 1, 'Interactive question must reach the supervisor');
  assert(
    observed.some((o) => o.hasAnswer),
    'Answer must return to the native model conversation',
  );
}
const result = JSON.parse(await readFile('/platform-control/result.json', 'utf8'));
console.log(JSON.stringify({ harness, calls, observed, result }));
assert.equal(result.outcome, 'success');
assert.equal(result.persistence, 'captured');
assert.equal(await readFile('/workspace/native.txt', 'utf8'), 'native tool persisted\n');
const index = JSON.parse(await readFile('/platform-control/snapshot/index.json', 'utf8'));
assert(index.entries.some((e) => e.namespace === 'workspace' && e.path === 'native.txt'));
assert(index.entries.some((e) => e.namespace === 'home'));
assert(!index.entries.some((e) => e.path === '.runtime-config.json'));
console.log('Native harness, tool execution and checkpoint verified without external network.');
const previousCount = observed.length;
await cp('/platform-control', '/completed-control', { recursive: true });
await rm('/platform-control', { recursive: true, force: true });
await writeFile('/completed-control/snapshot/page-0.json', JSON.stringify(index.entries));
await rm('/workspace', { recursive: true, force: true });
await rm('/agent-home', { recursive: true, force: true });
const { restoreSnapshot } = await import('/opt/platform/restore.mjs');
await restoreSnapshot('/completed-control/snapshot', { workspace: '/workspace', home: '/agent-home' }, 10001);
await mkdir('/platform-control');
await writeFile(
  '/platform-control/config.json',
  JSON.stringify({
    ...configuration,
    runId: crypto.randomUUID(),
    prompt: 'Confirm the prior task is complete.',
    resumeId: result.resumeId,
    deadline: new Date(Date.now() + 60000).toISOString(),
  }),
);
const continuation = spawn('node', ['/opt/platform/entry.mjs'], { stdio: 'inherit' });
await new Promise((resolve) => continuation.on('exit', resolve));
server.close();
const resumed = JSON.parse(await readFile('/platform-control/result.json', 'utf8'));
console.log(JSON.stringify({ harness, continuation: resumed, requests: observed.slice(previousCount) }));
assert.equal(resumed.outcome, 'success');
assert.equal(resumed.resumeId, result.resumeId);
assert(
  observed.slice(previousCount).some((o) => o.hasPriorPrompt),
  'Continuation must restore native conversation context',
);
assert.equal(await readFile('/workspace/native.txt', 'utf8'), 'native tool persisted\n');
console.log('Portable filesystem restore and native session continuation verified.');
