import * as env from '$app/env/private';
import { db } from './db';
import { createRateStore } from './rate-store';
import { cents } from '../money';
import { inputCurrency, toCzk } from '../currency';

export const exchangeRates = createRateStore(db, { url: env.EXCHANGE_RATE_URL });

let started = false;
export function startRateRefresh() {
  if (started) return;
  started = true;
  async function poll() {
    await exchangeRates.refresh();
    setTimeout(() => {
      void poll();
    }, exchangeRates.refreshIn()).unref();
  }
  void poll();
}

export async function convertInput(value: unknown, currency: unknown = 'CZK', nights = 1) {
  const selected = inputCurrency(currency);
  const amount = cents(value);
  const rate = selected === 'EUR' ? await exchangeRates.refresh() : null;
  return toCzk(amount, selected, rate?.rate ?? null, nights);
}
