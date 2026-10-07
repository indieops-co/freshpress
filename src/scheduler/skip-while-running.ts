/**
 * Wraps a scheduler job so a tick is skipped while the previous run is still in
 * flight. setInterval doesn't wait for async work, so without this a run longer
 * than the interval overlaps the next one, both working from the same due list.
 * The returned function resolves `false` when it skipped, `true` when it ran;
 * the job's own rejection propagates (and still releases the guard).
 */
export function skipWhileRunning(job: () => Promise<void>): () => Promise<boolean> {
  let running = false;
  return async () => {
    if (running) return false;
    running = true;
    try {
      await job();
      return true;
    } finally {
      running = false;
    }
  };
}
