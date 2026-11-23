// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { PaneContext, type PaneContextValue } from '../paneState';
import { EMPTY_PANE } from '@/lib/paneTabs';
import BrowserChip from '../BrowserChip';

afterEach(cleanup);

const views = [
  { frame_id: '', url: 'https://shop.example.com/cart', title: 'Cart', session: '', live_url: '', steps: [], needs_user: null },
];

describe('BrowserChip', () => {
  it('draws nothing outside a side pane, so it never shows a control that does nothing', () => {
    const { container } = render(<BrowserChip runKey="m4" views={views} />);
    expect(container.textContent).toBe('');
  });

  it('shows "Browser · <host>" and opens that run\'s browser tab on click', () => {
    const openTab = vi.fn();
    const value: PaneContextValue = { state: EMPTY_PANE, dispatch: vi.fn(), openFile: vi.fn(), openTab };
    render(
      <PaneContext.Provider value={value}>
        <BrowserChip runKey="m4" views={views} />
      </PaneContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Browser · shop\.example\.com/ }));
    expect(openTab).toHaveBeenCalledWith({
      kind: 'browser',
      runKey: 'm4',
      title: 'Browser · shop.example.com',
      views,
      running: false,
    });
  });
});
