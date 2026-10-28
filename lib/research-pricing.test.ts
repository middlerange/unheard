import { describe, expect, it } from 'vitest';
import { priceResearchUsage } from './research-pricing';

describe('research cost estimates', () => {
  it('prices ordinary input, cache reads and mixed write lifetimes exactly once', () => {
    const cost = priceResearchUsage('gpt-6-luna', 'default', {
      input_tokens: 12000, output_tokens: 1000,
      input_tokens_details: { cached_tokens: 4000, cache_write_tokens: 7000, cache_write_tokens_details: { ttl_30m_tokens: 3000, ttl_12h_tokens: 4000 } },
    });
    expect(cost.costNanoUsd).toBe(2015000);
    expect(cost.costStatus).toBe('calculated');
    expect(JSON.parse(cost.rateCard!)).toMatchObject({ input: 0.1, write12h: 0.25, asOf: '2026-10-23' });
  });
  it('flags missing cache details as an estimate and unknown prices or usage as unknown', () => {
    expect(priceResearchUsage('gpt-6-luna', 'default', { input_tokens: 2620, output_tokens: 12 })).toMatchObject({ costNanoUsd: 333500, costStatus: 'estimated' });
    for (const value of [
      priceResearchUsage('another-model', 'default', { input_tokens: 10, output_tokens: 5 }),
      priceResearchUsage('gpt-6-luna', 'unrecognized', { input_tokens: 10, output_tokens: 5 }),
      priceResearchUsage('gpt-6-luna', 'default'),
      priceResearchUsage('gpt-6-luna', 'default', { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 11, cache_write_tokens: 0 } }),
    ]) expect(value).toMatchObject({ costNanoUsd: null, costStatus: 'unknown' });
  });
  it('applies returned processing tier and long-context pricing', () => {
    const usage = { input_tokens: 300000, output_tokens: 1000, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } };
    expect(priceResearchUsage('gpt-6-luna-2026-10-01', 'default', usage).costNanoUsd).toBe(60750000);
    expect(priceResearchUsage('gpt-6-luna', 'priority', usage).costNanoUsd).toBe(121500000);
    expect(priceResearchUsage('gpt-6-luna', 'flex', usage).costNanoUsd).toBe(30375000);
    expect(priceResearchUsage('gpt-6-luna', 'default', { input_tokens: 0, output_tokens: 0, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } })).toMatchObject({ costNanoUsd: 0, costStatus: 'calculated' });
  });
});

