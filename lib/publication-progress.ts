import { z } from 'zod';

const progressSchema = z.object({
  version: z.literal(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  phase: z.enum(['ready', 'sending_root', 'sending_reply']),
  rootId: z.string().min(1).max(100).nullable(),
  lastId: z.string().min(1).max(100).nullable(),
  publishedCount: z.number().int().min(0),
  totalCount: z.number().int().min(1),
  postIds: z.array(z.string().min(1).max(100)).optional(),
}).strict().superRefine((value, context) => {
  const empty = value.publishedCount === 0;
  if (value.publishedCount > value.totalCount ||
    (empty && (value.rootId !== null || value.lastId !== null)) ||
    (!empty && (!value.rootId || !value.lastId)) ||
    (value.publishedCount === 1 && value.rootId !== value.lastId) ||
    (value.postIds && (value.postIds.length !== value.publishedCount ||
      (!empty && (value.postIds[0] !== value.rootId || value.postIds[value.postIds.length - 1] !== value.lastId)))) ||
    (value.phase === 'sending_root' && !empty) ||
    (value.phase === 'sending_reply' && (empty || value.publishedCount === value.totalCount))) {
    context.addIssue({ code: 'custom', message: 'Invalid X publication checkpoint' });
  }
});

export type TwitterPublicationProgress = z.infer<typeof progressSchema>;
export type PublicationTarget = {
  platform_post_id: string | null;
  publication_progress?: string | null;
  thread?: string[] | null;
};

export function readPublicationProgress(raw?: string | null): TwitterPublicationProgress | null {
  if (raw == null) return null;
  try { return progressSchema.parse(JSON.parse(raw)); }
  catch { throw new Error('Invalid X publication checkpoint. Check the publishing outcome before retrying.'); }
}

export function isPublicationComplete(target: PublicationTarget): boolean {
  if (!target.platform_post_id) return false;
  if (target.publication_progress == null) return true;
  try {
    const progress = readPublicationProgress(target.publication_progress)!;
    return progress.phase === 'ready' && progress.publishedCount === progress.totalCount && progress.rootId === target.platform_post_id;
  } catch { return false; }
}

export async function hashPublicationInput(input: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

type TwitterPublicationInput = {
  contentHash: string;
  parts: string[];
  platformPostId: string | null;
  progress?: string | null;
};
type TwitterPublicationActions = {
  persist: (progress: TwitterPublicationProgress, expectedRaw: string | null) => Promise<void>;
  publishRoot: (content: string) => Promise<string>;
  publishReply: (content: string, parentId: string) => Promise<string>;
};

export async function publishTwitterWithProgress(input: TwitterPublicationInput, actions: TwitterPublicationActions): Promise<string> {
  if (!input.parts.length) throw new Error('X publication requires a root post');
  let raw = input.progress ?? null;
  let progress = readPublicationProgress(raw) ?? {
    version: 1 as const,
    contentHash: input.contentHash,
    phase: 'ready' as const,
    rootId: null,
    lastId: null,
    publishedCount: 0,
    totalCount: input.parts.length,
    postIds: [],
  };
  if (progress.phase !== 'ready')
    throw new Error('An X publishing request was interrupted and its outcome is unknown. Check the account before retrying; automatic replay is blocked.');
  if (progress.contentHash !== input.contentHash || progress.totalCount !== input.parts.length)
    throw new Error('This X post or thread changed after publishing started. Check the existing posts before retrying.');
  if (input.platformPostId !== progress.rootId)
    throw new Error('The X root post does not match its checkpoint. Check the account before retrying.');

  async function checkpoint(next: TwitterPublicationProgress) {
    await actions.persist(next, raw);
    raw = JSON.stringify(next);
    progress = next;
  }

  while (progress.publishedCount < progress.totalCount) {
    const index = progress.publishedCount;
    await checkpoint({ ...progress, phase: index === 0 ? 'sending_root' : 'sending_reply' });
    // A failed or interrupted request may have published remotely. Keep the sending
    // checkpoint until its outcome can be reconciled rather than replaying it.
    const id = index === 0
      ? await actions.publishRoot(input.parts[0])
      : await actions.publishReply(input.parts[index], progress.lastId!);
    if (!id) throw new Error('X returned no post ID. Check the account before retrying.');
    const knownIds = progress.postIds ?? (index === 1 ? [progress.rootId!] : index === 0 ? [] : null);
    await checkpoint({
      ...progress, phase: 'ready', rootId: progress.rootId || id, lastId: id, publishedCount: index + 1,
      ...(knownIds ? { postIds: [...knownIds, id] } : {}),
    });
  }
  return progress.rootId!;
}
