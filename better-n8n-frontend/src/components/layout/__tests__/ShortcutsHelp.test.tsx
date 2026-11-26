// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ShortcutsHelpHost } from '../ShortcutsHelp';
import { OPEN_SHORTCUTS_HELP_EVENT, SHORTCUTS } from '../../../lib/shortcuts';

const SWITCH_NAME = 'Single-key shortcuts (?, /, G then …)';

function openHelp() {
  act(() => {
    window.dispatchEvent(new Event(OPEN_SHORTCUTS_HELP_EVENT));
  });
}

describe('ShortcutsHelpHost', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('is closed until the help event fires', () => {
    render(<ShortcutsHelpHost />);
    expect(screen.queryByRole('dialog')).toBeNull();
    openHelp();
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });

  it('lists every shortcut label', () => {
    render(<ShortcutsHelpHost />);
    openHelp();
    for (const s of SHORTCUTS) {
      expect(screen.getByText(s.label), s.id).toBeTruthy();
    }
  });

  it('shows a go-to sequence as G then C', () => {
    render(<ShortcutsHelpHost />);
    openHelp();
    expect(screen.getByText('G then C')).toBeTruthy();
  });

  it('the switch writes the single-key setting', () => {
    render(<ShortcutsHelpHost />);
    openHelp();
    const toggle = screen.getByRole('switch', { name: SWITCH_NAME });
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(toggle);
    expect(localStorage.getItem('aiaas_ui:shortcuts.singleKey')).toBe('false');
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(toggle);
    expect(localStorage.getItem('aiaas_ui:shortcuts.singleKey')).toBe('true');
  });

  it('starts with the switch off when single keys are already off', () => {
    localStorage.setItem('aiaas_ui:shortcuts.singleKey', 'false');
    render(<ShortcutsHelpHost />);
    openHelp();
    expect(screen.getByRole('switch', { name: SWITCH_NAME }).getAttribute('aria-checked')).toBe('false');
  });
});
