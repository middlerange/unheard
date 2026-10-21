// ABOUTME: Regression coverage for status-aware post list ordering.
// ABOUTME: Verifies queue order for scheduled posts and recency order for every other tab.

import { describe, expect, it } from 'vitest';
import { sortPostsByDate } from './post-order';

function post(id: string, publishAt: number | null, updatedAt: number, createdAt = updatedAt) {
  return { id, publish_at: publishAt, updated_at: updatedAt, created_at: createdAt };
}

describe('sortPostsByDate', () => {
  it('puts the next scheduled post first even when it was updated earlier', () => {
    const next = post('next', 100, 10);
    const later = post('later', 200, 20);

    expect(sortPostsByDate([later, next], 'scheduled')).toEqual([next, later]);
  });

  it('puts scheduled posts without a publish date last', () => {
    const dated = post('dated', 100, 10);
    const missingDate = post('missing', null, 20);

    expect(sortPostsByDate([missingDate, dated], 'scheduled')).toEqual([dated, missingDate]);
  });

  it.each(['all', 'draft', 'awaiting_approval', 'published'] as const)(
    'orders the %s tab by most recent update',
    status => {
      const older = post('older', 1_000, 10);
      const newer = post('newer', null, 20);

      expect(sortPostsByDate([older, newer], status)).toEqual([newer, older]);
    },
  );

  it('does not mutate workspace post order', () => {
    const posts = [post('later', 200, 20), post('next', 100, 10)];

    sortPostsByDate(posts, 'scheduled');

    expect(posts.map(item => item.id)).toEqual(['later', 'next']);
  });
});
