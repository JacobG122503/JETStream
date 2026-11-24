import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/** Fails the build if database or server code would reach the browser. */
const noServerCode: Plugin = {
  name: 'no-server-code',
  apply: 'build',
  transform(_code, id) {
    if (/\/src\/server\/|\/node_modules\/(drizzle-orm|@electric-sql|pg|express)\//.test(id)) {
      this.error(`${id} belongs on the server and must not be imported by the web app.`)
    }
  },
}

export default defineConfig(({ command }) => ({
  root: 'src/web',
  // Built files refer to each other relatively, and the server makes the addresses in index.html
  // absolute for its BASE_PATH (src/server/web.ts). scripts/dev.ts sets the base in development.
  base: command === 'build' ? './' : '/',
  plugins: [react(), noServerCode],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  test: {
    root: '.',
    restoreMocks: true,
    // Many server tests start databases or processes of their own, which need the other cores.
    minWorkers: 1,
    maxWorkers: '50%',
    projects: [
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['src/web/**/*.test.{ts,tsx}'],
          setupFiles: ['src/web/test/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['src/server/**/*.test.ts', 'src/shared/**/*.test.ts', 'scripts/**/*.test.ts'],
        },
      },
    ],
  },
}))
