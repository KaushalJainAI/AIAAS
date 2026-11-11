/**
 * "Team documents" on the library tab: the knowledge bases the organisation
 * shares, as a short read-only list. Sharing is switched on from the Team tab,
 * by the person who owns the knowledge base; nothing here changes anything.
 */
import { useQuery } from '@tanstack/react-query';
import { Database } from 'lucide-react';

import knowledgeBasesService from '../../api/knowledgeBases';
import { Skeleton } from '../ui/Skeleton';

export default function TeamDocuments({ org }: { org: number }) {
  // The same query key KnowledgeBaseSharing uses for the team list, so both share one answer.
  const { data, isLoading, isError } = useQuery({
    queryKey: ['knowledge-bases', 'org', org],
    queryFn: () => knowledgeBasesService.list(org),
  });

  // A list-shaped placeholder: the section keeps its place while the shared bases load.
  if (isLoading) {
    return (
      <section aria-labelledby="team-documents-library" aria-busy="true" className="space-y-2">
        <h2 id="team-documents-library" className="text-sm font-medium">Team documents</h2>
        <div className="space-y-2 rounded-lg border border-border/60 bg-card/60 p-2">
          <Skeleton className="h-[44px] w-full" />
          <Skeleton className="h-[44px] w-full" />
        </div>
      </section>
    );
  }

  const shared = (data?.knowledge_bases ?? []).filter((kb) => !kb.is_mine);

  return (
    <section aria-labelledby="team-documents-library" className="space-y-2">
      <h2 id="team-documents-library" className="text-sm font-medium">Team documents</h2>
      {isError ? (
        <p className="text-[12px] text-muted-foreground">Team documents could not be loaded.</p>
      ) : shared.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">
          Nothing shared yet. A knowledge base is shared from the Team tab, by the person who owns it.
        </p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/60 bg-card/60">
          {shared.map((kb) => (
            <li key={kb.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <Database className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate">{kb.name}</p>
                <p className="truncate text-[12px] text-muted-foreground">
                  Shared by {kb.owner_name} · {kb.doc_count} documents
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
