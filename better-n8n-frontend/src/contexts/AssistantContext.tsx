import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { credentialsService } from '../api';
import { useAIModels } from '../hooks/useAIModels';
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from '../hooks/useChatModelSelection';
import { useAuth } from './authState';
import { tokenManager } from '../api/client';

import { AssistantContext } from './assistantState';

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  // **Inherit the account default, then diverge.** A stored local choice wins;
  // with none, this falls back to the profile's model (the Settings page), and
  // only to the shipped constants if the profile has not loaded or says
  // nothing. That ordering is the whole rule: the account default seeds this
  // place, and the moment someone chooses here it is independent for good.
  //
  // What it deliberately no longer does is write *back* to the profile.
  // `updateLlmProvider` / `updateLlmModel` / `syncLlmSettings` each used to
  // POST `/orchestrator/settings/update/`, which writes
  // `UserProfile.llm_provider` and `llm_model` — so choosing a model here
  // silently rewrote the account default that Settings edits, and every place
  // seeded from it. Two surfaces writing one row is not two settings.
  // The credential used to be synced to `settings/update/`; no model call ever
  // read what it wrote, and the route was retired 2026-09-18. Which key a call
  // uses is resolved per provider by `llm.access`, from the user's vault.
  const { user } = useAuth();
  const [llmProvider, setLlmProvider] = useState(
    () => localStorage.getItem('orchestrator_llm_provider') || '',
  );
  const [llmModel, setLlmModel] = useState(
    () => localStorage.getItem('orchestrator_llm_model') || '',
  );
  // Blank means the model's own default, so `??` rather than `||` — see
  // `useEffortSelection`, where the same distinction is load-bearing.
  const [llmEffort, setLlmEffort] = useState(
    () => localStorage.getItem('orchestrator_llm_effort') ?? '',
  );

  // Derived, never written into state: an effect that copied the profile in
  // would race the profile load and could overwrite a local choice made before
  // it landed. Falling back at read time cannot.
  const effectiveProvider = llmProvider || user?.llm_provider || DEFAULT_PROVIDER;

  // Every function on the context value is memoised. They are all listed in the
  // `useMemo` at the bottom, so a fresh identity per render made that memo
  // recompute every render — which meant the context value changed identity
  // every render, and *every consumer of this provider re-rendered on every
  // render of it*. A `useMemo` whose dependencies are rebuilt each time is not
  // a memo, it is overhead.
  const toggleAssistant = useCallback(() => setIsAssistantOpen(prev => !prev), []);
  const openAssistant = useCallback(() => setIsAssistantOpen(true), []);
  const closeAssistant = useCallback(() => setIsAssistantOpen(false), []);

  const { providers: dynamicProviders, isLoading: isModelsLoading, meta: catalogueMeta } = useAIModels();

  // A stored model the chosen provider no longer lists falls back to the
  // platform fallback when this provider serves it (the id the backend would
  // substitute anyway), else to that provider's first model. Derived rather
  // than written back into state by an effect (which rendered the retired
  // model for a frame, then re-rendered); only the persisted copy is
  // corrected, and that is a side effect proper.
  const staleModelFallback = useMemo(() => {
    if (isModelsLoading || dynamicProviders.length === 0) return null;
    const currentProvider = dynamicProviders.find(p => p.slug === llmProvider);
    if (!currentProvider || currentProvider.models.length === 0) return null;
    if (currentProvider.models.some(m => m.value === llmModel)) return null;
    const platformFallback = catalogueMeta?.fallback?.model;
    if (platformFallback && currentProvider.models.some(m => m.value === platformFallback)) {
      return platformFallback;
    }
    return currentProvider.models[0].value;
  }, [dynamicProviders, isModelsLoading, catalogueMeta, llmProvider, llmModel]);
  const effectiveModel = (staleModelFallback ?? llmModel) || user?.llm_model || DEFAULT_MODEL;

  useEffect(() => {
    if (staleModelFallback) localStorage.setItem('orchestrator_llm_model', staleModelFallback);
  }, [staleModelFallback]);

  const { data: hasCredentials = null, refetch } = useQuery({
    queryKey: ['credentials', llmProvider],
    enabled: tokenManager.isAuthenticated(),
    queryFn: async () => {
      try {
        if (llmProvider === 'ollama') {
          return true;
        }
        
        const { credentials } = await credentialsService.list();
        const providerSlug = llmProvider.toLowerCase();
        const hasValid = credentials.some(c => 
          c.is_valid && 
          (String(c.credential_type_display).toLowerCase().includes(providerSlug) || 
           String(c.name).toLowerCase().includes(providerSlug) ||
           (c.credential_type && String(c.credential_type).toLowerCase().includes(providerSlug)))
        );
        
        return hasValid;
      } catch (err) {
        console.error('Failed to check credentials:', err);
        // Fallback
        const prov = dynamicProviders.find(p => p.slug === llmProvider);
        if (prov) {
          return prov.has_credentials;
        } else {
          return false;
        }
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  // Local only. Changing the provider here must not move the account default —
  // see the note above the state declarations.
  const updateLlmProvider = useCallback((provider: string) => {
    setLlmProvider(provider);
    localStorage.setItem('orchestrator_llm_provider', provider);

    // The old model almost certainly belongs to the old provider, so both move
    // together rather than leaving a pair that cannot be routed.
    const defaultModel = dynamicProviders.find(p => p.slug === provider)?.models[0]?.value;
    if (defaultModel) {
      setLlmModel(defaultModel);
      localStorage.setItem('orchestrator_llm_model', defaultModel);
    }
  }, [dynamicProviders]);

  const updateLlmModel = useCallback((model: string) => {
    setLlmModel(model);
    localStorage.setItem('orchestrator_llm_model', model);
  }, []);

  const updateLlmEffort = useCallback((level: string) => {
    setLlmEffort(level);
    // `''` is a real choice — the model's own default — so it is stored as an
    // empty string rather than removed, which would read as "never chose" and
    // fall back to the account default on the next load.
    localStorage.setItem('orchestrator_llm_effort', level);
  }, []);

  const refreshCredentials = useCallback(async () => {
    await refetch();
  }, [refetch]);

  // The object literal was rebuilt on every render of this provider, so every
  // consumer re-rendered with it — including the whole chat panel, on a
  // provider that also owns model-selection state that changes while typing.
  const value = useMemo(
    () => ({
      isAssistantOpen,
      toggleAssistant,
      openAssistant,
      closeAssistant,
      // The *effective* pair, so a consumer never has to know that a blank
      // local choice means "use the account default".
      llmProvider: effectiveProvider,
      setLlmProvider: updateLlmProvider,
      llmModel: effectiveModel,
      setLlmModel: updateLlmModel,
      llmEffort,
      setLlmEffort: updateLlmEffort,
      hasCredentials,
      refreshCredentials,
    }),
    [isAssistantOpen, toggleAssistant, openAssistant, closeAssistant,
     effectiveProvider, updateLlmProvider, effectiveModel, updateLlmModel,
     llmEffort, updateLlmEffort, hasCredentials, refreshCredentials],
  );

  return (
    <AssistantContext.Provider value={value}>
      {children}
    </AssistantContext.Provider>
  );
}

