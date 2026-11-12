import { usageLine, type LlmCall } from '../../src/lib/llm-usage';

type Product = { name?: unknown; amount?: unknown; currency?: unknown };
export type ReceiptComparison = ReturnType<typeof compareReceipt>;

function products(value: unknown): Product[] | null {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as { products?: unknown }).products)
  )
    return null;
  return (value as { products: unknown[] }).products.map((item) =>
    item && typeof item === 'object' ? (item as Product) : {}
  );
}
function total(items: Product[]) {
  const sums = new Map<string, number>();
  for (const item of items) {
    if (typeof item.amount !== 'number' || !Number.isSafeInteger(item.amount))
      return 'invalid amount';
    const currency = String(item.currency ?? 'CZK');
    sums.set(currency, (sums.get(currency) ?? 0) + item.amount);
  }
  return (
    [...sums].map(([currency, amount]) => `${(amount / 100).toFixed(2)} ${currency}`).join(' + ') ||
    '0.00'
  );
}
export function compareReceipt(number: number, expected: unknown, actual: unknown, call?: LlmCall) {
  const before = products(expected),
    after = products(actual);
  const rows = Array.from(
    { length: Math.max(before?.length ?? 0, after?.length ?? 0) },
    (_, index) => {
      const e = before?.[index],
        a = after?.[index];
      return {
        line: index + 1,
        expected: e,
        actual: a,
        numbersMatch:
          !!e &&
          !!a &&
          Number.isSafeInteger(a.amount) &&
          a.amount === e.amount &&
          (a.currency ?? 'CZK') === (e.currency ?? 'CZK')
      };
    }
  );
  return {
    call,
    number,
    rows,
    numbersMatch: !!before && !!after && rows.every((row) => row.numbersMatch),
    expectedCount: before?.length ?? 0,
    actualCount: after?.length ?? 0,
    expectedTotal: before ? total(before) : 'unavailable',
    actualTotal: after ? total(after) : 'unavailable'
  };
}

function name(product?: Product) {
  return product ? String(product.name ?? '(unnamed)') : '(missing line)';
}
function amount(product?: Product) {
  return product
    ? `${typeof product.amount === 'number' ? (product.amount / 100).toFixed(2) : '(invalid amount)'} ${String(product.currency ?? 'CZK')}`
    : '—';
}
function characterDiff(before: string, after: string) {
  const e = [...before],
    a = [...after];
  const lengths = Array.from({ length: e.length + 1 }, () => new Uint16Array(a.length + 1));
  for (let i = e.length - 1; i >= 0; i--)
    for (let j = a.length - 1; j >= 0; j--)
      lengths[i][j] =
        e[i] === a[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
  const left: { char: string; changed: boolean }[] = [],
    right: { char: string; changed: boolean }[] = [];
  let i = 0,
    j = 0;
  while (i < e.length || j < a.length) {
    if (i < e.length && j < a.length && e[i] === a[j]) {
      left.push({ char: e[i++], changed: false });
      right.push({ char: a[j++], changed: false });
    } else if (i < e.length && (j === a.length || lengths[i + 1][j] >= lengths[i][j + 1]))
      left.push({ char: e[i++], changed: true });
    else right.push({ char: a[j++], changed: true });
  }
  return { left, right };
}
export function useColors(stream: NodeJS.WriteStream = process.stdout) {
  if (process.env.FORCE_COLOR === '0' || process.env.NO_COLOR !== undefined) return false;
  return !!stream.isTTY || !!process.env.FORCE_COLOR;
}
export function renderReceiptText(report: ReceiptComparison, color = false, columns = 120) {
  const paint = (text: string, code: number) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
  const width = Math.max(24, Math.floor((columns - 9) / 2));
  const lines = [
    `\nReceipt ${report.number} · ${paint(report.numbersMatch ? 'NUMBERS MATCH' : 'NUMBERS DIFFER', report.numbersMatch ? 32 : 31)}`,
    `Items: ${report.expectedCount} expected / ${report.actualCount} actual`,
    `Total: ${report.expectedTotal} expected / ${report.actualTotal} actual`,
    ...(report.call ? [usageLine(report.call)] : []),
    paint('Names are informational. Red = expected; green = actual.', 90),
    `    ${paint('EXPECTED'.padEnd(width), 31)} │ ${paint('ACTUAL', 32)}`
  ];
  for (const row of report.rows) {
    const diff = characterDiff(name(row.expected), name(row.actual));
    const height = Math.max(1, Math.ceil(Math.max(diff.left.length, diff.right.length) / width));
    for (let index = 0; index < height; index++) {
      const left = diff.left.slice(index * width, (index + 1) * width),
        right = diff.right.slice(index * width, (index + 1) * width);
      const text = (chars: typeof left, code: number) =>
        chars.map(({ char, changed }) => (changed ? paint(char, code) : char)).join('');
      lines.push(
        `${index === 0 ? String(row.line).padStart(2) : '  '}  ${text(left, 31)}${' '.repeat(width - left.length)} │ ${text(right, 32)}`
      );
    }
    lines.push(
      `    ${paint(amount(row.expected).padEnd(width), row.numbersMatch ? 90 : 31)} │ ${paint(amount(row.actual), row.numbersMatch ? 90 : 32)} ${row.numbersMatch ? paint('✓', 32) : paint('≠', 31)}`
    );
  }
  return lines.join('\n') + '\n';
}

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
  );
