/**
 * Docs on TipTap: a Word file's spec edited as a page you type on.
 *
 * The shell loads the spec (converting an upload first — the original stays
 * version 1), resolves embedded images to blob URLs for display, and owns
 * save state; the view holds the TipTap instance with a normal toolbar. Only
 * this file (and its CSS) pulls in TipTap, and it loads lazily inside the
 * Docs app, so no other page downloads it.
 *
 * The title *is* the file name: committing the title renames the file to
 * match, best-effort. Undo is TipTap's own, so there is no history stack
 * here: Ctrl+Z works because the page owns the keystroke.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Heading1, Heading2, Heading3,
  ImagePlus, Italic, Link2, List, ListOrdered, Quote, Table as TableIcon, Underline as UnderlineIcon,
} from 'lucide-react';

import { documentsService, type Document } from '../../api/documents';
import { apiErrorMessage } from '../../lib/apiError';
import { pruneBlocks, specToTipTap, tipTapToBlocks } from '../../lib/docSpec';
import { downloadBlob } from '../../lib/downloadFile';
import type { Block, DocumentSpec } from '../../lib/officeSpec';
import { officeSpecOf } from '../../lib/officeSpec';
import { toast } from '../../lib/toastStore';
import { Divider, EditorError, EditorLoading, SaveStatus, StaleBanner, ToolButton, Toolbar } from './EditorChrome';
import { useRegisterSave } from './useSave';
import type { EditorProps } from './TextEditors';
import './tiptap.css';

export default function TipTapEditor({ doc, onDirtyChange }: EditorProps) {
  const qc = useQueryClient();
  const [spec, setSpec] = useState<DocumentSpec | null>(null);
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [theme, setTheme] = useState('clean');
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stale, setIsStale] = useState(false);
  const [nonce, setNonce] = useState(0);
  const etag = useRef<string | undefined>(undefined);
  // Counts edits. A save clears `dirty` only if nothing was typed while it
  // was in flight — otherwise those keystrokes would read as saved and be
  // lost when the tab closes.
  const edits = useRef(0);
  const markDirty = useCallback((d: boolean) => {
    if (d) edits.current += 1;
    setDirty(d);
  }, []);
  const { toDisplay, toPath, add: addBlob } = useSpecImages(doc.id, spec);
  const blobs = useMemo(() => ({ toDisplay, toPath }), [toDisplay, toPath]);

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  // Load the spec, converting an upload on first open.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let detail = await documentsService.get(doc.id);
        let found = officeSpecOf(detail.metadata);
        if ((!found || found.kind !== 'document') && doc.file_type === 'docx') {
          setConverting(true);
          const converted = await documentsService.importDoc(doc.id);
          if (!cancelled && converted.warnings?.length) {
            toast.success('Converted to an editable document', converted.warnings.join(' '));
          }
          detail = await documentsService.get(doc.id);
          found = officeSpecOf(detail.metadata);
        }
        if (cancelled) return;
        if (!found || found.kind !== 'document') {
          setFailed('This Word file could not be converted here. Download it to edit it.');
          return;
        }
        etag.current = detail.updated_at;
        setSpec(found);
        setTitle(found.title);
        setSubtitle(found.subtitle);
        setTheme((found as { theme?: string }).theme ?? 'clean');
      } catch (err) {
        if (!cancelled) {
          const message = apiErrorMessage(err, 'Could not open this file.');
          if (converting) setFailed(message);
          else setError(message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setConverting(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // One load per file; `reload` drives refetches through `nonce`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, nonce]);

  const collect = useCallback(
    (getJSON: () => unknown): { title: string; subtitle: string; theme: string; blocks: Block[] } | null => {
      const json = getJSON() as { content?: unknown };
      if (!json || typeof json !== 'object') return null;
      const blocks = pruneBlocks(tipTapToBlocks(
        json as Parameters<typeof tipTapToBlocks>[0],
        { storePath: (src) => blobs.toPath[src] ?? src },
      ));
      return { title: title.trim() || 'Untitled', subtitle, theme, blocks };
    },
    [title, subtitle, theme, blobs],
  );

  const save = useCallback(
    async (getJSON: () => unknown, guard = true): Promise<boolean> => {
      const payload = collect(getJSON);
      if (!payload) return false;
      if (saving) return false;
      if (!payload.blocks.length) {
        toast.error('Write something first', 'A document needs at least one block with text.');
        return false;
      }
      setSaving(true);
      const at = edits.current;
      try {
        const saved = await documentsService.editOffice(doc.id, { spec: payload }, guard ? etag.current : undefined);
        etag.current = saved.updated_at;
        setIsStale(false);
        qc.invalidateQueries({ queryKey: ['documents'] });
        qc.invalidateQueries({ queryKey: ['app-files'] });
        await renameToTitle(doc, payload.title, qc);
        if (edits.current === at) setDirty(false);
        return true;
      } catch (err) {
        if ((err as { response?: { status?: number } })?.response?.status === 412) setIsStale(true);
        else toast.error('Could not save', apiErrorMessage(err, 'Please try again.'));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [collect, doc, qc, saving],
  );

  const draft = useCallback(
    async (getJSON: () => unknown): Promise<boolean> => {
      const payload = collect(getJSON);
      if (!payload || saving) return false;
      setSaving(true);
      const at = edits.current;
      try {
        const saved = await documentsService.saveDraft(doc.id, { spec: payload }, etag.current);
        etag.current = saved.updated_at;
        qc.invalidateQueries({ queryKey: ['documents'] });
        if (edits.current === at) setDirty(false);
        return true;
      } catch (err) {
        if ((err as { response?: { status?: number } })?.response?.status === 412) setIsStale(true);
        else toast.error('Could not autosave', apiErrorMessage(err, 'Please try again.'));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [collect, doc.id, qc, saving],
  );

  if (loading || converting) return <EditorLoading label={converting ? 'Converting to an editable document…' : undefined} />;
  if (error) return <EditorError message={error} />;
  if (failed || !spec) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border/60 bg-muted/40 px-4 py-2 text-[12.5px] text-muted-foreground">
          {failed ?? 'This file opens read-only here.'}{' '}
          <button
            type="button"
            onClick={() => void documentsService.download(doc.id).then((b) => downloadBlob(b, doc.filename))}
            className="font-medium text-primary hover:underline"
          >
            Download it to edit it.
          </button>
        </div>
      </div>
    );
  }
  return (
    <PageView
      key={`${doc.id}:${nonce}`}
      doc={doc}
      spec={spec}
      title={title}
      subtitle={subtitle}
      blobs={blobs}
      dirty={dirty}
      saving={saving}
      stale={stale}
      onTitle={setTitle}
      onSubtitle={setSubtitle}
      onDirty={markDirty}
      onSave={save}
      onDraft={draft}
      onReload={() => {
        setLoading(true);
        setError(null);
        setIsStale(false);
        setDirty(false);
        setNonce((n) => n + 1);
      }}
      onUploadImage={async (file) => {
        const { path } = await documentsService.uploadImage(doc.id, file);
        const url = URL.createObjectURL(await documentsService.assetBlob(doc.id, path));
        addBlob(path, url);
        return url;
      }}
    />
  );
}

/** The title *is* the file name: committing it renames the file to match. */
async function renameToTitle(doc: Document, title: string, qc: ReturnType<typeof useQueryClient>) {
  const dot = doc.filename.lastIndexOf('.');
  const ext = dot > 0 ? doc.filename.slice(dot + 1) : '';
  const stem = dot > 0 ? doc.filename.slice(0, dot) : doc.filename;
  if (!title || title === stem || !ext) return;
  try {
    await documentsService.rename(doc.id, `${title}.${ext}`);
    qc.invalidateQueries({ queryKey: ['app-files'] });
    qc.invalidateQueries({ queryKey: ['documents'] });
  } catch (err) {
    toast.error('Saved, but the file could not be renamed', apiErrorMessage(err, 'Rename it from the File menu.'));
  }
}

