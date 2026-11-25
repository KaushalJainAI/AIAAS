import { describe, expect, it } from 'vitest';

import type { ToolTraceEntry } from '@/api/chat';
import { summariseTrace } from '../turnReceipt';

const call = (tool: string, args?: Record<string, unknown>): ToolTraceEntry => ({ tool, args });

describe('summariseTrace', () => {
  it('returns an empty line for an empty trace', () => {
    expect(summariseTrace([])).toBe('');
  });

  it('ignores entries with no tool name', () => {
    expect(summariseTrace([{ summary: 'thinking' }, { tool: '' }])).toBe('');
  });

  it('gives one phrase per kind, singular and plural', () => {
    expect(summariseTrace([call('read_file')])).toBe('read a file');
    expect(summariseTrace([call('read_file'), call('read_document'), call('read_url')]))
      .toBe('read 2 files · read a web page');
    expect(summariseTrace([call('web_search')])).toBe('searched the web');
    expect(summariseTrace([call('web_search'), call('web_search')])).toBe('searched the web 2 times');
    expect(summariseTrace([call('execute_python')])).toBe('ran code');
    expect(summariseTrace([call('knowledge_base_search'), call('knowledge_base_search')]))
      .toBe('searched your knowledge bases 2 times');
    expect(summariseTrace([call('run_agent')])).toBe('handed work to an agent');
    expect(summariseTrace([call('message_send'), call('message_send')])).toBe('asked to send 2 messages');
  });

  it('says "asked to send" for a message, since a held one has not gone out yet', () => {
    expect(summariseTrace([call('message_send')])).toBe('asked to send a message');
    expect(summariseTrace([call('message_send')])).not.toMatch(/sent/);
  });

  it('says "queued" for a send the send window is holding, not "asked to send"', () => {
    const held = (tool: string): ToolTraceEntry => ({ tool, args: {}, queued: true });
    expect(summariseTrace([held('message_send')])).toBe('queued a message');
    expect(summariseTrace([held('message_send'), held('message_send')])).toBe('queued 2 messages');
    expect(summariseTrace([held('gmail_send_message')])).toBe('queued an email');
    expect(summariseTrace([held('gmail_send_message'), held('gmail_send_message')]))
      .toBe('queued 2 emails');
  });

  it('keeps a message that was not held as "asked to send", even beside a held one', () => {
    expect(summariseTrace([
      { tool: 'message_send', args: {}, queued: true },
      call('message_send'),
    ])).toBe('queued a message · asked to send a message');
  });

  it('does not treat a flag on a tool that is not a send as a queued send', () => {
    expect(summariseTrace([{ tool: 'read_file', args: {}, queued: true }])).toBe('read a file');
  });

  it('keeps an email neutral too: it is counted as another tool, never as sent', () => {
    expect(summariseTrace([call('gmail_send_message', { to: 'a@example.com' })]))
      .toBe('used 1 other tool');
  });

  it('names the file when a turn wrote exactly one', () => {
    expect(summariseTrace([call('write_file', { path: 'reports/report.docx' })]))
      .toBe('wrote report.docx');
    expect(summariseTrace([call('edit_document', { path: 'C:\\Users\\me\\deck.pptx' })]))
      .toBe('wrote deck.pptx');
  });

  it('counts writes without a name when there are several', () => {
    expect(summariseTrace([
      call('write_file', { path: 'a.md' }),
      call('write_file', { path: 'b.md' }),
    ])).toBe('wrote 2 files');
    expect(summariseTrace([call('write_file')])).toBe('wrote a file');
  });

  it('counts unknown tools as other tools, last in the line', () => {
    expect(summariseTrace([call('mystery_tool'), call('read_file')]))
      .toBe('read a file · used 1 other tool');
    expect(summariseTrace([call('mystery_tool'), call('other_mystery'), call('web_search')]))
      .toBe('searched the web · used 2 other tools');
  });

  it('joins the example from the plan in the order the turn used the kinds', () => {
    expect(summariseTrace([
      call('read_file', { path: 'a.txt' }),
      call('read_file', { path: 'b.txt' }),
      call('read_file', { path: 'c.txt' }),
      call('web_search'),
      call('write_file', { path: 'report.docx' }),
    ])).toBe('read 3 files · searched the web · wrote report.docx');
  });
});
