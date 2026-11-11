import { defineEnvVars } from '@sveltejs/kit/env';
export const variables = defineEnvVars({
  DATABASE_PATH: { schema: (value: string | undefined) => value || './data/housik.sqlite' },
  UPLOAD_DIR: { schema: (value: string | undefined) => value || './data/receipts' },
  EXCHANGE_RATE_URL: {
    schema: (value: string | undefined) => value || 'https://api.frankfurter.dev/v2/rate/EUR/CZK'
  },
  OPENAI_API_KEY: { schema: (value: string | undefined) => value || '' },
  OPENAI_RESPONSES_URL: {
    schema: (value: string | undefined) => value || 'https://api.openai.com/v1/responses'
  },
  OPENAI_MODEL: { schema: (value: string | undefined) => value || 'gpt-4.1-mini' }
});
