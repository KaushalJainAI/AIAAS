/**
 * Mobile layout regression.
 *
 * The gaps this pins are invisible to `tsc`, to ESLint and to every jsdom unit
 * test, because they are all *layout*: jsdom has none, so a page can be
 * unscrollable, clipped, or 200px wider than the phone and still pass the whole
 * existing suite. They only show up against a real engine at a real width.
 *
 * Three properties, each matching a bug that actually shipped:
 *
 *   1. No horizontal overflow. A tab row wider than the viewport inside the
 *      shell's `overflow-hidden` <main> does not scroll the page — it clips,
 *      and the last tab becomes unreachable.
 *   2. Every page owns a scroller. The shell is `h-full overflow-hidden`, so a
 *      page declaring only `min-h-screen` has no scrolling ancestor and
 *      everything below the fold is unreachable.
 *   3. The floating hamburger overlaps nothing. It is `position: fixed`, so no
 *      page can make room for it on its own — each header reserves the space.
 *
 * Requires a backend on :8000 and the Vite dev server (Playwright starts it).
 */
import { expect, request, test, type Page } from '@playwright/test';

import { BYPASS_HEADERS } from './helpers/session';

const API = process.env.E2E_API_URL ?? 'http://localhost:8000';

/** iPhone 12/13/14 logical viewport — the narrow end of what people use. */
const PHONE = { width: 390, height: 844 };

/** Every authenticated route that renders inside the app shell. */
const ROUTES = [
  // Ask is the home. `/overview` is only a redirect to `/runs` now, so it no
  // longer tests a page of its own.
  '/ai-chat',
  '/runs',
  '/agents',
  '/agents/new',
  '/templates',
  '/tools',
  '/schedules',
  '/skills',
  '/evals',
  '/connections',
  '/credentials',
  '/documents',
  '/settings',
  '/profile',
  '/imagine',
];

/* One account for the whole file, minted once. Registering per test trips the
   API throttle in `core/` around the fifteenth route and the tail of the suite
   then fails on the login screen rather than on anything about layout. */
let TOKEN = '';

test.beforeAll(async () => {
  // The rate lane: this file mints its own account, outside helpers/session.ts.
  const ctx = await request.newContext({ extraHTTPHeaders: BYPASS_HEADERS });
  const id = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const email = `e2e_${id}@example.com`;
  const password = 'Sup3r$ecret-e2e!';
  await ctx.post(`${API}/api/auth/register/`, {
    data: { username: `e2e_${id}`, email, password, password2: password },
  });
  const r = await ctx.post(`${API}/api/auth/login/`, { data: { email, password } });
  const body = await r.json();
  TOKEN = body.access ?? body.access_token;
  await ctx.dispose();
});

async function signedIn(page: Page) {
  await page.addInitScript((t) => localStorage.setItem('access_token', t as string), TOKEN);
}

/**
 * Widest right edge of anything *unreachable*, against the viewport width.
 *
 * Elements inside a horizontal scroller are skipped deliberately: the question
 * is not "is anything wider than the phone" but "is anything wider than the
 * phone that the user cannot get to". The Settings tab strip is `min-w-max`
 * inside an `overflow-x-auto` rail and is 691px at this width — which is the
 * intended design, and swiping reaches all of it. The Documents tab row was the
 * same shape with no scroller, and its last tab was simply lost.
 */
async function overflowRight(page: Page) {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const scrollsX = (el: Element) => {
      const ov = getComputedStyle(el).overflowX;
      return /auto|scroll/.test(ov) && el.scrollWidth > el.clientWidth + 2;
    };
    const insideScroller = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (scrollsX(p)) return true;
      }
      return false;
    };
    let worst = { px: 0, what: '' };
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (insideScroller(el)) continue;
      const over = Math.round(r.right - limit);
      if (over > worst.px) {
        worst = {
          px: over,
          what: `${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 90)}`,
        };
      }
    }
    return worst;
  });
}

