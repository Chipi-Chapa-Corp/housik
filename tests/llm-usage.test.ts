import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callUsage, configuredRates, reasoningEffort } from '../src/lib/llm-usage';
const options = {
  startedAt: '2026-11-11T00:00:00Z',
  model: 'gpt-6-luna',
  reasoning: 'low',
  httpStatus: 200,
  durationMs: 250
};

test('cached reads and writes are priced separately and reasoning is not charged twice', () => {
  const call = callUsage(
    {
      id: 'response',
      usage: {
        input_tokens: 12000,
        output_tokens: 1000,
        total_tokens: 13000,
        input_tokens_details: { cached_tokens: 4000, cache_write_tokens: 7000 },
        output_tokens_details: { reasoning_tokens: 600 }
      }
    },
    options
  );
  assert.equal(call.reasoningTokens, 600);
  assert.equal(call.totalTokens, 13000);
  assert.ok(Math.abs(call.costUsd! - 0.001515) < 1e-12);
  assert.equal(call.reasoningEffort, 'low');
});
test('missing usage or unknown rates are unavailable, never zero cost', () => {
  assert.equal(callUsage(undefined, { ...options, httpStatus: 503 }).costUsd, null);
  assert.equal(callUsage(undefined, options).totalTokens, null);
  assert.equal(
    callUsage({ usage: { input_tokens: 10, output_tokens: 20 } }, { ...options, model: 'custom' })
      .costUsd,
    null
  );
});
test('Sol estimates account for cache writes and leave unknown long-context pricing unavailable', () => {
  const call = callUsage(
    {
      model: 'gpt-6.1-sol-2026-09-29',
      usage: {
        input_tokens: 1320,
        input_tokens_details: { cache_write_tokens: 1317 },
        output_tokens: 1163,
        output_tokens_details: { reasoning_tokens: 784 }
      }
    },
    options
  );
  assert.ok(Math.abs(call.costUsd! - 0.0149285) < 1e-12);
  assert.match(call.priceSource!, /Azure billing may differ/);
  assert.equal(
    callUsage(
      { usage: { input_tokens: 300000, output_tokens: 1000 } },
      { ...options, model: 'gpt-6.1-sol' }
    ).costUsd,
    null
  );
});
test('custom billing rates and long-context model rates are recorded', () => {
  const custom = configuredRates({ input: '1', cachedInput: '0.1', output: '5' });
  const call = callUsage(
    { usage: { input_tokens: 100, output_tokens: 20 } },
    { ...options, rates: custom }
  );
  assert.ok(Math.abs(call.costUsd! - 0.0002) < 1e-12);
  assert.equal(call.priceSource, 'Configured USD rates');
  const longer = callUsage({ usage: { input_tokens: 300000, output_tokens: 1000 } }, options);
  assert.equal(longer.ratesUsdPerMillion?.input, 0.2);
  assert.equal(longer.ratesUsdPerMillion?.output, 0.75);
  assert.throws(() => configuredRates({ input: '1' }), /together/);
});
test('reasoning remains optional for models without reasoning support', () => {
  assert.equal(reasoningEffort(''), undefined);
  assert.equal(reasoningEffort('low'), 'low');
  assert.throws(() => reasoningEffort('bogus'), /valid/);
});
