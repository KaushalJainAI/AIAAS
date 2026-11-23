/**
 * Opens a turn's first file, or its first browser update, beside the chat when
 * `shouldAutoOpen` says so. It also keeps the live browser tab current while
 * the turn runs.
 *
 * It renders nothing. It sits inside the side pane's provider so it can read
 * the pane (did the user close it this turn?) and use the open door. The
 * reducer is not involved: the lists come from the stream, and this effect is
 * the only thing that opens the pane for them.
 *
 * "This turn" is `turnKey`: a new value (one per send) resets the user-closed
 * flag and both first-item checks.
 */
import { useEffect, useRef } from 'react';

import type { FileCardData } from '@/api/chat';
import type { BrowserView } from '@/api/browser';
import { useFilePreview } from '@/components/files/filePreviewState';
import { usePane } from '@/components/pane/paneState';
import { browserLabel } from '@/lib/browserView';
import { browserTabId } from '@/lib/paneTabs';
import { shouldAutoOpen } from '../lib/autoOpen';
import { liveRunKey } from '../lib/browserRuns';

interface Props {
  /** The turn's files so far, as the stream has them (a whole list, replaced on each update). */
  files: FileCardData[];
  /** The turn's browser calls so far (a whole list, replaced on each update). */
  browser: BrowserView[];
  /** The agent is still working on this turn. */
  running: boolean;
  /** Changes once per send, so each turn starts fresh. */
  turnKey: number;
  /** The Chat settings switch. */
  enabled: boolean;
}

export default function AutoOpenFiles({ files, browser, running, turnKey, enabled }: Props) {
  const openFile = useFilePreview();
  const pane = usePane();
  const paneOpen = pane?.state.open ?? false;
  const openTab = pane?.openTab;
  const dispatch = pane?.dispatch;

  const userClosed = useRef(false);
  const wasOpen = useRef(paneOpen);
  const firstFileChecked = useRef(false);
  const firstBrowserChecked = useRef(false);

  // The pane only hides by a user action (×, Escape, Back, closing the last
  // tab), so an open-to-closed change is the user closing it.
  useEffect(() => {
    if (wasOpen.current && !paneOpen) userClosed.current = true;
    wasOpen.current = paneOpen;
  }, [paneOpen]);

  // A new turn: forget the last turn's close and its first items.
  useEffect(() => {
    userClosed.current = false;
    firstFileChecked.current = false;
    firstBrowserChecked.current = false;
  }, [turnKey]);

  useEffect(() => {
    if (firstFileChecked.current || files.length === 0) return;
    // Only the turn's first file is ever considered. If that one is an edit
    // rather than a new file, nothing opens for the rest of the turn.
    firstFileChecked.current = true;
    const first = files[0];
    if (!openFile) return;
    if (
      shouldAutoOpen({
        width: window.innerWidth,
        userClosed: userClosed.current,
        setting: enabled,
        qualifies: first.action === 'created',
      })
    ) {
      openFile({ documentId: first.document_id });
    }
  }, [files, enabled, openFile]);

  // The first browser update of the turn opens the Browser tab, by the same rules.
  useEffect(() => {
    if (firstBrowserChecked.current || browser.length === 0) return;
    firstBrowserChecked.current = true;
    if (!openTab) return;
    if (
      shouldAutoOpen({
        width: window.innerWidth,
        userClosed: userClosed.current,
        setting: enabled,
        qualifies: true,
      })
    ) {
      openTab({
        kind: 'browser',
        runKey: liveRunKey(turnKey),
        title: browserLabel(browser),
        views: browser,
        running: true,
      });
    }
  }, [browser, enabled, openTab, turnKey]);

  // Keep the live tab current: its calls as they arrive, and whether the agent
  // is still at the browser. A tab that is not open is left alone by the reducer.
  useEffect(() => {
    if (!dispatch) return;
    dispatch({
      type: 'browserState',
      id: browserTabId(liveRunKey(turnKey)),
      running,
      views: browser.length > 0 ? browser : undefined,
    });
  }, [browser, running, turnKey, dispatch]);

  return null;
}
