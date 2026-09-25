import { transaction, type Tx } from '../../db';
import { emit } from './events';
import { terminal } from './runs';
import type { InferenceOutput, InferenceOutputSink } from './decision';

/** Bounded agents retain replay. Coalesce adjacent fragments of the same output
 * without merging choices, tools or model turns; direct inference bypasses SQL. */
export function durableInferenceOutput(org: string, run: string) {
  let pending: InferenceOutput[] = [];
  let size = 0;
  let lastFlush = Date.now();
  async function flush(tx?: Tx) {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    size = 0;
    lastFlush = Date.now();
    const publish = async (tx: Tx) => {
      // Serialize with terminalization/purge so late fragments cannot restore
      // content after its retention owner erased it.
      const row = (
        await tx.query<{ status: string; retained: boolean }>(
          "SELECT status, EXISTS(SELECT 1 FROM decision_invocations WHERE run_id=$1 AND body_ciphertext<>'') AS retained FROM runs WHERE id=$1 FOR UPDATE",
          [run],
        )
      ).rows[0];
      if (!row || !row.retained || terminal(row.status)) return;
      for (const event of batch) await emit(tx, org, run, event.type, event.data);
    };
    if (tx) await publish(tx);
    else await transaction(org, publish);
  }
  const write: InferenceOutputSink = async (event) => {
    const previous = pending.at(-1);
    const { text, ...identity } = event.data;
    const { text: previousText, ...previousIdentity } = previous?.data ?? {};
    if (
      text &&
      previous &&
      previous.type === event.type &&
      JSON.stringify(identity) === JSON.stringify(previousIdentity)
    ) {
      previous.data.text = (previousText ?? '') + text;
    } else pending.push({ ...event, data: { ...event.data } });
    size += Buffer.byteLength(text ?? '') + 128;
    if (size >= 4096 || Date.now() - lastFlush >= 100) await flush();
  };
  return { write, flush };
}
