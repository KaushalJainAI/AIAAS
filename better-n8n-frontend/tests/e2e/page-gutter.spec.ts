/**
 * Page gutter alignment on desktop (free: no model calls).
 *
 * The hub pages were moved to one 24px gutter: the page title row, the hub tabs
 * and the first block of content all start at the same left edge. Before the
 * change the title sat 16px in and the content 24px in, so the page looked
 * ragged. This pins the alignment at a desktop width, where the sidebar is
 * always visible and the title is not screen-reader-only.
 *
 * "Within 2px" rather than "exactly equal": borders and sub-pixel rounding can
 * move a box by a fraction, and a 2px tolerance still catches a 16px regression.
 */
import { expect, test, type Page } from '@playwright/test';

import { registerAccount, signIn, type Account } from './helpers/session';

const DESKTOP = { width: 1440, height: 900 };
const TOLERANCE_PX = 2;

/** Hub pages that render the shared PageHeader and content below it. */
const HUB_ROUTES = ['/credentials', '/schedules', '/evals'];

let account: Account;

test.beforeAll(async () => {
  account = await registerAccount();
});

test.use({ viewport: DESKTOP });

/**
 * Left edges of the page title and of the first content block under the header.
 *
 * The header is the sticky ancestor of the title; its next sibling is the
 * page's own content. The "first block" is that content's first child, which
 * is where a page's padding meets its first card or table.
 */
async function leftEdges(page: Page): Promise<{ title: number; content: number }> {
  // `:visible`: the phone top bar also renders an h1, hidden on desktop and
  // earlier in the DOM, so a plain `.first()` measured an invisible element.
  const title = page.locator('h1:visible').first();
  await expect(title).toBeVisible({ timeout: 15_000 });
  const header = title.locator('xpath=ancestor::div[contains(@class,"sticky")][1]');
  const firstBlock = header.locator('xpath=following-sibling::*[1]/*[1]');
  await expect(firstBlock).toBeVisible({ timeout: 15_000 });
  const titleBox = await title.boundingBox();
  const blockBox = await firstBlock.boundingBox();
  if (!titleBox || !blockBox) throw new Error('title or first block has no box');
  return { title: titleBox.x, content: blockBox.x };
}

test.describe('page gutter — happy', () => {
  for (const route of HUB_ROUTES) {
    test(`${route}: title and first block share the 24px gutter`, async ({ page }) => {
      await signIn(page, account);
      await page.goto(route);
      const { title, content } = await leftEdges(page);
      expect(
        Math.abs(title - content),
        `${route}: title left ${title}px, first block left ${content}px`,
      ).toBeLessThanOrEqual(TOLERANCE_PX);
    });
  }
});

test.describe('page gutter — sad', () => {
  test('the measurement reads real boxes, not nothing', async ({ page }) => {
    // Guards the helper itself: if the measurement ever stops reading real
    // boxes (a renamed class, a moved header), the happy tests would pass on
    // nothing. Both edges must be real, on-screen positions.
    await signIn(page, account);
    await page.goto('/credentials');
    const { title, content } = await leftEdges(page);
    expect(title).toBeGreaterThan(0);
    expect(content).toBeGreaterThan(0);
  });
});
