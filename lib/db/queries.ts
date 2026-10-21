// ABOUTME: Database query and mutation helpers.
// ABOUTME: This file should ONLY be imported on the server.

import { eq, inArray, sql, and, desc, asc, isNull } from 'drizzle-orm';
import { getDb } from './client';
import * as schema from '../schema';
import type { Post, PostWithDetails, PostTarget, Media, PostState, Idea, Template, IdeaConversation, BrandProfile, Channel, Platform, User, Team, TeamMembership, ApiKey, ApiKeyView, RssFeed, Webhook, WebhookDelivery, PostComment, PostApproval, TeamInvite, TeamMember, TeamRole, PostApprovalStatus, IdeaComment, PostTemplateLibrary, BestTimePrediction, PostingTimeAnalytics } from './types';

export type { Post, PostWithDetails, PostTarget, Media, PostState, Idea, Template, IdeaConversation, BrandProfile, Channel, Platform, User, Team, TeamMembership, ApiKey, ApiKeyView, RssFeed, Webhook, WebhookDelivery, PostComment, PostApproval, TeamInvite, TeamMember, TeamRole, PostApprovalStatus, IdeaComment, PostTemplateLibrary, BestTimePrediction, PostingTimeAnalytics } from './types';

// ============================================================================
// USER & TEAM QUERIES
// ============================================================================

export async function getUserByEmail(email: string): Promise<User | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email.toLowerCase()))
    .limit(1);
  return rows.length ? (rows[0] as User) : null;
}

export async function getUserById(id: string): Promise<User | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  return rows.length ? (rows[0] as User) : null;
}

export async function getTeamById(id: string): Promise<Team | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.id, id))
    .limit(1);
  return rows.length ? (rows[0] as Team) : null;
}

export async function getTeamBySlug(slug: string): Promise<Team | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.slug, slug))
    .limit(1);
  return rows.length ? (rows[0] as Team) : null;
}

export async function getUserTeamMembership(userId: string, teamId: string): Promise<TeamMembership | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.team_memberships)
    .where(and(
      eq(schema.team_memberships.user_id, userId),
      eq(schema.team_memberships.team_id, teamId)
    ))
    .limit(1);
  return rows.length ? (rows[0] as TeamMembership) : null;
}

export async function getUserTeams(userId: string): Promise<Array<{ membership: TeamMembership; team: Team }>> {
  const db = await getDb();
  const rows = await db
    .select({
      membership: schema.team_memberships,
      team: schema.teams,
    })
    .from(schema.team_memberships)
    .innerJoin(schema.teams, eq(schema.team_memberships.team_id, schema.teams.id))
    .where(eq(schema.team_memberships.user_id, userId));
  return rows as Array<{ membership: TeamMembership; team: Team }>;
}

export async function listApiKeys(teamId: string): Promise<ApiKeyView[]> {
  const db = await getDb();
  return db
    .select({
      id: schema.api_keys.id,
      name: schema.api_keys.name,
      key_prefix: schema.api_keys.key_prefix,
      last_used_at: schema.api_keys.last_used_at,
      revoked_at: schema.api_keys.revoked_at,
      created_at: schema.api_keys.created_at,
    })
    .from(schema.api_keys)
    .where(eq(schema.api_keys.team_id, teamId))
    .orderBy(desc(schema.api_keys.created_at)) as Promise<ApiKeyView[]>;
}

export async function getApiKeyByHash(keyHash: string): Promise<ApiKey | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.api_keys)
    .where(eq(schema.api_keys.key_hash, keyHash))
    .limit(1);
  return rows.length ? (rows[0] as ApiKey) : null;
}

export async function insertApiKey(id: string, teamId: string, createdBy: string, name: string, keyHash: string, keyPrefix: string, now: number): Promise<void> {
  const db = await getDb();
  await db.insert(schema.api_keys).values({
    id,
    team_id: teamId,
    created_by: createdBy,
    name,
    key_hash: keyHash,
    key_prefix: keyPrefix,
    last_used_at: null,
    revoked_at: null,
    created_at: now,
  });
}

export async function revokeApiKey(id: string, teamId: string, now: number): Promise<void> {
  const db = await getDb();
  await db
    .update(schema.api_keys)
    .set({ revoked_at: now })
    .where(and(eq(schema.api_keys.id, id), eq(schema.api_keys.team_id, teamId)));
}

export async function touchApiKey(id: string, now: number): Promise<void> {
  const db = await getDb();
  await db
    .update(schema.api_keys)
    .set({ last_used_at: now })
    .where(eq(schema.api_keys.id, id));
}

// ============================================================================
// POST QUERIES (with team scoping)
// ============================================================================

const D1_IN_QUERY_CHUNK_SIZE = 90;

async function selectInChunks<T>(
  values: string[],
  select: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += D1_IN_QUERY_CHUNK_SIZE) {
    batches.push(await select(values.slice(index, index + D1_IN_QUERY_CHUNK_SIZE)));
  }
  return batches.flat();
}

