import { building } from '$app/env';
import type { ServerInit } from '@sveltejs/kit/hooks';
import { startRateRefresh } from '#lib/server/exchange-rates.ts';

export const init: ServerInit = () => {
  if (!building) startRateRefresh();
};
