/**
 * Connections — Plugins & their Connectors.
 *
 * Vocabulary (see Tools page for the full split):
 *  Tool      = one callable function the model can invoke — the standard library
 *              lives on /tools (code-owned, grouped by grant like webSearch/rag).
 *  Plugin    = an external MCP pack (MCPServer row) that brings its own
 *              mcp__* tools at runtime — listed here. Needs a Connector to work.
 *  Connector = credential/connection info that lets a plugin act as you
 *              (Google OAuth on Credentials, Slack token, etc.) — wired per
 *              plugin on this page. Without it, the plugin's tools never appear
 *              to the model even when the plugin is "on".
 *
 * This page used to be two pages ("Tools" /mcp-servers and "Data sources"
 * /connectors) that were views of the same two tables; they are now one page
 * with clear section headings (Plugins above, Connectors wiring inline).
 * Standard tools are not configured here — see /tools for the code-owned library.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Plug,
  Plus,
  Settings2,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  credentialsService,
  type Credential,
  type CredentialFieldSchema,
  type CredentialType,
} from '../api/credentials';
import { mcpService, MCPToolsError, type MCPServer, type MCPServerCategory } from '../api/mcp';
import MCPServerModal from '../components/mcp/MCPServerModal';
import HeldToolsPanel from '../components/mcp/HeldToolsPanel';
import MessagingChannels from '../components/messaging/MessagingChannels';
import PageHeader from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Loading';
import {
  CATEGORY_BLURBS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  connectorVisual,
} from '../lib/connectorIcons';
import { googleScopesFor } from '../lib/googleScopes';
import { markMcpOAuthFlow, openOAuthPopup } from '../lib/oauthPopup';
import { cn } from '../lib/utils';

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * `always` — needs no credential, so it works out of the box.
 * `connected` / `needs_auth` — every required credential is present, or is not.
 * `off` — the user switched it off; nothing else matters until they switch it on.
 * `unavailable` — the *platform* switched it off. Distinct from `off` because
 *   the two need opposite affordances: `off` is undone by flipping the switch
 *   back, while `unavailable` is not a choice the user has at all. Collapsing
 *   them is what produced a live-looking toggle that silently did nothing.
 * `coming_soon` — also platform-off, but on the way rather than broken. Same
 *   inert affordance as `unavailable`, opposite reading: "Unavailable" tells a
 *   user something is wrong, and these connectors are simply not built yet.
 *   Driven by the row's own `coming_soon` flag, never by its name.
 */
type ConnectionStatus =
  | 'always'
  | 'connected'
  | 'needs_auth'
  | 'off'
  | 'unavailable'
  | 'coming_soon';

interface StatusView {
  label: string;
  dot: string;
  badge: string;
}

const STATUS_VIEWS: Record<ConnectionStatus, StatusView> = {
  always: {
    label: 'Ready',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  },
  connected: {
    label: 'Connected',
    dot: 'bg-primary',
    badge: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  },
  needs_auth: {
    label: 'Not connected',
    dot: 'bg-muted-foreground/30',
    badge: 'bg-muted/60 text-muted-foreground border-border/40',
  },
  off: {
    label: 'Off',
    dot: 'bg-muted-foreground/30',
    badge: 'bg-muted/60 text-muted-foreground border-border/40',
  },
  unavailable: {
    label: 'Unavailable',
    dot: 'bg-amber-400/60',
    badge: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  },
  coming_soon: {
    label: 'Coming soon',
    dot: 'bg-sky-400/60',
    badge: 'bg-sky-500/10 text-sky-600 border-sky-500/20',
  },
};

// ---------------------------------------------------------------------------
// Connect modal
// ---------------------------------------------------------------------------

interface ConnectModalProps {
  server: MCPServer;
  credType: CredentialType;
  onClose: () => void;
  onConnected: () => void;
  alreadyHeld: boolean;
}

