// ABOUTME: Drizzle ORM table definitions for posts, targets, media, ideas, templates, brand profiles, users, and teams.
// ABOUTME: Single source of truth for the database schema.

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Users and Teams (Auth)
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  name: text('name'),
  auto_publish: integer('auto_publish', { mode: 'boolean' }).notNull().default(false),
  is_admin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  created_at: integer('created_at', { mode: 'number' }).notNull(),
  updated_at: integer('updated_at', { mode: 'number' }).notNull(),
});

export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  created_at: integer('created_at', { mode: 'number' }).notNull(),
  updated_at: integer('updated_at', { mode: 'number' }).notNull(),
});

export const team_memberships = sqliteTable('team_memberships', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  team_id: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('owner'), // 'owner', 'admin', 'member'
  created_at: integer('created_at', { mode: 'number' }).notNull(),
});

export const api_keys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  team_id: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  created_by: text('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  key_hash: text('key_hash').notNull().unique(),
  key_prefix: text('key_prefix').notNull(),
  last_used_at: integer('last_used_at', { mode: 'number' }),
  revoked_at: integer('revoked_at', { mode: 'number' }),
  created_at: integer('created_at', { mode: 'number' }).notNull(),
});

export const oauth_clients = sqliteTable('oauth_clients', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  redirect_uris: text('redirect_uris').notNull(),
  client_uri: text('client_uri'),
  logo_uri: text('logo_uri'),
  created_at: integer('created_at', { mode: 'number' }).notNull(),
});

export const oauth_authorization_requests = sqliteTable('oauth_authorization_requests', {
  id: text('id').primaryKey(),
  request_token_hash: text('request_token_hash').notNull().unique(),
  client_id: text('client_id').notNull().references(() => oauth_clients.id, { onDelete: 'cascade' }),
  scope: text('scope').notNull(),
  redirect_uri: text('redirect_uri').notNull(),
  state: text('state'),
  code_challenge: text('code_challenge').notNull(),
  resource: text('resource').notNull(),
  expires_at: integer('expires_at', { mode: 'number' }).notNull(),
  consumed_at: integer('consumed_at', { mode: 'number' }),
  created_at: integer('created_at', { mode: 'number' }).notNull(),
});

export const oauth_authorization_codes = sqliteTable('oauth_authorization_codes', {
  id: text('id').primaryKey(),
  code_hash: text('code_hash').notNull().unique(),
  client_id: text('client_id').notNull().references(() => oauth_clients.id, { onDelete: 'cascade' }),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  team_id: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  scope: text('scope').notNull(),
  redirect_uri: text('redirect_uri').notNull(),
  code_challenge: text('code_challenge').notNull(),
  resource: text('resource').notNull(),
  expires_at: integer('expires_at', { mode: 'number' }).notNull(),
  consumed_at: integer('consumed_at', { mode: 'number' }),
  created_at: integer('created_at', { mode: 'number' }).notNull(),
});

export const oauth_tokens = sqliteTable('oauth_tokens', {
  id: text('id').primaryKey(),
  access_token_hash: text('access_token_hash').notNull().unique(),
  refresh_token_hash: text('refresh_token_hash').notNull().unique(),
  client_id: text('client_id').notNull().references(() => oauth_clients.id, { onDelete: 'cascade' }),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  team_id: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  scope: text('scope').notNull(),
  resource: text('resource').notNull(),
  access_expires_at: integer('access_expires_at', { mode: 'number' }).notNull(),
  refresh_expires_at: integer('refresh_expires_at', { mode: 'number' }).notNull(),
  last_used_at: integer('last_used_at', { mode: 'number' }),
  revoked_at: integer('revoked_at', { mode: 'number' }),
  created_at: integer('created_at', { mode: 'number' }).notNull(),
});

// All existing tables now have team_id for multi-tenant isolation
export const posts = sqliteTable('posts', {
  id: text('id').primaryKey(),
  team_id: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  state: text('state').notNull().default('draft'),
  channel_group: text('channel_group').notNull().default('personal'),
  idea_id: text('idea_id').references(() => ideas.id, { onDelete: 'set null' }),
  template_id: text('template_id').references(() => templates.id, { onDelete: 'set null' }),
  brand_id: text('brand_id'),
  writing_prompt: text('writing_prompt'),
  publish_at: integer('publish_at', { mode: 'number' }),
  created_at: integer('created_at', { mode: 'number' }).notNull(),
  updated_at: integer('updated_at', { mode: 'number' }).notNull(),
});

