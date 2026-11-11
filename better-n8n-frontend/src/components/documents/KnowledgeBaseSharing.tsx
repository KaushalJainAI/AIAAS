/**
 * Knowledge bases: share yours with an organisation, and see what the team shares.
 *
 * Two lists, both read from `GET /inference/knowledge-bases/`:
 * - "Yours": each knowledge base you own, with a switch to share it with an
 *   organisation you belong to. Sharing is read-only for the team: they can
 *   search it from a chat, they cannot upload to it or delete from it.
 * - "Team": knowledge bases your organisation shares, read-only. No upload or
 *   delete controls, because those stay with the owner.
 *
 * The rules live on the server. This component only asks, and shows what the
 * server answered.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Users } from 'lucide-react';

import knowledgeBasesService, { type KnowledgeBaseRow } from '../../api/knowledgeBases';
import type { Org } from '../../api/orgs';
import { apiErrorMessage } from '../../lib/apiError';
import { toast } from '../../lib/toastStore';
import { Switch } from '../ui/Switch';

const KEY = ['knowledge-bases'] as const;

/** The server caps the list; say so rather than look complete. */
function CutNotice() {
  return (
    <p className="mt-2 text-[12px] text-muted-foreground">
      Showing the first part of this list. The rest are not shown here.
    </p>
  );
}

function OwnRow({
  kb,
  orgs,
  onChange,
  busy,
}: {
  kb: KnowledgeBaseRow;
  orgs: Org[];
  onChange: (id: number, patch: { org?: number | null; shared_with_org?: boolean }) => void;
  busy: boolean;
}) {
  const [pick, setPick] = useState<number | null>(null);
  // The organisation a switch-on would share with: the one already chosen,
  // else the first the person belongs to.
  const target = kb.org ?? pick ?? orgs[0]?.id ?? null;
  const targetName = orgs.find((o) => o.id === target)?.name ?? 'your organisation';

  return (
    <li className="flex items-center gap-3 px-3 py-2.5 text-sm">
      <Database className="w-4 h-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <p className="truncate">{kb.name}</p>
        <p className="text-[12px] text-muted-foreground truncate">
          {kb.doc_count} documents · {kb.size_human}
          {kb.shared_with_org && kb.org != null
            ? ` · shared with ${orgs.find((o) => o.id === kb.org)?.name ?? 'your team'}`
            : ''}
        </p>
      </div>
      {orgs.length > 1 && !kb.shared_with_org && (
        <select
          value={target ?? ''}
          onChange={(e) => setPick(Number(e.target.value))}
          aria-label={`Organisation to share ${kb.name} with`}
          className="px-1.5 py-1 rounded border border-border bg-background text-[12px]"
        >
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
      {orgs.length > 0 && (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span className="hidden sm:inline">Share with {targetName}</span>
          <Switch
            checked={kb.shared_with_org}
            disabled={busy}
            label={`Share ${kb.name} with ${targetName}`}
            onChange={(on) =>
              on
                ? onChange(kb.id, { org: target, shared_with_org: true })
                : onChange(kb.id, { shared_with_org: false })
            }
          />
        </div>
      )}
    </li>
  );
}

export function KnowledgeBaseSharing({ orgs }: { orgs: Org[] }) {
  const queryClient = useQueryClient();
  const [teamOrgId, setTeamOrgId] = useState<number | null>(null);
  const activeTeam = orgs.some((o) => o.id === teamOrgId) ? teamOrgId : (orgs[0]?.id ?? null);

  const mine = useQuery({
    queryKey: [...KEY, 'mine'],
    queryFn: () => knowledgeBasesService.list(),
  });
  const team = useQuery({
    queryKey: [...KEY, 'org', activeTeam],
    queryFn: () => knowledgeBasesService.list(activeTeam),
    enabled: activeTeam != null,
  });

  const share = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: { org?: number | null; shared_with_org?: boolean } }) =>
      knowledgeBasesService.setSharing(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
    onError: (err) => toast.error('Could not change sharing', apiErrorMessage(err, 'Please try again.')),
  });

  const ownKbs = (mine.data?.knowledge_bases ?? []).filter((kb) => kb.is_mine);
  const teamKbs = (team.data?.knowledge_bases ?? []).filter((kb) => !kb.is_mine);

  return (
    <div className="space-y-6">
      <section aria-labelledby="kb-yours">
        <h3 id="kb-yours" className="flex items-center gap-2 text-sm font-medium">
          <Database className="w-4 h-4" /> Your knowledge bases
        </h3>
        {orgs.length === 0 && (
          <p className="mt-1 text-[12px] text-muted-foreground">
            Join an organisation to share a knowledge base with your team.
          </p>
        )}
        {ownKbs.length === 0 ? (
          <p className="mt-2 text-[12px] text-muted-foreground">No knowledge bases yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border/60 border border-border/60 rounded-lg bg-card/60">
            {ownKbs.map((kb) => (
              <OwnRow
                key={kb.id}
                kb={kb}
                orgs={orgs}
                busy={share.isPending}
                onChange={(id, patch) => share.mutate({ id, patch })}
              />
            ))}
          </ul>
        )}
        {mine.data?.truncated && <CutNotice />}
      </section>

      {orgs.length > 0 && (
        <section aria-labelledby="kb-team">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="kb-team" className="flex items-center gap-2 text-sm font-medium">
              <Users className="w-4 h-4" /> Team knowledge bases
            </h3>
            {orgs.length > 1 && (
              <select
                value={activeTeam ?? ''}
                onChange={(e) => setTeamOrgId(Number(e.target.value))}
                aria-label="Organisation"
                className="px-1.5 py-1 rounded border border-border bg-background text-[12px]"
              >
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {team.isLoading ? null : teamKbs.length === 0 ? (
            <p className="mt-2 text-[12px] text-muted-foreground">
              Nothing shared with this organisation yet.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border/60 border border-border/60 rounded-lg bg-card/60">
              {teamKbs.map((kb) => (
                <li key={kb.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <Database className="w-4 h-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate">{kb.name}</p>
                    <p className="text-[12px] text-muted-foreground truncate">
                      Shared by {kb.owner_name} · {kb.doc_count} documents
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {team.data?.truncated && <CutNotice />}
        </section>
      )}
    </div>
  );
}

export default KnowledgeBaseSharing;
