/**
 * Connector tools held for review — the visible half of MCP tool pinning.
 *
 * A third-party server writes the descriptions the assistant reads, so a new
 * tool whose description is addressed to an AI, or any tool the server changed
 * after it was connected, is withheld until the person reads it here and
 * allows it (`mcp_integration/pinning.py`). Renders nothing when nothing is
 * held, which is almost always. Descriptions are third-party text: shown as a
 * plain string, never as markdown.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

import { mcpService } from '../../api/mcp';

export default function HeldToolsPanel() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['mcpHeldTools'],
    queryFn: () => mcpService.heldTools(),
    staleTime: 60 * 1000,
  });
  const approve = useMutation({
    mutationFn: ({ serverId, tool }: { serverId: number; tool: string }) =>
      mcpService.approveHeldTool(serverId, tool),
    onSuccess: (_, { tool }) => {
      toast.success(`${tool} is allowed again`);
      queryClient.invalidateQueries({ queryKey: ['mcpHeldTools'] });
    },
    onError: () => toast.error('Could not allow that tool. Please try again.'),
  });

  const groups = (data?.servers ?? []).filter((g) => g.tools.length > 0);
  if (groups.length === 0) return null;

  return (
    <section
      aria-labelledby="held-tools-heading"
      className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-4"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden />
        <div>
          <h2 id="held-tools-heading" className="text-sm font-semibold text-foreground">
            Some connector tools need your review
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            The assistant cannot see or use these until you allow them. Read what each one says
            first: a tool description is written by whoever runs that server.
          </p>
        </div>
      </div>
      {groups.map((group) => (
        <div key={group.server_id} className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {group.server_name}
          </h3>
          {group.tools.map((tool) => (
            <div key={tool.tool_name} className="rounded-md border border-border bg-card p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-sm text-foreground break-all">{tool.tool_name}</span>
                <button
                  type="button"
                  disabled={approve.isPending}
                  onClick={() => approve.mutate({ serverId: group.server_id, tool: tool.tool_name })}
                  className="min-h-9 px-3 text-xs font-semibold rounded-md border border-border hover:bg-muted disabled:opacity-50"
                >
                  Allow this tool
                </button>
              </div>
              <p className="text-xs text-amber-700 dark:text-amber-300">{tool.reason}</p>
              {tool.description && (
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words bg-muted/40 rounded p-2 max-h-40 overflow-auto">
                  {tool.description}
                </pre>
              )}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