async function loadDetails(posts: Post[]): Promise<PostWithDetails[]> {
  if (posts.length === 0) return [];
  const db = await getDb();
  const ids = posts.map(p => p.id);
  const templateIds = [...new Set(posts.map(p => p.template_id).filter(Boolean))] as string[];
  const brandIds = [...new Set(posts.map(p => p.brand_id).filter(Boolean))] as string[];
  const ideaIds = [...new Set(posts.map(p => p.idea_id).filter(Boolean))] as string[];
  const [targets, mediaRows, templateRows, brandRows, ideaRows] = await Promise.all([
    selectInChunks(ids, chunk => db.select().from(schema.post_targets).where(inArray(schema.post_targets.post_id, chunk))),
    selectInChunks(ids, chunk => db.select().from(schema.media).where(inArray(schema.media.post_id, chunk))),
    templateIds.length > 0
      ? selectInChunks(templateIds, chunk => db.select({ id: schema.templates.id, name: schema.templates.name }).from(schema.templates).where(inArray(schema.templates.id, chunk)))
      : Promise.resolve([]),
    brandIds.length > 0
      ? selectInChunks(brandIds, chunk => db.select({ id: schema.brand_profiles.id, name: schema.brand_profiles.name }).from(schema.brand_profiles).where(inArray(schema.brand_profiles.id, chunk)))
      : Promise.resolve([]),
    ideaIds.length > 0
      ? selectInChunks(ideaIds, chunk => db.select({ id: schema.ideas.id, text: schema.ideas.text }).from(schema.ideas).where(inArray(schema.ideas.id, chunk)))
      : Promise.resolve([]),
  ]);
  const channelIds = [...new Set(targets.map(target => target.channel_id).filter(Boolean))] as string[];
  const channelRows = channelIds.length > 0
    ? await selectInChunks(channelIds, chunk => db.select({
      id: schema.channels.id,
      name: schema.channels.name,
      account_id: schema.channels.account_id,
      account_type: schema.channels.account_type,
    }).from(schema.channels).where(inArray(schema.channels.id, chunk)))
    : [];
  const templateMap = new Map(templateRows.map(t => [t.id, t.name]));
  const brandMap = new Map(brandRows.map(brand => [brand.id, brand.name]));
  const ideaMap = new Map(ideaRows.map(i => [i.id, i.text]));
  const channelMap = new Map(channelRows.map(channel => [channel.id, channel]));
  return posts.map(post => ({
    ...post,
    targets: targets.filter(t => t.post_id === post.id).map(t => ({
      ...t,
      channel_name: t.channel_id ? channelMap.get(t.channel_id)?.name ?? null : null,
      channel_account_id: t.channel_id ? channelMap.get(t.channel_id)?.account_id ?? null : null,
      channel_account_type: t.channel_id ? channelMap.get(t.channel_id)?.account_type ?? null : null,
      thread: t.thread ? JSON.parse(t.thread) as string[] : null,
    })) as PostTarget[],
    media: mediaRows.filter(m => m.post_id === post.id) as Media[],
    template_name: post.template_id ? templateMap.get(post.template_id) ?? null : null,
    brand_name: post.brand_id ? brandMap.get(post.brand_id) ?? null : null,
    idea_text: post.idea_id ? ideaMap.get(post.idea_id) ?? null : null,
  }));
}

export async function getPostWithDetails(id: string, teamId: string): Promise<PostWithDetails | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.posts)
    .where(and(
      eq(schema.posts.id, id),
      eq(schema.posts.team_id, teamId)
    ));
  if (rows.length === 0) return null;
  const [result] = await loadDetails(rows as Post[]);
  return result;
}

export async function listPostsWithDetails(teamId: string, states?: PostState[]): Promise<PostWithDetails[]> {
  const db = await getDb();
  const conditions = [eq(schema.posts.team_id, teamId)];
  
  if (states && states.length > 0) {
    conditions.push(inArray(schema.posts.state, states));
  }

  const rows = await db
    .select()
    .from(schema.posts)
    .where(and(...conditions))
    .orderBy(sql`COALESCE(${schema.posts.publish_at}, ${schema.posts.created_at}) ASC`);
  return loadDetails(rows as Post[]);
}

export async function getDueScheduledPosts(): Promise<PostWithDetails[]> {
  const db = await getDb();
  const now = Date.now();
  const rows = await db.select().from(schema.posts)
    .where(sql`${schema.posts.state} = 'scheduled' AND ${schema.posts.publish_at} <= ${now}`);
  return loadDetails(rows as Post[]);
}

export async function insertPost(
  id: string, 
  teamId: string,
  state: PostState, 
  publish_at: number | null, 
  now: number, 
  channel_group: string | null = null, 
  template_id: string | null = null, 
  writing_prompt: string | null = null, 
  idea_id: string | null = null,
  brand_id: string | null = null,
): Promise<void> {
  const db = await getDb();
  await db.insert(schema.posts).values({ 
    id, 
    team_id: teamId,
    state, 
    channel_group: channel_group ?? 'default', 
    template_id, 
    brand_id,
    writing_prompt, 
    idea_id, 
    publish_at, 
    created_at: now, 
    updated_at: now 
  });
}

export async function insertPostTarget(
  id: string, post_id: string, channel_id: string | null, platform: string, content: string,
  reply_settings: string, as_carousel: boolean, carousel_name: string | null,
  thread: string[] | null = null,
  reddit: {
    title: string | null;
    subreddit: string | null;
    postType: 'self' | 'link' | null;
    url: string | null;
    flairId: string | null;
    nsfw: boolean;
    spoiler: boolean;
  } | null = null,
): Promise<void> {
  const db = await getDb();
  await db.insert(schema.post_targets).values({
    id, post_id, channel_id, platform, content, reply_settings, as_carousel, carousel_name,
    thread: thread ? JSON.stringify(thread) : null,
    reddit_title: reddit?.title ?? null,
    subreddit: reddit?.subreddit ?? null,
    reddit_post_type: reddit?.postType ?? null,
    reddit_url: reddit?.url ?? null,
    flair_id: reddit?.flairId ?? null,
    nsfw: reddit?.nsfw ?? false,
    spoiler: reddit?.spoiler ?? false,
  });
}

export async function updatePostState(id: string, teamId: string, state: PostState, now: number): Promise<void> {
  const db = await getDb();
  await db.update(schema.posts)
    .set({ state, updated_at: now })
    .where(and(
      eq(schema.posts.id, id),
      eq(schema.posts.team_id, teamId)
    ));
}

