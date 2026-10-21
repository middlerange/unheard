import { describe, expect, it } from 'vitest';
import { targetsPendingPublication } from './publisher';

describe('publishing retries', () => {
  it('skips targets that already have a platform post ID', () => {
    const twitter = { platform: 'twitter', platform_post_id: '2079123928325222840' };
    const linkedin = { platform: 'linkedin', platform_post_id: null };

    expect(targetsPendingPublication([twitter, linkedin])).toEqual([linkedin]);
  });
});
