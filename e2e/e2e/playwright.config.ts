import { defineConfig, devices } from '@playwright/test';

/**
 * Tixly E2E Smoke Tests
 *
 * Targets the staging environment. Configure environment variables:
 *   BASE_URL       — staging API base URL (default: http://localhost:3000)
 *   ADMIN_TOKEN    — admin bearer token for seeding test data
 *   GOPAY_SANDBOX  — set to "1" to enable GoPay sandbox mode
 *
 * Run: npx playwright test
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,      // smoke tests run sequentially to preserve order
  retries: process.env.CI ? 2 : 0,
  workers: 1,

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/smoke-results.json' }],
  ],

  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  },

  projects: [
    {
      name: 'api-smoke',
      use: { ...devices['Desktop Chrome'] },
      testMatch: '**/smoke-*.spec.ts',
    },
  ],
});
