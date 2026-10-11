import { describe, expect, it, vi } from 'vitest';

import type { SseEvent } from '../../api/sse';
import { MAX_FAILED_RECONNECTS, followTurn, reconnectDelay } from '../followTurn';

type OnEvent = (event: SseEvent) => void;

const chunk = (content: string): SseEvent => ({ type: 'content_chunk', content });
const done: SseEvent = { type: 'done' };
const noSleep = () => Promise.resolve();

describe('followTurn', () => {
  it('ends on the done frame without asking the server anything', async () => {
    const seen: SseEvent[] = [];
    const attach = vi.fn();
    const isRunning = vi.fn();

    await followTurn({
      open: async (on) => { on(chunk('a')); on(done); },
      attach,
      isRunning,
      onEvent: (e) => seen.push(e),
      sleep: noSleep,
    });

    expect(seen.map((e) => e.type)).toEqual(['content_chunk', 'done']);
    expect(attach).not.toHaveBeenCalled();
    expect(isRunning).not.toHaveBeenCalled();
  });

  it('re-attaches from the frame it reached when the stream is cut mid-turn', async () => {
    // The bug: a proxy closed a silent stream during a long tool call, and the
    // close was read as the end of the turn while the agent was still working.
    const seen: SseEvent[] = [];
    const attach = vi.fn(async (on: OnEvent, from: number) => {
      expect(from).toBe(2);
      on(chunk('c'));
      on(done);
    });

    await followTurn({
      open: async (on) => { on(chunk('a')); on(chunk('b')); },
      attach,
      isRunning: async () => true,
      onEvent: (e) => seen.push(e),
      sleep: noSleep,
    });

    expect(attach).toHaveBeenCalledTimes(1);
    expect(seen.map((e) => (e.content as string) ?? e.type)).toEqual(['a', 'b', 'c', 'done']);
  });

  it('keeps following through several cuts', async () => {
    const froms: number[] = [];
    let calls = 0;

    await followTurn({
      open: async (on) => { on(chunk('a')); },
      attach: async (on, from) => {
        froms.push(from);
        calls += 1;
        if (calls < 3) on(chunk(`r${calls}`));
        else on(done);
      },
      isRunning: async () => true,
      onEvent: () => {},
      sleep: noSleep,
    });

    expect(froms).toEqual([1, 2, 3]);
  });

  it('reads the tail of a turn that finished while the connection was down', async () => {
    const seen: SseEvent[] = [];

    await followTurn({
      open: async (on) => { on(chunk('a')); throw new TypeError('Failed to fetch'); },
      attach: async (on, from) => { expect(from).toBe(1); on(done); },
      isRunning: async () => false,
      onEvent: (e) => seen.push(e),
      sleep: noSleep,
    });

    expect(seen.map((e) => e.type)).toEqual(['content_chunk', 'done']);
  });

  it('reports the failure when the message never reached the server', async () => {
    const attach = vi.fn(async () => {});

    await expect(followTurn({
      open: async () => { throw new TypeError('Failed to fetch'); },
      attach,
      isRunning: async () => false,
      onEvent: () => {},
      sleep: noSleep,
    })).rejects.toThrow('Failed to fetch');
    expect(attach).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect after a refusal from the server', async () => {
    const refusal = Object.assign(new Error('Not allowed'), { status: 400 });
    const isRunning = vi.fn();

    await expect(followTurn({
      open: async () => { throw refusal; },
      attach: vi.fn(),
      isRunning,
      onEvent: () => {},
      sleep: noSleep,
    })).rejects.toBe(refusal);
    expect(isRunning).not.toHaveBeenCalled();
  });

  it('does not reconnect after the user stops the turn', async () => {
    const controller = new AbortController();
    const attach = vi.fn();

    await expect(followTurn({
      open: async (on) => {
        on(chunk('a'));
        controller.abort();
        throw new DOMException('Aborted', 'AbortError');
      },
      attach,
      isRunning: async () => true,
      onEvent: () => {},
      signal: controller.signal,
      sleep: noSleep,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(attach).not.toHaveBeenCalled();
  });

  it('gives up when the server stays unreachable', async () => {
    const isRunning = vi.fn(async () => { throw new Error('Network Error'); });

    await expect(followTurn({
      open: async (on) => { on(chunk('a')); throw new TypeError('Failed to fetch'); },
      attach: vi.fn(),
      isRunning,
      onEvent: () => {},
      sleep: noSleep,
    })).rejects.toThrow('Failed to fetch');
    expect(isRunning).toHaveBeenCalledTimes(MAX_FAILED_RECONNECTS + 1);
  });

  it('ends quietly when there is no turn to attach to', async () => {
    // `attachStream` on a session whose turn is already in the transcript.
    const attach = vi.fn(async () => {});

    await followTurn({
      open: async () => {},
      attach,
      isRunning: async () => false,
      onEvent: () => {},
      sleep: noSleep,
    });

    expect(attach).toHaveBeenCalledTimes(1);
  });

  it('backs off between reconnects, capped', () => {
    expect([0, 1, 2, 3, 9].map(reconnectDelay)).toEqual([1000, 2000, 4000, 5000, 5000]);
  });
});
