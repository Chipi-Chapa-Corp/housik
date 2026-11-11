import { defineConfig } from '@playwright/test';
const fixtureDir = `./.test-data/${Date.now()}`;
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:5180',
    headless: !process.env.HEADED,
    viewport: { width: 1440, height: 1050 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'npm run dev -- --port 5180 --strictPort',
    url: 'http://127.0.0.1:5180',
    reuseExistingServer: !!process.env.E2E_EXTERNAL_SERVER,
    env: {
      HOUSIK_TEST_DIR: fixtureDir,
      DATABASE_PATH: `${fixtureDir}/housik.sqlite`,
      UPLOAD_DIR: `${fixtureDir}/receipts`,
      OPENAI_API_KEY: ''
    }
  }
});
