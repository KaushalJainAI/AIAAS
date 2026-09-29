/**
 * Pure helpers for the chat mic (`hooks/useVoiceInput.ts`).
 *
 * The browser records a clip, the backend transcribes it
 * (`POST /api/chat/transcribe/`), and the text lands in the composer for the
 * person to read before sending — never straight into a turn, because a
 * misheard word sent to an agent is acted on.
 */

/** One clip's ceiling. The backend refuses bodies over ~10 MB; two minutes of
 *  Opus is a few hundred KB, so the time limit is the one people meet. */
export const MAX_RECORDING_MS = 120_000;

/** In preference order. Chrome and Firefox record WebM/Opus; Safari only MP4. */
const RECORDER_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

/** The first type this browser can record, or '' to let it choose. */
export function pickRecorderMime(isTypeSupported: (type: string) => boolean): string {
  for (const type of RECORDER_TYPES) {
    try {
      if (isTypeSupported(type)) return type;
    } catch {
      // Some browsers throw on unknown types instead of returning false.
    }
  }
  return '';
}

/** The file extension the backend reads the format from. */
export function extensionFor(mime: string): string {
  const base = mime.split(';')[0].trim().toLowerCase();
  if (base === 'audio/mp4' || base === 'audio/x-m4a' || base === 'audio/aac') return 'm4a';
  if (base === 'audio/ogg') return 'ogg';
  if (base === 'audio/wav' || base === 'audio/x-wav') return 'wav';
  if (base === 'audio/mpeg') return 'mp3';
  return 'webm';
}

/** Put dictated text after what is already typed, with one space between. */
export function appendTranscript(current: string, text: string): string {
  const spoken = text.trim();
  if (!spoken) return current;
  if (!current.trim()) return spoken;
  return /\s$/.test(current) ? current + spoken : `${current} ${spoken}`;
}

/** `m:ss`, for the recording timer. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
