// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The sidebar reads matchMedia when the module loads, and jsdom has none.
vi.hoisted(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

const spendMock = vi.hoisted(() => vi.fn());

vi.mock('../../../contexts/authState', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    user: { name: 'Kaushal Jain', email: 'k@example.com' },
  }),
}));
vi.mock('../../../contexts/imagineState', () => ({
  useImagineOptional: () => null,
}));
vi.mock('../../../hooks/useHitlPending', () => ({
  useHitlPending: () => ({ data: [] }),
}));
vi.mock('../../../hooks/useActivityLive', () => ({
  useLiveCount: () => 0,
}));
vi.mock('../../../api', () => ({
  notificationsService: { getNotifications: async () => [] },
}));
vi.mock('../../../api/spend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/spend')>();
  return { ...actual, spendService: { getMonthSummary: spendMock } };
});
vi.mock('sonner', () => ({ toast: { info: vi.fn() } }));

import Sidebar from '../Sidebar';

afterEach(() => {
  cleanup();
  spendMock.mockReset();
});

function renderSidebar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/runs']}>
        <Sidebar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Sidebar', () => {
  it('shows this month’s spend under the nav when the summary loads', async () => {
    spendMock.mockResolvedValue({ month_rupees: 68 });
    renderSidebar();
    expect(await screen.findByText('₹68 this month')).toBeTruthy();
  });

  it('hides the spend line when the request fails', async () => {
    spendMock.mockRejectedValue(new Error('down'));
    renderSidebar();
    await waitFor(() => expect(spendMock).toHaveBeenCalled());
    expect(screen.queryByText(/this month/)).toBeNull();
  });

  it('puts New chat at the top, as a single button', () => {
    renderSidebar();
    expect(screen.getAllByRole('button', { name: 'New chat' })).toHaveLength(1);
  });

  it('keeps the profile and notifications links at the bottom', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: 'Profile and settings' }).getAttribute('href')).toBe('/profile');
    expect(screen.getByRole('link', { name: 'Notifications' }).getAttribute('href')).toBe('/settings');
  });

  it('marks the active destination with the muted background and primary icon', () => {
    renderSidebar();
    const activity = screen.getByRole('link', { name: /Activity/ });
    expect(activity.getAttribute('aria-current')).toBe('page');
    expect(activity.className).toMatch(/bg-muted/);
    expect(activity.className).not.toMatch(/shadow/);
  });
});
