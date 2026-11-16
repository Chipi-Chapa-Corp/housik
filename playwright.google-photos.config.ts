import base from './playwright.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  ...base,
  outputDir: '.test-data/google-photos-browser-results',
  testIgnore: [],
  testMatch: '**/google-photos.spec.ts',
  webServer: {
    ...base.webServer,
    command: 'node tests/browser/server.mjs',
    url: `http://127.0.0.1:${process.env.HOUSIK_E2E_PORT || '5180'}`,
    env: {
      ...(base.webServer as { env: Record<string, string> }).env,
      HOUSIK_GOOGLE_PHOTOS_FIXTURE: 'true',
      GOOGLE_PHOTOS_CLIENT_ID: 'fixture-client',
      GOOGLE_PHOTOS_CLIENT_SECRET: 'fixture-secret'
    }
  }
});
