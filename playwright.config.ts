import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
mkdirSync('.cache/e2e', { recursive: true });
process.env.FORUM_STATE_PATH ??= resolve(mkdtempSync('.cache/e2e/run-'));
export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4321', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
  ],
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: 'http://127.0.0.1:4321',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
