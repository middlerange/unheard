// ABOUTME: Server functions for post CRUD operations and publishing.
// ABOUTME: Called from route loaders and React components via TanStack Start.

import { createServerFn } from '@tanstack/react-start';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import {
  listPostsWithDetails, getPostWithDetails,
  insertPost, insertPostTarget, updatePost as dbUpdatePost, deletePost as dbDeletePost, deletePostTargets,
  insertPostMedia, deletePostMedia,
  getChannelByPlatformAndGroup,
  type PostState, type PostWithDetails,
} from '@/lib/db/queries';
import { invalidatePendingApprovals, requestPublishApprovalById } from '@/lib/approval';
import { findNextOpenSlot } from '@/lib/scheduling';
import { getSession } from '@/lib/auth';
import { SUPPORTED_PLATFORMS } from '@/lib/platforms';
import { REDDIT_TARGET_SCHEMA_FIELDS, toRedditInsertFields, validateRedditTargetFields } from '@/lib/reddit-target';

const TargetInput = z.object({
  channel_id: z.string().nullable().optional(),
  platform: z.enum(SUPPORTED_PLATFORMS),
  content: z.string(),
  reply_settings: z.string().optional(),
  as_carousel: z.boolean().optional(),
  carousel_name: z.string().optional(),
  thread: z.array(z.string()).optional(),
  ...REDDIT_TARGET_SCHEMA_FIELDS,
}).superRefine(validateRedditTargetFields);

const MediaInput = z.object({
  id: z.string(),
  filename: z.string(),
  path: z.string(),
  url: z.string(),
  type: z.enum(['image', 'video']),
  target_id: z.string().nullable().optional(), // null = shared media
});

const PostInput = z.object({
  targets: z.array(TargetInput).min(1),
  media: z.array(MediaInput).optional(),
  publish_at: z.number().nullable().optional(),
  state: z.enum(['draft', 'scheduled']),
  channel_group: z.string().nullable().optional(),
  template_id: z.string().nullable().optional(),
  writing_prompt: z.string().nullable().optional(),
  idea_id: z.string().nullable().optional(),
  brand_id: z.string().nullable().optional(),
});

// Helper to get teamId from session
async function getTeamId(): Promise<string> {
  const session = await getSession();
  const teamId = session.data.teamId;
  if (!teamId) {
    throw new Error('No team selected');
  }
  return teamId;
}

export const getPosts = createServerFn({ method: 'GET' })
  .inputValidator((d: { states?: string[] } | undefined) => d ?? {})
  .handler(async ({ data }): Promise<PostWithDetails[]> => {
    const teamId = await getTeamId();
    return listPostsWithDetails(teamId, data.states as PostState[] | undefined);
  });

export const getPost = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<PostWithDetails | null> => {
    const teamId = await getTeamId();
    return getPostWithDetails(data.id, teamId);
  });

export const createPost = createServerFn({ method: 'POST' })
  .inputValidator(PostInput)
  .handler(async ({ data }) => {
    const teamId = await getTeamId();
    const id = uuid();
    const now = Date.now();
    const state = data.state === 'scheduled' && data.publish_at ? 'scheduled' : 'draft';
    const group = data.channel_group ?? 'personal';

    try {
      await insertPost(id, teamId, state as PostState, data.publish_at ?? null, now, group, data.template_id ?? null, data.writing_prompt ?? null, data.idea_id ?? null, data.brand_id ?? null);

      // Create targets and map channel_id -> target_id for media association
      const channelToTargetMap = new Map<string, string>();
      
      for (const t of data.targets) {
        const targetId = uuid();
        const channel = t.channel_id ? null : await getChannelByPlatformAndGroup(teamId, t.platform, group);
        const channelId = t.channel_id ?? channel?.id ?? null;
        
        await insertPostTarget(
          targetId, id, channelId, t.platform, t.content,
          t.reply_settings ?? 'everyone',
          t.as_carousel ?? false,
          t.carousel_name ?? null,
          t.thread ?? null,
          toRedditInsertFields(t),
        );
        
        // Store mapping for media association
        if (channelId) {
          channelToTargetMap.set(channelId, targetId);
        }
      }

      // Create media with correct target_id mapping
      for (const m of data.media ?? []) {
        // If media has a target_id that's actually a channel_id, convert it
        const actualTargetId = m.target_id ? channelToTargetMap.get(m.target_id) ?? m.target_id : null;
        await insertPostMedia(uuid(), id, actualTargetId, m.filename, m.path, m.url, m.type);
      }

      return getPostWithDetails(id, teamId);
    } catch (err) {
      console.error('[createPost] failed, rolling back post', id, err);
      try { await dbDeletePost(id, teamId); } catch (_) { /* best-effort cleanup */ }
      throw new Error('Failed to create post. Please try again.');
    }
  });