test.describe('mobile layout', () => {
  test.use({ viewport: PHONE });

  for (const route of ROUTES) {
    test(`${route} fits the viewport and can scroll`, async ({ page }) => {
      await signedIn(page);
      await page.goto(route);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(600);

      // 1 — nothing spills off the right edge. A few px of tolerance for
      // sub-pixel rounding on borders and shadows.
      const worst = await overflowRight(page);
      expect(
        worst.px,
        `${route}: content is ${worst.px}px wider than the viewport — widest offender ${worst.what}`,
      ).toBeLessThanOrEqual(4);

      // 2 — the page must own a scroller.
      //
      // Squeezed to a very short viewport first, on purpose. A fresh account
      // has almost no data, so at full height most of these pages fit and the
      // assertion passes for the wrong reason — which is exactly how a page
      // with no scrolling ancestor shipped. At 360px tall every page has more
      // content than room, so the property is actually exercised.
      await page.setViewportSize({ width: PHONE.width, height: 360 });
      await page.waitForTimeout(250);
      const scrollable = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('body *'));
        const overflows = nodes.some((n) => n.scrollHeight > window.innerHeight + 2);
        if (!overflows) return true; // genuinely nothing to scroll
        return nodes.some((el) => {
          const st = getComputedStyle(el);
          const scrolls = /auto|scroll/.test(st.overflowY);
          return scrolls && el.scrollHeight > el.clientHeight + 2;
        });
      });
      await page.setViewportSize(PHONE);
      expect(scrollable, `${route}: content overflows but no element scrolls`).toBe(true);
    });
  }

  for (const route of ROUTES) {
  test(`the floating hamburger covers nothing on ${route}`, async ({ page }) => {
    await signedIn(page);
    await page.goto(route);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(600);

    const burger = page.getByRole('button', { name: /open menu/i });
    await expect(burger).toBeVisible();
    const box = (await burger.boundingBox())!;

    const covered = await page.evaluate((b) => {
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const top = document.elementFromPoint(cx, cy);
      const hitsButton = !!top?.closest('button[aria-label="Open menu"]');
      /* Anything that *renders something* under the button, not just anything
         clickable: what a PageHeader puts in the top-left is an icon tile and
         an <h1>, both plain elements, so an interactive-only filter watched the
         one corner where the collision never happened. A leaf with its own text
         or an svg is the honest test of "something is painted here". */
      const clash = Array.from(document.querySelectorAll('body *')).filter((el) => {
        if (el.closest('button[aria-label="Open menu"]')) return false;
        if (el.closest('#app-sidebar')) return false;
        const paints =
          el.tagName === 'svg' ||
          el.tagName === 'IMG' ||
          Array.from(el.childNodes).some(
            (n) => n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim().length > 0,
          );
        if (!paints) return false;
        // A closed drawer keeps its layout box but paints nothing.
        if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        /* What is actually painted: the box cut by every ancestor that clips
           (overflow other than visible). A hub tab scrolled out of its strip
           keeps a box that reaches under the button, but nothing shows there. */
        let left = r.left, right = r.right, top = r.top, bottom = r.bottom;
        for (let p = el.parentElement; p; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
            const c = p.getBoundingClientRect();
            left = Math.max(left, c.left);
            right = Math.min(right, c.right);
            top = Math.max(top, c.top);
            bottom = Math.min(bottom, c.bottom);
          }
        }
        if (right <= left || bottom <= top) return false;
        return left < b.x + b.width && right > b.x && top < b.y + b.height && bottom > b.y;
      });
      return {
        hitsButton,
        clash: clash.map(
          (el) => `${el.tagName.toLowerCase()} "${(el.textContent || '').trim().slice(0, 40)}"`,
        ),
      };
    }, box);

    expect(covered.hitsButton, 'the hamburger is not topmost at its own centre').toBe(true);
    expect(
      covered.clash,
      `${route}: content sits under the hamburger — ${covered.clash.join(', ')}`,
    ).toEqual([]);
  });
  }

  test('the drawer opens, navigates, and closes behind it', async ({ page }) => {
    await signedIn(page);
    await page.goto('/overview');
    await page.waitForTimeout(600);

    await page.getByRole('button', { name: /open menu/i }).click();
    // Scoped to the drawer: the phone bottom bar has its own "Activity" link.
    // A pending count can sit in the name ("Activity 2"), so match the start only.
    const activity = page.locator('#app-sidebar').getByRole('link', { name: /^Activity\b/ });
    await expect(activity).toBeVisible();
    await activity.click();

    await expect(page).toHaveURL(/\/runs/);
    // The drawer auto-closes on navigation, which is what puts the hamburger back.
    await expect(page.getByRole('button', { name: /open menu/i })).toBeVisible();
  });

  test('the agent builder exposes its settings on a phone', async ({ page }) => {
    // `/agents/new` is now the creation wizard, not the builder, and it has no
    // settings switch. The builder is `/agents/:id`, so make an agent first.
    const ctx = await request.newContext();
    const made = await ctx.post(`${API}/api/orchestrator/agents/`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: { name: 'E2E phone agent' },
    });
    expect(made.ok(), `creating an agent failed: ${made.status()}`).toBe(true);
    const { id } = (await made.json()) as { id: number };
    await ctx.dispose();

    await signedIn(page);
    await page.goto(`/agents/${id}`);
    await page.waitForTimeout(800);

    // The builder opens on "Essentials" with the agent's name on it. Phones
    // switch between the two views with a labelled group, not a hidden pane.
    await expect(page.getByRole('group', { name: 'Settings view' })).toBeVisible();
    await expect(page.getByPlaceholder('Finance agent')).toBeVisible();
  });
});

/** Routes whose every control must be a 44 px touch target with a name. */
const TOUCH_ROUTES = ['/ai-chat', '/runs', '/agents', '/documents', '/settings'];

test.describe('touch targets', () => {
  test.use({ viewport: PHONE });

  for (const route of TOUCH_ROUTES) {
    test(`${route}: every control is 44 px and has a name on a phone`, async ({ page }) => {
      await signedIn(page);
      await page.goto(route);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(600);

      // Visible controls only. Hidden ones (display: none) have no box, and
      // the closed drawer is aria-hidden. A link inside running prose is text,
      // not a control, so `.prose` is skipped; `data-touch-exempt` marks the
      // same kind of inline link anywhere else.
      const offenders = await page.evaluate(() => {
        const selector = 'button, [role="button"], [role="tab"], [role="menuitem"], a[href]';
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
          if (el.closest('.prose, [data-touch-exempt], [aria-hidden="true"], [inert]')) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const style = getComputedStyle(el);
          if (style.visibility === 'hidden' || style.display === 'none') continue;

          const name =
            el.getAttribute('aria-label') ||
            (el.textContent || '').trim() ||
            el.getAttribute('title') ||
            '';
          const small = r.width < 44 || r.height < 44;
          if (!small && name) continue;
          const label = name ? name.slice(0, 40) : '(no name)';
          out.push(`${el.tagName.toLowerCase()}.${label} (${Math.round(r.width)}x${Math.round(r.height)})`);
        }
        return out;
      });

      expect(offenders, `${route}: controls under 44x44 px or without a name:\n${offenders.join('\n')}`).toEqual([]);
    });
  }
});
