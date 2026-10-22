import { describe, expect, it, vi } from 'vitest';
import { invokeResearchProcess, isResearchCollectionTick, runResearchWorkflow } from './research-runtime.mjs';

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
    expect(operations).toEqual(['plan', 'teresa-torres', 'lenny', 'rank']);
    expect(options['Rank findings'].retries).toEqual({ limit: 0, delay: '1 second', backoff: 'constant' });
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

  it('dispatches hourly collection checks without changing the minute publisher cadence', () => {
    expect(isResearchCollectionTick(Date.parse('2026-10-23T03:00:00Z'))).toBe(true);
    expect(isResearchCollectionTick(Date.parse('2026-10-23T03:01:00Z'))).toBe(false);
  });
});