export async function updatePost(
  id: string, 
  teamId: string,
  state: PostState, 
  publish_at: number | null, 
  now: number, 
  channel_group: string | null = null, 
  template_id: string | null = null, 
  writing_prompt: string | null = null, 
  idea_id: string | null = null,
  brand_id: string | null = null,
): Promise<void> {
  const db = await getDb();
  await db.update(schema.posts)
    .set({ state, channel_group: channel_group ?? 'default', template_id, brand_id, writing_prompt, idea_id, publish_at, updated_at: now })
    .where(and(
      eq(schema.posts.id, id),
      eq(schema.posts.team_id, teamId)
    ));
}

export async function deletePost(id: string, teamId: string): Promise<void> {
  const db = await getDb();
  await db.delete(schema.posts)
    .where(and(
      eq(schema.posts.id, id),
      eq(schema.posts.team_id, teamId)
    ));
}

export async function deletePostTargets(post_id: string): Promise<void> {
  const db = await getDb();
  await db.delete(schema.post_targets).where(eq(schema.post_targets.post_id, post_id));
}

export async function insertPostMedia(
  id: string, post_id: string, target_id: string | null, filename: string, path: string, url: string, type: string,
): Promise<void> {
  const db = await getDb();
  await db.insert(schema.media).values({ id, post_id, target_id, filename, path, url, type });
}

export async function deletePostMedia(post_id: string): Promise<void> {
  const db = await getDb();
  await db.delete(schema.media).where(eq(schema.media.post_id, post_id));
}

export async function getMediaForTarget(target_id: string): Promise<Media[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.media)
    .where(eq(schema.media.target_id, target_id));
  return rows as Media[];
}

export async function getSharedMediaForPost(post_id: string): Promise<Media[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.media)
    .where(and(
      eq(schema.media.post_id, post_id),
      sql`${schema.media.target_id} IS NULL`
    ));
  return rows as Media[];
}

export async function deleteMediaForTarget(target_id: string): Promise<void> {
  const db = await getDb();
  await db.delete(schema.media).where(eq(schema.media.target_id, target_id));
}

export async function updateTargetSuccess(id: string, platform_post_id: string): Promise<void> {
  const db = await getDb();
  await db.update(schema.post_targets).set({ platform_post_id, error: null }).where(eq(schema.post_targets.id, id));
}

export async function updateTargetError(id: string, error: string): Promise<void> {
  const db = await getDb();
  await db.update(schema.post_targets).set({ error }).where(eq(schema.post_targets.id, id));
}

// ============================================================================
// IDEA QUERIES (with team scoping)
// ============================================================================

function toIdeaStatus(status: string): Idea['status'] {
  return status === 'closed' ? 'closed' : 'open';
}

export async function listIdeas(teamId: string): Promise<Idea[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.ideas)
    .where(eq(schema.ideas.team_id, teamId))
    .orderBy(
      sql`CASE WHEN ${schema.ideas.status} = 'open' THEN 0 ELSE 1 END`,
      sql`${schema.ideas.updated_at} DESC`,
    );
  return rows.map(row => ({ ...row, status: toIdeaStatus(row.status) }));
}

export async function getIdea(id: string, teamId: string): Promise<Idea | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.ideas)
    .where(and(
      eq(schema.ideas.id, id),
      eq(schema.ideas.team_id, teamId)
    ));
  if (rows.length === 0) return null;
  const row = rows[0];
  return { ...row, status: toIdeaStatus(row.status) };
}

export async function insertIdea(id: string, teamId: string, text: string, now: number): Promise<void> {
  const db = await getDb();
  await db.insert(schema.ideas).values({ id, team_id: teamId, text, status: 'open', created_at: now, updated_at: now });
}

export async function updateIdea(id: string, teamId: string, text: string, now: number): Promise<void> {
  const db = await getDb();
  await db.update(schema.ideas)
    .set({ text, updated_at: now })
    .where(and(
      eq(schema.ideas.id, id),
      eq(schema.ideas.team_id, teamId)
    ));
}

export async function updateIdeaStatus(id: string, teamId: string, status: Idea['status'], now: number): Promise<void> {
  const db = await getDb();
  await db.update(schema.ideas)
    .set({ status, updated_at: now })
    .where(and(
      eq(schema.ideas.id, id),
      eq(schema.ideas.team_id, teamId)
    ));
}

export async function deleteIdea(id: string, teamId: string): Promise<void> {
  const db = await getDb();
  await db.delete(schema.ideas)
    .where(and(
      eq(schema.ideas.id, id),
      eq(schema.ideas.team_id, teamId)
    ));
}

// ============================================================================
// TEMPLATE QUERIES (with team scoping)
// ============================================================================

export async function listTemplates(teamId: string): Promise<Template[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.templates)
    .where(eq(schema.templates.team_id, teamId))
    .orderBy(schema.templates.name);
  return rows as Template[];
}

export async function getTemplate(id: string, teamId: string): Promise<Template | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.templates)
    .where(and(
      eq(schema.templates.id, id),
      eq(schema.templates.team_id, teamId)
    ));
  return rows.length ? (rows[0] as Template) : null;
}

export async function getTemplateBySlug(slug: string, teamId: string): Promise<Template | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.templates)
    .where(and(
      eq(schema.templates.slug, slug),
      eq(schema.templates.team_id, teamId)
    ));
  return rows.length ? (rows[0] as Template) : null;
}

export async function insertTemplate(id: string, teamId: string, name: string, slug: string, category: string, content: string, now: number): Promise<void> {
  const db = await getDb();
  await db.insert(schema.templates).values({ id, team_id: teamId, name, slug, category, content, created_at: now, updated_at: now });
}

