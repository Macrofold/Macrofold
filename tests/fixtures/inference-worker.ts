import { advanceInference } from '../../packages/core/src/inference-engine';
import { config } from '../../packages/core/src/config';
import { transaction } from '../../packages/db';

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
const executing = advanceInference(org, runId);
if (boundary === 'receipt') {
  // The parent holds the final outbox row, so the ready loop cannot finish the
  // Run before this durable evidence boundary is observed and the process dies.
  for (;;) {
    const saved = await transaction(org, (tx) =>
      tx.query("SELECT 1 FROM decision_invocations WHERE run_id=$1 AND state='responded'", [runId]),
    );
    if (saved.rowCount) {
      process.send('receipt');
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
await executing;
// Parent kills the process, rather than simulating a crash by throwing an error.
setInterval(() => {}, 1000);
