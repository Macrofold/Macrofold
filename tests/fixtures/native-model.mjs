// Shared deterministic native protocol fixture. Never forwards a request to a provider.
export function nativeModelFixture({ journey = false, questionMode = false } = {}) {
  let calls = 0;
  const observed = [];
  const filename = journey ? 'hello.txt' : 'native.txt';
  const content = journey ? 'Hello from the agent\n' : 'native tool persisted\n';
  const action = (call) =>
    journey && call !== 1
      ? call === 2
        ? 'cat hello.txt'
        : 'cp hello.txt continued.txt && cat continued.txt'
      : `printf '${content.replaceAll('\n', '\\n')}' > ${filename}`;
  const handler = async (req, res) => {
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
      const send = (type, data) =>
        res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
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
      if (calls === 1 || (journey && [2, 4].includes(calls))) {
        const name = journey && calls !== 1 ? 'Bash' : 'Write';
        const input =
          journey && calls !== 1
            ? { command: action(calls), description: 'Read persisted fixture' }
            : { file_path: '/workspace/' + filename, content };
        send('content_block_start', {
          index: 0,
          content_block: { type: 'tool_use', id: `toolu_fixture_${calls}`, name, input: {} },
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
      if (calls === 1 || (journey && [2, 4].includes(calls))) {
        const tool = body.tools?.find((t) => t.function?.name === 'bash')?.function?.name || 'bash';
        send({
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: `call_fixture_${calls}`,
              type: 'function',
              function: {
                name: tool,
                arguments: JSON.stringify({
                  command: action(calls),
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
      res.write(
        `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...data })}\n\n`,
      );
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
    if (calls === 1 || (journey && [2, 4].includes(calls))) {
      const tools = body.tools || [];
      const name =
        tools.find((t) => t.name === 'exec_command')?.name ||
        tools.find((t) => t.name === 'shell')?.name ||
        'exec_command';
      const args =
        name === 'shell'
          ? {
              command: ['bash', '-lc', action(calls)],
              workdir: '/workspace',
            }
          : { cmd: action(calls), workdir: '/workspace' };
      const item = {
        type: 'function_call',
        id: `fc_fixture_${calls}`,
        call_id: `call_fixture_${calls}`,
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
        id: `msg_fixture_${calls}`,
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
  };
  return {
    handler,
    observed,
    get calls() {
      return calls;
    },
  };
}