export const updatePost = createServerFn({ method: 'POST' })
  .inputValidator(PostInput.extend({ id: z.string() }))
  .handler(async ({ data }) => {
    const teamId = await getTeamId();
    const now = Date.now();
    const state = data.state === 'scheduled' && data.publish_at ? 'scheduled' : 'draft';
    const group = data.channel_group ?? 'personal';

    try {
      await invalidatePendingApprovals(data.id, teamId, 'The post was edited after approval was requested.');
      await dbUpdatePost(data.id, teamId, state as PostState, data.publish_at ?? null, now, group, data.template_id ?? null, data.writing_prompt ?? null, data.idea_id ?? null, data.brand_id ?? null);
      await deletePostTargets(data.id);
      await deletePostMedia(data.id);

      // Create targets and map channel_id -> target_id for media association
      const channelToTargetMap = new Map<string, string>();
      
      for (const t of data.targets) {
        const targetId = uuid();
        const channel = t.channel_id ? null : await getChannelByPlatformAndGroup(teamId, t.platform, group);
        const channelId = t.channel_id ?? channel?.id ?? null;
        
        await insertPostTarget(
          targetId, data.id, channelId, t.platform, t.content,
          t.reply_settings ?? 'everyone',
          t.as_carousel ?? false,
          t.carousel_name ?? null,
          t.thread ?? null,
          toRedditInsertFields(t),
        );
        
        // Store mapping for media association
        if (channelId) {
          channelToTargetMap.set(channelId, targetId);
        }
      }

      // Create media with correct target_id mapping
      for (const m of data.media ?? []) {
        // If media has a target_id that's actually a channel_id, convert it
        const actualTargetId = m.target_id ? channelToTargetMap.get(m.target_id) ?? m.target_id : null;
        await insertPostMedia(uuid(), data.id, actualTargetId, m.filename, m.path, m.url, m.type);
      }

      return getPostWithDetails(data.id, teamId);
    } catch (err) {
      console.error('[updatePost] failed for post', data.id, err);
      throw new Error('Failed to update post. Please try again.');
    }
  });

export const deletePost = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const teamId = await getTeamId();
    await invalidatePendingApprovals(data.id, teamId, 'The post was deleted after approval was requested.');
    await dbDeletePost(data.id, teamId);
    return { ok: true };
  });

export const publishNow = createServerFn({ method: 'POST' })
  .inputValidator(PostInput)
  .handler(async ({ data }) => {
    const teamId = await getTeamId();
    const id = uuid();
    const now = Date.now();
    const group = data.channel_group ?? 'personal';

    try {
      await insertPost(id, teamId, 'scheduled', now, now, group, data.template_id ?? null, data.writing_prompt ?? null, data.idea_id ?? null, data.brand_id ?? null);

      // Create targets and map channel_id -> target_id for media association
      const channelToTargetMap = new Map<string, string>();
      
      for (const t of data.targets) {
        const targetId = uuid();
        const channel = t.channel_id ? null : await getChannelByPlatformAndGroup(teamId, t.platform, group);
        const channelId = t.channel_id ?? channel?.id ?? null;
        
        await insertPostTarget(
          targetId, id, channelId, t.platform, t.content,
          t.reply_settings ?? 'everyone',
          t.as_carousel ?? false,
          t.carousel_name ?? null,
          t.thread ?? null,
          toRedditInsertFields(t),
        );
        
        // Store mapping for media association
        if (channelId) {
          channelToTargetMap.set(channelId, targetId);
        }
      }

      // Create media with correct target_id mapping
      for (const m of data.media ?? []) {
        // If media has a target_id that's actually a channel_id, convert it
        const actualTargetId = m.target_id ? channelToTargetMap.get(m.target_id) ?? m.target_id : null;
        await insertPostMedia(uuid(), id, actualTargetId, m.filename, m.path, m.url, m.type);
      }
    } catch (err) {
      console.error('[publishNow] failed to create post', id, err);
      try { await dbDeletePost(id, teamId); } catch (_) { /* best-effort cleanup */ }
      throw new Error('Failed to create post for publishing. Please try again.');
    }

    return requestPublishApprovalById(id, teamId);
  });

const ScheduleSlotInput = z.object({
  content: z.string().min(1),
  thread: z.array(z.string()).optional(),
});

export const scheduleToNextSlot = createServerFn({ method: 'POST' })
  .inputValidator(ScheduleSlotInput)
  .handler(async ({ data }) => {
    const teamId = await getTeamId();
    const existing = await listPostsWithDetails(teamId, ['scheduled', 'published'] as PostState[]);
    const occupied = new Set(existing.filter(p => p.publish_at).map(p => p.publish_at!));
    const slotDate = findNextOpenSlot(occupied);

    const id = uuid();
    const now = Date.now();
    const publishAt = slotDate.getTime();

    await insertPost(id, teamId, 'scheduled', publishAt, now);
    const [twitterChannel, linkedinChannel] = await Promise.all([
      getChannelByPlatformAndGroup(teamId, 'twitter', 'personal'),
      getChannelByPlatformAndGroup(teamId, 'linkedin', 'personal'),
    ]);
    await Promise.all([
      insertPostTarget(uuid(), id, twitterChannel?.id ?? null, 'twitter', data.content, 'everyone', false, null, data.thread ?? null),
      insertPostTarget(uuid(), id, linkedinChannel?.id ?? null, 'linkedin', data.content, 'everyone', false, null, null),
    ]);

    return {
      postId: id,
      scheduledAt: slotDate.toISOString(),
      scheduledDisplay: slotDate.toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      }),
    };
  });
