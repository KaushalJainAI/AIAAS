/**
 * React Query hooks for Explore: the catalogue, installs, and publishing.
 *
 * Installs and publishes change the agent list (`agents` key, shared with the
 * agents feature) and the catalogue's install counts, so both are invalidated.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { agentKeys } from '../agents/queries';
import { installedAgentsApi, templatesApi } from './api';
import type { InstallTemplateBody, PublishInput, TemplateListParams } from './types';

export const exploreKeys = {
  all: ['explore'] as const,
  templates: (params?: TemplateListParams) => ['explore', 'templates', params ?? {}] as const,
  template: (slug: string) => ['explore', 'template', slug] as const,
  sharePreview: (agentId: number | string) => ['explore', 'share-preview', agentId] as const,
  publicAgent: (slug: string) => ['explore', 'public', slug] as const,
};

/** The catalogue: curated and community entries, or one source, or the caller's own. */
export function useTemplates(params?: TemplateListParams) {
  return useQuery({
    queryKey: exploreKeys.templates(params),
    queryFn: () => templatesApi.list(params),
  });
}

export function useTemplate(slug: string) {
  return useQuery({
    queryKey: exploreKeys.template(slug),
    queryFn: () => templatesApi.get(slug),
    enabled: slug.length > 0,
  });
}

/** Install one entry as the caller's own agent. */
export function useInstallTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      slug,
      body,
    }: {
      slug: string;
      body?: InstallTemplateBody;
    }) => templatesApi.install(slug, body),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: agentKeys.agents });
      void queryClient.invalidateQueries({ queryKey: exploreKeys.all });
    },
  });
}

/** Install a whole pack in one request. Idempotent on the server. */
export function useInstallPack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pack: string) => templatesApi.installPack(pack),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: agentKeys.agents });
      void queryClient.invalidateQueries({ queryKey: exploreKeys.all });
    },
  });
}

/** What publishing this agent would send. Enabled only while the publish sheet is open. */
export function useSharePreview(agentId: number, enabled = true) {
  return useQuery({
    queryKey: exploreKeys.sharePreview(agentId),
    queryFn: () => templatesApi.sharePreview(agentId),
    enabled: enabled && Number.isFinite(agentId),
  });
}

/** Publish, or republish, one of the caller's agents. */
export function usePublishAgent(agentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PublishInput) => templatesApi.publish(agentId, body),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: exploreKeys.all });
      void queryClient.invalidateQueries({ queryKey: agentKeys.agent(agentId) });
    },
  });
}

/** Withdraw an agent from the listing. Copies already installed keep working. */
export function useUnpublishAgent(agentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => templatesApi.unpublish(agentId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: exploreKeys.all });
      void queryClient.invalidateQueries({ queryKey: agentKeys.agent(agentId) });
    },
  });
}

/** A publicly shared agent, with no account. */
export function usePublicAgent(slug: string) {
  return useQuery({
    queryKey: exploreKeys.publicAgent(slug),
    queryFn: () => templatesApi.publicGet(slug),
    enabled: slug.length > 0,
    retry: false,
  });
}

/**
 * Uninstall: delete the installed copies one at a time, the same as the web. One
 * row per request keeps each deletion's ownership check on its own.
 */
export function useUninstallAgents() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (agentIds: number[]) => {
      for (const id of agentIds) await installedAgentsApi.remove(id);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: agentKeys.agents });
      void queryClient.invalidateQueries({ queryKey: exploreKeys.all });
    },
  });
}
