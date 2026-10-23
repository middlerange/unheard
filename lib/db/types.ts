// ABOUTME: Shared TypeScript interfaces and types for the database layer.
// ABOUTME: This file is safe to import on both client and server.

import type { PlatformId } from '@/lib/platforms';

// Auth types
export interface User {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  auto_publish: boolean;
  is_admin: boolean;
  created_at: number;
  updated_at: number;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  created_at: number;
  updated_at: number;
}

export interface TeamMembership {
  id: string;
  user_id: string;
  team_id: string;
  role: 'owner' | 'admin' | 'member';
  created_at: number;
}

export interface ApiKey {
  id: string;
  team_id: string;
  created_by: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  last_used_at: number | null;
  revoked_at: number | null;
  created_at: number;
}

export interface ApiKeyView {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: number | null;
  revoked_at: number | null;
  created_at: number;
}

export interface TeamMember {
  user_id: string;
  user_name: string | null;
  user_email: string;
  role: TeamRole;
  joined_at: number;
}

export interface AuthSession {
  userId?: string;
  teamId?: string;
  email?: string;
  isAdmin?: boolean;
  twitterConnect?: TwitterConnectDraft | null;
  redditConnect?: RedditConnectDraft | null;
  linkedinConnect?: LinkedInConnectDraft | null;
  metaConnect?: MetaConnectDraft | null;
  youtubeConnect?: YouTubeConnectDraft | null;
}

import type { TwitterConnectDraft } from '@/lib/twitter-connect';
import type { RedditConnectDraft } from '@/lib/reddit-connect';
import type { LinkedInConnectDraft, MetaConnectDraft, YouTubeConnectDraft } from '@/lib/social-connect';

export type PostState = 'draft' | 'scheduled' | 'awaiting_approval' | 'publishing' | 'published' | 'failed';
export type Platform = PlatformId;
export type ChannelGroup = 'personal' | 'company';

