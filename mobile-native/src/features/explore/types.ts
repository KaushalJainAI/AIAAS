/**
 * Explore: installable agents, and publishing into them.
 *
 * Copied from better-n8n-frontend/src/api/templates.ts, with the same names.
 * Two sources, one shape: a **curated** entry is code on the backend
 * (`agents/gallery/`); a **community** entry is an agent another user published.
 * `source` says which; installing does not care.
 *
 * `config` is a partial `AgentConfig` (the builder's shape), and the install
 * screen renders its permissions from it, so the screen and the runtime read the
 * same keys.
 */
import type { Agent, AgentConfig } from '../builder/types';

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
  /** Connections only: maps to an icon via the app's connector icon table. */
  icon_slug?: string;
  category?: string;
  doc_count?: number;
  backend?: string;
}

/**
 * What a template needs, named portably. Never an id: a template that pointed at
 * knowledge base 2 would, installed elsewhere, silently read somebody else's row
 * 2. The installer picks from `candidates`, which the server computed from their
 * own rows.
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
   * The one-click pack this installs with, if any, computed server-side from
   * `gallery.PACKS`. Always `null` on shared entries.
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
   * Whether this entry can run on this server. False when it holds a grant whose
   * engine is `none`. Installing it would be refused with 409. Absent on older
   * servers: read as available.
   */
  available?: boolean;
  /** Why not, when `available` is false. The tooltip and the 409 body. */
  unavailable_reason?: string;
}

/**
 * What publishing an agent *would* send, before anything is written. The author
 * sees the whole payload: the allow-listed config, and the requirements their
 * row ids became, labelled with those rows' own names.
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
  /** Reworded labels only. The server ignores any attempt to change a kind. */
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

/** What `POST templates/{slug}/install/` answers: the new agent, plus anything the install carried. */
export type InstallTemplateResult = Agent & Partial<InstallResult>;

/** `POST templates/install-pack/`: what was made, and what was skipped and why. */
export interface PackInstallResult {
  pack: string;
  installed: { slug: string; id: number; name: string }[];
  skipped: { slug: string; reason: string }[];
}

/**
 * A publicly shared agent, as somebody with no account sees it. A narrower shape
 * than `AgentTemplate` on purpose, mirroring the server's own narrower projection:
 * no `candidates` (there is no caller to fill a picker for) and no `is_mine`.
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

export interface TemplateListParams {
  source?: TemplateSource;
  /** Only the caller's own published entries. */
  mine?: boolean;
}

export interface InstallTemplateBody {
  name?: string;
  requirements?: RequirementChoices;
  /** Defaults to the device's zone. Only matters for a template that ships a schedule. */
  timezone?: string;
}
