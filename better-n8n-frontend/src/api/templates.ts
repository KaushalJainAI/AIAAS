/**
 * Explore — everything installable, and publishing into it.
 *
 * Two sources, one shape. A **curated** entry is code on the backend
 * (`agents/gallery/`); a **community** entry is an agent another user
 * published. They differ in provenance and in nothing the installer cares
 * about, so this file has one type for both and `source` says which it is.
 *
 * The only writes are `install`, which creates an ordinary agent that the
 * entry then has no further hold over, and `publish`, which turns one of your
 * own agents into a listing.
 *
 * `config` is a partial `AgentConfig` — the same shape the builder speaks —
 * and the install screen renders its permissions straight from it. That is
 * deliberate: the screen and the runtime read the same keys, so the screen
 * cannot promise something the runtime never checks.
 */
import apiClient from './client';
import { asArray } from './unwrap';
import type { Agent } from './agents';
import type { AgentConfig } from '../types/agentConfig';

export type RequirementType =
  | 'connector'
  | 'knowledge_base'
  | 'skill'
  | 'api_tool'
  | 'data_tool';

/** A frozen tool snapshot a requirement can install as your own copy. */
export interface ToolRequirementSnapshot {
  tool_kind: 'api' | 'data';
  config: Record<string, unknown>;
  auth_shape: {
    type?: string;
    needs?: { slug: string; field: string };
  };
}

/** Something the installer owns that could satisfy a requirement. */
export interface RequirementCandidate {
  id: number;
  label: string;
  /** Connections only — maps to an icon via `lib/connectorIcons.ts`. */
  icon_slug?: string;
  category?: string;
  doc_count?: number;
  backend?: string;
}

/**
 * What a template needs, named portably.
 *
 * Never an id: a template that pointed at knowledge base 2 would, installed
 * elsewhere, silently read somebody else's row 2. The installer picks from
 * `candidates`, which the server computed from their own rows.
 */
export interface TemplateRequirement {
  key: string;
  type: RequirementType;
  label: string;
  why: string;
  optional: boolean;
  /** A hint (an `icon_slug`) that reorders `candidates`; it never filters. */
  provider?: string;
  candidates: RequirementCandidate[];
  /** Custom tools only: the author's frozen copy, installable as your own. */
  snapshot?: ToolRequirementSnapshot;
  /** Custom tools only: the access mode the author used. */
  mode?: 'read' | 'all';
}

/** Where an entry came from. Presentation differs; installing does not. */
export type TemplateSource = 'curated' | 'community';

/**
 * Who may find a published agent. Three rungs, each strictly wider than the
 * last, and only the widest leaves the platform.
 */
export type ShareVisibility = 'link' | 'platform' | 'public';

export interface AgentTemplate {
  slug: string;
  source: TemplateSource;
  name: string;
  tagline: string;
  description: string;
  icon: string;
  tags: string[];
  /**
   * The one-click pack this installs with, if any — computed server-side from
   * `gallery.PACKS`, never stored, so the catalogue cannot disagree with the
   * pack. What the Explore page groups by. Always `null` on shared entries.
   */
  pack?: string | null;
  /** Community entries only: the publisher's display name, never their email. */
  author: string | null;
  /** Community entries only. */
  install_count: number | null;
  version: number | null;
  is_mine?: boolean;
  visibility?: ShareVisibility;
  is_listed?: boolean;
  updated_at?: string;
  requirements: TemplateRequirement[];
  /** The configuration this installs, and what the permissions screen shows. */
  config: Partial<AgentConfig>;
  /**
   * Whether this entry can run on this server. False when it holds a grant
   * whose engine is `none` (workspace, browser, e-sign…) — installing it
   * would write an agent that can only talk, so Explore badges it and the
   * install endpoints refuse it with 409. Absent on older servers: read as
   * available.
   */
  available?: boolean;
  /** Why not, when `available` is false. The tooltip and the 409 body. */
  unavailable_reason?: string;
}

/**
 * What publishing an agent *would* send, before anything is written.
 *
 * The point of previewing is that the author sees the whole payload: the
 * allow-listed config, and the requirements their row ids became — labelled
 * with those rows' own names, which is a fact about their account and is
 * therefore theirs to rewrite before confirming.
 */
export interface SharePreview {
  published: boolean;
  slug: string | null;
  visibility: ShareVisibility;
  is_listed: boolean;
  version: number;
  install_count: number;
  tagline: string;
  description: string;
  requirements: Omit<TemplateRequirement, 'candidates'>[];
  config: Partial<AgentConfig>;
}

