/**
 * record_interactive_showcase.mjs
 *
 * Full interactive product walkthrough recording:
 * - Shows real chat results (orchestration & agent analysis)
 * - Toggles controls in Agent Builder (autonomy & permissions)
 * - Shows real scheduled trigger ("Weekday briefing" fired today)
 * - Opens and inspects real run result (Morning Briefing generated output & traces)
 * - Explores Documents, Apps, Connectors, Tools, Evals, and HITL
 * - 100% natural 1X pace with 4X accelerated loading spans
 * - Outputs synchronized subtitle metadata
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

const session = JSON.parse(readFileSync(resolve(INSTANCE, '.session.json'), 'utf-8'));

const timestamps = {
  scenes: [],
  loadingSpans: [],
  totalDuration: 0,
};

let startTime = 0;
function nowSec() {
  return (Date.now() - startTime) / 1000;
}

function markScene(id, title, subtitle) {
  const t = nowSec();
  console.log(`[SCENE ${id}] "${title}" at ${t.toFixed(2)}s`);
  timestamps.scenes.push({ id, title, subtitle, start: t });
}

async function markLoading(fn) {
  const s = nowSec();
  await fn();
  const e = nowSec();
  if (e - s > 0.8) {
    timestamps.loadingSpans.push({ start: s, end: e });
  }
}

async function smoothScroll(page, distance = 350, steps = 14, delay = 35) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, distance / steps);
    await page.waitForTimeout(delay);
  }
}

async function main() {
  console.log('Launching Comet browser for deep interactive showcase...');
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

  await context.addInitScript(({ access, refresh }) => {
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
    localStorage.setItem('theme', 'dark');
  }, { access: session.access_token, refresh: session.refresh_token });

  const page = await context.newPage();
  startTime = Date.now();

  // --------------------------------------------------------------------------
  // SCENE 1: AI Chat & Real Intelligence Results
  // --------------------------------------------------------------------------
  markScene(1, 'AI Chat: Autonomous Manager', 'Natural language interface planning tasks & coordinating specialized sub-agents');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/ai-chat?session=d637b165-fc99-4252-8b7f-82fab2289556`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  });

  // Scroll to show the prompt and the first rich answer on permissions
  await smoothScroll(page, 320, 14, 40);
  await page.waitForTimeout(2000);

  // Scroll further down to reveal the second query result on sub-agent orchestration
  await smoothScroll(page, 480, 16, 40);
  await page.waitForTimeout(3000);

  // --------------------------------------------------------------------------
  // SCENE 2: The Agent Fleet (31 Active Specialized Agents)
  // --------------------------------------------------------------------------
  markScene(2, 'Automations: 31 Specialized Agents', 'Dedicated workers for SQL, extraction, briefings, ML & data engineering');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/agents`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  });
  // Smooth scroll through the agent fleet
  await smoothScroll(page, 380, 14, 40);
  await page.waitForTimeout(1500);
  await smoothScroll(page, -250, 12, 40);
  await page.waitForTimeout(1200);

  // --------------------------------------------------------------------------
  // SCENE 3: Deep Agent Builder with Interactive Toggles
  // --------------------------------------------------------------------------
  markScene(3, 'Agent Builder: Interactive Controls', 'Fine-tune prompts, select models, toggle tool permissions & set autonomy safety');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/agents/9`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  });

  // Show the configuration board on the right
  await smoothScroll(page, 300, 12, 40);
  await page.waitForTimeout(1500);

  // Interact with the UI: Click a switch or button to demonstrate interactivity
  try {
    const switches = page.locator('button[role="switch"], input[type="checkbox"]');
    if (await switches.count() > 0) {
      await switches.first().click();
      await page.waitForTimeout(1000);
      await switches.first().click(); // toggle back
      await page.waitForTimeout(800);
    }
  } catch (e) {}

  await smoothScroll(page, 350, 14, 40);
  await page.waitForTimeout(2000);

  // --------------------------------------------------------------------------
  // SCENE 4: 24/7 Unattended Cron Schedules
  // --------------------------------------------------------------------------
  markScene(4, 'Automated Cron Schedules', 'Trigger agents unattended on recurring schedules (Weekday briefing at 8:00 AM)');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/schedules`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  });
  await smoothScroll(page, 300, 12, 40);
  await page.waitForTimeout(2000);

  // --------------------------------------------------------------------------
  // SCENE 5: Real Agent Results & Execution Traces (Today's Run)
  // --------------------------------------------------------------------------
  markScene(5, 'Live Results & Execution Traces', 'Real briefing generated today: cited web sources, token usage & reasoning steps');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/runs?run=80c84131-a1dd-4e10-b594-1f0faa43fc0f`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
  });

  // Scroll down through the real generated executive briefing report
  await smoothScroll(page, 450, 16, 40);
  await page.waitForTimeout(2500);
  await smoothScroll(page, 450, 16, 40);
  await page.waitForTimeout(2500);

  // --------------------------------------------------------------------------
  // SCENE 6: Full Observability & Human-in-the-Loop Queue
  // --------------------------------------------------------------------------
  markScene(6, 'Human-in-the-Loop Governance', 'Sensitive actions pause for human approval — complete enterprise auditability');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/runs`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  });
  await smoothScroll(page, 350, 14, 40);
  await page.waitForTimeout(2000);

  // --------------------------------------------------------------------------
  // SCENE 7: Native Productivity Apps & Documents
  // --------------------------------------------------------------------------
  markScene(7, 'Productivity Apps & Documents', 'Built-in Docs, Sheets & Slides: Agents write directly to your file library');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/apps`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  });
  await smoothScroll(page, 300, 12, 40);
  await page.waitForTimeout(1500);

  // Go to Documents
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/documents`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  });
  await smoothScroll(page, 350, 14, 40);
  await page.waitForTimeout(2000);

  // --------------------------------------------------------------------------
  // SCENE 8: Enterprise Connectors & Custom MCP Tools
  // --------------------------------------------------------------------------
  markScene(8, 'Enterprise Connectors & MCP', 'Connect Gmail, Drive, Sheets, Slack & custom Model Context Protocol servers');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/connections`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  });
  await smoothScroll(page, 350, 14, 40);
  await page.waitForTimeout(1500);

  await markLoading(async () => {
    await page.goto(`${BASE_URL}/tools`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
  });
  await smoothScroll(page, 250, 12, 40);
  await page.waitForTimeout(1500);

  // --------------------------------------------------------------------------
  // SCENE 9: Model Evals & Continuous Quality Benchmarks
  // --------------------------------------------------------------------------
  markScene(9, 'Model Evals & Accuracy Testing', 'Automated test suites and graders ensure agents never hallucinate in production');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/evals`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  });
  await smoothScroll(page, 300, 12, 40);
  await page.waitForTimeout(2500);

  // --------------------------------------------------------------------------
  // SCENE 10: Grand Finale Overview
  // --------------------------------------------------------------------------
  markScene(10, 'AIAAS: Complete Agentic System', 'Plan, delegate and automate enterprise workflows with full human control');
  await page.goto(`${BASE_URL}/ai-chat`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  timestamps.totalDuration = nowSec();

  for (let i = 0; i < timestamps.scenes.length; i++) {
    const nextStart = i < timestamps.scenes.length - 1 ? timestamps.scenes[i + 1].start : timestamps.totalDuration;
    timestamps.scenes[i].end = nextStart;
  }

  writeFileSync(
    resolve(VIDEO_DIR, 'interactive_story_timestamps.json'),
    JSON.stringify(timestamps, null, 2)
  );

  await context.close();
  await browser.close();

  const videoPath = await page.video()?.path();
  console.log(`Interactive walkthrough recorded: ${videoPath}`);
}

main().catch(err => {
  console.error('Interactive recording error:', err);
  process.exit(1);
});
