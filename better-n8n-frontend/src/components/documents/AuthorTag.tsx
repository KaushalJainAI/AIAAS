/**
 * "by <name>" for a file an agent wrote, in the agent's colour.
 *
 * Only agent authors get the tag: a file a person wrote in chat is theirs, and
 * saying so would be noise. Renders nothing for old rows (`author` is absent)
 * and for every non-agent author, so older servers look exactly as before.
 */
import type { DocumentAuthor } from '../../api/documents';
import { cn } from '../../lib/utils';

export default function AuthorTag({
  author,
  className,
}: {
  author: DocumentAuthor | null | undefined;
  className?: string;
}) {
  if (!author || author.kind !== 'agent' || !author.name) return null;
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded bg-agent-subtle px-1.5 py-px text-[11px] text-agent',
        className,
      )}
      title={`Written by the agent ${author.name}`}
    >
      <span className="truncate">by {author.name}</span>
    </span>
  );
}
