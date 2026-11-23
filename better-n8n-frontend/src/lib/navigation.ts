import { Activity, FolderOpen, MessageCircle, Plug, Workflow } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/* Single source of truth for app navigation.
 *
 * Three surfaces share this file. Desktop: the sidebar, which is the full
 * catalogue (there is no top bar). Phones: a one-line title bar (the current
 * destination's name, read from here) and a bottom tab bar (Ask / Agents /
 * New / Activity / More, where More opens the drawer). `primaryNav` is the
 * daily loop the bottom bar draws from; the sidebar keeps every route, so no
 * route is reachable from only one surface.
 *
 * Five destinations. Each hub that has sections lists them in `tabs`, and
 * `components/layout/HubTabs.tsx` draws that strip on the hub's pages.
 */

export type NavTab = { label: string; path: string };

export type NavItem = {
  icon: LucideIcon;
  label: string;
  path: string;
  guestOk?: boolean;
  /** show the violet "running unattended" dot */
  agent?: boolean;
  /** show the blue "waiting on you" count */
  pending?: boolean;
  /** extra prefixes this entry lights up for (one entry owns several routes) */
  match?: string[];
  /** the sections under this destination, shown as a strip on its pages */
  tabs?: NavTab[];
};

export type NavGroup = { title: string; items: NavItem[] };

const ASK: NavItem = { icon: MessageCircle, label: 'Ask', path: '/ai-chat', guestOk: true };

const ACTIVITY: NavItem = {
  icon: Activity,
  label: 'Activity',
  path: '/runs',
  agent: true,
  pending: true,
};

// Missions live inside Activity (goals above their runs); /missions redirects
// to /runs, so no entry is needed for them.
const AGENTS: NavItem = {
  icon: Workflow,
  label: 'Agents',
  path: '/agents',
  match: ['/agents', '/templates', '/schedules', '/evals', '/workflow'],
  tabs: [
    { label: 'My agents', path: '/agents' },
    { label: 'Explore', path: '/templates' },
    { label: 'Schedules', path: '/schedules' },
    { label: 'Evals', path: '/evals' },
  ],
};

// Dashboards, Pages and the older /solutions name open from the Apps launcher
// or from a link, so they light Library without owning a tab.
const LIBRARY: NavItem = {
  icon: FolderOpen,
  label: 'Library',
  path: '/documents',
  match: ['/documents', '/apps', '/team', '/imagine', '/pages', '/dashboards', '/solutions'],
  tabs: [
    { label: 'Files', path: '/documents' },
    { label: 'Apps', path: '/apps' },
    { label: 'Team knowledge', path: '/team' },
    { label: 'Studio', path: '/imagine' },
  ],
};

const CONNECT: NavItem = {
  icon: Plug,
  label: 'Connect',
  path: '/connections',
  match: ['/connections', '/credentials', '/tools', '/skills'],
  tabs: [
    { label: 'Connections', path: '/connections' },
    { label: 'Keys', path: '/credentials' },
    { label: 'Tools', path: '/tools' },
    { label: 'Skills', path: '/skills' },
  ],
};

/* Full catalogue — what the sidebar renders: one group, five destinations. */
export const navGroups: NavGroup[] = [
  {
    title: 'Work',
    items: [ASK, ACTIVITY, AGENTS, LIBRARY, CONNECT],
  },
];

/* Primary tabs — the daily loop the phone bottom bar draws from.
 * Ask (home), Agents (what runs for you), Activity (needs you). */
export const primaryNav: NavItem[] = [ASK, AGENTS, ACTIVITY];

/* Everything not in the primary row — what the phone drawer adds beyond the
 * bottom bar. Derived, never hand-synced, so adding a route to `navGroups`
 * cannot leave the drawer behind. */
export const moreNavItems: NavItem[] = navGroups
  .flatMap((g) => g.items)
  .filter((item) => !primaryNav.some((p) => p.path === item.path));

export function isNavActive(pathname: string, item: NavItem): boolean {
  const prefixes = item.match ?? [item.path];
  return prefixes.some((p) => pathname.startsWith(p));
}

export type Hub = { label: string; tabs: NavTab[]; current: string };

/* The section strip for a page, or null. A page gets a strip only when its
 * path IS one of a hub's tab paths (a trailing slash is ignored). Detail
 * pages such as /agents/12, /agents/new or /templates/slug are not tabs, so
 * they get none and keep the full height. */
export function hubFor(pathname: string): Hub | null {
  const clean = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  for (const item of navGroups.flatMap((g) => g.items)) {
    if (!item.tabs) continue;
    const current = item.tabs.find((t) => t.path === clean);
    if (current) return { label: item.label, tabs: item.tabs, current: current.path };
  }
  return null;
}
