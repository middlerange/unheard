import { describe, expect, it, vi } from 'vitest';
import { hashPublicationInput, isPublicationComplete, publishTwitterWithProgress, readPublicationProgress, type TwitterPublicationProgress } from './publication-progress';

const contentHash = 'a'.repeat(64);
const parts = ['Root post', 'First reply', 'Second reply'];
function stored(progress: TwitterPublicationProgress | null = null) {
  let raw = progress ? JSON.stringify(progress) : null;
  let platformPostId = progress?.rootId ?? null;
  const history: TwitterPublicationProgress[] = [];
  const persist = vi.fn(async (next: TwitterPublicationProgress, expectedRaw: string | null) => {
    if (raw !== expectedRaw) throw new Error('Checkpoint changed');
    raw = JSON.stringify(next);
    platformPostId = next.rootId;
    history.push(structuredClone(next));
  });
  return { persist, history, input: () => ({ contentHash, parts, platformPostId, progress: raw }), progress: () => readPublicationProgress(raw) };
}
function ready(publishedCount: number): TwitterPublicationProgress {
  return { version: 1, contentHash, phase: 'ready', rootId: 'root-id', lastId: publishedCount === 1 ? 'root-id' : 'reply-1', publishedCount, totalCount: parts.length };
}

describe('durable X publication', () => {
  it('checkpoints the root and every reply while keeping the root permalink ID', async () => {
    const state = stored();
    const publishRoot = vi.fn(async () => 'root-id');
    const publishReply = vi.fn(async (_content: string, parent: string) => parent === 'root-id' ? 'reply-1' : 'reply-2');
    expect(await publishTwitterWithProgress(state.input(), { persist: state.persist, publishRoot, publishReply })).toBe('root-id');
    expect(publishRoot).toHaveBeenCalledTimes(1);
    expect(publishReply.mock.calls).toEqual([['First reply', 'root-id'], ['Second reply', 'reply-1']]);
    expect(state.history.map(item => [item.phase, item.publishedCount])).toEqual([
      ['sending_root', 0], ['ready', 1], ['sending_reply', 1], ['ready', 2], ['sending_reply', 2], ['ready', 3],
    ]);
    expect(state.input().platformPostId).toBe('root-id');
    expect(state.progress()?.postIds).toEqual(['root-id', 'reply-1', 'reply-2']);
    expect(isPublicationComplete({ platform_post_id: 'root-id', publication_progress: state.input().progress })).toBe(true);
  });

  it('preserves the created root when a reply fails and blocks uncertain replay', async () => {
    const state = stored();
    const publishRoot = vi.fn(async () => 'root-id');
    const publishReply = vi.fn(async () => { throw new Error('Network interrupted after sending reply'); });
    const actions = { persist: state.persist, publishRoot, publishReply };
    await expect(publishTwitterWithProgress(state.input(), actions)).rejects.toThrow('Network interrupted');
    expect(state.progress()).toMatchObject({ phase: 'sending_reply', rootId: 'root-id', lastId: 'root-id', publishedCount: 1 });
    expect(state.input().platformPostId).toBe('root-id');
    expect(isPublicationComplete({ platform_post_id: 'root-id', publication_progress: state.input().progress })).toBe(false);
    await expect(publishTwitterWithProgress(state.input(), actions)).rejects.toThrow('outcome is unknown');
    expect(publishRoot).toHaveBeenCalledTimes(1);
    expect(publishReply).toHaveBeenCalledTimes(1);
  });

  it('blocks replay when the root request has an uncertain outcome', async () => {
    const state = stored();
    const publishRoot = vi.fn(async () => { throw new Error('Connection lost'); });
    const publishReply = vi.fn(async () => 'unused');
    const actions = { persist: state.persist, publishRoot, publishReply };
    await expect(publishTwitterWithProgress(state.input(), actions)).rejects.toThrow('Connection lost');
    expect(state.progress()).toMatchObject({ phase: 'sending_root', publishedCount: 0, rootId: null });
    await expect(publishTwitterWithProgress(state.input(), actions)).rejects.toThrow('outcome is unknown');
    expect(publishRoot).toHaveBeenCalledTimes(1);
    expect(publishReply).not.toHaveBeenCalled();
  });

  it('resumes only the remaining replies from a confirmed ready checkpoint', async () => {
    const state = stored(ready(1));
    const publishRoot = vi.fn(async () => 'should-not-run');
    const publishReply = vi.fn(async (_content: string, parent: string) => parent === 'root-id' ? 'reply-1' : 'reply-2');
    await publishTwitterWithProgress(state.input(), { persist: state.persist, publishRoot, publishReply });
    expect(publishRoot).not.toHaveBeenCalled();
    expect(publishReply.mock.calls).toEqual([['First reply', 'root-id'], ['Second reply', 'reply-1']]);
    expect(state.progress()).toMatchObject({ publishedCount: 3, phase: 'ready', rootId: 'root-id' });
  });

  it('does not replay a reply if its successful response could not be checkpointed', async () => {
    const state = stored(ready(1));
    const persist = vi.fn(async (next: TwitterPublicationProgress, expectedRaw: string | null) => {
      if (next.phase === 'ready' && next.publishedCount === 2) throw new Error('Database unavailable');
      await state.persist(next, expectedRaw);
    });
    const publishRoot = vi.fn(async () => 'should-not-run');
    const publishReply = vi.fn(async () => 'reply-1');
    await expect(publishTwitterWithProgress(state.input(), { persist, publishRoot, publishReply })).rejects.toThrow('Database unavailable');
    expect(state.progress()?.phase).toBe('sending_reply');
    await expect(publishTwitterWithProgress(state.input(), { persist, publishRoot, publishReply })).rejects.toThrow('outcome is unknown');
    expect(publishRoot).not.toHaveBeenCalled();
    expect(publishReply).toHaveBeenCalledTimes(1);
  });

  it('claims a checkpoint before making a request so concurrent attempts cannot duplicate the root', async () => {
    const state = stored();
    const input = state.input();
    const publishRoot = vi.fn(async () => 'root-id');
    const publishReply = vi.fn(async () => 'reply-id');
    const actions = { persist: state.persist, publishRoot, publishReply };
    const results = await Promise.allSettled([publishTwitterWithProgress(input, actions), publishTwitterWithProgress(input, actions)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(publishRoot).toHaveBeenCalledTimes(1);
  });

  it('refuses changed content or destinations after publication started', async () => {
    const state = stored(ready(1));
    const publishRoot = vi.fn(async () => 'unused');
    const publishReply = vi.fn(async () => 'unused');
    await expect(publishTwitterWithProgress({ ...state.input(), contentHash: 'b'.repeat(64) }, { persist: state.persist, publishRoot, publishReply })).rejects.toThrow('changed after publishing started');
    expect(state.persist).not.toHaveBeenCalled();
    expect(publishRoot).not.toHaveBeenCalled();
    expect(publishReply).not.toHaveBeenCalled();
    expect(await hashPublicationInput({ parts, destination: 'account-one' })).not.toBe(await hashPublicationInput({ parts, destination: 'account-two' }));
  });

  it('fails closed for invalid stored progress and preserves legacy completed targets', () => {
    expect(isPublicationComplete({ platform_post_id: 'legacy-id' })).toBe(true);
    expect(isPublicationComplete({ platform_post_id: null })).toBe(false);
    expect(isPublicationComplete({ platform_post_id: 'root-id', publication_progress: '{' })).toBe(false);
    expect(() => readPublicationProgress('{')).toThrow('Invalid X publication checkpoint');
    expect(() => readPublicationProgress(JSON.stringify({ ...ready(1), publishedCount: 99 }))).toThrow('Invalid X publication checkpoint');
  });
});
