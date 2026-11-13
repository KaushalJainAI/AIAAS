/**
 * Explore: templates, installs and publishing over HTTP.
 *
 * Mirrors better-n8n-frontend/src/api/templates.ts, path for path. The only writes
 * are `install`, which creates an ordinary agent the entry then has no further
 * hold over; `installPack`, which does the same for a group; and `publish` /
 * `unpublish`, which turn one of the caller's own agents into a listing.
 *
 * Backend: `agents/views/gallery.py` and the sharing routes on
 * `/api/orchestrator/` (see `Backend/docs/API.md`).
 */
import { api } from '../../api/client';
import type {
  AgentTemplate,
  InstallTemplateBody,
  InstallTemplateResult,
  PackInstallResult,
  PublicAgent,
  PublishInput,
  SharePreview,
  TemplateListParams,
} from './types';

/** DRF returns a bare list or a `{results}` envelope depending on pagination. Mirrors web `asArray`. */
function listOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const results = (data as { results?: unknown }).results;
    if (Array.isArray(results)) return results as T[];
  }
  return [];
}

/** The device's zone, which the install sends so a scheduled template fires where the user is. */
function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export const templatesApi = {
  /** Everything installable: curated entries and community ones. Filter by `source` or `mine`. */
  list: async (params: TemplateListParams = {}): Promise<AgentTemplate[]> =>
    listOf<AgentTemplate>(
      await api<unknown>('/orchestrator/templates/', {
        query: {
          source: params.source,
          mine: params.mine ? 1 : undefined,
        },
      }),
    ),

  get: (slug: string) => api<AgentTemplate>(`/orchestrator/templates/${slug}/`),

  /**
   * Install as one of the caller's own agents. The server refuses an entry whose
   * grants cannot run here with 409, and the message says why.
   */
  install: (slug: string, body: InstallTemplateBody = {}) =>
    api<InstallTemplateResult>(`/orchestrator/templates/${slug}/install/`, {
      method: 'POST',
      body: { ...body, timezone: body.timezone ?? deviceTimezone() },
    }),

  /**
   * Install a whole pack (e.g. `office`) in one request. Idempotent: what is
   * already installed is skipped, and templates that need setup are listed
   * rather than half-installed.
   */
  installPack: (pack: string) =>
    api<PackInstallResult>('/orchestrator/templates/install-pack/', {
      method: 'POST',
      body: { pack },
    }),

  /** What publishing this agent would send. Writes nothing. */
  sharePreview: (agentId: number | string) =>
    api<SharePreview>(`/orchestrator/agents/${agentId}/share/`),

  /** Publish, or republish. Republishing keeps the slug and bumps the version. */
  publish: (agentId: number | string, body: PublishInput) =>
    api<AgentTemplate>(`/orchestrator/agents/${agentId}/share/`, { method: 'POST', body }),

  /**
   * Withdraw from the listing. Not a delete: copies people already installed keep
   * working, and relisting reuses the same link.
   */
  unpublish: (agentId: number | string) =>
    api<void>(`/orchestrator/agents/${agentId}/share/`, { method: 'DELETE' }),

  /**
   * One publicly shared agent, readable with no account. Sent without a bearer
   * token: this endpoint is anonymous, and a 401 here means "not found", not
   * "sign in again".
   *
   * Every refusal is the same 404 by design (link-only, platform-only, withdrawn
   * and never-existed look identical from outside).
   */
  publicGet: (slug: string) =>
    api<PublicAgent>(`/orchestrator/public/agents/${slug}/`, { auth: false }),
};

/**
 * Uninstall: delete one of the caller's installed agents. The web's Templates page
 * does the same through the agents API (`DELETE orchestrator/agents/{id}/`). Its
 * past runs stay on Runs, marked as deleted.
 */
export const installedAgentsApi = {
  remove: (agentId: number) => api<void>(`/orchestrator/agents/${agentId}/`, { method: 'DELETE' }),
};
