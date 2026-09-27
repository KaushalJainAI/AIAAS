/**
 * Custom Tools Service — the user's own API and database connections.
 *
 * A custom tool is a connection row, not code: the generic callers
 * (`call_api`, `query_sql`) are the runtime, and these rows are what they
 * read. Rows are private to the caller — another user's id is a 404 — and
 * auth is a vault reference (`type-slug.field`), never a value.
 *
 * Sharing mirrors agent sharing: publish freezes a snapshot without secrets,
 * install writes a private copy owned by the installer, and withdrawing
 * unlists rather than deletes.
 */
import apiClient from './client';
import { asArray } from './unwrap';
import type { ShareVisibility } from './templates';

export type CustomToolKind = 'api' | 'data';

export interface ApiAuth {
  type: 'none' | 'bearer' | 'basic' | 'header' | 'query';
  secret_ref?: string;
  header?: string;
  param?: string;
}

export interface ApiConnection {
  id: number;
  name: string;
  base_url: string;
  openapi_spec: Record<string, unknown>;
  auth: ApiAuth;
  allowed_methods: string[];
  operations_count: number;
  created_at: string;
  updated_at: string;
}

export interface DataConnection {
  id: number;
  kind: 'postgres' | 'mysql' | 'bigquery' | 'sqlite';
  name: string;
  host: string;
  port: number | null;
  database: string;
  username: string;
  secret_ref: string;
  vfs_path: string;
  ssl_mode: string;
  allow_write: boolean;
  created_at: string;
  updated_at: string;
}

/** What the installer must link after taking a copy — a type, never a value. */
export interface CredentialNeed {
  tool: string;
  slug: string;
  field: string;
}

export interface SharedTool {
  slug: string;
  tool_kind: CustomToolKind;
  name: string;
  tagline: string;
  description: string;
  author: string;
  is_mine: boolean;
  visibility: ShareVisibility;
  is_listed: boolean;
  install_count: number;
  version: number;
  updated_at: string;
  auth_shape: {
    type?: string;
    header?: string;
    param?: string;
    needs?: { slug: string; field: string };
  };
  operations_count: number | null;
  tool_config: Record<string, unknown>;
}

async function paged<T>(url: string): Promise<T[]> {
  const { data } = await apiClient.get<{ results: T[] }>(url);
  return asArray<T>(data);
}

export const datasourcesService = {
  // -- private rows -------------------------------------------------------
  listApi: (): Promise<ApiConnection[]> =>
    paged<ApiConnection>('/datasources/api-connections/'),
  createApi: async (body: Record<string, unknown>): Promise<ApiConnection> => {
    const { data } = await apiClient.post<ApiConnection>(
      '/datasources/api-connections/', body);
    return data;
  },
  updateApi: async (id: number, body: Record<string, unknown>): Promise<ApiConnection> => {
    const { data } = await apiClient.patch<ApiConnection>(
      `/datasources/api-connections/${id}/`, body);
    return data;
  },
  deleteApi: async (id: number): Promise<void> => {
    await apiClient.delete(`/datasources/api-connections/${id}/`);
  },

  listData: (): Promise<DataConnection[]> =>
    paged<DataConnection>('/datasources/data-connections/'),
  createData: async (body: Record<string, unknown>): Promise<DataConnection> => {
    const { data } = await apiClient.post<DataConnection>(
      '/datasources/data-connections/', body);
    return data;
  },
  updateData: async (id: number, body: Record<string, unknown>): Promise<DataConnection> => {
    const { data } = await apiClient.patch<DataConnection>(
      `/datasources/data-connections/${id}/`, body);
    return data;
  },
  deleteData: async (id: number): Promise<void> => {
    await apiClient.delete(`/datasources/data-connections/${id}/`);
  },

  // -- sharing ------------------------------------------------------------
  sharePreview: async (kind: CustomToolKind, id: number | string): Promise<{
    published: boolean; slug: string | null; visibility: ShareVisibility;
    is_listed: boolean; version: number; install_count: number;
    tagline: string; description: string;
    auth_shape: SharedTool['auth_shape'];
    tool_config: Record<string, unknown>;
  }> => {
    const prefix = kind === 'api' ? 'api' : 'data';
    const { data } = await apiClient.get(
      `/datasources/${prefix}/${id}/share/`);
    return data;
  },
  publish: async (
    kind: CustomToolKind, id: number | string,
    body: { tagline: string; description?: string; visibility?: ShareVisibility },
  ): Promise<SharedTool> => {
    const prefix = kind === 'api' ? 'api' : 'data';
    const { data } = await apiClient.post<SharedTool>(
      `/datasources/${prefix}/${id}/share/`, body);
    return data;
  },
  withdraw: async (kind: CustomToolKind, id: number | string): Promise<void> => {
    const prefix = kind === 'api' ? 'api' : 'data';
    await apiClient.delete(`/datasources/${prefix}/${id}/share/`);
  },
  listShared: async (): Promise<{ results: SharedTool[]; truncated: boolean }> => {
    const { data } = await apiClient.get<{ results: SharedTool[]; truncated: boolean }>(
      '/datasources/shared/');
    return { results: asArray<SharedTool>(data), truncated: Boolean(data?.truncated) };
  },
  getShared: async (slug: string): Promise<SharedTool> => {
    const { data } = await apiClient.get<SharedTool>(`/datasources/shared/${slug}/`);
    return data;
  },
  installShared: async (slug: string): Promise<{
    tool: ApiConnection | DataConnection; credentials_needed: CredentialNeed[];
  }> => {
    const { data } = await apiClient.post(
      `/datasources/shared/${slug}/install/`);
    return data;
  },
};

export default datasourcesService;
