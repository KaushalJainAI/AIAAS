/**
 * `/p/:slug` — a published page: a report, an HTML page, or a file.
 *
 * Written for a stranger, like `/a/:slug`: no shell, nothing that assumes a
 * session. It asks the public door first; a signed-in visitor whose page is
 * `link` or `platform` is then asked about through the signed-in door. Every
 * refusal is the same "not found" — the API makes them indistinguishable on
 * purpose, and the copy does not try to say why.
 *
 * HTML is never inlined on this origin. It renders inside an iframe whose
 * sandbox allows scripts but *not* same-origin, so the page runs with an
 * opaque origin that cannot read this app's storage or cookies, under a CSP
 * that refuses every network request.
 */
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, Globe, Loader2 } from 'lucide-react';

import authService from '../api/auth';
import pagesService, { type PublishedPage } from '../api/pages';
import ChartArtifact from '../components/chat/ChartArtifact';
import MarkdownMessage from '../components/chat/MarkdownMessage';
import { htmlDocument, splitReport } from '../lib/pageBody';
import { toast } from '../lib/toastStore';

async function load(slug: string): Promise<{ page: PublishedPage; isPublic: boolean }> {
  try {
    return { page: await pagesService.publicGet(slug), isPublic: true };
  } catch (err) {
    if (!authService.isAuthenticated()) throw err;
    return { page: await pagesService.get(slug), isPublic: false };
  }
}

export default function PublishedPageView() {
  const { slug = '' } = useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['published-page', slug],
    queryFn: () => load(slug),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="mb-2 text-lg font-semibold">Not found</h1>
          <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
            This page is not published, or the link is wrong. If someone sent it to you,
            {authService.isAuthenticated() ? ' ask them to check who it is shared with.' : ' try signing in first.'}
          </p>
          <Link to="/" className="text-[13px] text-primary hover:underline">Go to the home page</Link>
        </div>
      </div>
    );
  }

  const { page, isPublic } = data;
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-5 py-10 md:py-14">
        <header className="mb-6 border-b border-border/60 pb-4">
          <h1 className="text-2xl font-bold tracking-tight">{page.title}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Globe className="h-3.5 w-3.5" />
            Published {new Date(page.updated_at).toLocaleDateString()} · a snapshot, not a live document
          </p>
          {/* Transparency (EU AI Act Art. 50, India IT Rules 2026): anyone
              reading a page made here is told it may be AI-generated. */}
          <p className="mt-1 text-[12px] text-muted-foreground">
            Made with an AI assistant: parts of this page may be AI-generated.
          </p>
        </header>
        {page.kind === 'report' && <Report body={page.body} />}
        {page.kind === 'html' && <HtmlPage html={page.body} title={page.title} />}
        {page.kind === 'file' && <FilePage page={page} isPublic={isPublic} />}
      </div>
    </div>
  );
}

function Report({ body }: { body: string }) {
  const parts = useMemo(() => splitReport(body), [body]);
  return (
    <article className="space-y-4">
      {parts.map((part, i) =>
        part.kind === 'chart'
          ? <ChartArtifact key={i} chart={part.chart} />
          : <MarkdownMessage key={i} content={part.text} variant="full" />,
      )}
    </article>
  );
}

function HtmlPage({ html, title }: { html: string; title: string }) {
  const doc = useMemo(() => htmlDocument(html), [html]);
  return (
    <iframe
      // Scripts yes, same-origin no: an opaque origin cannot reach this app.
      sandbox="allow-scripts"
      srcDoc={doc}
      title={title}
      className="block h-[75vh] w-full rounded-md border border-border/60 bg-white"
    />
  );
}

function FilePage({ page, isPublic }: { page: PublishedPage; isPublic: boolean }) {
  const download = async () => {
    try {
      const blob = await pagesService.download(page.slug, isPublic);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = page.file_name || 'file';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Could not download that file.');
    }
  };
  const { data: previewUrl } = useQuery({
    queryKey: ['published-page-preview', page.slug, isPublic],
    queryFn: () => pagesService.previewBlobUrl(page.slug, isPublic),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const name = (page.file_name || '').toLowerCase();
  const isPdf = name.endsWith('.pdf');
  const isImage = /\.(png|jpe?g|gif|webp|svg)$/.test(name);
  return (
    <div className="space-y-3">
      {page.has_file && previewUrl && (isPdf || isImage) && (
        isPdf ? (
          <iframe src={previewUrl} title={page.file_name || 'File'} className="block h-[70vh] w-full rounded-md border border-border/60 bg-white" />
        ) : (
          <img src={previewUrl} alt={page.file_name || 'File'} className="max-h-[70vh] w-full rounded-md border border-border/60 object-contain bg-white" />
        )
      )}
    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-4">
      <FileText className="h-6 w-6 shrink-0 text-primary/80" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{page.file_name || 'File'}</span>
      {page.has_file && (
        <button type="button" onClick={download}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90">
          <Download className="h-3.5 w-3.5" /> Download
        </button>
      )}
    </div>
    </div>
  );
}
