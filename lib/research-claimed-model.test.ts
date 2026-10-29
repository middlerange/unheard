import { describe, expect, it, vi } from 'vitest';
import { claimedResearchModel } from './research-claimed-model';
import { ResearchModelRateLimitError } from './research-provider-error';

const response = { value: { finding: 'grounded' }, inputTokens: 4, outputTokens: 3 };
function harness() {
  const records = new Map<string, any>(), clock = { value: 1_000_000 }, valid = new Set<string>();
  const invoke = vi.fn(async () => response);
  const access = {
    now: () => clock.value, read: async (id: string) => records.get(id) ?? null,
    claim: async (id: string, value: unknown) => { if (records.has(id)) return false; records.set(id, structuredClone(value)); return true; },
    save: async (id: string, expected: unknown, value: unknown) => { if (JSON.stringify(records.get(id)) !== JSON.stringify(expected)) return false; records.set(id, structuredClone(value)); return true; },
    writeImmutable: async (id: string, value: unknown) => { if (!records.has(id)) records.set(id, structuredClone(value)); },
    verifyRetryRejection: async (id: string) => valid.has(id), invoke, onRejection: async () => {},
  };
  const reject = (id: string, delay = 1_000) => { valid.add(id); const error = new ResearchModelRateLimitError('HTTP 429', delay); error.usageId = id; return error; };
  return { records, clock, valid, invoke, access, reject };
}
describe('durable per-request provider claims', () => {
  it('reuses completed requests and never repeats unknown or permanent failures', async () => {
    const h = harness();
    expect(await claimedResearchModel('a', 'hash-a', h.access)).toEqual(response);
    expect(await claimedResearchModel('a', 'hash-a', h.access)).toEqual(response);
    expect(h.invoke).toHaveBeenCalledTimes(1);
    h.invoke.mockRejectedValueOnce(new Error('HTTP 403'));
    await expect(claimedResearchModel('b', 'hash-b', h.access)).rejects.toThrow('HTTP 403');
    await expect(claimedResearchModel('b', 'hash-b', h.access)).rejects.toThrow('no automatic retry');
    h.invoke.mockRejectedValueOnce(new Error('transport timeout'));
    await expect(claimedResearchModel('c', 'hash-c', h.access)).rejects.toThrow('transport timeout');
    await expect(claimedResearchModel('c', 'hash-c', h.access)).rejects.toThrow('no automatic retry');
    expect(h.invoke).toHaveBeenCalledTimes(3);
  });
  it('keeps a rejected or invalid response fenced within its run while a later run can recover', async () => {
    const h = harness();
    h.invoke.mockRejectedValueOnce(new Error('HTTP 403'));
    await expect(claimedResearchModel('run1-request', 'run1-hash', h.access)).rejects.toThrow('HTTP 403');
    await expect(claimedResearchModel('run1-request', 'run1-hash', h.access)).rejects.toThrow('no automatic retry');
    expect(await claimedResearchModel('run2-request', 'run2-hash', h.access)).toEqual(response);
    h.invoke.mockResolvedValueOnce({ value: { malformed: true }, inputTokens: 1, outputTokens: 1 } as unknown as typeof response);
    const invalid = await claimedResearchModel('run3-request', 'run3-hash', h.access);
    expect(invalid.value).toEqual({ malformed: true }); // The caller's schema still rejects this frozen raw output.
    expect((await claimedResearchModel('run3-request', 'run3-hash', h.access)).value).toEqual({ malformed: true });
    expect(await claimedResearchModel('run4-request', 'run4-hash', h.access)).toEqual(response);
    expect(h.invoke).toHaveBeenCalledTimes(4);
  });
  it('waits for verified 429, resumes exactly the rejected request and leaves other sources free', async () => {
    const h = harness(); h.invoke.mockRejectedValueOnce(h.reject('usage-1', 45_000));
    await expect(claimedResearchModel('a', 'hash-a', h.access)).rejects.toMatchObject({ retryAfterMs: 45_000, confirmedRejection: true });
    await expect(claimedResearchModel('a', 'hash-a', h.access)).rejects.toMatchObject({ retryAfterMs: 45_000, confirmedRejection: false });
    expect(h.invoke).toHaveBeenCalledTimes(1);
    h.clock.value += 45_000;
    expect(await claimedResearchModel('a', 'hash-a', h.access)).toEqual(response);
    expect(await claimedResearchModel('b', 'hash-b', h.access)).toEqual(response);
    expect(h.invoke).toHaveBeenCalledTimes(3);
  });
  it('limits repeated confirmed rejections without marking them as unsupported evidence', async () => {
    const h = harness();
    for (let n = 1; n <= 3; n++) {
      h.invoke.mockRejectedValueOnce(h.reject(`usage-${n}`));
      if (n < 3) await expect(claimedResearchModel('a', 'hash-a', h.access)).rejects.toBeInstanceOf(ResearchModelRateLimitError);
      else await expect(claimedResearchModel('a', 'hash-a', h.access)).rejects.toThrow('three rejected attempts');
      h.clock.value += 1_000;
    }
    await expect(claimedResearchModel('a', 'hash-a', h.access)).rejects.toThrow('three rejected attempts');
    expect(h.invoke).toHaveBeenCalledTimes(3);
    expect(h.records.get('a').state).toBe('started');
  });
  it('uses one atomic owner for overlapping calls and fences expired unknown claims', async () => {
    const h = harness(); let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    h.invoke.mockImplementation(async () => { await gate; return response; });
    const first = claimedResearchModel('a', 'hash-a', h.access);
    await vi.waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1));
    await expect(claimedResearchModel('a', 'hash-a', h.access)).rejects.toMatchObject({ confirmedRejection: false });
    release(); expect(await first).toEqual(response);
    expect(await claimedResearchModel('a', 'hash-a', h.access)).toEqual(response); expect(h.invoke).toHaveBeenCalledTimes(1);
    h.records.set('stale', { version: 'claimed-research-model-v1', requestHash: 'hash-stale', nonce: 'unknown', startedAt: h.clock.value - 120_000, state: 'started' });
    await expect(claimedResearchModel('stale', 'hash-stale', h.access)).rejects.toThrow('indeterminate');
    await expect(claimedResearchModel('stale', 'hash-stale', h.access)).rejects.toThrow('indeterminate');
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });
  it('does not double-count or repeat when a committed receipt acknowledgement is lost', async () => {
    const h = harness(); let lose = true;
    const save = h.access.save;
    h.access.save = async (id, before, value) => { const changed = await save(id, before, value); if (changed && lose) { lose = false; throw new Error('Network connection lost.'); } return changed; };
    expect(await claimedResearchModel('a', 'hash-a', h.access)).toEqual(response);
    expect(await claimedResearchModel('a', 'hash-a', h.access)).toEqual(response);
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });
  it('refuses an unverified 429 sidecar and never starts a replacement call', async () => {
    const h = harness(); h.invoke.mockRejectedValueOnce(h.reject('usage-1'));
    await expect(claimedResearchModel('a', 'hash-a', h.access)).rejects.toBeInstanceOf(ResearchModelRateLimitError);
    h.valid.clear(); h.clock.value += 1_000;
    await expect(claimedResearchModel('a', 'hash-a', h.access)).rejects.toThrow('no verified provider rejection');
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });
});
