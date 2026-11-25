import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Code that runs in the browser must not reach the database (vite.config.ts checks it again when
// building). ESLint's own rule does not look at import().
const serverOnly = {
  regex: '(^|/)server(/|$)|^(drizzle-orm|drizzle-kit|@electric-sql|pg|express)(/|$)|^node:',
  message: 'Server code cannot be used here.',
}
const browserSafe = {
  'no-restricted-imports': ['error', { patterns: [serverOnly] }],
  'no-restricted-syntax': [
    'error',
    {
      selector: `ImportExpression > Literal[value=/${serverOnly.regex.replaceAll('/', '\\u002f')}/]`,
      message: serverOnly.message,
    },
  ],
}

const data = {
  regex: '(^|/)db(/|$)|^(drizzle-orm|@electric-sql|pg)(/|$)|/access/(system|filters|facts)$|/people/lookup$',
  message: 'Routes have no access to data. Call a service, which takes the acting person.',
}
const noData = {
  'no-restricted-imports': ['error', { patterns: [data] }],
  'no-restricted-syntax': [
    'error',
    {
      selector: `ImportExpression > Literal[value=/${data.regex.replaceAll('/', '\\u002f')}/]`,
      message: data.message,
    },
  ],
}

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'playwright-report', 'test-results', '.playwright-browsers', '.data', 'drizzle']),
  {
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/web/public/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        // Not import.meta.dirname: Node 18 does not have it.
        tsconfigRootDir: fileURLToPath(new URL('.', import.meta.url)),
      },
    },
    // Taking some properties off an object.
    rules: { '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }] },
  },
  {
    files: ['src/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs['recommended-latest'], reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/web/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: browserSafe,
  },
  {
    // Routes check, read and hand over. Services know the data and decide about records.
    files: ['src/server/api/**/*.ts'],
    ignores: ['**/*.test.ts', 'src/server/api/health.ts'],
    rules: noData,
  },
  {
    // Shared by server and browser: pure, so also no clock and no environment.
    files: ['src/shared/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      ...browserSafe,
      'no-restricted-globals': ['error', 'process', 'Date', 'fetch', 'window', 'document', 'localStorage'],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random' }],
    },
  },
  {
    // Calendar arithmetic needs Date, always with UTC arguments.
    files: ['src/shared/dates.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },
])
