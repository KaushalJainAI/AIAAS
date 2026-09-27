import { useState, useEffect } from 'react';
import {
  X,
  Cpu,
  Terminal,
  Globe,
  Save,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
  Info,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  mcpService, isRemoteServerType,
  type MCPServer, type MCPServerType, type CreateMCPServerData,
} from '../../api/mcp';
import { credentialsService, type CredentialType } from '../../api/credentials';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { apiErrorMessage } from '../../lib/apiError';

// LLM provider credential slugs — these are used by the platform's own AI,
// not by MCP servers, so they should not appear in the MCP credentials picker.
// Retired providers stay listed on purpose: their credential types are no
// longer seeded, but a user who added one before still holds it, and it would
// otherwise resurface here as an MCP credential.
const LLM_PROVIDER_SLUGS = new Set([
  'openrouter', 'nvidia', 'openai', 'opencode',
  'anthropic', 'cohere', 'deepseek', 'gemini-api', 'groq',
  'huggingface', 'mistral', 'perplexity-api', 'xai',
]);

// Token fields the injector can read off a credential even when they are not
// part of its schema — OAuth tokens land in dedicated columns.
const TOKEN_FIELDS = ['access_token', 'refresh_token'];

interface MCPServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: (server: MCPServer) => void;
  initialData?: MCPServer | null;
}

const inputCls =
  'w-full px-4 py-2.5 bg-background border border-input rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary transition-colors text-sm';
const monoCls = cn(inputCls, 'font-mono');
const labelCls = 'block text-sm font-bold mb-2';
const tooltipCls =
  'absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-popover text-popover-foreground text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-border shadow-sm z-50';

function FieldTip({ text }: { text: string }) {
  return (
    <div className="group relative">
      <Info className="w-3 h-3 text-muted-foreground cursor-help" />
      <div className={tooltipCls}>{text}</div>
    </div>
  );
}

