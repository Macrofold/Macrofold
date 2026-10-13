/** Refill independent I/O slots immediately. On failure stop taking new work,
 * drain already-started operations, then reject so callers may release leases. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  operation: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1)
    throw new RangeError('Concurrency must be a positive integer.');
  const results = new Array<R>(items.length);
  let next = 0;
  let failure: { error: unknown } | undefined;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (!failure && next < items.length) {
        const index = next++;
        try {
          results[index] = await operation(items[index], index);
        } catch (error) {
          failure ??= { error };
        }
      }
    }),
  );
  if (failure) throw failure.error;
  return results;
}
