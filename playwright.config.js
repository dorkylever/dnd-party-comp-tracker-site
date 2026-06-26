// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/* Browser smoke test config. Serves the *built* ./site bundle and runs the
   tests in tests/browser against it, so missing assets or JS load errors in
   the deployed artifact fail CI. Build the bundle first: `npm run build:site`. */

const PORT = 4173;

module.exports = defineConfig({
  testDir: './tests/browser',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: {
    command: 'node scripts/serve-site.js',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
