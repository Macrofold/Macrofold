import { advanceInference } from '../../packages/core/src/inference-engine';
import { config } from '../../packages/core/src/config';

const [org, runId, boundary] = process.argv.slice(2);
if (!process.send || !org || !runId || !['dispatch', 'receipt'].includes(boundary))
  throw new Error('This fixture requires an IPC parent and a known crash boundary.');
config.allowPaid = true;
globalThis.fetch = async (input) => {
  if (String(input) !== 'https://api.anthropic.com/v1/messages')
    throw new Error('Unreviewed fixture endpoint');
  if (boundary === 'dispatch') {
    process.send?.('dispatch');
    return new Promise<Response>(() => {});
  }
  return Response.json({
    model: 'claude-haiku-4-5-20251001',
    content: [{ type: 'text', text: '"review"' }],
    usage: { input_tokens: 100, output_tokens: 10 },
  });
};
await advanceInference(org, runId);
process.send('receipt');
// Parent kills the process, rather than simulating a crash by throwing an error.
setInterval(() => {}, 1000);
