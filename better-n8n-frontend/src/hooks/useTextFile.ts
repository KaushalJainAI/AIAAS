/**
 * Open, edit and save one text file — what every text-shaped app shares.
 *
 * The text comes from `download`, never from the detail's `content`: for an
 * upload, `content` is what the *extractor* kept (a CSV's is a lossy
 * space-join), while `download` serves the real bytes. The detail supplies
 * only `updated_at`, the stale-write guard the save sends back.
 *
 * A 412 keeps the user's text on screen and flags `stale`; `reload()` fetches
 * the newer version and throws the edit away, `overwrite()` saves over it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { documentsService, type Document } from '../api/documents';
import { useRegisterSave } from '../components/apps/useSave';
import { apiErrorMessage } from '../lib/apiError';
import { useHistory } from '../lib/history';
import { toast } from '../lib/toastStore';

export interface TextFile {
  doc: Document | null;
  text: string;
  setText: (next: string) => void;
  loading: boolean;
  error: string | null;
  dirty: boolean;
  saving: boolean;
  stale: boolean;
  save: () => Promise<boolean>;
  overwrite: () => Promise<boolean>;
  reload: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useTextFile(docId: number, { autosaveMs }: { autosaveMs?: number } = {}): TextFile {
  const qc = useQueryClient();
  const [doc, setDoc] = useState<Document | null>(null);
  const [text, setTextState] = useState('');
  const [base, setBase] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [stale, setStale] = useState(false);
  const [nonce, setNonce] = useState(0);
  const etag = useRef<string | undefined>(undefined);
  const { record, undo: undoHistory, redo: redoHistory, reset: resetHistory, canUndo, canRedo } =
    useHistory();

  // Callers key the editor on the file, so a different file is a fresh mount
  // that starts in the loading state; `reload` resets it from its handler.
  useEffect(() => {
    let cancelled = false;
    Promise.all([documentsService.get(docId), documentsService.download(docId).then((b) => b.text())])
      .then(([d, body]) => {
        if (cancelled) return;
        setDoc(d);
        etag.current = d.updated_at;
        setTextState(body);
        setBase(body);
        resetHistory();
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, 'Could not open that file.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // A new file is a new mount; `reload` drives refetches through `nonce`,
    // and `resetHistory` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, nonce]);

  const dirty = text !== base;

  const setText = useCallback(
    (next: string) => {
      setTextState((prev) => {
        if (prev === next) return prev;
        record(prev);
        return next;
      });
    },
    [record],
  );

  const undo = useCallback(() => {
    setTextState((prev) => undoHistory(prev) ?? prev);
  }, [undoHistory]);

  const redo = useCallback(() => {
    setTextState((prev) => redoHistory(prev) ?? prev);
  }, [redoHistory]);

  const write = useCallback(
    async (guard: boolean) => {
      if (saving) return false;
      setSaving(true);
      try {
        const snapshot = text;
        const saved = await documentsService.updateContent(docId, snapshot, guard ? etag.current : undefined);
        etag.current = saved.updated_at;
        setDoc(saved);
        setBase(snapshot);
        setStale(false);
        qc.invalidateQueries({ queryKey: ['documents'] });
        qc.invalidateQueries({ queryKey: ['app-files'] });
        return true;
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 412) setStale(true);
        else toast.error('Could not save', apiErrorMessage(err, 'Please try again.'));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [docId, qc, saving, text],
  );

  const save = useCallback(async () => (dirty ? write(true) : true), [dirty, write]);
  const overwrite = useCallback(() => write(false), [write]);
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    setStale(false);
    setNonce((n) => n + 1);
  }, []);

  // Autosave after a pause in typing.
  useEffect(() => {
    if (!autosaveMs || !dirty || stale || loading) return;
    const t = window.setTimeout(() => void write(true), autosaveMs);
    return () => window.clearTimeout(t);
  }, [autosaveMs, dirty, stale, loading, text, write]);

  // Flush when the tab is hidden or closed: the pause timer above may never
  // fire there, and an autosave that only runs while visible is not one.
  // Best-effort on close — the draft/render still runs server-side on quiet.
  const flushRef = useRef(() => {});
  useEffect(() => {
    flushRef.current = () => {
      if (dirty && !stale && !loading && !saving) void write(true);
    };
  });
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flushRef.current();
    };
    const onHide = () => flushRef.current();
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  // The app bar and the unsaved-changes dialog save through this.
  useRegisterSave(save, dirty, saving);

  return {
    doc, text, setText, loading, error, dirty, saving, stale,
    save, overwrite, reload, undo, redo, canUndo, canRedo,
  };
}