export async function upsertTemplate(id: string, teamId: string, name: string, slug: string, category: string, content: string, now: number): Promise<void> {
  const db = await getDb();
  await db.insert(schema.templates)
    .values({ id, team_id: teamId, name, slug, category, content, created_at: now, updated_at: now })
    .onConflictDoUpdate({ 
      target: [schema.templates.slug, schema.templates.team_id], 
      set: { name, category, content, updated_at: now } 
    });
}

export async function updateTemplate(id: string, teamId: string, name: string, category: string, content: string, now: number): Promise<void> {
  const db = await getDb();
  await db.update(schema.templates)
    .set({ name, category, content, updated_at: now })
    .where(and(
      eq(schema.templates.id, id),
      eq(schema.templates.team_id, teamId)
    ));
}

export async function deleteTemplate(id: string, teamId: string): Promise<void> {
  const db = await getDb();
  await db.delete(schema.templates)
    .where(and(
      eq(schema.templates.id, id),
      eq(schema.templates.team_id, teamId)
    ));
}

// ============================================================================
// IDEA CONVERSATION QUERIES
// ============================================================================

export async function getIdeaConversation(idea_id: string): Promise<IdeaConversation | null> {
  const db = await getDb();
  const rows = await db.select().from(schema.idea_conversations).where(eq(schema.idea_conversations.idea_id, idea_id));
  return rows.length ? rows[0] : null;
}

export async function upsertIdeaConversation(idea_id: string, messages: string, now: number): Promise<void> {
  const db = await getDb();
  await db.insert(schema.idea_conversations)
    .values({ idea_id, messages, updated_at: now })
    .onConflictDoUpdate({ target: schema.idea_conversations.idea_id, set: { messages, updated_at: now } });
}

// ============================================================================
// IDEA COMMENTS/VARIATIONS QUERIES
// ============================================================================

export async function listIdeaComments(ideaId: string): Promise<Array<IdeaComment & { user_name: string | null }>> {
  const db = await getDb();
  const rows = await db
    .select({
      id: schema.idea_comments.id,
      idea_id: schema.idea_comments.idea_id,
      user_id: schema.idea_comments.user_id,
      user_name: schema.users.name,
      content: schema.idea_comments.content,
      suggested_text: schema.idea_comments.suggested_text,
      is_applied: schema.idea_comments.is_applied,
      applied_at: schema.idea_comments.applied_at,
      created_at: schema.idea_comments.created_at,
      updated_at: schema.idea_comments.updated_at,
    })
    .from(schema.idea_comments)
    .innerJoin(schema.users, eq(schema.idea_comments.user_id, schema.users.id))
    .where(eq(schema.idea_comments.idea_id, ideaId))
    .orderBy(desc(schema.idea_comments.created_at));
  return rows as Array<IdeaComment & { user_name: string | null }>;
}

export async function insertIdeaComment(
  id: string,
  ideaId: string,
  userId: string,
  content: string,
  suggestedText: string | null,
  now: number
): Promise<void> {
  const db = await getDb();
  await db.insert(schema.idea_comments).values({
    id,
    idea_id: ideaId,
    user_id: userId,
    content,
    suggested_text: suggestedText,
    is_applied: false,
    created_at: now,
    updated_at: now,
  });
}

export async function applyIdeaComment(commentId: string, now: number): Promise<void> {
  const db = await getDb();
  await db.update(schema.idea_comments)
    .set({ is_applied: true, applied_at: now, updated_at: now })
    .where(eq(schema.idea_comments.id, commentId));
}

export async function deleteIdeaComment(commentId: string, userId: string): Promise<void> {
  const db = await getDb();
  await db.delete(schema.idea_comments)
    .where(and(
      eq(schema.idea_comments.id, commentId),
      eq(schema.idea_comments.user_id, userId)
    ));
}

// ============================================================================
// BRAND PROFILE QUERIES (with team scoping)
// ============================================================================

export async function listBrandProfiles(teamId: string): Promise<BrandProfile[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.brand_profiles)
    .where(eq(schema.brand_profiles.team_id, teamId))
    .orderBy(schema.brand_profiles.name);
  return rows as BrandProfile[];
}

export async function getBrandProfile(id: string, teamId: string): Promise<BrandProfile | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.brand_profiles)
    .where(and(
      eq(schema.brand_profiles.id, id),
      eq(schema.brand_profiles.team_id, teamId)
    ));
  return rows.length ? (rows[0] as BrandProfile) : null;
}

export async function getDefaultBrandProfile(teamId: string): Promise<BrandProfile | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.brand_profiles)
    .where(and(
      eq(schema.brand_profiles.team_id, teamId),
      eq(schema.brand_profiles.is_default, true)
    ))
    .limit(1);
  if (rows.length) return rows[0] as BrandProfile;
  const fallback = await db
    .select()
    .from(schema.brand_profiles)
    .where(eq(schema.brand_profiles.team_id, teamId))
    .orderBy(schema.brand_profiles.name)
    .limit(1);
  return fallback.length ? (fallback[0] as BrandProfile) : null;
}

export async function setDefaultBrandProfile(id: string, teamId: string): Promise<void> {
  const db = await getDb();
  await db.update(schema.brand_profiles)
    .set({ is_default: false })
    .where(and(
      eq(schema.brand_profiles.team_id, teamId),
      eq(schema.brand_profiles.is_default, true)
    ));
  await db.update(schema.brand_profiles)
    .set({ is_default: true })
    .where(and(
      eq(schema.brand_profiles.id, id),
      eq(schema.brand_profiles.team_id, teamId)
    ));
}