export default function MCPServerModal({
  isOpen,
  onClose,
  onSave,
  initialData,
}: MCPServerModalProps) {
  const isEdit = Boolean(initialData);

  // ---- Basic config -------------------------------------------------------
  const [name, setName] = useState('');
  const [type, setType] = useState<MCPServerType>('http');
  // Remote covers both URL transports. The toggle offers "local vs remote"
  // rather than three buttons, because streamable-HTTP vs deprecated-SSE is not
  // a choice a user should have to understand: new remote servers are created
  // as `http`, and an existing `sse` row keeps its type so opening it to edit a
  // header does not silently migrate the transport underneath it.
  const isRemote = isRemoteServerType(type);
  const [command, setCommand] = useState('');
  const [url, setUrl] = useState('');

  // ---- Structured fields (serialised to JSON on save) ---------------------
  const [argsRows, setArgsRows] = useState<string[]>(['']);
  const [envRows, setEnvRows] = useState<{ key: string; value: string }[]>([{ key: '', value: '' }]);
  // `env` is write-only on the API: the backend never sends stored values back
  // (they may contain secrets). Without the dirty flag, editing a server would
  // re-send an empty env and silently wipe the saved vars.
  const [envDirty, setEnvDirty] = useState(false);
  const [credMapRows, setCredMapRows] = useState<{ envVar: string; slug: string; field: string }[]>([
    { envVar: '', slug: '', field: '' },
  ]);
  const [headerRows, setHeaderRows] = useState<{ header: string; template: string }[]>([
    { header: '', template: '' },
  ]);
  const [tokenSlug, setTokenSlug] = useState('');
  const [tokenField, setTokenField] = useState('');

  const [requiredCreds, setRequiredCreds] = useState<string[]>([]);
  const [setupNotes, setSetupNotes] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [showPreview, setShowPreview] = useState(false);

  const [credentialTypes, setCredentialTypes] = useState<CredentialType[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCredTypes = async () => {
      try {
        const res = await credentialsService.getTypes();
        setCredentialTypes(res.types);
      } catch (err) {
        console.error('Failed to fetch credential types', err);
      }
    };
    if (isOpen) {
      fetchCredTypes();
    }
  }, [isOpen]);

  // Reset the form when the modal opens or is pointed at a different record.
  // Adjusted during render rather than in an effect: an effect paints the
  // previous record's values for one frame and then re-renders to replace
  // them, which is the cascading render React's docs (and the compiler's
  // lint) steer away from. Same trigger as the effect had: any change to
  // these inputs while open.
  const resetInputs = [isOpen, initialData] as const;
  const [seenInputs, setSeenInputs] = useState<typeof resetInputs | null>(null);
  if (!seenInputs || resetInputs.some((input, i) => input !== seenInputs[i])) {
    setSeenInputs(resetInputs);
    if (isOpen) {
        setError(null);
        if (initialData) {
          setName(initialData.name);
          setType(initialData.type);
          setCommand(initialData.command || '');
          setUrl(initialData.url || '');
          setArgsRows(initialData.args && initialData.args.length > 0 ? [...initialData.args] : ['']);
          // Write-only on the backend: saved env values never come back, so start
          // blank and only send env if the user actually changes something.
          setEnvRows([{ key: '', value: '' }]);
          setEnvDirty(false);
          setCredMapRows(
            Object.entries(initialData.credential_env_map ?? {}).map(([envVar, mapping]) => {
              const idx = String(mapping).indexOf(':');
              return idx > 0
                ? { envVar, slug: String(mapping).slice(0, idx), field: String(mapping).slice(idx + 1) }
                : { envVar, slug: '', field: '' };
            })
          );
          setHeaderRows(Object.entries(initialData.credential_header_map ?? {}).map(([header, template]) => ({ header, template })));
          setRequiredCreds(initialData.required_credential_types || []);
          setSetupNotes(initialData.setup_notes || '');
          setEnabled(initialData.enabled);
        } else {
          setName('');
          /* Remote first: production refuses local-process servers
             (`MCP_ALLOW_STDIO=False`), and a hosted endpoint costs this box no memory. */
          setType('http');
          setCommand('');
          setUrl('');
          setArgsRows(['']);
          setEnvRows([{ key: '', value: '' }]);
          setEnvDirty(false);
          setCredMapRows([{ envVar: '', slug: '', field: '' }]);
          setHeaderRows([{ header: '', template: '' }]);
          setTokenSlug('');
          setTokenField('');
          setRequiredCreds([]);
          setSetupNotes('');
          setEnabled(true);
          setShowPreview(false);
        }
    }
  }

  // ---- Credential helpers -------------------------------------------------

  const credTypes = credentialTypes.filter((ct) => !LLM_PROVIDER_SLUGS.has(ct.slug));

  const fieldsFor = (slug: string): string[] => {
    const ct = credentialTypes.find((t) => t.slug === slug);
    const names = (ct?.fields_schema ?? []).map((f) => f.name);
    for (const token of TOKEN_FIELDS) {
      if (!names.includes(token)) names.push(token);
    }
    return names;
  };

  const addRequiredCred = (slug: string) => {
    if (slug && !requiredCreds.includes(slug)) {
      setRequiredCreds((prev) => [...prev, slug]);
    }
  };

  const toggleCred = (slug: string) => {
    setRequiredCreds((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  };

  const insertToken = (rowIdx: number) => {
    if (!tokenSlug || !tokenField) return;
    setHeaderRows((prev) =>
      prev.map((row, i) =>
        i === rowIdx ? { ...row, template: `${row.template}{${tokenSlug}:${tokenField}}` } : row
      )
    );
  };

  // ---- Serialisation ------------------------------------------------------

  const buildPayload = (): { data?: CreateMCPServerData; error?: string } => {
    if (!name.trim()) return { error: 'Name is required' };
    if (type === 'stdio' && !command.trim()) return { error: 'Command is required for stdio servers' };
    if (isRemote && !url.trim()) return { error: 'Endpoint URL is required for a remote server' };

    const args = argsRows.map((a) => a.trim()).filter(Boolean);
    const env: Record<string, string> = {};
    for (const row of envRows) {
      if (!row.key.trim()) {
        if (row.value.trim()) return { error: 'An environment variable is missing its name' };
        continue;
      }
      if (!row.value.trim()) return { error: `Environment variable "${row.key}" is missing its value` };
      env[row.key.trim()] = row.value.trim();
    }

    const credential_env_map: Record<string, string> = {};
    for (const row of credMapRows) {
      if (!row.envVar.trim() && !row.slug && !row.field) continue;
      if (!row.envVar.trim()) return { error: 'A credential link is missing its environment variable name' };
      if (!row.slug) return { error: `Credential link "${row.envVar}" is missing its credential` };
      if (!row.field) return { error: `Credential link "${row.envVar}" is missing its field` };
      credential_env_map[row.envVar.trim()] = `${row.slug}:${row.field}`;
    }

    const credential_header_map: Record<string, string> = {};
    for (const row of headerRows) {
      if (!row.header.trim() && !row.template.trim()) continue;
      if (!row.header.trim()) return { error: 'An auth header is missing its name' };
      if (!row.template.trim()) return { error: `Auth header "${row.header}" is missing its value` };
      credential_header_map[row.header.trim()] = row.template.trim();
    }

    return {
      data: {
        name: name.trim(),
        type,
        command: type === 'stdio' ? command.trim() : undefined,
        args: type === 'stdio' ? args : undefined,
        url: isRemote ? url.trim() : undefined,
        ...(isEdit && !envDirty ? {} : { env }),
        required_credential_types: requiredCreds,
        credential_env_map: type === 'stdio' ? credential_env_map : undefined,
        credential_header_map: isRemote ? credential_header_map : undefined,
        setup_notes: setupNotes.trim() || undefined,
        enabled,
      },
    };
  };

  const handleSubmit = async () => {
    setError(null);
    const built = buildPayload();
    if (built.error || !built.data) {
      setError(built.error || 'Please check the form.');
      return;
    }

    try {
      setSaving(true);
      let result: MCPServer;
      if (initialData) {
        result = await mcpService.update(initialData.id, built.data);
        toast.success('MCP Server updated');
      } else {
        result = await mcpService.create(built.data);
        toast.success('MCP Server registered');
      }
      if (onSave) onSave(result);
      onClose();
    } catch (err: unknown) {
      console.error('Save failed', err);
      setError(apiErrorMessage(err, 'Failed to save MCP server'));
    } finally {
      setSaving(false);
    }
  };

  const previewJson = (() => {
    const built = buildPayload();
    if (built.error) return built.error;
    return JSON.stringify(built.data, null, 2);
  })();

  if (!isOpen) return null;

  // ---- Row primitives -----------------------------------------------------

  const RowWrap = ({ children, onRemove, removable }: { children: React.ReactNode; onRemove: () => void; removable: boolean }) => (
    <div className="flex items-start gap-2">
      <div className="flex-1 grid gap-2">{children}</div>
      {removable && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove row"
          className="mt-2.5 p-1.5 hover:bg-destructive/10 rounded-lg text-muted-foreground hover:text-destructive transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );

  const selectCls = cn(inputCls, 'bg-background');
  const smallSelectCls = cn(selectCls, 'py-2');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] animate-in fade-in duration-200">
      <div className="bg-card border border-border/60 rounded-lg shadow-lg w-full max-w-2xl mx-4 flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-6 border-b border-border/40 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg text-primary">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight">
                {isEdit ? 'Edit MCP Server' : 'Register MCP Server'}
              </h2>
              <p className="text-xs text-muted-foreground font-medium mt-0.5">
                Add a tool server your agents can call
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar space-y-6">
          {error && (
            <div className="p-4 bg-destructive/10 text-destructive border border-destructive/20 rounded-lg text-sm flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="font-medium">{error}</div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left Column */}
            <div className="space-y-6">
              <div>
                <label className={labelCls}>Server name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. GitHub MCP"
                  className={inputCls}
                />
              </div>

              <div>
                <label className={cn(labelCls, 'flex items-center gap-2')}>
                  Connection type
                  <FieldTip text="Run locally spawns a program on the server (npx, python...). Remote endpoint talks to a hosted MCP server over HTTP." />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setType('stdio')}
                    className={cn(
                      'flex items-center justify-center gap-2 p-3 border rounded-lg transition-colors font-semibold text-sm',
                      type === 'stdio'
                        ? 'bg-primary/10 border-primary text-primary'
                        : 'border-border/60 hover:border-border hover:bg-muted/50'
                    )}
                  >
                    <Terminal className="w-4 h-4" />
                    Run locally
                  </button>
                  <button
                    type="button"
                    onClick={() => setType(isRemote ? type : 'http')}
                    className={cn(
                      'flex items-center justify-center gap-2 p-3 border rounded-lg transition-colors font-semibold text-sm',
                      isRemote
                        ? 'bg-primary/10 border-primary text-primary'
                        : 'border-border/60 hover:border-border hover:bg-muted/50'
                    )}
                  >
                    <Globe className="w-4 h-4" />
                    Remote endpoint
                  </button>
                </div>
              </div>

              {type === 'stdio' ? (
                <>
                  <div>
                    <label className={labelCls}>Command</label>
                    <input
                      type="text"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      placeholder="e.g. npx"
                      className={monoCls}
                    />
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      The program to run, e.g. <span className="font-mono">npx</span>,{' '}
                      <span className="font-mono">python</span>, <span className="font-mono">node</span>.
                    </p>
                  </div>

                  <div>
                    <label className={labelCls}>Arguments</label>
                    <div className="space-y-2">
                      {argsRows.map((arg, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={arg}
                            onChange={(e) =>
                              setArgsRows((prev) => prev.map((a, j) => (j === i ? e.target.value : a)))
                            }
                            placeholder={i === 0 ? '-y' : '@modelcontextprotocol/server-filesystem'}
                            className={monoCls}
                          />
                          <button
                            type="button"
                            onClick={() => setArgsRows((prev) => prev.filter((_, j) => j !== i))}
                            disabled={argsRows.length === 1}
                            aria-label="Remove argument"
                            className="p-1.5 hover:bg-destructive/10 rounded-lg text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setArgsRows((prev) => [...prev, ''])}
                      className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                    >
                      <Plus className="w-3 h-3" /> Add argument
                    </button>
                  </div>
                </>
              ) : (
                <div>
                  <label className={labelCls}>Endpoint URL</label>
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://mcp.notion.com/mcp"
                    className={monoCls}
                  />
                </div>
              )}

              <div>
                <label className={cn(labelCls, 'flex items-center gap-2')}>
                  Extra environment variables
                  <FieldTip text="Plain key/value pairs passed to the program. Secrets should come from Credentials below, not here." />
                </label>
                <div className="space-y-2">
                  {envRows.map((row, i) => (
                    <RowWrap
                      key={i}
                      removable
                      onRemove={() => {
                        setEnvRows((prev) => prev.filter((_, j) => j !== i));
                        setEnvDirty(true);
                      }}
                    >
                      <input
                        type="text"
                        value={row.key}
                        onChange={(e) => {
                          setEnvRows((prev) => prev.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)));
                          setEnvDirty(true);
                        }}
                        placeholder="NAME"
                        className={monoCls}
                      />
                      <input
                        type="text"
                        value={row.value}
                        onChange={(e) => {
                          setEnvRows((prev) => prev.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)));
                          setEnvDirty(true);
                        }}
                        placeholder="value"
                        className={monoCls}
                      />
                    </RowWrap>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEnvRows((prev) => [...prev, { key: '', value: '' }]);
                    setEnvDirty(true);
                  }}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                  <Plus className="w-3 h-3" /> Add variable
                </button>
                {isEdit && !envDirty && (
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    Saved values are hidden for security. Leave blank to keep them.
                  </p>
                )}
              </div>
            </div>

            {/* Right Column */}
            <div className="space-y-6">
              <div>
                <label className={cn(labelCls, 'flex items-center gap-2')}>
                  Required Credentials
                  <FieldTip text="Credential types the AI needs before this server's tools can be used. Pick one here, or add a credential link below and it is added for you." />
                </label>
                <div className="space-y-2 max-h-[150px] overflow-y-auto pr-1 custom-scrollbar">
                  {credTypes.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic py-2">
                      No credential types defined yet.
                    </p>
                  ) : (
                    credTypes.map((ct) => (
                      <button
                        key={ct.slug}
                        type="button"
                        onClick={() => toggleCred(ct.slug)}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors',
                          requiredCreds.includes(ct.slug)
                            ? 'bg-primary/5 border-primary/30 text-primary shadow-sm ring-1 ring-primary/20'
                            : 'border-border/40 hover:bg-muted/50'
                        )}
                      >
                        <div
                          className={cn(
                            'w-2 h-2 rounded-full',
                            requiredCreds.includes(ct.slug)
                              ? 'bg-primary'
                              : 'bg-muted-foreground/30'
                          )}
                        />
                        <span className="font-medium">{ct.name}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {type === 'stdio' ? (
                <div>
                  <label className={cn(labelCls, 'flex items-center gap-2')}>
                    Link credentials to the program
                    <FieldTip text="Each row hands one credential value to the program as an environment variable. Example: TOKEN -> GitHub token -> api_key." />
                  </label>
                  <div className="space-y-3">
                    {credMapRows.map((row, i) => (
                      <RowWrap
                        key={i}
                        removable
                        onRemove={() => setCredMapRows((prev) => prev.filter((_, j) => j !== i))}
                      >
                        <input
                          type="text"
                          value={row.envVar}
                          onChange={(e) =>
                            setCredMapRows((prev) => prev.map((r, j) => (j === i ? { ...r, envVar: e.target.value } : r)))
                          }
                          placeholder="TOKEN (env var name)"
                          className={monoCls}
                        />
                        <select
                          value={row.slug}
                          onChange={(e) => {
                            const slug = e.target.value;
                            setCredMapRows((prev) =>
                              prev.map((r, j) => (j === i ? { ...r, slug, field: '' } : r))
                            );
                            addRequiredCred(slug);
                          }}
                          className={smallSelectCls}
                        >
                          <option value="">Credential…</option>
                          {credTypes.map((ct) => (
                            <option key={ct.slug} value={ct.slug}>
                              {ct.name}
                            </option>
                          ))}
                        </select>
                        <select
                          value={row.field}
                          onChange={(e) =>
                            setCredMapRows((prev) =>
                              prev.map((r, j) => (j === i ? { ...r, field: e.target.value } : r))
                            )
                          }
                          disabled={!row.slug}
                          className={cn(smallSelectCls, !row.slug && 'opacity-50')}
                        >
                          <option value="">Field…</option>
                          {row.slug &&
                            fieldsFor(row.slug).map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                        </select>
                      </RowWrap>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setCredMapRows((prev) => [...prev, { envVar: '', slug: '', field: '' }])}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                  >
                    <Plus className="w-3 h-3" /> Link a credential
                  </button>
                </div>
              ) : (
                <div>
                  <label className={cn(labelCls, 'flex items-center gap-2')}>
                    Auth headers
                    <FieldTip text="HTTP headers sent with every request. Insert credential tokens with the button below — they arrive as {credential:field} placeholders and are filled at call time." />
                  </label>
                  <div className="space-y-3">
                    {headerRows.map((row, i) => (
                      <div key={i} className="space-y-2">
                        <RowWrap
                          removable
                          onRemove={() => setHeaderRows((prev) => prev.filter((_, j) => j !== i))}
                        >
                          <input
                            type="text"
                            value={row.header}
                            onChange={(e) =>
                              setHeaderRows((prev) => prev.map((r, j) => (j === i ? { ...r, header: e.target.value } : r)))
                            }
                            placeholder="Authorization"
                            className={monoCls}
                          />
                          <input
                            type="text"
                            value={row.template}
                            onChange={(e) =>
                              setHeaderRows((prev) => prev.map((r, j) => (j === i ? { ...r, template: e.target.value } : r)))
                            }
                            placeholder='Bearer {github_token:api_key}'
                            className={monoCls}
                          />
                        </RowWrap>
                        <div className="flex items-center gap-2 pl-1">
                          <span className="text-[11px] text-muted-foreground">Insert token:</span>
                          <select
                            value={tokenSlug}
                            onChange={(e) => {
                              setTokenSlug(e.target.value);
                              setTokenField('');
                            }}
                            className={cn(smallSelectCls, 'flex-1 min-w-0 py-1.5 text-xs')}
                          >
                            <option value="">Credential…</option>
                            {credTypes.map((ct) => (
                              <option key={ct.slug} value={ct.slug}>
                                {ct.name}
                              </option>
                            ))}
                          </select>
                          <select
                            value={tokenField}
                            onChange={(e) => setTokenField(e.target.value)}
                            disabled={!tokenSlug}
                            className={cn(smallSelectCls, 'flex-1 min-w-0 py-1.5 text-xs', !tokenSlug && 'opacity-50')}
                          >
                            <option value="">Field…</option>
                            {tokenSlug &&
                              fieldsFor(tokenSlug).map((f) => (
                                <option key={f} value={f}>
                                  {f}
                                </option>
                              ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => insertToken(i)}
                            disabled={!tokenSlug || !tokenField}
                            className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors disabled:opacity-40"
                          >
                            Insert
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setHeaderRows((prev) => [...prev, { header: '', template: '' }])}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                  >
                    <Plus className="w-3 h-3" /> Add header
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Status */}
          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border/40">
            <div>
              <div className="text-sm font-bold">Enabled</div>
              <div className="text-xs text-muted-foreground">
                Active for this user — off hides its tools from your agents
              </div>
            </div>
            <button
              type="button"
              onClick={() => setEnabled(!enabled)}
              className={cn('transition-colors duration-200', enabled ? 'text-primary' : 'text-muted-foreground')}
            >
              {enabled ? <ToggleRight className="w-10 h-10" /> : <ToggleLeft className="w-10 h-10" />}
            </button>
          </div>

          {/* Setup Notes */}
          <div>
            <label className={labelCls}>Setup notes</label>
            <textarea
              value={setupNotes}
              onChange={(e) => setSetupNotes(e.target.value)}
              rows={2}
              placeholder="Notes shown on the Connections page about how this server is configured..."
              className={cn(inputCls, 'custom-scrollbar')}
            />
          </div>

          {/* JSON preview */}
          <div className="border border-border/40 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="w-full flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPreview ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              JSON that will be saved
            </button>
            {showPreview && (
              <pre className="px-4 pb-4 text-[11px] font-mono text-muted-foreground max-h-48 overflow-y-auto custom-scrollbar whitespace-pre-wrap">
                {previewJson}
              </pre>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border/40 flex justify-end gap-3 shrink-0 bg-muted/20 rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 border border-border/60 rounded-lg font-bold text-sm hover:bg-muted transition-colors"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="btn-primary px-6 py-2.5 disabled:opacity-70"
          >
            {saving ? (
              <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {isEdit ? 'Update Server' : 'Register Server'}
          </button>
        </div>
      </div>
    </div>
  );
}
