import { readFile } from 'node:fs/promises';
import { writeReceiptReport } from './write-report';
import type { LlmCall } from '../../src/lib/llm-usage';

for (const number of [1, 2, 3]) {
  try {
    const actual = JSON.parse(
      await readFile(new URL(`../../.test-data/llm/${number}.actual.json`, import.meta.url), 'utf8')
    );
    const expected = JSON.parse(
      await readFile(new URL(`./fixtures/${number}.expected.json`, import.meta.url), 'utf8')
    );
    let call: LlmCall | undefined;
    try {
      call = JSON.parse(
        await readFile(new URL(`../../.test-data/llm/${number}.call.json`, import.meta.url), 'utf8')
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await writeReceiptReport(number, expected, actual, call);
  } catch (error) {
    process.stdout.write(
      `Receipt ${number}: comparison unavailable — ${(error as NodeJS.ErrnoException).code === 'ENOENT' ? 'no saved response' : 'could not read saved response'}\n`
    );
  }
}
