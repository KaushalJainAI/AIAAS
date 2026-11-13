/**
 * Provider, then model — the decision-model half of the Settings model card.
 *
 * Props only, no saving: the page's own Save sends `decision_provider` and
 * `decision_model` with everything else. Blank provider and model mean the
 * platform default, which is said by name so nobody wonders what "default" is.
 */
import { useQuery } from '@tanstack/react-query';
import Select from '../ui/Select';
import decisionsService, { decisionModelLabel } from '../../api/decisions';

interface Props {
  provider: string;
  model: string;
  onChange: (next: { provider: string; model: string }) => void;
}

export default function DecisionModelPicker({ provider, model, onChange }: Props) {
  const { data, isError } = useQuery({
    queryKey: ['decision-models', provider || 'default'],
    queryFn: () => decisionsService.list(provider || undefined),
    staleTime: 10 * 60 * 1000,
  });

  const providers = data?.providers ?? [];
  const models = data?.models ?? [];
  const fallback = data?.default;
  const defaultLabel = fallback ? `Platform default (${fallback.model})` : 'Platform default';
  const unverified = models.length === 1 && models[0].unverified;
  // A saved id the live list no longer has stays visible and selectable, so
  // opening Settings never silently changes someone's choice.
  const missing = model && !models.some((m) => m.id === model);

  return (
    <div className="p-4 bg-muted/50 rounded-md border border-primary/10 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">Decision model provider</p>
          <p className="text-sm text-muted-foreground">
            Answers the <code>decide</code> tool in chat and in every agent with the Decisions tool
          </p>
        </div>
        <Select
          value={provider}
          onChange={(val) => onChange({ provider: val, model: '' })}
          options={[
            { value: '', label: 'Platform default' },
            ...providers.map((p) => ({ value: p.slug, label: p.label })),
          ]}
          className="w-[250px]"
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">Decision model</p>
          <p className="text-sm text-muted-foreground">
            {isError
              ? 'Could not load the model list. Your saved choice is kept.'
              : unverified
                ? 'The provider’s model list is unreachable right now; only its default is shown.'
                : 'Newest first. Priced per input token; answers are free.'}
          </p>
        </div>
        <Select
          value={model}
          onChange={(val) => onChange({ provider: provider || data?.provider || '', model: val })}
          options={[
            { value: '', label: provider ? 'Provider default' : defaultLabel },
            ...(missing ? [{ value: model, label: `${model} (no longer listed)` }] : []),
            ...models.map((m) => ({ value: m.id, label: decisionModelLabel(m), is_free: m.is_free })),
          ]}
          showSearch
          className="w-[250px]"
        />
      </div>
    </div>
  );
}
