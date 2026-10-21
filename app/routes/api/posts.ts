// ABOUTME: HTTP API route for posts — list/get/create/update/delete with Bearer token auth.
// ABOUTME: Supports scheduling via state='scheduled' and publish_at timestamp in Unix ms.

import { createFileRoute } from '@tanstack/react-router';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { getRequestTeamId } from '@/lib/auth';
import {
  listPostsWithDetails,
  getPostWithDetails,
  insertPost,
  insertPostTarget,
  insertPostMedia,
  updatePost as dbUpdatePost,
  deletePost as dbDeletePost,
  deletePostTargets,
  deletePostMedia,
  getDefaultChannelByPlatform,
  getChannelByPlatformAndGroup,
  type PostState,
} from '@/lib/db/queries';
import { SUPPORTED_PLATFORMS } from '@/lib/platforms';
import { invalidatePendingApprovals } from '@/lib/approval';
import { REDDIT_TARGET_SCHEMA_FIELDS, toRedditInsertFields, validateRedditTargetFields } from '@/lib/reddit-target';

const VALID_STATES: PostState[] = ['draft', 'scheduled', 'awaiting_approval', 'publishing', 'published', 'failed'];

const TargetInput = z.object({
  channel_id: z.string().nullable().optional(),
  platform: z.enum(SUPPORTED_PLATFORMS),
  content: z.string().min(1, 'target content is required'),
  reply_settings: z.string().optional(),
  as_carousel: z.boolean().optional(),
  carousel_name: z.string().nullable().optional(),
  thread: z.array(z.string()).optional(),
  ...REDDIT_TARGET_SCHEMA_FIELDS,
}).superRefine(validateRedditTargetFields);

const MediaInput = z.object({
  id: z.string(),
  filename: z.string(),
  path: z.string(),
  url: z.string().url(),
  type: z.enum(['image', 'video']),
});

const PostInput = z.object({
  targets: z.array(TargetInput).min(1, 'at least one target is required'),
  media: z.array(MediaInput).optional(),
  publish_at: z.number().nullable().optional(),
  state: z.enum(['draft', 'scheduled']),
  channel_group: z.enum(['personal', 'company']).optional(),
  template_id: z.string().nullable().optional(),
  writing_prompt: z.string().nullable().optional(),
  idea_id: z.string().nullable().optional(),
  brand_id: z.string().nullable().optional(),
});

const UpdatePostInput = PostInput.extend({
  id: z.string().min(1, 'id is required'),
});

const DeletePostInput = z.object({
  id: z.string().min(1, 'id is required'),
});

function parseStates(requestUrl: string): { states?: PostState[]; error?: string } {
  const url = new URL(requestUrl);
  const statesParam = url.searchParams.get('states');
  const repeatedStates = url.searchParams.getAll('state');

  const rawStates = [
    ...(statesParam ? statesParam.split(',') : []),
    ...repeatedStates,
  ]
    .map(state => state.trim())
    .filter(Boolean);

  if (rawStates.length === 0) return {};

  const invalid = rawStates.filter(state => !VALID_STATES.includes(state as PostState));
  if (invalid.length > 0) {
    return {
      error: `Invalid state(s): ${invalid.join(', ')}. Valid states: ${VALID_STATES.join(', ')}`,
    };
  }

  return { states: rawStates as PostState[] };
}

export const Route = createFileRoute('/api/posts')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const teamId = await getRequestTeamId(request);
        if (teamId instanceof Response) return teamId;


        const url = new URL(request.url);
        const id = url.searchParams.get('id');
        if (id) {
          const post = await getPostWithDetails(id, teamId);
          if (!post) return Response.json({ error: 'Not found' }, { status: 404 });
          return Response.json(post);
        }

        const { states, error } = parseStates(request.url);
        if (error) return Response.json({ error }, { status: 400 });

        return Response.json(await listPostsWithDetails(teamId, states));
      },

      POST: async ({ request }) => {
        const teamId = await getRequestTeamId(request);
        if (teamId instanceof Response) return teamId;


        const parsed = PostInput.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, { status: 400 });
        }

        const data = parsed.data;
        const id = uuid();
        const now = Date.now();
        const state = data.state === 'scheduled' && data.publish_at ? 'scheduled' : 'draft';

        await insertPost(id, teamId, state, data.publish_at ?? null, now, data.channel_group ?? 'personal', data.template_id ?? null, data.writing_prompt ?? null, data.idea_id ?? null, data.brand_id ?? null);

        const group = data.channel_group ?? 'personal';
        for (const target of data.targets) {
          const channel = target.channel_id ? null : await getChannelByPlatformAndGroup(teamId, target.platform, group);
          await insertPostTarget(
            uuid(),
            id,
            target.channel_id ?? channel?.id ?? null,
            target.platform,
            target.content,
            target.reply_settings ?? 'everyone',
            target.as_carousel ?? false,
            target.carousel_name ?? null,
            target.thread ?? null,
            toRedditInsertFields(target),
          );
        }

        for (const media of data.media ?? []) {
          await insertPostMedia(media.id, id, null, media.filename, media.path, media.url, media.type);
        }

        return Response.json(await getPostWithDetails(id, teamId), { status: 201 });
      },

      PATCH: async ({ request }) => {
        const teamId = await getRequestTeamId(request);
        if (teamId instanceof Response) return teamId;


        const parsed = UpdatePostInput.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, { status: 400 });
        }

        const data = parsed.data;
        const existing = await getPostWithDetails(data.id, teamId);
        if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

        const now = Date.now();
        const state = data.state === 'scheduled' && data.publish_at ? 'scheduled' : 'draft';

        await invalidatePendingApprovals(data.id, teamId, 'The post was edited through the API after approval was requested.');
        await dbUpdatePost(data.id, teamId, state, data.publish_at ?? null, now, data.channel_group ?? 'personal', data.template_id ?? null, data.writing_prompt ?? null, data.idea_id ?? null, data.brand_id ?? null);
        await deletePostTargets(data.id);
        await deletePostMedia(data.id);

        const updateGroup = data.channel_group ?? 'personal';
        for (const target of data.targets) {
          const channel = target.channel_id ? null : await getChannelByPlatformAndGroup(teamId, target.platform, updateGroup);
          await insertPostTarget(
            uuid(),
            data.id,
            target.channel_id ?? channel?.id ?? null,
            target.platform,
            target.content,
            target.reply_settings ?? 'everyone',
            target.as_carousel ?? false,
            target.carousel_name ?? null,
            target.thread ?? null,
            toRedditInsertFields(target),
          );
        }

        for (const media of data.media ?? []) {
          await insertPostMedia(media.id, data.id, null, media.filename, media.path, media.url, media.type);
        }

        return Response.json(await getPostWithDetails(data.id, teamId));
      },

      DELETE: async ({ request }) => {
        const teamId = await getRequestTeamId(request);
        if (teamId instanceof Response) return teamId;


        const parsed = DeletePostInput.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, { status: 400 });
        }

        const existing = await getPostWithDetails(parsed.data.id, teamId);
        if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

        await invalidatePendingApprovals(parsed.data.id, teamId, 'The post was deleted after approval was requested.');
        await dbDeletePost(parsed.data.id, teamId);
        return Response.json({ ok: true });
      },
    },
  },
});
