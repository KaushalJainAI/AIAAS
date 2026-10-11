/**
 * record_deep_story.mjs — In-Depth, User-Perspective Product Walkthrough
 *
 * Runs Comet browser directly, logged in as Kaushal, capturing every feature
 * in genuine depth: real query/response in Chat, full Agent Builder inspection,
 * Apps workspace, Documents, Connectors, Schedules, Evals, and Runs/HITL.
 * Outputs exact scene timestamps for subtitle synchronization and 2X finale.
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
  finaleStart: 0,
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

async function smoothScroll(page, distance = 300, steps = 12, delay = 35) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, distance / steps);
    await page.waitForTimeout(delay);
  }
}

async function main() {
  console.log('Starting in-depth walkthrough recording via Comet browser...');
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
  // SCENE 1: AI Chat Manager & Intelligence
  // --------------------------------------------------------------------------
  markScene(1, 'AI Chat: Autonomous Manager', 'Natural language interface that plans, queries and coordinates work');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/ai-chat`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
  });
  await smoothScroll(page, 150);
  await page.waitForTimeout(1000);
  await smoothScroll(page, -150);
  await page.waitForTimeout(1500);

  // --------------------------------------------------------------------------
  // SCENE 2: Real Query & Agent Fleet Response
  // --------------------------------------------------------------------------
  markScene(2, 'Fleet Intelligence in Action', 'Real query inspecting agent capabilities, tool permissions & approval policies');
  // Load the working session that has real agent analysis
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/ai-chat?session=d637b165-fc99-4252-8b7f-82fab2289556`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  });
  // Smoothly scroll down the rich answer showing agent analysis
  await smoothScroll(page, 450, 18, 45);
  await page.waitForTimeout(2000);
  await smoothScroll(page, 300, 15, 45);
  await page.waitForTimeout(2000);

  // --------------------------------------------------------------------------
  // SCENE 3: Automations Catalogue (31 Specialized Sub-Agents)
  // --------------------------------------------------------------------------
  markScene(3, 'Automations: 31 Specialized Agents', 'Ready-to-deploy agents for SQL, extraction, briefings & engineering');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/agents`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
  });
  await smoothScroll(page, 400, 16, 40);
  await page.waitForTimeout(1500);
  await smoothScroll(page, -400, 16, 40);
  await page.waitForTimeout(1500);

  // --------------------------------------------------------------------------
  // SCENE 4: In-Depth Agent Builder & Autonomy Guardrails
  // --------------------------------------------------------------------------
  markScene(4, 'Agent Builder: Deep Configuration', 'Set system prompts, models, tool permissions & Human-in-the-Loop guardrails');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/agents/9`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  });
  // Showcase the right side configuration board
  await smoothScroll(page, 350, 15, 40);
  await page.waitForTimeout(2000);
  await smoothScroll(page, 400, 15, 40);
  await page.waitForTimeout(2000);

  // --------------------------------------------------------------------------
  // SCENE 5: Productivity Apps & Native Workspace
  // --------------------------------------------------------------------------
  markScene(5, 'Native Productivity Apps', 'Built-in Docs, Sheets & Slides: Agents write directly to your files');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/apps`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
  });
  await smoothScroll(page, 300);
  await page.waitForTimeout(1500);
  // Open the writer workspace
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/apps/writer`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  });
  await page.waitForTimeout(2000);

  // --------------------------------------------------------------------------
  // SCENE 6: Document Intelligence & Semantic RAG
  // --------------------------------------------------------------------------
  markScene(6, 'Document Intelligence & RAG', 'Semantic vector search & document ingestion for deep contextual knowledge');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/documents`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  });
  await smoothScroll(page, 300);
  await page.waitForTimeout(2000);

  // --------------------------------------------------------------------------
  // SCENE 7: Enterprise Connectors & Custom Tools
  // --------------------------------------------------------------------------
  markScene(7, 'Enterprise Connectors & MCP', 'Connect Gmail, Drive, Sheets, Slack & custom Model Context Protocol servers');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/connections`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  });
  await smoothScroll(page, 350);
  await page.waitForTimeout(1500);
  // Inspect Tools
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/tools`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
  });
  await smoothScroll(page, 250);
  await page.waitForTimeout(1500);

  // --------------------------------------------------------------------------
  // SCENE 8: Automated 24/7 Schedules
  // --------------------------------------------------------------------------
  markScene(8, 'Unattended Cron Schedules', 'Automate recurring workflows with precision cron timing running 24/7');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/schedules`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  });
  await smoothScroll(page, 300);
  await page.waitForTimeout(2000);

  // --------------------------------------------------------------------------
  // SCENE 9: Model Evals & Continuous Quality Benchmarks
  // --------------------------------------------------------------------------
  markScene(9, 'Model Evals & Benchmarks', 'Quantify agent performance, reasoning accuracy & regression metrics');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/evals`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  });
  await smoothScroll(page, 300);
  await page.waitForTimeout(2000);

  // --------------------------------------------------------------------------
  // SCENE 10: Full Observability & Human-In-The-Loop Approvals
  // --------------------------------------------------------------------------
  markScene(10, 'Full Observability & HITL', 'Live execution traces, token consumption & Human-in-the-Loop approval queue');
  await markLoading(async () => {
    await page.goto(`${BASE_URL}/runs`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  });
  await smoothScroll(page, 450);
  await page.waitForTimeout(2000);

  // --------------------------------------------------------------------------
  // SCENE 11: GRAND FINALE (Accelerated 2X)
  // --------------------------------------------------------------------------
  timestamps.finaleStart = nowSec();
  markScene(11, 'AIAAS: Autonomous Enterprise AI', 'From executive prompt to automated execution with full human control [2X]');

  await page.goto(`${BASE_URL}/ai-chat`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  await page.goto(`${BASE_URL}/agents`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);

  await page.goto(`${BASE_URL}/apps`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);

  await page.goto(`${BASE_URL}/ai-chat`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);

  timestamps.totalDuration = nowSec();

  // Set scene ends
  for (let i = 0; i < timestamps.scenes.length; i++) {
    const nextStart = i < timestamps.scenes.length - 1 ? timestamps.scenes[i + 1].start : timestamps.totalDuration;
    timestamps.scenes[i].end = nextStart;
  }

  writeFileSync(
    resolve(VIDEO_DIR, 'deep_story_timestamps.json'),
    JSON.stringify(timestamps, null, 2)
  );

  await context.close();
  await browser.close();

  const videoPath = await page.video()?.path();
  console.log(`Deep walkthrough video recorded: ${videoPath}`);
  if (videoPath) {
    writeFileSync(resolve(VIDEO_DIR, 'latest_deep_raw.txt'), videoPath);
  }
}

main().catch(err => {
  console.error('Deep recording error:', err);
  process.exit(1);
});
