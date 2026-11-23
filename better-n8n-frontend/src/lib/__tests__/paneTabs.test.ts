import { describe, expect, it } from 'vitest';

import type { BrowserView } from '@/api/browser';
import {
  EMPTY_PANE,
  MAX_CLOSED,
  MAX_TABS,
  SWIPE_CLOSE_PX,
  isSwipeDownToClose,
  neighbourTabId,
  paneReducer,
  tabAfterClose,
  tabIdFor,
  type PaneAction,
  type PaneState,
  type PaneTab,
  type PaneTabSpec,
} from '@/lib/paneTabs';

const file = (documentId: number): PaneTabSpec => ({
  kind: 'file',
  title: `doc${documentId}.pdf`,
  target: { documentId },
});

const run = (state: PaneState, ...actions: PaneAction[]): PaneState =>
  actions.reduce(paneReducer, state);

const openAll = (...ids: number[]): PaneState =>
  run(EMPTY_PANE, ...ids.map((id): PaneAction => ({ type: 'open', tab: file(id) })));

const ids = (state: PaneState) => state.tabs.map((t) => t.id);

describe('paneTabs', () => {
  it('gives a file tab the id file:<documentId>, or file:path:<path> when it has no id', () => {
    expect(tabIdFor(file(7))).toBe('file:7');
    expect(tabIdFor({ kind: 'file', title: 'a.md', target: { path: '/notes/a.md' } })).toBe(
      'file:path:/notes/a.md',
    );
    expect(tabIdFor({ kind: 'browser', title: 'Page', runKey: 'm7', views: [], running: false })).toBe(
      'browser:m7',
    );
    expect(tabIdFor({ kind: 'link', title: 'example.com', url: 'https://example.com/a' })).toBe(
      'link:https://example.com/a',
    );
  });

  it('focuses the existing tab when the same thing is opened twice', () => {
    const state = openAll(1, 2, 1);
    expect(ids(state)).toEqual(['file:1', 'file:2']);
    expect(state.activeId).toBe('file:1');
    expect(state.open).toBe(true);
  });

  it('closes the oldest non-active tab when a ninth tab is opened', () => {
    // Eight tabs, the leftmost (1) active: the oldest tab that is not active is 2.
    const state = run(openAll(1, 2, 3, 4, 5, 6, 7, 8), { type: 'activate', id: 'file:1' });
    expect(state.tabs).toHaveLength(MAX_TABS);
    const next = paneReducer(state, { type: 'open', tab: file(9) });
    expect(next.tabs).toHaveLength(MAX_TABS);
    expect(ids(next)).not.toContain('file:2');
    expect(ids(next).at(-1)).toBe('file:9');
    expect(next.closed[0].id).toBe('file:2');
    expect(next.activeId).toBe('file:9');
  });

  it('keeps at most MAX_CLOSED closed tabs, newest first, with no duplicate ids', () => {
    const state = run(
      openAll(1, 2, 3, 4, 5, 6, 7),
      { type: 'close', id: 'file:1' },
      { type: 'close', id: 'file:2' },
      { type: 'close', id: 'file:3' },
      { type: 'close', id: 'file:4' },
      { type: 'close', id: 'file:5' },
      { type: 'close', id: 'file:6' },
    );
    expect(state.closed).toHaveLength(MAX_CLOSED);
    expect(state.closed.map((t) => t.id)).toEqual([
      'file:6',
      'file:5',
      'file:4',
      'file:3',
      'file:2',
    ]);
    const twice = run(state, { type: 'open', tab: file(6) }, { type: 'close', id: 'file:6' });
    expect(twice.closed.filter((t) => t.id === 'file:6')).toHaveLength(1);
    expect(twice.closed[0].id).toBe('file:6');
  });

  it('activates the right neighbour when the active tab closes, else the left one', () => {
    const state = openAll(1, 2, 3);
    const middle = run(state, { type: 'activate', id: 'file:2' }, { type: 'close', id: 'file:2' });
    expect(middle.activeId).toBe('file:3');

    const last = run(state, { type: 'close', id: 'file:3' });
    expect(last.activeId).toBe('file:2');
  });

  it('hides the pane, and keeps the tabs, when the last tab closes', () => {
    const state = run(openAll(1), { type: 'close', id: 'file:1' });
    expect(state.tabs).toEqual([]);
    expect(state.activeId).toBeNull();
    expect(state.open).toBe(false);
    expect(state.closed.map((t) => t.id)).toEqual(['file:1']);
  });

  it('bumps the nonce of a file tab on every open, so the file is read again', () => {
    const first = openAll(1);
    const nonce = (s: PaneState) => {
      const tab = s.tabs[0];
      return tab.kind === 'file' ? tab.nonce : -1;
    };
    expect(nonce(first)).toBe(1);
    const again = run(first, { type: 'open', tab: file(1) });
    expect(nonce(again)).toBe(2);
    expect(again.tabs).toHaveLength(1);
  });

  it('hides the pane without losing tabs, and show brings them back', () => {
    const hidden = run(openAll(1, 2), { type: 'hide' });
    expect(hidden.open).toBe(false);
    expect(ids(hidden)).toEqual(['file:1', 'file:2']);
    expect(run(hidden, { type: 'show' }).open).toBe(true);
  });

  it('closes the other tabs and closes the tabs to the right', () => {
    const state = openAll(1, 2, 3, 4);
    const others = run(state, { type: 'closeOthers', id: 'file:2' });
    expect(ids(others)).toEqual(['file:2']);
    expect(others.activeId).toBe('file:2');

    const right = run(state, { type: 'closeRight', id: 'file:2' });
    expect(ids(right)).toEqual(['file:1', 'file:2']);
    expect(right.closed.map((t) => t.id)).toEqual(['file:4', 'file:3']);
  });

  it('reopens the newest closed tab, and does nothing when none is closed', () => {
    const state = run(openAll(1, 2), { type: 'close', id: 'file:2' }, { type: 'reopen' });
    expect(ids(state)).toEqual(['file:1', 'file:2']);
    expect(state.closed).toEqual([]);
    expect(state.activeId).toBe('file:2');
    expect(run(state, { type: 'reopen' })).toBe(state);
  });

  it('retitles a tab, and changes nothing when the title is the same', () => {
    const state = openAll(1);
    const renamed = run(state, { type: 'retitle', id: 'file:1', title: 'Report.pdf' });
    expect(renamed.tabs[0].title).toBe('Report.pdf');
    expect(run(renamed, { type: 'retitle', id: 'file:1', title: 'Report.pdf' })).toBe(renamed);
  });

  it('restores a stored state with the caps, a valid active tab and open as given', () => {
    const restored = paneReducer(EMPTY_PANE, {
      type: 'restore',
      state: { ...openAll(1, 2), activeId: 'file:99', open: false },
    });
    expect(restored.activeId).toBe('file:2');
    expect(restored.open).toBe(false);
  });

  it('gives a media tab the id media:<src>, so the same picture focuses one tab', () => {
    const picture: PaneTabSpec = { kind: 'media', title: 'a.png', mediaType: 'image', src: '/files/a.png' };
    const video: PaneTabSpec = { kind: 'media', title: 'b.mp4', mediaType: 'video', src: '/files/b.mp4' };
    expect(tabIdFor(picture)).toBe('media:/files/a.png');
    const state = run(EMPTY_PANE, { type: 'open', tab: picture }, { type: 'open', tab: video }, { type: 'open', tab: picture });
    expect(ids(state)).toEqual(['media:/files/a.png', 'media:/files/b.mp4']);
    expect(state.activeId).toBe('media:/files/a.png');
  });

  it('gives an html tab the id html:<artifactKey>, and keeps its frame document', () => {
    const html: PaneTabSpec = { kind: 'html', title: 'Chart', artifactKey: 'm7-0', srcDoc: '<p>hi</p>' };
    expect(tabIdFor(html)).toBe('html:m7-0');
    const state = run(openAll(1), { type: 'open', tab: html }, { type: 'open', tab: html });
    expect(ids(state)).toEqual(['file:1', 'html:m7-0']);
    const tab = state.tabs[1];
    expect(tab.kind === 'html' && tab.srcDoc).toBe('<p>hi</p>');
  });

  it('does not bump a nonce on a non-file tab when it is opened again', () => {
    const html: PaneTabSpec = { kind: 'html', title: 'Chart', artifactKey: 'm7-0', srcDoc: '<p>hi</p>' };
    const state = run(EMPTY_PANE, { type: 'open', tab: html }, { type: 'open', tab: html });
    expect(state.tabs[0]).not.toHaveProperty('nonce');
  });

  it('only a downward drag past the threshold, and more down than across, closes by swipe', () => {
    expect(isSwipeDownToClose(0, SWIPE_CLOSE_PX + 1)).toBe(true);
    expect(isSwipeDownToClose(0, SWIPE_CLOSE_PX)).toBe(false);
    expect(isSwipeDownToClose(0, -200)).toBe(false);
    // A sideways scroll of the strip is not a close, even when it is long.
    expect(isSwipeDownToClose(300, 120)).toBe(false);
  });

  it('moves to the neighbour for the arrow keys, and to nothing at either end', () => {
    const tabs = openAll(1, 2, 3).tabs;
    expect(neighbourTabId(tabs, 'file:2', 1)).toBe('file:3');
    expect(neighbourTabId(tabs, 'file:2', -1)).toBe('file:1');
    expect(neighbourTabId(tabs, 'file:1', -1)).toBeNull();
    expect(neighbourTabId(tabs, 'file:3', 1)).toBeNull();
    expect(neighbourTabId(tabs, 'file:99', 1)).toBeNull();
  });

  it('names the tab that takes focus when one closes: right neighbour, else left', () => {
    const tabs: PaneTab[] = openAll(1, 2, 3).tabs;
    expect(tabAfterClose(tabs, 'file:2')).toBe('file:3');
    expect(tabAfterClose(tabs, 'file:3')).toBe('file:2');
    expect(tabAfterClose(tabs, 'file:99')).toBeNull();
  });
});

