import { defineConfig } from '@playwright/test';
import config from './playwright.config';
process.env.HOUSIK_RECEIPT_TEST_DIR ||= `./.test-data/receipts-${Date.now()}`;
const fixtureDir = process.env.HOUSIK_RECEIPT_TEST_DIR;
const port = process.env.HOUSIK_E2E_PORT || '5193';
export default defineConfig({
  ...config,
  testMatch: '**/receipts.spec.ts',
  testIgnore: [],
  use: { ...config.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    ...config.webServer,
    command: 'node tests/browser/server.mjs',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    env: {
      HOUSIK_E2E_PORT: port,
      HOUSIK_TEST_DIR: fixtureDir,
      DATABASE_PATH: `${fixtureDir}/housik.sqlite`,
      UPLOAD_DIR: `${fixtureDir}/receipts`,
      HOUSIK_RECEIPT_FIXTURE: 'true',
      OPENAI_API_KEY: ''
    }
  }
});
