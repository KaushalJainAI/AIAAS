// @vitest-environment jsdom
/**
 * The "What the assistant sees" tab: the panel draws the server's context
 * report, and the settings dialog switches to it through its callback.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatContext } from '../../../api/chat';
import { formatRate, formatTokens } from '../../../lib/contextFormat';
import ChatContextPanel from '../ChatContextPanel';
import ChatSettingsDialog from '../ChatSettingsDialog';

afterEach(cleanup);

function context(overrides: Partial<ChatContext> = {}): ChatContext {
  const empty = {
    turns: 0, prompt_tokens: 0, uncached_tokens: 0, cached_read_tokens: 0,
    cached_write_tokens: 0, output_tokens: 0, hit_rate: null,
  };
  return {
    model: 'openrouter/free', provider: 'openrouter', memory_enabled: true,
    context_window: 128_000,
    tokens: { system: 2_000, notes: 800, history: 5_000, tools: 3_000, total: 10_800 },
    system_prompt: { session_prompt: 'Answer briefly.', user_memory: '', full: 'SYSTEM', tokens: 2_000 },
    notes: {
      text: '### CONVERSATION NOTES ###', document_id: 42, current: 'T2', through: 9, tokens: 800,
      tasks: [
        { id: 'T1', title: 'Launch plan', status: 'done', outcome: 'Agreed.', facts: [], files: [], messages: [1, 2] },
        { id: 'T2', title: 'CSV import', status: 'in_progress', outcome: '', facts: [], files: [], messages: [3, 4, 5, 6] },
      ],
    },
    history: {
      mode: 'task', replayed: 2, total_messages: 6, not_shown: 4, tokens: 5_000,
      messages: [
        { id: 5, role: 'user', preview: 'fix the import', tokens: 10, summarised: false },
        { id: 6, role: 'assistant', preview: 'Done.', tokens: 4_990, summarised: true },
      ],
    },
    plan: { todos: [{ text: 'Read the CSV', status: 'done' }, { text: 'Fix the delimiter', status: 'doing' }], revisions: 2, worker_plans: {} },
    tools: { count: 30, tokens: 3_000, estimate: true },
    cache: {
      last_turn: { ...empty, turns: 1, prompt_tokens: 1000, cached_read_tokens: 820, hit_rate: 0.82 },
      conversation: { ...empty, turns: 3, prompt_tokens: 3000, cached_read_tokens: 1500, hit_rate: 0.5 },
      recent: [{ message_id: 2, hit_rate: 0 }, { message_id: 4, hit_rate: 0.6 }, { message_id: 6, hit_rate: 0.82 }],
    },
    not_included: ['The per-turn update.'],
    ...overrides,
  };
}

describe('ChatContextPanel', () => {
  it('formats tokens and rates', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(1_250)).toBe('1.3k');
    expect(formatTokens(128_000)).toBe('128k');
    expect(formatRate(0.823)).toBe('82%');
    expect(formatRate(null)).toBe('—');
  });

  it('shows size, cache, plan, tasks and replayed messages', () => {
    render(<ChatContextPanel data={context()} loading={false} error={null} onRefresh={() => {}} />);
    expect(screen.getByText(/~11k tokens/)).toBeTruthy();
    expect(screen.getByText('82%')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText('1/2 done')).toBeTruthy();
    expect(screen.getByText('Fix the delimiter')).toBeTruthy();
    expect(screen.getByText('CSV import')).toBeTruthy();
    expect(screen.getByText('Open the notes file').closest('a')?.getAttribute('href')).toBe('/documents?doc=42');
    expect(screen.getByText('2 of 6 · 5.0k')).toBeTruthy();
    expect(screen.getByText(/4 earlier messages are not sent/)).toBeTruthy();
  });

  it('asks to refresh, and offers a retry after an error', () => {
    const onRefresh = vi.fn();
    const { rerender } = render(<ChatContextPanel data={context()} loading={false} error={null} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByLabelText('Refresh context'));
    rerender(<ChatContextPanel data={null} loading={false} error="Could not read." onRefresh={onRefresh} />);
    fireEvent.click(screen.getByText('Try again'));
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });
});

describe('ChatSettingsDialog context tab', () => {
  const base = {
    session: { id: 's', memory_enabled: true } as never,
    isGuest: false, promptDraft: '', onPromptDraftChange: () => {}, saving: false,
    onSave: () => {}, onClose: () => {}, readAloud: false, onToggleReadAloud: () => {},
  };

  it('switches tabs through the callback and hides Save on the context tab', () => {
    const onTabChange = vi.fn();
    const { rerender } = render(
      <ChatSettingsDialog {...base} tab="settings" onTabChange={onTabChange} contextView={<div>CTX</div>} />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'What the assistant sees' }));
    expect(onTabChange).toHaveBeenCalledWith('context');

    rerender(<ChatSettingsDialog {...base} tab="context" onTabChange={onTabChange} contextView={<div>CTX</div>} />);
    expect(screen.getByText('CTX')).toBeTruthy();
    expect(screen.queryByText('Save')).toBeNull();
  });

  it('has no tabs without a context view', () => {
    render(<ChatSettingsDialog {...base} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText('Save')).toBeTruthy();
  });
});
