// @vitest-environment jsdom
/**
 * Signing out stops every chat stream.
 *
 * `lib/chatRuns.ts` keeps a turn streaming after the page that started it
 * unmounts, so only an explicit stop or a sign-out can end it. `abortAllChatRuns`
 * existed for sign-out and nothing called it, so a turn still streaming at
 * logout kept going. Both ways out are pinned: the Logout button, and the
 * forced sign-out when a token refresh fails.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { useContext } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const abortAllChatRuns = vi.fn();
vi.mock('../../lib/chatRuns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/chatRuns')>()),
  abortAllChatRuns: () => abortAllChatRuns(),
}));

let onUnauthorized: (() => void) | undefined;
vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  setUnauthorizedCallback: (cb: () => void) => {
    onUnauthorized = cb;
  },
}));

import { AuthProvider } from '../../contexts/AuthContext';
import { AuthContext } from '../../contexts/authState';

function renderAuth() {
  let ctx: React.ContextType<typeof AuthContext> | undefined;
  function Probe() {
    ctx = useContext(AuthContext);
    return null;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return () => ctx!;
}

describe('sign-out aborts chat streams', () => {
  beforeEach(() => {
    abortAllChatRuns.mockClear();
    onUnauthorized = undefined;
  });

  it('on logout', async () => {
    const auth = renderAuth();
    await act(() => auth().logout());
    expect(abortAllChatRuns).toHaveBeenCalledTimes(1);
  });

  it('on a forced sign-out after a failed token refresh', () => {
    renderAuth();
    expect(onUnauthorized).toBeDefined();
    act(() => onUnauthorized!());
    expect(abortAllChatRuns).toHaveBeenCalledTimes(1);
  });
});
