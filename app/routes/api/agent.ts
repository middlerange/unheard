// ABOUTME: Agent-facing HTTP API for discovering and invoking app capabilities.
// ABOUTME: Uses self-serve team API keys so external agents do not need browser sessions.

import { createFileRoute } from '@tanstack/react-router';
import { and, desc, eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { getRequestAgentIdentity, type AgentIdentity } from '@/lib/auth';
import { encrypt } from '@/lib/crypto';
import { getDb } from '@/lib/db/client';
import {
  deleteBrandProfile,
  deleteChannel,
  deleteIdea,
  deletePost,
  deletePostMedia,
  deletePostTargets,
  deleteRssFeed,
  deleteTemplate,
  deleteTemplateLibrary,
  deleteWebhook,
  getBestTimePredictions,
  getBrandProfile,
  getChannel,
  getChannelByPlatformAndGroup,
  getIdea,
  getPostWithDetails,
  getPostApproval,
  getPostComments,
  getRssFeed,
  getRssFeeds,
  getTeamMembers,
  getTemplate,
  getTemplateById,
  getTemplatesLibrary,
  getWebhook,
  getWebhooks,
  insertBrandProfile,
  insertIdea,
  insertPost,
  insertPostMedia,
  insertPostTarget,
  insertRssFeed,
  insertTemplate,
  insertTemplateLibrary,
  insertWebhook,
  listBrandProfiles,
  listChannels,
  listIdeas,
  listPostsWithDetails,
  listTemplates,
  setDefaultBrandProfile,
  setDefaultChannel,
  updateBrandProfile,
  updateIdea,
  updateIdeaStatus,
  updatePost as dbUpdatePost,
  updateRssFeed,
  updateTemplate,
  updateTemplateLibrary,
  updateWebhook,
  upsertChannel,
  type PostState,
} from '@/lib/db/queries';
import * as schema from '@/lib/schema';
import { invalidatePendingApprovals, requestPublishApprovalById } from '@/lib/approval';
import { SUPPORTED_PLATFORMS } from '@/lib/platforms';
import { REDDIT_TARGET_SCHEMA_FIELDS, toRedditInsertFields, validateRedditTargetFields } from '@/lib/reddit-target';
import type { TemplateCategory, WebhookEvent } from '@/lib/db/types';

const CAPABILITIES = {
  version: '2026-07-22',
  product: {
    name: 'Unheard',
    mcp_server: 'Unheard MCP server',
    description: 'Manage social content, the content calendar, scheduling, channels, and approval handoff without browser access.',
  },
  auth: {
    type: 'bearer',
    methods: ['oauth2', 'team_api_key'],
    header: 'Authorization: Bearer <OAuth access token or team API key>',
    oauth_discovery: '/.well-known/oauth-protected-resource/mcp',
    note: 'MCP clients use OAuth. Team API keys remain available from Settings > API Keys.',
  },
  endpoint: {
    mcp: '/mcp',
    discover: 'GET /api/agent',
    invoke: 'POST /api/agent',
  },
  resources: {
    posts: ['list', 'get', 'create', 'update', 'schedule', 'requestApproval', 'delete'],
    ideas: ['list', 'get', 'create', 'update', 'delete', 'setStatus'],
    brands: ['list', 'get', 'create', 'update', 'delete', 'setDefault'],
    channels: ['list', 'get', 'create', 'update', 'delete', 'setDefault'],
    templates: ['list', 'get', 'create', 'update', 'delete'],
    templateLibrary: ['list', 'get', 'create', 'update', 'delete'],
    rssFeeds: ['list', 'get', 'create', 'update', 'delete'],
    webhooks: ['list', 'get', 'create', 'update', 'delete'],
    bestTimePredictions: ['list'],
    teamMembers: ['list'],
    postComments: ['list'],
    postApprovals: ['get'],
    telegramChannels: ['list', 'create', 'delete'],
  },
  existingHttpApis: [
    '/api/posts',
    '/api/posts/schedule',
    '/api/ideas',
    '/api/ideas/convert-to-post',
    '/api/upload',
    '/api/ai',
    '/api/assistant',
    '/api/rss-feeds',
  ],
};

const AgentAction = z.object({
  resource: z.enum([
    'posts',
    'ideas',
    'brands',
    'channels',
    'templates',
    'templateLibrary',
    'rssFeeds',
    'webhooks',
    'bestTimePredictions',
    'teamMembers',
    'postComments',
    'postApprovals',
    'telegramChannels',
  ]),
  action: z.string().min(1),
  input: z.record(z.string(), z.unknown()).optional().default({}),
});

const IdeaInput = z.object({
  id: z.string().optional(),
  text: z.string().min(1).optional(),
  status: z.enum(['open', 'closed']).optional(),
});

const PostTargetInput = z.object({
  channel_id: z.string().nullable().optional(),
  platform: z.enum(SUPPORTED_PLATFORMS),
  content: z.string().min(1, 'target content is required'),
  reply_settings: z.string().optional(),
  as_carousel: z.boolean().optional(),
  carousel_name: z.string().nullable().optional(),
  thread: z.array(z.string()).optional(),
  ...REDDIT_TARGET_SCHEMA_FIELDS,
}).superRefine(validateRedditTargetFields);

const PostMediaInput = z.object({
  id: z.string().min(1),
  filename: z.string().min(1),
  path: z.string().min(1),
  url: z.string().url(),
  type: z.enum(['image', 'video']),
  target_id: z.string().nullable().optional(),
  target_channel_id: z.string().nullable().optional(),
});

const PostMutationInput = z.object({
  id: z.string().optional(),
  targets: z.array(PostTargetInput).min(1, 'at least one target is required'),
  media: z.array(PostMediaInput).optional().default([]),
  publish_at: z.number().nullable().optional(),
  state: z.enum(['draft', 'scheduled']),
  channel_group: z.string().min(1).nullable().optional(),
  template_id: z.string().nullable().optional(),
  writing_prompt: z.string().nullable().optional(),
  idea_id: z.string().nullable().optional(),
  brand_id: z.string().nullable().optional(),
});

const PostScheduleInput = z.object({
  id: z.string().min(1),
  publish_at: z.number().int().positive(),
});

const PostListInput = z.object({
  states: z.array(z.enum(['draft', 'scheduled', 'awaiting_approval', 'publishing', 'published', 'failed'])).optional(),
});

const BrandInput = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  voice: z.string().default(''),
  audience: z.string().default(''),
  writing_prompt: z.string().default(''),
  is_default: z.boolean().default(false),
});

