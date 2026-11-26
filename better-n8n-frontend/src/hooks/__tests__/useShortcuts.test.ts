// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

import { useShortcuts } from '../useShortcuts';
import { OPEN_SHORTCUTS_HELP_EVENT, writeSingleKeyEnabled } from '../../lib/shortcuts';

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
}

describe('useShortcuts', () => {
  let navigate: ReturnType<typeof vi.fn>;
  let helpOpened: number;
  const countHelp = () => {
    helpOpened += 1;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    navigate = vi.fn();
    helpOpened = 0;
    window.addEventListener(OPEN_SHORTCUTS_HELP_EVENT, countHelp);
  });

  afterEach(() => {
    cleanup();
    window.removeEventListener(OPEN_SHORTCUTS_HELP_EVENT, countHelp);
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('g then c goes to Ask', () => {
    renderHook(() => useShortcuts(navigate, true));
    press('g');
    press('c');
    expect(navigate).toHaveBeenCalledWith('/ai-chat');
  });

  it('g then c two seconds later does nothing', () => {
    renderHook(() => useShortcuts(navigate, true));
    press('g');
    vi.advanceTimersByTime(2000);
    press('c');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('typing g then c in an input does nothing', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    renderHook(() => useShortcuts(navigate, true));
    press('g', {}, input);
    press('c', {}, input);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('typing ? in a textarea does not open help', () => {
    const area = document.createElement('textarea');
    document.body.appendChild(area);
    renderHook(() => useShortcuts(navigate, true));
    press('?', { shiftKey: true }, area);
    expect(helpOpened).toBe(0);
  });

  it('Ctrl+Shift+O starts a new chat', () => {
    renderHook(() => useShortcuts(navigate, true));
    press('O', { ctrlKey: true, shiftKey: true });
    expect(navigate).toHaveBeenCalledWith('/ai-chat', { state: { newChat: true } });
  });

  it('with single keys switched off, ? is skipped but Ctrl+/ still opens help', () => {
    writeSingleKeyEnabled(false);
    renderHook(() => useShortcuts(navigate, true));
    press('?', { shiftKey: true });
    expect(helpOpened).toBe(0);
    press('/', { ctrlKey: true });
    expect(helpOpened).toBe(1);
  });

  it('with single keys switched off, g then c does nothing', () => {
    writeSingleKeyEnabled(false);
    renderHook(() => useShortcuts(navigate, true));
    press('g');
    press('c');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('ignores an event that an earlier listener already handled', () => {
    const early = (e: KeyboardEvent) => e.preventDefault();
    document.body.addEventListener('keydown', early);
    renderHook(() => useShortcuts(navigate, true));
    press('O', { ctrlKey: true, shiftKey: true });
    expect(navigate).not.toHaveBeenCalled();
    document.body.removeEventListener('keydown', early);
  });

  it('does nothing when disabled (signed out)', () => {
    renderHook(() => useShortcuts(navigate, false));
    press('g');
    press('c');
    press('O', { ctrlKey: true, shiftKey: true });
    expect(navigate).not.toHaveBeenCalled();
    expect(helpOpened).toBe(0);
  });

  it('/ focuses the page search, and types normally when there is none', () => {
    const main = document.createElement('main');
    const search = document.createElement('input');
    search.type = 'search';
    main.appendChild(search);
    document.body.appendChild(main);
    renderHook(() => useShortcuts(navigate, true));
    const ev = press('/');
    expect(document.activeElement).toBe(search);
    expect(ev.defaultPrevented).toBe(true);

    main.remove();
    const plain = press('/');
    expect(plain.defaultPrevented).toBe(false);
  });

  it('ignores keys inside a CodeMirror editor', () => {
    const cm = document.createElement('div');
    cm.className = 'cm-editor';
    const inner = document.createElement('div');
    inner.tabIndex = 0;
    cm.appendChild(inner);
    document.body.appendChild(cm);
    renderHook(() => useShortcuts(navigate, true));
    press('/', {}, inner);
    press('/', { ctrlKey: true }, inner);
    expect(helpOpened).toBe(0);
  });
});
