// ABOUTME: RSS Feed Auto-Posting server functions (Issue #7)
// ABOUTME: Fetch RSS feeds, detect new items, auto-create posts

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { eq, and, desc, isNull, lte } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/schema';
import { getCurrentUser, requireAuth } from '@/app/server-fns/auth';
import { createPost } from '@/app/server-fns/posts';
import type { RssFeed, RssFeedItem } from '@/lib/db/types';
import { decrypt } from '@/lib/crypto';
import { buildRedditArticleTarget } from '@/lib/reddit-target';

// Feed input validation
const createFeedSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  feedType: z.enum(['rss', 'atom', 'youtube', 'podcast']).default('rss'),
  fetchFrequency: z.enum(['15m', '1h', '6h', '24h']).default('1h'),
  postTemplate: z.string().default('{{title}} {{link}}'),
  targetPlatforms: z.array(z.string()).default([]),
  targetChannels: z.array(z.string()).default([]),
  filterKeywords: z.string().optional(),
});

const updateFeedSchema = createFeedSchema.partial().extend({
  status: z.enum(['active', 'paused', 'error']).optional(),
});

// Hash function for deduplication
async function hashItem(link: string, title: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${link}:${title}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Parse RSS/Atom feed
async function parseFeed(url: string, feedType: string): Promise<Array<{
  title: string;
  link: string;
  description: string;
  publishedAt: Date;
}>> {
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      'User-Agent': 'Unheard RSS Bot/1.0',
    },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch feed: ${response.status} ${response.statusText}`);
  }
  
  const xmlText = await response.text();
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
  
  const items: Array<{
    title: string;
    link: string;
    description: string;
    publishedAt: Date;
  }> = [];
  
  // Parse RSS 2.0
  const rssItems = xmlDoc.querySelectorAll('item');
  rssItems.forEach(item => {
    const title = item.querySelector('title')?.textContent?.trim() || '';
    const link = item.querySelector('link')?.textContent?.trim() || '';
    const description = item.querySelector('description, content\\:encoded')?.textContent?.trim() || '';
    const pubDate = item.querySelector('pubDate')?.textContent;
    
    if (title && link) {
      items.push({
        title,
        link,
        description,
        publishedAt: pubDate ? new Date(pubDate) : new Date(),
      });
    }
  });
  
  // Parse Atom
  if (items.length === 0) {
    const atomEntries = xmlDoc.querySelectorAll('entry');
    atomEntries.forEach(entry => {
      const title = entry.querySelector('title')?.textContent?.trim() || '';
      const link = entry.querySelector('link')?.getAttribute('href') || '';
      const description = entry.querySelector('summary, content')?.textContent?.trim() || '';
      const published = entry.querySelector('published, updated')?.textContent;
      
      if (title && link) {
        items.push({
          title,
          link,
          description,
          publishedAt: published ? new Date(published) : new Date(),
        });
      }
    });
  }
  
  return items;
}

// Generate post content from template
function generatePostContent(template: string, item: {
  title: string;
  link: string;
  description: string;
}): string {
  return template
    .replace(/\{\{\s*title\s*\}\}/g, item.title)
    .replace(/\{\{\s*link\s*\}\}/g, item.link)
    .replace(/\{\{\s*description\s*\}\}/g, item.description.slice(0, 280));
}

// Check if item matches filter keywords
function matchesFilter(item: {
  title: string;
  link: string;
  description: string;
}, keywords: string): boolean {
  if (!keywords.trim()) return true;
  
  const keywordList = keywords.split(',').map(k => k.trim().toLowerCase());
  const text = `${item.title} ${item.description}`.toLowerCase();
  
  return keywordList.some(keyword => text.includes(keyword));
}

// Create RSS feed
export const createRssFeed = createServerFn({ method: 'POST' })
  .inputValidator(createFeedSchema)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    // Get user's team
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      throw new Error('User not associated with a team');
    }
    
    const teamId = membership[0].teamId;
    const now = Date.now();
    const feedId = crypto.randomUUID();
    
    // Test feed URL before saving
    try {
      const items = await parseFeed(data.url, data.feedType);
      console.log(`[RSS] Feed test successful: ${items.length} items found`);
    } catch (e) {
      console.warn('[RSS] Feed test failed:', e);
      // Continue anyway - feed might be temporarily down
    }
    
    await db.insert(schema.rss_feeds).values({
      id: feedId,
      team_id: teamId,
      name: data.name,
      url: data.url,
      feed_type: data.feedType,
      status: 'active',
      fetch_frequency: data.fetchFrequency,
      post_template: data.postTemplate,
      target_platforms: JSON.stringify(data.targetPlatforms),
      target_channels: JSON.stringify(data.targetChannels),
      filter_keywords: data.filterKeywords || '',
      created_at: now,
      updated_at: now,
    });
    
    return {
      id: feedId,
      message: 'RSS feed created successfully',
    };
  });

// List RSS feeds
export const listRssFeeds = createServerFn({ method: 'GET' })
  .handler(async (): Promise<RssFeed[]> => {
    const user = await requireAuth();
    const db = await getDb();
    
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      return [];
    }
    
    const feeds = await db
      .select()
      .from(schema.rss_feeds)
      .where(eq(schema.rss_feeds.team_id, membership[0].teamId))
      .orderBy(desc(schema.rss_feeds.created_at));
    
    return feeds.map(feed => ({
      ...feed,
      feed_type: feed.feed_type as RssFeed['feed_type'],
      status: feed.status as RssFeed['status'],
      fetch_frequency: feed.fetch_frequency as RssFeed['fetch_frequency'],
      target_platforms: JSON.parse(feed.target_platforms),
      target_channels: JSON.parse(feed.target_channels),
    }));
  });

// Update RSS feed
export const updateRssFeed = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string(), data: updateFeedSchema }))
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    // Verify ownership
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      throw new Error('Not authorized');
    }
    
    const updates: any = {
      updated_at: Date.now(),
    };
    const next = data.data;
    
    if (next.name !== undefined) updates.name = next.name;
    if (next.url !== undefined) updates.url = next.url;
    if (next.feedType !== undefined) updates.feed_type = next.feedType;
    if (next.fetchFrequency !== undefined) updates.fetch_frequency = next.fetchFrequency;
    if (next.postTemplate !== undefined) updates.post_template = next.postTemplate;
    if (next.targetPlatforms !== undefined) updates.target_platforms = JSON.stringify(next.targetPlatforms);
    if (next.targetChannels !== undefined) updates.target_channels = JSON.stringify(next.targetChannels);
    if (next.filterKeywords !== undefined) updates.filter_keywords = next.filterKeywords;
    if (next.status !== undefined) updates.status = next.status;
    
    await db
      .update(schema.rss_feeds)
      .set(updates)
      .where(and(
        eq(schema.rss_feeds.id, data.id),
        eq(schema.rss_feeds.team_id, membership[0].teamId)
      ));
    
    return { message: 'Feed updated successfully' };
  });

// Delete RSS feed
export const deleteRssFeed = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      throw new Error('Not authorized');
    }
    
    await db
      .delete(schema.rss_feeds)
      .where(and(
        eq(schema.rss_feeds.id, data.id),
        eq(schema.rss_feeds.team_id, membership[0].teamId)
      ));
    
    return { message: 'Feed deleted successfully' };
  });

// Fetch and process RSS feed (called by cron job or manually)
export const fetchRssFeed = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ feedId: z.string() }))
  .handler(async ({ data }) => {
    const db = await getDb();
    
    const feed = await db
      .select()
      .from(schema.rss_feeds)
      .where(eq(schema.rss_feeds.id, data.feedId))
      .limit(1);
    
    if (feed.length === 0) {
      throw new Error('Feed not found');
    }
    
    const feedData = feed[0];
    
    try {
      // Parse feed
      const items = await parseFeed(feedData.url, feedData.feed_type);
      
      // Get filter keywords
      const filterKeywords = feedData.filter_keywords || '';
      const targetPlatforms = JSON.parse(feedData.target_platforms) as string[];
      const targetChannels = JSON.parse(feedData.target_channels) as string[];
      const availableChannels = await db
        .select()
        .from(schema.channels)
        .where(eq(schema.channels.team_id, feedData.team_id));

      async function buildTarget(platform: string, channelId: string | null, content: string, item: {
        title: string;
        link: string;
      }) {
        const channel = channelId
          ? availableChannels.find(candidate => candidate.id === channelId)
          : availableChannels.find(candidate => candidate.platform === platform && candidate.is_default)
            ?? availableChannels.find(candidate => candidate.platform === platform);
        const resolvedPlatform = channel?.platform ?? platform;
        let redditFields = {};
        if (resolvedPlatform === 'reddit') {
          const credentials = channel
            ? JSON.parse(await decrypt(channel.credentials)) as { defaultSubreddit?: string }
            : {};
          redditFields = buildRedditArticleTarget({
            title: item.title,
            link: item.link,
            defaultSubreddit: credentials.defaultSubreddit,
          });
        }
        return {
          channel_id: channel?.id ?? channelId,
          platform: resolvedPlatform as 'twitter' | 'linkedin' | 'reddit' | 'discord',
          content,
          ...redditFields,
        };
      }
      
      let processedCount = 0;
      let newItems: typeof items = [];
      
      // Check for new items
      for (const item of items) {
        const itemHash = await hashItem(item.link, item.title);
        
        // Check if already processed
        const existing = await db
          .select()
          .from(schema.rss_feed_items)
          .where(and(
            eq(schema.rss_feed_items.feed_id, feedData.id),
            eq(schema.rss_feed_items.item_hash, itemHash)
          ))
          .limit(1);
        
        if (existing.length === 0) {
          newItems.push(item);
          
          // Check filter
          const passesFilter = matchesFilter(item, filterKeywords);
          
          // Save item
          const feedItemId = crypto.randomUUID();
          await db.insert(schema.rss_feed_items).values({
            id: feedItemId,
            feed_id: feedData.id,
            item_hash: itemHash,
            title: item.title,
            link: item.link,
            description: item.description,
            published_at: item.publishedAt.getTime(),
            status: passesFilter ? 'pending' : 'filtered',
          });
          
          if (passesFilter && targetPlatforms.length > 0) {
            // Generate post content
            const content = generatePostContent(feedData.post_template, item);
            
            // Build targets array
            const targets = await Promise.all(targetChannels.map(channelId => {
              const channel = availableChannels.find(candidate => candidate.id === channelId);
              return buildTarget(channel?.platform ?? targetPlatforms[0] ?? 'twitter', channelId, content, item);
            }));
            
            // If no specific channels, create target per platform
            const finalTargets = targets.length > 0
              ? targets
              : await Promise.all(targetPlatforms.map(platform => buildTarget(platform, null, content, item)));
            
            // Create post
            const post = await createPost({
              data: {
                targets: finalTargets,
                state: 'draft',
                channel_group: 'rss',
              },
            });
            if (!post) {
              throw new Error('Failed to create post from RSS item');
            }
            
            // Link post to feed item
            await db
              .update(schema.rss_feed_items)
              .set({
                post_id: post.id,
                status: 'posted',
                processed_at: Date.now(),
              })
              .where(eq(schema.rss_feed_items.id, feedItemId));
            
            processedCount++;
          }
        }
      }
      
      // Update feed last fetched
      const firstItem = items[0];
      const lastHash = firstItem ? await hashItem(firstItem.link, firstItem.title) : feedData.last_item_hash;
      
      await db
        .update(schema.rss_feeds)
        .set({
          last_fetched_at: Date.now(),
          last_item_hash: lastHash,
          status: 'active',
          updated_at: Date.now(),
        })
        .where(eq(schema.rss_feeds.id, feedData.id));
      
      return {
        itemsFound: items.length,
        newItems: newItems.length,
        processed: processedCount,
      };
    } catch (error) {
      // Update feed status to error
      await db
        .update(schema.rss_feeds)
        .set({
          status: 'error',
          updated_at: Date.now(),
        })
        .where(eq(schema.rss_feeds.id, feedData.id));
      
      throw error;
    }
  });

// Fetch all active feeds (for cron job)
export const fetchAllActiveFeeds = createServerFn({ method: 'POST' })
  .handler(async () => {
    const db = await getDb();
    const now = Date.now();
    
    // Get all active feeds that need fetching
    const feeds = await db
      .select()
      .from(schema.rss_feeds)
      .where(eq(schema.rss_feeds.status, 'active'));
    
    const results = [];
    
    for (const feed of feeds) {
      // Check if feed needs fetching based on frequency
      const lastFetched = feed.last_fetched_at || 0;
      const frequencyMs = {
        '15m': 15 * 60 * 1000,
        '1h': 60 * 60 * 1000,
        '6h': 6 * 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
      }[feed.fetch_frequency] || 60 * 60 * 1000;
      
      if (now - lastFetched >= frequencyMs) {
        try {
          const result = await fetchRssFeed({ data: { feedId: feed.id } });
          results.push({ feedId: feed.id, status: 'success', result });
        } catch (e) {
          results.push({ feedId: feed.id, status: 'error', error: (e as Error).message });
        }
      }
    }
    
    return results;
  });

// Get feed items
export const getFeedItems = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ feedId: z.string() }))
  .handler(async ({ data }): Promise<RssFeedItem[]> => {
    const user = await requireAuth();
    const db = await getDb();
    
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      throw new Error('Not authorized');
    }
    
    const items = await db
      .select()
      .from(schema.rss_feed_items)
      .where(eq(schema.rss_feed_items.feed_id, data.feedId))
      .orderBy(desc(schema.rss_feed_items.published_at))
      .limit(50);
    
    return items.map(item => ({
      ...item,
      status: item.status as RssFeedItem['status'],
    }));
  });
