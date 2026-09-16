// Shared deterministic native protocol fixture. Never forwards a request to a provider.
export function nativeModelFixture({
  journey = false,
  questionMode = false,
  toolMode = false,
  failureMode = false,
  permissionMode = false,
  onBlocked,
} = {}) {
  let calls = 0;
  let chatTurns = 0;
  let responseDiscoveries = 0;
  const observed = [];
  const filename = journey ? 'hello.txt' : 'native.txt';
  const content = journey ? 'Hello from the agent\n' : 'native tool persisted\n';
  const permissionActions = [
    { action: 'read', path: 'private.env' },
    { action: 'write', path: 'forbidden.txt', content },
    { action: 'read', path: '../outside.txt' },
    { action: 'read', path: 'escape/outside.txt' },
    { action: 'write', path: 'docs/private/blocked.md', content },
    { action: 'write', path: filename, content },
    { action: 'read', path: filename },
    { action: 'delete', path: 'readonly.txt' },
  ];
  const bypassCommand = 'cat /workspace/private.env; printf escaped > /workspace/bypass.txt';
  const brokerTurn = (turn) => permissionMode && turn === permissionActions.length + 2;
  const permissionTurn = (turn) =>
    permissionMode && (turn <= permissionActions.length + 2 || turn === permissionActions.length + 4);
  const permissionAction = (turn) =>
    turn === permissionActions.length + 4 ? { action: 'read', path: filename } : permissionActions[turn - 1];
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
    const last = (body.messages || body.input || []).at(-1);
    const system = JSON.stringify(body.system || '');
    const toolResult =
      JSON.stringify(
        last?.role === 'tool'
          ? last.content
          : ['function_call_output', 'custom_tool_call_output'].includes(last?.type)
            ? last.output
            : last?.role === 'user' && Array.isArray(last.content)
              ? last.content.filter((block) => block.type === 'tool_result')
              : '',
      ) || '';
    observed.push({
      path: req.url,
      tools: body.tools?.map((t) => t.name || t.function?.name),
      model: body.model,
      hasPriorPrompt: JSON.stringify(body).includes('Create native.txt with a short note'),
      hasAnswer: JSON.stringify(body).includes('Continue with the saved note'),
      hasWorkspaceContext: system.includes('/workspace'),
      hasPersistenceGuidance: system.includes('/tmp') && /checkpoint/i.test(system),
      hasRunInstructions: system.includes('Keep the fixture note unchanged.'),
      permissionDenied: JSON.stringify(body).includes('File permission denied'),
      fileSaved: toolResult.includes('File saved.'),
      fileRead: toolResult.includes('native tool persisted'),
      nativeToolRejected:
        /does not exist|not found|unknown tool|not allowed|denied|outside.*project|approval settings/i.test(
          toolResult,
        ),
      leakedSecret: JSON.stringify(body).includes('PERMISSION_SECRET_FIXTURE'),
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
      if (calls === 1 || permissionTurn(calls) || (journey && [2, 4].includes(calls))) {
        const bypass = permissionMode && calls === permissionActions.length + 1;
        const name = permissionMode
          ? bypass
            ? 'Bash'
            : brokerTurn(calls)
              ? 'mcp__platform__fixture_echo'
              : 'mcp__worktree__worktree_files'
          : journey && calls !== 1
            ? 'Bash'
            : 'Write';
        const input = permissionMode
          ? bypass
            ? { command: bypassCommand, description: 'Attempt disabled shell' }
            : brokerTurn(calls)
              ? { text: 'broker verified' }
              : permissionAction(calls)
          : journey && calls !== 1
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
      // Auxiliary title/metadata requests must not consume the scripted agent turns.
      if (body.tools?.length) chatTurns++;
      if (failureMode && body.tools?.length && chatTurns >= 2) {
        if (onBlocked) {
          await onBlocked();
          return;
        }
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Fixture credentials revoked', type: 'authentication_error' } }),
        );
        return;
      }
      const base = {
        id: `chatcmpl_fixture_${calls}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: body.model,
      };
      if (!body.stream) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ...base,
            object: 'chat.completion',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Native fixture completed.' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
          }),
        );
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (delta, finish_reason = null) =>
        res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      if (
        body.tools?.length &&
        (chatTurns === 1 || permissionTurn(chatTurns) || (journey && [2, 4].includes(chatTurns)))
      ) {
        const bypass = permissionMode && chatTurns === permissionActions.length + 1;
        const tool = permissionMode
          ? bypass
            ? body.tools.some((t) => t.function?.name === 'tool_call')
              ? 'terminal'
              : 'bash'
            : body.tools?.find((t) =>
                t.function?.name.includes(brokerTurn(chatTurns) ? 'fixture_echo' : 'worktree_files'),
              )?.function?.name || 'tool_call'
          : body.tools?.find((t) => ['bash', 'terminal'].includes(t.function?.name))?.function?.name ||
            'bash';
        send({
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: `call_fixture_${calls}`,
              type: 'function',
              function: {
                name: tool,
                arguments: JSON.stringify(
                  permissionMode
                    ? bypass
                      ? { command: bypassCommand, description: 'Attempt disabled shell' }
                      : tool === 'tool_call'
                        ? {
                            name: brokerTurn(chatTurns) ? 'mcp__platform__fixture_echo' : 'worktree_files',
                            arguments: brokerTurn(chatTurns)
                              ? { text: 'broker verified' }
                              : permissionAction(chatTurns),
                          }
                        : brokerTurn(chatTurns)
                          ? { text: 'broker verified' }
                          : permissionAction(chatTurns)
                    : {
                        command: action(chatTurns),
                        description: 'Write fixture note',
                      },
                ),
              },
            },
          ],
        });
        send({}, 'tool_calls');
      } else if (toolMode && chatTurns === 2) {
        // Hermes may expose its native discovery bridge instead of every MCP schema up front.
        const tool =
          body.tools?.find((t) => t.function?.name.includes('fixture_echo'))?.function?.name ||
          body.tools?.find((t) => t.function?.name === 'tool_call')?.function?.name;
        if (!tool) throw new Error('Authorized MCP tool missing from the native model request');
        const args =
          tool === 'tool_call'
            ? { name: 'mcp__platform__fixture_echo', arguments: { text: 'broker verified' } }
            : { text: 'broker verified' };
        send({
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'fixture_broker_call',
              type: 'function',
              function: { name: tool, arguments: JSON.stringify(args) },
            },
          ],
        });
        send({}, 'tool_calls');
      } else if (questionMode && chatTurns === 2) {
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
    const turn = calls - responseDiscoveries;
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
    if (brokerTurn(turn) && responseDiscoveries === 0) {
      responseDiscoveries++;
      const item = {
        type: 'tool_search_call',
        id: `ts_fixture_${calls}`,
        call_id: `call_fixture_${calls}`,
        execution: 'client',
        arguments: { query: 'platform fixture_echo' },
        status: 'completed',
      };
      send('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress' } });
      send('response.output_item.done', { output_index: 0, item });
      send('response.completed', {
        response: {
          ...base,
          status: 'completed',
          output: [item],
          usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 },
        },
      });
    } else if (permissionMode && turn === permissionActions.length + 1) {
      // Codex retains apply_patch even with shell disabled. Its native profile
      // must reject a well-formed patch, not merely hide a tool from the model.
      const item = {
        type: 'custom_tool_call',
        id: `fc_fixture_${calls}`,
        call_id: `call_fixture_${calls}`,
        name: 'apply_patch',
        input: '*** Begin Patch\n*** Add File: /workspace/bypass.txt\n+escaped\n*** End Patch',
        status: 'completed',
      };
      send('response.output_item.added', {
        output_index: 0,
        item: { ...item, input: '', status: 'in_progress' },
      });
      send('response.custom_tool_call_input.delta', { output_index: 0, item_id: item.id, delta: item.input });
      send('response.custom_tool_call_input.done', { output_index: 0, item_id: item.id, input: item.input });
      send('response.output_item.done', { output_index: 0, item });
      send('response.completed', {
        response: {
          ...base,
          status: 'completed',
          output: [item],
          usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 },
        },
      });
    } else if (calls === 1 || permissionTurn(turn) || (journey && [2, 4].includes(calls))) {
      const tools = body.tools || [];
      const name =
        (permissionMode ? (brokerTurn(turn) ? 'fixture_echo' : 'worktree_files') : undefined) ||
        tools.find((t) => t.name === 'exec_command')?.name ||
        tools.find((t) => t.name === 'shell')?.name ||
        'exec_command';
      const args = permissionMode
        ? brokerTurn(turn)
          ? { text: 'broker verified' }
          : permissionAction(turn)
        : name === 'shell'
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
        ...(brokerTurn(turn) ? { namespace: 'mcp__platform' } : {}),
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
