# Worker and streaming reconciliation

The Worker source at `3337c16e6c82569ddfebce1e1eddffce2731bfb4` was consolidated into two commits on its original base `19865a2f45885e228deb6b7ea443e33982257d21`, then replayed onto streaming main `ea0c17cecae715f4def2c17d4cbe4e32d1ae8ae9`. The pre-rebase series is on `integration/worker-redesign-squashed`; its final tree exactly matches the reviewed Worker source. The rebased series and integration repairs are on `integration/worker-redesign-rebased`, PR 8. Both original histories remain on archive branches. No merge or production deployment is implied by this record.

## Reconciled boundaries

The independent semantic three-way merge of OpenAPI matches the candidate: Worker fields and streaming fields are retained together, rather than selecting one generated conflict side. One-sided authored changes are preserved. Generated SDK outputs are regenerated from the combined schema; inline type-name changes are not a reason to add compatibility aliases or hand-edit generated files.

Native requests retain Worker/resource selection and streaming capability/read-scope validation. Direct inference remains a one-producer transient SSE response; native and bounded agents retain durable Run streams. Worker lifecycle never becomes a stream-reader lifecycle, and a reader disconnect never authorizes prompt replay. Authoritative behavior is in [implementation](implementation.md) and the [streaming implementation](../../api/streaming-implementation.md).

## Repairs found while executing the combined source

- Python's streaming facade referenced a request TypedDict which had not been generated. Derive that type through the existing schema generator and include its emitted `params.py`.
- Go's durable stream recovery depended on an unstable generated inline response type name. Infer each endpoint's response locally without changing cursor or terminal behavior.
- Native coverage files inherit private runtime permissions. Transfer only completed regular coverage artifacts to the invoking contributor in a restricted disposable helper; do not broaden production permissions or skip collection.
- The isolated supervisor must give its harness access to the private scratch parent as well as the temporary leaf. Preserve per-handle ownership and private modes.

## Execution checkpoint

Scratch source `10366c4c383ad3792887029a45bb67b56a4721a4`, Actions `36214796945`, passed all five existing SDK journeys after regeneration and the focused OpenCode native fixture. Python reported 201 passed and clean type checking. These are local/scripted provider boundaries, not paid-provider acceptance.

The exact-source domain artifact from source `779008de80d2d06ad5207d9cdf87fecd60bf11f4`, Actions `36214739892`, records **1,223 passing and 31 failing tests across 140 files**. Its captured fixture files match the pinned repository hashes. This full run supersedes incomplete earlier log excerpts for diagnosis; it does not constitute merge approval.

Remaining classification/fixes before acceptance:

- CLI consent discovery omits the three Worker scopes even though the public OAuth contract includes them.
- Existing assertions still assume the retired Docker overlay, pre-Worker key-permission lists, one-at-a-time capacity creation, and a nonexistent `/v1/keys` route.
- Existing local execution fixtures assume a prepaid BYOK reservation despite the implemented zero-cost local compute contract; failures leave subsequent synthetic work/accounting pending.
- The paid-compute budget regression currently selects free local Docker instead of a billable rate. Preserve its exact-limit assertions while correcting the fixture's selected rate.
- Tool-broker fixtures execute priced platform tools after creating an unfunded simulated Run. Supply actual fixture credit; never weaken production reservation checks.
- Streaming changed successful tracing to the canonical generation and made direct submission synchronous by default. Retain strong generation/accounting assertions and explicitly request asynchronous submission for queued-cancellation coverage.
- Isolate scheduler/queued-result failures from preceding synthetic active work before altering ownership or fairness. A nonblocking background claim is allowed to defer; tests must not justify bypassing the scheduler.

The final acceptance result and unresolved release gates belong in [verification](verification.md) and [follow-up](TODO.md). No new unit tests, paid calls, or production migrations are authorized by these diagnostics.
