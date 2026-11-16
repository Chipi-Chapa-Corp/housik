export function byteRange(header: string | null, size: number) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size <= 0) throw new RangeError('Unsatisfiable range.');
  const first = Number(match[1]),
    last = Number(match[2]);
  if ((match[1] && !Number.isSafeInteger(first)) || (match[2] && !Number.isSafeInteger(last)))
    throw new RangeError('Invalid range.');
  const start = match[1] ? first : Math.max(0, size - last);
  const end = match[1] && match[2] ? Math.min(last, size - 1) : size - 1;
  if (start >= size || start > end || (!match[1] && !last))
    throw new RangeError('Unsatisfiable range.');
  return { start, end };
}
