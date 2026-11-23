// @vitest-environment jsdom
/**
 * The live turn's browser calls. A `browser_update` carries the whole list, so
 * the second one replaces the first rather than adding to it.
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useChatStream } from '../useChatStream';

const call = (url: string) => ({
  frame_id: '',
  url,
  title: url,
  session: '',
  live_url: '',
  steps: [],
  needs_user: null,
});

describe('useChatStream · browser_update', () => {
  it('replaces the turn\'s browser calls on each update, never appends', () => {
    const { result } = renderHook(() => useChatStream());

    act(() => result.current.applyEvent({ type: 'browser_update', browser: [call('https://a.test/')] }));
    expect(result.current.live.browser.map((v) => v.url)).toEqual(['https://a.test/']);

    act(() =>
      result.current.applyEvent({
        type: 'browser_update',
        browser: [call('https://a.test/'), call('https://b.test/')],
      }),
    );
    expect(result.current.live.browser.map((v) => v.url)).toEqual(['https://a.test/', 'https://b.test/']);
  });

  it('reads only well-formed calls from the frame', () => {
    const { result } = renderHook(() => useChatStream());
    act(() => result.current.applyEvent({ type: 'browser_update', browser: [null, call('https://ok.test/')] }));
    expect(result.current.live.browser).toHaveLength(1);
  });

  it('clears the calls when the turn is done, like the files (the saved message keeps them)', () => {
    const { result } = renderHook(() => useChatStream());
    act(() => result.current.applyEvent({ type: 'browser_update', browser: [call('https://a.test/')] }));
    act(() => result.current.applyEvent({ type: 'done' }));
    expect(result.current.live.browser).toEqual([]);
  });
});
