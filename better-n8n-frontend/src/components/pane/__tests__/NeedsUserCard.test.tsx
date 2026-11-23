// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import NeedsUserCard from '../NeedsUserCard';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('NeedsUserCard', () => {
  it('names the host and what the page needs', () => {
    render(<NeedsUserCard host="bank.example.com" what="the OTP from your phone" liveUrl={null} />);
    expect(screen.getByText('bank.example.com').tagName).toBe('SPAN');
    expect(screen.getByRole('group').textContent).toContain('The assistant needs you on bank.example.com: the OTP from your phone');
  });

  it('opens the live page in a new tab, directly from the click', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<NeedsUserCard host="bank.example.com" what="an OTP" liveUrl="https://live.provider.test/s/9" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the live page' }));
    expect(open).toHaveBeenCalledWith('https://live.provider.test/s/9', '_blank', 'noopener');
  });

  it('calls back on "I\'m done"', () => {
    const onDone = vi.fn();
    render(<NeedsUserCard host="bank.example.com" what="an OTP" liveUrl="https://live.provider.test/s/9" onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: "I'm done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('with no live page, says so plainly, and offers no live button', () => {
    render(<NeedsUserCard host="bank.example.com" what="a CAPTCHA" liveUrl={null} onDone={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Open the live page' })).toBeNull();
    expect(screen.getByText(/There is no live page for this session. Type the code into the chat instead./)).toBeTruthy();
    expect(screen.getByRole('button', { name: "I'm done" })).toBeTruthy();
  });

  it('shows no "I\'m done" where there is no chat to send to', () => {
    render(<NeedsUserCard host="bank.example.com" what="an OTP" liveUrl="https://live.provider.test/s/9" />);
    expect(screen.queryByRole('button', { name: "I'm done" })).toBeNull();
  });
});
