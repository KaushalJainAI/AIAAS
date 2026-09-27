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

const API = process.env.E2E_API_URL ?? 'http://localhost:8000';

/** iPhone 12/13/14 logical viewport — the narrow end of what people use. */
const PHONE = { width: 390, height: 844 };

/** Every authenticated route that renders inside the app shell. */
const ROUTES = [
  '/overview',
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
  const ctx = await request.newContext();
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
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        return r.left < b.x + b.width && r.right > b.x && r.top < b.y + b.height && r.bottom > b.y;
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
    const runs = page.getByRole('link', { name: 'Runs', exact: true });
    await expect(runs).toBeVisible();
    await runs.click();

    await expect(page).toHaveURL(/\/runs/);
    // The drawer auto-closes on navigation, which is what puts the hamburger back.
    await expect(page.getByRole('button', { name: /open menu/i })).toBeVisible();
  });

  test('the agent builder exposes its settings on a phone', async ({ page }) => {
    await signedIn(page);
    await page.goto('/agents/new');
    await page.waitForTimeout(800);

    // The knob board is `hidden lg:block`; below `lg` it is reached through the
    // pane switch. Without that switch the builder is a chat box with no way to
    // set a single field — not even the agent's name.
    await page.getByRole('button', { name: /^settings$/i }).click();
    await expect(page.getByPlaceholder('Finance agent')).toBeVisible();
  });
});
