#!/usr/bin/env node
/**
 * Runs Vitest with a working directory and entry path whose Windows drive
 * letter is uppercase. `npm test` / `npm run test:watch` / `test:integration`
 * go through here; arguments are passed on unchanged.
 *
 * Why: a terminal opened by VS Code starts in `c:\...` (lowercase drive).
 * Node keys ES modules by URL and URLs are case-sensitive, so Vitest ended up
 * loaded twice — once as `file:///c:/...`, once as `file:///C:/...`. The test
 * file's `describe` registered with the copy whose runner was never set, and
 * every suite failed at collection with "Cannot read properties of undefined
 * (reading 'config')" before a single test ran. From a `C:\` prompt the same
 * suite passed. Changing directory inside the Vitest config is too late —
 * Node has already resolved Vitest's own files by then — so the fix is to
 * start Vitest in a fresh process with one spelling (2026-11-17).
 *
 * Everywhere but Windows this is a plain pass-through. Running `npx vitest`
 * directly still works from a `C:\` prompt; from a `c:\` one, use npm.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const upperDrive = (p) => (/^[a-z]:/.test(p) ? p[0].toUpperCase() + p.slice(1) : p);

const root = upperDrive(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const entry = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');

const result = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status ?? 1);
