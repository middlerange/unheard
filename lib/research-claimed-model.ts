import { researchHash } from './research-model';
import { ResearchModelRateLimitError } from './research-provider-error';
import { readResearchRetrySidecar, writeResearchRetrySidecar } from './research-retry-sidecar';
import { retryResearchStorage } from './research-storage';

type ModelResponse = { value: unknown; inputTokens: number; outputTokens: number };
type Receipt = { version: 'claimed-research-model-v1'; requestHash: string; nonce: string; startedAt: number; rejections?: number } & (
  { state: 'started' } | { state: 'completed'; response: ModelResponse; responseHash: string } | { state: 'failed'; reason: string }
);
type Access = {
  read: (id: string) => Promise<unknown | null>; claim: (id: string, value: unknown) => Promise<boolean>;
  save: (id: string, expected: unknown, value: unknown) => Promise<boolean>;
  writeImmutable: (id: string, value: unknown) => Promise<void>; verifyRetryRejection: (usageId: string) => Promise<boolean>;
  invoke: () => Promise<ModelResponse>; onRejection: (error: ResearchModelRateLimitError) => Promise<void>; now?: () => number;
};
const json = (value: unknown) => JSON.stringify(value);
export async function claimedResearchModel(id: string, requestHash: string, access: Access): Promise<ModelResponse> {
  const now = access.now || Date.now;
  async function read(): Promise<Receipt | null> {
    const value = await access.read(id) as Receipt | null;
    if (!value) return null;
    if (value.version !== 'claimed-research-model-v1' || value.requestHash !== requestHash || !value.nonce || !Number.isFinite(value.startedAt)
        || value.startedAt > now() || !['started', 'completed', 'failed'].includes(value.state)) throw new Error('Research request receipt does not match the frozen request');
    if (value.state === 'completed' && (!value.response || value.responseHash !== await researchHash(json(value.response)))) throw new Error('Research request receipt response changed');
    if (value.state === 'failed' && !value.reason) throw new Error('Research request receipt lacks a failure reason');
    return value;
  }
  async function save(expected: Receipt, value: Receipt) {
    const changed = await retryResearchStorage(() => access.save(id, expected, value));
    const persisted = await read();
    if (!changed && json(persisted) !== json(value)) throw new Error('Research request claim changed; no automatic retry');
    if (json(persisted) !== json(value)) throw new Error('Research request receipt was not saved');
  }
  let current = await read(), rejections = 0;
  if (current?.state === 'completed') return current.response;
  if (current?.state === 'failed') throw new Error(current.reason);
  if (current?.state === 'started') {
    const sidecar = await readResearchRetrySidecar(access, id, current, now());
    if (!sidecar) {
      if (now() - current.startedAt >= 120_000) {
        await save(current, { ...current, state: 'failed', reason: 'Research provider request outcome is indeterminate; no automatic retry.' });
        throw new Error('Research provider request outcome is indeterminate; no automatic retry.');
      }
      throw new ResearchModelRateLimitError('Research provider request is already in flight', 15_000, false);
    }
    if (sidecar.rejections >= 3) throw new Error('Provider rate limit persisted after three rejected attempts; research needs attention.');
    if (sidecar.retryAt > now()) throw new ResearchModelRateLimitError('Research provider cooldown is active', sidecar.retryAt - now(), false);
    rejections = sidecar.rejections;
  }
  const started: Receipt = { version: 'claimed-research-model-v1', requestHash, state: 'started', nonce: crypto.randomUUID(), startedAt: now(), ...(current ? { rejections } : {}) };
  const won = await retryResearchStorage(() => current ? access.save(id, current, started) : access.claim(id, started));
  if (!won) {
    const latest = await read();
    if (json(latest) !== json(started)) throw new ResearchModelRateLimitError('Research provider request is already in flight', 15_000, false);
  }
  try {
    const response = await access.invoke();
    const completed: Receipt = { ...started, state: 'completed', response, responseHash: await researchHash(json(response)) };
    await save(started, completed);
    return response;
  } catch (error) {
    if (error instanceof ResearchModelRateLimitError) {
      if (error.confirmedRejection) await access.onRejection(error);
      if (await writeResearchRetrySidecar(access, id, started, error, now())) throw error;
      throw new Error('Provider rate limit persisted after three rejected attempts; research needs attention.');
    }
    // Unknown, permanent and storage outcomes cannot be safely regenerated.
    await save(started, { ...started, state: 'failed', reason: 'Research provider request failed or its outcome is indeterminate; no automatic retry.' });
    throw error;
  }
}
