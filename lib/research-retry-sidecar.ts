import { researchHash } from './research-model';
import { ResearchModelRateLimitError } from './research-provider-error';

/** Immutable cooldown for one exact started claim, anchored to any confirmed 429. */
export type ResearchRetrySidecar = {
  version: 'research-retry-sidecar-v1'; attemptId: string; nonce: string;
  startedAt: number; recordedAt: number; retryAt: number; rejections: number;
  confirmedRejection: boolean; usageId: string | null;
};
type Started = { nonce: string; startedAt: number; rejections?: number };
type Access = { read: (id: string) => Promise<unknown | null>; writeImmutable: (id: string, value: unknown) => Promise<void>; verifyRetryRejection?: (usageId: string) => Promise<boolean> };
const idFor = async (attemptId: string, nonce: string) => `research-retry-sidecar:v1:${await researchHash(JSON.stringify([attemptId, nonce]))}`;
export async function readResearchRetrySidecar(access: Access, attemptId: string, started: Started, now: number): Promise<ResearchRetrySidecar | null> {
  const value = await access.read(await idFor(attemptId, started.nonce)) as ResearchRetrySidecar | null;
  if (!value) return null;
  if (value.version !== 'research-retry-sidecar-v1' || value.attemptId !== attemptId || value.nonce !== started.nonce
      || value.startedAt !== started.startedAt || !Number.isFinite(value.recordedAt) || value.recordedAt < started.startedAt || value.recordedAt > now
      || !Number.isFinite(value.retryAt) || value.retryAt < value.recordedAt || !Number.isInteger(value.rejections)
      || value.rejections < 0 || value.rejections > 3 || typeof value.confirmedRejection !== 'boolean'
      || value.rejections !== (started.rejections || 0) + (value.confirmedRejection ? 1 : 0)
      || (value.confirmedRejection ? typeof value.usageId !== 'string' || !value.usageId : value.usageId !== null)) throw new Error('Research retry sidecar does not match its started claim');
  if (value.confirmedRejection && (!access.verifyRetryRejection || !await access.verifyRetryRejection(value.usageId!))) throw new Error('Research retry sidecar has no verified provider rejection');
  return value;
}
export async function writeResearchRetrySidecar(access: Access, attemptId: string, started: Started, error: ResearchModelRateLimitError, now: number) {
  const rejections = (started.rejections || 0) + (error.confirmedRejection ? 1 : 0);
  if (error.confirmedRejection && (!error.usageId || !access.verifyRetryRejection || !await access.verifyRetryRejection(error.usageId))) throw new Error('Research rate-limit rejection has no verified usage receipt');
  const value: ResearchRetrySidecar = { version: 'research-retry-sidecar-v1', attemptId, nonce: started.nonce,
    startedAt: started.startedAt, recordedAt: now, retryAt: now + error.retryAfterMs, rejections, confirmedRejection: error.confirmedRejection, usageId: error.confirmedRejection ? error.usageId! : null };
  const id = await idFor(attemptId, started.nonce);
  await access.writeImmutable(id, value);
  if (JSON.stringify(await access.read(id)) !== JSON.stringify(value)) throw new Error('Research retry sidecar changed after saving');
  return rejections < 3;
}
