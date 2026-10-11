/**
 * Share a file: make a link, hand it to someone, or send a copy.
 *
 * A link is a published snapshot (`pagesService.shareFile`), so what a reader
 * sees is the file as it was when the link was made — the dialog says so,
 * because "I fixed the typo, why do they still see it" is the question a
 * live-looking link invites. Links already made for this file are listed with
 * a way to stop each one, so sharing is never a one-way door.
 *
 * It starts on the narrowest audience. The same dialog serves every app's
 * Share button, the File menu and the preview header.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check, Copy, ExternalLink, Globe, Link2, Loader2, Lock, Mail, Send, Share2, Users, X,
} from 'lucide-react';

import type { Document } from '../../api/documents';
import { documentsService } from '../../api/documents';
import pagesService, { type PageVisibility, type PublishedPage } from '../../api/pages';
import { apiErrorMessage } from '../../lib/apiError';
import { downloadBlob } from '../../lib/downloadFile';
import {
  AUDIENCES, DEFAULT_AUDIENCE, audienceLabel, mailtoLink, pageUrl, shareTitle,
} from '../../lib/share';
import { toast } from '../../lib/toastStore';
import { cn } from '../../lib/utils';

const AUDIENCE_ICON: Record<PageVisibility, typeof Lock> = { link: Lock, platform: Users, public: Globe };

interface Props {
  doc: Document;
  onClose: () => void;
  /** Save pending edits first, so the snapshot is what is on screen. False cancels. */
  beforeShare?: () => Promise<boolean>;
}

