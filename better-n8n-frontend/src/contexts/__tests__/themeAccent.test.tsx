// @vitest-environment jsdom
/**
 * Accent themes: teal is the default, the four accents are the only values,
 * the choice is remembered on this device and written to the account, and the
 * account's saved accent wins once the profile loads.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';

const updateProfile = vi.fn();
vi.mock('../../api/auth', () => ({
  authService: { updateProfile: (...args: unknown[]) => updateProfile(...args) },
}));

let mockUser: { id: number; accent_color?: string; theme_preference?: string } | null = null;
vi.mock('../authState', () => ({
  useAuth: () => ({ user: mockUser }),
}));
vi.mock('../../contexts/authState', () => ({
  useAuth: () => ({ user: mockUser }),
}));

import { ThemeProvider } from '../ThemeContext';
import { useThemeContext } from '../themeState';
import ThemeSync from '../../components/layout/ThemeSync';

function Probe({ onReady }: { onReady: (ctx: ReturnType<typeof useThemeContext>) => void }) {
  const ctx = useThemeContext();
  onReady(ctx);
  return null;
}

function mount(withSync = false) {
  let ctx!: ReturnType<typeof useThemeContext>;
  render(
    <ThemeProvider>
      {withSync && <ThemeSync />}
      <Probe onReady={(c) => (ctx = c)} />
    </ThemeProvider>,
  );
  return () => ctx;
}

beforeEach(() => {
  localStorage.clear();
  mockUser = null;
  updateProfile.mockReset();
  updateProfile.mockResolvedValue({});
  // jsdom has no matchMedia; the provider reads it for the 'system' theme.
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }) as unknown as typeof window.matchMedia;
  document.documentElement.removeAttribute('data-color-theme');
});

afterEach(() => {
  localStorage.clear();
});

describe('accent themes', () => {
  it('defaults to teal on a fresh browser', () => {
    const ctx = mount();
    expect(ctx().colorTheme).toBe('teal');
    expect(document.documentElement.getAttribute('data-color-theme')).toBe('teal');
  });

  it('restores a remembered accent from localStorage', () => {
    localStorage.setItem('colorTheme', 'ink');
    const ctx = mount();
    expect(ctx().colorTheme).toBe('ink');
  });

  it('falls back to teal for a value that is not an accent', () => {
    localStorage.setItem('colorTheme', 'orange');
    const ctx = mount();
    expect(ctx().colorTheme).toBe('teal');
  });

  it('remembers a change on this device and writes it to the account', () => {
    const ctx = mount();
    act(() => ctx().setColorTheme('blue'));
    expect(ctx().colorTheme).toBe('blue');
    expect(localStorage.getItem('colorTheme')).toBe('blue');
    expect(updateProfile).toHaveBeenCalledWith({ accent_color: 'blue' });
  });

  it('keeps the local choice when the account write fails', async () => {
    updateProfile.mockRejectedValue(new Error('offline'));
    const ctx = mount();
    act(() => ctx().setColorTheme('magenta'));
    await waitFor(() => expect(updateProfile).toHaveBeenCalled());
    expect(ctx().colorTheme).toBe('magenta');
    expect(localStorage.getItem('colorTheme')).toBe('magenta');
  });

  it('applies the saved account accent when the profile loads', async () => {
    localStorage.setItem('colorTheme', 'teal');
    mockUser = { id: 7, accent_color: 'magenta' };
    const ctx = mount(true);
    await waitFor(() => expect(ctx().colorTheme).toBe('magenta'));
    expect(localStorage.getItem('colorTheme')).toBe('magenta');
  });

  it('ignores a profile accent it does not recognise', () => {
    mockUser = { id: 8, accent_color: 'blue-green' };
    const ctx = mount(true);
    expect(ctx().colorTheme).toBe('teal');
  });
});