export async function insertBrandProfile(id: string, teamId: string, name: string, voice: string, audience: string, writing_prompt: string, is_default: boolean, now: number): Promise<void> {
  const db = await getDb();
  await db.insert(schema.brand_profiles).values({ id, team_id: teamId, name, voice, audience, writing_prompt, is_default, created_at: now, updated_at: now });
}

export async function updateBrandProfile(id: string, teamId: string, name: string, voice: string, audience: string, writing_prompt: string, now: number): Promise<void> {
  const db = await getDb();
  await db.update(schema.brand_profiles)
    .set({ name, voice, audience, writing_prompt, updated_at: now })
    .where(and(
      eq(schema.brand_profiles.id, id),
      eq(schema.brand_profiles.team_id, teamId)
    ));
}

export async function deleteBrandProfile(id: string, teamId: string): Promise<void> {
  const db = await getDb();
  await db.delete(schema.brand_profiles)
    .where(and(
      eq(schema.brand_profiles.id, id),
      eq(schema.brand_profiles.team_id, teamId)
    ));
}

// ============================================================================
// CHANNEL QUERIES (with team scoping)
// ============================================================================

export async function listChannels(teamId: string): Promise<Channel[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.team_id, teamId))
    .orderBy(
      schema.channels.platform,
      sql`${schema.channels.is_default} DESC`,
      schema.channels.name
    );
  return rows as Channel[];
}

export async function listChannelsByPlatform(teamId: string, platform: Platform): Promise<Channel[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.channels)
    .where(and(
      eq(schema.channels.team_id, teamId),
      eq(schema.channels.platform, platform)
    ))
    .orderBy(sql`${schema.channels.is_default} DESC`, schema.channels.name);
  return rows as Channel[];
}

export async function listChannelsByGroup(teamId: string, group_name: string | null): Promise<Channel[]> {
  const db = await getDb();
  const rows = group_name
    ? await db.select()
        .from(schema.channels)
        .where(and(
          eq(schema.channels.team_id, teamId),
          eq(schema.channels.group_name, group_name)
        ))
        .orderBy(schema.channels.name)
    : await db.select()
        .from(schema.channels)
        .where(and(
          eq(schema.channels.team_id, teamId),
          sql`${schema.channels.group_name} IS NULL`
        ))
        .orderBy(schema.channels.name);
  return rows as Channel[];
}

export async function getChannel(id: string, teamId: string): Promise<Channel | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.channels)
    .where(and(
      eq(schema.channels.id, id),
      eq(schema.channels.team_id, teamId)
    ))
    .limit(1);
  return rows.length ? (rows[0] as Channel) : null;
}

export async function getChannelByPlatformAndType(teamId: string, platform: Platform, account_type: string): Promise<Channel | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.channels)
    .where(and(
      eq(schema.channels.team_id, teamId),
      sql`${schema.channels.platform} = ${platform} AND ${schema.channels.account_type} = ${account_type}`
    ))
    .orderBy(sql`${schema.channels.is_default} DESC`, schema.channels.created_at)
    .limit(1);
  return rows.length ? (rows[0] as Channel) : null;
}

export async function getDefaultChannelByPlatform(teamId: string, platform: Platform): Promise<Channel | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.channels)
    .where(and(
      eq(schema.channels.team_id, teamId),
      eq(schema.channels.platform, platform)
    ))
    .orderBy(sql`${schema.channels.is_default} DESC`, schema.channels.created_at)
    .limit(1);
  return rows.length ? (rows[0] as Channel) : null;
}

export async function getChannelByPlatformAndGroup(teamId: string, platform: Platform, groupName?: string): Promise<Channel | null> {
  if (!groupName) return getDefaultChannelByPlatform(teamId, platform);

  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.channels)
    .where(and(
      eq(schema.channels.team_id, teamId),
      eq(schema.channels.platform, platform),
      eq(schema.channels.group_name, groupName),
    ))
    .orderBy(sql`${schema.channels.is_default} DESC`, schema.channels.created_at)
    .limit(1);
  return rows.length ? (rows[0] as Channel) : null;
}

export async function upsertChannel(
  id: string,
  teamId: string, 
  name: string, 
  platform: Platform, 
  account_type: 'personal' | 'company' | 'page',
  is_default: boolean, 
  group_name: string | null,
  account_id: string | null,
  credentials: string, 
  now: number
): Promise<void> {
  const db = await getDb();
  await db.insert(schema.channels)
    .values({ id, team_id: teamId, name, platform, account_type, is_default, group_name: group_name ?? 'default', account_id, credentials, created_at: now })
    .onConflictDoUpdate({ 
      target: schema.channels.id, 
      set: { name, platform, account_type, is_default, group_name: group_name ?? 'default', account_id, credentials } 
    });
}

export async function clearDefaultChannels(teamId: string, platform: Platform, excludeId?: string): Promise<void> {
  const db = await getDb();
  const conditions = [
    eq(schema.channels.team_id, teamId),
    eq(schema.channels.platform, platform)
  ];
  
  if (excludeId) {
    conditions.push(sql`${schema.channels.id} <> ${excludeId}`);
  }
  
  await db.update(schema.channels)
    .set({ is_default: false })
    .where(and(...conditions));
}

export async function setDefaultChannel(id: string, teamId: string): Promise<void> {
  const db = await getDb();
  const channel = await getChannel(id, teamId);
  if (!channel) return;
  await clearDefaultChannels(teamId, channel.platform, id);
  await db.update(schema.channels)
    .set({ is_default: true })
    .where(and(
      eq(schema.channels.id, id),
      eq(schema.channels.team_id, teamId)
    ));
}

