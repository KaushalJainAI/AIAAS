/**
 * Dashboards API.
 *
 * Mirrors: better-n8n-frontend/src/api/dashboards.ts (dashboardsService)
 * Backend reference: Backend/docs/API.md, rows for /api/inference/dashboards/.
 */
import { api } from '../../api/client';
import type { Dashboard, DashboardListPage, RefreshedDashboard } from './types';

/** `GET /inference/dashboards/` — `scope='platform'` lists everyone's listed dashboards. */
export function listDashboards(scope?: 'platform'): Promise<DashboardListPage> {
  return api<DashboardListPage>('/inference/dashboards/', { query: { scope } });
}

/** `GET /inference/dashboards/{id}/` */
export function getDashboard(id: number): Promise<Dashboard> {
  return api<Dashboard>(`/inference/dashboards/${id}/`);
}

/**
 * `POST /inference/dashboards/{id}/refresh/` — sources do not execute yet; this
 * returns the stored spec with `refreshed_at`.
 */
export function refreshDashboard(id: number): Promise<RefreshedDashboard> {
  return api<RefreshedDashboard>(`/inference/dashboards/${id}/refresh/`, { method: 'POST' });
}

/** `DELETE /inference/dashboards/{id}/` — a hard delete (owner only). */
export function deleteDashboard(id: number): Promise<unknown> {
  return api<unknown>(`/inference/dashboards/${id}/`, { method: 'DELETE' });
}