const ChannelInput = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  platform: z.enum(SUPPORTED_PLATFORMS),
  account_type: z.enum(['personal', 'company', 'page']).default('personal'),
  is_default: z.boolean().default(false),
  group_name: z.string().nullable().optional(),
  account_id: z.string().nullable().optional(),
  credentials: z.record(z.string(), z.unknown()).default({}),
});

const TemplateInput = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  slug: z.string().min(1),
  category: z.string().min(1),
  content: z.string().min(1),
});

const TemplateLibraryInput = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  category: z.enum(['launch', 'feature', 'testimonial', 'milestone', 'tutorial', 'engagement', 'other']),
  description: z.string().nullable().optional(),
  content_template: z.string().min(1),
  platform_variants: z.record(z.string(), z.string()).default({}),
  ai_prompt: z.string().nullable().optional(),
  is_favorite: z.boolean().default(false),
  usage_count: z.number().optional(),
});

const RssFeedInput = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  url: z.string().url(),
  feed_type: z.enum(['rss', 'atom', 'youtube', 'podcast']).default('rss'),
  status: z.enum(['active', 'paused', 'error']).optional(),
  last_fetched_at: z.number().nullable().optional(),
  last_item_hash: z.string().nullable().optional(),
  fetch_frequency: z.enum(['15m', '1h', '6h', '24h']).default('1h'),
  post_template: z.string().default('{{title}} {{link}}'),
  target_platforms: z.array(z.string()).default([]),
  target_channels: z.array(z.string()).default([]),
  filter_keywords: z.string().nullable().optional(),
});

