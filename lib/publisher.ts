// ABOUTME: Orchestrates publishing a post to all its target platforms.
// ABOUTME: Updated for multi-account support - uses channel_id from each target.

import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from './db/client';
import { post_targets } from './schema';
import { hashPublicationInput, isPublicationComplete, publishTwitterWithProgress, type PublicationTarget } from './publication-progress';
import { getPostWithDetails, updateTargetSuccess, updateTargetError, updatePostState, getChannel } from './db/queries';
import type { PostWithDetails } from './db/types';
import { tweetPost, replyToTweet, maxCharacters, type TwitterCreds } from './twitter';
import { linkedinPost, commentOnPost, withLinkedInAccountId, type LinkedInCreds } from './linkedin';
import { redditPost, type RedditCreds, type RedditPostInput } from './reddit';
import { discordPost, type DiscordCreds } from './discord';
import { instagramPublish, type InstagramCreds } from './instagram';
import { facebookPublishText, facebookPublishVideo, type FacebookCreds } from './facebook';
import { youtubeUploadVideo, type YouTubeCreds } from './youtube';
import { htmlToText } from './text';
import { resolvePostMedia } from './post-media';
import { notifyPublished, notifyFailed } from './telegram';
import { decrypt } from './crypto';
import { assertNotTestPost } from './slack-post-lock';

async function resolveTwitterCreds(channelId: string, teamId: string): Promise<TwitterCreds | undefined> {
  const channel = await getChannel(channelId, teamId);
  if (!channel) return undefined;
  const raw = await decrypt(channel.credentials);
  return JSON.parse(raw) as TwitterCreds;
}

async function resolveLinkedInCreds(channelId: string, teamId: string): Promise<LinkedInCreds | undefined> {
  const channel = await getChannel(channelId, teamId);
  if (!channel) return undefined;
  const raw = await decrypt(channel.credentials);
  return withLinkedInAccountId(
    JSON.parse(raw) as LinkedInCreds,
    channel.account_id,
    channel.account_type,
  );
}

export function targetsPendingPublication<T extends PublicationTarget>(targets: T[]): T[] {
  return targets.filter(target => !isPublicationComplete(target));
}

async function resolveRedditCreds(channelId: string, teamId: string): Promise<RedditCreds | undefined> {
  const channel = await getChannel(channelId, teamId);
  if (!channel) return undefined;
  const raw = await decrypt(channel.credentials);
  return JSON.parse(raw) as RedditCreds;
}

async function resolveDiscordCreds(channelId: string, teamId: string): Promise<DiscordCreds | undefined> {
  const channel = await getChannel(channelId, teamId);
  if (!channel) return undefined;
  const raw = await decrypt(channel.credentials);
  return JSON.parse(raw) as DiscordCreds;
}

async function resolveInstagramCreds(channelId: string, teamId: string): Promise<InstagramCreds | undefined> {
  const channel = await getChannel(channelId, teamId);
  if (!channel) return undefined;
  const raw = await decrypt(channel.credentials);
  return JSON.parse(raw) as InstagramCreds;
}

async function resolveFacebookCreds(channelId: string, teamId: string): Promise<FacebookCreds | undefined> {
  const channel = await getChannel(channelId, teamId);
  if (!channel) return undefined;
  const raw = await decrypt(channel.credentials);
  return JSON.parse(raw) as FacebookCreds;
}

async function resolveYouTubeCreds(channelId: string, teamId: string): Promise<YouTubeCreds | undefined> {
  const channel = await getChannel(channelId, teamId);
  if (!channel) return undefined;
  const raw = await decrypt(channel.credentials);
  return JSON.parse(raw) as YouTubeCreds;
}

