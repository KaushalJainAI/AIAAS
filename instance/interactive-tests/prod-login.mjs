/**
 * prod-login.mjs — capture a production session by having the *user* sign in.
 *
 * Opens a real browser on this machine, navigates to the production login page
 * and clicks "Continue with Google". Everything after that is the user's: they
 * pick the account and satisfy whatever Google asks for. This script only
 * watches for the app to become authenticated, then reads the JWT the frontend
 * stored and writes it where the Python harnesses can pick it up.
 *
 * Why this shape rather than automating the login: a password typed by a script
 * is a password the script has, and Google's flow is exactly the place where
 * that is least acceptable. Handing the keyboard to the person whose account it
 * is costs one manual step and removes the whole question.
 *
 * Usage:
 *   node prod-login.mjs [--base https://aiaas.kaushaljain.com] [--timeout 300]
 *
 * Writes:
 *   instance/.prod-token      the access token (gitignored)
 *   instance/recordings/      video of the session
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTANCE = resolve(HERE, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const BASE = (arg('base', 'https://aiaas.kaushaljain.com')).replace(/\/$/, '');
const TIMEOUT_S = Number(arg('timeout', '300'));
const TOKEN_FILE = resolve(INSTANCE, '.prod-token');
const VIDEO_DIR = resolve(INSTANCE, 'recordings', 'login');

mkdirSync(VIDEO_DIR, { recursive: true });

/**
 * The token the frontend stores once a login completes (api/client.ts).
 *
 * Checked across *every* page in the context, not just the one we opened.
 * Google's flow may run in a popup or replace the tab, and the first version of
 * this script polled a single `page` handle and crashed with "Target page,
 * context or browser has been closed" the moment that handle went away -- which
 * looks like a failed login when in fact nothing had been tried yet.
 */
async function findToken(context, origin) {
  for (const p of context.pages()) {
    if (p.isClosed()) continue;
    let url = '';
    try { url = p.url(); } catch { continue; }
    if (!url.startsWith(origin)) continue;      // localStorage is per-origin
    try {
      const token = await p.evaluate(() => localStorage.getItem('access_token'));
      if (token) return token;
    } catch {
      // navigating, or the page went away between the check and the call
    }
  }
  return null;
}

// A persistent profile, so a Google sign-in survives between runs.
//
// This is what makes the flow bearable: with a throwaway profile every run
// starts logged out of Google and needs the full interactive dance again. With
// a profile kept on disk, you sign in once and later runs -- including the
// recorded walkthrough -- open already authenticated. No credential is stored
// by this script; what persists is Google's own session cookie, in a directory
// you own, exactly as your normal browser keeps it.
//
// `channel: 'chrome'` when available: Google increasingly refuses sign-in from
// automation-flavoured builds, and real Chrome is far less likely to be shown a
// "this browser may not be secure" wall than bundled Chromium.
const PROFILE_DIR = resolve(INSTANCE, '.browser-profile');
mkdirSync(PROFILE_DIR, { recursive: true });

async function openContext() {
  const opts = {
    headless: false,
    slowMo: 80,
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 800 } },
    args: ['--start-maximized'],
  };
  try {
    return await chromium.launchPersistentContext(PROFILE_DIR, { ...opts, channel: 'chrome' });
  } catch {
    console.log('  ! Chrome not available - falling back to bundled Chromium.');
    return await chromium.launchPersistentContext(PROFILE_DIR, opts);
  }
}

const context = await openContext();
const browser = context.browser() ?? { close: async () => {} };

// Keep a handle on popups so the OAuth window is polled too.
context.on('page', (p) => console.log(`  … new window: ${p.url().slice(0, 80)}`));

const page = context.pages()[0] ?? await context.newPage();

console.log(`
  Opening ${BASE}/login`);
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' }).catch(() => {});

const google = page
  .getByRole('button', { name: /google/i })
  .or(page.getByRole('link', { name: /google/i }))
  .first();

if (await google.count().catch(() => 0)) {
  console.log('  Clicking "Continue with Google" …');
  await google.click().catch(() => {});
} else {
  console.log('  ! No Google button found — sign in however you normally would.');
}

console.log(`
  ==========================================================
   Please complete the sign-in in the browser window.
   Pick the kaushaljain7000@gmail.com account and approve.

   I never see what you type. I poll only for the app's own
   access_token once it is signed in.

   Leave the window OPEN when you are done -- closing it ends
   the capture.
  ==========================================================
`);

const deadline = Date.now() + TIMEOUT_S * 1000;
let token = null;
let closed = false;

while (Date.now() < deadline) {
  // The user closing everything is a normal outcome, not a crash.
  if (context.pages().every((p) => p.isClosed())) { closed = true; break; }
  token = await findToken(context, BASE);
  if (token) break;
  await new Promise((r) => setTimeout(r, 1500));
}

if (!token) {
  const why = closed
    ? 'The browser was closed before sign-in completed.'
    : `No access_token after ${TIMEOUT_S}s - sign-in did not complete.`;
  console.error('');
  console.error('  x ' + why);
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(1);
}

writeFileSync(TOKEN_FILE, token, 'utf8');
console.log(`  ✓ Signed in. Token captured (${token.length} chars) → instance/.prod-token`);

// Land on an authenticated screen so the recording shows a real session.
const live = context.pages().find((p) => !p.isClosed() && p.url().startsWith(BASE))
          ?? context.pages().find((p) => !p.isClosed());
if (live) {
  await live.goto(`${BASE}/agents`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await live.waitForTimeout(4000).catch(() => {});
}

await context.close().catch(() => {});
await browser.close().catch(() => {});
console.log(`  ✓ Video written to instance/recordings/login/`);
