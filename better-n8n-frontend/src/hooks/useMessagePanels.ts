/**
 * Tracks which expandable panel is open on which message.
 *
 * Replaces seven parallel `expanded<Panel>MsgId` state slices that each
 * reimplemented the same `id === current ? null : id` toggle. Panels stay
 * independent — opening "sources" does not close "summary" — because they were
 * independent before; this only removes the repetition, not the behaviour.
 */

import { useCallback, useMemo, useState } from 'react';

export type MessagePanel =
  | 'summary'
  | 'thinking'
  | 'activity'
  | 'code'
  | 'sources'
  | 'images'
  | 'videos';

type PanelState = Partial<Record<MessagePanel, number | null>>;

export function useMessagePanels() {
  const [open, setOpen] = useState<PanelState>({});

  /** Opens `panel` on `messageId`, or closes it if that pair is already open. */
  const toggle = useCallback((panel: MessagePanel, messageId: number) => {
    setOpen((prev) => ({ ...prev, [panel]: prev[panel] === messageId ? null : messageId }));
  }, []);

  const isOpen = useCallback(
    (panel: MessagePanel, messageId: number | undefined) =>
      messageId !== undefined && open[panel] === messageId,
    [open],
  );

  /** The message a panel is currently open on, if any. */
  const openIdFor = useCallback((panel: MessagePanel) => open[panel] ?? null, [open]);

  return useMemo(() => ({ toggle, isOpen, openIdFor }), [toggle, isOpen, openIdFor]);
}
