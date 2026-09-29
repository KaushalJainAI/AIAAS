import { describe, expect, it } from 'vitest';

import { appendTranscript, extensionFor, formatElapsed, pickRecorderMime } from '../voice';

describe('pickRecorderMime', () => {
  it('prefers WebM/Opus where the browser has it', () => {
    expect(pickRecorderMime(() => true)).toBe('audio/webm;codecs=opus');
  });

  it('falls back to MP4 on Safari', () => {
    expect(pickRecorderMime(type => type === 'audio/mp4')).toBe('audio/mp4');
  });

  it('lets the browser choose when nothing matches, even if the check throws', () => {
    expect(pickRecorderMime(() => { throw new Error('unknown'); })).toBe('');
  });
});

describe('extensionFor', () => {
  // The backend reads the format from this extension (voice/stt.py::_FORMATS).
  it.each([
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/mp4', 'm4a'],
    ['audio/ogg;codecs=opus', 'ogg'],
    ['', 'webm'],
  ])('%s -> %s', (mime, ext) => {
    expect(extensionFor(mime)).toBe(ext);
  });
});

describe('appendTranscript', () => {
  it('fills an empty box', () => {
    expect(appendTranscript('', '  check my inbox ')).toBe('check my inbox');
  });

  it('adds after typed text with one space', () => {
    expect(appendTranscript('Summarise', 'last week')).toBe('Summarise last week');
    expect(appendTranscript('Summarise ', 'last week')).toBe('Summarise last week');
  });

  it('leaves the box alone when nothing was heard', () => {
    expect(appendTranscript('draft', '   ')).toBe('draft');
  });
});

describe('formatElapsed', () => {
  it('reads as m:ss', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(65_400)).toBe('1:05');
  });
});
