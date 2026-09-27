import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // The codebase already marks deliberately-unused bindings with a leading
      // underscore (_edges, _cache, _multiline). Without this the linter
      // reports them anyway, which trains people to skim past the rule — and
      // the genuinely discarded ones get lost in the noise.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
    },
  },
  {
    // `src/api/` is the only place that talks to the backend. A page that
    // calls the HTTP client itself grows its own copy of the URL, the envelope
    // handling and the types, and the copies drift (Skills once declared ids
    // as strings while the service said numbers). Helpers from `api/client`
    // — `tokenManager`, `handleApiError` — stay importable; only the client
    // itself and raw axios are fenced in.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/api/**', '**/__tests__/**'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: 'axios',
          message: 'Call the backend through a service in src/api/, not axios directly.',
        }],
        patterns: [{
          group: ['**/api/client'],
          importNames: ['default'],
          message: 'Add a function to the matching service in src/api/ and call that instead.',
        }],
      }],
    },
  },
])
