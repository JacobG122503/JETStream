import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ command }) => ({
  root: 'src/web',
  // Built files refer to each other relatively, and the server makes the addresses in index.html
  // absolute for its BASE_PATH (src/server/web.ts). scripts/dev.ts sets the base in development.
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  test: {
    root: '.',
    restoreMocks: true,
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
          include: ['src/server/**/*.test.ts', 'scripts/**/*.test.ts'],
        },
      },
    ],
  },
}))
