/**
 * Agent view — describe the media, the router picks parameters, HITL confirms.
 *
 * Layout notes, because the previous version got each of these wrong:
 *
 * - **One header.** The page already says "Imagine" with a palette icon; this used
 *   to add a second bar saying "Imagine agent" with the same icon directly
 *   beneath it.
 * - **Connection state is only shown when it is bad.** A permanent green
 *   "live" pill spends real estate telling the user nothing is wrong. It now
 *   appears only when the socket drops.
 * - **The empty state is a hero, not a void.** Composer, greeting and starters
 *   sit together in the middle of the screen; previously the greeting floated
 *   at the centre while the composer was pinned ~600px below it with nothing
 *   in between. Once a conversation starts the composer docks to the bottom.
 * - **Everything shares one measure.** The composer used to span the full
 *   viewport while the content above it was capped at ~640px, so on a wide
 *   monitor the caret sat at the far left and the send button at the far right.
 *
 * The composer carries the modality selector and model picker, which default
 * to **Auto** — say what you want and let the router choose.
 */
import { useEffect, useRef, useState } from 'react';
import { Headphones, History, ImageIcon, MessageSquare, Palette, Plus, Trash2, Video, WifiOff, X, Loader2 } from 'lucide-react';
import { useImagineAgent } from '../../hooks/useImagineAgent';
import { usePersistedState } from '../../hooks/usePersistedState';
import type { Capabilities, MediaKind } from '../../api/imagine';
import { IntentPreviewCard } from './IntentPreviewCard';
import { GenerationBubble } from './GenerationBubble';
import { Lightbox, type LightboxItem } from './Lightbox';
import { ModelPicker } from './ModelPicker';
import { SendButton } from '../ui/SendButton';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import MarkdownMessage from '../chat/MarkdownMessage';

/** `auto` leaves the modality to the router. */
type KindChoice = 'auto' | MediaKind;

const KIND_OPTIONS: Array<{ id: KindChoice; icon?: typeof ImageIcon; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'image', icon: ImageIcon, label: 'Image' },
  { id: 'video', icon: Video, label: 'Video' },
  { id: 'audio', icon: Headphones, label: 'Audio' },
];

const STARTERS: Array<{ kind: MediaKind; text: string }> = [
  { kind: 'image', text: 'A neon-lit Tokyo street at night, reflections on wet asphalt' },
  { kind: 'image', text: 'Watercolour fox curled asleep in a forest, soft light' },
  { kind: 'video', text: 'A 6-second aerial clip over snowy mountains at golden hour' },
  { kind: 'audio', text: 'Narrate calmly: "Welcome to the future of media."' },
];

const STARTER_ICON: Record<MediaKind, typeof ImageIcon> = {
  image: ImageIcon,
  video: Video,
  audio: Headphones,
};

interface Props {
  capabilities: Capabilities | null;
  onRefreshCatalog?: () => void;
  isRefreshingCatalog?: boolean;
  // Reuse like chat's history — parent (Imagine.tsx) owns the top-bar button
  // and the drawer, so they stay on the same `useImagineAgent` instance.
  agent?: ReturnType<typeof useImagineAgent>;
  showHistory?: boolean;
  onShowHistoryChange?: (v: boolean) => void;
}

