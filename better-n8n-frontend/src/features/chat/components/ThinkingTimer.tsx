import { useEffect, useState } from 'react';

/**
 * The elapsed-time readout shown while a turn is in flight.
 *
 * It owns the interval and the state it drives. That is the whole point: the
 * timer ticks ten times a second, and when the tick lived in the chat page the
 * entire tree — every message, every markdown body — re-rendered at 10 Hz for
 * the sake of one number in the corner. Isolated here, a tick re-renders one
 * `<span>`.
 *
 * `active` resets the clock on each new turn, so the caller does not have to.
 */
export default function ThinkingTimer({
  active,
  className = 'text-[11px] font-mono text-muted-foreground/40 shrink-0',
}: {
  active: boolean;
  className?: string;
}) {
  const [seconds, setSeconds] = useState(0);

  // Resetting the clock is an *adjustment to a prop change*, not a side effect,
  // so it happens during render — React's documented pattern, and the reason
  // this no longer trips `react-hooks/set-state-in-effect`. React re-runs the
  // component immediately without committing the discarded render, so the
  // reset costs nothing and the effect below is left owning only the interval,
  // which is the one thing that genuinely is a side effect.
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    setSeconds(0);
  }

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setSeconds((s) => s + 0.1), 100);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;
  return <span className={className}>({seconds.toFixed(1)}s)</span>;
}
