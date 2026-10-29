import { describe, expect, it, vi } from 'vitest';
import { runResearchWorkflow } from './research-runtime.mjs';

describe('research selection workflow', () => {
  const step = { do: async (_name: string, _options: unknown, work: () => Promise<unknown>) => work(), sleep: async () => {} };
  it('finishes all ranking before asking for selection and never writes automatically', async () => {
    let ranking = 0;
    const invoke = vi.fn(async ({ operation }: { operation: string }) => {
      if (operation === 'plan') return { sourceIds: [] };
      if (operation === 'rank') return { pending: ++ranking < 3, draftReady: true };
      return { sent: true };
    });
    await runResearchWorkflow('run', step, invoke);
    expect(invoke.mock.calls.map(([v]) => v.operation)).toEqual(['plan', 'rank', 'rank', 'rank', 'selection']);
  });
  it('can send a historical run for selection without scanning or writing', async () => {
    const invoke = vi.fn(async () => ({ sent: true }));
    await runResearchWorkflow('historical', step, invoke, false, true);
    expect(invoke.mock.calls.map(([v]) => v.operation)).toEqual(['selection']);
  });
  it('runs only writing for an approved selection and continues batches', async () => {
    let calls = 0;
    const invoke = vi.fn(async () => ({ pending: ++calls < 3 }));
    await runResearchWorkflow('run', step, invoke, true);
    expect(invoke.mock.calls.map(([v]) => v.operation)).toEqual(['drafts', 'drafts', 'drafts']);
  });
});
