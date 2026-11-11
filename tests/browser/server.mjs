// Keep browser tests independent of live exchange-rate providers.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const provider = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ date: '2026-11-11', base: 'EUR', quote: 'CZK', rate: 25 }));
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  EXCHANGE_RATE_URL: `http://127.0.0.1:${provider.address().port}/rate`
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
    '5180',
    '--strictPort'
  ]);
provider.close();
process.exitCode = code;