export async function deleteChannel(id: string, teamId: string): Promise<void> {
  const db = await getDb();
  await db.delete(schema.channels)
    .where(and(
      eq(schema.channels.id, id),
      eq(schema.channels.team_id, teamId)
    ));
}

// ============================================================================
// WAITLIST QUERIES (no team scoping - global)
// ============================================================================

export async function insertWaitlistEntry(id: string, name: string, email: string, handle: string | null, now: number): Promise<void> {
  const db = await getDb();
  await db.insert(schema.waitlist).values({ id, name, email, handle, created_at: now });
}

export async function getWaitlistEntryByEmail(email: string): Promise<{ id: string; name: string; email: string; handle: string | null; created_at: number } | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.waitlist)
    .where(eq(schema.waitlist.email, email))
    .limit(1);
  return rows.length ? rows[0] : null;
}

// ============================================================================
// RSS FEED QUERIES (Issue #7)
// ============================================================================

export async function getRssFeeds(teamId: string): Promise<RssFeed[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.rss_feeds)
    .where(eq(schema.rss_feeds.team_id, teamId))
    .orderBy(schema.rss_feeds.created_at);
  return rows.map(row => ({
    ...row,
    target_platforms: JSON.parse(row.target_platforms as string),
    target_channels: JSON.parse(row.target_channels as string),
  })) as RssFeed[];
}

export async function getRssFeed(id: string, teamId: string): Promise<RssFeed | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.rss_feeds)
    .where(and(eq(schema.rss_feeds.id, id), eq(schema.rss_feeds.team_id, teamId)))
    .limit(1);
  if (!rows.length) return null;
  const row = rows[0];
  return {
    ...row,
    target_platforms: JSON.parse(row.target_platforms as string),
    target_channels: JSON.parse(row.target_channels as string),
  } as RssFeed;
}

export async function insertRssFeed(feed: Omit<RssFeed, 'created_at' | 'updated_at'>): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.insert(schema.rss_feeds).values({
    ...feed,
    target_platforms: JSON.stringify(feed.target_platforms),
    target_channels: JSON.stringify(feed.target_channels),
    created_at: now,
    updated_at: now,
  });
}

export async function updateRssFeed(id: string, teamId: string, updates: Partial<Omit<RssFeed, 'id' | 'team_id' | 'created_at'>>): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  const updateData: Record<string, unknown> = { ...updates, updated_at: now };
  if (updates.target_platforms) {
    updateData.target_platforms = JSON.stringify(updates.target_platforms);
  }
  if (updates.target_channels) {
    updateData.target_channels = JSON.stringify(updates.target_channels);
  }
  await db.update(schema.rss_feeds)
    .set(updateData)
    .where(and(eq(schema.rss_feeds.id, id), eq(schema.rss_feeds.team_id, teamId)));
}

export async function deleteRssFeed(id: string, teamId: string): Promise<void> {
  const db = await getDb();
  await db.delete(schema.rss_feeds)
    .where(and(eq(schema.rss_feeds.id, id), eq(schema.rss_feeds.team_id, teamId)));
}

// ============================================================================
// WEBHOOK QUERIES (Issue #8)
// ============================================================================

export async function getWebhooks(teamId: string): Promise<Webhook[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.team_id, teamId))
    .orderBy(desc(schema.webhooks.created_at));
  return rows.map(row => ({
    ...row,
    events: JSON.parse(row.events as string),
    headers: JSON.parse(row.headers as string),
  })) as Webhook[];
}

export async function getWebhook(id: string, teamId: string): Promise<Webhook | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.webhooks)
    .where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.team_id, teamId)))
    .limit(1);
  if (!rows.length) return null;
  const row = rows[0];
  return {
    ...row,
    events: JSON.parse(row.events as string),
    headers: JSON.parse(row.headers as string),
  } as Webhook;
}

export async function insertWebhook(webhook: Omit<Webhook, 'created_at' | 'updated_at'> & { secret: string }): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.insert(schema.webhooks).values({
    ...webhook,
    events: JSON.stringify(webhook.events),
    headers: JSON.stringify(webhook.headers),
    created_at: now,
    updated_at: now,
  });
}

export async function updateWebhook(id: string, teamId: string, updates: Partial<Omit<Webhook, 'id' | 'team_id' | 'created_at'>>): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  const updateData: Record<string, unknown> = { ...updates, updated_at: now };
  if (updates.events) {
    updateData.events = JSON.stringify(updates.events);
  }
  if (updates.headers) {
    updateData.headers = JSON.stringify(updates.headers);
  }
  await db.update(schema.webhooks)
    .set(updateData)
    .where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.team_id, teamId)));
}

export async function deleteWebhook(id: string, teamId: string): Promise<void> {
  const db = await getDb();
  await db.delete(schema.webhooks)
    .where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.team_id, teamId)));
}

export async function insertWebhookDelivery(delivery: Omit<WebhookDelivery, 'id' | 'created_at'>): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.insert(schema.webhook_deliveries).values({
    ...delivery,
    id,
    created_at: Date.now(),
  });
  return id;
}

export async function getWebhookDeliveries(webhookId: string, limit = 50): Promise<WebhookDelivery[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.webhook_deliveries)
    .where(eq(schema.webhook_deliveries.webhook_id, webhookId))
    .orderBy(desc(schema.webhook_deliveries.created_at))
    .limit(limit);
  return rows as WebhookDelivery[];
}

export async function updateWebhookDelivery(id: string, updates: Partial<WebhookDelivery>): Promise<void> {
  const db = await getDb();
  await db.update(schema.webhook_deliveries)
    .set(updates)
    .where(eq(schema.webhook_deliveries.id, id));
}