export const post_targets = sqliteTable('post_targets', {
  id: text('id').primaryKey(),
  post_id: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  channel_id: text('channel_id').references(() => channels.id, { onDelete: 'set null' }),
  platform: text('platform').notNull(),
  content: text('content').notNull().default(''),
  platform_post_id: text('platform_post_id'),
  error: text('error'),
  reply_settings: text('reply_settings').default('everyone'),
  as_carousel: integer('as_carousel', { mode: 'boolean' }).default(false),
  carousel_name: text('carousel_name'),
  thread: text('thread'),
  reddit_title: text('reddit_title'),
  subreddit: text('subreddit'),
  reddit_post_type: text('reddit_post_type'),
  reddit_url: text('reddit_url'),
  flair_id: text('flair_id'),
  nsfw: integer('nsfw', { mode: 'boolean' }).default(false),
  spoiler: integer('spoiler', { mode: 'boolean' }).default(false),
});

export const media = sqliteTable('media', {
  id: text('id').primaryKey(),
  post_id: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  target_id: text('target_id').references(() => post_targets.id, { onDelete: 'cascade' }), // null = shared across all targets
  filename: text('filename').notNull(),
  path: text('path').notNull(),
  url: text('url').notNull().default(''),
  type: text('type').notNull(),
});

export const ideas = sqliteTable('ideas', {
  id: text('id').primaryKey(),
  team_id: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  text: text('text').notNull().default(''),
  status: text('status').notNull().default('open'),
  created_at: integer('created_at', { mode: 'number' }).notNull(),
  updated_at: integer('updated_at', { mode: 'number' }).notNull(),
});

export const templates = sqliteTable('templates', {
  id: text('id').primaryKey(),
  team_id: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  category: text('category').notNull(),
  content: text('content').notNull(),
  created_at: integer('created_at', { mode: 'number' }).notNull(),
  updated_at: integer('updated_at', { mode: 'number' }).notNull(),
});

export const idea_conversations = sqliteTable('idea_conversations', {
  idea_id: text('idea_id').primaryKey().references(() => ideas.id, { onDelete: 'cascade' }),
  messages: text('messages').notNull().default('[]'),
  updated_at: integer('updated_at', { mode: 'number' }).notNull(),
});

export type IdeaConversation = typeof idea_conversations.$inferSelect;

// Idea Comments/Variations (for collaborative idea refinement)
export const idea_comments = sqliteTable('idea_comments', {
  id: text('id').primaryKey(),
  idea_id: text('idea_id').notNull().references(() => ideas.id, { onDelete: 'cascade' }),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  suggested_text: text('suggested_text'), // Optional suggested change to apply to idea
  is_applied: integer('is_applied', { mode: 'boolean' }).notNull().default(false),
  applied_at: integer('applied_at', { mode: 'number' }),
  created_at: integer('created_at', { mode: 'number' }).notNull(),
  updated_at: integer('updated_at', { mode: 'number' }).notNull(),
});

export type IdeaComment = typeof idea_comments.$inferSelect;

export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),
  team_id: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  platform: text('platform').notNull(),
  account_type: text('account_type').notNull().default('personal'), // 'personal', 'company', 'page'
  is_default: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  group_name: text('group_name'), // Made optional - for organizing accounts into custom groups
  account_id: text('account_id'), // Platform-specific account identifier (e.g., Twitter handle, LinkedIn ID)
  credentials: text('credentials').notNull().default('{}'),
  created_at: integer('created_at', { mode: 'number' }).notNull(),
});

export const waitlist = sqliteTable('waitlist', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  handle: text('handle'),
  created_at: integer('created_at', { mode: 'number' }).notNull(),
});

export const brand_profiles = sqliteTable('brand_profiles', {
  id: text('id').primaryKey(),
  team_id: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  voice: text('voice').notNull().default(''),
  audience: text('audience').notNull().default(''),
  writing_prompt: text('writing_prompt').notNull().default(''),
  is_default: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  created_at: integer('created_at', { mode: 'number' }).notNull(),
  updated_at: integer('updated_at', { mode: 'number' }).notNull(),
});

