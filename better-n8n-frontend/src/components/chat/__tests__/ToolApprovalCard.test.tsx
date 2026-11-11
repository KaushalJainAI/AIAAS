// @vitest-environment jsdom
/**
 * The "Waiting for you" approval card: its risk tag, first-contact note,
 * action label, and the "Applies to" choice that decides what the yes covers.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { PendingToolCall } from '../../../hooks/useChatStream';
import ToolApprovalCard from '../ToolApprovalCard';

afterEach(cleanup);

const emailCall: PendingToolCall = {
  tool: 'gmail_send_message',
  call_id: 'c9',
  args: { to: 'accounts@northwind-supply.in', subject: 'Credit note' },
  detail: {
    title: 'Email a vendor',
    sentence: 'The assistant wants to send an email.',
    server: '',
    tool: 'gmail_send_message',
    fields: [
      { label: 'Action', value: 'Send email from your Gmail' },
      { label: 'To', value: 'accounts@northwind-supply.in' },
      { label: 'Subject', value: 'Credit note' },
    ],
    effect: 'irreversible',
    leaves_workspace: true,
    first_contact: true,
    action_label: 'Send email',
  },
};

describe('ToolApprovalCard waiting-for-you header', () => {
  it('shows the risk tag joined with a middle dot', () => {
    render(<ToolApprovalCard call={emailCall} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByText('Waiting for you')).toBeTruthy();
    expect(screen.getByText("Leaves the workspace · can't be undone")).toBeTruthy();
  });

  it('omits the risk tag when the description carries no effect fields', () => {
    const bare: PendingToolCall = { ...emailCall, detail: { ...emailCall.detail!, effect: undefined, leaves_workspace: undefined } };
    render(<ToolApprovalCard call={bare} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.queryByText(/can't be undone|can be undone|Leaves the workspace/)).toBeNull();
  });

  it('marks a first-time recipient next to the To field', () => {
    render(<ToolApprovalCard call={emailCall} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByText(/first time this agent writes to them/)).toBeTruthy();
  });

  it('labels the primary button with action_label, falling back to Approve', () => {
    const { unmount } = render(<ToolApprovalCard call={emailCall} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByText('Send email')).toBeTruthy();
    unmount();
    render(<ToolApprovalCard call={{ ...emailCall, detail: { ...emailCall.detail!, action_label: undefined } }} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByText('Approve')).toBeTruthy();
  });

  it('keeps the raw call behind a closed disclosure', () => {
    render(<ToolApprovalCard call={emailCall} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByText('Show raw call')).toBeTruthy();
    expect(screen.queryByText('Edit draft')).toBeNull();
  });
});

describe('ToolApprovalCard "Applies to"', () => {
  it('offers this recipient, this chat, and passes the match with session scope', () => {
    const onApprove = vi.fn();
    render(<ToolApprovalCard call={emailCall} onApprove={onApprove} onDeny={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Applies to'), { target: { value: 'recipient' } });
    fireEvent.click(screen.getByText('Send email'));
    expect(onApprove).toHaveBeenCalledWith('c9', 'session', { to: 'accounts@northwind-supply.in' });
  });

  it('offers no recipient option when the call names no recipient', () => {
    const noRecipient: PendingToolCall = { ...emailCall, args: { subject: 'x' } };
    render(<ToolApprovalCard call={noRecipient} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.queryByText('this recipient, this chat')).toBeNull();
  });

  it('never offers always for a worker request', () => {
    const worker: PendingToolCall = {
      ...emailCall,
      tool: 'answer_subagent',
      detail: { ...emailCall.detail!, title: 'Analyst · send email' },
    };
    render(<ToolApprovalCard call={worker} onApprove={vi.fn()} onDeny={vi.fn()} />);
    const options = Array.from(screen.getByLabelText('Applies to').querySelectorAll('option')).map((o) => o.textContent);
    expect(options).not.toContain('always');
    expect(screen.getByText('Analyst')).toBeTruthy();
  });
});
