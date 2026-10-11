/**
 * Publish one of your agents for other people to install.
 *
 * Deliberately thin: the listing text is not written here. The one-liner and
 * the longer pitch are read from the agent's own Basics — its `description`
 * and `brief` — so the copy lives in exactly one place and this screen cannot
 * drift from it. What the installer must supply keeps the server-generated
 * labels for the same reason: the publish request omits `requirements`
 * entirely and the server publishes what it generated. The only choice made
 * here is who can find it.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy, Globe, Link2, Loader2, Users, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import templatesService, {
  type ShareVisibility,
  type SharePreview,
} from '../../api/templates';

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
    hint: 'Not listed anywhere.',
    icon: Link2,
  },
  platform: {
    label: 'Everyone on this platform',
    hint: 'Listed on Explore for people with an account here.',
    icon: Users,
  },
  public: {
    label: 'Public — anyone on the internet',
    hint: 'Readable without an account. Installing still needs one.',
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
  agentName,
  brief,
  description,
  preview,
  onClose,
}: {
  agentId: number;
  agentName: string;
  /** The agent's own Basics — the listing copy is read from these, not typed here. */
  brief: string;
  description: string;
  preview: SharePreview;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [visibility, setVisibility] = useState<ShareVisibility>(preview.visibility);
  const [copied, setCopied] = useState(false);

  /* The listing, straight from the agent configuration: the one-line
     `description`, falling back to the preview's tagline (a previous listing
     or the same field) and finally the name, so publish can never hit the
     server's "one-line description required" refusal. The longer pitch is the
     agent's own `brief`. */
  const oneLiner = description.trim() || preview.tagline.trim() || agentName;
  const pitch = brief.trim();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['agent-templates'] });
    queryClient.invalidateQueries({ queryKey: ['agent-share', agentId] });
  };

  const publish = useMutation({
    mutationFn: () =>
      templatesService.publish(agentId, {
        tagline: oneLiner.slice(0, 200),
        description: pitch,
        visibility,
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

  const capabilityCount = Object.values(preview.config.tools ?? {}).filter(Boolean).length;
  const requirementLabels = preview.requirements.map((r) => r.label);

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
        {preview.published && (
          <div className="rounded border border-border bg-secondary/40 p-3">
            <p className="text-[12px] text-muted-foreground mb-2">
              Published · version {preview.version} · {preview.install_count}{' '}
              {preview.install_count === 1 ? 'install' : 'installs'}
              {!preview.is_listed && ' · currently withdrawn'}
            </p>
            <div className="flex items-center gap-2 min-w-0">
              <code className="flex-1 min-w-0 truncate text-[12px] bg-background border border-border rounded px-2 py-1">
                {shareUrl}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(shareUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="p-2 rounded border border-border hover:bg-secondary min-w-[40px] min-h-[40px] inline-flex items-center justify-center shrink-0"
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

        {/* The listing, as installers will see it. Read-only: this copy lives
            on the agent's Basics tab, and editing it here would fork it. */}
        <div className="rounded border border-border p-3">
          <p className="text-[15px] font-semibold">{agentName}</p>
          <p className="text-[13px] text-muted-foreground mt-0.5">{oneLiner}</p>
          {pitch && (
            <p className="text-[12px] text-muted-foreground mt-1.5 line-clamp-3">{pitch}</p>
          )}
          <p className="text-[11px] text-muted-foreground/70 mt-2">
            Taken from the agent&rsquo;s Basics — edit it there.
          </p>
        </div>

        <p className="text-[12px] text-muted-foreground leading-relaxed">
          {capabilityCount} {capabilityCount === 1 ? 'capability' : 'capabilities'}
          {requirementLabels.length > 0
            ? ` · asks the installer for ${requirementLabels.length} ${requirementLabels.length === 1 ? 'thing' : 'things'}: ${requirementLabels.slice(0, 4).join(', ')}${requirementLabels.length > 4 ? '…' : ''}`
            : ' · needs nothing from the installer'}
          . Your connections and documents never travel.
        </p>

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
                    'flex items-center gap-2.5 p-2.5 rounded border cursor-pointer',
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
                  />
                  <span className="flex items-center gap-1.5 text-[13px] font-medium min-w-0">
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    {label}
                    <span className="font-normal text-muted-foreground truncate">{hint}</span>
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
            Anyone will be able to read this agent&rsquo;s instructions without
            signing in. Withdrawing later unlists the page, but does not un-read it.
          </p>
        )}
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 p-4 sm:p-5 border-t border-border">
        {preview.published && preview.is_listed ? (
          <button
            type="button"
            onClick={() => withdraw.mutate()}
            disabled={withdraw.isPending}
            className="text-[12px] text-destructive hover:underline disabled:opacity-50 text-left sm:text-center py-1"
          >
            Withdraw from listing
          </button>
        ) : (
          <span className="hidden sm:block" />
        )}
        <div className="flex items-stretch sm:items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 sm:flex-none px-4 py-2 text-sm rounded border border-border hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={publish.isPending}
            onClick={() => publish.mutate()}
            className="flex-1 sm:flex-none px-4 py-2 bg-primary text-primary-foreground rounded font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
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
  brief = '',
  description = '',
  onClose,
}: {
  agentId: number;
  agentName: string;
  brief?: string;
  description?: string;
  onClose: () => void;
}) {
  const { data: preview, isLoading, isError, error } = useQuery({
    queryKey: ['agent-share', agentId],
    queryFn: () => templatesService.sharePreview(agentId),
    retry: false,
  });

  return (
    <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4">
      <div className="bg-card border border-border rounded-lg shadow-lg w-full max-w-lg max-h-[92dvh] sm:max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 p-4 sm:p-5 border-b border-border">
          <div>
            <h2 className="font-semibold text-base sm:text-lg">Share {agentName}</h2>
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
          <ShareForm
            agentId={agentId}
            agentName={agentName}
            brief={brief}
            description={description}
            preview={preview}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}
