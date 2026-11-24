// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import PendingSends, { type PendingSendItem } from '../PendingSends';

const NOW = Date.parse('2026-11-24T10:00:00Z');

function hold(overrides: Partial<PendingSendItem> = {}): PendingSendItem {
  return {
    id: 7,
    tool: 'message_send',
    label: 'Slack #general',
    status: 'held',
    send_at: new Date(NOW + 120_000).toISOString(),
    error: '',
    seconds_left: 120,
    fetchedAt: NOW,
    ...overrides,
  };
}

const noop = () => {};

describe('PendingSends', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('counts down from the server figure, one second at a time', () => {
    render(<PendingSends holds={[hold()]} onCancel={noop} onSendNow={noop} />);
    expect(screen.getByText('Sends in 2:00')).toBeTruthy();

    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('Sends in 1:59')).toBeTruthy();

    act(() => { vi.advanceTimersByTime(59_000); });
    expect(screen.getByText('Sends in 1:00')).toBeTruthy();
  });

  it('shows "Sending now" when the countdown reaches zero while still held', () => {
    render(<PendingSends holds={[hold({ seconds_left: 2 })]} onCancel={noop} onSendNow={noop} />);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText('Sending now…')).toBeTruthy();
  });

  it('calls onCancel with the hold id', () => {
    const onCancel = vi.fn();
    render(<PendingSends holds={[hold({ id: 42 })]} onCancel={onCancel} onSendNow={noop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledWith(42);
  });

  it('calls onSendNow with the hold id', () => {
    const onSendNow = vi.fn();
    render(<PendingSends holds={[hold({ id: 42 })]} onCancel={noop} onSendNow={onSendNow} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    expect(onSendNow).toHaveBeenCalledWith(42);
  });

  it('shows "Cancelled" for a cancelled row, with no buttons', () => {
    render(
      <PendingSends
        holds={[hold({ status: 'cancelled', settledAt: NOW })]}
        onCancel={noop}
        onSendNow={noop}
      />,
    );
    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('shows "Might not have been sent" for an unknown row', () => {
    render(
      <PendingSends
        holds={[hold({ status: 'unknown', settledAt: NOW })]}
        onCancel={noop}
        onSendNow={noop}
      />,
    );
    expect(screen.getByText('Might not have been sent')).toBeTruthy();
  });

  it('shows the error for a failed row', () => {
    render(
      <PendingSends
        holds={[hold({ status: 'failed', error: 'Slack refused the channel', settledAt: NOW })]}
        onCancel={noop}
        onSendNow={noop}
      />,
    );
    expect(screen.getByText('Not sent: Slack refused the channel')).toBeTruthy();
  });

  it('hides a finished row two minutes after it settled', () => {
    render(
      <PendingSends
        holds={[hold({ status: 'sent', settledAt: NOW })]}
        onCancel={noop}
        onSendNow={noop}
      />,
    );
    expect(screen.getByText('Sent ✓')).toBeTruthy();

    act(() => { vi.advanceTimersByTime(120_000); });
    expect(screen.queryByText('Sent ✓')).toBeNull();
  });

  it('renders nothing visible for an empty list, keeping the live region', () => {
    const { container } = render(<PendingSends holds={[]} onCancel={noop} onSendNow={noop} />);
    expect(container.querySelector('section')?.getAttribute('aria-live')).toBe('polite');
    expect(container.querySelector('li')).toBeNull();
  });
});
