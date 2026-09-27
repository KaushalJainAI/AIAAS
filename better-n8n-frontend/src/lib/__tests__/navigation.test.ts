import { describe, expect, it } from 'vitest';
import { isNavActive, moreNavItems, navGroups, primaryNav } from '../navigation';

/* The three shell surfaces (desktop topbar, sidebar/drawer, mobile bars) all
 * read lib/navigation. These pin the derivation so adding a route to the
 * catalogue cannot silently leave the More menu or the primary row behind. */
describe('navigation', () => {
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
    expect(isNavActive('/templates/slug', byPath('/templates'))).toBe(true);
    expect(isNavActive('/runs', byPath('/agents'))).toBe(false);
  });
});
