// ABOUTME: API endpoints for RSS feed management (Issue #7).
// ABOUTME: Supports listing, creating, updating, and deleting RSS feeds.

import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { getRssFeeds, getRssFeed, insertRssFeed, updateRssFeed, deleteRssFeed } from '@/lib/db/queries';
import { getRequestTeamId } from '@/lib/auth';
import type { RssFeedType, RssFeedFrequency } from '@/lib/db/types';

const feedTypeSchema = z.enum(['rss', 'atom', 'youtube', 'podcast']);
const feedFrequencySchema = z.enum(['15m', '1h', '6h', '24h']);
const feedStatusSchema = z.enum(['active', 'paused', 'error']);

const createFeedSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  feed_type: feedTypeSchema.default('rss'),
  fetch_frequency: feedFrequencySchema.default('1h'),
  post_template: z.string().max(500).default('{{title}} {{link}}'),
  target_platforms: z.array(z.string()).default([]),
  target_channels: z.array(z.string()).default([]),
  filter_keywords: z.string().max(500).optional(),
});

const updateFeedSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url().optional(),
  status: feedStatusSchema.optional(),
  fetch_frequency: feedFrequencySchema.optional(),
  post_template: z.string().max(500).optional(),
  target_platforms: z.array(z.string()).optional(),
  target_channels: z.array(z.string()).optional(),
  filter_keywords: z.string().max(500).optional().nullable(),
});

export const Route = createFileRoute('/api/rss-feeds')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const teamId = await getRequestTeamId(request);
        if (teamId instanceof Response) return teamId;


        try {
          const feeds = await getRssFeeds(teamId);
          return Response.json({ feeds });
        } catch (error) {
          console.error('Failed to fetch RSS feeds:', error);
          return Response.json({ error: 'Failed to fetch RSS feeds' }, { status: 500 });
        }
      },

      POST: async ({ request }) => {
        const teamId = await getRequestTeamId(request);
        if (teamId instanceof Response) return teamId;


        const body = await request.json();
        const result = createFeedSchema.safeParse(body);

        if (!result.success) {
          return Response.json({ error: 'Invalid input', details: result.error.format() }, { status: 400 });
        }

        try {
          const id = crypto.randomUUID();
          await insertRssFeed({
            id,
            team_id: teamId,
            name: result.data.name,
            url: result.data.url,
            feed_type: result.data.feed_type as RssFeedType,
            status: 'active',
            last_fetched_at: null,
            last_item_hash: null,
            fetch_frequency: result.data.fetch_frequency as RssFeedFrequency,
            post_template: result.data.post_template,
            target_platforms: result.data.target_platforms,
            target_channels: result.data.target_channels,
            filter_keywords: result.data.filter_keywords || null,
          });

          const feed = await getRssFeed(id, teamId);
          return Response.json({ feed }, { status: 201 });
        } catch (error) {
          console.error('Failed to create RSS feed:', error);
          return Response.json({ error: 'Failed to create RSS feed' }, { status: 500 });
        }
      },

      PATCH: async ({ request }) => {
        const teamId = await getRequestTeamId(request);
        if (teamId instanceof Response) return teamId;


        const body = await request.json();
        const { id, ...updates } = body;

        if (!id || typeof id !== 'string') {
          return Response.json({ error: 'Feed ID required' }, { status: 400 });
        }

        const result = updateFeedSchema.safeParse(updates);
        if (!result.success) {
          return Response.json({ error: 'Invalid input', details: result.error.format() }, { status: 400 });
        }

        try {
          await updateRssFeed(id, teamId, result.data);
          const feed = await getRssFeed(id, teamId);
          return Response.json({ feed });
        } catch (error) {
          console.error('Failed to update RSS feed:', error);
          return Response.json({ error: 'Failed to update RSS feed' }, { status: 500 });
        }
      },

      DELETE: async ({ request }) => {
        const teamId = await getRequestTeamId(request);
        if (teamId instanceof Response) return teamId;


        const url = new URL(request.url);
        const id = url.searchParams.get('id');

        if (!id) {
          return Response.json({ error: 'Feed ID required' }, { status: 400 });
        }

        try {
          await deleteRssFeed(id, teamId);
          return Response.json({ success: true });
        } catch (error) {
          console.error('Failed to delete RSS feed:', error);
          return Response.json({ error: 'Failed to delete RSS feed' }, { status: 500 });
        }
      },
    },
  },
});
