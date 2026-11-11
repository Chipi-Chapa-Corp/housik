import { defineConfig } from '@playwright/test';
const port = process.env.HOUSIK_E2E_PORT || '5180';
const fixtureDir = `./.test-data/${Date.now()}`;
export default defineConfig({
  testDir: './tests/browser',
  testIgnore: ['**/pwa.spec.ts', '**/receipts.spec.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: !process.env.HEADED,
    viewport: { width: 1440, height: 1050 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'node tests/browser/server.mjs',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !!process.env.E2E_EXTERNAL_SERVER,
    env: {
      HOUSIK_E2E_PORT: port,
      HOUSIK_TEST_DIR: fixtureDir,
      DATABASE_PATH: `${fixtureDir}/housik.sqlite`,
      UPLOAD_DIR: `${fixtureDir}/receipts`,
      OPENAI_API_KEY: ''
    }
  }
});
