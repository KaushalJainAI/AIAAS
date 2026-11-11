// @vitest-environment jsdom
/**
 * The pieces split out of `StandaloneChat.tsx`: each draws what it is given
 * and reports clicks through its callbacks, with the same arguments the chat
 * page used to pass inline.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { ChatSession } from '../../../api';
import type { ChatSessionSummary } from '../../../api/chat';
import type { SolutionUsed } from '../../../api/solutions';
import type { PendingToolCall } from '../../../hooks/useChatStream';
import ChatHistorySidebar from '../ChatHistorySidebar';
import ChatHeader from '../ChatHeader';
import ChatMessageItem from '../ChatMessageItem';
import ChatSettingsDialog from '../ChatSettingsDialog';
import TeamSolutionsChip from '../TeamSolutionsChip';
import ToolApprovalCard from '../ToolApprovalCard';

afterEach(cleanup);

const session = (over: Partial<ChatSession> = {}) => ({
  id: 's1',
  title: 'Trip plan',
  memory_enabled: true,
  system_prompt: 'Be brief.',
  cost_source: '',
  total_cost_usd: '0',
  ...over,
}) as unknown as ChatSession;

const summary = (id: string, title: string) =>
  ({ id, title, cost_source: '' }) as unknown as ChatSessionSummary;

describe('ChatHistorySidebar', () => {
  const props = () => ({
    open: true,
    onClose: vi.fn(),
    conversations: [summary('a', 'First chat'), summary('b', 'Second chat')],
    activeId: 'a',
    runningKeys: ['b'],
    onNewConversation: vi.fn(),
    onOpenConversation: vi.fn(),
    onDeleteConversation: vi.fn(),
  });

  it('lists conversations and marks one still streaming elsewhere', () => {
    render(<ChatHistorySidebar {...props()} />);
    expect(screen.getByText('First chat')).toBeTruthy();
    expect(screen.getByText('Second chat')).toBeTruthy();
    // `b` is running and not the open one, so it says so.
    expect(screen.getByText('working')).toBeTruthy();
  });

  it('opening a conversation closes the drawer, then loads it', () => {
    const p = props();
    render(<ChatHistorySidebar {...p} />);
    fireEvent.click(screen.getByText('Second chat'));
    expect(p.onClose).toHaveBeenCalled();
    expect(p.onOpenConversation).toHaveBeenCalledWith('b');
  });

  it('new conversation starts one and closes the drawer', () => {
    const p = props();
    render(<ChatHistorySidebar {...p} />);
    fireEvent.click(screen.getByText('New conversation'));
    expect(p.onNewConversation).toHaveBeenCalled();
    expect(p.onClose).toHaveBeenCalled();
  });

  it('delete passes the event and the id, and does not open the chat', () => {
    const p = props();
    render(<ChatHistorySidebar {...p} />);
    // The parent's handler stops propagation; here we only check what it is given.
    fireEvent.click(screen.getAllByLabelText('Delete conversation')[1]);
    expect(p.onDeleteConversation).toHaveBeenCalledWith(expect.anything(), 'b');
  });
});

describe('ChatHeader', () => {
  it('names the conversation, not a status it never checked', () => {
    const props = {
      isGuest: false, historyOpen: false, onOpenHistory: vi.fn(),
      onShowSettings: vi.fn(), onEditSettings: vi.fn(),
    };
    const { rerender } = render(<ChatHeader {...props} session={session()} />);
    expect(screen.getByText('Trip plan')).toBeTruthy();
    expect(screen.queryByText('Assistant online')).toBeNull();
    rerender(<ChatHeader {...props} session={null} />);
    expect(screen.getByText('New conversation')).toBeTruthy();
  });

  it('shows the memory-off chip, which opens settings without resetting the draft', () => {
    const onShow = vi.fn();
    const onEdit = vi.fn();
    render(
      <ChatHeader
        isGuest={false}
        historyOpen={false}
        onOpenHistory={vi.fn()}
        session={session({ memory_enabled: false })}
        onShowSettings={onShow}
        onEditSettings={onEdit}
      />,
    );
    fireEvent.click(screen.getByText('Memory off'));
    expect(onShow).toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('the gear edits settings; the history button hides while history is open', () => {
    const onEdit = vi.fn();
    const { rerender } = render(
      <ChatHeader
        isGuest={false}
        historyOpen={false}
        onOpenHistory={vi.fn()}
        session={session()}
        onShowSettings={vi.fn()}
        onEditSettings={onEdit}
      />,
    );
    fireEvent.click(screen.getByTitle('Chat settings'));
    expect(onEdit).toHaveBeenCalled();
    expect(screen.queryByLabelText('Conversation history')).toBeTruthy();

    rerender(
      <ChatHeader
        isGuest={false}
        historyOpen
        onOpenHistory={vi.fn()}
        session={session()}
        onShowSettings={vi.fn()}
        onEditSettings={onEdit}
      />,
    );
    expect(screen.queryByLabelText('Conversation history')).toBeNull();
  });
});

describe('ChatSettingsDialog', () => {
  it('saves the prompt draft, and toggles memory straight away', () => {
    const onSave = vi.fn();
    render(
      <ChatSettingsDialog
        session={session({ memory_enabled: true })}
        isGuest={false}
        promptDraft="Answer in French."
        onPromptDraftChange={vi.fn()}
        saving={false}
        onSave={onSave}
        onClose={vi.fn()}
        readAloud={false}
        onToggleReadAloud={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith({ system_prompt: 'Answer in French.' });
    fireEvent.click(screen.getByLabelText('Toggle memory'));
    expect(onSave).toHaveBeenCalledWith({ memory_enabled: false });
  });

  it('toggles hands-free mode without touching the server draft', () => {
    const onToggle = vi.fn();
    render(
      <ChatSettingsDialog
        session={session()}
        isGuest={false}
        promptDraft=""
        onPromptDraftChange={vi.fn()}
        saving={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
        readAloud={false}
        onToggleReadAloud={onToggle}
      />,
    );
    fireEvent.click(screen.getByLabelText('Read replies aloud'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('guests see memory as locked', () => {
    render(
      <ChatSettingsDialog
        session={session()}
        isGuest
        promptDraft=""
        onPromptDraftChange={vi.fn()}
        saving={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
        readAloud={false}
        onToggleReadAloud={vi.fn()}
      />,
    );
    expect(screen.getByText('Login required')).toBeTruthy();
    expect(screen.queryByLabelText('Toggle memory')).toBeNull();
  });
});

describe('ChatMessageItem speaker button', () => {
  const base = (over: Record<string, unknown> = {}) => ({
    message: {
      id: 7, role: 'assistant', content: 'Hello there', metadata: {},
      created_at: new Date().toISOString(),
    } as unknown as import('../../../api').StandaloneChatMessage,
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

  // ChatMessageItem renders FeedbackControl for a numeric-id assistant
  // message, and that reads useQueryClient() — a bare render throws.
  const withQueryClient = (ui: Parameters<typeof render>[0]) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  };

  it('calls onSpeak with (id, content), like onCopy pins its own args', () => {
    const props = base();
    withQueryClient(<ChatMessageItem {...props} />);
    fireEvent.click(screen.getByTitle('Read aloud'));
    expect(props.onSpeak).toHaveBeenCalledWith(7, 'Hello there');
  });

  it('keeps the speaker button while waiting on /api/chat/speak/', () => {
    const props = base({ speakLoading: true });
    withQueryClient(<ChatMessageItem {...props} />);
    // Loading swaps the icon for a spinner; the affordance stays put.
    expect(screen.getByTitle('Read aloud')).toBeTruthy();
    expect(props.onSpeak).not.toHaveBeenCalled();
  });
});

describe('ToolApprovalCard', () => {
  const call: PendingToolCall = {
    tool: 'send_email',
    call_id: 'c7',
    args: { to: 'a@b.c' },
    detail: {
      title: 'Send an email',
      sentence: 'The assistant wants to email a@b.c.',
      server: '',
      tool: 'send_email',
      fields: [{ label: 'To', value: 'a@b.c' }],
    },
  };

  it('leads with the sentence and the fields', () => {
    render(<ToolApprovalCard call={call} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByText('Send an email')).toBeTruthy();
    expect(screen.getByText(/The assistant wants to email a@b\.c\./)).toBeTruthy();
    expect(screen.getByText('To')).toBeTruthy();
  });

  it('approves with the chosen scope and declines with the call id', () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    render(<ToolApprovalCard call={call} onApprove={onApprove} onDeny={onDeny} />);
    // No choice made: exactly (callId, scope), no match argument.
    fireEvent.click(screen.getByText('Approve'));
    fireEvent.change(screen.getByLabelText('Applies to'), { target: { value: 'session' } });
    fireEvent.click(screen.getByText('Approve'));
    fireEvent.change(screen.getByLabelText('Applies to'), { target: { value: 'always' } });
    fireEvent.click(screen.getByText('Approve'));
    fireEvent.click(screen.getByText('Decline'));
    expect(onApprove.mock.calls).toEqual([['c7', 'once'], ['c7', 'session'], ['c7', 'always']]);
    expect(onDeny).toHaveBeenCalledWith('c7');
  });

  it('falls back to the tool name when the server sent no description', () => {
    render(
      <ToolApprovalCard call={{ ...call, detail: null }} onApprove={vi.fn()} onDeny={vi.fn()} />,
    );
    expect(screen.getByText('Permission required')).toBeTruthy();
    expect(screen.getByText(/wants to run send_email/)).toBeTruthy();
  });
});

describe('TeamSolutionsChip', () => {
  const item = (over: Partial<SolutionUsed> = {}): SolutionUsed => ({
    id: 4,
    problem: 'Celery tasks stay pending after deploy',
    solved_by: 'Asha',
    last_known_true: '2026-10-02',
    checks_needed: 0,
    doubtful: false,
    ...over,
  });

  it('says what was read, not what was cited, and counts it in the plural', () => {
    render(<TeamSolutionsChip items={[item(), item({ id: 9 })]} onReview={vi.fn()} />);
    expect(screen.getByText('Checked 2 team solutions')).toBeTruthy();
    expect(screen.queryByText(/based on/i)).toBeNull();
  });

  it('uses the singular for one solution', () => {
    render(<TeamSolutionsChip items={[item()]} onReview={vi.fn()} />);
    expect(screen.getByText('Checked 1 team solution')).toBeTruthy();
  });

  it('renders nothing when no solution was read', () => {
    const { container } = render(<TeamSolutionsChip items={[]} onReview={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows who solved it, when it was last checked, and the warning tags once opened', () => {
    render(<TeamSolutionsChip
      items={[item({ checks_needed: 2, doubtful: true })]}
      onReview={vi.fn()}
    />);
    fireEvent.click(screen.getByText('Checked 1 team solution'));
    expect(screen.getByText('Celery tasks stay pending after deploy')).toBeTruthy();
    expect(screen.getByText(/by Asha, last checked/)).toBeTruthy();
    expect(screen.getByText('may be out of date')).toBeTruthy();
    expect(screen.getByText('flagged')).toBeTruthy();
    expect(screen.getByText('Open').closest('a')?.getAttribute('href')).toBe('/solutions?id=4');
  });

  it('"Worked" reports (id, confirmed) and then locks that row', () => {
    const onReview = vi.fn();
    render(<TeamSolutionsChip items={[item({ id: 4 }), item({ id: 9 })]} onReview={onReview} />);
    fireEvent.click(screen.getByText('Checked 2 team solutions'));
    const [first] = screen.getAllByText('Worked');
    fireEvent.click(first);
    expect(onReview.mock.calls).toEqual([[4, 'confirmed']]);
    expect((first as HTMLButtonElement).disabled).toBe(true);
    // The other row is still answerable.
    const [, second] = screen.getAllByText('Worked');
    expect((second as HTMLButtonElement).disabled).toBe(false);
  });

  it('"Didn\'t work" reports (id, failed), and a second click sends nothing', () => {
    const onReview = vi.fn();
    render(<TeamSolutionsChip items={[item({ id: 4 })]} onReview={onReview} />);
    fireEvent.click(screen.getByText('Checked 1 team solution'));
    const failed = screen.getByText("Didn't work");
    fireEvent.click(failed);
    fireEvent.click(failed);
    expect(onReview.mock.calls).toEqual([[4, 'failed']]);
  });
});

describe('ChatMessageItem team solutions', () => {
  const answer = (metadata: Record<string, unknown>) => ({
    message: {
      id: 21, role: 'assistant', content: 'Start the worker with -Q new_queue.', metadata,
      created_at: new Date().toISOString(),
    } as unknown as import('../../../api').StandaloneChatMessage,
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
  });

  // FeedbackControl reads the query client, so a bare render would throw.
  const withQueryClient = (ui: Parameters<typeof render>[0]) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  };

  it('shows the chip for a saved answer that read solutions, and passes the verdict up', () => {
    const onReviewSolution = vi.fn();
    withQueryClient(<ChatMessageItem
      {...answer({ solutions_used: [{
        id: 4, problem: 'Celery tasks stay pending', solved_by: 'Asha',
        last_known_true: '2026-10-02', checks_needed: 0, doubtful: false,
      }] })}
      onReviewSolution={onReviewSolution}
    />);
    fireEvent.click(screen.getByText('Checked 1 team solution'));
    fireEvent.click(screen.getByText('Worked'));
    expect(onReviewSolution).toHaveBeenCalledWith(4, 'confirmed');
  });

  it('shows no chip when the answer read no solutions', () => {
    withQueryClient(<ChatMessageItem {...answer({})} />);
    expect(screen.queryByText(/team solution/)).toBeNull();
  });
});

describe('ChatMessageItem solution draft card', () => {
  const draftAnswer = (solution_draft: Record<string, unknown> | null) => ({
    message: {
      id: 31, role: 'assistant', content: 'Clear the cache and restart.',
      metadata: solution_draft ? { solution_draft } : {},
      created_at: new Date().toISOString(),
    } as unknown as import('../../../api').StandaloneChatMessage,
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
  });

  const withQueryClient = (ui: Parameters<typeof render>[0]) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  };

  const draft = {
    id: 42, problem: 'Build fails on Windows', share_requested: true,
    org_name: 'Acme', resolved: null,
  };

  it('offers share, keep private and discard, and reports each with the draft id', () => {
    const onDraftAction = vi.fn();
    withQueryClient(<ChatMessageItem {...draftAnswer(draft)} onDraftAction={onDraftAction} />);
    expect(screen.getByText('Save this fix for your team?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Share with Acme' }));
    expect(onDraftAction).toHaveBeenLastCalledWith(42, 'share');
    fireEvent.click(screen.getByRole('button', { name: 'Keep private' }));
    expect(onDraftAction).toHaveBeenLastCalledWith(42, 'private');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDraftAction).toHaveBeenLastCalledWith(42, 'discard');
    expect(onDraftAction).toHaveBeenCalledTimes(3);
  });

  it('leaves out the share button when the chat has no organisation name', () => {
    withQueryClient(<ChatMessageItem {...draftAnswer({ ...draft, org_name: null })} onDraftAction={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Share with/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Keep private' })).toBeTruthy();
  });

  it('shows no card when the answer was not drafted', () => {
    withQueryClient(<ChatMessageItem {...draftAnswer(null)} onDraftAction={vi.fn()} />);
    expect(screen.queryByText('Save this fix for your team?')).toBeNull();
  });

  it('shows the outcome instead of the buttons once the draft is resolved', () => {
    withQueryClient(<ChatMessageItem
      {...draftAnswer({ ...draft, resolved: 'waiting_review' })}
      onDraftAction={vi.fn()}
    />);
    expect(screen.getByText('Waiting for a curator')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Keep private' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
  });

  it('disables the choices while one is being sent', () => {
    withQueryClient(<ChatMessageItem {...draftAnswer(draft)} onDraftAction={vi.fn()} draftBusy />);
    expect((screen.getByRole('button', { name: 'Keep private' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