export function ImagineChat({ capabilities, onRefreshCatalog, isRefreshingCatalog, agent: propAgent, showHistory: propShowHistory, onShowHistoryChange }: Props) {
  const fallbackAgent = useImagineAgent();
  const agent = propAgent ?? fallbackAgent;
  const {
    items,
    isSending,
    isConnected,
    pendingIntent,
    sendMessage,
    resume,
    // when parent owns the agent, these are the same instance — no duplicate fetch
    conversations: _conversations,
    isLoadingConversations: _isLoading,
    refreshConversations: _refresh,
    newConversation: _newConv,
    switchConversation: _switch,
    deleteConversation: _delete,
    conversationId: _cid,
  } = agent;
  // Keep names stable for the rest of the file
  const conversations = _conversations;
  const isLoadingConversations = _isLoading;
  const refreshConversations = _refresh;
  const newConversation = _newConv;
  const switchConversation = _switch;
  const deleteConversation = _delete;
  const conversationId = _cid;

  const [draft, setDraft] = useState('');
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);
  const [internalShowHistory, setInternalShowHistory] = useState(false);
  const showHistory = propShowHistory ?? internalShowHistory;
  const setShowHistory = onShowHistoryChange ?? setInternalShowHistory;
  const [kind, setKind] = usePersistedState<KindChoice>('imagine.agentKind', 'auto');
  const [modelByKind, setModelByKind] = usePersistedState<Partial<Record<MediaKind, string>>>(
    'imagine.agentModelByKind',
    {},
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  const pinnedModel = kind === 'auto' ? null : modelByKind[kind] ?? null;
  const isEmpty = items.length === 0;

  // Adopt the backend default when a modality is chosen but no model is yet.
  useEffect(() => {
    if (kind === 'auto' || !capabilities) return;
    const pool = capabilities[kind];
    if (pool.length === 0) return;
    if (pool.some(m => m.id === modelByKind[kind])) return;
    setModelByKind(prev => ({ ...prev, [kind]: capabilities.defaults[kind] ?? pool[0].id }));
  }, [kind, capabilities, modelByKind, setModelByKind]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [items.length]);

  const submit = (text?: string) => {
    const message = (text ?? draft).trim();
    if (!message || isSending) return;
    if (!text) setDraft('');
    void sendMessage(message, pinnedModel);
  };

  const handleDeleteConversation = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!confirm('Delete this conversation? Generations inside stay in Documents.')) return;
    try {
      await deleteConversation(id);
      toast.success('Conversation deleted');
    } catch {
      toast.error('Failed to delete conversation');
    }
  };

  const composer = (
    <div className="rounded-lg border border-border/60 bg-card focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/5 transition-all">
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={isEmpty ? 3 : 1}
        placeholder={
          pendingIntent ? 'Approve, edit, or cancel above…' : 'Describe what you want to create…'
        }
        className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[15px] leading-relaxed outline-none max-h-40 placeholder:text-muted-foreground/40"
      />
      <div className="flex items-center gap-2 px-3 pb-2.5 pt-1 flex-wrap">
        <div className="flex p-0.5 bg-muted/40 rounded-lg border border-border/50">
          {KIND_OPTIONS.map(option => (
            <button
              key={option.id}
              onClick={() => setKind(option.id)}
              title={
                option.id === 'auto'
                  ? 'Let the agent choose the modality and model'
                  : `Always generate ${option.label.toLowerCase()}`
              }
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors',
                kind === option.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.icon && <option.icon size={12} />}
              {option.label}
            </button>
          ))}
        </div>

        {kind !== 'auto' && (
          <ModelPicker
            kind={kind}
            capabilities={capabilities}
            value={pinnedModel ?? ''}
            onChange={id => setModelByKind(prev => ({ ...prev, [kind]: id }))}
            onRefresh={onRefreshCatalog}
            isRefreshing={isRefreshingCatalog}
            compact
          />
        )}

        <div className="ml-auto flex items-center gap-2 shrink-0 pl-2">
          {!isConnected && (
            <span
              title="Reconnecting to the live update channel"
              className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400"
            >
              <WifiOff size={11} />
              <span>Reconnecting</span>
            </span>
          )}
          <SendButton onClick={() => submit()} busy={isSending} disabled={!draft.trim()} />
        </div>
      </div>
    </div>
  );

  // ---- history sidebar (independent contexts) ----
  // When parent (Imagine.tsx) owns the agent, it also owns the top-bar button + drawer
  // (left top bar, like chat). In that mode this component must not render a second drawer.
  const historyPanel = propAgent ? null : (
    <>
      {showHistory && (
        <div className="absolute inset-0 z-20 bg-black/50 md:hidden" onClick={() => setShowHistory(false)} />
      )}
      <div
        className={cn(
          'absolute inset-y-0 left-0 z-30 flex w-[280px] max-w-[85vw] flex-col border-r bg-card shadow-md transition-transform duration-300 md:relative md:shadow-none',
          showHistory ? 'translate-x-0' : '-translate-x-full md:hidden'
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary/70" />
            <span className="text-xs font-bold tracking-wide">Conversations</span>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{conversations.length}</span>
          </div>
          <button onClick={() => setShowHistory(false)} className="rounded-lg p-1.5 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-3">
          <button
            onClick={() => {
              newConversation();
              setShowHistory(false);
            }}
            className="flex w-full items-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> New conversation
          </button>
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
            Each thread is isolated — prompts, model choice and history stay in that thread. Split work to avoid pollution and keep tokens low.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {isLoadingConversations ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : conversations.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">No conversations yet. Start one and it appears here.</p>
          ) : (
            <div className="space-y-1">
              {conversations.map((c) => (
                <div
                  key={c.id}
                  onClick={() => {
                    void switchConversation(c.id);
                    setShowHistory(false);
                  }}
                  className={cn(
                    'group flex items-center gap-2 rounded-lg px-3 py-2.5 text-left cursor-pointer transition-colors',
                    conversationId === c.id ? 'bg-primary/10 border border-primary/20' : 'hover:bg-muted/60 border border-transparent'
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium leading-tight">{c.title || 'Untitled'}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {c.last_message ? `${c.last_message.role === 'user' ? 'You: ' : ''}${c.last_message.content.slice(0, 44)}` : 'No messages'}
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDeleteConversation(e, c.id)}
                    className="rounded-md p-1 opacity-0 group-hover:opacity-100 hover:bg-destructive hover:text-white"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t p-3">
          <button onClick={() => void refreshConversations()} className="w-full rounded-lg border py-1.5 text-xs font-medium hover:bg-muted">
            Refresh
          </button>
        </div>
      </div>
    </>
  );

  // ---- main content with sidebar ----
  return (
    <div className="flex h-full overflow-hidden">
      {historyPanel}

      <div className="flex min-w-0 flex-1 flex-col">
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center px-4 overflow-y-auto custom-scrollbar">
            <div className="w-full max-w-2xl space-y-5 py-8">
              <div className="text-center space-y-1.5">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
                  <Palette size={20} className="text-primary" />
                </div>
                <h2 className="text-xl font-semibold pt-1.5">What should we make?</h2>
                <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                  Describe it in your own words. The agent picks the model and settings, then checks with you before spending anything.
                </p>
                <p className="text-xs text-muted-foreground/70">
                  Tip: <button onClick={() => setShowHistory(true)} className="underline decoration-dotted underline-offset-4 hover:text-foreground">Open conversations</button> to keep threads separate — saves tokens.
                </p>
              </div>

              {composer}

              <div className="grid sm:grid-cols-2 gap-2">
                {STARTERS.map((starter) => {
                  const Icon = STARTER_ICON[starter.kind];
                  return (
                    <button
                      key={starter.text}
                      onClick={() => submit(starter.text)}
                      className="group flex items-start gap-2.5 text-left px-3 py-2.5 rounded-lg border border-border/50 hover:border-border hover:bg-muted/40 transition-colors"
                    >
                      <Icon size={13} className="mt-0.5 shrink-0 text-muted-foreground/60 group-hover:text-primary transition-colors" />
                      <span className="text-xs leading-relaxed text-muted-foreground group-hover:text-foreground transition-colors">
                        {starter.text}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <Lightbox isOpen={!!lightbox} onClose={() => setLightbox(null)} result={lightbox} />
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar">
              <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
                {items.map((item) => (
                  <div key={item.key} className={cn('flex', item.role === 'user' ? 'justify-end' : 'justify-start')}>
                    <div className={cn('max-w-[85%]', item.role === 'user' ? 'order-1' : 'order-none')}>
                      {item.role === 'user' ? (
                        <div className="bg-primary text-primary-foreground rounded-lg rounded-br-md px-3.5 py-2 text-sm">{item.content}</div>
                      ) : (
                        <div>
                          {/* Agent reply — markdown (bold, titles, lists) via the shared renderer. */}
                          <div className="text-sm leading-relaxed text-foreground/90">
                            <MarkdownMessage content={item.content} variant="compact" />
                          </div>
                          {item.requiresHitl && item.intent && (
                            <IntentPreviewCard
                              intent={item.intent}
                              capabilities={capabilities}
                              disabled={isSending || !pendingIntent}
                              onApprove={() => resume('approve')}
                              onEdit={(o) => resume('edit', o)}
                              onCancel={() => resume('cancel')}
                            />
                          )}
                          {item.generation && (
                            <GenerationBubble
                              generation={item.generation}
                              onOpen={() => {
                                const g = item.generation;
                                if (!g?.output_url) return;
                                setLightbox({ url: g.output_url, type: g.type, prompt: g.prompt, model: g.model, timestamp: new Date() });
                              }}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {isSending && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="flex gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.3s]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.15s]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce" />
                    </span>
                    Thinking
                  </div>
                )}
              </div>
            </div>
            <div className="border-t border-border/40 px-4 py-3">
              <div className="mx-auto max-w-3xl">{composer}</div>
            </div>
          </>
        )}
        <Lightbox isOpen={!!lightbox} onClose={() => setLightbox(null)} result={lightbox} />
      </div>
    </div>
  );
}
