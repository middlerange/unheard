// ABOUTME: Orchestrates publishing a post to all its target platforms.
// ABOUTME: Updated for multi-account support - uses channel_id from each target.

import { getPostWithDetails, updateTargetSuccess, updateTargetError, updatePostState, getChannel } from './db/queries';
import type { PostWithDetails } from './db/types';
import { tweetPost, replyToTweet, maxCharacters, type TwitterCreds } from './twitter';
import { linkedinPost, commentOnPost, withLinkedInAccountId, type LinkedInCreds } from './linkedin';
import { redditPost, type RedditCreds, type RedditPostInput } from './reddit';
import { discordPost, type DiscordCreds } from './discord';
import { instagramPublish, type InstagramCreds } from './instagram';
import { facebookPublishVideo, type FacebookCreds } from './facebook';
import { youtubeUploadVideo, type YouTubeCreds } from './youtube';
import { htmlToText } from './text';
import { resolvePostMedia } from './post-media';
import { notifyPublished, notifyFailed } from './telegram';
import { decrypt } from './crypto';

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

export function targetsPendingPublication<T extends { platform_post_id: string | null }>(targets: T[]): T[] {
  return targets.filter(target => !target.platform_post_id);
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
    if (text.length > limit) throw new Error(`Content exceeds X's ${limit}-character limit`);
    let lastId = await tweetPost(text, media, target.reply_settings ?? undefined, creds);
    for (const item of target.thread ?? []) {
      lastId = await replyToTweet(htmlToText(item), lastId, [], target.reply_settings ?? undefined, creds);
    }
    await updateTargetSuccess(target.id, lastId);
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

    const videoId = await facebookPublishVideo(text, media, creds);
    await updateTargetSuccess(target.id, videoId);
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