export interface Post {
  id: string;
  team_id: string;
  state: PostState;
  channel_group: string | null; // Now flexible - can be any custom group name
  idea_id: string | null;
  template_id: string | null;
  brand_id: string | null;
  writing_prompt: string | null;
  publish_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface PostTarget {
  id: string;
  post_id: string;
  channel_id: string | null;
  channel_name?: string | null;
  channel_account_id?: string | null;
  channel_account_type?: string | null;
  platform: Platform;
  content: string;
  platform_post_id: string | null;
  publication_progress?: string | null;
  error: string | null;
  reply_settings: string;
  as_carousel: boolean;
  carousel_name: string | null;
  thread: string[] | null;
  reddit_title?: string | null;
  subreddit?: string | null;
  reddit_post_type?: 'self' | 'link' | null;
  reddit_url?: string | null;
  flair_id?: string | null;
  nsfw?: boolean | null;
  spoiler?: boolean | null;
}

export interface Media {
  id: string;
  post_id: string;
  target_id: string | null; // null = shared across all platforms
  filename: string;
  path: string;
  url: string;
  type: 'image' | 'video';
}

export interface PostWithDetails extends Post {
  targets: PostTarget[];
  media: Media[];
  template_name: string | null;
  brand_name: string | null;
  idea_text: string | null;
}

export interface Idea {
  id: string;
  team_id: string;
  text: string;
  status: 'open' | 'closed';
  created_at: number;
  updated_at: number;
}

export interface Template {
  id: string;
  team_id: string;
  name: string;
  slug: string;
  category: string;
  content: string;
  created_at: number;
  updated_at: number;
}

export interface IdeaConversation {
  idea_id: string;
  messages: string;
  updated_at: number;
}

export interface IdeaComment {
  id: string;
  idea_id: string;
  user_id: string;
  content: string;
  suggested_text: string | null;
  is_applied: boolean;
  applied_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface BrandProfile {
  id: string;
  team_id: string;
  name: string;
  voice: string;
  audience: string;
  writing_prompt: string;
  is_default: boolean;
  created_at: number;
  updated_at: number;
}

export interface Channel {
  id: string;
  team_id: string;
  name: string;
  platform: Platform;
  account_type: 'personal' | 'company' | 'page'; // page = company page on LinkedIn
  is_default: boolean;
  group_name: string | null; // Optional custom group for organization
  account_id?: string | null; // Platform handle/ID
  credentials: string;
  created_at: number;
}

// RSS Feed (Issue #7)
export type RssFeedStatus = 'active' | 'paused' | 'error';
export type RssFeedType = 'rss' | 'atom' | 'youtube' | 'podcast';
export type RssFeedFrequency = '15m' | '1h' | '6h' | '24h';

export interface RssFeed {
  id: string;
  team_id: string;
  name: string;
  url: string;
  feed_type: RssFeedType;
  status: RssFeedStatus;
  last_fetched_at: number | null;
  last_item_hash: string | null;
  fetch_frequency: RssFeedFrequency;
  post_template: string;
  target_platforms: string[];
  target_channels: string[];
  filter_keywords: string | null;
  created_at: number;
  updated_at: number;
}

export type RssFeedItemStatus = 'pending' | 'posted' | 'filtered' | 'error';

export interface RssFeedItem {
  id: string;
  feed_id: string;
  item_hash: string;
  title: string;
  link: string;
  description: string | null;
  published_at: number | null;
  processed_at: number | null;
  post_id: string | null;
  status: RssFeedItemStatus;
  error_message: string | null;
}

// Webhooks (Issue #8)
export type WebhookStatus = 'active' | 'paused' | 'error';
export type WebhookEvent = 'post.created' | 'post.scheduled' | 'post.published' | 'post.failed' | 'post.deleted' | 'media.uploaded';

export interface Webhook {
  id: string;
  team_id: string;
  name: string;
  url: string;
  secret?: string;
  events: WebhookEvent[];
  status: WebhookStatus;
  headers: Record<string, string>;
  created_at: number;
  updated_at: number;
}

export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed';

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event_type: WebhookEvent;
  payload: string;
  signature: string;
  status: WebhookDeliveryStatus;
  response_status: number | null;
  response_body: string | null;
  attempt_count: number;
  next_retry_at: number | null;
  delivered_at: number | null;
  created_at: number;
}

// Team Collaboration (Issue #9)
export type TeamRole = 'owner' | 'admin' | 'editor' | 'viewer';
export type PostApprovalStatus = 'pending' | 'approved' | 'rejected' | 'changes_requested';

export interface PostComment {
  id: string;
  post_id: string;
  user_id: string;
  user_name?: string;
  content: string;
  mentions: string[];
  created_at: number;
  updated_at: number;
}

export interface PostApproval {
  id: string;
  post_id: string;
  requested_by: string;
  requested_by_name?: string;
  reviewed_by: string | null;
  reviewed_by_name?: string;
  status: PostApprovalStatus;
  notes: string | null;
  snapshot_hash: string | null;
  snapshot_json: string | null;
  callback_token: string | null;
  telegram_message_id: number | null;
  telegram_user_id: string | null;
  decision_source: string | null;
  sent_at: number | null;
  requested_at: number;
  reviewed_at: number | null;
}

export interface TeamInvite {
  id: string;
  team_id: string;
  email: string;
  role: TeamRole;
  invited_by: string;
  invited_by_name?: string | null;
  token: string;
  expires_at: number;
  accepted_at: number | null;
  status?: 'pending' | 'accepted' | 'expired';
  created_at: number;
}

// Templates Library (Issue #11)
export type TemplateCategory = 'launch' | 'feature' | 'testimonial' | 'milestone' | 'tutorial' | 'engagement' | 'other';

export interface PostTemplateLibrary {
  id: string;
  team_id: string;
  name: string;
  category: TemplateCategory;
  description: string | null;
  content_template: string;
  platform_variants: Record<string, string>;
  ai_prompt: string | null;
  is_favorite: boolean;
  usage_count: number;
  created_at: number;
  updated_at: number;
}

// Best Time to Post (Issue #12)
export interface BestTimePrediction {
  id: string;
  team_id: string;
  platform: string;
  channel_id: string | null;
  day_of_week: number; // 0-6 (Sun-Sat)
  hour_of_day: number; // 0-23
  score: number; // 0-100 engagement prediction
  confidence: number; // 0-100 confidence level
  calculated_at: number;
}

export interface PostingTimeAnalytics {
  id: string;
  team_id: string;
  platform: string;
  post_id: string;
  scheduled_hour: number;
  day_of_week: number;
  engagement_rate: number | null;
  created_at: number;
}
