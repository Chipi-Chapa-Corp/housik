import { defineConfig } from '@playwright/test';
import config from './playwright.config';

export default defineConfig({
  ...config,
  testMatch: '**/pwa.spec.ts',
  testIgnore: [],
  webServer: {
    ...config.webServer,
    command: 'npm run build && npm run preview -- --port 5180 --strictPort',
    reuseExistingServer: false,
    timeout: 120000
  }
});
