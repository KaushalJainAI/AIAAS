// @vitest-environment jsdom
import { describe as group, expect, it, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useChatModelSelection } from '../useChatModelSelection';
import type { AIProvider } from '../../api/nodeService';

const PROVIDER_KEY = 'standalone_chat_llm_provider';
const MODEL_KEY = 'standalone_chat_llm_model';

function provider(slug: string, values: string[]): AIProvider {
  return {
    name: slug,
    slug,
    description: '',
    icon: '',
    has_credentials: true,
    models: values.map((value) => ({
      name: value,
      value,
      is_free: false,
      description: '',
      effort_levels: [],
      default_effort: '',
      supports_effort: false,
    })),
  };
}

const PROVIDERS = [provider('openrouter', ['openrouter/free', 'openrouter/auto'])];

group('useChatModelSelection stale-id reconciliation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps a stored model the catalogue still lists', () => {
    localStorage.setItem(PROVIDER_KEY, 'openrouter');
    localStorage.setItem(MODEL_KEY, 'openrouter/auto');
    const { result } = renderHook(() =>
      useChatModelSelection({ providers: PROVIDERS, fallbackModel: 'openrouter/free' }),
    );
    expect(result.current.model).toBe('openrouter/auto');
  });

  it('prefers the platform fallback when the stored id is gone', () => {
    localStorage.setItem(PROVIDER_KEY, 'openrouter');
    localStorage.setItem(MODEL_KEY, 'gone/model');
    const { result } = renderHook(() =>
      useChatModelSelection({ providers: PROVIDERS, fallbackModel: 'openrouter/free' }),
    );
    // The backend substitutes this same id at preflight, so the picker and
    // the turn agree instead of the picker showing one model and the turn
    // running another.
    expect(result.current.model).toBe('openrouter/free');
    expect(localStorage.getItem(MODEL_KEY)).toBe('openrouter/free');
  });

  it('takes the first model when the provider does not serve the fallback', () => {
    localStorage.setItem(PROVIDER_KEY, 'openrouter');
    localStorage.setItem(MODEL_KEY, 'gone/model');
    const { result } = renderHook(() =>
      useChatModelSelection({ providers: PROVIDERS, fallbackModel: 'other/model' }),
    );
    expect(result.current.model).toBe('openrouter/free');
  });

  it('leaves guests on their pinned model', () => {
    const { result } = renderHook(() =>
      useChatModelSelection({ isGuest: true, providers: PROVIDERS, fallbackModel: 'openrouter/free' }),
    );
    expect(result.current.model).toBe('nvidia/nemotron-3.5-lightning-30b-a3b');
  });
});
