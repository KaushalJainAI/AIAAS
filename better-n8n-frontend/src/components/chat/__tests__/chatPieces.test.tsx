// @vitest-environment jsdom
/**
 * The pieces split out of `StandaloneChat.tsx`: each draws what it is given
 * and reports clicks through its callbacks, with the same arguments the chat
 * page used to pass inline.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { ChatSession } from '../../../api';
import type { ChatSessionSummary } from '../../../api/chat';
import type { PendingToolCall } from '../../../hooks/useChatStream';
import ChatHistorySidebar from '../ChatHistorySidebar';
import ChatHeader from '../ChatHeader';
import ChatSettingsDialog from '../ChatSettingsDialog';
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
      />,
    );
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith({ system_prompt: 'Answer in French.' });
    fireEvent.click(screen.getByLabelText('Toggle memory'));
    expect(onSave).toHaveBeenCalledWith({ memory_enabled: false });
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
      />,
    );
    expect(screen.getByText('Login required')).toBeTruthy();
    expect(screen.queryByLabelText('Toggle memory')).toBeNull();
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

  it('each button answers with the right scope', () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    render(<ToolApprovalCard call={call} onApprove={onApprove} onDeny={onDeny} />);
    fireEvent.click(screen.getByText('Approve'));
    fireEvent.click(screen.getByText('Allow for this chat'));
    fireEvent.click(screen.getByText('Always allow'));
    fireEvent.click(screen.getByText('Deny'));
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
