import { describe, expect, it } from 'vitest';

import { runLimited } from '../runLimited';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 2));

describe('runLimited', () => {
  it('never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;

    await runLimited(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      running -= 1;
    });

    expect(peak).toBe(3);
  });

  it('returns results in the order of the items, not of completion', async () => {
    const delays = [6, 1, 3];

    const results = await runLimited(delays, 3, async (ms, index) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return index;
    });

    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([0, 1, 2]);
  });

  it('carries on past a failure and reports it in place', async () => {
    const results = await runLimited([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('refused');
      return n;
    });

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });

  it('runs every item when the limit is larger than the list', async () => {
    const seen: number[] = [];

    await runLimited([1, 2], 10, async (n) => {
      seen.push(n);
    });

    expect(seen.sort()).toEqual([1, 2]);
  });

  it('treats a nonsense limit as one at a time', async () => {
    let running = 0;
    let peak = 0;

    await runLimited([1, 2, 3], 0, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      running -= 1;
    });

    expect(peak).toBe(1);
  });

  it('does nothing for an empty list', async () => {
    expect(await runLimited([], 3, async () => 1)).toEqual([]);
  });
});