const call = (url: string, frame = ''): BrowserView => ({
  frame_id: frame,
  url,
  title: url,
  session: '',
  live_url: '',
  steps: [],
  needs_user: null,
});

const browserSpec = (views: BrowserView[], running = false): PaneTabSpec => ({
  kind: 'browser',
  title: 'Browser · example.com',
  runKey: 'live3',
  views,
  running,
});

describe('browser and link tabs', () => {
  it('opening a run that is already open refreshes its calls, and keeps one tab', () => {
    const first = [call('https://example.com/a')];
    const second = [...first, call('https://example.com/b')];
    const state = run(
      EMPTY_PANE,
      { type: 'open', tab: browserSpec(first, true) },
      { type: 'open', tab: browserSpec(second, false) },
    );
    expect(ids(state)).toEqual(['browser:live3']);
    const tab = state.tabs[0];
    expect(tab.kind === 'browser' && tab.views).toHaveLength(2);
    expect(tab.kind === 'browser' && tab.running).toBe(false);
    expect(state.activeId).toBe('browser:live3');
  });

  it('browserState replaces the calls and the running flag of an open browser tab', () => {
    const state = run(
      EMPTY_PANE,
      { type: 'open', tab: browserSpec([call('https://example.com/a')], true) },
      { type: 'browserState', id: 'browser:live3', running: true, views: [call('https://example.com/a'), call('https://example.com/b')] },
    );
    const tab = state.tabs[0];
    expect(tab.kind === 'browser' && tab.views.map((v) => v.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
    const done = run(state, { type: 'browserState', id: 'browser:live3', running: false });
    const after = done.tabs[0];
    expect(after.kind === 'browser' && after.running).toBe(false);
    // No views in the action keeps the calls it had.
    expect(after.kind === 'browser' && after.views).toHaveLength(2);
  });

  it('browserState does nothing for a tab that is not open, or is not a browser tab', () => {
    const open = run(openAll(1), { type: 'browserState', id: 'browser:live9', running: true, views: [] });
    expect(ids(open)).toEqual(['file:1']);
    const onFile = run(openAll(1), { type: 'browserState', id: 'file:1', running: true });
    expect(onFile.tabs[0]).toEqual(openAll(1).tabs[0]);
  });

  it('browserState returns the same state when nothing changed, so the pane does not redraw', () => {
    const views = [call('https://example.com/a')];
    const state = run(EMPTY_PANE, { type: 'open', tab: browserSpec(views, true) });
    expect(paneReducer(state, { type: 'browserState', id: 'browser:live3', running: true })).toBe(state);
    // The same list again changes nothing; a new list (a new call) does.
    expect(paneReducer(state, { type: 'browserState', id: 'browser:live3', running: true, views })).toBe(state);
    const more = [...views, call('https://example.com/b')];
    expect(paneReducer(state, { type: 'browserState', id: 'browser:live3', running: true, views: more })).not.toBe(
      state,
    );
  });

  it('gives a link tab the id link:<url>, so the same link focuses one tab', () => {
    const link: PaneTabSpec = { kind: 'link', title: 'example.com', url: 'https://example.com/a' };
    const state = run(EMPTY_PANE, { type: 'open', tab: link }, { type: 'open', tab: link });
    expect(ids(state)).toEqual(['link:https://example.com/a']);
    expect(state.open).toBe(true);
  });
});
