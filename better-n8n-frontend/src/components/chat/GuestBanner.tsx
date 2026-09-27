/**
 * Guest-mode bar.
 *
 * Guests get a real, working assistant — the server ships an NVIDIA key — so the
 * tone here is "you are already using it", not "you are locked out". The bar
 * stays slim and states what is running; the specifics of what an account adds
 * are one click away rather than crammed into a sentence nobody finishes.
 *
 * It collapses to a pill, remembered per browser, because persistent chrome that
 * cannot be dismissed is just a tax on the people who already said no.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot,
  ChevronDown,
  X,
  History,
  Paperclip,
  Workflow,
  Database,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { prettyModel } from '../../lib/modelNames';
import SidebarMenuButton from '../layout/SidebarMenuButton';

const DISMISS_KEY = 'guest_banner_collapsed';

const UNLOCKS = [
  { icon: History, title: 'Conversations that persist', body: 'Right now this thread disappears when you close the tab.' },
  { icon: Paperclip, title: 'Upload files and documents', body: 'Ask questions against your own PDFs, spreadsheets and knowledge bases.' },
  { icon: Workflow, title: 'Build and run workflows', body: 'Turn a request into something that runs on a schedule, with approval gates.' },
  { icon: Database, title: 'Connect your own tools', body: 'Gmail, Drive, Sheets, MCP servers — with credentials stored encrypted.' },
];

export default function GuestBanner({ model }: { model?: string | null }) {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === '1'
  );
  const [open, setOpen] = useState(false);

  const collapse = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setCollapsed(true);
    setOpen(false);
  };

  if (collapsed) {
    return (
      <button
        onClick={() => {
          localStorage.removeItem(DISMISS_KEY);
          setCollapsed(false);
        }}
        className="absolute top-2 right-3 z-40 flex items-center gap-1.5 px-2.5 py-1 rounded border border-border bg-card/90 backdrop-blur text-[12px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        title="You are in guest mode"
      >
        <Bot className="w-3.5 h-3.5 text-primary" />
        Guest
      </button>
    );
  }

  return (
    <div className="absolute top-0 left-0 right-0 z-40">
      <div className="bg-primary-subtle border-b border-primary-line backdrop-blur-md px-2 md:px-4 py-1.5 min-h-14 md:min-h-0 flex items-center gap-2 md:gap-3 text-sm">
        <SidebarMenuButton />
        <Bot className="w-4 h-4 text-primary shrink-0 hidden sm:block" />

        <div className="min-w-0 flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-foreground">Guest mode</span>
          {/* Say what is actually answering, read from state rather than
              hardcoded — the two had already drifted apart once. */}
          <span className="text-muted-foreground">
            running on <span className="text-foreground">{prettyModel(model)}</span>
          </span>
        </div>

        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="What an account adds"
          className="ml-auto shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[13px] text-primary hover:bg-primary/10 transition-colors"
        >
          <span className="hidden sm:inline">What an account adds</span>
          <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
        </button>

        <button
          onClick={() => navigate('/login')}
          className="shrink-0 px-3 py-1 rounded bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 transition-colors"
        >
          Log in
        </button>
        <button
          onClick={collapse}
          aria-label="Hide guest banner"
          className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {open && (
        <div className="bg-card border-b border-border shadow-md px-4 py-4 animate-in fade-in duration-150">
          <div className="max-w-4xl mx-auto grid sm:grid-cols-2 gap-3">
            {UNLOCKS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex items-start gap-2.5">
                <span className="w-7 h-7 rounded bg-secondary border border-border flex items-center justify-center shrink-0">
                  <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-foreground">{title}</p>
                  <p className="text-[12px] text-muted-foreground leading-snug">{body}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="max-w-4xl mx-auto flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-border">
            <button
              onClick={() => navigate('/signup')}
              className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90"
            >
              Create an account
            </button>
            <button
              onClick={() => navigate('/login')}
              className="px-3 py-1.5 rounded border border-border text-[13px] hover:bg-secondary"
            >
              I already have one
            </button>
            <span className="ml-auto text-[12px] text-muted-foreground">
              Free — no card needed
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