export async function getPendingWebhookDeliveries(limit = 100): Promise<WebhookDelivery[]> {
  const db = await getDb();
  const now = Date.now();
  const rows = await db
    .select()
    .from(schema.webhook_deliveries)
    .where(and(
      eq(schema.webhook_deliveries.status, 'pending'),
      sql`${schema.webhook_deliveries.next_retry_at} IS NULL OR ${schema.webhook_deliveries.next_retry_at} <= ${now}`
    ))
    .orderBy(asc(schema.webhook_deliveries.created_at))
    .limit(limit);
  return rows as WebhookDelivery[];
}

// ============================================================================
// TEAM COLLABORATION QUERIES (Issue #9)
// ============================================================================

export async function getTeamMembers(teamId: string): Promise<TeamMember[]> {
  const db = await getDb();
  const rows = await db
    .select({
      user_id: schema.team_memberships.user_id,
      user_name: schema.users.name,
      user_email: schema.users.email,
      role: schema.team_memberships.role,
      joined_at: schema.team_memberships.created_at,
    })
    .from(schema.team_memberships)
    .innerJoin(schema.users, eq(schema.team_memberships.user_id, schema.users.id))
    .where(eq(schema.team_memberships.team_id, teamId))
    .orderBy(desc(schema.team_memberships.created_at));
  return rows as TeamMember[];
}

export async function getTeamInvites(teamId: string): Promise<TeamInvite[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: schema.team_invites.id,
      team_id: schema.team_invites.team_id,
      email: schema.team_invites.email,
      role: schema.team_invites.role,
      invited_by: schema.team_invites.invited_by,
      invited_by_name: schema.users.name,
      token: schema.team_invites.token,
      expires_at: schema.team_invites.expires_at,
      accepted_at: schema.team_invites.accepted_at,
      created_at: schema.team_invites.created_at,
    })
    .from(schema.team_invites)
    .leftJoin(schema.users, eq(schema.team_invites.invited_by, schema.users.id))
    .where(and(
      eq(schema.team_invites.team_id, teamId),
      sql`${schema.team_invites.accepted_at} IS NULL`,
      sql`${schema.team_invites.expires_at} > ${Date.now()}`
    ))
    .orderBy(desc(schema.team_invites.created_at));
  return rows.map(row => ({
    ...row,
    status: 'pending',
  })) as TeamInvite[];
}

export async function insertTeamInvite(invite: Omit<TeamInvite, 'created_at'>): Promise<void> {
  const db = await getDb();
  await db.insert(schema.team_invites).values({
    ...invite,
    created_at: Date.now(),
  });
}

export async function getInviteByToken(token: string): Promise<TeamInvite | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.team_invites)
    .where(and(
      eq(schema.team_invites.token, token),
      sql`${schema.team_invites.expires_at} > ${Date.now()}`,
      sql`${schema.team_invites.accepted_at} IS NULL`
    ))
    .limit(1);
  return rows.length ? rows[0] as TeamInvite : null;
}

export async function acceptInvite(token: string, userId: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  
  await db.transaction(async (tx) => {
    const invite = await tx
      .select()
      .from(schema.team_invites)
      .where(eq(schema.team_invites.token, token))
      .limit(1);
    
    if (invite.length === 0) {
      throw new Error('Invite not found or expired');
    }
    
    // Add user to team
    await tx.insert(schema.team_memberships).values({
      id: crypto.randomUUID(),
      user_id: userId,
      team_id: invite[0].team_id,
      role: invite[0].role,
      created_at: now,
    });
    
    // Mark invite as accepted
    await tx
      .update(schema.team_invites)
      .set({ accepted_at: now })
      .where(eq(schema.team_invites.id, invite[0].id));
  });
}

export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  const db = await getDb();
  await db
    .delete(schema.team_memberships)
    .where(and(
      eq(schema.team_memberships.team_id, teamId),
      eq(schema.team_memberships.user_id, userId)
    ));
}

export async function updateTeamMemberRole(teamId: string, userId: string, role: TeamRole): Promise<void> {
  const db = await getDb();
  await db
    .update(schema.team_memberships)
    .set({ role })
    .where(and(
      eq(schema.team_memberships.team_id, teamId),
      eq(schema.team_memberships.user_id, userId)
    ));
}

// Post Comments
export async function getPostComments(postId: string): Promise<PostComment[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: schema.post_comments.id,
      post_id: schema.post_comments.post_id,
      user_id: schema.post_comments.user_id,
      user_name: schema.users.name,
      content: schema.post_comments.content,
      mentions: schema.post_comments.mentions,
      created_at: schema.post_comments.created_at,
      updated_at: schema.post_comments.updated_at,
    })
    .from(schema.post_comments)
    .innerJoin(schema.users, eq(schema.post_comments.user_id, schema.users.id))
    .where(eq(schema.post_comments.post_id, postId))
    .orderBy(desc(schema.post_comments.created_at));
  
  return rows.map(row => ({
    ...row,
    mentions: JSON.parse(row.mentions as string),
  })) as PostComment[];
}

export async function insertPostComment(comment: Omit<PostComment, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  
  await db.insert(schema.post_comments).values({
    ...comment,
    id,
    mentions: JSON.stringify(comment.mentions || []),
    created_at: now,
    updated_at: now,
  });
  
  return id;
}

export async function deletePostComment(id: string, userId: string): Promise<void> {
  const db = await getDb();
  await db
    .delete(schema.post_comments)
    .where(and(
      eq(schema.post_comments.id, id),
      eq(schema.post_comments.user_id, userId)
    ));
}

