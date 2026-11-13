/**
 * Everything a builder screen needs: the agent's saved copy, the unsaved board,
 * the pickers' choices, and the actions that change the agent (save, discard,
 * duplicate, archive, delete).
 *
 * Every screen under `agents/[id]/edit` calls this with the same id, so they all
 * read one board. The `new` id is the create flow: the board starts from the
 * account's defaults and `save` creates the agent instead of updating it.
 */
import { useCallback, useMemo } from 'react';

import { useAccountProfile } from '../account/queries';
import { useToolCatalogue } from '../tools/queries';
import { useAgentConfig, useArchiveAgent, useCreateAgent, useDeleteAgent, useDuplicateAgent, useModelCatalogue, useSaveAgent } from './queries';
import { DEFAULT_AGENT, DEFAULT_MODEL, DEFAULT_PROVIDER } from './config';
import { useDraftEntry, adoptSaved, discardDraft, patchDraft, setDraftErrors } from './draft';
import { refusalFrom } from './refusal';
import { configFromAgent, grantedToolsFor } from './edits';
import { activeProviderFor, buildSavePayload, displayProviderFor, effectiveModelFor, effortLevelsFor, seedNewAgent, validateAgentDraft } from './payload';
import type { Agent, AgentConfig } from './types';
import { success, warning } from '../../lib/haptics';

export type SaveResult = { ok: true; agent: Agent } | { ok: false };

export function useBuilder(idParam: string | undefined) {
  const isNew = !idParam || idParam === 'new';
  const agentId = isNew ? null : Number(idParam);
  const key = isNew ? 'new' : String(agentId);

  const saved = useAgentConfig(agentId);
  const profile = useAccountProfile();
  const catalogue = useModelCatalogue();
  const toolCatalogue = useToolCatalogue();

  const userDefaultProvider = profile.data?.llm_provider || DEFAULT_PROVIDER;
  const userDefaultModel = profile.data?.llm_model || DEFAULT_MODEL;

  // The board's starting point. A new agent waits for the account defaults so it
  // is never seeded with the shipped constants and then re-seeded.
  const seed = useMemo<AgentConfig | null>(() => {
    if (isNew) {
      if (!profile.data && !profile.isError) return null;
      return seedNewAgent(DEFAULT_AGENT, profile.data ?? {});
    }
    return saved.data ? configFromAgent(saved.data) : null;
  }, [isNew, profile.data, profile.isError, saved.data]);

  const entry = useDraftEntry(key, seed);
  const cfg = entry?.cfg ?? null;
  const dirty = !!entry && JSON.stringify(entry.cfg) !== JSON.stringify(entry.base);

  const providers = catalogue.data?.providers ?? [];
  const displayProvider = cfg ? displayProviderFor(cfg, userDefaultProvider) : userDefaultProvider;
  const activeProvider = activeProviderFor(providers, displayProvider, userDefaultProvider);
  const effectiveModel = cfg ? effectiveModelFor(cfg, userDefaultModel, activeProvider) : '';
  const effortLevels = effortLevelsFor(activeProvider, effectiveModel);
  const grantedTools = useMemo(
    () => (cfg ? grantedToolsFor(toolCatalogue.data, cfg.tools) : []),
    [toolCatalogue.data, cfg],
  );

  const set = useCallback(
    <K extends keyof AgentConfig>(field: K, value: AgentConfig[K]) =>
      patchDraft(key, (c) => ({ ...c, [field]: value })),
    [key],
  );

  const create = useCreateAgent();
  const update = useSaveAgent(agentId ?? 0);
  const duplicate = useDuplicateAgent();
  const archive = useArchiveAgent(agentId ?? 0);
  const remove = useDeleteAgent();

  /** Check the board, then send it. Refusals land on the fields that caused them. */
  const save = useCallback(async (): Promise<SaveResult> => {
    if (!cfg) return { ok: false };
    const problems = validateAgentDraft(cfg);
    if (problems.length > 0) {
      const errors = Object.fromEntries(problems.map((p) => [p.field, p.message]));
      setDraftErrors(key, errors, problems[0].message);
      warning();
      return { ok: false };
    }
    const payload = buildSavePayload(cfg, {
      displayProvider,
      effectiveModel,
      grantedToolIds: grantedTools.map((t) => t.id),
    });
    try {
      const agent = isNew
        ? await create.mutateAsync(payload)
        : await update.mutateAsync(payload);
      adoptSaved(key, configFromAgent(agent));
      success();
      return { ok: true, agent };
    } catch (err) {
      const refusal = refusalFrom(err, 'Could not save this agent.');
      setDraftErrors(key, refusal.errors, refusal.summary);
      warning();
      return { ok: false };
    }
  }, [cfg, key, displayProvider, effectiveModel, grantedTools, isNew, create, update]);

  const discard = useCallback(() => discardDraft(key), [key]);

  return {
    isNew,
    agentId,
    key,
    saved: saved.data ?? null,
    savedError: saved.error,
    loading: !entry,
    cfg,
    base: entry?.base ?? null,
    dirty,
    errors: entry?.errors ?? {},
    summary: entry?.summary ?? null,
    set,
    setCfg: (next: AgentConfig) => patchDraft(key, () => next),
    providers,
    activeProvider,
    displayProvider,
    effectiveModel,
    effortLevels,
    userDefaultProvider,
    userDefaultModel,
    grantedTools,
    toolCatalogueLoaded: toolCatalogue.isSuccess,
    toolCatalogueError: toolCatalogue.error,
    save,
    saving: create.isPending || update.isPending,
    discard,
    duplicate: () =>
      duplicate.mutateAsync({ source: saved.data ?? cfg ?? {}, currentName: (saved.data ?? cfg)?.name ?? 'Agent' }),
    duplicating: duplicate.isPending,
    archive: () => archive.mutateAsync(),
    archiving: archive.isPending,
    remove: () => remove.mutateAsync(agentId ?? 0),
    removing: remove.isPending,
  };
}
