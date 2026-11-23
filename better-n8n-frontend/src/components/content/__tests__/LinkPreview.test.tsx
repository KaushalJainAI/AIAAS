// @vitest-environment jsdom
/**
 * The Preview icon beside an external link in an answer. It is offered only
 * when the server has a browser, the screen is desktop-sized and there is a
 * pane to open it in. Otherwise the link stands alone, with no icon at all.
 */
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { browserService } from '@/api/browser';
import { PaneContext, type PaneContextValue } from '@/components/pane/paneState';
import { EMPTY_PANE } from '@/lib/paneTabs';
import { resetBrowserAvailabilityForTests } from '@/hooks/useBrowserAvailable';
import MarkdownMessage from '../MarkdownMessage';

vi.mock('@/api/browser', () => ({
  browserService: {
    status: vi.fn(),
    preview: vi.fn(),
    frameBlob: vi.fn(),
  },
}));

const status = vi.mocked(browserService.status);
const LINK = 'See [the docs](https://docs.example.test/guide) for more.';

/** Lets the availability check resolve and React draw its answer. */
const settle = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

function setDesktop(desktop: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: desktop,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function withPane(openTab: PaneContextValue['openTab']) {
  const value: PaneContextValue = {
    state: EMPTY_PANE,
    dispatch: vi.fn(),
    openFile: vi.fn(),
    openTab,
  };
  return (ui: ReactElement) => <PaneContext.Provider value={value}>{ui}</PaneContext.Provider>;
}

beforeEach(() => {
  resetBrowserAvailabilityForTests();
  setDesktop(true);
  // Signed in: the availability check only asks a signed-in user (`tokenManager.isAuthenticated`).
  localStorage.setItem('access_token', 'test-token');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe('link preview icon', () => {
  it('a guest is never asked: the endpoint needs a signed-in user, and a 401 would send them to login', async () => {
    localStorage.clear();
    status.mockResolvedValue(true);
    const openTab = vi.fn();
    render(withPane(openTab)(<MarkdownMessage content={LINK} />));
    await settle();
    expect(status).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Preview/ })).toBeNull();
  });

  it('is absent when the server says there is no browser', async () => {
    status.mockResolvedValue(false);
    const openTab = vi.fn();
    render(withPane(openTab)(<MarkdownMessage content={LINK} />));
    await settle();
    expect(status).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Preview/ })).toBeNull();
    expect(screen.getByRole('link', { name: /the docs/ }).getAttribute('target')).toBe('_blank');
  });

  it('opens a link tab in the pane when the server has a browser, on desktop', async () => {
    status.mockResolvedValue(true);
    const openTab = vi.fn();
    render(withPane(openTab)(<MarkdownMessage content={LINK} />));
    const preview = await screen.findByRole('button', { name: 'Preview docs.example.test' });
    fireEvent.click(preview);
    expect(openTab).toHaveBeenCalledWith({
      kind: 'link',
      title: 'docs.example.test',
      url: 'https://docs.example.test/guide',
    });
  });

  it('is absent on a phone, even when the server has a browser', async () => {
    setDesktop(false);
    status.mockResolvedValue(true);
    render(withPane(vi.fn())(<MarkdownMessage content={LINK} />));
    await settle();
    // Not even asked: a phone never shows the control, so the server is not called for it.
    expect(status).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Preview/ })).toBeNull();
  });

  it('is absent outside a side pane, so it never shows a control that does nothing', async () => {
    status.mockResolvedValue(true);
    render(<MarkdownMessage content={LINK} />);
    await settle();
    expect(status).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Preview/ })).toBeNull();
  });
});
