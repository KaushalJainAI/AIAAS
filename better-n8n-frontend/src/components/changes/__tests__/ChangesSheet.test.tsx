// @vitest-environment jsdom
/**
 * The undo sheet draws a change tree and reports the ids the person ticked.
 * It never calls the API itself: these tests pin what it sends and shows.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type {
  ChangeRow,
  ChangeSetDetail,
  ChangeSetNode,
  RevertResult,
} from '@/api/changes';
import { ChangesSheet, type ChangesSheetProps } from '../ChangesSheet';

afterEach(cleanup);

const row = (over: Partial<ChangeRow> & { id: number; label: string }): ChangeRow => ({
  target_type: 'document',
  revertible: true,
  reason: '',
  outcome: '',
  outcome_note: '',
  tool: 'write_file',
  ...over,
});

const node = (over: Partial<ChangeSetNode> = {}): ChangeSetNode => ({
  id: 10,
  owner_kind: 'run',
  status: 'completed',
  incomplete: false,
  created_at: '2026-11-24T10:00:00Z',
  live: false,
  live_reason: null,
  changes: [],
  children: [],
  ...over,
});

const countRows = (n: ChangeSetNode): number =>
  n.changes.length + n.children.reduce((sum, kid) => sum + countRows(kid), 0);

const detailOf = (set: ChangeSetNode, over: Partial<ChangeSetDetail> = {}): ChangeSetDetail => ({
  live: set.live,
  live_reason: set.live_reason,
  total: countRows(set),
  truncated: false,
  set,
  ...over,
});

/** A run that wrote two files, edited one, left an untracked change, and had a worker. */
const sample = (): ChangeSetDetail =>
  detailOf(
    node({
      changes: [
        row({ id: 1, label: 'Report.docx' }),
        row({ id: 2, label: 'Notes.md' }),
        row({ id: 3, label: 'Sent a text', target_type: '', revertible: false, reason: 'Sent outside the app; it cannot be taken back.', tool: 'message_send' }),
      ],
      children: [
        node({
          id: 11,
          owner_kind: 'run',
          changes: [row({ id: 4, label: 'Budget.xlsx' })],
        }),
      ],
    }),
  );

const props = (over: Partial<ChangesSheetProps> = {}): ChangesSheetProps => ({
  detail: sample(),
  loading: false,
  onRetry: vi.fn(),
  reverting: false,
  result: null,
  onRevert: vi.fn(),
  onClose: vi.fn(),
  ...over,
});

describe('ChangesSheet', () => {
  it('groups changes into what can be undone and what cannot, with workers under their own name', () => {
    render(<ChangesSheet {...props()} />);

    expect(screen.getByText('Undo what this run changed')).toBeTruthy();
    expect(
      screen.getByText('Files go back to how they were before. Anything you changed since is left alone.'),
    ).toBeTruthy();
    expect(screen.getByText('Can be undone')).toBeTruthy();
    expect(screen.getByText("Can't be undone from here")).toBeTruthy();
    // The run's own changes sit under its name in both groups.
    expect(screen.getAllByText('This run').length).toBeGreaterThan(0);
    expect(screen.getByText('Worker 1')).toBeTruthy();
    // The reason sits under the row it belongs to.
    expect(screen.getByText('Sent outside the app; it cannot be taken back.')).toBeTruthy();
    expect(screen.getByText('Budget.xlsx')).toBeTruthy();
  });

  it('ticks every undoable row by default and offers to undo them all', () => {
    render(<ChangesSheet {...props()} />);

    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes).toHaveLength(3);
    expect(boxes.every((box) => box.checked)).toBe(true);
    expect(screen.getByRole('button', { name: 'Undo 3 changes' })).toBeTruthy();
  });

  it('leaves an unticked row out of the ids sent', () => {
    const onRevert = vi.fn();
    render(<ChangesSheet {...props({ onRevert })} />);

    fireEvent.click(screen.getByLabelText(/Notes\.md/));
    fireEvent.click(screen.getByRole('button', { name: 'Undo 2 changes' }));

    expect(onRevert).toHaveBeenCalledTimes(1);
    expect(onRevert).toHaveBeenCalledWith([1, 4]);
  });

  it('disables the button and says why while a run is still live', () => {
    const onRevert = vi.fn();
    const live = detailOf(
      node({ live: true, live_reason: "The worker 'Researcher' is still running.", changes: [row({ id: 1, label: 'Draft.md' })] }),
      { live: true, live_reason: "The worker 'Researcher' is still running." },
    );
    render(<ChangesSheet {...props({ detail: live, onRevert })} />);

    expect(screen.getByText(/The worker 'Researcher' is still running\./)).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Undo 1 change' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onRevert).not.toHaveBeenCalled();
  });

  it('shows what each change did after a revert', () => {
    const result: RevertResult = {
      status: 'partial',
      outcomes: [
        { change_id: 1, label: 'Report.docx', outcome: 'reverted', note: '' },
        { change_id: 2, label: 'Notes.md', outcome: 'skipped', note: 'Changed after this run — restore an older version instead' },
        { change_id: 4, label: 'Budget.xlsx', outcome: 'failed', note: 'Could not be put back: an error was logged.' },
      ],
      reverted: 1,
      skipped: 1,
      failed: 1,
      not_revertible: 0,
      already_reverted: 0,
    };
    render(<ChangesSheet {...props({ result })} />);

    expect(screen.getByText('Undone')).toBeTruthy();
    expect(screen.getByText('Skipped: Changed after this run — restore an older version instead')).toBeTruthy();
    expect(screen.getByText('Failed: Could not be put back: an error was logged.')).toBeTruthy();
  });

  it('rows already put back show "Undone" and have no checkbox', () => {
    const detail = detailOf(
      node({
        changes: [
          row({ id: 1, label: 'Report.docx', outcome: 'reverted' }),
          row({ id: 2, label: 'Notes.md' }),
        ],
      }),
    );
    render(<ChangesSheet {...props({ detail })} />);

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(1);
    expect(screen.getByLabelText(/Notes\.md/)).toBeTruthy();
    expect(screen.getByText('Undone')).toBeTruthy();
    expect(screen.queryByLabelText(/Report\.docx/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Undo 1 change' })).toBeTruthy();
  });

  it('says a list may be missing rows when the tree is incomplete', () => {
    const detail = detailOf(node({ incomplete: true, changes: [row({ id: 1, label: 'Report.docx' })] }));
    render(<ChangesSheet {...props({ detail })} />);
    expect(screen.getByText('Some changes may be missing from this list.')).toBeTruthy();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<ChangesSheet {...props({ onClose })} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