// Post Approvals
export async function getPostApproval(postId: string): Promise<PostApproval | null> {
  const db = await getDb();
  const rows = await db
    .select({
      id: schema.post_approvals.id,
      post_id: schema.post_approvals.post_id,
      requested_by: schema.post_approvals.requested_by,
      requested_by_name: schema.users.name,
      reviewed_by: schema.post_approvals.reviewed_by,
      reviewed_by_name: sql`SELECT name FROM users WHERE id = ${schema.post_approvals.reviewed_by}`,
      status: schema.post_approvals.status,
      notes: schema.post_approvals.notes,
      snapshot_hash: schema.post_approvals.snapshot_hash,
      snapshot_json: schema.post_approvals.snapshot_json,
      callback_token: schema.post_approvals.callback_token,
      telegram_message_id: schema.post_approvals.telegram_message_id,
      telegram_user_id: schema.post_approvals.telegram_user_id,
      decision_source: schema.post_approvals.decision_source,
      sent_at: schema.post_approvals.sent_at,
      requested_at: schema.post_approvals.requested_at,
      reviewed_at: schema.post_approvals.reviewed_at,
    })
    .from(schema.post_approvals)
    .innerJoin(schema.users, eq(schema.post_approvals.requested_by, schema.users.id))
    .where(and(
      eq(schema.post_approvals.post_id, postId),
      isNull(schema.post_approvals.snapshot_json),
    ))
    .orderBy(desc(schema.post_approvals.requested_at))
    .limit(1);
  
  return rows.length ? rows[0] as PostApproval : null;
}

export async function requestApproval(postId: string, userId: string): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  
  await db.insert(schema.post_approvals).values({
    id,
    post_id: postId,
    requested_by: userId,
    reviewed_by: null,
    status: 'pending',
    notes: null,
    requested_at: now,
    reviewed_at: null,
  });
  
  return id;
}

export async function reviewApproval(
  approvalId: string, 
  userId: string, 
  status: PostApprovalStatus, 
  notes?: string
): Promise<void> {
  const db = await getDb();
  await db
    .update(schema.post_approvals)
    .set({
      reviewed_by: userId,
      status,
      notes: notes || null,
      reviewed_at: Date.now(),
    })
    .where(and(
      eq(schema.post_approvals.id, approvalId),
      isNull(schema.post_approvals.snapshot_json),
    ));
}

// Templates Library (Issue #11)
export async function getTemplatesLibrary(teamId: string): Promise<PostTemplateLibrary[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.post_templates_library)
    .where(eq(schema.post_templates_library.team_id, teamId))
    .orderBy(desc(schema.post_templates_library.is_favorite), desc(schema.post_templates_library.created_at));
  
  return rows.map(row => ({
    ...row,
    platform_variants: JSON.parse(row.platform_variants as string),
  })) as PostTemplateLibrary[];
}

export async function getTemplateById(id: string, teamId: string): Promise<PostTemplateLibrary | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.post_templates_library)
    .where(and(
      eq(schema.post_templates_library.id, id),
      eq(schema.post_templates_library.team_id, teamId)
    ))
    .limit(1);
  
  if (!rows.length) return null;
  const row = rows[0];
  return {
    ...row,
    platform_variants: JSON.parse(row.platform_variants as string),
  } as PostTemplateLibrary;
}

export async function insertTemplateLibrary(template: Omit<PostTemplateLibrary, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  
  await db.insert(schema.post_templates_library).values({
    ...template,
    id,
    platform_variants: JSON.stringify(template.platform_variants || {}),
    created_at: now,
    updated_at: now,
  });
  
  return id;
}

export async function updateTemplateLibrary(id: string, teamId: string, updates: Partial<Omit<PostTemplateLibrary, 'id' | 'team_id' | 'created_at'>>): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  const updateData: Record<string, unknown> = { ...updates, updated_at: now };
  
  if (updates.platform_variants) {
    updateData.platform_variants = JSON.stringify(updates.platform_variants);
  }
  
  await db
    .update(schema.post_templates_library)
    .set(updateData)
    .where(and(
      eq(schema.post_templates_library.id, id),
      eq(schema.post_templates_library.team_id, teamId)
    ));
}

export async function deleteTemplateLibrary(id: string, teamId: string): Promise<void> {
  const db = await getDb();
  await db
    .delete(schema.post_templates_library)
    .where(and(
      eq(schema.post_templates_library.id, id),
      eq(schema.post_templates_library.team_id, teamId)
    ));
}

export async function incrementTemplateUsage(id: string): Promise<void> {
  const db = await getDb();
  const template = await db
    .select({ usage_count: schema.post_templates_library.usage_count })
    .from(schema.post_templates_library)
    .where(eq(schema.post_templates_library.id, id))
    .limit(1);
  
  if (template.length > 0) {
    await db
      .update(schema.post_templates_library)
      .set({ usage_count: (template[0].usage_count || 0) + 1 })
      .where(eq(schema.post_templates_library.id, id));
  }
}

// Best Time Predictions (Issue #12)
export async function getBestTimePredictions(teamId: string, platform?: string): Promise<BestTimePrediction[]> {
  const db = await getDb();
  const conditions = [eq(schema.best_time_predictions.team_id, teamId)];
  if (platform) {
    conditions.push(eq(schema.best_time_predictions.platform, platform));
  }

  const rows = await db
    .select()
    .from(schema.best_time_predictions)
    .where(and(...conditions))
    .orderBy(desc(schema.best_time_predictions.calculated_at));
  return rows as BestTimePrediction[];
}

export async function insertBestTimePrediction(prediction: Omit<BestTimePrediction, 'id'>): Promise<void> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.insert(schema.best_time_predictions).values({
    ...prediction,
    id,
  });
}

export async function insertPostingTimeAnalytics(analytics: Omit<PostingTimeAnalytics, 'id' | 'created_at'>): Promise<void> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.insert(schema.posting_time_analytics).values({
    ...analytics,
    id,
    created_at: Date.now(),
  });
}
