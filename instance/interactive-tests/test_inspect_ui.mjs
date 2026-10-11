import { chromium } from '@playwright/test';
import fs from 'fs';

async function test() {
  const token = fs.readFileSync('../.prod-token', 'utf-8').trim();
  const b = await chromium.launch({
    executablePath: 'C:\\Users\\91700\\AppData\\Local\\Perplexity\\Comet\\Application\\comet.exe',
    headless: true
  });
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.addInitScript(t => {
    localStorage.setItem('access_token', t);
    localStorage.setItem('theme', 'dark');
  }, token);

  const p = await ctx.newPage();

  // Test 1: Apps Writer
  await p.goto('https://aiaas.kaushaljain.com/apps/writer');
  await p.waitForTimeout(2500);
  console.log('Writer URL:', p.url());
  const writerHeadings = await p.locator('h1, h2, h3, button').allInnerTexts();
  console.log('Writer sample controls:', writerHeadings.filter(t => t.trim()).slice(0, 8));

  // Test 2: Runs detail
  await p.goto('https://aiaas.kaushaljain.com/runs?run=80c84131-a1dd-4e10-b594-1f0faa43fc0f');
  await p.waitForTimeout(2500);
  console.log('Runs URL:', p.url());
  const runHeadings = await p.locator('h1, h2, h3, div[class*="font-semibold"]').allInnerTexts();
  console.log('Runs sample controls:', runHeadings.filter(t => t.trim()).slice(0, 8));

  // Test 3: Evals detail
  await p.goto('https://aiaas.kaushaljain.com/evals');
  await p.waitForTimeout(2500);
  console.log('Evals URL:', p.url());
  const evalHeadings = await p.locator('h1, h2, h3, div[class*="font-semibold"]').allInnerTexts();
  console.log('Evals sample controls:', evalHeadings.filter(t => t.trim()).slice(0, 8));

  await b.close();
}

test().catch(console.error);
