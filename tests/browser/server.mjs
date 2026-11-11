// Keep browser tests independent of live exchange-rate providers.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const calls = [];
let activeScans = 0,
  maximumScans = 0;
const fixture = process.env.HOUSIK_RECEIPT_FIXTURE === 'true';
function saveCalls() {
  if (fixture) {
    mkdirSync(process.env.HOUSIK_TEST_DIR, { recursive: true });
    writeFileSync(join(process.env.HOUSIK_TEST_DIR, 'provider-calls.json'), JSON.stringify(calls));
    writeFileSync(
      join(process.env.HOUSIK_TEST_DIR, 'provider-stats.json'),
      JSON.stringify({ activeScans, maximumScans })
    );
  }
}
saveCalls();
const provider = createServer(async (request, response) => {
  if (request.url === '/responses' && fixture) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    calls.push(body);
    activeScans++;
    maximumScans = Math.max(maximumScans, activeScans);
    saveCalls();
    const content = body.input[0].content[0];
    const bytes = Buffer.from((content.image_url || content.file_data).split(',')[1], 'base64');
    const failed = bytes.toString().endsWith('fail');
    const empty = bytes.toString().endsWith('empty');
    await new Promise((resolve) =>
      setTimeout(resolve, failed || bytes.toString().includes('parallel-') ? 1800 : 650)
    );
    activeScans--;
    saveCalls();
    response.writeHead(failed ? 503 : 200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify(
        failed
          ? { error: 'fixture upstream unavailable' }
          : {
              output: [
                {
                  content: [
                    {
                      type: 'output_text',
                      text: JSON.stringify({
                        products: empty
                          ? []
                          : [
                              {
                                name: 'Scanned coffee',
                                amount: 125,
                                currency: bytes.toString().endsWith('unknown') ? null : 'EUR'
                              }
                            ]
                      })
                    }
                  ]
                }
              ]
            }
      )
    );
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ date: '2026-11-11', base: 'EUR', quote: 'CZK', rate: 25 }));
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  EXCHANGE_RATE_URL: `http://127.0.0.1:${provider.address().port}/rate`,
  ...(fixture
    ? {
        OPENAI_API_KEY: 'fixture-key',
        OPENAI_MODEL: 'fixture-model',
        OPENAI_RESPONSES_URL: `http://127.0.0.1:${provider.address().port}/responses`
      }
    : {})
};
let child;
function run(args) {
  return new Promise((resolve) => {
    child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...args], {
      env,
      stdio: 'inherit'
    });
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 1));
  });
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child?.kill(signal);
    provider.close();
  });
}
let code = 0;
const production = process.argv.includes('--production');
if (production) code = await run(['build']);
if (!code)
  code = await run([
    production ? 'preview' : 'dev',
    '--host',
    '127.0.0.1',
    '--port',
    process.env.HOUSIK_E2E_PORT || '5180',
    '--strictPort'
  ]);
provider.close();
process.exitCode = code;
