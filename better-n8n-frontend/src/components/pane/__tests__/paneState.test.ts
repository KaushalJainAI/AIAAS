// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { EMPTY_PANE, paneReducer, type PaneState, type PaneTab } from '@/lib/paneTabs';
import { readPersisted, writePersisted } from '../paneState';

afterEach(() => sessionStorage.clear());

const file: PaneTab = { id: 'file:1', kind: 'file', title: 'a.pdf', target: { documentId: 1 }, nonce: 1 };
const html: PaneTab = { id: 'html:m1-0', kind: 'html', title: 'Chart', artifactKey: 'm1-0', srcDoc: '<p>big</p>' };

describe('pane sessionStorage copy', () => {
  it('saves file tabs only: an html tab carries a whole document and is not kept', () => {
    const state: PaneState = { tabs: [file, html], activeId: 'html:m1-0', open: true, closed: [] };
    writePersisted('pane:c1', state);

    const saved = JSON.parse(sessionStorage.getItem('pane:c1') ?? '{}');
    expect(saved.tabs.map((t: PaneTab) => t.id)).toEqual(['file:1']);
    // The active tab was not saved, so none is marked active.
    expect(saved.activeId).toBeNull();
    expect(sessionStorage.getItem('pane:c1')).not.toContain('big');
  });

  it('restores the saved file tabs with the pane hidden', () => {
    writePersisted('pane:c2', { tabs: [file], activeId: 'file:1', open: true, closed: [] });
    const restored = readPersisted('pane:c2');
    expect(restored.open).toBe(false);
    expect(restored.tabs.map((t) => t.id)).toEqual(['file:1']);
    expect(restored.activeId).toBe('file:1');
  });

  it('starts empty when there is no key, or the saved text is not JSON', () => {
    expect(readPersisted(undefined)).toBe(EMPTY_PANE);
    sessionStorage.setItem('pane:c3', '{not json');
    expect(readPersisted('pane:c3')).toEqual(EMPTY_PANE);
  });

  it('the reducer result of an open html tab is still a valid state to save', () => {
    const opened = paneReducer(EMPTY_PANE, { type: 'open', tab: { kind: 'html', title: 'Chart', artifactKey: 'm1-0', srcDoc: '<p/>' } });
    writePersisted('pane:c4', opened);
    expect(JSON.parse(sessionStorage.getItem('pane:c4') ?? '{}').tabs).toEqual([]);
  });

  it('never saves the agent browser or a link: their calls are not kept across a reload', () => {
    const view = {
      frame_id: 'abc', url: 'https://example.com/', title: 'Example', session: '',
      live_url: '', steps: [], needs_user: null,
    };
    const opened = paneReducer(
      paneReducer(EMPTY_PANE, { type: 'open', tab: { kind: 'browser', title: 'Browser', runKey: 'm9', views: [view], running: false } }),
      { type: 'open', tab: { kind: 'link', title: 'example.com', url: 'https://example.com/' } },
    );
    writePersisted('pane:c5', opened);
    const raw = sessionStorage.getItem('pane:c5') ?? '';
    expect(raw).not.toContain('example.com');
    expect(raw).not.toContain('abc');
    expect(JSON.parse(raw).tabs).toEqual([]);
  });
});
