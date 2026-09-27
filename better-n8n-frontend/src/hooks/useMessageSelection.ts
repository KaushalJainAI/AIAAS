/**
 * Text selection inside the transcript, and the "reference this passage" state
 * it feeds.
 *
 * The DOM walk that maps a selection back to its owning message lived inline in
 * an `onMouseUp` prop, alongside three `setSelectionPos(null)` early returns.
 * Keeping it here makes the transcript's JSX a one-line handler and gives the
 * anchor-resolution rule a single place to be corrected.
 */

import { useCallback, useMemo, useState } from 'react';

export interface SelectionAnchor {
  x: number;
  y: number;
}

export interface MessageReference {
  messageId: number;
  textSnippet: string;
}

/** Walks up from a selection anchor to the nearest element tagged with a message id. */
function messageIdOf(node: Node | null): number | null {
  let current: Node | null = node;
  while (current && current !== document.body) {
    if (current.nodeType === 1 && (current as HTMLElement).hasAttribute('data-message-id')) {
      const raw = (current as HTMLElement).getAttribute('data-message-id') || '';
      const parsed = parseInt(raw, 10);
      return Number.isNaN(parsed) ? null : parsed;
    }
    current = current.parentNode;
  }
  return null;
}

export function useMessageSelection() {
  const [anchor, setAnchor] = useState<SelectionAnchor | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  const [reference, setReference] = useState<MessageReference | null>(null);

  const dismiss = useCallback(() => setAnchor(null), []);

  /** Re-reads the live selection; call from pointer-up / key-up on the transcript. */
  const syncFromDocument = useCallback(() => {
    const selection = window.getSelection();
    const text = selection && !selection.isCollapsed ? selection.toString().trim() : '';
    if (!text || !selection) {
      setAnchor(null);
      return;
    }

    const messageId = messageIdOf(selection.anchorNode);
    if (messageId === null) {
      setAnchor(null);
      return;
    }

    const rect = selection.getRangeAt(0).getBoundingClientRect();
    setAnchor({ x: rect.left + rect.width / 2, y: rect.top });
    setSelectedMessageId(messageId);
    setSelectedText(text);
  }, []);

  const copySelection = useCallback(() => {
    navigator.clipboard.writeText(selectedText);
    setAnchor(null);
    window.getSelection()?.removeAllRanges();
  }, [selectedText]);

  /** Promotes the selection into a reference the next message will quote. */
  const referenceSelection = useCallback(() => {
    if (selectedMessageId !== null) {
      setReference({ messageId: selectedMessageId, textSnippet: selectedText });
    }
    setAnchor(null);
    window.getSelection()?.removeAllRanges();
    return selectedMessageId !== null;
  }, [selectedMessageId, selectedText]);

  const clearReference = useCallback(() => setReference(null), []);

  return useMemo(
    () => ({
      anchor,
      selectedText,
      reference,
      syncFromDocument,
      dismiss,
      copySelection,
      referenceSelection,
      clearReference,
    }),
    [anchor, selectedText, reference, syncFromDocument, dismiss, copySelection, referenceSelection, clearReference],
  );
}
