// ABOUTME: Schedules a generated post by id and marks the linked idea as closed.
// ABOUTME: Designed for the convert-to-post flow where post id is the same as idea id.

import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { getRequestTeamId } from '@/lib/auth';
import {
  getPostWithDetails,
  updatePost as dbUpdatePost,
  insertPostMedia,
  getIdea,
  updateIdeaStatus,
} from '@/lib/db/queries';
import { invalidatePendingApprovals } from '@/lib/approval';

const MediaInput = z.object({
  id: z.string(),
  filename: z.string(),
  path: z.string(),
  url: z.string().url(),
  type: z.enum(['image', 'video']),
});

const ScheduleInput = z.object({
  id: z.string().min(1, 'id is required'),
  publish_at: z.number(),
  media: z.array(MediaInput).optional(),
});

export const Route = createFileRoute('/api/posts/schedule')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const teamId = await getRequestTeamId(request);
        if (teamId instanceof Response) return teamId;

        const parsed = ScheduleInput.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, { status: 400 });
        }

        const { id, publish_at, media } = parsed.data;
        const post = await getPostWithDetails(id, teamId);
        if (!post) return Response.json({ error: 'Post not found' }, { status: 404 });

        const idea = await getIdea(id, teamId);
        if (!idea) {
          return Response.json({ error: 'Idea not found for this post id' }, { status: 404 });
        }

        const now = Date.now();
        await invalidatePendingApprovals(id, teamId, 'The post was rescheduled after approval was requested.');
        await dbUpdatePost(id, teamId, 'scheduled', publish_at, now, post.channel_group, post.template_id, post.writing_prompt, post.idea_id, post.brand_id);

        for (const m of media ?? []) {
          await insertPostMedia(m.id, id, null, m.filename, m.path, m.url, m.type);
        }

        await updateIdeaStatus(id, teamId, 'closed', now);

        return Response.json({
          postId: id,
          scheduledAt: new Date(publish_at).toISOString(),
        });
      },
    },
  },
});
