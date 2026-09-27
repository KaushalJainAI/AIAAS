import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Unit tests — `npm test`.
 *
 * Three runners share this repo and each owns its own files. Vitest had no
 * config of its own, so its default glob swept up both of the others' and
 * reported four "failed suites" that were never its to run:
 *
 *   - `tests/e2e/*.spec.ts`  → Playwright (`playwright.config.ts`). Vitest
 *     cannot execute these at all; it fails at `import '@playwright/test'`.
 *   - `tests/integration/**` → `vitest.integration.config.ts`, which supplies
 *     the MSW setup file those tests need. Run them with `npm run test:integration`.
 *
 * Naming what belongs here is what makes a red `npm test` mean something.
 *
 * This lives in its own file rather than as a `test` block in `vite.config.ts`
 * because that key is not part of vite's own config type, and importing
 * `defineConfig` from `vitest/config` there collides vite's `Plugin` type with
 * the nested copy vitest ships — `tsconfig.node.json` typechecks `vite.config.ts`
 * and nothing else, so the split keeps `tsc -b` clean.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    // Node, not jsdom: everything under `src/**/__tests__` is pure logic
    // (cron parsing, formatting helpers) and jsdom is not a dependency of this
    // project. Component tests that need a DOM belong to the integration
    // config, which has both the environment and the MSW setup.
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
  },
});
