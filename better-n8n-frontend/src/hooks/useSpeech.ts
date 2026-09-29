import { useCallback, useEffect, useRef, useState } from 'react';

import { chatService } from '../api/chat';

/**
 * The chat speaker button: press to hear one message read aloud, press again
 * to stop. Tries the backend (`/api/chat/speak/`, natural voices once
 * `TTS_ENGINE=openrouter` is set) first; on any failure — no engine
 * configured (503), network, anything — it falls back silently to the
 * browser's own `speechSynthesis`, so the button works with zero backend
 * setup and quietly upgrades once one exists. `transcribe`'s mirror image:
 * `useVoiceInput` records then posts, this posts then plays.
 */
export function useSpeech() {
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Bumped on every stop/start so a stale async response can't resurrect
  // playback after the user moved on.
  const tokenRef = useRef(0);

  const stop = useCallback(() => {
    tokenRef.current += 1;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setSpeakingId(null);
    setLoadingId(null);
  }, []);

  const speakInBrowser = useCallback((messageId: number, text: string, token: number) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      if (tokenRef.current === token) setLoadingId(null);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => {
      if (tokenRef.current === token) { setSpeakingId(null); setLoadingId(null); }
    };
    utterance.onerror = utterance.onend;
    window.speechSynthesis.speak(utterance);
    if (tokenRef.current === token) { setSpeakingId(messageId); setLoadingId(null); }
  }, []);

  const toggle = useCallback((messageId: number, text: string) => {
    if (speakingId === messageId || loadingId === messageId) {
      stop();
      return;
    }
    stop();
    const token = tokenRef.current;
    setLoadingId(messageId);

    void (async () => {
      try {
        const { audioBase64, format } = await chatService.speak(text);
        if (tokenRef.current !== token) return; // superseded while awaiting
        const audio = new Audio(`data:audio/${format};base64,${audioBase64}`);
        const finish = () => {
          if (tokenRef.current === token) { setSpeakingId(null); setLoadingId(null); }
        };
        audio.onended = finish;
        audio.onerror = finish;
        audioRef.current = audio;
        await audio.play();
        if (tokenRef.current === token) { setSpeakingId(messageId); setLoadingId(null); }
      } catch {
        if (tokenRef.current === token) speakInBrowser(messageId, text, token);
      }
    })();
  }, [loadingId, speakInBrowser, speakingId, stop]);

  useEffect(() => stop, [stop]);

  return { speakingId, loadingId, toggle, stop };
}
