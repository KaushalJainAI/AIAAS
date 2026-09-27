import {
  Activity,
  AppWindow,
  Bot,
  CalendarClock,
  Clapperboard,
  FileText,
  FlaskConical,
  GraduationCap,
  KeyRound,
  LayoutGrid,
  MessageCircle,
  Plug,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/* Single source of truth for app navigation.
 *
 * The shell used to be one sidebar holding every destination. It now has
 * three surfaces sharing this file, modelled on nidhigrahudyog.com:
 * desktop Topbar (brand left, primary tabs centre, actions right, the rest
 * under "More"), mobile top bar (menu + brand + actions) and mobile bottom
 * tab bar (4 destinations + a centre New action + More opening the drawer).
 * The sidebar stays as the full catalogue / drawer so no route is reachable
 * from only one surface.
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
      { icon: Bot, label: 'Automations', path: '/agents', match: ['/agents', '/workflow'] },
      { icon: LayoutGrid, label: 'Explore', path: '/templates' },
      { icon: Wrench, label: 'Tools', path: '/tools' },
      { icon: CalendarClock, label: 'Schedules', path: '/schedules' },
      { icon: Clapperboard, label: 'Studio', path: '/imagine' },
    ],
  },
  {
    title: 'Improve',
    items: [
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

/* Primary tabs — the daily loop, always visible in the desktop topbar centre.
 * Mirrors the reference site's Home / Products / Combos / Offers row:
 * Ask (home), Automations (catalogue), Explore (bundles), Activity (needs you). */
export const primaryNav: NavItem[] = [
  { icon: MessageCircle, label: 'Ask', path: '/ai-chat', guestOk: true },
  { icon: Bot, label: 'Automations', path: '/agents', match: ['/agents', '/workflow'] },
  { icon: LayoutGrid, label: 'Explore', path: '/templates' },
  { icon: Activity, label: 'Activity', path: '/runs', agent: true, pending: true },
];

/* Everything not in the primary row — the "⋯ More" menu on desktop. Derived,
 * never hand-synced, so adding a route to `navGroups` cannot leave the More
 * menu behind. */
export const moreNavItems: NavItem[] = navGroups
  .flatMap((g) => g.items)
  .filter((item) => !primaryNav.some((p) => p.path === item.path));

export function isNavActive(pathname: string, item: NavItem): boolean {
  const prefixes = item.match ?? [item.path];
  return prefixes.some((p) => pathname.startsWith(p));
}
