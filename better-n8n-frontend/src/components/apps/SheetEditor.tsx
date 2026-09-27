/**
 * Sheets: a Univer grid over the workbook's snapshot.
 *
 * An `.xlsx` loads its snapshot from `GET office/` (values, formulas,
 * styles, merges, dimensions, freeze panes), edits in Univer — grid,
 * formulas, formatting and number formats included — and autosaves the
 * snapshot back through `POST draft/`; the real bytes rebuild after quiet.
 * A CSV opens in the same grid (built locally, values only) and saves back
 * as CSV through the text door. Undo is Univer's own, so there is no history
 * stack here: Ctrl+Z works because the grid owns the keystroke.
 */
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { IWorkbookData } from '@univerjs/core';

import { documentsService } from '../../api/documents';
import { apiErrorMessage } from '../../lib/apiError';
import { parseCsv } from '../../lib/csv';
import { toCsv, type Grid } from '../../lib/sheetGrid';
import { toast } from '../../lib/toastStore';
import { EditorError, EditorLoading, SaveStatus, StaleBanner } from './EditorChrome';
import { useRegisterSave } from './useSave';
import type { EditorProps } from './TextEditors';
import type { UniverSheetHandle } from './UniverSheet';

const UniverSheet = lazy(() => import('./UniverSheet'));

function stale(err: unknown): boolean {
  return (err as { response?: { status?: number } })?.response?.status === 412;
}

/** A values-only snapshot for a CSV, so it opens in the same grid. */
function csvSnapshot(grid: Grid): IWorkbookData {
  const rows = Math.max(grid.length, 1);
  const cols = Math.max(grid.reduce((m, row) => Math.max(m, row.length), 0), 1);
  const cellData: Record<number, Record<number, { v: string }>> = {};
  grid.forEach((row, r) => {
    row.forEach((value, c) => {
      if (value !== '') (cellData[r] ??= {})[c] = { v: value };
    });
  });
  return {
    id: 'csv',
    name: 'Sheet1',
    appVersion: '1.0.2',
    locale: 'enUS',
    styles: {},
    sheetOrder: ['sheet-0'],
    sheets: {
      'sheet-0': {
        id: 'sheet-0',
        name: 'Sheet1',
        rowCount: rows + 50,
        columnCount: cols + 10,
        cellData,
      },
    },
  } as unknown as IWorkbookData;
}

/** A snapshot back to CSV rows: values only, never formulas. */
function snapshotGrid(snapshot: IWorkbookData): Grid {
  const sheet = Object.values(snapshot.sheets ?? {})[0] as
    | { cellData?: Record<string, Record<string, { v?: unknown; f?: unknown }>> }
    | undefined;
  const cells = sheet?.cellData ?? {};
  const rows = Math.max(0, ...Object.keys(cells).map(Number));
  const grid: Grid = [];
  for (let r = 0; r <= rows; r += 1) {
    const row = cells[r] ?? {};
    const cols = Math.max(-1, ...Object.keys(row).map(Number));
    const out: string[] = [];
    for (let c = 0; c <= cols; c += 1) {
      const cell = row[c];
      if (!cell) {
        out.push('');
      } else if (cell.f !== undefined && cell.f !== null) {
        out.push(cell.v === undefined || cell.v === null ? String(cell.f) : String(cell.v));
      } else {
        out.push(cell.v === undefined || cell.v === null ? '' : String(cell.v));
      }
    }
    grid.push(out);
  }
  return grid;
}

