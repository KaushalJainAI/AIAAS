/**
 * record_story.mjs — Comprehensive story-driven walkthrough recording of AIAAS
 *
 * Runs Comet browser directly, logs in with Kaushal's authenticated session,
 * moves through all features in a storyline, tracks exact event timestamps
 * for loading elimination and 2X speed post-processing.
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTANCE = resolve(HERE, '..');
const VIDEO_DIR = resolve(INSTANCE, 'recordings', 'story');
const COMET_PATH = 'C:\\Users\\91700\\AppData\\Local\\Perplexity\\Comet\\Application\\comet.exe';
const BASE_URL = 'https://aiaas.kaushaljain.com';

mkdirSync(VIDEO_DIR, { recursive: true });

// Load session tokens
const session = JSON.parse(readFileSync(resolve(INSTANCE, '.session.json'), 'utf-8'));

const timestamps = {
  startedAt: 0,
  loadingSpans: [],
  scenes: [],
  finaleStart: 0,
  totalDuration: 0,
};

let scriptStartTime = 0;

function nowSec() {
  return (Date.now() - scriptStartTime) / 1000;
}

function markScene(name) {
  const t = nowSec();
  console.log(`[SCENE] ${name} at ${t.toFixed(2)}s`);
  timestamps.scenes.push({ name, time: t });
}

async function markLoading(fn) {
  const start = nowSec();
  await fn();
  const end = nowSec();
  if (end - start > 0.8) {
    timestamps.loadingSpans.push({ start, end });
  }
}

async function humanType(page, locator, text, delayMs = 35) {
  await locator.click();
  for (const char of text) {
    await page.keyboard.type(char, { delay: delayMs });
  }
}

async function smoothScroll(page, distance = 400, steps = 15) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, distance / steps);
    await page.waitForTimeout(40);
  }
}

async function main() {
  console.log('Launching Comet browser for AIAAS story recording...');
  const browser = await chromium.launch({
    executablePath: COMET_PATH,
    headless: false,
    args: ['--window-size=1920,1080', '--no-first-run', '--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: {
      dir: VIDEO_DIR,
      size: { width: 1920, height: 1080 },
    },
  });

  // Inject authentication into origin
  await context.addInitScript(({ access, refresh }) => {
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
    localStorage.setItem('theme', 'dark');
  }, { access: session.access_token, refresh: session.refresh_token });

  const page = await context.newPage();
  scriptStartTime = Date.now();
  timestamps.startedAt = 0;

  // ----------------------------------------------------
  // ACT 1: Welcome & Executive Briefing in AI Chat
  // ----------------------------------------------------
  markScene('Act 1: Executive AI Chat & Manager Loop');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/ai-chat`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
  });

  // Highlight chat interface
  await page.waitForTimeout(1000);
  try {
    const chatInput = page.locator('textarea[name="chat-input"], textarea').first();
    if (await chatInput.isVisible({ timeout: 5000 })) {
      await humanType(
        page,
        chatInput,
        'Coordinate our Q4 AI operations brief: analyze performance metrics, configure autonomous agent tasks, and format a summary report.'
      );
      await page.waitForTimeout(1200);

      // Press Enter to submit
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3500); // observe stream / plan formulation
    }
  } catch (e) {
    console.log('Chat input step skipped or already populated');
  }

  // ----------------------------------------------------
  // ACT 2: Autonomous Agents & Specialization
  // ----------------------------------------------------
  markScene('Act 2: Autonomous Agents Catalogue & Governance');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/agents`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
  });

  // Showcase agents list (Morning Briefing, SQL Analyst, etc.)
  await smoothScroll(page, 350);
  await page.waitForTimeout(1200);
  await smoothScroll(page, -350);
  await page.waitForTimeout(1000);

  // Click on first agent card if available
  try {
    const agentCard = page.locator('div[class*="cursor-pointer"], tr[class*="cursor-pointer"], a[href*="/agents/"]').first();
    if (await agentCard.isVisible({ timeout: 3000 })) {
      await agentCard.click();
      await page.waitForTimeout(2000);
    }
  } catch (e) {}

  // ----------------------------------------------------
  // ACT 3: Built-in Productivity Apps (Docs, Sheets, Slides)
  // ----------------------------------------------------
  markScene('Act 3: Productivity Apps & Native Workspaces');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/apps`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  });
  await smoothScroll(page, 300);
  await page.waitForTimeout(1500);

  // ----------------------------------------------------
  // ACT 4: Knowledge Base & Document Intelligence
  // ----------------------------------------------------
  markScene('Act 4: Document Intelligence & RAG');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/documents`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  });
  await smoothScroll(page, 300);
  await page.waitForTimeout(1200);

  // ----------------------------------------------------
  // ACT 5: Tools, Extensions & MCP Connectors
  // ----------------------------------------------------
  markScene('Act 5: Enterprise Connectors & MCP');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/connections`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  });
  await smoothScroll(page, 300);
  await page.waitForTimeout(1200);

  // Tools page
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/tools`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
  });
  await smoothScroll(page, 250);
  await page.waitForTimeout(1000);

  // ----------------------------------------------------
  // ACT 6: Automated Recurring Schedules
  // ----------------------------------------------------
  markScene('Act 6: Unattended Cron Schedules');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/schedules`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  });
  await smoothScroll(page, 300);
  await page.waitForTimeout(1500);

  // ----------------------------------------------------
  // ACT 7: Model Evals & Benchmarks
  // ----------------------------------------------------
  markScene('Act 7: Evaluation Suite & Quality Benchmarks');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/evals`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  });
  await smoothScroll(page, 300);
  await page.waitForTimeout(1500);

  // ----------------------------------------------------
  // ACT 8: Observability Traces (Activity / Runs)
  // ----------------------------------------------------
  markScene('Act 8: Observability Traces & Reasoning Logs');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/runs`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  });
  await smoothScroll(page, 400);
  await page.waitForTimeout(1500);

  // ----------------------------------------------------
  // ACT 9: THE GRAND FINALE (Marked for 2X Speed-Up!)
  // ----------------------------------------------------
  timestamps.finaleStart = nowSec();
  markScene('Act 9: Finale Summary & Unified AIAAS Ecosystem (2X Speed Target)');

  await page.goto(`${BASE_URL}/ai-chat`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Quick energetic navigation across the topbar
  await page.goto(`${BASE_URL}/agents`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);

  await page.goto(`${BASE_URL}/apps`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);

  await page.goto(`${BASE_URL}/ai-chat`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);

  timestamps.totalDuration = nowSec();
  console.log(`Walkthrough completed in ${timestamps.totalDuration.toFixed(2)}s. Closing browser...`);

  // Save timing metadata
  writeFileSync(
    resolve(VIDEO_DIR, 'story_timestamps.json'),
    JSON.stringify(timestamps, null, 2)
  );

  // Close context to flush video to disk
  await context.close();
  await browser.close();

  // Find the generated video file
  const videoPath = await page.video()?.path();
  console.log(`Video recorded to: ${videoPath}`);

  if (videoPath) {
    writeFileSync(resolve(VIDEO_DIR, 'latest_raw_video.txt'), videoPath);
  }
}

main().catch(err => {
  console.error('Recording error:', err);
  process.exit(1);
});
