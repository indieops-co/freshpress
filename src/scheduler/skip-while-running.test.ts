import { describe, it, expect, vi } from 'vitest';
import { skipWhileRunning } from './skip-while-running.js';

function deferred() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('skipWhileRunning', () => {
  it('skips a tick while the previous run is still in flight, then runs again once it finishes', async () => {
    const gate = deferred();
    const job = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue(undefined);
    const tick = skipWhileRunning(job);

    const first = tick();
    expect(await tick()).toBe(false); // overlapping tick — skipped
    expect(job).toHaveBeenCalledTimes(1);

    gate.resolve();
    expect(await first).toBe(true);
    expect(await tick()).toBe(true);
    expect(job).toHaveBeenCalledTimes(2);
  });

  it('releases the guard when the job rejects', async () => {
    const gate = deferred();
    const job = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue(undefined);
    const tick = skipWhileRunning(job);

    const first = tick();
    gate.reject(new Error('boom'));
    await expect(first).rejects.toThrow('boom');
    expect(await tick()).toBe(true);
  });
});
