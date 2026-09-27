import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Brain, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import memoryService from '../../api/memory';
import { groupMemories } from '../../lib/memory';
import { ConfirmDialog } from '../ui/ConfirmDialog';

/**
 * Settings → Memory: what the assistant has stored about you.
 *
 * Every row here rides in the system prompt of every future turn, so a wrong
 * one keeps being wrong until it is removed — which is why this surface
 * exists alongside the `/memory` slash command: a command can forget what
 * you name, but only a list shows what there is. Grouped by the server's
 * categories, one delete per fact, one "clear all". Read-and-delete only, by
 * design: there is no "add" because a typed fact is a preference, and those
 * live on the profile.
 */
export default function MemoryTab() {
  const queryClient = useQueryClient();
  const [clearing, setClearing] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['memory'],
    queryFn: memoryService.list,
    staleTime: 30 * 1000,
  });
  const memories = data?.memories ?? [];
  const groups = groupMemories(memories);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['memory'] });
  };

  const forgetOne = useMutation({
    mutationFn: (id: number) => memoryService.remove(id),
    onSuccess: () => {
      invalidate();
      toast.success('Forgotten.');
    },
    onError: () => {
      toast.error('Could not forget that.');
    },
  });

  const clearAll = useMutation({
    mutationFn: () => memoryService.clearAll(),
    onSuccess: () => {
      invalidate();
      setClearing(false);
      toast.success('All memories cleared.');
    },
    onError: () => {
      setClearing(false);
      toast.error('Could not clear memories.');
    },
  });

  if (isLoading) {
    return <div className="h-16 rounded-lg bg-card border border-border/60 animate-pulse" />;
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-medium">Memory</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            What the assistant has learned about you in conversation. It reads
            this on every turn to personalise answers — remove anything wrong
            or that you would rather it not keep.
          </p>
        </div>
        {memories.length > 0 && (
          <button
            type="button"
            onClick={() => setClearing(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card text-muted-foreground text-[12px] font-semibold hover:bg-secondary shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear all
          </button>
        )}
      </div>

      {isError ? (
        <p className="text-[13px] text-destructive py-8">
          Could not load memories. Reload the page to try again.
        </p>
      ) : memories.length === 0 ? (
        <div className="mt-4 text-center py-8 border border-dashed border-border/60 rounded-lg bg-card/30">
          <Brain className="w-6 h-6 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="text-sm text-muted-foreground font-medium">Nothing remembered yet</p>
          <p className="text-[12px] text-muted-foreground mt-1 max-w-sm mx-auto px-4">
            Things you tell the assistant about yourself — how you work, what
            you are building — show up here, where you can review them.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          {groups.map((group) => (
            <section key={group.category}>
              <h4 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">
                {group.label}
                <span className="ml-2 tabular-nums normal-case font-normal">
                  {group.items.length}
                  {data?.max_per_category ? ` of ${data.max_per_category}` : ''}
                </span>
              </h4>
              <ul className="mt-2 space-y-2">
                {group.items.map((memory) => (
                  <li
                    key={memory.id}
                    className="p-3 rounded-lg border border-border/60 bg-card/60 flex gap-3 items-start"
                  >
                    <p className="flex-1 min-w-0 text-sm leading-relaxed">
                      {memory.text}
                    </p>
                    <button
                      type="button"
                      onClick={() => forgetOne.mutate(memory.id)}
                      disabled={forgetOne.isPending}
                      title="Forget this"
                      aria-label={`Forget "${memory.text}"`}
                      className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors shrink-0 disabled:opacity-50"
                    >
                      {forgetOne.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {clearing && (
        <ConfirmDialog
          title="Forget everything?"
          body="Every fact the assistant has stored about you is removed. It will learn them again only if you tell it again."
          confirmLabel="Forget everything"
          busy={clearAll.isPending}
          onConfirm={() => clearAll.mutate()}
          onCancel={() => setClearing(false)}
        />
      )}
    </div>
  );
}
