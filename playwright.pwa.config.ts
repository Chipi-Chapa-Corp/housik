import { defineConfig } from '@playwright/test';
import config from './playwright.config';

export default defineConfig({
  ...config,
  testMatch: '**/pwa.spec.ts',
  testIgnore: [],
  webServer: {
    ...config.webServer,
    command: 'node tests/browser/server.mjs --production',
    reuseExistingServer: false,
    timeout: 120000
  }
});
