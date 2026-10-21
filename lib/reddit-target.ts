// ABOUTME: Shared Reddit post-target validation and database mapping.
// ABOUTME: Keeps UI, HTTP API, agent API, and RSS-created posts on the same contract.

import { z } from 'zod';
import { normalizeSubreddit } from './reddit-connect';

export const REDDIT_TARGET_SCHEMA_FIELDS = {
  reddit_title: z.string().trim().max(300).nullable().optional(),
  subreddit: z.string().trim().max(100).nullable().optional(),
  reddit_post_type: z.enum(['self', 'link']).nullable().optional(),
  reddit_url: z.string().url().nullable().optional(),
  flair_id: z.string().nullable().optional(),
  nsfw: z.boolean().optional(),
  spoiler: z.boolean().optional(),
};

export type RedditTargetFields = {
  platform: string;
  reddit_title?: string | null;
  subreddit?: string | null;
  reddit_post_type?: 'self' | 'link' | null;
  reddit_url?: string | null;
  flair_id?: string | null;
  nsfw?: boolean;
  spoiler?: boolean;
};

export function validateRedditTargetFields(target: RedditTargetFields, context: z.RefinementCtx): void {
  if (target.platform !== 'reddit') return;
  if (!target.reddit_title) {
    context.addIssue({ code: 'custom', path: ['reddit_title'], message: 'Reddit title is required' });
  }
  const subreddit = target.subreddit ? normalizeSubreddit(target.subreddit) : '';
  if (!/^[A-Za-z0-9_]{2,100}$/.test(subreddit)) {
    context.addIssue({ code: 'custom', path: ['subreddit'], message: 'A valid subreddit is required' });
  }
  if (target.reddit_post_type === 'link' && !target.reddit_url) {
    context.addIssue({ code: 'custom', path: ['reddit_url'], message: 'A URL is required for Reddit link posts' });
  }
}

export function toRedditInsertFields(target: RedditTargetFields) {
  if (target.platform !== 'reddit') return null;
  return {
    title: target.reddit_title ?? null,
    subreddit: target.subreddit ? normalizeSubreddit(target.subreddit) : null,
    postType: target.reddit_post_type ?? ('self' as const),
    url: target.reddit_url ?? null,
    flairId: target.flair_id ?? null,
    nsfw: target.nsfw ?? false,
    spoiler: target.spoiler ?? false,
  };
}

export function buildRedditArticleTarget(item: {
  title: string;
  link: string;
  defaultSubreddit?: string | null;
}) {
  const subreddit = item.defaultSubreddit ? normalizeSubreddit(item.defaultSubreddit) : '';
  if (!subreddit) {
    throw new Error('Reddit RSS publishing requires a connected channel with a default subreddit');
  }
  return {
    reddit_title: item.title.slice(0, 300),
    subreddit,
    reddit_post_type: 'link' as const,
    reddit_url: item.link,
  };
}
