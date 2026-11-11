import { defineEnvVars } from '@sveltejs/kit/env';
export const variables = defineEnvVars({
  DATABASE_PATH: { schema: (value: string | undefined) => value || './data/housik.sqlite' },
  UPLOAD_DIR: { schema: (value: string | undefined) => value || './data/receipts' },
  OPENAI_API_KEY: { schema: (value: string | undefined) => value || '' },
  OPENAI_MODEL: { schema: (value: string | undefined) => value || 'gpt-4.1-mini' }
});
