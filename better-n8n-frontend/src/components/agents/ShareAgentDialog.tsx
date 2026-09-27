/**
 * Publish one of your agents for other people to install.
 *
 * The dialog's job is to make the payload visible before it leaves. Publishing
 * is the moment a private configuration becomes something strangers install,
 * and the two things that could go wrong are both silent: an id that travels
 * would point at *your* rows in their account, and a row name that travels
 * ("Q3 payroll") is a fact about your account that you may not want published.
 *
 * So the server previews rather than publishes on open, and this screen shows
 * the whole of what would be sent — the capabilities, the limits, and every
 * requirement your ids became, each labelled with the source row's own name
 * and editable here. Nothing that is not on this screen travels.
 *
 * The form is a separate component taking the loaded preview as a prop, so its
 * fields can be initialised from it directly. Holding them in the outer
 * component would mean an effect copying the query result into state on
 * arrival — a second source of truth that is briefly wrong on first paint, and
 * that silently discards the values a republish is meant to start from if the
 * ordering ever changes.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy, Globe, Link2, Loader2, ShieldCheck, Users, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import templatesService, {
  type ShareVisibility,
  type SharePreview,
} from '../../api/templates';
import { AUTONOMY_COPY, type Autonomy } from '../../types/agentConfig';

const GRANT_COPY: Record<string, string> = {
  webSearch: 'Search the web',
  scrape: 'Open and read web pages',
  codeExecution: 'Run Python in a sandbox',
  fileOps: 'Read and write files',
  office: 'Create PowerPoint, Excel and Word files',
  media: 'Generate images on your OpenRouter account',
  publish: 'Publish pages shareable by link',
  browser: 'Use a web browser on allowed sites',
  rag: 'Search a knowledge base',
  mcp: 'Use connections',
  voice: 'Transcribe audio and speak text',
  esign: 'Send documents for e-signature',
  talk: 'Message on Slack, WhatsApp, Teams, SMS and Telegram',
  data: 'Query databases',
  api: 'Call HTTP APIs',
  compute: 'Run commands on a workspace',
  shell: 'Edit code in projects',
  subAgents: 'Delegate to other agents',
};

/* Three rungs, rendered narrowest first. The order is the point: someone
   scanning a list picks near the top, and the widest option is the one that
   leaves the platform entirely — so it is last, and it says so plainly rather
   than in the language of a feature. */
const VISIBILITY_ORDER: ShareVisibility[] = ['link', 'platform', 'public'];

const VISIBILITY_COPY: Record<
  ShareVisibility,
  { label: string; hint: string; icon: LucideIcon }
> = {
  link: {
    label: 'Anyone with the link',
    hint: 'Not listed anywhere. Only people you send the link to, and they need an account.',
    icon: Link2,
  },
  platform: {
    label: 'Everyone on this platform',
    hint: 'Listed on Explore for people who have an account here.',
    icon: Users,
  },
  public: {
    label: 'Public — anyone on the internet',
    hint: 'Readable without an account at all. The link works for anyone you send it to, and search engines can reach it. Installing still needs an account.',
    icon: Globe,
  },
};

function errorText(err: unknown, fallback: string) {
  return (
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
    fallback
  );
}

