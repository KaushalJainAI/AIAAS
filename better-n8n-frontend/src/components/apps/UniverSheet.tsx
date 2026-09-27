/**
 * A Univer grid over an `IWorkbookData` snapshot — the Sheets app's editor.
 *
 * Loaded lazily (with its CSS and worker) so the login screen and every other
 * page skip the several megabytes of grid, formula engine and UI. The parent
 * owns loading and saving; this owns the Univer lifetime: create on mount,
 * dispose on unmount, and report dirtiness.
 *
 * Dirtiness is a normalised snapshot comparison, debounced after each
 * executed command. Two normalisations keep it honest: the `rev` counter is
 * skipped (it moves on every mutation by design), and calculated values of
 * formula cells are skipped (the engine writes those itself after load —
 * they are derived state, never the user's edit).
 */
import { useEffect, useImperativeHandle, useRef } from 'react';
import {
  LocaleType, UniverInstanceType, type ILanguagePack, type IWorkbookData,
} from '@univerjs/core';
import { createUniver } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import SheetsWorker from '@univerjs/preset-sheets-core/lib/worker.js?worker';

import '@univerjs/preset-sheets-core/lib/index.css';

export interface UniverSheetHandle {
  /** The workbook as Univer holds it now, or null when it is gone. */
  getSnapshot: () => IWorkbookData | null;
  /**
   * The parent saved `saved`: it becomes the new clean baseline, and the grid
   * is re-checked against it, so edits made while the save was in flight
   * still read as dirty.
   */
  markSaved: (saved: IWorkbookData) => void;
}

interface Props {
  snapshot: IWorkbookData;
  onDirtyChange?: (dirty: boolean) => void;
  onError?: (message: string) => void;
  /** Preview use: no editing, no chrome, no dirty reports. */
  readOnly?: boolean;
  ref?: React.Ref<UniverSheetHandle>;
}

function normalise(snapshot: IWorkbookData): string {
  const sheets: Record<string, unknown> = {};
  for (const [id, sheet] of Object.entries(snapshot.sheets ?? {})) {
    const cells: Record<string, unknown> = {};
    for (const [r, row] of Object.entries((sheet as { cellData?: object }).cellData ?? {})) {
      const outRow: Record<string, unknown> = {};
      for (const [c, cell] of Object.entries((row as object) ?? {})) {
        const typed = cell as { f?: unknown };
        // A formula cell's value is derived; without this the engine's own
        // first calculation would read as an edit.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { v, ...rest } = typed as { v?: unknown } & Record<string, unknown>;
        outRow[c] = typed.f !== undefined && typed.f !== null ? rest : cell;
      }
      cells[r] = outRow;
    }
    sheets[id] = { ...(sheet as object), cellData: cells };
  }
  return stable({ sheets, sheetOrder: snapshot.sheetOrder, styles: snapshot.styles });
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  const serialised = JSON.stringify(value);
  return serialised === undefined ? 'null' : serialised;
}

export default function UniverSheet({ snapshot, onDirtyChange, onError, readOnly, ref }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<UniverSheetHandle | null>(null);
  const dirtyRef = useRef(false);
  const baselineRef = useRef<string | null>(null);
  const recheckRef = useRef<(() => void) | null>(null);
  const onDirtyRef = useRef(onDirtyChange);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onDirtyRef.current = onDirtyChange;
    onErrorRef.current = onError;
  });

  useImperativeHandle(ref, () => ({
    getSnapshot: () => apiRef.current?.getSnapshot() ?? null,
    markSaved: (saved: IWorkbookData) => {
      baselineRef.current = normalise(saved);
      // The parent has already cleared its own flag; mirror that, then
      // report again if the grid moved on while the save was in flight.
      dirtyRef.current = false;
      recheckRef.current?.();
    },
  }));

  useEffect(() => {
    let cancelled = false;
    let univer: { dispose: () => void } | null = null;
    let worker: Worker | null = null;
    let timer: number | null = null;
    let events: { dispose: () => void } | null = null;
    const container = containerRef.current;
    if (!container) return undefined;

    baselineRef.current = normalise(snapshot);
    const report = (dirty: boolean) => {
      if (cancelled || dirtyRef.current === dirty) return;
      dirtyRef.current = dirty;
      onDirtyRef.current?.(dirty);
    };

    (async () => {
      // The locale files ship without types, so this import stays dynamic
      // (typed as unknown) rather than failing the build.
      const locales = (await import(
        '@univerjs/preset-sheets-core/locales/en-US'
      )) as unknown as { default: unknown };
      if (cancelled) return;
      try {
        worker = new SheetsWorker();
      } catch {
        // Without the formula worker the grid still edits; formulas show
        // the backend-calculated values the snapshot seeded.
        worker = null;
      }
      if (cancelled) {
        worker?.terminate();
        return;
      }
      const { univer: created, univerAPI } = createUniver({
        locale: LocaleType.EN_US,
        locales: { [LocaleType.EN_US]: locales.default as ILanguagePack },
        presets: [
          UniverSheetsCorePreset({
            container,
            workerURL: worker ?? undefined,
            header: false,
            formulaBar: !readOnly,
            footer: readOnly ? false : undefined,
            toolbar: readOnly ? false : undefined,
          }),
        ],
      });
      univer = created;
      created.createUnit(UniverInstanceType.UNIVER_SHEET, snapshot);
      if (readOnly) {
        univerAPI.getActiveWorkbook()?.setEditable(false);
        apiRef.current = { getSnapshot: () => null, markSaved: () => {} };
        return;
      }
      const getSnapshot = () => univerAPI.getActiveWorkbook()?.save() ?? null;
      apiRef.current = { getSnapshot, markSaved: () => {} };
      const recheck = () => {
        const current = getSnapshot();
        if (current) report(normalise(current) !== baselineRef.current);
      };
      recheckRef.current = recheck;
      events = univerAPI.addEvent(univerAPI.Event.CommandExecuted, () => {
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          timer = null;
          recheck();
        }, 400);
      });
    })().catch(() => {
      if (!cancelled) onErrorRef.current?.('The spreadsheet engine could not start.');
    });

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      events?.dispose();
      apiRef.current = null;
      recheckRef.current = null;
      univer?.dispose();
      worker?.terminate();
      worker = null;
    };
    // One lifetime per file: the shell remounts on file change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="min-h-0 min-w-0 flex-1" aria-label="Spreadsheet" />;
}
