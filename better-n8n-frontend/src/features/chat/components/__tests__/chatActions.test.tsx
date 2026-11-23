// @vitest-environment jsdom
/**
 * The message action row: Retry, Edit and Take back remove the messages after
 * the one they are on, so they ask first when that is more than the next
 * reply. Delete and Take back sit under "More".
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { StandaloneChatMessage } from '@/api';
import ChatMessageItem from '../ChatMessageItem';

afterEach(cleanup);

const question = {
  id: 5, role: 'user', content: 'Plan the trip', metadata: {},
  created_at: new Date().toISOString(),
} as unknown as StandaloneChatMessage;

const answer = {
  id: 6, role: 'assistant', content: 'Here is a plan.', metadata: {},
  created_at: new Date().toISOString(),
} as unknown as StandaloneChatMessage;

const props = (message: StandaloneChatMessage, over: Record<string, unknown> = {}) => ({
  message,
  index: 1,
  animate: false,
  deleting: false,
  copied: false,
  isSpeaking: false,
  speakLoading: false,
  isPanelOpen: () => false,
  togglePanel: vi.fn(),
  confirmBusy: false,
  onCopy: vi.fn(),
  onSpeak: vi.fn(),
  onDelete: vi.fn(),
  onRewrite: vi.fn(),
  onRewind: vi.fn(),
  onEdit: vi.fn(),
  onCommandConfirm: vi.fn(),
  ...over,
});

// FeedbackControl reads the query client, so a bare render would throw.
const withQueryClient = (ui: Parameters<typeof render>[0]) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

describe('question actions', () => {
  it('Edit runs straight away when only the next reply would be removed', () => {
    const p = props(question, { followingCount: 1 });
    withQueryClient(<ChatMessageItem {...p} />);
    fireEvent.click(screen.getByText('Edit'));
    expect(p.onEdit).toHaveBeenCalledWith(5, 'Plan the trip');
  });

  it('Edit asks first when more would go, and cancelling changes nothing', () => {
    const p = props(question, { followingCount: 4 });
    withQueryClient(<ChatMessageItem {...p} />);
    fireEvent.click(screen.getByText('Edit'));
    expect(p.onEdit).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('This removes the 4 messages after it.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(p.onEdit).not.toHaveBeenCalled();
  });

  it('confirming the question prompt runs Take back', () => {
    const p = props(question, { followingCount: 3 });
    withQueryClient(<ChatMessageItem {...p} />);
    fireEvent.click(screen.getByLabelText('More actions'));
    fireEvent.click(screen.getByText('Take back'));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Take back' }));
    expect(p.onRewind).toHaveBeenCalledWith(5);
  });

  it('More offers Delete, which runs at once', () => {
    const p = props(question);
    withQueryClient(<ChatMessageItem {...p} />);
    fireEvent.click(screen.getByLabelText('More actions'));
    fireEvent.click(screen.getByText('Delete'));
    expect(p.onDelete).toHaveBeenCalledWith(5);
  });
});

describe('answer actions', () => {
  it('Retry is named in words and runs the rewrite for this answer', () => {
    const p = props(answer, { followingCount: 0 });
    withQueryClient(<ChatMessageItem {...p} />);
    fireEvent.click(screen.getByText('Retry'));
    expect(p.onRewrite).toHaveBeenCalledWith(6);
  });

  it('More on an answer offers Delete only, not Take back', () => {
    withQueryClient(<ChatMessageItem {...props(answer)} />);
    fireEvent.click(screen.getByLabelText('More actions'));
    expect(screen.getByText('Delete')).toBeTruthy();
    expect(screen.queryByText('Take back')).toBeNull();
  });
});
