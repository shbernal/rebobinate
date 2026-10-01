import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'jsdom',
    exclude: [...configDefaults.exclude, 'e2e/**'],
    environmentOptions: {
      jsdom: {
        url: 'https://example.com/watch',
      },
    },
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      // Listed rather than left to what the tests import, so a file no test
      // touches shows at 0% instead of dropping out of the number.
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/**/*.test.{ts,tsx}', 'src/popup/main.tsx'],
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      // About a point under what the suite measures, so a change that drops
      // coverage fails CI. Raise them as tests land; never above the measure.
      thresholds: { statements: 94, branches: 89, functions: 95, lines: 94 },
      reportsDirectory: 'coverage',
    },
  },
})
