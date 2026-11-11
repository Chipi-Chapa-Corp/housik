export const rateScale = 1_000_000;
export type Currency = 'EUR' | 'CZK';

export function inputCurrency(value: unknown): Currency {
  if (value === 'EUR' || value === 'CZK') return value;
  throw new Error('Choose EUR or CZK.');
}

// Keep minor units as integers and round once, after currency and nightly multiplication.
export function toCzk(amount: number, currency: Currency, rate: number | null, nights = 1) {
  if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(nights) || nights < 1)
    throw new Error('Enter a valid amount.');
  const units = currency === 'EUR' ? rate : rateScale;
  if (!units || !Number.isSafeInteger(units) || units <= 0)
    throw new Error('Exchange rate unavailable. Try again later or enter CZK.');
  const result = Number(
    (BigInt(amount) * BigInt(nights) * BigInt(units) + BigInt(rateScale / 2)) / BigInt(rateScale)
  );
  if (!Number.isSafeInteger(result) || result > 1_000_000_000)
    throw new Error('Amount is too large.');
  return result;
}
