/**
 * Choose individual tools from one connection — the `selected` mode.
 *
 * The serializer and the runtime have supported `{id, mode: 'selected',
 * tools}` since connector scopes landed; the board only ever offered `all` and
 * `read`, so "this agent may search my mail and draft replies, but not send"
 * could not be said without editing JSON. The list comes from the same
 * `/mcp/servers/{id}/tools/` the Connections page reads — for a native
 * connector that is our own registry, for an MCP server its live catalogue.
 *
 * Names the server no longer advertises are kept and shown as missing rather
 * than silently dropped: the runtime intersects with the live catalogue
 * anyway, and dropping them here would change a saved selection the user did
 * not touch.
 */
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { mcpService } from '../../api/mcp';

export default function ConnectorToolPicker({ serverId, value, onChange }: {
  serverId: number;
  value: string[];
  onChange: (tools: string[]) => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['connector-tools', serverId],
    queryFn: () => mcpService.getTools(serverId),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (isLoading) {
    return (
      <p className="flex items-center gap-1.5 px-2 py-1 text-[12px] text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" /> Loading this connection&apos;s tools…
      </p>
    );
  }
  if (error) {
    const detail = (error as { response?: { data?: { error?: string } } }).response?.data?.error;
    return (
      <p className="px-2 py-1 text-[12px] text-destructive">
        Could not list its tools{detail ? `: ${detail}` : '.'} Pick “Read only” or
        “Everything” instead, or try again from Connections.
      </p>
    );
  }

  const tools = data?.tools ?? [];
  const chosen = new Set(value);
  const known = new Set(tools.map((t) => t.name));
  const missing = value.filter((name) => !known.has(name));
  const toggle = (name: string) => {
    const next = new Set(chosen);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange([...next].sort());
  };

  return (
    <div className="mt-1.5 max-h-56 overflow-y-auto rounded border border-border bg-background">
      {tools.length === 0 && (
        <p className="px-2 py-1.5 text-[12px] text-muted-foreground">This connection offers no tools.</p>
      )}
      {tools.map((tool) => (
        <label key={tool.name}
          className="flex items-start gap-2 px-2 py-1.5 hover:bg-secondary cursor-pointer">
          <input type="checkbox" checked={chosen.has(tool.name)}
            onChange={() => toggle(tool.name)} className="mt-0.5 accent-primary" />
          <span className="min-w-0">
            <span className="block text-[12px] font-mono">{tool.name}</span>
            {tool.description && (
              <span className="block text-[11px] text-muted-foreground line-clamp-2">
                {tool.description}
              </span>
            )}
          </span>
        </label>
      ))}
      {missing.map((name) => (
        <label key={name} className="flex items-start gap-2 px-2 py-1.5 opacity-60">
          <input type="checkbox" checked onChange={() => toggle(name)}
            className="mt-0.5 accent-primary" />
          <span className="text-[12px] font-mono">
            {name} <span className="font-sans">— no longer offered</span>
          </span>
        </label>
      ))}
      {chosen.size === 0 && tools.length > 0 && (
        <p className="px-2 py-1.5 text-[11px] text-warning border-t border-border">
          Nothing chosen yet — until you pick at least one, this connection gives every tool.
        </p>
      )}
    </div>
  );
}
