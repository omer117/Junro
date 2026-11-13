/**
 * Wraps async work so it runs once: everyone who asks gets the same promise. If the work fails,
 * the next ask tries again (a failure, such as a network drop, is not remembered for ever).
 */
export function memoizeAsync<T>(work: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= work().catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}
