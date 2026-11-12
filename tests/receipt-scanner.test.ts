import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { LlmCall } from '../src/lib/llm-usage';
import {
  fileMime,
  scanProducts,
  receiptPrompt,
  ReceiptError
} from '../src/lib/server/receipt-scanner';
const bytes = Buffer.from('receipt bytes');
const result = (products: unknown[]) =>
  Response.json({
    output: [{ content: [{ type: 'output_text', text: JSON.stringify({ products }) }] }]
  });
const product = { name: 'Milk', amount: 125, currency: 'EUR' };

test('live comparison pins the exact production prompt before any paid calls', async () => {
  const pinned = await readFile(new URL('./llm/fixtures/prompt.txt', import.meta.url), 'utf8');
  assert.equal(receiptPrompt, pinned.trimEnd());
});

test('one receipt produces one attached-image request with strict product-array output', async () => {
  let requests = 0;
  const products = await scanProducts(bytes, 'image/png', {
    key: 'fixture-key',
    model: 'fixture-model',
    reasoning: 'low',
    fetch: async (_url, init) => {
      requests++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.instructions, receiptPrompt);
      assert.equal(body.store, false);
      assert.deepEqual(body.reasoning, { effort: 'low' });
      assert.equal(body.input.length, 1);
      assert.deepEqual(body.input[0].content, [
        {
          type: 'input_image',
          image_url: `data:image/png;base64,${bytes.toString('base64')}`,
          detail: 'high'
        }
      ]);
      assert.equal(body.text.format.strict, true);
      assert.equal(body.text.format.schema.properties.products.type, 'array');
      assert.deepEqual(body.text.format.schema.properties.products.items.required, [
        'name',
        'amount',
        'currency'
      ]);
      assert.deepEqual(body.text.format.schema.properties.products.items.properties.currency.enum, [
        'EUR',
        'CZK',
        null
      ]);
      return result([product]);
    }
  });
  assert.equal(requests, 1);
  assert.deepEqual(products, [{ title: 'Milk', amount: 125, currency: 'EUR' }]);
});

test('undetected currencies default to CZK without changing printed amounts', async () => {
  const products = await scanProducts(bytes, 'image/png', {
    key: 'fixture',
    model: 'fixture',
    fetch: async () =>
      result([
        { name: 'Unknown currency', amount: 125, currency: null },
        { name: 'Czech item', amount: 350, currency: 'CZK' },
        { name: 'Euro item', amount: 200, currency: 'EUR' }
      ])
  });
  assert.deepEqual(
    products.map(({ amount, currency }) => ({ amount, currency })),
    [
      { amount: 125, currency: 'CZK' },
      { amount: 350, currency: 'CZK' },
      { amount: 200, currency: 'EUR' }
    ]
  );
});

test('PDF is attached as a file; invalid products are excluded from a best-effort result', async () => {
  const products = await scanProducts(bytes, 'application/pdf', {
    key: 'fixture',
    model: 'fixture',
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.input[0].content[0].type, 'input_file');
      assert.equal(
        body.input[0].content[0].file_data,
        `data:application/pdf;base64,${bytes.toString('base64')}`
      );
      return result([
        product,
        { name: '', amount: 10, currency: 'EUR' },
        { name: 'Bad', amount: -1, currency: 'CZK' }
      ]);
    }
  });
  assert.equal(products.length, 1);
});

test('failures and empty extraction request manual review instead of invented products', async () => {
  for (const response of [
    new Response('secret upstream error', { status: 503 }),
    result([]),
    Response.json({ status: 'incomplete' })
  ]) {
    await assert.rejects(
      scanProducts(bytes, 'image/png', {
        key: 'fixture',
        model: 'fixture',
        fetch: async () => response
      }),
      ReceiptError
    );
  }
  assert.equal(fileMime(Buffer.from('%PDF-1.4')), 'application/pdf');
  assert.throws(() => fileMime(Buffer.from('<html>not an image</html>')), /Use a JPG/);
});

test('provider concurrency is bounded for a multi-receipt batch', async () => {
  let running = 0,
    maximum = 0;
  const fetcher: typeof fetch = async () => {
    running++;
    maximum = Math.max(maximum, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running--;
    return result([product]);
  };
  await Promise.all(
    Array.from({ length: 6 }, () =>
      scanProducts(bytes, 'image/png', { key: 'fixture', model: 'fixture', fetch: fetcher })
    )
  );
  assert.equal(maximum, 5);
});

test('one usage record is emitted for success and for an HTTP failure', async () => {
  const calls: LlmCall[] = [];
  await scanProducts(bytes, 'image/png', {
    key: 'fixture',
    model: 'gpt-6-luna',
    reasoning: 'low',
    onCall: (call) => {
      calls.push(call);
    },
    fetch: async () =>
      Response.json({
        id: 'fixture-response',
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          total_tokens: 120,
          output_tokens_details: { reasoning_tokens: 10 }
        },
        output: [
          { content: [{ type: 'output_text', text: JSON.stringify({ products: [product] }) }] }
        ]
      })
  });
  await assert.rejects(
    scanProducts(bytes, 'image/png', {
      key: 'fixture',
      model: 'gpt-6-luna',
      onCall: (call) => {
        calls.push(call);
      },
      fetch: async () => new Response('', { status: 503 })
    })
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].responseId, 'fixture-response');
  assert.equal(calls[0].totalTokens, 120);
  assert.equal(calls[0].reasoningTokens, 10);
  assert.equal(calls[1].httpStatus, 503);
  assert.equal(calls[1].costUsd, null);
});
