import { readFile, mkdir, writeFile, appendFile, copyFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { scanProducts, receiptPrompt, receiptSchema } from '../../src/lib/server/receipt-scanner';
import { writeReceiptReport } from './write-report';
import { reasoningEffort, configuredRates, type LlmCall } from '../../src/lib/llm-usage';

const fixtures = new URL('./fixtures/', import.meta.url);
const artifacts = new URL('../../.test-data/llm/', import.meta.url);

async function main() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Set OPENAI_API_KEY in .env before running npm run test:llm.');
  const prompt = (await readFile(new URL('prompt.txt', fixtures), 'utf8')).trimEnd();
  if (receiptPrompt !== prompt)
    throw new Error('Production prompt differs from tests/llm/fixtures/prompt.txt.');
  await mkdir(artifacts, { recursive: true });
  const reasoning = reasoningEffort(process.env.OPENAI_REASONING_EFFORT ?? 'low');
  const rates = configuredRates({
    input: process.env.OPENAI_INPUT_USD_PER_MILLION,
    cachedInput: process.env.OPENAI_CACHED_INPUT_USD_PER_MILLION,
    cacheWrite: process.env.OPENAI_CACHE_WRITE_USD_PER_MILLION,
    output: process.env.OPENAI_OUTPUT_USD_PER_MILLION
  });
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const runDir = new URL(`runs/${runId}/`, artifacts);
  await mkdir(new URL('previous/', runDir), { recursive: true });
  await writeFile(new URL('prompt.txt', runDir), prompt + '\n');
  await Promise.all(
    [1, 2, 3].map(async (number) => {
      try {
        for (const suffix of ['actual.json', 'call.json', 'diff.txt', 'diff.html']) {
          const current = new URL(`${number}.${suffix}`, artifacts);
          try {
            await copyFile(current, new URL(`previous/${number}.${suffix}`, runDir));
            await unlink(current);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
        const bytes = await readFile(new URL(`${number}.jpg`, fixtures));
        const expected = JSON.parse(
          await readFile(new URL(`${number}.expected.json`, fixtures), 'utf8')
        );
        let actual: unknown,
          requests = 0;
        let call: LlmCall | undefined;
        try {
          await scanProducts(bytes, 'image/jpeg', {
            key,
            model: process.env.OPENAI_MODEL || 'gpt-6.1-sol',
            url: process.env.OPENAI_RESPONSES_URL || 'https://api.openai.com/v1/responses',
            reasoning,
            rates,
            onCall: async (usage) => {
              call = usage;
              const record = { receipt: number, runId, ...usage };
              await Promise.all([
                writeFile(
                  new URL(`${number}.call.json`, artifacts),
                  JSON.stringify(record, null, 2) + '\n'
                ),
                writeFile(
                  new URL(`${number}.call.json`, runDir),
                  JSON.stringify(record, null, 2) + '\n'
                ),
                appendFile(new URL('calls.jsonl', artifacts), JSON.stringify(record) + '\n')
              ]);
            },
            fetch: async (url, init) => {
              requests++;
              const request = JSON.parse(String(init?.body));
              const input = [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'input_image',
                      image_url: `data:image/jpeg;base64,${bytes.toString('base64')}`,
                      detail: 'high'
                    }
                  ]
                }
              ];
              if (
                request.instructions !== prompt ||
                request.store !== false ||
                !isDeepStrictEqual(
                  request.reasoning,
                  reasoning ? { effort: reasoning } : undefined
                ) ||
                !isDeepStrictEqual(request.input, input) ||
                !isDeepStrictEqual(request.text.format, {
                  type: 'json_schema',
                  name: 'receipt_products',
                  strict: true,
                  schema: receiptSchema
                })
              )
                throw new Error(
                  'Request does not match the exact prompt, attached image or production schema.'
                );
              const response = await fetch(url, init);
              if (!response.ok) return response;
              const body = await response.clone().json();
              const output = body.output
                ?.flatMap(
                  (item: { content?: { type: string; text?: string }[] }) => item.content ?? []
                )
                .find((item: { type: string }) => item.type === 'output_text')?.text;
              if (!output) throw new Error('Provider returned no structured receipt output.');
              actual = JSON.parse(output);
              await writeFile(
                new URL(`${number}.actual.json`, artifacts),
                JSON.stringify(actual, null, 2) + '\n'
              );
              await writeFile(
                new URL(`${number}.actual.json`, runDir),
                JSON.stringify(actual, null, 2) + '\n'
              );
              return response;
            }
          });
        } catch (error) {
          if (actual === undefined) throw error;
        }
        if (requests !== 1) throw new Error('Expected exactly one provider request per receipt.');
        await writeReceiptReport(number, expected, actual, call);
      } catch (error) {
        process.stderr.write(
          `Receipt ${number}: comparison unavailable — ${error instanceof Error ? error.message : 'request failed'}\n`
        );
        process.exitCode = 1;
      }
    })
  );
}
main().catch((error) => {
  process.stderr.write(
    `LLM comparison: ${error instanceof Error ? error.message : 'could not start'}\n`
  );
  process.exitCode = 1;
});
