export const RESEARCH_PRICING_DATE = '2026-10-23';
export const RESEARCH_PRICING_URL = 'https://developers.openai.com/api/docs/pricing';
export const SOL_RESEARCH_PRICING_DATE = '2026-10-28';
export const ANTHROPIC_RESEARCH_PRICING_DATE = '2026-10-27';
export const ANTHROPIC_RESEARCH_PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing';
export const SONNET_RESEARCH_PRICING_DATE = '2026-10-28';
export const SONNET_RESEARCH_PRICING_URL = 'https://platform.claude.com/docs/en/models/sonnet-5-5/overview';

export type ModelUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
  input_tokens_details?: {
    cached_tokens?: number;
    cache_write_tokens?: number;
    cache_write_tokens_details?: { ttl_30m_tokens?: number; ttl_12h_tokens?: number };
  };
};

export function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function priceResearchUsage(model: string, tier: string, usage?: ModelUsage) {
  const sonnet = /^claude-sonnet-5-5(?:-\d{8}|-\d{4}-\d{2}-\d{2})?$/.test(model);
  if (sonnet || /^claude-haiku-5-5(?:-|$)/.test(model)) return priceAnthropicResearchUsage(tier, usage, sonnet);
  const input = tokenCount(usage?.input_tokens);
  const output = tokenCount(usage?.output_tokens);
  const cached = tokenCount(usage?.input_tokens_details?.cached_tokens);
  const writes = tokenCount(usage?.input_tokens_details?.cache_write_tokens);
  const unknown = { input, output, cached, writes, costNanoUsd: null, costStatus: 'unknown', rateCard: null };
  const sol = /^gpt-6-sol(?:-\d{4}-\d{2}-\d{2})?$/.test(model);
  if (input === null || output === null || !sol && !/^gpt-6-luna(?:-|$)/.test(model)) return unknown;
  const multiplier = { default: 1, standard: 1, priority: 2, fast: 2, flex: 0.5 }[tier];
  if (multiplier === undefined) return unknown;
  const long = input > 272_000;
  const rates = {
    asOf: sol ? SOL_RESEARCH_PRICING_DATE : RESEARCH_PRICING_DATE,
    input: sol ? (long ? 4 : 2) : (long ? 0.2 : 0.1), output: sol ? (long ? 15 : 10) : (long ? 0.75 : 0.5),
    cachedInput: sol ? (long ? 0.4 : 0.2) : (long ? 0.02 : 0.01),
    write30m: sol ? (long ? 5 : 2.5) : (long ? 0.25 : 0.125), write12h: sol ? (long ? 10 : 5) : (long ? 0.5 : 0.25),
    multiplier,
  };
  if ((cached ?? 0) + (writes ?? 0) > input) return unknown;
  let costStatus = 'calculated';
  const cachedTokens = cached ?? 0;
  let writes30 = writes ?? 0;
  let writes12 = 0;
  if (cached === null || writes === null) {
    // Older responses did not expose cache billing. Budget unclassified input as a 30m write.
    costStatus = 'estimated';
    writes30 = input - cachedTokens;
  } else if (writes > 0) {
    const details = usage?.input_tokens_details?.cache_write_tokens_details;
    if (details) {
      const shortWrites = tokenCount(details.ttl_30m_tokens);
      const longWrites = tokenCount(details.ttl_12h_tokens);
      if (shortWrites === null || longWrites === null || shortWrites + longWrites !== writes) return unknown;
      writes30 = shortWrites;
      writes12 = longWrites;
    }
  }
  const ordinary = input - cachedTokens - writes30 - writes12;
  const usd = (ordinary * rates.input + cachedTokens * rates.cachedInput + writes30 * rates.write30m + writes12 * rates.write12h + output * rates.output) * multiplier / 1_000_000;
  return { input, output, cached, writes, costNanoUsd: Math.round(usd * 1_000_000_000), costStatus, rateCard: JSON.stringify(rates) };
}

function priceAnthropicResearchUsage(tier: string, usage?: ModelUsage, sonnet = false) {
  const ordinary = tokenCount(usage?.input_tokens);
  const output = tokenCount(usage?.output_tokens);
  const cached = tokenCount(usage?.cache_read_input_tokens ?? 0);
  const writes = tokenCount(usage?.cache_creation_input_tokens ?? 0);
  const input = ordinary === null || cached === null || writes === null ? null : tokenCount(ordinary + cached + writes);
  const unknown = { input, output, cached, writes, costNanoUsd: null, costStatus: 'unknown', rateCard: null };
  if (input === null || ordinary === null || output === null || cached === null || writes === null
    || !['default', 'standard'].includes(tier)) return unknown;
  let writes5m = writes;
  let writes1h = 0;
  let costStatus = 'calculated';
  if (usage?.cache_creation) {
    const shortWrites = tokenCount(usage.cache_creation.ephemeral_5m_input_tokens);
    const longWrites = tokenCount(usage.cache_creation.ephemeral_1h_input_tokens);
    if (shortWrites === null || longWrites === null || shortWrites + longWrites !== writes) return unknown;
    writes5m = shortWrites;
    writes1h = longWrites;
  } else if (writes > 0) {
    costStatus = 'estimated';
  }
  const long = input > 100_000;
  const rates = sonnet ? {
    asOf: SONNET_RESEARCH_PRICING_DATE, source: SONNET_RESEARCH_PRICING_URL,
    input: 2, output: 10, cachedInput: 0.1, write5m: 2.5, write1h: 4,
  } : {
    asOf: ANTHROPIC_RESEARCH_PRICING_DATE, source: ANTHROPIC_RESEARCH_PRICING_URL,
    input: long ? 0.5 : 0.1, output: long ? 2.5 : 0.5,
    cachedInput: long ? 0.05 : 0.01, write5m: long ? 0.625 : 0.125, write1h: long ? 1 : 0.2,
  };
  const usd = (ordinary * rates.input + cached * rates.cachedInput + writes5m * rates.write5m
    + writes1h * rates.write1h + output * rates.output) / 1_000_000;
  return { input, output, cached, writes, costNanoUsd: Math.round(usd * 1_000_000_000), costStatus, rateCard: JSON.stringify(rates) };
}
