import apiClient from './client';

export interface DashboardTile {
  kind: 'kpi' | 'chart' | 'table' | 'text';
  title?: string;
  value?: string;
  delta?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chart?: any;
  columns?: string[];
  rows?: string[][];
  text?: string;
}

export interface Dashboard {
  id: number;
  title: string;
  spec: { title: string; tiles: DashboardTile[] };
  sources: unknown[];
  refresh_cron: string;
  visibility: 'link' | 'platform' | 'public';
  updated_at: string;
  created_at: string;
}

export const dashboardsService = {
  list: async (scope?: 'platform'): Promise<{ results: Dashboard[]; truncated: boolean }> =>
    (await apiClient.get('/inference/dashboards/', { params: scope ? { scope } : undefined })).data,

  get: async (id: number): Promise<Dashboard> =>
    (await apiClient.get<Dashboard>(`/inference/dashboards/${id}/`)).data,

  refresh: async (id: number): Promise<Dashboard & { refreshed_at: string }> =>
    (await apiClient.post(`/inference/dashboards/${id}/refresh/`)).data,

  remove: async (id: number): Promise<void> => {
    await apiClient.delete(`/inference/dashboards/${id}/`);
  },
};

export default dashboardsService;