// Analytics table for tracking post performance metrics
export const analytics = sqliteTable('analytics', {
  id: text('id').primaryKey(),
  post_id: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  target_id: text('target_id').notNull().references(() => post_targets.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  impressions: integer('impressions', { mode: 'number' }).notNull().default(0),
  engagements: integer('engagements', { mode: 'number' }).notNull().default(0),
  likes: integer('likes', { mode: 'number' }).notNull().default(0),
  comments: integer('comments', { mode: 'number' }).notNull().default(0),
  shares: integer('shares', { mode: 'number' }).notNull().default(0),
  clicks: integer('clicks', { mode: 'number' }).notNull().default(0),
  recorded_at: integer('recorded_at', { mode: 'number' }).notNull(),
});

// RSS Feed Auto-Posting (Issue #7)
export const rss_feeds = sqliteTable('rss_feeds', {
  id: text('id').primaryKey(),
  team_id: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  feed_type: text('feed_type').notNull().default('rss'), // 'rss', 'atom', 'youtube', 'podcast'
  status: text('status').notNull().default('active'), // 'active', 'paused', 'error'
  last_fetched_at: integer('last_fetched_at', { mode: 'number' }),
  last_item_hash: text('last_item_hash'), // Hash of last processed item for deduplication
  fetch_frequency: text('fetch_frequency').notNull().default('1h'), // '15m', '1h', '6h', '24h'
  post_template: text('post_template').notNull().default('{{title}} {{link}}'), // Template for auto-generated posts
  target_platforms: text('target_platforms').notNull().default('[]'), // JSON array of platform IDs
  target_channels: text('target_channels').notNull().default('[]'), // JSON array of channel IDs
  filter_keywords: text('filter_keywords').default(''), // Comma-separated keywords to filter
  created_at: integer('created_at', { mode: 'number' }).notNull(),
  updated_at: integer('updated_at', { mode: 'number' }).notNull(),
});

export const rss_feed_items = sqliteTable('rss_feed_items', {
  id: text('id').primaryKey(),
  feed_id: text('feed_id').notNull().references(() => rss_feeds.id, { onDelete: 'cascade' }),
  item_hash: text('item_hash').notNull(), // SHA256 hash for deduplication
  title: text('title').notNull(),
  link: text('link').notNull(),
  description: text('description'),
  published_at: integer('published_at', { mode: 'number' }),
  processed_at: integer('processed_at', { mode: 'number' }),
  post_id: text('post_id').references(() => posts.id, { onDelete: 'set null' }), // Link to created post
  status: text('status').notNull().default('pending'), // 'pending', 'posted', 'filtered', 'error'
  error_message: text('error_message'),
});

// Webhook Integration (Issue #8)
export const webhooks = sqliteTable('webhooks', {
  id: text('id').primaryKey(),
  team_id: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  secret: text('secret').notNull(), // For HMAC signature
  events: text('events').notNull().default('[]'), // JSON array: ['post.created', 'post.published', etc.]
  status: text('status').notNull().default('active'), // 'active', 'paused', 'error'
  headers: text('headers').default('{}'), // JSON object of custom headers
  created_at: integer('created_at', { mode: 'number' }).notNull(),
  updated_at: integer('updated_at', { mode: 'number' }).notNull(),
});

export const webhook_deliveries = sqliteTable('webhook_deliveries', {
  id: text('id').primaryKey(),
  webhook_id: text('webhook_id').notNull().references(() => webhooks.id, { onDelete: 'cascade' }),
  event_type: text('event_type').notNull(),
  payload: text('payload').notNull(), // JSON payload
  signature: text('signature').notNull(), // HMAC-SHA256 signature
  status: text('status').notNull().default('pending'), // 'pending', 'delivered', 'failed'
  response_status: integer('response_status', { mode: 'number' }), // HTTP status code
  response_body: text('response_body'), // Response from webhook endpoint
  attempt_count: integer('attempt_count', { mode: 'number' }).notNull().default(0),
  next_retry_at: integer('next_retry_at', { mode: 'number' }),
  delivered_at: integer('delivered_at', { mode: 'number' }),
  created_at: integer('created_at', { mode: 'number' }).notNull(),
});

// Team Collaboration (Issue #9)
export const post_comments = sqliteTable('post_comments', {
  id: text('id').primaryKey(),
  post_id: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  mentions: text('mentions').default('[]'), // JSON array of mentioned user IDs
  created_at: integer('created_at', { mode: 'number' }).notNull(),
  updated_at: integer('updated_at', { mode: 'number' }).notNull(),
});

export const post_approvals = sqliteTable('post_approvals', {
  id: text('id').primaryKey(),
  post_id: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  requested_by: text('requested_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  reviewed_by: text('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('pending'), // 'pending', 'approved', 'rejected', 'changes_requested'
  notes: text('notes'),
  snapshot_hash: text('snapshot_hash'),
  snapshot_json: text('snapshot_json'),
  callback_token: text('callback_token'),
  telegram_message_id: integer('telegram_message_id', { mode: 'number' }),
  telegram_user_id: text('telegram_user_id'),
  decision_source: text('decision_source'),
  sent_at: integer('sent_at', { mode: 'number' }),
  requested_at: integer('requested_at', { mode: 'number' }).notNull(),
  reviewed_at: integer('reviewed_at', { mode: 'number' }),
});

export const team_invites = sqliteTable('team_invites', {
  id: text('id').primaryKey(),
  team_id: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role').notNull().default('editor'), // 'owner', 'admin', 'editor', 'viewer'
  invited_by: text('invited_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(), // Invite token
  expires_at: integer('expires_at', { mode: 'number' }).notNull(),
  accepted_at: integer('accepted_at', { mode: 'number' }),
  created_at: integer('created_at', { mode: 'number' }).notNull(),
});

// Telegram Platform Support (Issue #10)
export const telegram_channels = sqliteTable('telegram_channels', {
  id: text('id').primaryKey(),
  team_id: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  channel_id: text('channel_id').notNull(), // Telegram channel/chat ID
  name: text('name').notNull(),
  bot_token: text('bot_token').notNull(),
  thread_id: text('thread_id'), // For threaded groups
  created_at: integer('created_at', { mode: 'number' }).notNull(),
});

// Post Templates Library (Issue #11)
export const post_templates_library = sqliteTable('post_templates_library', {
  id: text('id').primaryKey(),
  team_id: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  category: text('category').notNull(), // 'launch', 'feature', 'testimonial', 'milestone', 'tutorial', 'engagement', 'other'
  description: text('description'),
  content_template: text('content_template').notNull(), // The template with placeholders
  platform_variants: text('platform_variants').default('{}'), // JSON object with platform-specific variations
  ai_prompt: text('ai_prompt'), // Optional AI prompt to fill template
  is_favorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
  usage_count: integer('usage_count', { mode: 'number' }).notNull().default(0),
  created_at: integer('created_at', { mode: 'number' }).notNull(),
  updated_at: integer('updated_at', { mode: 'number' }).notNull(),
});

// AI Best Time to Post (Issue #12)
export const best_time_predictions = sqliteTable('best_time_predictions', {
  id: text('id').primaryKey(),
  team_id: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  channel_id: text('channel_id').references(() => channels.id, { onDelete: 'cascade' }),
  day_of_week: integer('day_of_week', { mode: 'number' }).notNull(), // 0-6 (Sun-Sat)
  hour_of_day: integer('hour_of_day', { mode: 'number' }).notNull(), // 0-23
  score: integer('score', { mode: 'number' }).notNull(), // 0-100 engagement prediction score
  confidence: integer('confidence', { mode: 'number' }).notNull(), // 0-100 confidence level
  calculated_at: integer('calculated_at', { mode: 'number' }).notNull(),
});

export const posting_time_analytics = sqliteTable('posting_time_analytics', {
  id: text('id').primaryKey(),
  team_id: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  post_id: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  scheduled_hour: integer('scheduled_hour', { mode: 'number' }).notNull(),
  day_of_week: integer('day_of_week', { mode: 'number' }).notNull(),
  engagement_rate: integer('engagement_rate', { mode: 'number' }), // Calculated engagement rate
  created_at: integer('created_at', { mode: 'number' }).notNull(),
});