const WebhookInput = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  url: z.string().url(),
  secret: z.string().optional(),
  events: z.array(z.enum(['post.created', 'post.scheduled', 'post.published', 'post.failed', 'post.deleted', 'media.uploaded'])).default([]),
  status: z.enum(['active', 'paused', 'error']).default('active'),
  headers: z.record(z.string(), z.string()).default({}),
});

const TelegramChannelInput = z.object({
  id: z.string().optional(),
  channel_id: z.string().min(1),
  name: z.string().min(1),
  bot_token: z.string().min(1),
  thread_id: z.string().nullable().optional(),
});

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function badRequest(message: string) {
  return json({ error: message }, 400);
}

async function authenticateAgentRequest(request: Request): Promise<AgentIdentity | Response> {
  return getRequestAgentIdentity(request);
}

function isReadAgentAction(action: string) {
  return action === 'list' || action === 'get';
}

function idInput(input: Record<string, unknown>) {
  const id = typeof input.id === 'string' ? input.id : '';
  if (!id) throw new Error('id is required');
  return id;
}

async function listTelegramChannels(teamId: string) {
  const db = await getDb();
  return db
    .select({
      id: schema.telegram_channels.id,
      channel_id: schema.telegram_channels.channel_id,
      name: schema.telegram_channels.name,
      thread_id: schema.telegram_channels.thread_id,
      created_at: schema.telegram_channels.created_at,
    })
    .from(schema.telegram_channels)
    .where(eq(schema.telegram_channels.team_id, teamId))
    .orderBy(desc(schema.telegram_channels.created_at));
}

type PostMutation = z.infer<typeof PostMutationInput>;

async function insertPostRelations(
  postId: string,
  teamId: string,
  data: PostMutation,
  previousTargetChannels = new Map<string, string>(),
) {
  const group = data.channel_group ?? 'personal';
  const channelToTarget = new Map<string, string>();

  for (const target of data.targets) {
    const targetId = uuid();
    const fallback = target.channel_id
      ? null
      : await getChannelByPlatformAndGroup(teamId, target.platform, group);
    const channelId = target.channel_id ?? fallback?.id ?? null;

    await insertPostTarget(
      targetId,
      postId,
      channelId,
      target.platform,
      target.content,
      target.reply_settings ?? 'everyone',
      target.as_carousel ?? false,
      target.carousel_name ?? null,
      target.thread ?? null,
      toRedditInsertFields(target),
    );
    if (channelId) channelToTarget.set(channelId, targetId);
  }

  for (const media of data.media) {
    const requestedChannelId = media.target_channel_id
      ?? (media.target_id ? previousTargetChannels.get(media.target_id) : null)
      ?? (media.target_id && channelToTarget.has(media.target_id) ? media.target_id : null);
    const targetId = requestedChannelId ? channelToTarget.get(requestedChannelId) : null;
    if (requestedChannelId && !targetId) {
      throw new Error(`No post target uses media target channel ${requestedChannelId}`);
    }
    await insertPostMedia(media.id, postId, targetId ?? null, media.filename, media.path, media.url, media.type);
  }
}

