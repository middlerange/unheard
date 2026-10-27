import { describe, expect, it, vi } from 'vitest';
import { invokeResearchProcess, researchDailyJob, runResearchWorkflow, runSlackWorkflow } from './research-runtime.mjs';

describe('durable research execution', () => {
  it('collects each source before ranking and gives paid ranking no automatic retries', async () => {
    const operations: string[] = [];
    const options: Record<string, { retries?: { limit: number } }> = {};
    const step = {
      do: async (name: string, config: { retries?: { limit: number } }, work: () => Promise<unknown>) => {
        options[name] = config;
        return work();
      },
    };
    const invoke = async (payload: { operation: string; sourceId?: string }) => {
      operations.push(payload.sourceId || payload.operation);
      return payload.operation === 'plan' ? { sourceIds: ['teresa-torres', 'lenny'] } : { status: 'completed' };
    };
    await runResearchWorkflow('run-1', step, invoke);
    expect(operations).toEqual(['plan', 'teresa-torres', 'lenny', 'rank', 'drafts']);
    expect(options['Rank findings'].retries).toEqual({ limit: 0, delay: '1 second', backoff: 'constant' });
    expect(options['Draft daily posts'].retries).toEqual({ limit: 0, delay: '1 second', backoff: 'constant' });
  });

  it('records failure without continuing into paid analysis', async () => {
    const invoke = vi.fn(async (payload: { operation: string }) => {
      if (payload.operation === 'plan') return { sourceIds: ['broken-source'] };
      if (payload.operation === 'collect') throw new Error('Database unavailable');
      return { status: 'failed' };
    });
    const step = { do: async (_name: string, _config: unknown, work: () => Promise<unknown>) => work() };
    await expect(runResearchWorkflow('run-1', step, invoke)).rejects.toThrow('Database unavailable');
    expect(invoke.mock.calls.map(([payload]) => payload.operation)).toEqual(['plan', 'collect', 'fail']);
  });

  it('continues transcript collection before ranking instead of dropping videos beyond the first batch', async () => {
    let collectionCalls = 0;
    const operations: string[] = [];
    const invoke = vi.fn(async (payload: { operation: string }) => {
      operations.push(payload.operation);
      if (payload.operation === 'plan') return { sourceIds: ['public-video-source'] };
      if (payload.operation === 'collect') return { collected: 14, pending: ++collectionCalls < 3 };
      return { pending: false };
    });
    const doStep = vi.fn(async (_name: string, _config: unknown, work: () => Promise<unknown>) => work());
    await runResearchWorkflow('video-run', { do: doStep }, invoke);
    expect(operations).toEqual(['plan', 'collect', 'collect', 'collect', 'rank', 'drafts']);
    expect(doStep.mock.calls.map(([name]) => name)).toContain('Collect public-video-source batch 3');
  });

  it('collects later ready sources before sleeping for the remaining source cooldown', async () => {
    const events: string[] = [];
    let calls = 0;
    const invoke = vi.fn(async (payload: { operation: string; sourceId?: string }) => {
      events.push(payload.sourceId || payload.operation);
      if (payload.operation === 'plan') return { sourceIds: ['limited', 'next-source'] };
      if (payload.sourceId === 'limited' && ++calls === 1) return { collected: 8, pending: true, retryAfterMs: 120_001 };
      return { pending: false };
    });
    const sleep = vi.fn(async (name: string, duration: string) => { events.push(`sleep:${name}:${duration}`); });
    const step = { do: async (_name: string, _options: unknown, work: () => Promise<unknown>) => work(), sleep };
    await runResearchWorkflow('cooldown-run', step, invoke);
    expect(sleep).toHaveBeenCalledWith('Wait for research collection round 1', '121 seconds');
    expect(events).toEqual(['plan', 'limited', 'next-source', 'sleep:Wait for research collection round 1:121 seconds', 'limited', 'rank', 'drafts']);
  });

  it('visits every pending source once per round until all batches finish, without a cooled source blocking ready work', async () => {
    const events: string[] = [];
    const calls: Record<string, number> = {};
    const invoke = vi.fn(async (payload: { operation: string; sourceId?: string }) => {
      if (payload.operation === 'plan') return { sourceIds: ['limited', 'ready', 'failed-source'] };
      if (payload.operation !== 'collect') { events.push(payload.operation); return { pending: false }; }
      const source = payload.sourceId!;
      const batch = calls[source] = (calls[source] || 0) + 1;
      events.push(`${source}:${batch}`);
      if (source === 'failed-source') return { error: 'Source returned HTTP 403' };
      return { pending: batch < 3, ...(source === 'limited' && batch < 3 ? { retryAfterMs: 120_000 } : {}) };
    });
    const sleep = vi.fn(async () => {});
    const doStep = vi.fn(async (_name: string, _options: unknown, work: () => Promise<unknown>) => work());
    await runResearchWorkflow('fair-run', { do: doStep, sleep }, invoke);
    expect(events).toEqual(['limited:1', 'ready:1', 'failed-source:1', 'limited:2', 'ready:2', 'limited:3', 'ready:3', 'rank', 'drafts']);
    expect(sleep).not.toHaveBeenCalled();
    expect(doStep.mock.calls.map(([name]) => name)).toEqual([
      'Plan research collection', 'Collect limited', 'Collect ready', 'Collect failed-source',
      'Collect limited batch 2', 'Collect ready batch 2', 'Collect limited batch 3', 'Collect ready batch 3', 'Rank findings', 'Draft daily posts',
    ]);
    expect(calls['failed-source']).toBe(1);
    for (const [name, config] of doStep.mock.calls) {
      if (name === 'Rank findings' || name === 'Draft daily posts') expect(config).toMatchObject({ retries: { limit: 0 } });
    }
  });

  it('sleeps for the minimum persisted cooldown only when all remaining sources are cooling down, with deterministic replay', async () => {
    const counts: Record<string, number> = {};
    const invoke = vi.fn(async (payload: { operation: string; sourceId?: string }) => {
      if (payload.operation === 'plan') return { sourceIds: ['slow', 'quick'] };
      if (payload.operation !== 'collect') return { pending: false };
      const source = payload.sourceId!;
      const call = counts[source] = (counts[source] || 0) + 1;
      if (source === 'slow') return call < 3 ? { pending: true, retryAfterMs: call === 1 ? 90_000 : 80_000 } : { pending: false };
      return call === 1 ? { pending: true, retryAfterMs: 10_000 } : { pending: false };
    });
    const completed = new Map<string, unknown>();
    const doStep = vi.fn(async (name: string, _options: unknown, work: () => Promise<unknown>) => {
      if (!completed.has(name)) completed.set(name, await work());
      return completed.get(name);
    });
    const sleep = vi.fn(async (_name: string, _duration: string) => {});
    await runResearchWorkflow('all-cooling', { do: doStep, sleep }, invoke);
    expect(sleep.mock.calls).toEqual([
      ['Wait for research collection round 1', '10 seconds'], ['Wait for research collection round 2', '80 seconds'],
    ]);
    const names = doStep.mock.calls.map(([name]) => name);
    const calls = invoke.mock.calls.length;
    doStep.mockClear(); sleep.mockClear();
    await runResearchWorkflow('all-cooling', { do: doStep, sleep }, invoke);
    expect(invoke).toHaveBeenCalledTimes(calls);
    expect(doStep.mock.calls.map(([name]) => name)).toEqual(names);
    expect(sleep.mock.calls).toEqual([
      ['Wait for research collection round 1', '10 seconds'], ['Wait for research collection round 2', '80 seconds'],
    ]);
  });

  it('bounds failure dispatch before validation and preserves the original exception', async () => {
    const original = new Error(`Database unavailable: ${'x'.repeat(6000)}`);
    const invoke = vi.fn(async (payload: { operation: string; error?: string }) => {
      if (payload.operation === 'plan') return { sourceIds: [] };
      if (payload.operation === 'rank') throw original;
      if ((payload.error?.length || 0) > 1000) throw new Error('Invalid research job');
      return { status: 'failed' };
    });
    const step = { do: async (_name: string, _config: unknown, work: () => Promise<unknown>) => work() };
    await expect(runResearchWorkflow('run-1', step, invoke)).rejects.toBe(original);
    expect(invoke.mock.calls.at(-1)?.[0]).toEqual({ operation: 'fail', runId: 'run-1', error: original.message.slice(0, 500) });
    expect(invoke.mock.calls.map(([payload]) => payload.operation)).toEqual(['plan', 'rank', 'fail']);
  });

  it('does not mask the original failure if its recording also fails', async () => {
    const original = new Error('Ranking failed');
    const recording = new Error('Failure recording unavailable');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const invoke = vi.fn(async (payload: { operation: string }) => {
        if (payload.operation === 'plan') return { sourceIds: [] };
        if (payload.operation === 'fail') throw recording;
        throw original;
      });
      const step = { do: async (_name: string, _config: unknown, work: () => Promise<unknown>) => work() };
      await expect(runResearchWorkflow('run-1', step, invoke)).rejects.toBe(original);
      expect(log).toHaveBeenCalledWith('Could not record research failure:', recording);
    } finally {
      log.mockRestore();
    }
  });

  it('continues pending ranking in separate durable steps before drafting', async () => {
    let rankingCalls = 0;
    const invoke = vi.fn(async (payload: { operation: string }) => {
      if (payload.operation === 'plan') return { sourceIds: [] };
      if (payload.operation === 'rank') return { ok: true, pending: ++rankingCalls < 3 };
      return { drafted: 1 };
    });
    const doStep = vi.fn(async (_name: string, _config: unknown, work: () => Promise<unknown>) => work());
    expect(await runResearchWorkflow('large-run', { do: doStep }, invoke)).toEqual({ drafted: 1 });
    expect(doStep.mock.calls.map(([name]) => name)).toEqual([
      'Plan research collection', 'Rank findings', 'Rank findings batch 2', 'Rank findings batch 3', 'Draft daily posts',
    ]);
    for (const [, config] of doStep.mock.calls.slice(1)) expect(config).toMatchObject({ retries: { limit: 0 } });
    expect(invoke.mock.calls.map(([payload]) => payload.operation)).toEqual(['plan', 'rank', 'rank', 'rank', 'drafts']);
  });

  it('does not repeat an interrupted paid continuation or draft partial findings', async () => {
    let rankingCalls = 0;
    const invoke = vi.fn(async (payload: { operation: string }) => {
      if (payload.operation === 'plan') return { sourceIds: [] };
      if (payload.operation === 'rank') {
        if (++rankingCalls === 1) return { pending: true };
        throw new Error('Model response interrupted');
      }
      return { ok: true };
    });
    const doStep = vi.fn(async (_name: string, _config: unknown, work: () => Promise<unknown>) => work());
    await expect(runResearchWorkflow('large-run', { do: doStep }, invoke)).rejects.toThrow('Model response interrupted');
    expect(invoke.mock.calls.map(([payload]) => payload.operation)).toEqual(['plan', 'rank', 'rank', 'fail']);
    expect(doStep.mock.calls.find(([name]) => name === 'Rank findings batch 2')?.[1]).toMatchObject({ retries: { limit: 0 } });
  });

  it('continues all drafting batches without a total draft quota or paid retries', async () => {
    let draftCalls = 0;
    const invoke = vi.fn(async (payload: { operation: string }) => {
      if (payload.operation === 'plan') return { sourceIds: [] };
      if (payload.operation === 'rank') return { pending: false };
      draftCalls++;
      return { drafted: draftCalls * 3, pending: draftCalls < 9 };
    });
    const doStep = vi.fn(async (_name: string, _config: unknown, work: () => Promise<unknown>) => work());
    expect(await runResearchWorkflow('uncapped-run', { do: doStep }, invoke)).toEqual({ drafted: 27, pending: false });
    expect(draftCalls).toBe(9);
    expect(doStep.mock.calls.map(([name]) => name)).toContain('Draft daily posts batch 9');
    for (const [, config] of doStep.mock.calls.slice(1)) expect(config).toMatchObject({ retries: { limit: 0 } });
  });

  it('signs internal dispatch and surfaces a failed handler response', async () => {
    let received: Request | undefined;
    const handler = {
      fetch: async (request: Request) => {
        received = request;
        return Response.json({ error: 'Unknown run' }, { status: 404 });
      },
    };
    await expect(invokeResearchProcess(handler, { SESSION_SECRET: 'test-only-worker-secret' }, { operation: 'plan', runId: 'a' })).rejects.toThrow('Unknown run');
    expect(received?.headers.get('x-research-signature')).toMatch(/^[a-f0-9]{64}$/);
    const rawBody = await received!.text();
    const timestamp = received!.headers.get('x-research-timestamp');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('test-only-worker-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const bytes = Uint8Array.from(received!.headers.get('x-research-signature')!.match(/../g)!, byte => parseInt(byte, 16));
    expect(await crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(`${timestamp}.${rawBody}`))).toBe(true);
  });

  it('forwards minute cron ticks including Cloudflare timestamps with seconds and milliseconds', () => {
    for (const time of ['2026-10-23T03:00:00Z', '2026-10-23T03:01:00Z', '2026-10-26T09:50:51.409Z']) {
      expect(researchDailyJob(Date.parse(time))).toEqual({ operation: 'daily', scheduledTime: Date.parse(time) });
    }
  });

  it('routes durable Slack work to the signed endpoint without retrying paid edits or publishing', async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    const doStep = vi.fn(async (_name: string, _options: unknown, work: () => Promise<unknown>) => work());
    await runSlackWorkflow('slack-job', { do: doStep }, invoke);
    expect(invoke).toHaveBeenCalledWith({ operation: 'process', jobId: 'slack-job' });
    expect(doStep.mock.calls[0][1]).toMatchObject({ retries: { limit: 0, delay: '1 second' } });
    let path = '';
    const handler = { fetch: async (request: Request) => { path = new URL(request.url).pathname; return Response.json({ ok: true }); } };
    await invokeResearchProcess(handler, { SESSION_SECRET: 'test-only-worker-secret' }, { operation: 'process', jobId: 'slack-job' }, '/api/slack/process');
    expect(path).toBe('/api/slack/process');
  });
});
