/**
 * Pins the supervision policy list to the backend's `eval/supervision.py::POLICIES`.
 *
 * Same pinning pattern as `src/lib/__tests__/cron.test.ts`: the two sides are
 * in different languages with no shared import, so a test that fails when one
 * changes without the other is the only thing keeping them in step.
 */
import { describe, expect, it } from 'vitest';

import type { SupervisionPolicy } from '../evals';

describe('eval supervision policies', () => {
  it('matches eval/supervision.py::POLICIES', () => {
    const backendPolicies = ['none', 'failures', 'disagreement', 'sampled', 'all'];
    const frontendPolicies: SupervisionPolicy[] = ['none', 'failures', 'disagreement', 'sampled', 'all'];
    expect([...frontendPolicies].sort()).toEqual([...backendPolicies].sort());
  });
});