/**
 * What the preview shows for a Word file: the same page TipTap draws, with
 * editing off — a file then looks the same previewed and opened.
 */
export function TipTapReadOnly({ docId, spec }: { docId: number; spec: DocumentSpec }) {
  const { toDisplay } = useSpecImages(docId, spec);
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        Underline,
        Link.configure({ openOnClick: false }),
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        Image.configure({ inline: false, allowBase64: false }),
      ],
      content: specToTipTap(spec.blocks, {
        displaySrc: (path) => toDisplay[path] ?? path,
        captions: true,
      }),
      editable: false,
      editorProps: { attributes: { class: 'tiptap-doc' } },
    },
    // Images resolve after mount; their arrival rebuilds the content.
    [docId, spec, toDisplay],
  );

  useEffect(() => () => {
    editor?.destroy();
  }, [editor]);

  if (!editor) return <EditorLoading />;
  return <EditorContent editor={editor} />;
}

/** Spec image paths to blob URLs for display; revoked on unmount. */
function useSpecImages(docId: number, spec: DocumentSpec | null) {
  const [toDisplay, setToDisplay] = useState<Record<string, string>>({});
  const [toPath, setToPath] = useState<Record<string, string>>({});

  // Mounted fresh per file, so the initial empty maps are the reset.
  useEffect(() => {
    const paths = Array.from(new Set(
      (spec?.blocks ?? []).flatMap((b) => (b.type === 'image' ? [b.path] : [])),
    ));
    if (!paths.length) return;
    let cancelled = false;
    Promise.all(paths.map(async (path) => {
      try {
        const url = URL.createObjectURL(await documentsService.assetBlob(docId, path));
        return [path, url] as const;
      } catch {
        return null;
      }
    })).then((entries) => {
      if (cancelled) {
        entries.forEach((e) => e && URL.revokeObjectURL(e[1]));
        return;
      }
      const display: Record<string, string> = {};
      const back: Record<string, string> = {};
      entries.forEach((e) => {
        if (e) {
          display[e[0]] = e[1];
          back[e[1]] = e[0];
        }
      });
      setToDisplay(display);
      setToPath(back);
    });
    return () => {
      cancelled = true;
    };
  }, [docId, spec]);

  useEffect(() => () => {
    Object.values(toDisplay).forEach((url) => URL.revokeObjectURL(url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, spec]);

  const add = useCallback((path: string, url: string) => {
    setToDisplay((prev) => ({ ...prev, [path]: url }));
    setToPath((prev) => ({ ...prev, [url]: path }));
  }, []);

  return { toDisplay, toPath, add };
}

function PageView({
  doc, spec, title, subtitle, blobs, dirty, saving, stale,
  onTitle, onSubtitle, onDirty, onSave, onDraft, onReload, onUploadImage,
}: {
  doc: Document;
  spec: DocumentSpec;
  title: string;
  subtitle: string;
  blobs: { toDisplay: Record<string, string> };
  dirty: boolean;
  saving: boolean;
  stale: boolean;
  onTitle: (v: string) => void;
  onSubtitle: (v: string) => void;
  onDirty: (d: boolean) => void;
  onSave: (getJSON: () => unknown, guard?: boolean) => Promise<boolean>;
  onDraft: (getJSON: () => unknown) => Promise<boolean>;
  onReload: () => void;
  onUploadImage: (file: File) => Promise<string>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        Underline,
        Link.configure({ openOnClick: false }),
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        // Pasted or dropped images arrive as base64, which must never be
        // saved into the spec — the toolbar upload is the way images in.
        Image.configure({ inline: false, allowBase64: false }),
      ],
      content: specToTipTap(spec.blocks, {
        displaySrc: (path) => blobs.toDisplay[path] ?? path,
      }),
      editorProps: { attributes: { class: 'tiptap-doc', 'aria-label': 'Document' } },
      onUpdate: () => onDirty(true),
    },
    [doc.id],
  );

  // The app bar and the unsaved-changes dialog save through this (fully).
  useRegisterSave(
    useCallback(() => onSave(() => editor?.getJSON()), [onSave, editor]),
    dirty,
    saving,
  );

  // Autosave after a quiet pause. The Save button is gone; this is the save.
  useEffect(() => {
    if (!dirty || stale || !editor) return;
    const t = window.setTimeout(() => void onDraft(() => editor.getJSON()), 1500);
    return () => window.clearTimeout(t);
  }, [dirty, stale, editor, onDraft]);

  // Flush the draft when the tab is hidden or closed.
  const draftRef = useRef(onDraft);
  useEffect(() => {
    draftRef.current = onDraft;
  });
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  });
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    const snapshot = () => editorRef.current?.getJSON();
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && dirtyRef.current) void draftRef.current(snapshot);
    };
    const onHide = () => {
      if (dirtyRef.current) void draftRef.current(snapshot);
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  useEffect(() => () => {
    editor?.destroy();
  }, [editor]);

  if (!editor) return <EditorLoading />;

  const openLink = () => {
    setLinkUrl(editor.getAttributes('link').href ?? '');
    setLinkOpen(true);
  };
  const applyLink = () => {
    const href = linkUrl.trim();
    if (href) editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    else editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkOpen(false);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {stale && <StaleBanner onReload={onReload} onOverwrite={() => void onSave(() => editor.getJSON(), false)} />}
      <Toolbar>
        <ToolButton onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Heading 1">
          <Heading1 className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2">
          <Heading2 className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3">
          <Heading3 className="h-4 w-4" />
        </ToolButton>
        <Divider />
        <ToolButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
          <Bold className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
          <Italic className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline">
          <UnderlineIcon className="h-4 w-4" />
        </ToolButton>
        <Divider />
        <ToolButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bulleted list">
          <List className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
          <ListOrdered className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Quote">
          <Quote className="h-4 w-4" />
        </ToolButton>
        <Divider />
        <ToolButton onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align left">
          <AlignLeft className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Align center">
          <AlignCenter className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align right">
          <AlignRight className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="Justify">
          <AlignJustify className="h-4 w-4" />
        </ToolButton>
        <Divider />
        <div className="relative">
          <ToolButton onClick={openLink} active={editor.isActive('link')} title="Link">
            <Link2 className="h-4 w-4" />
          </ToolButton>
          {linkOpen && (
            <div className="absolute left-0 top-full z-30 mt-1 flex w-64 items-center gap-1 rounded-md border border-border/60 bg-popover p-1.5 shadow-lg">
              <input
                autoFocus
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyLink();
                  if (e.key === 'Escape') setLinkOpen(false);
                }}
                placeholder="https://…"
                aria-label="Link address"
                className="min-w-0 flex-1 rounded bg-background px-2 py-1 text-[12.5px] outline-none"
              />
              <button type="button" onClick={applyLink} className="rounded bg-primary px-2 py-1 text-[12px] font-medium text-primary-foreground">
                Apply
              </button>
            </div>
          )}
        </div>
        <ToolButton onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insert table">
          <TableIcon className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().addRowAfter().run()} title="Add row below">
          <span className="text-[11px] font-bold">R+</span>
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().deleteRow().run()} title="Delete row">
          <span className="text-[11px] font-bold">R−</span>
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().addColumnAfter().run()} title="Add column right">
          <span className="text-[11px] font-bold">C+</span>
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().deleteColumn().run()} title="Delete column">
          <span className="text-[11px] font-bold">C−</span>
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().deleteTable().run()} title="Delete table">
          <span className="text-[11px] font-bold">T×</span>
        </ToolButton>
        <ToolButton onClick={() => fileRef.current?.click()} title="Insert image">
          <ImagePlus className="h-4 w-4" />
        </ToolButton>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            onUploadImage(file)
              .then((url) => {
                editor.chain().focus().setImage({ src: url }).run();
              })
              .catch((err) => toast.error('Could not insert the image', apiErrorMessage(err, 'Please try again.')));
          }}
        />
      </Toolbar>
      <div className="min-h-0 flex-1 overflow-auto bg-muted/40 px-2 py-4 sm:px-6 sm:py-8">
        <article className="mx-auto max-w-3xl rounded-sm bg-card px-5 py-8 shadow-md sm:px-12 sm:py-12">
          <input
            value={title}
            onChange={(e) => {
              onTitle(e.target.value.slice(0, 200));
              onDirty(true);
            }}
            placeholder="Title"
            aria-label="Title"
            className="w-full bg-transparent text-2xl font-bold outline-none sm:text-3xl"
          />
          <input
            value={subtitle}
            onChange={(e) => {
              onSubtitle(e.target.value.slice(0, 200));
              onDirty(true);
            }}
            placeholder="Subtitle (optional)"
            aria-label="Subtitle"
            className="mt-1 w-full bg-transparent text-base text-muted-foreground outline-none"
          />
          <div className="mt-4">
            <EditorContent editor={editor} />
          </div>
        </article>
      </div>
      <SaveStatus
        dirty={dirty}
        saving={saving}
        hint="Autosaves as you type"
        extra={<span>Word document</span>}
      />
    </div>
  );
}