describe('Sol research cost estimates', () => {
  it('prices ordinary input, reads and both write lifetimes without double counting', () => {
    const cost = priceResearchUsage('gpt-6-sol', 'standard', {
      input_tokens: 12000, output_tokens: 1000,
      input_tokens_details: { cached_tokens: 4000, cache_write_tokens: 7000, cache_write_tokens_details: { ttl_30m_tokens: 3000, ttl_12h_tokens: 4000 } },
    });
    expect(cost).toMatchObject({ input: 12000, output: 1000, cached: 4000, writes: 7000, costNanoUsd: 40300000, costStatus: 'calculated' });
    expect(JSON.parse(cost.rateCard!)).toEqual({ asOf: '2026-10-28', input: 2, output: 10, cachedInput: 0.2, write30m: 2.5, write12h: 5, multiplier: 1 });
  });
  it('uses the long-context card only above272k and applies the existing tier multipliers', () => {
    const usage = { input_tokens: 300000, output_tokens: 1000, input_tokens_details: { cached_tokens: 40000, cache_write_tokens: 70000, cache_write_tokens_details: { ttl_30m_tokens: 30000, ttl_12h_tokens: 40000 } } };
    const cost = priceResearchUsage('gpt-6-sol-2026-10-01', 'default', usage);
    expect(cost).toMatchObject({ costNanoUsd: 1341000000, costStatus: 'calculated' });
    expect(JSON.parse(cost.rateCard!)).toEqual({ asOf: '2026-10-28', input: 4, output: 15, cachedInput: 0.4, write30m: 5, write12h: 10, multiplier: 1 });
    expect(priceResearchUsage('gpt-6-sol', 'priority', usage).costNanoUsd).toBe(2682000000);
    expect(priceResearchUsage('gpt-6-sol', 'fast', usage).costNanoUsd).toBe(2682000000);
    expect(priceResearchUsage('gpt-6-sol', 'flex', usage).costNanoUsd).toBe(670500000);
    const uncached = { output_tokens: 1000, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } };
    expect(priceResearchUsage('gpt-6-sol', 'standard', { ...uncached, input_tokens: 272000 }).costNanoUsd).toBe(554000000);
    expect(priceResearchUsage('gpt-6-sol', 'standard', { ...uncached, input_tokens: 272001 }).costNanoUsd).toBe(1103004000);
  });
  it('preserves conservative missing-cache estimates and rejects unpriced aliases or invalid accounting', () => {
    expect(priceResearchUsage('gpt-6-sol', 'default', { input_tokens: 2620, output_tokens: 12 })).toMatchObject({ costNanoUsd: 6670000, costStatus: 'estimated' });
    expect(priceResearchUsage('gpt-6-sol', 'default', { input_tokens: 0, output_tokens: 0, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } })).toMatchObject({ costNanoUsd: 0, costStatus: 'calculated' });
    for (const model of ['gpt-6-sol-preview', 'gpt-6-sol-20261001', 'gpt-6-solar', 'gpt-6.1-sol', 'unpriced-model'])
      expect(priceResearchUsage(model, 'default', { input_tokens: 100, output_tokens: 10 })).toMatchObject({ costNanoUsd: null, costStatus: 'unknown', rateCard: null });
    for (const cost of [
      priceResearchUsage('gpt-6-sol', 'unpriced-tier', { input_tokens: 100, output_tokens: 10 }),
      priceResearchUsage('gpt-6-sol', 'default'),
      priceResearchUsage('gpt-6-sol', 'default', { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 101, cache_write_tokens: 0 } }),
      priceResearchUsage('gpt-6-sol', 'default', { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 80, cache_write_tokens_details: { ttl_30m_tokens: 30, ttl_12h_tokens: 40 } } }),
    ]) expect(cost).toMatchObject({ costNanoUsd: null, costStatus: 'unknown', rateCard: null });
  });
  it('leaves the full Luna rate card and original pricing date unchanged', () => {
    for (const [input, expected] of [[272000, { input: 0.1, output: 0.5, cachedInput: 0.01, write30m: 0.125, write12h: 0.25 }],
      [272001, { input: 0.2, output: 0.75, cachedInput: 0.02, write30m: 0.25, write12h: 0.5 }]] as const) {
      const cost = priceResearchUsage('gpt-6-luna', 'standard', { input_tokens: input, output_tokens: 0, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } });
      expect(JSON.parse(cost.rateCard!)).toEqual({ asOf: '2026-10-23', ...expected, multiplier: 1 });
    }
  });
});

describe('Anthropic research cost estimates', () => {
  it('adds uncached input, cache reads and cache writes without double counting', () => {
    const cost = priceResearchUsage('claude-haiku-5-5', 'standard', {
      input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 4000, cache_creation_input_tokens: 7000,
      cache_creation: { ephemeral_5m_input_tokens: 3000, ephemeral_1h_input_tokens: 4000 },
    });
    expect(cost).toMatchObject({ input: 12000, output: 500, cached: 4000, writes: 7000, costNanoUsd: 1565000, costStatus: 'calculated' });
    expect(JSON.parse(cost.rateCard!)).toMatchObject({ input: 0.1, write1h: 0.2, asOf: '2026-10-27' });
  });

  it('applies long-context rates only above 100k total input including caches', () => {
    const usage = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 99000 };
    expect(priceResearchUsage('claude-haiku-5-5', 'default', usage)).toMatchObject({ input: 100000, costNanoUsd: 1140000 });
    expect(priceResearchUsage('claude-haiku-5-5-20261001', 'standard', { ...usage, cache_read_input_tokens: 99001 }))
      .toMatchObject({ input: 100001, costNanoUsd: 5700050 });
    expect(priceResearchUsage('claude-haiku-5-5', 'standard', {
      input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 100000,
      cache_creation: { ephemeral_5m_input_tokens: 40000, ephemeral_1h_input_tokens: 60000 },
    })).toMatchObject({ input: 101000, costNanoUsd: 85750000, costStatus: 'calculated' });
  });

  it('prices omitted caches as zero and flags cache writes with unknown lifetime as estimates', () => {
    expect(priceResearchUsage('claude-haiku-5-5', 'standard', { input_tokens: 100, output_tokens: 20 }))
      .toMatchObject({ input: 100, cached: 0, writes: 0, costNanoUsd: 20000, costStatus: 'calculated' });
    expect(priceResearchUsage('claude-haiku-5-5', 'standard', { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 1000 }))
      .toMatchObject({ input: 1100, costNanoUsd: 145000, costStatus: 'estimated' });
    expect(priceResearchUsage('claude-haiku-5-5', 'standard', { input_tokens: 0, output_tokens: 0 }))
      .toMatchObject({ costNanoUsd: 0, costStatus: 'calculated' });
  });

  it('rejects unsupported tiers and incomplete or invalid usage', () => {
    for (const value of [
      priceResearchUsage('claude-haiku-5-5', 'priority', { input_tokens: 100, output_tokens: 20 }),
      priceResearchUsage('claude-haiku-5-5', 'standard'),
      priceResearchUsage('claude-haiku-5-5', 'standard', { input_tokens: 100 }),
      priceResearchUsage('claude-haiku-5-5', 'standard', { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: -1 }),
      priceResearchUsage('claude-haiku-5-5', 'standard', { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 500, ephemeral_1h_input_tokens: 100 } }),
      priceResearchUsage('claude-haiku-5-5', 'standard', { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 20, cache_read_input_tokens: 1 }),
    ]) expect(value).toMatchObject({ costNanoUsd: null, costStatus: 'unknown' });
  });
});