export default function ShareDialog({ doc, onClose, beforeShare }: Props) {
  const qc = useQueryClient();
  const [audience, setAudience] = useState<PageVisibility>(DEFAULT_AUDIENCE);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [created, setCreated] = useState<PublishedPage | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const mine = useQuery({
    queryKey: ['pages', 'mine'],
    queryFn: () => pagesService.list(),
    staleTime: 15_000,
  });
  // Pages do not record which file they came from, so earlier links are
  // matched on the file's name — said in the heading, since two files can
  // share one.
  const earlier = (mine.data?.results ?? []).filter(
    (p) => p.kind === 'file' && p.is_listed !== false && p.file_name === doc.filename && p.slug !== created?.slug,
  );

  const urlOf = (page: PublishedPage) => pageUrl(page.slug, window.location.origin);
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async (page: PublishedPage) => {
    try {
      await navigator.clipboard.writeText(urlOf(page));
      setCopied(page.slug);
      window.setTimeout(() => setCopied((c) => (c === page.slug ? null : c)), 1600);
    } catch {
      toast.error('Could not copy', 'Select the link and copy it by hand.');
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      if (beforeShare && !(await beforeShare())) {
        toast.error('Save the file first', 'Your latest changes could not be saved, so nothing was shared.');
        return;
      }
      const page = await pagesService.shareFile(doc.id, shareTitle(doc.filename), audience);
      setCreated(page);
      qc.invalidateQueries({ queryKey: ['pages'] });
      try {
        await navigator.clipboard.writeText(urlOf(page));
        setCopied(page.slug);
        window.setTimeout(() => setCopied((c) => (c === page.slug ? null : c)), 1600);
      } catch {
        // The link is on screen with its own Copy button.
      }
    } catch (err) {
      toast.error('Could not create the link', apiErrorMessage(err, 'Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const nativeShare = async (page: PublishedPage) => {
    try {
      await navigator.share({ title: doc.filename, url: urlOf(page) });
    } catch {
      // Closing the share sheet rejects; there is nothing to report.
    }
  };

  /** The file itself, through the device's share sheet where it takes files. */
  const sendCopy = async () => {
    setSending(true);
    try {
      if (beforeShare) await beforeShare();
      const blob = await documentsService.download(doc.id);
      const file = new File([blob], doc.filename, { type: blob.type || 'application/octet-stream' });
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: doc.filename });
        } catch {
          // Closed without sending.
        }
      } else {
        downloadBlob(blob, doc.filename);
        toast.success('Downloaded', 'Attach it to a message to send it.');
      }
    } catch (err) {
      toast.error('Could not get the file', apiErrorMessage(err, 'Please try again.'));
    } finally {
      setSending(false);
    }
  };

  const stop = async (page: PublishedPage) => {
    setStopping(page.slug);
    try {
      await pagesService.withdraw(page.slug);
      if (created?.slug === page.slug) setCreated(null);
      qc.invalidateQueries({ queryKey: ['pages'] });
      toast.success('Link stopped', 'It no longer opens for anyone.');
    } catch (err) {
      toast.error('Could not stop the link', apiErrorMessage(err, 'Please try again.'));
    } finally {
      setStopping(null);
    }
  };

  const action = 'inline-flex h-9 items-center gap-1.5 rounded-md border border-border/60 px-3 text-[13px] hover:bg-muted disabled:opacity-50';

  return createPortal(
    <div
      className="overlay z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Share ${doc.filename}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-xl border border-border bg-card shadow-xl sm:rounded-xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <Share2 className="h-4 w-4 shrink-0 text-primary" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">Share “{doc.filename}”</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-auto px-4 py-4">
          {created ? (
            <section aria-label="Your link">
              <p className="mb-2 flex items-center gap-1.5 text-[13px] font-medium">
                <Check className="h-4 w-4 text-success" /> Link ready · {audienceLabel(created.visibility)}
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={urlOf(created)}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Share link"
                  className="h-10 min-w-0 flex-1 rounded-md border border-border/60 bg-background px-3 font-mono text-[12.5px] outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => void copy(created)}
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
                >
                  {copied === created.slug ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied === created.slug ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {canNativeShare && (
                  <button type="button" onClick={() => void nativeShare(created)} className={action}>
                    <Send className="h-4 w-4" /> Send with…
                  </button>
                )}
                <a href={mailtoLink(doc.filename, urlOf(created))} className={cn(action, 'no-underline text-foreground')}>
                  <Mail className="h-4 w-4" /> Email
                </a>
                <a href={urlOf(created)} target="_blank" rel="noopener noreferrer" className={cn(action, 'no-underline text-foreground')}>
                  <ExternalLink className="h-4 w-4" /> Open
                </a>
                <button type="button" onClick={() => setCreated(null)} className={action}>
                  <Link2 className="h-4 w-4" /> Make another
                </button>
                <button
                  type="button"
                  onClick={() => void stop(created)}
                  disabled={stopping === created.slug}
                  className={cn(action, 'text-destructive hover:bg-destructive/10')}
                >
                  Stop sharing
                </button>
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
                The link shows the file as it is right now. If you change the file, share it again to send the new version.
              </p>
            </section>
          ) : (
            <section aria-label="Create a link">
              <p className="mb-2 text-[13px] font-medium">Who can open the link</p>
              <div className="space-y-1.5" role="radiogroup" aria-label="Who can open the link">
                {AUDIENCES.map((option) => {
                  const Icon = AUDIENCE_ICON[option.value];
                  const active = audience === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setAudience(option.value)}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                        active ? 'border-primary bg-primary/5' : 'border-border/60 hover:bg-muted/60',
                      )}
                    >
                      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium">{option.label}</span>
                        <span className="block text-[12px] text-muted-foreground">{option.detail}</span>
                      </span>
                      <span
                        aria-hidden
                        className={cn(
                          'mt-1 h-3.5 w-3.5 shrink-0 rounded-full border',
                          active ? 'border-primary bg-primary shadow-[inset_0_0_0_2.5px_hsl(var(--card))]' : 'border-border',
                        )}
                      />
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => void create()}
                disabled={busy}
                className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                {busy ? 'Creating the link…' : 'Create link and copy it'}
              </button>
            </section>
          )}

          <section aria-label="Send a copy" className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5">
            <Send className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium">Send a copy instead</span>
              <span className="block text-[12px] text-muted-foreground">The file itself, through your device&apos;s apps. No link is made.</span>
            </span>
            <button type="button" onClick={() => void sendCopy()} disabled={sending} className={action}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Send file
            </button>
          </section>

          {earlier.length > 0 && (
            <section aria-label="Links already made">
              <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">
                Links already made for a file with this name
              </p>
              <ul className="m-0 list-none space-y-1 p-0">
                {earlier.map((page) => (
                  <li key={page.slug} className="flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px]">{audienceLabel(page.visibility)}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        Made {new Date(page.created_at ?? page.updated_at).toLocaleDateString()}
                      </span>
                    </span>
                    <button type="button" onClick={() => void copy(page)} className="rounded-md px-2 py-1.5 text-[12px] text-primary hover:bg-muted">
                      {copied === page.slug ? 'Copied' : 'Copy link'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void stop(page)}
                      disabled={stopping === page.slug}
                      className="rounded-md px-2 py-1.5 text-[12px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    >
                      {stopping === page.slug ? 'Stopping…' : 'Stop sharing'}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
