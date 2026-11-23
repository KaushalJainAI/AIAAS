import { describe, expect, it } from 'vitest';
import { hubFor, isNavActive, moreNavItems, navGroups, primaryNav } from '../navigation';

/* Every page routed inside the shell: the children of <Layout /> in
 * src/App.tsx, minus redirects and detail routes (/agents/:id, /agents/new,
 * /templates/:slug). Keep this list in step with App.tsx. */
const SHELL_ROUTES = [
  '/ai-chat', '/runs', '/agents', '/templates', '/schedules', '/evals',
  '/documents', '/apps', '/team', '/imagine', '/pages', '/dashboards', '/solutions',
  '/connections', '/credentials', '/tools', '/skills',
  '/settings', '/profile',
];

/* Not destinations: reached from the sidebar footer and the avatar. */
const OUTSIDE_THE_NAV = ['/settings', '/profile'];

/* Lit by a destination but not listed as its tab: opened from the Apps
 * launcher or from a link (Dashboards, Pages), or the older name of Team
 * knowledge (notifications still link to /solutions). */
const OPENED_FROM_A_PAGE = ['/pages', '/dashboards', '/solutions'];

const allItems = navGroups.flatMap((g) => g.items);
const allTabPaths = allItems.flatMap((i) => (i.tabs ?? []).map((t) => t.path));

/* The three shell surfaces (desktop topbar, sidebar/drawer, mobile bars) all
 * read lib/navigation. These pin the derivation so adding a route to the
 * catalogue cannot silently leave the More menu or the primary row behind. */
describe('navigation', () => {
  it('has five destinations in one group', () => {
    expect(navGroups).toHaveLength(1);
    expect(allItems.map((i) => i.label)).toEqual(['Ask', 'Activity', 'Agents', 'Library', 'Connect']);
  });

  it('the phone bar is Ask, Agents, Activity', () => {
    expect(primaryNav.map((i) => i.label)).toEqual(['Ask', 'Agents', 'Activity']);
  });

  it('every shell page is a destination, a section, or lit by one', () => {
    const reachable = new Set([...allItems.map((i) => i.path), ...allTabPaths]);
    for (const route of SHELL_ROUTES) {
      if (OUTSIDE_THE_NAV.includes(route) || reachable.has(route)) continue;
      expect(OPENED_FROM_A_PAGE, `${route} is not a destination or a section`).toContain(route);
      expect(
        allItems.some((i) => isNavActive(route, i)),
        `${route} lights no destination`,
      ).toBe(true);
    }
  });

  it('every section is a shell page, with no path listed twice', () => {
    expect(new Set(allTabPaths).size).toBe(allTabPaths.length);
    expect(allTabPaths).toHaveLength(12);
    for (const path of allTabPaths) {
      expect(SHELL_ROUTES).toContain(path);
    }
  });

  it('hubFor returns the strip on every section page, lit on its own tab', () => {
    for (const item of allItems) {
      for (const tab of item.tabs ?? []) {
        expect(hubFor(tab.path)).toEqual({ label: item.label, tabs: item.tabs, current: tab.path });
      }
    }
  });

  it('hubFor shows nothing on detail pages, and ignores a trailing slash', () => {
    for (const path of ['/agents/12', '/agents/new', '/agents/12/history', '/templates/slug', '/workflow/abc', '/pages', '/dashboards', '/settings']) {
      expect(hubFor(path), path).toBeNull();
    }
    expect(hubFor('/agents/')?.current).toBe('/agents');
  });

  it('every primary tab exists in the full catalogue', () => {
    const paths = new Set(navGroups.flatMap((g) => g.items.map((i) => i.path)));
    for (const item of primaryNav) {
      expect(paths.has(item.path)).toBe(true);
    }
  });

  it('More holds exactly the non-primary catalogue entries, with no overlap', () => {
    const primary = new Set(primaryNav.map((i) => i.path));
    const catalogue = navGroups.flatMap((g) => g.items.map((i) => i.path));
    expect(moreNavItems.map((i) => i.path).sort()).toEqual(
      catalogue.filter((p) => !primary.has(p)).sort(),
    );
    for (const item of moreNavItems) {
      expect(primary.has(item.path)).toBe(false);
    }
  });

  it('one entry owns its deep routes', () => {
    const byPath = (path: string) =>
      [...primaryNav, ...moreNavItems].find((i) => i.path === path)!;
    expect(isNavActive('/agents/abc', byPath('/agents'))).toBe(true);
    expect(isNavActive('/workflow/abc', byPath('/agents'))).toBe(true);
    expect(isNavActive('/ai-chat', byPath('/ai-chat'))).toBe(true);
    expect(isNavActive('/runs', byPath('/runs'))).toBe(true);
    expect(isNavActive('/templates/slug', byPath('/agents'))).toBe(true);
    expect(isNavActive('/runs', byPath('/agents'))).toBe(false);
  });

  it('a destination lights for the routes its sections own', () => {
    const byLabel = (label: string) => allItems.find((i) => i.label === label)!;
    expect(isNavActive('/templates', byLabel('Agents'))).toBe(true);
    expect(isNavActive('/schedules', byLabel('Agents'))).toBe(true);
    expect(isNavActive('/dashboards', byLabel('Library'))).toBe(true);
    expect(isNavActive('/solutions', byLabel('Library'))).toBe(true);
    expect(isNavActive('/skills', byLabel('Connect'))).toBe(true);
    expect(isNavActive('/documents', byLabel('Connect'))).toBe(false);
  });
});