describe('Sonnet research cost estimates', () => {
  it('adds ordinary input, cache reads and mixed write lifetimes exactly once', () => {
    const cost = priceResearchUsage('claude-sonnet-5-5', 'standard', {
      input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 4000, cache_creation_input_tokens: 7000,
      cache_creation: { ephemeral_5m_input_tokens: 3000, ephemeral_1h_input_tokens: 4000 },
    });
    expect(cost).toMatchObject({ input: 12000, output: 500, cached: 4000, writes: 7000, costNanoUsd: 30900000, costStatus: 'calculated' });
    expect(JSON.parse(cost.rateCard!)).toEqual({ asOf: '2026-10-28', source: 'https://platform.claude.com/docs/en/models/sonnet-5-5/overview', input: 2, output: 10, cachedInput: 0.1, write5m: 2.5, write1h: 4 });
  });
  it.each([200000, 1000000])('keeps the same standard rates at %i total input tokens', input => {
    const cost = priceResearchUsage('claude-sonnet-5-5-20261001', 'default', { input_tokens: input, output_tokens: 1000 });
    expect(cost).toMatchObject({ input, costNanoUsd: input * 2000 + 10000000, costStatus: 'calculated' });
    expect(JSON.parse(cost.rateCard!)).toMatchObject({ input: 2, output: 10, cachedInput: 0.1, write5m: 2.5, write1h: 4 });
    expect(priceResearchUsage('claude-sonnet-5-5-2026-10-01', 'standard', { input_tokens: input, output_tokens: 1000 }).costNanoUsd).toBe(cost.costNanoUsd);
  });
  it('preserves estimated write lifetime handling and zero-cache accounting', () => {
    expect(priceResearchUsage('claude-sonnet-5-5', 'standard', { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 1000 }))
      .toMatchObject({ input: 1100, costNanoUsd: 2900000, costStatus: 'estimated' });
    expect(priceResearchUsage('claude-sonnet-5-5', 'default', { input_tokens: 0, output_tokens: 0 }))
      .toMatchObject({ input: 0, cached: 0, writes: 0, costNanoUsd: 0, costStatus: 'calculated' });
  });
  it('rejects unsupported aliases, tiers and malformed cache counts', () => {
    for (const model of ['claude-sonnet-5-5-preview', 'claude-sonnet-5-5-unknown', 'claude-sonnet-5-50'])
      expect(priceResearchUsage(model, 'standard', { input_tokens: 100, output_tokens: 20 })).toMatchObject({ costNanoUsd: null, costStatus: 'unknown' });
    for (const cost of [
      priceResearchUsage('claude-sonnet-5-5', 'priority', { input_tokens: 100, output_tokens: 20 }),
      priceResearchUsage('claude-sonnet-5-5', 'standard', { input_tokens: 100 }),
      priceResearchUsage('claude-sonnet-5-5', 'standard', { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: -1 }),
      priceResearchUsage('claude-sonnet-5-5', 'standard', { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 500, ephemeral_1h_input_tokens: 100 } }),
      priceResearchUsage('claude-sonnet-5-5', 'standard', { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 20, cache_creation_input_tokens: 1 }),
    ]) expect(cost).toMatchObject({ costNanoUsd: null, costStatus: 'unknown', rateCard: null });
  });
});