export interface PublishInput {
  tagline: string;
  description?: string;
  visibility?: ShareVisibility;
  /** Reworded labels only — the server ignores any attempt to change a kind. */
  requirements?: { key: string; label: string; why: string; optional?: boolean }[];
}

/**
 * Requirement key -> what the installer chose: an id of their own row, or
 * `'install'` to take the author's frozen tool copy as a private tool.
 */
export type RequirementChoices = Record<string, number | 'install'>;

/** What an install can carry beyond the agent: auto-installed tool copies. */
export interface InstalledTool {
  tool: string;
  tool_kind: 'api' | 'data';
  connection_id: number;
  needs?: { slug: string; field: string };
}

export interface InstallResult {
  agent: Agent;
  installed_tools?: InstalledTool[];
  credentials_needed?: { tool: string; slug: string; field: string }[];
}

/**
 * A publicly shared agent, as somebody with no account sees it.
 *
 * A narrower shape than `AgentTemplate` on purpose, mirroring the server's own
 * narrower projection: there is no signed-in caller, so there are no
 * `candidates` to fill a picker with and no `is_mine` to compute. What is kept
 * is what a visitor needs to decide whether to sign up — what it does, what it
 * would be able to reach, and what they would have to supply.
 */
export interface PublicAgent {
  slug: string;
  source: 'community';
  name: string;
  tagline: string;
  description: string;
  icon: string;
  tags: string[];
  author: string;
  install_count: number;
  version: number;
  updated_at: string;
  requirements: Omit<TemplateRequirement, 'candidates'>[];
  config: Partial<AgentConfig>;
}

const templatesService = {
  list: async (params: { source?: TemplateSource; mine?: boolean } = {}): Promise<AgentTemplate[]> => {
    const { data } = await apiClient.get<AgentTemplate[]>('/orchestrator/templates/', {
      params: {
        ...(params.source ? { source: params.source } : {}),
        ...(params.mine ? { mine: 1 } : {}),
      },
    });
    return asArray<AgentTemplate>(data);
  },

  get: async (slug: string): Promise<AgentTemplate> => {
    const { data } = await apiClient.get<AgentTemplate>(`/orchestrator/templates/${slug}/`);
    return data;
  },

  /**
   * Install as one of your own agents.
   *
   * `timezone` only matters for a template that ships a schedule — the server
   * ignores it otherwise rather than storing a value nothing reads.
   */
  install: async (
    slug: string,
    body: { name?: string; requirements?: RequirementChoices; timezone?: string } = {},
  ): Promise<Agent & Partial<InstallResult>> => {
    const { data } = await apiClient.post<Agent & Partial<InstallResult>>(
      `/orchestrator/templates/${slug}/install/`,
      {
        ...body,
        timezone: body.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    );
    return data;
  },

  /**
   * Install a pack (e.g. "office") in one click. Idempotent: what is already
   * installed is skipped, and templates needing setup are listed rather than
   * installed.
   */
  installPack: async (pack: string): Promise<{
    pack: string;
    installed: { slug: string; id: number; name: string }[];
    skipped: { slug: string; reason: string }[];
  }> => {
    const { data } = await apiClient.post(
      '/orchestrator/templates/install-pack/',
      { pack },
    );
    return data;
  },

  /** What publishing this agent would send. Writes nothing. */
  sharePreview: async (agentId: number | string): Promise<SharePreview> => {
    const { data } = await apiClient.get<SharePreview>(
      `/orchestrator/agents/${agentId}/share/`,
    );
    return data;
  },

  /** Publish or republish. Republishing keeps the slug and bumps the version. */
  publish: async (agentId: number | string, body: PublishInput): Promise<AgentTemplate> => {
    const { data } = await apiClient.post<AgentTemplate>(
      `/orchestrator/agents/${agentId}/share/`,
      body,
    );
    return data;
  },

  /**
   * Withdraw from the listing. Not a delete: copies people already installed
   * keep working, and relisting reuses the same link.
   */
  unpublish: async (agentId: number | string): Promise<void> => {
    await apiClient.delete(`/orchestrator/agents/${agentId}/share/`);
  },

  /**
   * One publicly shared agent, readable with no account.
   *
   * Every refusal is the same 404 by design — `link`-only, platform-only,
   * withdrawn and never-existed are indistinguishable from outside — so the
   * caller can only say "not found", never why.
   */
  publicGet: async (slug: string): Promise<PublicAgent> => {
    const { data } = await apiClient.get<PublicAgent>(
      `/orchestrator/public/agents/${slug}/`,
    );
    return data;
  },
};

export default templatesService;