function ConnectModal({
  server,
  credType,
  onClose,
  onConnected,
  alreadyHeld,
}: ConnectModalProps) {
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { icon: Icon, color } = connectorVisual(server.icon_slug, server.is_system);
  const isOAuth = credType.auth_method === 'oauth2';

  /**
   * OAuth in a popup. This is the path that decides whether a non-technical user
   * can use Google at all: the alternative is sending them to Google Cloud
   * Console to mint an OAuth client, which is where they stop. The popup lands on
   * /oauth/callback, which finishes the exchange and messages us back.
   */
  const handleOAuth = async () => {
    setError(null);
    const redirectUri = `${window.location.origin}/oauth/callback`;
    let url: string;
    try {
      setSaving(true);
      // Ask only for what this connection needs, so the consent screen is
      // honest and the resulting token can actually do the job.
      ({ url } = await credentialsService.initGoogleOAuth(
        redirectUri,
        googleScopesFor(server.icon_slug)
      ));
    } catch {
      setSaving(false);
      setError('Could not start the sign-in flow. Please try again.');
      return;
    }

    const width = 600;
    const height = 700;
    const popup = window.open(
      url,
      'Connect account',
      `width=${width},height=${height},` +
        `top=${window.screen.height / 2 - height / 2},` +
        `left=${window.screen.width / 2 - width / 2}`
    );

    if (!popup) {
      setSaving(false);
      setError('Your browser blocked the sign-in window. Allow pop-ups and try again.');
      return;
    }

    // Resolve on either outcome, and also if the user simply closes the window —
    // otherwise the modal sits on a spinner forever with no way back.
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(closedTimer);
      setSaving(false);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'OAUTH_SUCCESS') {
        cleanup();
        toast.success(`${server.label} connected`);
        onConnected();
        onClose();
      } else if (event.data?.type === 'OAUTH_ERROR') {
        cleanup();
        setError(event.data.message || 'Sign-in did not complete.');
      }
    };
    const closedTimer = window.setInterval(() => {
      if (popup.closed) cleanup();
    }, 500);
    window.addEventListener('message', onMessage);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    for (const field of credType.fields_schema) {
      if (field.required && !formData[field.name]?.trim()) {
        setError(`"${field.label}" is required.`);
        return;
      }
    }

    try {
      setSaving(true);
      await credentialsService.create({
        name: `${server.label} — ${new Date().toLocaleDateString()}`,
        credential_type: credType.id,
        data: formData,
      });
      toast.success(`${server.label} connected`);
      onConnected();
      onClose();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail;
      setError(detail ?? 'Could not save. Check the values and try again.');
    } finally {
      setSaving(false);
    }
  };

  const toggleShow = (name: string) =>
    setShowValues((prev) => ({ ...prev, [name]: !prev[name] }));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative bg-card border border-border rounded-lg shadow-lg w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center gap-4 p-6 border-b border-border/60">
          <div className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 bg-muted/60">
            <Icon style={{ color }} className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-lg text-foreground">Connect {server.label}</h2>
            {server.tagline && (
              <p className="text-xs text-muted-foreground mt-0.5">{server.tagline}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-muted rounded-lg transition-colors text-muted-foreground"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isOAuth ? (
          <div className="p-6 space-y-4">
            {alreadyHeld && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm text-blue-500">
                <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>
                  Your Google account is already connected — signing in again replaces it.
                </span>
              </div>
            )}
            <p className="text-sm text-muted-foreground leading-relaxed">
              Sign in with Google to authorise access. You will see exactly which
              permissions are requested before you approve, and you can disconnect
              here at any time.
            </p>
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <Button
              onClick={handleOAuth}
              disabled={saving}
              loading={saving}
              className="w-full"
            >
              {!saving && 'Sign in with Google'}
              {saving && <>Waiting for Google…</>}
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {credType.fields_schema.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No setup needed — this works right away.
              </p>
            ) : (
              credType.fields_schema.map((field: CredentialFieldSchema) => (
                <div key={field.name}>
                  <label className="block text-sm font-semibold text-foreground mb-1.5">
                    {field.label}
                    {field.required && <span className="text-destructive ml-1">*</span>}
                  </label>
                  <div className="relative">
                    <input
                      type={
                        field.type === 'password' && !showValues[field.name]
                          ? 'password'
                          : 'text'
                      }
                      value={formData[field.name] ?? ''}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, [field.name]: e.target.value }))
                      }
                      placeholder={field.placeholder ?? ''}
                      className="w-full px-4 py-2.5 bg-background border border-border/60 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm font-mono pr-10"
                      autoComplete="off"
                    />
                    {field.type === 'password' && (
                      <button
                        type="button"
                        onClick={() => toggleShow(field.name)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={showValues[field.name] ? 'Hide value' : 'Show value'}
                      >
                        {showValues[field.name] ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}

            {server.help_url && (
              <a
                href={server.help_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                Where do I find this?
              </a>
            )}

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 rounded-lg border border-border/60 text-sm font-semibold hover:bg-muted/50 transition-colors"
              >
                Cancel
              </button>
              <Button
                type="submit"
                disabled={saving || credType.fields_schema.length === 0}
                loading={saving}
                className="flex-1"
              >
                {!saving && <>Connect</>}
                {saving && <>Saving…</>}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Capability list
// ---------------------------------------------------------------------------

/** Turn an MCP tool name into something readable: `search_files` → `Search files`. */
function humanizeToolName(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/**
 * What this connection actually lets the assistant do, asked of the server
 * itself. Fetched only when opened: listing tools starts a real MCP session, so
 * doing it for every card on mount would spawn a subprocess per connector.
 */
function CapabilityList({ server }: { server: MCPServer }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['mcpServerTools', server.id],
    queryFn: () => mcpService.getTools(server.id),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="w-3 h-3 animate-spin" />
        Checking what this can do…
      </div>
    );
  }

  if (error || !data) {
    const reason = error instanceof MCPToolsError ? error : null;
    return (
      <div className="py-2 space-y-1">
        <p className="text-xs text-muted-foreground">
          {reason?.isCredentialProblem
            ? 'Connect an account to see what this can do.'
            : "Couldn't load what this connection can do."}
        </p>
        {reason && (
          // The backend's own words. A generic failure line tells the user
          // nothing they can act on, and this is the only place the reason —
          // an expired token, a package that will not start — is ever shown.
          <p className="text-[11px] leading-relaxed text-muted-foreground/70 break-words">
            {reason.message}
          </p>
        )}
      </div>
    );
  }

  if (data.tools.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">This connection didn't report any tools.</p>;
  }

  return (
    <ul className="py-2 space-y-1.5">
      {data.tools.map((tool) => (
        <li key={tool.name} className="flex items-start gap-2 text-xs">
          <Check className="w-3 h-3 mt-0.5 text-emerald-500 flex-shrink-0" />
          <span className="text-foreground/90">
            {humanizeToolName(tool.name)}
            {tool.description && (
              <span className="text-muted-foreground"> — {tool.description}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Connection card
// ---------------------------------------------------------------------------

/**
 * The connection on/off switch.
 *
 * Track is flex + padding rather than a positioned knob: an `absolute` child of
 * a <button> with no `left` falls back to its static position, and Chrome
 * centres button contents, so the knob started mid-track and `translate-x-4`
 * threw it clear of the pill. Padding centres it instead, and every length here
 * is rem, so the geometry survives our 14px root font-size.
 */
function ConnectionSwitch({
  isOn,
  onToggle,
  disabled,
  label,
}: {
  isOn: boolean;
  onToggle: (enabled: boolean) => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      onClick={() => onToggle(!isOn)}
      disabled={disabled}
      role="switch"
      aria-checked={isOn}
      aria-label={`${isOn ? 'Turn off' : 'Turn on'} ${label}`}
      className={cn(
        'inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        'focus-visible:ring-offset-2 focus-visible:ring-offset-card',
        'disabled:opacity-50',
        isOn ? 'bg-primary' : 'bg-muted-foreground/30'
      )}
    >
      <span
        className={cn(
          'h-4 w-4 shrink-0 rounded-full bg-white shadow-sm transition-transform',
          isOn ? 'translate-x-4' : 'translate-x-0'
        )}
      />
    </button>
  );
}

interface ConnectionCardProps {
  server: MCPServer;
  status: ConnectionStatus;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggle: (enabled: boolean) => void;
  busy: boolean;
}

function ConnectionCard({
  server,
  status,
  onConnect,
  onDisconnect,
  onToggle,
  busy,
}: ConnectionCardProps) {
  const [showCapabilities, setShowCapabilities] = useState(false);
  const { icon: Icon, color } = connectorVisual(server.icon_slug, server.is_system);
  const view = STATUS_VIEWS[status];
  const isOn = server.effective_enabled;
  // Turned off by the platform, not by this user: the switch is not theirs to
  // flip, and the API answers 409 if we ask. Render it inert and say why.
  // Both platform-off statuses qualify -- an upcoming connector is just as
  // un-flippable as a broken one, so this must not narrow to 'unavailable'.
  const platformOff = status === 'unavailable' || status === 'coming_soon';
  // Only worth asking the server what it can do once it could actually answer.
  const canShowCapabilities = isOn && (status === 'always' || status === 'connected');

  return (
    <div
      className={cn(
        'bg-card border rounded-lg p-5 flex flex-col gap-4 transition-colors duration-150',
        isOn ? 'border-border/60' : 'border-dashed border-border/50 opacity-70'
      )}
    >
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 bg-muted/60">
          <Icon style={{ color }} className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-foreground leading-tight truncate">
            {server.label}
          </p>
          {server.tagline && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
              {server.tagline}
            </p>
          )}
        </div>
        {/* Per-user switch. Curated rows are shared, so this writes a preference
            rather than editing the row — see mcpService.setEnabled. Disabled
            outright when the platform turned the row off: a switch that cannot
            move is honest, one that moves and springs back is not. */}
        <ConnectionSwitch
          isOn={isOn}
          onToggle={onToggle}
          disabled={busy || platformOff}
          label={server.label}
        />
      </div>

      {/* `setup_notes` is written by the catalogue migrations to explain exactly
          this state, and was fetched but never rendered — so every dead card
          was dead for a reason no user could read. */}
      {platformOff && server.setup_notes && (
        <p className="text-xs text-muted-foreground leading-relaxed border-l-2 border-amber-500/30 pl-3">
          {server.setup_notes}
        </p>
      )}

      {canShowCapabilities && (
        <div className="border-t border-border/40 pt-2">
          <button
            onClick={() => setShowCapabilities((v) => !v)}
            className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            {showCapabilities ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            What it can do
          </button>
          {showCapabilities && <CapabilityList server={server} />}
        </div>
      )}

      <div className="flex items-center justify-between mt-auto pt-3 border-t border-border/40">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-full border',
            isOn || platformOff ? view.badge : STATUS_VIEWS.off.badge
          )}
        >
          <span
            className={cn(
              'w-1.5 h-1.5 rounded-full flex-shrink-0',
              isOn || platformOff ? view.dot : STATUS_VIEWS.off.dot
            )}
          />
          {isOn || platformOff ? view.label : STATUS_VIEWS.off.label}
        </span>

        {status === 'needs_auth' && (
          <button
            onClick={onConnect}
            className="text-xs font-bold text-primary hover:underline"
          >
            Connect
          </button>
        )}
        {status === 'connected' && (
          <button
            onClick={onDisconnect}
            disabled={busy}
            className="text-xs font-bold text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
          >
            {busy ? 'Disconnecting…' : 'Disconnect'}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Advanced: the user's own MCP servers
// ---------------------------------------------------------------------------

/**
 * Sign in to a remote MCP server.
 *
 * Offered for any remote server with a URL, because knowing whether one
 * genuinely speaks OAuth needs two discovery fetches and doing that per row
 * would put a dozen network calls behind this page. A server that turns out not
 * to support it says so on click — `oauth/init` answers `oauth_unavailable`
 * with the reason, which is more useful than a button that was never shown.
 */
function OAuthConnectButton({ server }: { server: MCPServer }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['mcpServers'] });

  const connect = async () => {
    setBusy(true);
    try {
      const redirectUri = `${window.location.origin}/oauth/callback`;
      const { url } = await mcpService.oauthInit(server.id, redirectUri);
      // Recorded before the popup opens: /oauth/callback has no other way to
      // know which flow it is finishing, since the provider owns the URL.
      markMcpOAuthFlow(server.id);
      const result = await openOAuthPopup(url, `Connect ${server.label}`);
      if (result.status === 'success') {
        toast.success(`${server.label} connected`);
        refresh();
      } else if (result.status === 'error') {
        toast.error('Could not connect', { description: result.message });
      }
      // 'dismissed' is the user changing their mind — not worth a toast.
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error('Could not start sign-in', { description: detail });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await mcpService.oauthDisconnect(server.id);
      toast.success(`${server.label} disconnected`);
      refresh();
    } catch {
      toast.error('Could not disconnect');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={server.oauth_connected ? disconnect : connect}
      disabled={busy}
      className={cn(
        'px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 whitespace-nowrap',
        server.oauth_connected
          ? 'text-muted-foreground hover:bg-muted'
          : 'bg-primary/10 text-primary hover:bg-primary/20',
      )}
    >
      {busy ? '…' : server.oauth_connected ? 'Disconnect' : 'Sign in'}
    </button>
  );
}

function CustomServerRow({
  server,
  onEdit,
  onDelete,
  onToggle,
  busy,
}: {
  server: MCPServer;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  busy: boolean;
}) {
  const isOn = server.effective_enabled;
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-card border border-border/60 rounded-lg">
      <Terminal className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{server.label}</p>
        <p className="text-xs text-muted-foreground font-mono truncate">
          {server.type === 'stdio'
            ? [server.command, ...(server.args ?? [])].filter(Boolean).join(' ')
            : server.url}
        </p>
      </div>
      {server.supports_oauth && <OAuthConnectButton server={server} />}
      <ConnectionSwitch isOn={isOn} onToggle={onToggle} disabled={busy} label={server.label} />
      <button
        onClick={onEdit}
            className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Edit ${server.label}`}
      >
        <Settings2 className="w-4 h-4" />
      </button>
      <button
        onClick={onDelete}
        className="p-1.5 hover:bg-destructive/10 rounded-lg text-muted-foreground hover:text-destructive transition-colors"
        aria-label={`Remove ${server.label}`}
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Connections() {
  const queryClient = useQueryClient();
  const [connecting, setConnecting] = useState<MCPServer | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<MCPServer | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MCPServer | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const serversQuery = useQuery({
    queryKey: ['mcpServers'],
    queryFn: () => mcpService.list(),
    staleTime: 5 * 60 * 1000,
  });
  const credsQuery = useQuery({
    queryKey: ['credentials'],
    queryFn: () => credentialsService.list(),
    staleTime: 60 * 1000,
  });
  const typesQuery = useQuery({
    queryKey: ['credentialTypes'],
    queryFn: () => credentialsService.getTypes(),
    staleTime: 10 * 60 * 1000,
  });
  // Memoised because the `?? []` fallback would otherwise be a fresh array every
  // render, invalidating every useMemo downstream of it.
  const servers = useMemo(
    () => serversQuery.data?.servers ?? [],
    [serversQuery.data]
  );

  /**
   * Whether each connection's credentials actually resolve. `validate_credentials`
   * is a dry run (DB + decryption, no subprocess spawn), so it is safe to ask
   * for every server in parallel on page load — and it is what keeps "Connected"
   * honest: row existence is checked by `statusOf`'s fallback, but a mistyped
   * map entry or an expired OAuth token would otherwise show Connected while the
   * agent silently never saw the server's tools.
   */
  const validationQuery = useQuery({
    queryKey: ['mcpValidation'],
    queryFn: async () => {
      const entries = await Promise.all(
        servers.map(
          async (s): Promise<readonly [number, { ok: boolean; errors: string[] }]> => {
            try {
              return [s.id, await mcpService.validateCredentials(s.id)];
            } catch {
              return [s.id, { ok: false, errors: ['Could not check this connection.'] }];
            }
          }
        )
      );
      return new Map(entries);
    },
    enabled: servers.length > 0,
    staleTime: 60 * 1000,
  });

  const isLoading =
    serversQuery.isLoading || credsQuery.isLoading || typesQuery.isLoading;

  const credTypeBySlug = useMemo(() => {
    const map = new Map<string, CredentialType>();
    (typesQuery.data?.types ?? []).forEach((ct) => map.set(ct.slug, ct));
    return map;
  }, [typesQuery.data]);

  const credByTypeId = useMemo(() => {
    const map = new Map<number, Credential>();
    (credsQuery.data?.credentials ?? []).forEach((c) => {
      const existing = map.get(c.credential_type);
      if (!existing || new Date(c.updated_at) > new Date(existing.updated_at)) {
        map.set(c.credential_type, c);
      }
    });
    return map;
  }, [credsQuery.data]);

  /** Credentials this server needs that the user does not yet hold. */
  const missingCredTypes = (server: MCPServer): CredentialType[] =>
    (server.required_credential_types ?? [])
      .map((slug) => credTypeBySlug.get(slug))
      .filter((ct): ct is CredentialType => ct !== undefined)
      .filter((ct) => !credByTypeId.has(ct.id));

  /**
   * Every required credential is checked, not just the first. The old page read
   * `required_credential_types[0]`, so a server needing two showed "Connected"
   * with one — and then failed at run time.
   *
   * Credential *rows* are only a fallback while the validation sweep is still
   * loading. Once it lands, `connected` means the server's credentials really
   * resolve (present, decryptable, every mapped field intact); anything else is
   * `needs_auth` even if a row exists — the agent's tool list is filtered by
   * the same resolution, so a status that ignored it would be a lie.
   */
  const statusOf = (server: MCPServer): ConnectionStatus => {
    // The platform's own switch is checked first: a row turned off here can
    // never be turned on by the user, so reporting it as their `off` would
    // offer an action that does not exist.
    // Checked before `unavailable`, which it is a special case of: both are
    // platform-off and inert, but an upcoming connector is not a fault, and
    // saying "Unavailable" reads as one.
    if (server.is_system && !server.enabled && server.coming_soon) return 'coming_soon';
    if (server.is_system && !server.enabled) return 'unavailable';
    if (!server.effective_enabled) return 'off';
    const validation = validationQuery.data?.get(server.id);
    if (validation) {
      if (!validation.ok) return 'needs_auth';
      const needsCreds =
        (server.required_credential_types?.length ?? 0) > 0 ||
        (server.credential_env_map && Object.keys(server.credential_env_map).length > 0) ||
        (server.credential_header_map && Object.keys(server.credential_header_map).length > 0);
      return needsCreds ? 'connected' : 'always';
    }
    const required = server.required_credential_types ?? [];
    if (required.length === 0) return 'always';
    return missingCredTypes(server).length === 0 ? 'connected' : 'needs_auth';
  };

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      mcpService.setEnabled(id, enabled),
    onMutate: ({ id }) => setBusyId(id),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
      // Abilities are per-connection and only meaningful while it is on.
      queryClient.invalidateQueries({ queryKey: ['mcpServerTools', updated.id] });
      toast.success(`${updated.label} turned ${updated.effective_enabled ? 'on' : 'off'}`);
    },
    onError: (err: unknown) => {
      // A 409 is the API saying this row is off at the platform level. That is
      // a fact about the connector, not a transient failure, so "please try
      // again" would be advice that can only fail — the switch is already
      // rendered inert, and this covers a stale list.
      const res = (err as { response?: { status?: number; data?: { error?: string } } })
        .response;
      if (res?.status === 409) {
        toast.error(res.data?.error ?? 'That connection is unavailable.');
        queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
        return;
      }
      toast.error('Could not change that. Please try again.');
    },
    onSettled: () => setBusyId(null),
  });

  const disconnectMutation = useMutation({
    mutationFn: (credIds: number[]) =>
      Promise.all(credIds.map((id) => credentialsService.delete(id))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
      queryClient.invalidateQueries({ queryKey: ['mcpValidation'] });
      toast.success('Disconnected');
    },
    onError: () =>
      toast.error('Could not disconnect. The credential may be in use by a workflow.'),
    onSettled: () => setBusyId(null),
  });

  const deleteServerMutation = useMutation({
    mutationFn: (id: number) => mcpService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
      queryClient.invalidateQueries({ queryKey: ['mcpValidation'] });
      toast.success('Connection removed');
      setConfirmDelete(null);
    },
    onError: () => toast.error('Could not remove that connection.'),
  });

  const handleDisconnect = (server: MCPServer) => {
    const ids = (server.required_credential_types ?? [])
      .map((slug) => credTypeBySlug.get(slug))
      .filter((ct): ct is CredentialType => ct !== undefined)
      .map((ct) => credByTypeId.get(ct.id)?.id)
      .filter((id): id is number => id !== undefined);
    if (ids.length === 0) return;
    setBusyId(server.id);
    disconnectMutation.mutate(ids);
  };

  const curated = useMemo(() => servers.filter((s) => s.is_system), [servers]);
  const custom = useMemo(() => servers.filter((s) => !s.is_system), [servers]);

  /* The `utilities` category ("Built in") never renders: those rows are
      retired duplicates of real tools — every one reads Unavailable with a
      paragraph explaining it is switched off. Showing them asks the user to
      read four apologies for something they never needed to set up. */
  const visibleCurated = useMemo(
    () => curated.filter((s) => s.category !== 'utilities'),
    [curated],
  );

  const byCategory = useMemo(() => {
    const map = new Map<MCPServerCategory, MCPServer[]>();
    visibleCurated.forEach((s) => {
      const key: MCPServerCategory = CATEGORY_ORDER.includes(s.category)
        ? s.category
        : 'custom';
      const list = map.get(key);
      if (list) list.push(s);
      else map.set(key, [s]);
    });
    return map;
  }, [visibleCurated]);

  const connectedCount = useMemo(
    () => curated.filter((s) => statusOf(s) === 'connected').length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [curated, credByTypeId, credTypeBySlug, validationQuery.data]
  );

  // The credential to collect when connecting: the first one still missing. If
  // none is missing but validation failed anyway (expired OAuth token, wrong
  // value), fall back to the first required type so the modal offers a
  // re-connect path instead of doing nothing.
  const connectingCredType = useMemo(() => {
    if (!connecting) return null;
    const missing = missingCredTypes(connecting);
    if (missing.length > 0) return missing[0];
    const validation = validationQuery.data?.get(connecting.id);
    if (validation && !validation.ok) {
      const required = connecting.required_credential_types ?? [];
      return (
        required
          .map((slug) => credTypeBySlug.get(slug))
          .find((ct): ct is CredentialType => ct !== undefined) ?? null
      );
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connecting, credByTypeId, credTypeBySlug, validationQuery.data]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
            <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PageHeader
        title="Connections"
        subtitle="What your assistant can reach on your behalf"
        icon={Plug}
        actions={
          connectedCount > 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Check className="w-4 h-4 text-blue-500" />
              <span>
                <span className="font-bold text-foreground">{connectedCount}</span> connected
              </span>
            </div>
          ) : undefined
        }
      />

      {serversQuery.error && (
        <div className="mx-4 md:mx-8 mt-4 bg-destructive/10 text-destructive p-4 rounded-lg border border-destructive/20 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">
            Could not load your connections. Please try again later.
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-8 space-y-10 custom-scrollbar">
        <HeldToolsPanel />
        {CATEGORY_ORDER.map((category) => {
          const group = byCategory.get(category) ?? [];
          if (group.length === 0) return null;
          return (
            <section key={category}>
              <h2 className="text-base font-bold text-foreground">
                {CATEGORY_LABELS[category]}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5 mb-4">
                {CATEGORY_BLURBS[category]}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {group.map((server) => (
                  <ConnectionCard
                    key={server.id}
                    server={server}
                    status={statusOf(server)}
                    busy={busyId === server.id}
                    onConnect={() => setConnecting(server)}
                    onDisconnect={() => handleDisconnect(server)}
                    onToggle={(enabled) =>
                      toggleMutation.mutate({ id: server.id, enabled })
                    }
                  />
                ))}
              </div>
            </section>
          );
        })}

        {visibleCurated.length === 0 && !serversQuery.error && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Plug className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-lg font-semibold text-foreground">No connections available</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Ask an administrator to set up connections, or add your own below.
            </p>
          </div>
        )}

        {/* Messaging channels. Same page because the question is the same —
            "what can act as me, and what does it still need" — but a separate
            section because channels are platform tools with vault keys, not
            MCP servers. */}
        <MessagingChannels
          credentialTypes={typesQuery.data?.types ?? []}
          onKeyStored={() => {
            queryClient.invalidateQueries({ queryKey: ['credentials'] });
            queryClient.invalidateQueries({ queryKey: ['messagingChannels'] });
          }}
        />

        {/* Advanced. The MCP vocabulary lives here and nowhere else: it is a real
            capability, but naming a subprocess is not a task for most people. */}
        <section className="border-t border-border/40 pt-6">
          <button
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex items-center gap-2 group"
          >
            {advancedOpen ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
            <span className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">
              Advanced
            </span>
            <span className="text-xs text-muted-foreground">
              Add a custom server
              {custom.length > 0 && ` · ${custom.length} added`}
            </span>
          </button>

          {advancedOpen && (
            <div className="mt-4 space-y-3">
              <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
                Connect any compatible server to add its tools to your agents. Your keys are stored securely and used only when needed.
              </p>

              {custom.map((server) => (
                <CustomServerRow
                  key={server.id}
                  server={server}
                  busy={busyId === server.id}
                  onEdit={() => {
                    setEditingServer(server);
                    setServerModalOpen(true);
                  }}
                  onDelete={() => setConfirmDelete(server)}
                  onToggle={(enabled) =>
                    toggleMutation.mutate({ id: server.id, enabled })
                  }
                />
              ))}

              <button
                onClick={() => {
                  setEditingServer(null);
                  setServerModalOpen(true);
                }}
                className="flex items-center gap-2 px-4 py-2.5 border border-dashed border-border rounded-lg text-sm font-semibold text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add custom server
              </button>
            </div>
          )}
        </section>

        {/* Credentials no longer has a nav entry — you get to a key through the
            connection that uses it. This is the way to the full list for anyone
            auditing stored secrets directly. */}
        <p className="text-xs text-muted-foreground pb-4">
          Looking for a key?{' '}
          <Link to="/credentials" className="text-primary hover:underline font-semibold">
            Manage saved accounts
          </Link>
          .
        </p>
      </div>

      {connecting && connectingCredType && (
        <ConnectModal
          server={connecting}
          credType={connectingCredType}
          alreadyHeld={credByTypeId.has(connectingCredType.id)}
          onClose={() => setConnecting(null)}
          onConnected={() => {
            queryClient.invalidateQueries({ queryKey: ['credentials'] });
            queryClient.invalidateQueries({ queryKey: ['mcpValidation'] });
            setConnecting(null);
          }}
        />
      )}

      <MCPServerModal
        isOpen={serverModalOpen}
        onClose={() => {
          setServerModalOpen(false);
          setEditingServer(null);
        }}
        initialData={editingServer}
        onSave={() => {
          queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
          queryClient.invalidateQueries({ queryKey: ['mcpValidation'] });
        }}
      />

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border/60 rounded-lg shadow-lg w-full max-w-sm p-8">
            <div className="w-14 h-14 bg-destructive/10 rounded-full flex items-center justify-center mb-6 mx-auto">
              <Trash2 className="w-7 h-7 text-destructive" />
            </div>
            <h3 className="text-lg font-bold mb-3 text-center">
              Remove {confirmDelete.label}?
            </h3>
            <p className="text-muted-foreground mb-8 text-center text-sm leading-relaxed">
              Your agents will immediately lose the tools this connection provides.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-3 border border-border/60 rounded-lg font-bold text-sm hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteServerMutation.mutate(confirmDelete.id)}
                disabled={deleteServerMutation.isPending}
                className="flex-1 px-4 py-3 bg-destructive text-destructive-foreground rounded-lg font-bold text-sm hover:bg-destructive/90 transition-colors disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