async function publishTarget(target: PostWithDetails['targets'][number], allMedia: PostWithDetails['media'], teamId: string): Promise<void> {
  // Each target must have a channel_id in multi-account mode
  if (!target.channel_id) {
    throw new Error(`No channel selected for ${target.platform} target`);
  }

  // Get media specific to this target, or shared media if no target-specific media
  const targetSpecificMedia = allMedia.filter(m => m.target_id === target.id);
  const sharedMedia = allMedia.filter(m => m.target_id === null);
  const media = resolvePostMedia(sharedMedia, targetSpecificMedia);

  const text = htmlToText(target.content);
  
  if (target.platform === 'twitter') {
    const creds = await resolveTwitterCreds(target.channel_id, teamId);
    if (!creds) throw new Error('Twitter credentials not found');
    const limit = maxCharacters(creds);
    const parts = [text, ...(target.thread ?? []).map(htmlToText)];
    if (parts.some(part => part.length > limit)) throw new Error(`Content exceeds X's ${limit}-character limit`);
    const contentHash = await hashPublicationInput({
      channelId: target.channel_id,
      accountId: target.channel_account_id ?? null,
      accountType: target.channel_account_type ?? null,
      parts,
      replySettings: target.reply_settings,
      media: media.map(item => ({ id: item.id, path: item.path, url: item.url, type: item.type })),
    });
    const db = await getDb();
    await publishTwitterWithProgress({
      contentHash, parts,
      platformPostId: target.platform_post_id,
      progress: target.publication_progress,
    }, {
      persist: async (progress, expectedRaw) => {
        const result = await db.update(post_targets).set({
          publication_progress: JSON.stringify(progress),
          platform_post_id: progress.rootId,
          error: null,
        }).where(and(
          eq(post_targets.id, target.id),
          eq(post_targets.post_id, target.post_id),
          expectedRaw === null ? isNull(post_targets.publication_progress) : eq(post_targets.publication_progress, expectedRaw),
        )).run();
        if (!Number(result.meta?.changes)) throw new Error('X publication state changed. Reload the post before retrying.');
      },
      publishRoot: content => tweetPost(content, media, target.reply_settings ?? undefined, creds),
      publishReply: (content, parentId) => replyToTweet(content, parentId, [], target.reply_settings ?? undefined, creds),
    });
  } else if (target.platform === 'linkedin') {
    const creds = await resolveLinkedInCreds(target.channel_id, teamId);
    if (!creds) throw new Error('LinkedIn credentials not found');
    const urn = await linkedinPost(text, media, target.as_carousel, target.carousel_name ?? undefined, creds);
    for (const item of target.thread ?? []) {
      await commentOnPost(htmlToText(item), urn, creds);
    }
    await updateTargetSuccess(target.id, urn);
  } else if (target.platform === 'reddit') {
    const creds = await resolveRedditCreds(target.channel_id, teamId);
    if (!creds) throw new Error('Reddit credentials not found');
    if (!target.reddit_title || !target.subreddit) {
      throw new Error('Reddit title and subreddit are required');
    }

    const postInput: RedditPostInput = {
      subreddit: target.subreddit,
      title: target.reddit_title,
      content: text,
      postType: target.reddit_post_type ?? 'self',
      url: target.reddit_post_type === 'link' ? target.reddit_url ?? undefined : undefined,
      flairId: target.flair_id ?? undefined,
      nsfw: target.nsfw ?? undefined,
      spoiler: target.spoiler ?? undefined,
    };
    
    const postId = await redditPost(postInput, creds);
    await updateTargetSuccess(target.id, postId);
  } else if (target.platform === 'discord') {
    const creds = await resolveDiscordCreds(target.channel_id, teamId);
    if (!creds) throw new Error('Discord credentials not found');
    
    const messageId = await discordPost(text, media, target.thread ?? [], creds);
    await updateTargetSuccess(target.id, messageId);
  } else if (target.platform === 'instagram') {
    const creds = await resolveInstagramCreds(target.channel_id, teamId);
    if (!creds) throw new Error('Instagram credentials not found');

    const mediaId = await instagramPublish(text, media, creds);
    await updateTargetSuccess(target.id, mediaId);
  } else if (target.platform === 'facebook') {
    const creds = await resolveFacebookCreds(target.channel_id, teamId);
    if (!creds) throw new Error('Facebook credentials not found');

    const postId = media.length
      ? await facebookPublishVideo(text, media, creds)
      : await facebookPublishText(text, creds);
    await updateTargetSuccess(target.id, postId);
  } else if (target.platform === 'youtube') {
    const creds = await resolveYouTubeCreds(target.channel_id, teamId);
    if (!creds) throw new Error('YouTube credentials not found');

    const videoId = await youtubeUploadVideo(text, media, creds);
    await updateTargetSuccess(target.id, videoId);
  } else {
    throw new Error(`Unsupported platform: ${target.platform}`);
  }
}

export async function publishApprovedPost(post: PostWithDetails, teamId: string): Promise<void> {
  await assertNotTestPost(post.id, teamId);
  const now = Date.now();
  const pendingTargets = targetsPendingPublication(post.targets);

  const results = await Promise.allSettled(
    pendingTargets.map(target => publishTarget(target, post.media, teamId)),
  );

  const anyFailed = results.some(r => r.status === 'rejected');

  if (anyFailed) {
    await Promise.all(
      results.map((r, i) => {
        if (r.status === 'rejected') {
          return updateTargetError(pendingTargets[i].id, String(r.reason));
        }
      }),
    );
  }

  const state = anyFailed ? 'failed' : 'published';
  await updatePostState(post.id, teamId, state, now);
  const updatedPost = await getPostWithDetails(post.id, teamId);
  const postForNotification = updatedPost ?? post;

  if (state === 'published') {
    await notifyPublished(postForNotification);
    return;
  }

  await notifyFailed(postForNotification);
}