function ShareForm({
  agentId,
  preview,
  onClose,
}: {
  agentId: number;
  preview: SharePreview;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [tagline, setTagline] = useState(preview.tagline);
  const [description, setDescription] = useState(preview.description);
  const [visibility, setVisibility] = useState<ShareVisibility>(preview.visibility);
  const [labels, setLabels] = useState<Record<string, string>>(() =>
    Object.fromEntries(preview.requirements.map((r) => [r.key, r.label])),
  );
  const [copied, setCopied] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['agent-templates'] });
    queryClient.invalidateQueries({ queryKey: ['agent-share', agentId] });
  };

  const publish = useMutation({
    mutationFn: () =>
      templatesService.publish(agentId, {
        tagline: tagline.trim(),
        description: description.trim(),
        visibility,
        requirements: preview.requirements.map((r) => ({
          key: r.key,
          label: labels[r.key] ?? r.label,
          why: r.why,
          optional: r.optional,
        })),
      }),
    onSuccess: (entry) => {
      invalidate();
      toast.success(
        entry.version && entry.version > 1
          ? `Republished as version ${entry.version}`
          : 'Published',
      );
      onClose();
    },
    onError: (err) => toast.error(errorText(err, 'Could not publish this agent.')),
  });

  const withdraw = useMutation({
    mutationFn: () => templatesService.unpublish(agentId),
    onSuccess: () => {
      invalidate();
      toast.success('Withdrawn from the listing');
      onClose();
    },
    onError: (err) => toast.error(errorText(err, 'Could not withdraw this listing.')),
  });

  /* Two different links, because they land on two different pages: a public
     share has a page that renders without an account, and handing someone the
     in-app URL instead would bounce them to a login screen — which is exactly
     the thing choosing "public" was meant to avoid. */
  const shareUrl = preview.slug
    ? `${window.location.origin}${visibility === 'public' ? '/a/' : '/templates/'}${preview.slug}`
    : '';

  const grants = Object.entries(preview.config.tools ?? {})
    .filter(([, on]) => on)
    .map(([key]) => GRANT_COPY[key] ?? key);

  return (
    <>
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {preview.published && (
          <div className="rounded border border-border bg-secondary/40 p-3">
            <p className="text-[12px] text-muted-foreground mb-2">
              Published · version {preview.version} · {preview.install_count}{' '}
              {preview.install_count === 1 ? 'install' : 'installs'}
              {!preview.is_listed && ' · currently withdrawn'}
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate text-[12px] bg-background border border-border rounded px-2 py-1">
                {shareUrl}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(shareUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="p-1.5 rounded border border-border hover:bg-secondary"
                aria-label="Copy link"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-agent" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
        )}

        <label className="block">
          <span className="text-[12px] font-semibold text-muted-foreground">
            One line
          </span>
          <input
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            maxLength={200}
            placeholder="What it does, in one sentence."
            className="mt-1 w-full px-3 py-2 bg-background border border-border rounded text-sm"
          />
          <span className="text-[11px] text-muted-foreground">
            The only thing most people read before installing.
          </span>
        </label>

        <label className="block">
          <span className="text-[12px] font-semibold text-muted-foreground">
            Longer description
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="How it works, and when it is the wrong tool."
            className="mt-1 w-full px-3 py-2 bg-background border border-border rounded text-sm resize-y"
          />
        </label>

        <div>
          <span className="text-[12px] font-semibold text-muted-foreground">
            Who can find it
          </span>
          <div className="mt-1 space-y-1.5">
            {VISIBILITY_ORDER.map((v) => {
              const { label, hint, icon: Icon } = VISIBILITY_COPY[v];
              return (
                <label
                  key={v}
                  className={cn(
                    'flex items-start gap-2.5 p-2.5 rounded border cursor-pointer',
                    visibility === v
                      ? 'border-primary bg-primary-subtle'
                      : 'border-border hover:bg-secondary',
                  )}
                >
                  <input
                    type="radio"
                    name="visibility"
                    checked={visibility === v}
                    onChange={() => setVisibility(v)}
                    className="mt-1"
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[13px] font-medium">
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </span>
                    <span className="block text-[12px] text-muted-foreground">
                      {hint}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {visibility === 'public' && (
          /* Said here rather than in the hint above, because this is the one
             choice on this screen that cannot be fully taken back: withdrawing
             unlists the page, and does nothing about a copy someone already
             installed or a page someone already read. */
          <p className="text-[12px] text-muted-foreground border border-border rounded p-2.5 leading-relaxed">
            <ShieldCheck className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
            Anyone will be able to read this agent&rsquo;s instructions,
            capabilities and limits without signing in. Withdrawing later
            unlists the page, but does not un-read it.
          </p>
        )}

        {/* Everything below is what will be sent. It is shown rather than
            summarised because "nothing else travels" is only a promise the
            author can check if they can see the whole payload. */}
        <div>
          <h3 className="text-[12px] font-semibold text-muted-foreground mb-2">
            What people will see it can do
          </h3>
          <ul className="space-y-1 text-[13px]">
            {grants.map((g) => (
              <li key={g} className="flex items-start gap-2">
                <Check className="w-3.5 h-3.5 mt-0.5 text-agent shrink-0" />
                {g}
              </li>
            ))}
            {grants.length === 0 && (
              <li className="text-muted-foreground">No tools at all.</li>
            )}
            <li className="flex items-start gap-2 text-muted-foreground">
              <Globe className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {AUTONOMY_COPY[(preview.config.autonomy ?? 'ask') as Autonomy].hint}
            </li>
          </ul>
        </div>

        {preview.requirements.length > 0 && (
          <div>
            <h3 className="text-[12px] font-semibold text-muted-foreground mb-1">
              What they will be asked to supply
            </h3>
            <p className="text-[12px] text-muted-foreground mb-2 leading-relaxed">
              Your connections and documents do not travel — each becomes a slot
              the installer fills from their own. These labels are taken from
              your rows' names, so rename any you would rather not publish.
            </p>
            <div className="space-y-2">
              {preview.requirements.map((req) => (
                <div key={req.key} className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground w-28 shrink-0">
                    {req.type.replace('_', ' ')}
                  </span>
                  <input
                    value={labels[req.key] ?? req.label}
                    onChange={(e) =>
                      setLabels((prev) => ({ ...prev, [req.key]: e.target.value }))
                    }
                    className="flex-1 px-2 py-1.5 bg-background border border-border rounded text-[13px]"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 p-5 border-t border-border">
        {preview.published && preview.is_listed ? (
          <button
            type="button"
            onClick={() => withdraw.mutate()}
            disabled={withdraw.isPending}
            className="text-[12px] text-destructive hover:underline disabled:opacity-50"
          >
            Withdraw from listing
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded border border-border hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={publish.isPending || !tagline.trim()}
            onClick={() => publish.mutate()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {publish.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {preview.published ? 'Republish' : 'Publish'}
          </button>
        </div>
      </div>
    </>
  );
}

export default function ShareAgentDialog({
  agentId,
  agentName,
  onClose,
}: {
  agentId: number;
  agentName: string;
  onClose: () => void;
}) {
  const { data: preview, isLoading, isError, error } = useQuery({
    queryKey: ['agent-share', agentId],
    queryFn: () => templatesService.sharePreview(agentId),
    retry: false,
  });

  return (
    <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-lg shadow-lg w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 p-5 border-b border-border">
          <div>
            <h2 className="font-semibold text-lg">Share {agentName}</h2>
            <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">
              People install a copy into their own account and point it at their
              own connections. Nothing of yours travels with it — no credentials,
              no documents, no runs.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-secondary text-muted-foreground shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm p-5">
            <Loader2 className="w-4 h-4 animate-spin" />
            Working out what would be shared…
          </div>
        ) : isError || !preview ? (
          /* The message the server would have given on publish, shown up front:
             a preview fails when the agent points at a row it can no longer
             see, and the fix for that is in the builder rather than here. */
          <div className="p-5">
            <p className="text-[13px] text-destructive leading-relaxed">
              {errorText(error, 'Could not read this agent.')}
            </p>
          </div>
        ) : (
          <ShareForm agentId={agentId} preview={preview} onClose={onClose} />
        )}
      </div>
    </div>
  );
}
