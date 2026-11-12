import {
  Activity,
  AppWindow,
  CalendarClock,
  Clapperboard,
  FileText,
  FlaskConical,
  GraduationCap,
  Building2,
  KeyRound,
  LayoutGrid,
  MessageCircle,
  Plug,
  Wrench,
  Workflow,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/* Single source of truth for app navigation.
 *
 * Three surfaces share this file. Desktop: the sidebar, which is the full
 * catalogue (there is no top bar). Phones: a one-line title bar (the current
 * destination's name, read from here) and a bottom tab bar (Ask / Agents /
 * New / Activity / More, where More opens the drawer). `primaryNav` is the
 * daily loop the bottom bar draws from; the sidebar keeps every route, so no
 * route is reachable from only one surface.
 */

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
};

export type NavGroup = { title: string; items: NavItem[] };

/* Full catalogue — what the sidebar / mobile drawer renders. Unchanged from
 * the old sidebar, so every deep link and the e2e drawer test keep working. */
export const navGroups: NavGroup[] = [
  {
    title: 'Work',
    items: [
      { icon: MessageCircle, label: 'Ask', path: '/ai-chat', guestOk: true },
      // Missions live inside Activity (goals above their runs); /missions
      // redirects to /runs so no nav entry is needed.
      { icon: Activity, label: 'Activity', path: '/runs', agent: true, pending: true },
    ],
  },
  {
    title: 'Build',
    items: [
      { icon: Workflow, label: 'Automations', path: '/agents', match: ['/agents', '/workflow'] },
      { icon: LayoutGrid, label: 'Explore', path: '/templates' },
      { icon: Wrench, label: 'Tools', path: '/tools' },
      { icon: CalendarClock, label: 'Schedules', path: '/schedules' },
      { icon: Clapperboard, label: 'Studio', path: '/imagine' },
    ],
  },
  {
    title: 'Improve',
    items: [
      { icon: Building2, label: 'Team knowledge', path: '/team', match: ['/team', '/solutions'] },
      { icon: GraduationCap, label: 'Skills', path: '/skills' },
      { icon: FlaskConical, label: 'Evals', path: '/evals' },
    ],
  },
  {
    title: 'Data',
    items: [
      { icon: Plug, label: 'Connections', path: '/connections' },
      { icon: KeyRound, label: 'Credentials', path: '/credentials' },
      // Dashboards and Pages open from the Apps launcher, so Apps stays lit on them.
      { icon: AppWindow, label: 'Apps', path: '/apps', match: ['/apps', '/dashboards', '/pages'] },
      { icon: FileText, label: 'Documents', path: '/documents', match: ['/documents'] },
    ],
  },
];

/* Primary tabs — the daily loop the phone bottom bar draws from.
 * Ask (home), Automations (catalogue), Explore (bundles), Activity (needs you). */
export const primaryNav: NavItem[] = [
  { icon: MessageCircle, label: 'Ask', path: '/ai-chat', guestOk: true },
  { icon: Workflow, label: 'Automations', path: '/agents', match: ['/agents', '/workflow'] },
  { icon: LayoutGrid, label: 'Explore', path: '/templates' },
  { icon: Activity, label: 'Activity', path: '/runs', agent: true, pending: true },
];

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
