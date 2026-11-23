// @vitest-environment jsdom
/**
 * The Browser tab. Its picture comes from the server, so the API module is
 * mocked: every picture 404s (expired), which is the answer the server gives
 * for an aged-out frame.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import type { BrowserView } from '@/api/browser';
import BrowserTabBody from '../BrowserTabBody';

vi.mock('@/api/browser', () => ({
  browserService: {
    frameBlob: vi.fn(() => Promise.reject({ response: { status: 404 } })),
    status: vi.fn(),
    preview: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const call = (over: Partial<BrowserView> = {}): BrowserView => ({
  frame_id: 'frame-1',
  url: 'https://shop.example.com/cart',
  title: 'Cart',
  session: 's1',
  live_url: '',
  steps: [],
  needs_user: null,
  ...over,
});

describe('BrowserTabBody', () => {
  it('shows each call with its steps, and a tick or a cross for each step', () => {
    render(
      <BrowserTabBody
        views={[
          call({
            steps: [
              { action: 'click', selector: '#buy', ok: true },
              { action: 'fill', selector: '#promo', ok: false },
            ],
          }),
        ]}
        running={false}
        onHide={vi.fn()}
      />,
    );
    expect(screen.getByText('#buy')).toBeTruthy();
    expect(screen.getByText('#promo')).toBeTruthy();
    expect(screen.getByLabelText('Step worked')).toBeTruthy();
    expect(screen.getByLabelText('Step failed')).toBeTruthy();
  });

  it('says the picture has expired when the server no longer has it', async () => {
    render(<BrowserTabBody views={[call({ frame_id: 'gone' })]} running={false} onHide={vi.fn()} />);
    expect(await screen.findByText('This picture has expired.')).toBeTruthy();
  });

  it('says no picture was kept when the call has no frame', () => {
    render(<BrowserTabBody views={[call({ frame_id: '' })]} running={false} onHide={vi.fn()} />);
    expect(screen.getByText('No picture was kept for this call.')).toBeTruthy();
  });

  it('offers "Watch live / take over" only when a live view is set, and opens it in a new tab on click', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { unmount } = render(<BrowserTabBody views={[call()]} running={false} onHide={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Watch live \/ take over/ })).toBeNull();
    unmount();

    render(
      <BrowserTabBody
        views={[call({ live_url: 'https://live.provider.test/session/1' })]}
        running={false}
        onHide={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Watch live \/ take over/ }));
    expect(open).toHaveBeenCalledWith('https://live.provider.test/session/1', '_blank', 'noopener');
  });

  it('while the agent waits for the person, the live page is offered once, in the hand-off card', () => {
    render(
      <BrowserTabBody
        views={[call({ needs_user: 'an OTP', live_url: 'https://live.provider.test/s/2' })]}
        running={false}
        onHide={vi.fn()}
        onSendText={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('button', { name: 'Open the live page' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Watch live \/ take over/ })).toBeNull();
  });

  it('says the assistant is using the page only while the turn is running', () => {
    const { rerender } = render(<BrowserTabBody views={[call()]} running onHide={vi.fn()} />);
    expect(screen.getByText('The assistant is using this page')).toBeTruthy();
    rerender(<BrowserTabBody views={[call()]} running={false} onHide={vi.fn()} />);
    expect(screen.queryByText('The assistant is using this page')).toBeNull();
  });

  it('shows the hand-off card for a call that needs the person, and "I\'m done" sends the continue message', () => {
    const send = vi.fn();
    render(
      <BrowserTabBody
        views={[call({ needs_user: 'Enter the code we sent you' })]}
        running={false}
        onHide={vi.fn()}
        onSendText={send}
      />,
    );
    const card = screen.getByRole('group', { name: 'The assistant needs you' });
    expect(within(card).getByText(/Enter the code we sent you/)).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: "I'm done" }));
    expect(send).toHaveBeenCalledWith('Done on shop.example.com. Continue.');
  });

  it('draws the newest call first, and tapping a call selects it', () => {
    render(
      <BrowserTabBody
        views={[call({ title: 'First', url: 'https://a.example.com/' }), call({ title: 'Second', url: 'https://b.example.com/' })]}
        running={false}
        onHide={vi.fn()}
      />,
    );
    // The call buttons are the ones that report pressed state.
    const buttons = screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'));
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toContain('Second');
    expect(buttons[1].textContent).toContain('First');
    fireEvent.click(buttons[1]);
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
  });
});
