import { defineEnvVars } from '@sveltejs/kit/env';
export const variables = defineEnvVars({
  DATABASE_PATH: { schema: (value: string | undefined) => value || './data/housik.sqlite' },
  UPLOAD_DIR: { schema: (value: string | undefined) => value || './data/receipts' },
  EXCHANGE_RATE_URL: {
    schema: (value: string | undefined) => value || 'https://api.frankfurter.dev/v2/rate/EUR/CZK'
  },
  OPENAI_API_KEY: { schema: (value: string | undefined) => value || '' },
  OPENAI_REASONING_EFFORT: { schema: (value: string | undefined) => value ?? 'low' },
  OPENAI_INPUT_USD_PER_MILLION: { schema: (value: string | undefined) => value || '' },
  OPENAI_CACHED_INPUT_USD_PER_MILLION: { schema: (value: string | undefined) => value || '' },
  OPENAI_CACHE_WRITE_USD_PER_MILLION: { schema: (value: string | undefined) => value || '' },
  OPENAI_OUTPUT_USD_PER_MILLION: { schema: (value: string | undefined) => value || '' },
  OPENAI_RESPONSES_URL: {
    schema: (value: string | undefined) => value || 'https://api.openai.com/v1/responses'
  },
  OPENAI_MODEL: { schema: (value: string | undefined) => value || 'gpt-6.1-sol' }
});
