/**
 * Dashboards: KPI, chart, table and text tiles, refreshed on demand.
 *
 * Mirrors: better-n8n-frontend/src/api/dashboards.ts
 */

export type DashboardTileKind = 'kpi' | 'chart' | 'table' | 'text';

export interface DashboardTile {
  kind: DashboardTileKind;
  title?: string;
  value?: string;
  delta?: string;
  /**
   * A chart spec in the shape `render_chart` takes ({kind, title, series}).
   * The web types this `any`; here it is `unknown`, so a renderer must check
   * the shape before reading it.
   */
  chart?: unknown;
  columns?: string[];
  rows?: string[][];
  text?: string;
}

export interface DashboardSpec {
  title: string;
  tiles: DashboardTile[];
}

export interface Dashboard {
  id: number;
  title: string;
  spec: DashboardSpec;
  sources: unknown[];
  refresh_cron: string;
  visibility: 'link' | 'platform' | 'public';
  updated_at: string;
  created_at: string;
}

/** `POST /inference/dashboards/{id}/refresh/` answer: the stored spec plus when it was refreshed. */
export interface RefreshedDashboard extends Dashboard {
  refreshed_at: string;
}

/** `GET /inference/dashboards/` answer: a capped list with `truncated`. */
export interface DashboardListPage {
  results: Dashboard[];
  truncated: boolean;
}
