/**
 * Recently opened files and saved app tabs (`Backend/inference/recents.py`).
 *
 * "Recent" on the file browser means recently *changed*; this is recently
 * *opened*, the list a computer keeps. Each row also carries `view_state`,
 * the small bag an app stores so a file reopens where it was left.
 */
import apiClient from './client';
import type { Document } from './documents';

/** Flat scalars only: the server refuses nested values. */
export type ViewState = Record<string, string | number | boolean | null>;

export interface RecentFile {
  document: Document;
  /** The app it was last opened in (`docs`, `pdf`, `preview`, ...). */
  app: string;
  opened_at: string;
  open_count: number;
  view_state: ViewState;
}

export interface AppSessionTab {
  id: number;
  name: string;
  file_type: string;
}

export interface AppSession {
  app: string;
  tabs: AppSessionTab[];
  active: number | null;
  updated_at: string | null;
}

export const recentsService = {
  async list(opts: { app?: string; types?: string[]; limit?: number } = {}): Promise<RecentFile[]> {
    const params: Record<string, string | number> = {};
    if (opts.app) params.app = opts.app;
    if (opts.types?.length) params.types = opts.types.join(',');
    if (opts.limit) params.limit = opts.limit;
    const r = await apiClient.get<{ results: RecentFile[] }>('/inference/recent/', { params });
    return r.data.results;
  },

  /** Record an open. The response carries where the file was left. */
  async recordOpen(documentId: number, app: string): Promise<RecentFile> {
    const r = await apiClient.post<RecentFile>('/inference/recent/', { document_id: documentId, app });
    return r.data;
  },

  async viewState(documentId: number): Promise<ViewState> {
    const r = await apiClient.get<{ view_state: ViewState }>(`/inference/recent/${documentId}/`);
    return r.data.view_state;
  },

  async saveViewState(documentId: number, viewState: ViewState): Promise<void> {
    await apiClient.patch(`/inference/recent/${documentId}/`, { view_state: viewState });
  },

  async forget(documentId: number): Promise<void> {
    await apiClient.delete(`/inference/recent/${documentId}/`);
  },

  async clear(): Promise<void> {
    await apiClient.delete('/inference/recent/');
  },

  async session(app: string): Promise<AppSession> {
    const r = await apiClient.get<AppSession>(`/inference/app-sessions/${app}/`);
    return r.data;
  },

  async saveSession(app: string, tabs: number[], active: number | null): Promise<AppSession> {
    const r = await apiClient.put<AppSession>(`/inference/app-sessions/${app}/`, { tabs, active });
    return r.data;
  },
};
