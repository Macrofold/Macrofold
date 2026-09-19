import type { Schema } from '../lib/client';

/** A validated proposal is distinct from the application's accepted outcome. */
export function InferenceResult({ receipt }: { receipt: Schema['InferenceReceipt'] }) {
  return (
    <section aria-label="Decision result">
      <h2>{receipt.outcome === 'value' ? 'Validated proposal' : receipt.outcome.replaceAll('_', ' ')}</h2>
      <p>The application must check current evidence and authorize any resulting action.</p>
      {receipt.outcome === 'value' && <pre>{JSON.stringify(receipt.value, null, 2)}</pre>}
      {receipt.outcome === 'uncertain' && (
        <p>
          The provider may have completed this request. It will not be repeated automatically; provisional
          usage remains reserved or charged.
        </p>
      )}
      {receipt.outcome === 'stale_input' && (
        <p>The supplied evidence expired. Submit fresh context before using a new proposal.</p>
      )}
      <details className="reasoning-summary">
        <summary>Evidence and validation receipt</summary>
        <pre>{JSON.stringify(receipt, null, 2)}</pre>
      </details>
    </section>
  );
}
