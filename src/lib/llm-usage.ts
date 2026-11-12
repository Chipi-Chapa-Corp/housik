export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export function reasoningEffort(value?: string): ReasoningEffort | undefined {
  if (!value) return undefined;
  if (!['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value))
    throw new Error('Choose a valid OPENAI_REASONING_EFFORT.');
  return value as ReasoningEffort;
}
export type TokenRates = {
  input: number;
  cachedInput: number;
  output: number;
  cacheWrite?: number;
};
export function configuredRates(values: {
  input?: string;
  cachedInput?: string;
  output?: string;
  cacheWrite?: string;
}): TokenRates | undefined {
  if (!Object.values(values).some((value) => value !== undefined && value !== '')) return undefined;
  const rate = (value?: string) =>
    value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0
      ? Number(value)
      : undefined;
  const input = rate(values.input),
    cachedInput = rate(values.cachedInput),
    output = rate(values.output),
    cacheWrite = rate(values.cacheWrite);
  if (
    input === undefined ||
    cachedInput === undefined ||
    output === undefined ||
    (values.cacheWrite && cacheWrite === undefined)
  )
    throw new Error(
      'Configure valid input, cached-input and output USD rates per million tokens together.'
    );
  return { input, cachedInput, output, cacheWrite };
}
export type LlmCall = {
  startedAt: string;
  model: string;
  reasoningEffort: string | null;
  responseId: string | null;
  httpStatus: number | null;
  durationMs: number;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  ratesUsdPerMillion: TokenRates | null;
  priceSource: string | null;
};
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
export function callUsage(
  body:
    | {
        id?: string;
        model?: string;
        usage?: {
          input_tokens?: unknown;
          output_tokens?: unknown;
          total_tokens?: unknown;
          input_tokens_details?: { cached_tokens?: unknown; cache_write_tokens?: unknown };
          output_tokens_details?: { reasoning_tokens?: unknown };
        };
      }
    | undefined,
  options: {
    startedAt: string;
    model: string;
    reasoning?: string;
    httpStatus: number | null;
    durationMs: number;
    rates?: TokenRates;
  }
): LlmCall {
  const usage = body?.usage;
  const model = body?.model || options.model;
  const inputTokens = count(usage?.input_tokens),
    outputTokens = count(usage?.output_tokens);
  const cachedInputTokens = usage ? (count(usage.input_tokens_details?.cached_tokens) ?? 0) : null;
  const cacheWriteTokens = usage
    ? (count(usage.input_tokens_details?.cache_write_tokens) ?? 0)
    : null;
  const reasoningTokens = usage
    ? (count(usage.output_tokens_details?.reasoning_tokens) ?? 0)
    : null;
  let rates = options.rates;
  let priceSource = rates ? 'Configured USD rates' : null;
  if (!rates && /^gpt-6\.1-sol(?:$|-)/.test(model) && (inputTokens ?? 0) <= 272_000) {
    rates = { input: 2, cachedInput: 0.1, cacheWrite: 2.5, output: 10 };
    priceSource =
      'Published OpenAI Standard short-context reference rates (estimate; Azure billing may differ)';
  }
  if (!rates && /^gpt-6-luna(?:$|-)/.test(model)) {
    rates = { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 };
    if (inputTokens !== null && inputTokens > 272_000)
      rates = { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 0.75 };
    priceSource = 'Published GPT-6 Luna Global Standard rates (estimate)';
  }
  let costUsd: number | null = null;
  if (
    rates &&
    inputTokens !== null &&
    outputTokens !== null &&
    cachedInputTokens !== null &&
    cacheWriteTokens !== null &&
    cachedInputTokens + cacheWriteTokens <= inputTokens &&
    (!cacheWriteTokens || rates.cacheWrite !== undefined)
  ) {
    costUsd =
      ((inputTokens - cachedInputTokens - cacheWriteTokens) * rates.input +
        cachedInputTokens * rates.cachedInput +
        cacheWriteTokens * (rates.cacheWrite ?? 0) +
        outputTokens * rates.output) /
      1_000_000;
  }
  return {
    startedAt: options.startedAt,
    model,
    reasoningEffort: options.reasoning ?? null,
    responseId: body?.id ?? null,
    httpStatus: options.httpStatus,
    durationMs: options.durationMs,
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens,
    reasoningTokens,
    totalTokens:
      count(usage?.total_tokens) ??
      (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
    costUsd,
    ratesUsdPerMillion: rates ?? null,
    priceSource
  };
}
export function usageLine(call: LlmCall) {
  const n = (value: number | null) => (value === null ? 'unknown' : String(value));
  return (
    `Tokens: ${n(call.inputTokens)} input (${n(call.cachedInputTokens)} cached, ${n(call.cacheWriteTokens)} cache write) · ${n(call.outputTokens)} output (${n(call.reasoningTokens)} reasoning) · ${n(call.totalTokens)} total\n` +
    `Estimated USD: ${call.costUsd === null ? 'unavailable' : '$' + call.costUsd.toFixed(8)} · ${(call.durationMs / 1000).toFixed(2)}s · ${call.model} · reasoning ${call.reasoningEffort ?? 'default'}`
  );
}
