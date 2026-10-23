import { describe, expect, it } from 'vitest';
import { targetsPendingPublication } from './publisher';

describe('publishing retries', () => {
  it('skips targets that already have a platform post ID', () => {
    const twitter = { platform: 'twitter', platform_post_id: '2079123928325222840' };
    const linkedin = { platform: 'linkedin', platform_post_id: null };

    expect(targetsPendingPublication([twitter, linkedin])).toEqual([linkedin]);
  });
  it('keeps incomplete X threads pending even though the root already has an ID', () => {
    const progress = { version: 1, contentHash: 'a'.repeat(64), phase: 'ready', rootId: 'root-id', lastId: 'root-id', publishedCount: 1, totalCount: 3 };
    const partial = { platform_post_id: 'root-id', publication_progress: JSON.stringify(progress) };
    const complete = { platform_post_id: 'complete-id', publication_progress: null };
    expect(targetsPendingPublication([partial, complete])).toEqual([partial]);
  });

});
