import type { Tx } from '../../db';
import type { RunRow } from './runs';
import type { StoredDecisionResponse } from './inference-invocations';
import { assert } from './errors';
import { unseal } from './crypto';

/** One output owner, hydrated only for result consumers. Bulk reads avoid N+1
 * queries in history/Task presentation; lifecycle queries keep small receipts. */
export async function hydrateInferenceResults<T extends RunRow>(tx: Tx, runs: T[]): Promise<T[]> {
  const requested = runs.filter((run) => !run.result.content_expired && run.result.inference_output_id);
  if (!requested.length) return runs;
  const rows = await tx.query<{ id: string; run_id: string; response_ciphertext: string | null }>(
    `SELECT id,run_id,response_ciphertext FROM decision_invocations
     WHERE id=ANY($1::uuid[]) AND run_id=ANY($2::uuid[])`,
    [requested.map((run) => run.result.inference_output_id), requested.map((run) => run.id)],
  );
  const values = new Map(rows.rows.map((row) => [row.id, row]));
  const missing = requested.filter((run) => {
    const outputId = run.result.inference_output_id;
    const row = outputId ? values.get(outputId) : undefined;
    return !row?.response_ciphertext || row.run_id !== run.id;
  });
  // READ COMMITTED may observe a purge between the Run and payload reads.
  // Return that current tombstone; missing retained content is an integrity error.
  const tombstones = missing.length
    ? new Map(
        (
          await tx.query<Pick<RunRow, 'id' | 'result'>>(
            'SELECT id,result FROM runs WHERE id=ANY($1::uuid[])',
            [missing.map((run) => run.id)],
          )
        ).rows.map((run) => [run.id, run.result]),
      )
    : new Map<string, RunRow['result']>();
  return runs.map((run) => {
    const { inference_output_id: outputId, inference_output_path: path, ...result } = run.result;
    const stored = outputId ? values.get(outputId) : undefined;
    if (stored?.run_id === run.id && stored.response_ciphertext && result.inference?.outcome === 'value') {
      const response = unseal<StoredDecisionResponse>(stored.response_ciphertext);
      let value = response.value;
      if (path === 'bounded_finish') {
        assert(
          value && typeof value === 'object' && 'value' in value,
          500,
          'inference_output_missing',
          'The saved bounded result is unavailable.',
        );
        value = value.value;
      }
      return { ...run, result: { ...result, inference: { ...result.inference, value } } };
    }
    const current = tombstones.get(run.id);
    if (current?.content_expired) return { ...run, result: current };
    assert(
      !outputId || result.content_expired || result.inference?.outcome !== 'value',
      500,
      'inference_output_missing',
      'The saved inference output is unavailable.',
    );
    return { ...run, result };
  });
}
