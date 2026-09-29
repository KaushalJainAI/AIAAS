import { useEffect, useState } from 'react';
import { Loader2, Mic, Square, X } from 'lucide-react';

import type { VoiceState } from '../../hooks/useVoiceInput';
import { formatElapsed } from '../../lib/voice';

interface Props {
  state: VoiceState;
  startedAt: number | null;
  onToggle: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

/**
 * The composer's mic. Props only: `useVoiceInput` owns the recorder.
 * Idle it is a mic; recording it is a red stop button with a timer and a
 * discard; transcribing it spins.
 */
export function VoiceInputButton({ state, startedAt, onToggle, onCancel, disabled }: Props) {
  if (state === 'recording') {
    return (
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onCancel}
          className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          title="Discard recording"
          aria-label="Discard recording"
        >
          <X className="w-3.5 h-3.5" />
        </button>
        <RecordingTimer startedAt={startedAt} />
        <button
          type="button"
          onClick={onToggle}
          className="w-8 h-8 rounded-full flex items-center justify-center bg-red-500 text-white hover:bg-red-600 transition-colors animate-pulse"
          title="Stop and transcribe"
          aria-label="Stop recording and transcribe"
        >
          <Square className="w-3 h-3 fill-current" />
        </button>
      </div>
    );
  }
  const busy = state === 'transcribing';
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled || busy}
      className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0 disabled:opacity-40 disabled:hover:bg-transparent"
      title={busy ? 'Transcribing…' : 'Voice input'}
      aria-label={busy ? 'Transcribing' : 'Start voice input'}
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
    </button>
  );
}

/** Its own component so the once-a-second tick re-renders only this. */
function RecordingTimer({ startedAt }: { startedAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="text-[11px] tabular-nums text-red-500 font-medium min-w-[2.2rem] text-center">
      {formatElapsed(startedAt ? now - startedAt : 0)}
    </span>
  );
}
