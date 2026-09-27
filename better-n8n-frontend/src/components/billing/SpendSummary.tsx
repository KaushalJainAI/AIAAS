/**
 * What model calls cost over the last 30 days — agents and chat together.
 *
 * Nothing in the app showed this. The only spend on screen was per agent on
 * Activity and per conversation in the chat header, and the endpoint behind
 * Insights summed agent runs only, so chat — for most people most of their
 * use — was in no total anywhere. Shown beside credits because the two are the
 * two meters and people confuse them: this is the providers' price, credits
 * are the platform's allowance for calls on its own key.
 */
import { useQuery } from '@tanstack/react-query';
import { Coins } from 'lucide-react';
import { logsService } from '../../api';
import { describeCost, formatCost, costQualifier } from '../../lib/cost';

const DAYS = 30;

export default function SpendSummary() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['cost-breakdown', DAYS],
    queryFn: () => logsService.getCostBreakdown(DAYS),
    staleTime: 60 * 1000,
  });

  const chat = data?.chat;
  const all = data?.all_cost_usd ?? data?.total_cost_usd;
  const allSource = data?.all_cost_source ?? data?.total_cost_source;

  return (
    <div className="p-6 rounded-lg border border-border bg-card">
      <div className="flex items-center gap-4">
        <div className="p-2.5 bg-secondary rounded-lg border border-border">
          <Coins className="w-5 h-5 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            Model spend, last {DAYS} days
          </p>
          <h3 className="text-2xl font-bold tabular-nums"
            title={all ? describeCost(all, allSource) : undefined}>
            {isLoading ? '…' : isError ? '—' : formatCost(all, allSource)}
            <span className="ml-1.5 text-sm font-normal text-muted-foreground">
              {costQualifier(allSource)}
            </span>
          </h3>
        </div>
      </div>
      {data && (
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted-foreground">Agent runs</dt>
          <dd className="text-right tabular-nums"
            title={describeCost(data.total_cost_usd, data.total_cost_source)}>
            {formatCost(data.total_cost_usd, data.total_cost_source)}
          </dd>
          <dt className="text-muted-foreground">Chat</dt>
          <dd className="text-right tabular-nums"
            title={chat ? describeCost(chat.cost_usd, chat.cost_source) : undefined}>
            {chat ? formatCost(chat.cost_usd, chat.cost_source) : '—'}
          </dd>
        </dl>
      )}
      <p className="mt-4 text-sm text-muted-foreground">
        What the model providers charge for your calls. On your own API key
        this is on your provider bill; on the platform&apos;s key the platform
        pays it and you use credits instead.
        {chat && chat.paid_by.platform + chat.paid_by.own_key > 0 && (
          <> Of your chat answers, {chat.paid_by.own_key} used your own key and{' '}
            {chat.paid_by.platform} the platform&apos;s.</>
        )}
      </p>
    </div>
  );
}