export function renderReceiptHtml(report: ReceiptComparison) {
  const rows = report.rows
    .map((row) => {
      const diff = characterDiff(name(row.expected), name(row.actual));
      const text = (chars: typeof diff.left, side: string) =>
        chars
          .map(({ char, changed }) =>
            changed ? `<span class="${side}">${escape(char)}</span>` : escape(char)
          )
          .join('');
      return `<tr><td>${row.line}</td><td>${text(diff.left, 'removed')}</td><td class="${row.numbersMatch ? '' : 'removed'}">${escape(amount(row.expected))}</td><td>${text(diff.right, 'added')}</td><td class="${row.numbersMatch ? '' : 'added'}">${escape(amount(row.actual))}</td></tr>`;
    })
    .join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Receipt ${report.number} comparison</title>
  <style>*{box-sizing:border-box}body{margin:24px;background:#f5f5f5;color:#303030;font:1rem/1.6 system-ui,sans-serif}h1,p,table{font-size:1rem}main{max-width:1200px;margin:auto;background:white;padding:24px;border-radius:12px}h1{margin:0 0 12px}.status{color:${report.numbersMatch ? '#21613a' : '#a51d2d'}}.removed{background:#ffe3e7;color:#9b1830}.added{background:#dff3e5;color:#175c32}.legend{color:#505050}.table{overflow:auto}table{border-collapse:collapse;width:100%;text-align:left}th,td{padding:12px;border-bottom:1px solid #ddd;vertical-align:top;overflow-wrap:anywhere}td:nth-child(3),td:nth-child(5){white-space:nowrap}th{background:#f1f1f1}</style>
  <main><h1>Receipt ${report.number} · <span class="status">${report.numbersMatch ? 'Numbers match' : 'Numbers differ'}</span></h1>
  <p>Items: ${report.expectedCount} expected / ${report.actualCount} actual<br>Total: ${escape(report.expectedTotal)} expected / ${escape(report.actualTotal)} actual</p>
  ${report.call ? `<p>${escape(usageLine(report.call)).replace('\n', '<br>')}<br>${escape(report.call.priceSource ?? 'USD rates not configured')}</p>` : ''}
  <p class="legend">Names are informational. <span class="removed">Expected differences</span> · <span class="added">Actual differences</span></p>
  <div class="table"><table><thead><tr><th>Line</th><th>Expected name</th><th>Expected amount</th><th>Actual name</th><th>Actual amount</th></tr></thead><tbody>${rows}</tbody></table></div></main></html>`;
}
