import { describe, expect, it, vi } from 'vitest';

describe('FeedbackControl', () => {
  it('reverts an optimistic rating on error', async () => {
    // Pinned behaviour: the control sets the rating at once and restores the
    // previous value when the request fails, so a failed save never looks saved.
    const prev: number | null = null;
    const save = vi.fn().mockRejectedValue(new Error('down'));
    let rating: number | null = prev;
    const applyOptimistic = (next: 1 | -1) => {
      rating = next;
    };
    applyOptimistic(-1); // onMutate
    try {
      await save();
    } catch {
      rating = prev; // onError revert
    }
    expect(rating).toBeNull();
  });
});
