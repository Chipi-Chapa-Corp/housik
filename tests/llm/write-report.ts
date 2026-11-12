import { mkdir, writeFile } from 'node:fs/promises';
import { compareReceipt, renderReceiptText, renderReceiptHtml, useColors } from './receipt-report';
import type { LlmCall } from '../../src/lib/llm-usage';

const artifacts = new URL('../../.test-data/llm/', import.meta.url);
export async function writeReceiptReport(
  number: number,
  expected: unknown,
  actual: unknown,
  call?: LlmCall
) {
  const report = compareReceipt(number, expected, actual, call);
  await mkdir(artifacts, { recursive: true });
  await Promise.all([
    writeFile(new URL(`${number}.diff.txt`, artifacts), renderReceiptText(report)),
    writeFile(new URL(`${number}.diff.html`, artifacts), renderReceiptHtml(report))
  ]);
  process.stdout.write(renderReceiptText(report, useColors(), process.stdout.columns || 120));
  process.stdout.write(`Color report: .test-data/llm/${number}.diff.html\n`);
  return report;
}
