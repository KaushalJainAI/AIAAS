/**
 * Extraction panel — the merge of the retired standalone /extract pages
 * (2026-08-18). One component, two placements:
 *
 * - `manage`: Documents' Extraction tab — schema cards, the rows table for the
 *   selected schema, and the "Extract now" flow (pick documents, run the LLM
 *   extraction against the schema).
 * - `review`: Inbox's review tab — rows held below the confidence threshold
 *   across every schema, because a held row is attention, the same nature as
 *   a HITL request.
 *
 * Review is an explicit act recorded against a person — "who said this
 * ₹48,200 was right?" has to have an answer or the table is not usable for
 * accounting. Low-confidence cells are tinted so the eye lands on the field
 * that is actually doubtful rather than on the whole row.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ScanText, Plus, AlertTriangle, CheckCircle2, Loader2, Upload, Check, X, SlidersHorizontal, Wand2,
} from 'lucide-react';
import { toast } from '../../lib/toastStore';
import { cn } from '../../lib/utils';
import { documentsService } from '../../api';
import extractionService, {
  type ExtractedRow, type ExtractionSchema, type RowStatus,
} from '../../api/extraction';
import { sourceIcon, sourceLabel, rowStatusStyle } from '../../lib/extractionDisplay';
import TruncationNotice from '../ui/TruncationNotice';

const FILTERS: { id: RowStatus | ''; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'needs_review', label: 'Needs review' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'reviewed', label: 'Reviewed' },
  { id: 'rejected', label: 'Rejected' },
];

function NewSchemaForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [fieldText, setFieldText] = useState('vendor\ndate\ngstin\ntotal');

  const create = useMutation({
    mutationFn: () =>
      extractionService.createSchema({
        name: name.trim(),
        // One field per line is the fastest way to define a table by hand.
        fields: fieldText
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((n) => ({ name: n, type: 'string' as const })),
      }),
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: ['extraction-schemas'] });
      toast.success(`${s.name} created`);
      onDone();
    },
    onError: (err: { response?: { data?: Record<string, unknown> } }) => {
      const first = err.response?.data && Object.values(err.response.data)[0];
      toast.error(String(Array.isArray(first) ? first[0] : (first ?? 'Could not create that schema.')));
    },
  });

  return (
    <div className="bg-card border border-border rounded p-4 mb-4 max-w-md space-y-3">
      <div>
        <label className="block text-[13px] font-medium mb-1.5">Schema name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Purchase invoices"
          className="w-full h-9 px-3 rounded border border-input bg-background text-sm"
        />
      </div>
      <div>
        <label className="block text-[13px] font-medium mb-1.5">
          Fields <span className="text-muted-foreground font-normal">one per line</span>
        </label>
        <textarea
          value={fieldText}
          onChange={(e) => setFieldText(e.target.value)}
          rows={5}
          className="w-full px-3 py-2 rounded border border-input bg-background text-sm font-mono resize-none"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => create.mutate()}
          disabled={!name.trim() || create.isPending}
          className="px-4 py-1.5 text-sm font-semibold rounded bg-primary text-primary-foreground disabled:opacity-50"
        >
          Create
        </button>
        <button
          onClick={onDone}
          className="px-3 py-1.5 text-sm rounded border border-border hover:bg-secondary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Pick documents and run the schema's LLM extraction over them. */
