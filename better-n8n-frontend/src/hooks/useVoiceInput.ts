import { useCallback, useEffect, useRef, useState } from 'react';

import { chatService } from '../api/chat';
import { apiErrorMessage } from '../lib/apiError';
import { MAX_RECORDING_MS, extensionFor, pickRecorderMime } from '../lib/voice';

export type VoiceState = 'idle' | 'recording' | 'transcribing';

interface Options {
  /** The transcript, handed to the caller to put in the composer. */
  onText: (text: string) => void;
  onError: (message: string) => void;
}

/** True when this browser can record audio at all. */
export function voiceInputSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof window.MediaRecorder !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Record-then-transcribe for the chat composer: press to start, press again to
 * stop, and the clip is sent to `/api/chat/transcribe/`. Recording stops by
 * itself at `MAX_RECORDING_MS`. The microphone is released as soon as a clip
 * ends, and on unmount, so the browser's recording indicator never lingers.
 */
export function useVoiceInput({ onText, onError }: Options) {
  const [state, setState] = useState<VoiceState>('idle');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  // Set on unmount (and on cancel) so a clip still in flight is dropped
  // rather than written into a composer that no longer exists.
  const discardRef = useRef(false);
  // Latest callbacks without restarting the recorder when they change.
  const handlers = useRef({ onText, onError });
  useEffect(() => {
    handlers.current = { onText, onError };
  }, [onText, onError]);

  const release = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setStartedAt(null);
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current || state !== 'idle') return;
    if (!voiceInputSupported()) {
      handlers.current.onError('This browser cannot record audio.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      handlers.current.onError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone access is blocked. Allow it in the browser to use voice input.'
          : name === 'NotFoundError'
            ? 'No microphone was found.'
            : 'The microphone could not be opened.',
      );
      return;
    }
    const mime = pickRecorderMime(type => MediaRecorder.isTypeSupported(type));
    let recorder: MediaRecorder;
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach(track => track.stop());
      handlers.current.onError('This browser cannot record audio.');
      return;
    }
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = async () => {
      const type = recorder.mimeType || mime || 'audio/webm';
      release();
      if (discardRef.current) {
        setState('idle');
        return;
      }
      const clip = new Blob(chunks, { type });
      if (clip.size === 0) {
        setState('idle');
        return;
      }
      setState('transcribing');
      try {
        const { text } = await chatService.transcribe(clip, `voice.${extensionFor(type)}`);
        if (discardRef.current) return;
        if (text.trim()) handlers.current.onText(text);
        else handlers.current.onError('No speech was heard in that recording.');
      } catch (err) {
        if (!discardRef.current) {
          handlers.current.onError(apiErrorMessage(err, 'Could not transcribe that recording.'));
        }
      } finally {
        if (!discardRef.current) setState('idle');
      }
    };
    discardRef.current = false;
    streamRef.current = stream;
    recorderRef.current = recorder;
    recorder.start();
    setStartedAt(Date.now());
    setState('recording');
    timerRef.current = window.setTimeout(stop, MAX_RECORDING_MS);
  }, [release, state, stop]);

  /** Stop without transcribing. */
  const cancel = useCallback(() => {
    discardRef.current = true;
    stop();
    release();
    setState('idle');
  }, [release, stop]);

  const toggle = useCallback(() => {
    if (state === 'recording') stop();
    else if (state === 'idle') void start();
  }, [start, state, stop]);

  useEffect(() => () => {
    discardRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    streamRef.current?.getTracks().forEach(track => track.stop());
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  return { state, startedAt, toggle, cancel };
}
