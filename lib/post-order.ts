// ABOUTME: Defines the status-aware date ordering used by the posts list.
// ABOUTME: Scheduled posts show the next publish first; other lists show the most recently updated first.

import type { Post } from './db/types';

export type PostListStatus = 'all' | 'draft' | 'scheduled' | 'awaiting_approval' | 'published';

type SortablePost = Pick<Post, 'id' | 'publish_at' | 'created_at' | 'updated_at'>;

function compareNewestFirst(a: SortablePost, b: SortablePost): number {
  return b.updated_at - a.updated_at
    || b.created_at - a.created_at
    || a.id.localeCompare(b.id);
}

function compareScheduled(a: SortablePost, b: SortablePost): number {
  if (a.publish_at === null) return b.publish_at === null ? compareNewestFirst(a, b) : 1;
  if (b.publish_at === null) return -1;

  return a.publish_at - b.publish_at || compareNewestFirst(a, b);
}

export function sortPostsByDate<T extends SortablePost>(posts: T[], status: PostListStatus): T[] {
  return [...posts].sort(status === 'scheduled' ? compareScheduled : compareNewestFirst);
}
