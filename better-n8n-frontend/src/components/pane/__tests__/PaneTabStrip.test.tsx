// @vitest-environment jsdom
/**
 * The tab strip draws what it is given and reports clicks through its
 * callbacks. A tab and its × are siblings, so the × never also activates.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { PaneTab } from '@/lib/paneTabs';
import PaneTabStrip from '../PaneTabStrip';

afterEach(cleanup);

const tabs: PaneTab[] = [
  { id: 'file:1', kind: 'file', title: 'a.pdf', target: { documentId: 1 }, nonce: 1 },
  { id: 'file:2', kind: 'file', title: 'b.md', target: { documentId: 2 }, nonce: 1 },
];

const props = () => ({
  tabs,
  activeId: 'file:1',
  onActivate: vi.fn(),
  onClose: vi.fn(),
  onMenu: vi.fn(),
  onBack: vi.fn(),
});

describe('PaneTabStrip', () => {
  it('renders every tab and marks the active one', () => {
    render(<PaneTabStrip {...props()} />);
    expect(screen.getByRole('tab', { name: 'a.pdf' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'b.md' }).getAttribute('aria-selected')).toBe('false');
  });

  it('clicking a tab activates it and does not close it', () => {
    const p = props();
    render(<PaneTabStrip {...p} />);
    fireEvent.click(screen.getByRole('tab', { name: 'b.md' }));
    expect(p.onActivate).toHaveBeenCalledWith('file:2');
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it('clicking × closes that tab and does not also activate it', () => {
    const p = props();
    render(<PaneTabStrip {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close b.md' }));
    expect(p.onClose).toHaveBeenCalledWith('file:2');
    expect(p.onActivate).not.toHaveBeenCalled();
  });

  it('the ⋯ button asks for the menu of the active tab, and a right-click asks for that tab', () => {
    const p = props();
    render(<PaneTabStrip {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tab actions' }));
    expect(p.onMenu).toHaveBeenLastCalledWith(null);

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'b.md' }));
    expect(p.onMenu).toHaveBeenLastCalledWith('file:2');
  });

  it('the Back button hides the pane', () => {
    const p = props();
    render(<PaneTabStrip {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(p.onBack).toHaveBeenCalled();
  });

  it('has one Tab stop: the active tab is focusable, the others are not', () => {
    render(<PaneTabStrip {...props()} />);
    expect(screen.getByRole('tab', { name: 'a.pdf' }).tabIndex).toBe(0);
    expect(screen.getByRole('tab', { name: 'b.md' }).tabIndex).toBe(-1);
  });

  it('Right and Left arrows move to the neighbouring tab', () => {
    const p = props();
    render(<PaneTabStrip {...p} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'a.pdf' }), { key: 'ArrowRight' });
    expect(p.onActivate).toHaveBeenLastCalledWith('file:2');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'a.pdf' }), { key: 'ArrowLeft' });
    // No tab to the left of the first: nothing happens.
    expect(p.onActivate).toHaveBeenCalledTimes(1);
  });

  it('Delete on a focused tab closes it', () => {
    const p = props();
    render(<PaneTabStrip {...p} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'b.md' }), { key: 'Delete' });
    expect(p.onClose).toHaveBeenCalledWith('file:2');
  });

  it('keys on the × button do not act on the tab', () => {
    const p = props();
    render(<PaneTabStrip {...p} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close b.md' }), { key: 'Delete' });
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it('a media tab shows the icon for its kind and draws without a scrollIntoView', () => {
    const media: PaneTab[] = [
      { id: 'media:/a.mp4', kind: 'media', title: 'clip.mp4', mediaType: 'video', src: '/a.mp4' },
    ];
    render(<PaneTabStrip {...props()} tabs={media} activeId="media:/a.mp4" />);
    expect(screen.getByRole('tab', { name: 'clip.mp4' })).toBeTruthy();
  });
});
