/**
 * Imagine — media generation.
 *
 * Two views over the same backend: **Agent** (describe it in chat, the router
 * picks parameters, HITL confirms) and **Studio** (pick the model and every
 * parameter yourself).
 *
 * Studio's layout follows what mainstream generators converged on. Model tiles
 * sit on the page above the prompt, selectable in one click without opening
 * anything — Leonardo keeps a model card on the canvas, Krea a row of tiles —
 * because a picker hidden behind a dialog cannot tell you which models exist.
 * The prompt bar carries the two settings people change constantly (ratio and
 * size) as inline pills; the long tail lives in a drawer. A style gallery sits
 * beneath the prompt, giving a vocabulary for looks that are easy to picture
 * and hard to phrase.
 */
import { useState } from 'react';
import {
  Headphones,
  History,
  ImageIcon,
  Info,
  Loader2,
  MessageSquare,
  Plus,
  Settings2,
  Palette,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { usePersistedState } from '../hooks/usePersistedState';
import { useImagineAgent } from '../hooks/useImagineAgent';
import { useImagineStudio } from '../hooks/useImagineStudio';
import type { Generation, MediaKind } from '../api/imagine';
import { GenerationControls } from '../components/imagine/GenerationControls';
import { ImagineChat } from '../components/imagine/ImagineChat';
import { Lightbox, type LightboxItem } from '../components/imagine/Lightbox';
import { MissingCredentialBanner } from '../components/imagine/MissingCredentialBanner';
import { ModelPicker } from '../components/imagine/ModelPicker';
import { ModelRail } from '../components/imagine/ModelRail';
import { PillSelect } from '../components/imagine/PillSelect';
import { ResultCard } from '../components/imagine/ResultCard';
import { StyleGallery } from '../components/imagine/StyleGallery';
import { SendButton } from '../components/ui/SendButton';
import SidebarMenuButton from '../components/layout/SidebarMenuButton';
import { cn } from '../lib/utils';

type ViewMode = 'agent' | 'studio';

const MODES: Array<{ id: MediaKind; icon: typeof ImageIcon; label: string }> = [
  { id: 'image', icon: ImageIcon, label: 'Image' },
  { id: 'video', icon: Video, label: 'Video' },
  { id: 'audio', icon: Headphones, label: 'Audio' },
];

const PLACEHOLDERS: Record<MediaKind, string> = {
  image: 'A neon-lit Tokyo street after rain, reflections on wet asphalt…',
  video: 'Slow aerial push over a misty pine forest at sunrise…',
  audio: 'Welcome to the future of media. Everything you imagine, generated on demand.',
};

const STARTERS: Record<MediaKind, string[]> = {
  image: [
    'A fox curled asleep in a birch forest, soft morning light',
    'Isometric cutaway of a cosy attic studio',
    'Matte black espresso machine on raw concrete',
  ],
  video: [
    'Drone skimming a turquoise coastline at golden hour',
    'Storm clouds rolling over a wheat field',
    'Ink diffusing through water, macro',
  ],
  audio: [
    'Calm narrator: "The results are in, and they are remarkable."',
    'Upbeat host: "Welcome back — let us dive straight in."',
  ],
};

function toLightboxItem(generation: Generation, url?: string): LightboxItem {
  return {
    id: generation.id,
    // The clicked frame, not the first: a batch of four opened on image one
    // whichever thumbnail was pressed.
    url: url ?? generation.output_url!,
    prompt: generation.prompt,
    type: generation.type,
    model: generation.model,
    timestamp: new Date(generation.created_at),
  };
}

function SectionLabel({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {children}
      </span>
      {aside}
    </div>
  );
}

export default function Imagine() {
  const [viewMode, setViewMode] = usePersistedState<ViewMode>('imagine.view', 'agent');
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [showAgentHistory, setShowAgentHistory] = useState(false);

  const {
    capabilities,
    credentialMissing,
    isLoadingCatalog,
    isRefreshing,
    refreshCatalog,
    mode,
    setMode,
    prompt,
    setPrompt,
    model,
    setModel,
    activeModel,
    params,
    setParams,
    styleId,
    setStyleId,
    results,
    isGenerating,
    generate,
    remove,
  } = useImagineStudio({ enabled: viewMode === 'studio' });

  // Reuse chat's conversation pattern for Imagine agent — single hook, shared
  // between header badge and the drawer. This is the same `getSessions`/
  // `createSession`/`deleteSession` shape as `chatService`.
  const agent = useImagineAgent();

  const patch = (next: Partial<typeof params>) => setParams(prev => ({ ...prev, ...next }));

  const header = (
    <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3.5 border-b border-border/40 min-h-14">
      <div className="flex items-center gap-2 min-w-0">
        <SidebarMenuButton />
        {viewMode === 'agent' && (
          <button
            onClick={() => setShowAgentHistory(true)}
            className="p-2 rounded-lg border border-border/60 bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Conversation history"
            title="Conversations — independent contexts"
          >
            <History className="h-4 w-4" />
          </button>
        )}
        <Palette size={18} className="text-primary shrink-0" />
        <h1 className="text-lg font-semibold truncate">Imagine</h1>
        {viewMode === 'agent' && agent.conversations.length > 0 && (
          <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            {agent.conversations.length} chats
          </span>
        )}
      </div>
      <div className="flex p-1 bg-muted rounded-lg border border-border shrink-0">
        {(['agent', 'studio'] as const).map(view => (
          <button
            key={view}
            onClick={() => setViewMode(view)}
            className={cn(
              'px-4 py-1.5 rounded-md text-xs font-semibold capitalize transition-colors',
              viewMode === view
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {view}
          </button>
        ))}
      </div>
    </div>
  );

  // Agent history drawer — reuses StandaloneChat's drawer pattern (overlay + fixed left)
  const agentHistoryDrawer = viewMode === 'agent' && (
    <>
      {showAgentHistory && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setShowAgentHistory(false)} />
      )}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[85vw] max-w-[320px] flex-col border-r bg-card shadow-xl transition-transform duration-300 md:absolute md:shadow-none',
          showAgentHistory ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary/70" />
            <span className="text-xs font-bold tracking-wide">Conversations</span>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{agent.conversations.length}</span>
          </div>
          <button onClick={() => setShowAgentHistory(false)} className="rounded-lg p-1.5 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-3">
          <button
            onClick={() => {
              agent.newConversation();
              setShowAgentHistory(false);
            }}
            className="flex w-full items-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> New conversation
          </button>
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-muted-foreground">Each thread is isolated — history stays per-thread. Saves tokens.</p>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {agent.isLoadingConversations ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : agent.conversations.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">No chats yet. Start one.</p>
          ) : (
            <div className="space-y-1">
              {agent.conversations.map((c) => (
                <div
                  key={c.id}
                  onClick={() => {
                    void agent.switchConversation(c.id);
                    setShowAgentHistory(false);
                  }}
                  className={cn(
                    'group flex items-center gap-2 rounded-lg px-3 py-2.5 text-left cursor-pointer transition-colors border',
                    agent.conversationId === c.id ? 'bg-primary/10 border-primary/20' : 'hover:bg-muted/60 border-transparent'
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{c.title || 'Untitled'}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{c.last_message ? `${c.last_message.role === 'user' ? 'You: ' : ''}${c.last_message.content.slice(0, 44)}` : 'No messages'}</div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!confirm('Delete this conversation?')) return;
                      void agent.deleteConversation(c.id);
                    }}
                    className="rounded-md p-1 opacity-0 group-hover:opacity-100 hover:bg-destructive hover:text-white"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );

  if (viewMode === 'agent') {
    return (
      <div className="flex flex-col h-full bg-background text-foreground overflow-hidden relative">
        {header}
        {credentialMissing && <MissingCredentialBanner detail={credentialMissing} />}
        <div className="flex flex-1 min-h-0 overflow-hidden relative">
          {agentHistoryDrawer}
          <div className="flex-1 min-h-0">
            <ImagineChat
              capabilities={capabilities}
              onRefreshCatalog={refreshCatalog}
              isRefreshingCatalog={isRefreshing}
              agent={agent}
              showHistory={showAgentHistory}
              onShowHistoryChange={setShowAgentHistory}
            />
          </div>
        </div>
      </div>
    );
  }

  const controls = (
    <GenerationControls kind={mode} model={activeModel} params={params} onChange={patch} />
  );

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
      {header}
      {credentialMissing && <MissingCredentialBanner detail={credentialMissing} />}

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto custom-scrollbar">
          <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 py-5 space-y-6">
            {/* Modality */}
            <div className="flex items-center justify-center">
              <div className="flex p-1 bg-muted rounded-lg border border-border">
                {MODES.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setMode(tab.id)}
                    className={cn(
                      'flex items-center gap-2 px-5 sm:px-7 py-2 rounded-md text-xs font-semibold transition-colors',
                      mode === tab.id
                        ? 'bg-card text-foreground shadow-sm border border-border'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <tab.icon size={14} />
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Model — on the page, one click, no dialog required. */}
            <section className="space-y-2">
              <SectionLabel
                aside={
                  activeModel && (
                    <span className="text-[11px] text-muted-foreground/60 truncate max-w-[220px]">
                      {activeModel.provider}
                    </span>
                  )
                }
              >
                Model
              </SectionLabel>
              <ModelRail
                kind={mode}
                capabilities={capabilities}
                value={model}
                onChange={setModel}
                onBrowseAll={() => setBrowseOpen(true)}
                onRefresh={refreshCatalog}
                isRefreshing={isRefreshing}
                isLoading={isLoadingCatalog}
              />
            </section>

            {/* Prompt */}
            <section className="space-y-2.5">
              <div className="rounded-lg border border-border/60 bg-card focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/5 transition-colors">
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  onKeyDown={e => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault();
                      void generate();
                    }
                  }}
                  placeholder={PLACEHOLDERS[mode]}
                  className="w-full min-h-[104px] p-4 text-[15px] bg-transparent outline-none resize-none leading-relaxed placeholder:text-muted-foreground/35"
                />
                <div className="flex items-center gap-1.5 px-3 py-2.5 border-t border-border/40 flex-wrap">
                  {mode !== 'audio' && (
                    <PillSelect
                      label="Ratio"
                      options={activeModel?.aspect_ratios ?? []}
                      value={params.aspectRatio}
                      onChange={aspectRatio => patch({ aspectRatio })}
                    />
                  )}
                  {mode !== 'audio' && (
                    <PillSelect
                      label={mode === 'video' ? 'Resolution' : 'Size'}
                      options={activeModel?.resolutions ?? []}
                      value={params.resolution}
                      onChange={resolution => patch({ resolution })}
                    />
                  )}
                  {mode === 'video' && (
                    <PillSelect
                      label="Length"
                      options={activeModel?.durations ?? []}
                      value={params.duration}
                      onChange={duration => patch({ duration })}
                      format={d => `${d}s`}
                    />
                  )}
                  {mode === 'audio' && (
                    <PillSelect
                      label="Voice"
                      options={activeModel?.voices ?? []}
                      value={params.voice}
                      onChange={voice => patch({ voice })}
                    />
                  )}
                  <button
                    onClick={() => setOptionsOpen(true)}
                    title="All options"
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border border-border/60 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                  >
                    <Settings2 size={11} />
                    More
                  </button>

                  <div className="ml-auto flex items-center gap-2 shrink-0 pl-2">
                    <span className="hidden sm:block text-[11px] text-muted-foreground/50">⌘↵</span>
                    <SendButton
                      onClick={() => void generate()}
                      busy={isGenerating}
                      disabled={!prompt.trim() || !model}
                      title="Generate"
                    />
                  </div>
                </div>
              </div>

              {!prompt.trim() && (
                <div className="flex flex-wrap gap-1.5">
                  {STARTERS[mode].map(starter => (
                    <button
                      key={starter}
                      onClick={() => setPrompt(starter)}
                      className="text-[11px] px-2.5 py-1.5 rounded-lg border border-border/50 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* Style */}
            {mode !== 'audio' && (
              <section className="space-y-2">
                <SectionLabel>Style</SectionLabel>
                <StyleGallery kind={mode} value={styleId} onChange={setStyleId} />
              </section>
            )}

            {/* Results */}
            <section className="space-y-3">
              <SectionLabel
                aside={
                  <span className="text-[11px] text-muted-foreground/60">
                    {results.length} {results.length === 1 ? 'result' : 'results'}
                  </span>
                }
              >
                Your creations
              </SectionLabel>

              {results.length === 0 && !isGenerating ? (
                <div className="flex flex-col items-center justify-center py-14 text-center rounded-lg border border-dashed border-border/50">
                  <div className="h-12 w-12 rounded-lg bg-muted/50 flex items-center justify-center">
                    <ImageIcon size={20} className="text-muted-foreground/40" />
                  </div>
                  <p className="mt-3.5 text-sm font-medium">Nothing generated yet</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                    Pick a model, describe what you want, and your results collect here.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {isGenerating && (
                    <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 aspect-square flex flex-col items-center justify-center gap-3 p-6">
                      <Loader2 size={24} className="animate-spin text-primary" />
                      <p className="text-xs font-semibold text-primary">Generating {mode}…</p>
                      <p className="text-[11px] text-muted-foreground text-center line-clamp-2">
                        {prompt || activeModel?.name}
                      </p>
                    </div>
                  )}
                  {results.map(result => (
                    <ResultCard
                      key={result.id}
                      generation={result}
                      onOpen={(g, url) => setLightbox(toLightboxItem(g, url))}
                      onDelete={id => void remove(id)}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>

        {/* Options rail */}
        <aside className="hidden xl:flex w-[310px] shrink-0 border-l border-border/40 bg-card/30 flex-col">
          <div className="px-5 py-4 border-b border-border/40 flex items-center gap-2">
            <Settings2 size={14} className="text-primary" />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Options
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
            {activeModel ? (
              <>
                <div className="mb-5 pb-5 border-b border-border/40">
                  <div className="text-sm font-semibold">{activeModel.name}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {activeModel.provider}
                  </div>
                  {activeModel.description && (
                    <p className="text-[11px] text-muted-foreground/80 leading-relaxed mt-2 line-clamp-4">
                      {activeModel.description}
                    </p>
                  )}
                </div>
                {controls}
              </>
            ) : (
              <p className="text-xs text-muted-foreground flex items-start gap-2">
                <Info size={13} className="shrink-0 mt-0.5" />
                Select a model to see the options it supports.
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* Options drawer — the only route below `xl`, and the "More" target above it */}
      {optionsOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex justify-end"
          onClick={() => setOptionsOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Generation options"
            onClick={e => e.stopPropagation()}
            className="w-[88vw] max-w-sm h-full bg-card border-l border-border flex flex-col"
          >
            <div className="px-5 py-4 border-b border-border/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings2 size={14} className="text-primary" />
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Options
                </h2>
              </div>
              <button
                onClick={() => setOptionsOpen(false)}
                className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground"
                aria-label="Close options"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">{controls}</div>
            <div className="p-4 border-t border-border/40">
              <button
                onClick={() => setOptionsOpen(false)}
                className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full-catalog search, opened from the rail's "Browse all" tile. Rendered
          headless: the rail is the trigger, so the picker's own button is not
          wanted here. */}
      {browseOpen && (
        <ModelPicker
          kind={mode}
          capabilities={capabilities}
          value={model}
          onChange={setModel}
          onRefresh={refreshCatalog}
          isRefreshing={isRefreshing}
          openOnMount
          hideTrigger
          onClose={() => setBrowseOpen(false)}
        />
      )}

      <Lightbox
        isOpen={!!lightbox}
        onClose={() => setLightbox(null)}
        result={lightbox}
        onDelete={id => void remove(id)}
      />
    </div>
  );
}
