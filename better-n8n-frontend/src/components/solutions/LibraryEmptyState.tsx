/**
 * The library's empty state (K3.3): it teaches the three ways a library fills,
 * and, when the person has no organisation yet, how to make one.
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ClipboardPen, FileUp, MessageSquare, Users } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '../ui/Button';

interface CardProps {
  icon: LucideIcon;
  title: string;
  body: string;
  action: ReactNode;
}

function Card({ icon: Icon, title, body, action }: CardProps) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-card/60 p-4">
      <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="flex-1 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
      <div className="pt-1">{action}</div>
    </div>
  );
}

export default function LibraryEmptyState({
  hasOrg,
  onWrite,
  onImport,
  teamHref,
}: {
  hasOrg: boolean;
  onWrite: () => void;
  onImport: () => void;
  /** Where "Create a team" leads: the Team tab, which holds the organisation settings. */
  teamHref: string;
}) {
  return (
    <section aria-labelledby="library-empty-heading" className="mx-auto max-w-3xl py-6">
      <h2 id="library-empty-heading" className="text-base font-medium">Nothing saved yet</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        The library fills in three ways. Pick one to start.
      </p>
      <div className={`mt-4 grid gap-3 sm:grid-cols-2 ${hasOrg ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>
        <Card
          icon={ClipboardPen}
          title="Write one"
          body="Describe a problem you solved and how you fixed it. It takes a few minutes."
          action={<Button size="sm" variant="secondary" onClick={onWrite}>Write one</Button>}
        />
        <Card
          icon={FileUp}
          title="Import from a document"
          body="Pick a Word, PDF, Markdown or text file from your library. The fixes in it arrive as drafts."
          action={<Button size="sm" variant="secondary" onClick={onImport}>Import from a document</Button>}
        />
        <Card
          icon={MessageSquare}
          title="Solve something in chat"
          body="When a fix works, give the answer a thumbs-up. We will draft it for you to review."
          action={<Link to="/ai-chat" className="text-[13px] text-primary hover:underline">Open chat</Link>}
        />
        {!hasOrg && (
          <Card
            icon={Users}
            title="Create a team"
            body="A team library is shared by everyone in the team. Create one to start sharing fixes."
            action={<Link to={teamHref} className="text-[13px] text-primary hover:underline">Go to the Team tab</Link>}
          />
        )}
      </div>
    </section>
  );
}
