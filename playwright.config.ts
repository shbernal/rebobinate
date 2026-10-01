import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/specs',
  fullyParallel: false,
  workers: 1,
  // Absorbs the odd slow browser launch; a test that passes only on retry is
  // still reported as flaky, not passed.
  retries: process.env.CI ? 2 : 1,
  forbidOnly: Boolean(process.env.CI),
  // Every test launches a real persistent profile into its output directory —
  // cookies, history, login data — so a passing test keeps none of it.
  preserveOutput: 'failures-only',
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium-extension',
      use: {
        browserName: 'chromium',
      },
    },
  ],
})
