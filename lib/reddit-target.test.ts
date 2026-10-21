// ABOUTME: Tests the shared Reddit target mapping used by every post creation surface.
// ABOUTME: Ensures RSS articles and database insert values retain required metadata.

import { describe, expect, it } from 'vitest';
import { buildRedditArticleTarget, toRedditInsertFields } from './reddit-target';

describe('Reddit target mapping', () => {
  it('builds a link target from an RSS article', () => {
    expect(buildRedditArticleTarget({
      title: 'A new Userorbit article',
      link: 'https://userorbit.com/blog/article',
      defaultSubreddit: 'r/Userorbit',
    })).toEqual({
      reddit_title: 'A new Userorbit article',
      subreddit: 'Userorbit',
      reddit_post_type: 'link',
      reddit_url: 'https://userorbit.com/blog/article',
    });
  });

  it('maps target metadata into database fields', () => {
    expect(toRedditInsertFields({
      platform: 'reddit',
      reddit_title: 'Update',
      subreddit: '/r/Userorbit',
      reddit_post_type: 'self',
      nsfw: false,
      spoiler: true,
    })).toEqual({
      title: 'Update',
      subreddit: 'Userorbit',
      postType: 'self',
      url: null,
      flairId: null,
      nsfw: false,
      spoiler: true,
    });
  });
});
