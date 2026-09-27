import { describe as group, expect, it } from 'vitest';
import {
  DEFAULT_EFFORT, EFFORT_HINTS, EFFORT_LABELS, EFFORT_LADDER,
  effortLevelsFor, nearestEffort,
} from '../useEffortSelection';
import type { AIProvider } from '../../api/nodeService';

/**
 * The ladder is written down twice — here and in `Backend/llm/effort.py` — and
 * the two copies have to agree, for the same reason the cron wording does: the
 * backend snaps a level it does not recognise, silently, so a spelling that
 * drifted here would show up as a control that appears to work and quietly
 * runs at a different effort. Pinned as a literal rather than derived from
 * anything, so a rename has to be made in both places deliberately.
 *
 * `LADDER` in `llm/effort.py`, cheapest first:
 *     ("none", "minimal", "low", "medium", "high")
 */
group('EFFORT_LADDER', () => {
  it('matches the backend ladder, in the backend order', () => {
    expect([...EFFORT_LADDER]).toEqual(['none', 'minimal', 'low', 'medium', 'high']);
  });

  it('is ordered cheapest first', () => {
    // The picker renders this array left to right and the backend's tie-break
    // resolves downward; both assume the same direction.
    expect(EFFORT_LADDER[0]).toBe('none');
    expect(EFFORT_LADDER[EFFORT_LADDER.length - 1]).toBe('high');
  });
});

group('labels', () => {
  it('names every rung, plus the empty default', () => {
    // A rung with no label renders its raw API value in the UI — readable, but
    // `minimal` next to `Instant` and `High` is the kind of inconsistency that
    // looks like a bug.
    for (const level of ['', ...EFFORT_LADDER]) {
      expect(EFFORT_LABELS[level], level).toBeTruthy();
      expect(EFFORT_HINTS[level], level).toBeTruthy();
    }
  });

  it("calls the empty choice a default rather than an effort", () => {
    // `''` is not a rung: it means "we send no level and the model uses its
    // own". Labelling it 'None' would collide with the `none` rung, which is a
    // genuinely different request — think as little as possible, but do think.
    expect(EFFORT_LABELS['']).toBe('Default');
    expect(EFFORT_LABELS['']).not.toBe(EFFORT_LABELS.none);
  });
});

group('nearestEffort', () => {
  // Mirrors `nearest` in `Backend/llm/effort.py`. The two have to agree or the
  // UI shows one level and the run uses another — a disagreement nothing would
  // report, because the server snaps silently by design.
  it('returns an offered rung unchanged', () => {
    expect(nearestEffort('medium', ['low', 'medium', 'high'])).toBe('medium');
  });

  it('snaps a rung the model does not offer', () => {
    expect(nearestEffort('minimal', ['low', 'medium', 'high'])).toBe('low');
    expect(nearestEffort('none', ['high'])).toBe('high');
  });

  it('breaks ties downward, so a tie never costs money', () => {
    expect(nearestEffort('low', ['minimal', 'medium'])).toBe('minimal');
  });

  it('has nothing to return when the model offers nothing', () => {
    expect(nearestEffort('high', [])).toBe('');
  });
});

group('effortLevelsFor', () => {
  const catalogue = [
    {
      slug: 'openrouter', name: 'OpenRouter', description: '', icon: '',
      has_credentials: true,
      models: [
        {
          name: 'Free Models Router', value: 'openrouter/free', is_free: true,
          description: '', effort_levels: ['low', 'medium', 'high'],
          default_effort: '', supports_effort: true,
        },
        {
          name: 'Plain', value: 'x/plain', is_free: true, description: '',
          effort_levels: [], default_effort: '', supports_effort: false,
        },
      ],
    },
  ] as unknown as AIProvider[];

  it('reads the rungs off the selected model', () => {
    expect(effortLevelsFor(catalogue, 'openrouter', 'openrouter/free'))
      .toEqual(['low', 'medium', 'high']);
  });

  it('returns [] for a model with no effort control', () => {
    expect(effortLevelsFor(catalogue, 'openrouter', 'x/plain')).toEqual([]);
  });

  it('returns [] rather than throwing before the catalogue arrives', () => {
    // The pre-load case. Every model looks like it offers nothing here, which
    // is why nothing may *clear* a stored preference on this basis.
    expect(effortLevelsFor([], 'openrouter', 'openrouter/free')).toEqual([]);
  });
});

group('DEFAULT_EFFORT', () => {
  it('is a rung the default model actually serves', () => {
    // `openrouter/free` declares the standard three in `populate_models.py`.
    // A default outside that set would be snapped away on the very first
    // message, so the shipped default would never be the shipped default.
    expect(nearestEffort(DEFAULT_EFFORT, ['low', 'medium', 'high']))
      .toBe(DEFAULT_EFFORT);
  });

  it('matches the ChatSession column default', () => {
    expect(DEFAULT_EFFORT).toBe('medium');
  });
});