function ExtractModal({ schema, onClose }: { schema: ExtractionSchema; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['extraction-doc-picker'],
    queryFn: () => documentsService.list({ limit: 100, scope: 'personal' }),
    staleTime: 30_000,
  });
  const docs = data?.my_documents ?? [];

  const run = useMutation({
    mutationFn: (documentIds: number[]) => extractionService.extract(schema.id, documentIds),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['extraction-schemas'] });
      queryClient.invalidateQueries({ queryKey: ['extraction-rows'] });
      onClose();
      if (res.async) {
        toast.success('Extraction started', 'It is running in the background.');
      } else {
        const errors = (res.errors as { document: number; error: string }[]) ?? [];
        toast.success(
          'Extraction finished',
          `${res.processed} document${res.processed === 1 ? '' : 's'} processed`
            + (res.needs_review ? `, ${res.needs_review} held for review` : '')
            + (errors.length ? `, ${errors.length} failed` : '')
        );
      }
    },
    onError: () => toast.error('Could not start that extraction.'),
  });

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-6 animate-in fade-in duration-300"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border/60 rounded-lg shadow-lg w-full max-w-lg overflow-hidden entrance-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-border/60 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">Extract with “{schema.name}”</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Runs the LLM over the documents you pick; rows below{' '}
              {Math.round(schema.confidence_threshold * 100)}% confidence are held for review.
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 max-h-[50vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-8">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading documents…
            </div>
          ) : docs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No personal documents yet — upload some first.
            </p>
          ) : (
            <div className="space-y-1">
              {docs.map((doc) => (
                <label
                  key={doc.id}
                  className="flex items-center gap-3 px-3 py-2 rounded hover:bg-secondary cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={checked.has(doc.id)}
                    onChange={(e) =>
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(doc.id);
                        else next.delete(doc.id);
                        return next;
                      })
                    }
                    className="accent-primary"
                  />
                  <span className="text-sm text-foreground truncate flex-1">{doc.title}</span>
                  <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                    {doc.chunk_count} chunks
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-border/60 flex justify-end gap-3 bg-background/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => run.mutate([...checked])}
            disabled={checked.size === 0 || run.isPending}
            className="flex items-center gap-2 px-6 py-2 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {run.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            Extract {checked.size > 0 ? `${checked.size} document${checked.size === 1 ? '' : 's'}` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The rows table for one schema (manage mode). */
function SchemaRows({ schema }: { schema: ExtractionSchema }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<RowStatus | ''>('needs_review');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [extracting, setExtracting] = useState(false);

  const { data: rows, isFetching } = useQuery({
    queryKey: ['extraction-schema', schema.id, 'rows', filter, page],
    queryFn: () => extractionService.rows(schema.id, { status: filter || undefined, page }),
  });

  const review = useMutation({
    mutationFn: ({ rowId, data, reject }: { rowId: number; data?: Record<string, unknown>; reject?: boolean }) =>
      extractionService.review(rowId, { data, reject }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['extraction-schemas'] });
      queryClient.invalidateQueries({ queryKey: ['extraction-schema', schema.id] });
      setEditing(null);
      toast.success(
        res.corrected ? 'Corrected'
          : res.status === 'rejected' ? 'Rejected' : 'Accepted'
      );
    },
    onError: () => toast.error('Could not save that review.'),
  });

  const fieldNames = schema.fields.map((f) => f.name);
  const pageCount = rows ? Math.ceil(rows.count / 50) : 1;

  const startEdit = (row: ExtractedRow) => {
    setEditing(row.id);
    setDraft(Object.fromEntries(fieldNames.map((n) => [n, String(row.data[n] ?? '')])));
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => { setFilter(f.id); setPage(1); }}
            className={cn(
              'px-3 py-1.5 text-[13px] rounded border transition-colors',
              filter === f.id
                ? 'border-primary bg-primary-subtle text-primary font-medium'
                : 'border-border hover:bg-secondary'
            )}
          >
            {f.label}
          </button>
        ))}
        <button
          onClick={() => setExtracting(true)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-[13px] rounded bg-primary text-primary-foreground font-semibold hover:bg-primary/90"
        >
          <Wand2 className="w-3.5 h-3.5" />
          Extract from documents
        </button>
        {isFetching && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      </div>

      {rows && rows.results.length === 0 ? (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground py-8">
          <CheckCircle2 className="w-4 h-4 text-success" />
          {filter === 'needs_review' ? 'Nothing waiting on you.' : 'No rows here yet.'}
        </p>
      ) : (
        <div className="border border-border rounded overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-secondary">
              <tr className="text-left text-[12px] text-muted-foreground">
                <th className="px-3 py-2 font-medium">Document</th>
                {fieldNames.map((n) => (
                  <th key={n} className="px-3 py-2 font-medium">
                    {schema.fields.find((f) => f.name === n)?.label ?? n}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium w-24">Status</th>
                <th className="px-3 py-2 font-medium w-32" />
              </tr>
            </thead>
            <tbody>
              {rows?.results.map((r) => {
                const isEditing = editing === r.id;
                return (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="px-3 py-2 max-w-[200px]">
                      <span className="truncate block">{r.document_name}</span>
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {Math.round(r.confidence * 100)}% confident
                      </span>
                    </td>
                    {fieldNames.map((n) => {
                      const conf = r.field_confidence?.[n];
                      const doubtful = conf !== undefined && conf < schema.confidence_threshold;
                      return (
                        <td key={n} className={cn('px-3 py-2', doubtful && 'bg-destructive-subtle/40')}>
                          {isEditing ? (
                            <input
                              value={draft[n] ?? ''}
                              onChange={(e) => setDraft({ ...draft, [n]: e.target.value })}
                              className="w-full h-8 px-2 rounded border border-input bg-background text-[13px]"
                            />
                          ) : (
                            <>
                              {String(r.data[n] ?? '—')}
                              {doubtful && (
                                <span className="block text-[11px] text-destructive tabular-nums">
                                  {Math.round(conf * 100)}%
                                </span>
                              )}
                            </>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2">
                      <span className={cn('inline-block px-1.5 py-0.5 rounded text-[11px]', rowStatusStyle[r.status])}>
                        {r.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <div className="flex gap-1">
                          <button
                            onClick={() => review.mutate({ rowId: r.id, data: draft })}
                            className="p-1.5 rounded bg-primary text-primary-foreground"
                            aria-label="Save correction"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setEditing(null)}
                            className="p-1.5 rounded border border-border hover:bg-secondary"
                            aria-label="Cancel"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : r.status === 'needs_review' ? (
                        <div className="flex gap-1">
                          <button
                            onClick={() => review.mutate({ rowId: r.id })}
                            className="px-2 py-1 text-[12px] rounded border border-border hover:bg-secondary"
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => startEdit(r)}
                            className="px-2 py-1 text-[12px] rounded border border-border hover:bg-secondary"
                          >
                            Fix
                          </button>
                          <button
                            onClick={() => review.mutate({ rowId: r.id, reject: true })}
                            className="px-2 py-1 text-[12px] rounded border border-border text-destructive hover:bg-destructive-subtle"
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(r)}
                          className="px-2 py-1 text-[12px] rounded border border-border hover:bg-secondary"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows && pageCount > 1 && (
        <div className="flex items-center gap-2 mt-4 text-[13px]">
          <button
            onClick={() => setPage((p) => p - 1)}
            disabled={!rows.previous}
            className="px-3 py-1.5 rounded border border-border hover:bg-secondary disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-muted-foreground tabular-nums">Page {page} of {pageCount}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!rows.next}
            className="px-3 py-1.5 rounded border border-border hover:bg-secondary disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {extracting && <ExtractModal schema={schema} onClose={() => setExtracting(false)} />}
    </div>
  );
}

/** Held rows across every schema — the Inbox review queue. */
function ReviewQueue() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const { data: rows, isLoading } = useQuery({
    queryKey: ['extraction-rows', 'needs_review', page],
    queryFn: () => extractionService.allRows({ status: 'needs_review', page }),
  });

  const review = useMutation({
    mutationFn: ({ rowId, data, reject }: { rowId: number; data?: Record<string, unknown>; reject?: boolean }) =>
      extractionService.review(rowId, { data, reject }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['extraction-rows'] });
      setEditing(null);
      toast.success(
        res.corrected ? 'Corrected'
          : res.status === 'rejected' ? 'Rejected' : 'Accepted'
      );
    },
    onError: () => toast.error('Could not save that review.'),
  });

  const startEdit = (row: ExtractedRow) => {
    setEditing(row.id);
    setDraft(Object.fromEntries(Object.keys(row.data).map((n) => [n, String(row.data[n] ?? '')])));
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm py-12">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading held rows…
      </div>
    );
  }

  const results = rows?.results ?? [];
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-12 h-12 rounded-lg bg-secondary border border-border flex items-center justify-center mb-4">
          <CheckCircle2 className="w-6 h-6 text-success" />
        </div>
        <h3 className="text-lg font-semibold mb-1">No held rows</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          When an extraction is below a schema's confidence threshold it lands here for a
          person to clear. Nothing is waiting.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="border border-border rounded overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-secondary">
            <tr className="text-left text-[12px] text-muted-foreground">
              <th className="px-3 py-2 font-medium">Document</th>
              <th className="px-3 py-2 font-medium">Schema</th>
              <th className="px-3 py-2 font-medium">Extracted values</th>
              <th className="px-3 py-2 font-medium w-24">Confidence</th>
              <th className="px-3 py-2 font-medium w-36" />
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const isEditing = editing === r.id;
              const names = Object.keys(r.data);
              return (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="px-3 py-2 max-w-[220px]">
                    <span className="truncate block">{r.document_name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString()}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-block px-1.5 py-0.5 rounded text-[11px] bg-secondary text-muted-foreground">
                      {r.schema_name}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {isEditing ? (
                      <div className="grid grid-cols-1 gap-1 min-w-[240px]">
                        {names.map((n) => (
                          <div key={n} className="flex items-center gap-2">
                            <span className="text-[11px] text-muted-foreground w-24 truncate">{n}</span>
                            <input
                              value={draft[n] ?? ''}
                              onChange={(e) => setDraft({ ...draft, [n]: e.target.value })}
                              className="w-full h-8 px-2 rounded border border-input bg-background text-[13px]"
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-0.5 min-w-[240px]">
                        {names.map((n) => (
                          <div key={n} className="flex items-center gap-2">
                            <span className="text-[11px] text-muted-foreground w-24 truncate">{n}</span>
                            <span className="text-foreground truncate">{String(r.data[n] ?? '—')}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    <span className="text-[13px] text-destructive font-semibold">
                      {Math.round(r.confidence * 100)}%
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {isEditing ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => review.mutate({ rowId: r.id, data: draft })}
                          className="p-1.5 rounded bg-primary text-primary-foreground"
                          aria-label="Save correction"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setEditing(null)}
                          className="p-1.5 rounded border border-border hover:bg-secondary"
                          aria-label="Cancel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <button
                          onClick={() => review.mutate({ rowId: r.id })}
                          className="px-2 py-1 text-[12px] rounded border border-border hover:bg-secondary"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => startEdit(r)}
                          className="px-2 py-1 text-[12px] rounded border border-border hover:bg-secondary"
                        >
                          Fix
                        </button>
                        <button
                          onClick={() => review.mutate({ rowId: r.id, reject: true })}
                          className="px-2 py-1 text-[12px] rounded border border-border text-destructive hover:bg-destructive-subtle"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows && rows.count > 50 && (
        <div className="flex items-center gap-2 mt-4 text-[13px]">
          <button
            onClick={() => setPage((p) => p - 1)}
            disabled={!rows.previous}
            className="px-3 py-1.5 rounded border border-border hover:bg-secondary disabled:opacity-40"
          >
            Previous
          </button>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!rows.next}
            className="px-3 py-1.5 rounded border border-border hover:bg-secondary disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

export default function ExtractionPanel({ mode }: { mode: 'manage' | 'review' }) {
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['extraction-schemas'],
    queryFn: () => extractionService.listSchemas(),
  });
  const schemas = data?.items ?? [];
  const total = data?.count ?? 0;
  const flagged = schemas.reduce((n, s) => n + s.review_count, 0);
  const selected = schemas.find((s) => s.id === selectedId) ?? schemas[0] ?? null;

  if (mode === 'review') return <ReviewQueue />;

  return (
    <div>
      {creating && <NewSchemaForm onDone={() => setCreating(false)} />}

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-12">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading schemas…
        </div>
      ) : schemas.length === 0 && !creating ? (
        <div className="max-w-md py-12">
          <h2 className="font-semibold mb-1">No schemas yet</h2>
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            A schema is the set of columns you want filled. Define it once, point it at a
            folder or an inbox, and anything the model is unsure about gets held for you
            rather than guessed.
          </p>
          <button
            onClick={() => setCreating(true)}
            className="mt-4 flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded font-semibold text-sm hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            New schema
          </button>
        </div>
      ) : (
        <>
          {flagged > 0 && (
            <div className="mb-4 flex items-center gap-2 text-[13px] text-destructive font-semibold">
              <AlertTriangle className="w-4 h-4" />
              {flagged} row{flagged === 1 ? '' : 's'} waiting on you — the Inbox review tab
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 mb-6">
            {schemas.map((s) => {
              const SrcIcon = sourceIcon[s.source_kind] ?? Upload;
              const active = selected?.id === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className={cn(
                    'block text-left bg-card border rounded p-4 transition-colors',
                    active ? 'border-primary ring-1 ring-primary/30' : 'border-border hover:border-border-strong hover:bg-secondary/40'
                  )}
                >
                  <h3 className="font-semibold mb-1 truncate">{s.name}</h3>
                  <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground mb-3">
                    <SrcIcon className="w-3 h-3" />
                    {sourceLabel[s.source_kind] ?? 'Manual upload'}
                    {s.source_ref && <span className="truncate">· {s.source_ref}</span>}
                  </p>
                  <div className="flex items-center gap-3 text-[12px] text-muted-foreground mb-3">
                    <span>{s.field_count} fields</span>
                    <span className="tabular-nums">{s.row_count.toLocaleString()} rows</span>
                  </div>
                  <div className="pt-3 border-t border-border flex items-center justify-between">
                    {s.review_count > 0 ? (
                      <span className="flex items-center gap-1.5 text-[13px] text-destructive font-semibold">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {s.review_count} need{s.review_count === 1 ? 's' : ''} review
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-[13px] text-success">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Nothing waiting
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <SlidersHorizontal className="w-3 h-3" />
                      {Math.round(s.confidence_threshold * 100)}%
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          <TruncationNotice shown={schemas.length} total={total} />

          {selected ? (
            <div className="bg-card border border-border rounded p-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-primary-subtle border border-primary-line rounded">
                  <ScanText className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold tracking-tight truncate">{selected.name}</h2>
                  <p className="text-[12px] text-muted-foreground">
                    {selected.field_count} fields · rows held below{' '}
                    {Math.round(selected.confidence_threshold * 100)}% confidence
                  </p>
                </div>
              </div>
              <SchemaRows key={selected.id} schema={selected} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}