async function handleAction(teamId: string, resource: z.infer<typeof AgentAction>['resource'], action: string, input: Record<string, unknown>) {
  const now = Date.now();

  if (resource === 'posts') {
    if (action === 'list') {
      const data = PostListInput.parse(input);
      return listPostsWithDetails(teamId, data.states as PostState[] | undefined);
    }
    if (action === 'get') return getPostWithDetails(idInput(input), teamId);
    if (action === 'create') {
      const data = PostMutationInput.parse(input);
      const id = uuid();
      const state = data.state === 'scheduled' && data.publish_at ? 'scheduled' : 'draft';
      try {
        await insertPost(
          id,
          teamId,
          state,
          data.publish_at ?? null,
          now,
          data.channel_group ?? 'personal',
          data.template_id ?? null,
          data.writing_prompt ?? null,
          data.idea_id ?? null,
          data.brand_id ?? null,
        );
        await insertPostRelations(id, teamId, data);
        return getPostWithDetails(id, teamId);
      } catch (error) {
        await deletePost(id, teamId).catch(() => undefined);
        throw error;
      }
    }
    if (action === 'update') {
      const data = PostMutationInput.required({ id: true }).parse(input);
      const existing = await getPostWithDetails(data.id, teamId);
      if (!existing) throw new Error('Post not found');
      const previousTargetChannels = new Map(
        existing.targets
          .filter(target => target.channel_id)
          .map(target => [target.id, target.channel_id!]),
      );
      const state = data.state === 'scheduled' && data.publish_at ? 'scheduled' : 'draft';
      await invalidatePendingApprovals(data.id, teamId, 'The post was edited through the Unheard MCP server after approval was requested.');
      await dbUpdatePost(
        data.id,
        teamId,
        state,
        data.publish_at ?? null,
        now,
        data.channel_group ?? 'personal',
        data.template_id ?? null,
        data.writing_prompt ?? null,
        data.idea_id ?? null,
        data.brand_id ?? null,
      );
      await deletePostTargets(data.id);
      await deletePostMedia(data.id);
      await insertPostRelations(data.id, teamId, data, previousTargetChannels);
      return getPostWithDetails(data.id, teamId);
    }
    if (action === 'schedule') {
      const data = PostScheduleInput.parse(input);
      const existing = await getPostWithDetails(data.id, teamId);
      if (!existing) throw new Error('Post not found');
      await invalidatePendingApprovals(data.id, teamId, 'The post was rescheduled through the Unheard MCP server after approval was requested.');
      await dbUpdatePost(
        data.id,
        teamId,
        'scheduled',
        data.publish_at,
        now,
        existing.channel_group,
        existing.template_id,
        existing.writing_prompt,
        existing.idea_id,
        existing.brand_id,
      );
      return getPostWithDetails(data.id, teamId);
    }
    if (action === 'requestApproval') {
      return requestPublishApprovalById(idInput(input), teamId);
    }
    if (action === 'delete') {
      const id = idInput(input);
      if (!(await getPostWithDetails(id, teamId))) throw new Error('Post not found');
      await invalidatePendingApprovals(id, teamId, 'The post was deleted through the Unheard MCP server after approval was requested.');
      await deletePost(id, teamId);
      return { ok: true };
    }
  }

  if (resource === 'ideas') {
    if (action === 'list') return listIdeas(teamId);
    if (action === 'get') return getIdea(idInput(input), teamId);
    if (action === 'create') {
      const data = IdeaInput.required({ text: true }).parse(input);
      const id = uuid();
      await insertIdea(id, teamId, data.text, now);
      if (data.status) await updateIdeaStatus(id, teamId, data.status, now);
      return getIdea(id, teamId);
    }
    if (action === 'update') {
      const data = IdeaInput.required({ id: true, text: true }).parse(input);
      await updateIdea(data.id, teamId, data.text, now);
      if (data.status) await updateIdeaStatus(data.id, teamId, data.status, now);
      return getIdea(data.id, teamId);
    }
    if (action === 'setStatus') {
      const data = IdeaInput.required({ id: true, status: true }).parse(input);
      await updateIdeaStatus(data.id, teamId, data.status, now);
      return getIdea(data.id, teamId);
    }
    if (action === 'delete') {
      await deleteIdea(idInput(input), teamId);
      return { ok: true };
    }
  }

  if (resource === 'brands') {
    if (action === 'list') return listBrandProfiles(teamId);
    if (action === 'get') return getBrandProfile(idInput(input), teamId);
    if (action === 'create') {
      const data = BrandInput.parse(input);
      const id = uuid();
      await insertBrandProfile(id, teamId, data.name, data.voice, data.audience, data.writing_prompt, data.is_default, now);
      if (data.is_default) await setDefaultBrandProfile(id, teamId);
      return getBrandProfile(id, teamId);
    }
    if (action === 'update') {
      const data = BrandInput.required({ id: true }).parse(input);
      await updateBrandProfile(data.id, teamId, data.name, data.voice, data.audience, data.writing_prompt, now);
      if (data.is_default) await setDefaultBrandProfile(data.id, teamId);
      return getBrandProfile(data.id, teamId);
    }
    if (action === 'setDefault') {
      await setDefaultBrandProfile(idInput(input), teamId);
      return { ok: true };
    }
    if (action === 'delete') {
      await deleteBrandProfile(idInput(input), teamId);
      return { ok: true };
    }
  }

  if (resource === 'channels') {
    if (action === 'list') return listChannels(teamId);
    if (action === 'get') return getChannel(idInput(input), teamId);
    if (action === 'create' || action === 'update') {
      const data = ChannelInput.parse(input);
      const id = data.id ?? uuid();
      await upsertChannel(id, teamId, data.name, data.platform, data.account_type, data.is_default, data.group_name ?? null, data.account_id ?? null, await encrypt(JSON.stringify(data.credentials)), now);
      if (data.is_default) await setDefaultChannel(id, teamId);
      return getChannel(id, teamId);
    }
    if (action === 'setDefault') {
      await setDefaultChannel(idInput(input), teamId);
      return { ok: true };
    }
    if (action === 'delete') {
      await deleteChannel(idInput(input), teamId);
      return { ok: true };
    }
  }

  if (resource === 'templates') {
    if (action === 'list') return listTemplates(teamId);
    if (action === 'get') return getTemplate(idInput(input), teamId);
    if (action === 'create') {
      const data = TemplateInput.parse(input);
      const id = data.id ?? uuid();
      await insertTemplate(id, teamId, data.name, data.slug, data.category, data.content, now);
      return getTemplate(id, teamId);
    }
    if (action === 'update') {
      const data = TemplateInput.required({ id: true }).parse(input);
      await updateTemplate(data.id, teamId, data.name, data.category, data.content, now);
      return getTemplate(data.id, teamId);
    }
    if (action === 'delete') {
      await deleteTemplate(idInput(input), teamId);
      return { ok: true };
    }
  }

  if (resource === 'templateLibrary') {
    if (action === 'list') return getTemplatesLibrary(teamId);
    if (action === 'get') return getTemplateById(idInput(input), teamId);
    if (action === 'create') {
      const data = TemplateLibraryInput.parse(input);
      const id = await insertTemplateLibrary({
        team_id: teamId,
        name: data.name,
        category: data.category as TemplateCategory,
        description: data.description ?? null,
        content_template: data.content_template,
        platform_variants: data.platform_variants,
        ai_prompt: data.ai_prompt ?? null,
        is_favorite: data.is_favorite,
        usage_count: data.usage_count ?? 0,
      });
      return getTemplateById(id, teamId);
    }
    if (action === 'update') {
      const data = TemplateLibraryInput.required({ id: true }).parse(input);
      await updateTemplateLibrary(data.id, teamId, {
        name: data.name,
        category: data.category as TemplateCategory,
        description: data.description ?? null,
        content_template: data.content_template,
        platform_variants: data.platform_variants,
        ai_prompt: data.ai_prompt ?? null,
        is_favorite: data.is_favorite,
        usage_count: data.usage_count ?? 0,
      });
      return getTemplateById(data.id, teamId);
    }
    if (action === 'delete') {
      await deleteTemplateLibrary(idInput(input), teamId);
      return { ok: true };
    }
  }

  if (resource === 'rssFeeds') {
    if (action === 'list') return getRssFeeds(teamId);
    if (action === 'get') return getRssFeed(idInput(input), teamId);
    if (action === 'create') {
      const data = RssFeedInput.parse(input);
      const id = data.id ?? uuid();
      await insertRssFeed({ ...data, id, team_id: teamId, status: data.status ?? 'active', last_fetched_at: data.last_fetched_at ?? null, last_item_hash: data.last_item_hash ?? null, filter_keywords: data.filter_keywords ?? null });
      return getRssFeed(id, teamId);
    }
    if (action === 'update') {
      const data = RssFeedInput.partial().required({ id: true }).parse(input);
      await updateRssFeed(data.id, teamId, data);
      return getRssFeed(data.id, teamId);
    }
    if (action === 'delete') {
      await deleteRssFeed(idInput(input), teamId);
      return { ok: true };
    }
  }

  if (resource === 'webhooks') {
    if (action === 'list') return getWebhooks(teamId);
    if (action === 'get') return getWebhook(idInput(input), teamId);
    if (action === 'create') {
      const data = WebhookInput.parse(input);
      const id = data.id ?? uuid();
      await insertWebhook({ ...data, id, team_id: teamId, secret: data.secret ?? uuid(), events: data.events as WebhookEvent[] });
      return getWebhook(id, teamId);
    }
    if (action === 'update') {
      const data = WebhookInput.partial().required({ id: true }).parse(input);
      await updateWebhook(data.id, teamId, { ...data, events: data.events as WebhookEvent[] | undefined });
      return getWebhook(data.id, teamId);
    }
    if (action === 'delete') {
      await deleteWebhook(idInput(input), teamId);
      return { ok: true };
    }
  }

  if (resource === 'bestTimePredictions') {
    if (action === 'list') return getBestTimePredictions(teamId, typeof input.platform === 'string' ? input.platform : undefined);
  }

  if (resource === 'teamMembers') {
    if (action === 'list') return getTeamMembers(teamId);
  }

  if (resource === 'postComments') {
    if (action === 'list') {
      const postId = idInput({ id: input.post_id ?? input.id });
      if (!(await getPostWithDetails(postId, teamId))) throw new Error('Post not found');
      return getPostComments(postId);
    }
  }

  if (resource === 'postApprovals') {
    if (action === 'get') {
      const postId = idInput({ id: input.post_id ?? input.id });
      if (!(await getPostWithDetails(postId, teamId))) throw new Error('Post not found');
      return getPostApproval(postId);
    }
  }

  if (resource === 'telegramChannels') {
    if (action === 'list') return listTelegramChannels(teamId);
    if (action === 'create') {
      const data = TelegramChannelInput.parse(input);
      const id = data.id ?? uuid();
      const db = await getDb();
      await db.insert(schema.telegram_channels).values({
        id,
        team_id: teamId,
        channel_id: data.channel_id,
        name: data.name,
        bot_token: data.bot_token,
        thread_id: data.thread_id ?? null,
        created_at: now,
      });
      return (await listTelegramChannels(teamId)).find(channel => channel.id === id) ?? null;
    }
    if (action === 'delete') {
      const db = await getDb();
      await db
        .delete(schema.telegram_channels)
        .where(and(eq(schema.telegram_channels.id, idInput(input)), eq(schema.telegram_channels.team_id, teamId)));
      return { ok: true };
    }
  }

  throw new Error(`Unsupported action: ${resource}.${action}`);
}

export const Route = createFileRoute('/api/agent')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateAgentRequest(request);
        if (auth instanceof Response) return auth;
        return json(CAPABILITIES);
      },
      POST: async ({ request }) => {
        const auth = await authenticateAgentRequest(request);
        if (auth instanceof Response) return auth;

        try {
          const body = AgentAction.parse(await request.json());
          if (!auth.scopes.includes('write') && !isReadAgentAction(body.action)) {
            return json({ error: 'This connection has read-only access' }, 403);
          }
          const result = await handleAction(auth.teamId, body.resource, body.action, body.input);
          return json({ ok: true, result });
        } catch (error) {
          if (error instanceof z.ZodError) {
            return json({ error: 'Invalid input', details: error.issues }, 400);
          }
          const message = error instanceof Error ? error.message : 'Agent action failed';
          return json({ error: message }, 400);
        }
      },
    },
  },
});