export default function SheetEditor({ doc, onDirtyChange }: EditorProps) {
  const qc = useQueryClient();
  const isCsv = doc.file_type === 'csv';
  const [snapshot, setSnapshot] = useState<IWorkbookData | null>(null);
  const [delimiter, setDelimiter] = useState<',' | '\t' | ';'>(',');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [nonce, setNonce] = useState(0);
  const etag = useRef<string | undefined>(undefined);
  const apiRef = useRef<UniverSheetHandle>(null);

  // Keyed on the file by the workspace, so the first load needs no reset;
  // `reload` resets from its handler.
  useEffect(() => {
    let cancelled = false;
    const load = isCsv
      ? Promise.all([documentsService.get(doc.id), documentsService.download(doc.id).then((b) => b.text())]).then(
          ([d, text]) => {
            const table = parseCsv(text, Number.POSITIVE_INFINITY);
            const grid = table.headers.length ? [table.headers, ...table.rows] : [];
            setDelimiter(table.delimiter);
            etag.current = d.updated_at;
            return csvSnapshot(grid);
          },
        )
      : documentsService.workbook(doc.id).then((wb) => {
          etag.current = wb.updated_at;
          if (!wb.snapshot || typeof wb.snapshot !== 'object') {
            throw new Error('The server did not return a snapshot for this workbook.');
          }
          return wb.snapshot as IWorkbookData;
        });
    load
      .then((next) => {
        if (cancelled) return;
        setSnapshot(next);
        setDirty(false);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, 'Could not open this spreadsheet.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [doc.id, isCsv, nonce]);

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const save = useCallback(async (guard = true): Promise<boolean> => {
    const current = apiRef.current?.getSnapshot();
    // Nothing edited, or the grid is not up yet: nothing to save.
    if (!current || !dirty) return true;
    if (saving) return false;
    setSaving(true);
    try {
      if (isCsv) {
        const saved = await documentsService.updateContent(
          doc.id, toCsv(snapshotGrid(current), delimiter), guard ? etag.current : undefined,
        );
        etag.current = saved.updated_at;
      } else {
        const saved = await documentsService.saveDraft(
          doc.id, { snapshot: current }, guard ? etag.current : undefined,
        );
        etag.current = saved.updated_at;
      }
      setDirty(false);
      // Moves the grid's baseline to what was sent; without it the grid
      // never reports a later edit, and only the first burst is ever saved.
      apiRef.current?.markSaved(current);
      setIsStale(false);
      qc.invalidateQueries({ queryKey: ['documents'] });
      qc.invalidateQueries({ queryKey: ['app-files'] });
      return true;
    } catch (err) {
      if (stale(err)) setIsStale(true);
      else toast.error('Could not save', apiErrorMessage(err, 'Please try again.'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [dirty, isCsv, saving, doc.id, delimiter, qc]);

  // Autosave after a quiet pause. The Save button is gone; this is the save.
  useEffect(() => {
    if (!dirty || isStale || loading) return;
    const t = window.setTimeout(() => void save(), 1500);
    return () => window.clearTimeout(t);
  }, [dirty, isStale, loading, save]);

  // Flush when the tab is hidden or closed.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && dirtyRef.current) void saveRef.current();
    };
    const onHide = () => {
      if (dirtyRef.current) void saveRef.current();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  // The app bar and the unsaved-changes dialog save through this.
  useRegisterSave(
    useCallback(() => save(), [save]),
    dirty,
    saving,
  );

  if (loading) return <EditorLoading />;
  if (error) return <EditorError message={error} />;
  if (engineError) return <EditorError message={engineError} />;
  if (!snapshot) return <EditorError message="This workbook has no sheets." />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {isStale && (
        <StaleBanner
          onReload={() => {
            setLoading(true);
            setIsStale(false);
            setNonce((n) => n + 1);
          }}
          onOverwrite={() => void save(false)}
        />
      )}
      <Suspense fallback={<EditorLoading label="Loading the grid…" />}>
        <UniverSheet
          key={`${doc.id}:${nonce}`}
          ref={apiRef}
          snapshot={snapshot}
          onDirtyChange={setDirty}
          onError={setEngineError}
        />
      </Suspense>
      <SaveStatus
        dirty={dirty}
        saving={saving}
        hint="Autosaves as you type"
        extra={<span>{isCsv ? 'CSV · values only' : 'Excel workbook · formulas calculate live'}</span>}
      />
    </div>
  );
}
