import { describe, expect, it } from 'vitest';

import type { BrowserView } from '@/api/browser';
import {
  MAX_BROWSER_STEPS,
  MAX_BROWSER_VIEWS,
  awaitingUser,
  browserLabel,
  doneMessage,
  hostOf,
  hostsOf,
  liveViewOf,
  parseBrowserViews,
} from '@/lib/browserView';

const view = (over: Partial<BrowserView> = {}): BrowserView => ({
  frame_id: '',
  url: 'https://example.com/page',
  title: 'Page',
  session: '',
  live_url: '',
  steps: [],
  needs_user: null,
  ...over,
});

describe('parseBrowserViews', () => {
  it('reads a well-formed list and keeps its order (newest last)', () => {
    const out = parseBrowserViews([view({ url: 'https://a.test/' }), view({ url: 'https://b.test/' })]);
    expect(out.map((v) => v.url)).toEqual(['https://a.test/', 'https://b.test/']);
  });

  it('drops anything that is not a call, and treats a missing list as empty', () => {
    expect(parseBrowserViews(undefined)).toEqual([]);
    expect(parseBrowserViews('nope')).toEqual([]);
    expect(parseBrowserViews([null, 3, 'x', view()])).toHaveLength(1);
  });

  it('keeps the newest calls when the list is longer than the cap', () => {
    const many = Array.from({ length: MAX_BROWSER_VIEWS + 3 }, (_, i) => view({ url: `https://s${i}.test/` }));
    const out = parseBrowserViews(many);
    expect(out).toHaveLength(MAX_BROWSER_VIEWS);
    expect(out.at(-1)?.url).toBe(`https://s${MAX_BROWSER_VIEWS + 2}.test/`);
  });

  it('caps the steps of a call and reads needs_user only when it is text', () => {
    const steps = Array.from({ length: MAX_BROWSER_STEPS + 4 }, () => ({ action: 'click', selector: '#a', ok: true }));
    const [out] = parseBrowserViews([view({ steps, needs_user: '  ' })]);
    expect(out.steps).toHaveLength(MAX_BROWSER_STEPS);
    expect(out.needs_user).toBeNull();
    const [asked] = parseBrowserViews([view({ needs_user: 'Enter the code' })]);
    expect(asked.needs_user).toBe('Enter the code');
  });
});

describe('labels and hosts', () => {
  it('names the host of a page, and falls back to the text when there is none', () => {
    expect(hostOf('https://shop.example.com/cart?x=1')).toBe('shop.example.com');
    expect(hostOf('not a url')).toBe('not a url');
  });

  it('labels the chip with the first host, plus how many more sites there were', () => {
    expect(browserLabel([])).toBe('Browser');
    expect(browserLabel([view({ url: 'https://a.test/' })])).toBe('Browser · a.test');
    const two = [view({ url: 'https://a.test/' }), view({ url: 'https://b.test/' }), view({ url: 'https://a.test/x' })];
    expect(hostsOf(two)).toEqual(['a.test', 'b.test']);
    expect(browserLabel(two)).toBe('Browser · a.test +1');
  });
});

describe('the hand-off', () => {
  it('finds the newest call that is waiting for the person', () => {
    const views = [
      view({ url: 'https://a.test/', needs_user: 'a code' }),
      view({ url: 'https://b.test/' }),
      view({ url: 'https://c.test/', needs_user: 'a login' }),
    ];
    expect(awaitingUser(views)?.url).toBe('https://c.test/');
    expect(awaitingUser([view()])).toBeNull();
  });

  it('opens the newest live view that is safe, and never a javascript: link', () => {
    expect(liveViewOf([view({ live_url: 'https://live.test/s/1' }), view()])).toBe('https://live.test/s/1');
    expect(liveViewOf([view({ live_url: 'javascript:alert(1)' })])).toBeNull();
    expect(liveViewOf([view()])).toBeNull();
  });

  it('writes the "I\'m done" message with the host', () => {
    expect(doneMessage('shop.example.com')).toBe('Done on shop.example.com. Continue.');
  });
});
