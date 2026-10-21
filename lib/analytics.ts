// ABOUTME: Analytics tracking and reporting utilities for post performance metrics.
// ABOUTME: Aggregates metrics from all platforms and provides insights.

import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { getDb } from './db/client';
import * as schema from './schema';
import type { PlatformId } from './platforms';

export interface PostMetrics {
  postId: string;
  platform: PlatformId;
  impressions: number;
  engagements: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  timestamp: number;
}

export interface PlatformMetrics {
  platform: PlatformId;
  followers: number;
  postsPublished: number;
  totalImpressions: number;
  totalEngagements: number;
  avgEngagementRate: number;
}

export interface TimeSeriesData {
  date: string;
  impressions: number;
  engagements: number;
  posts: number;
}

/**
 * Record metrics for a published post
 */
export async function recordPostMetrics(
  postId: string,
  targetId: string,
  platform: PlatformId,
  metrics: Omit<PostMetrics, 'postId' | 'platform' | 'timestamp'>
): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  
  await db.insert(schema.analytics).values({
    id: crypto.randomUUID(),
    post_id: postId,
    target_id: targetId,
    platform,
    impressions: metrics.impressions,
    engagements: metrics.engagements,
    likes: metrics.likes,
    comments: metrics.comments,
    shares: metrics.shares,
    clicks: metrics.clicks,
    recorded_at: now,
  });
}

/**
 * Get time-series analytics data for charts
 */
export async function getTimeSeriesData(
  teamId: string,
  platform: PlatformId | null,
  startDate: number,
  endDate: number
): Promise<TimeSeriesData[]> {
  const db = await getDb();
  
  const conditions = [
    gte(schema.analytics.recorded_at, startDate),
    lte(schema.analytics.recorded_at, endDate),
  ];
  
  if (platform) {
    conditions.push(eq(schema.analytics.platform, platform));
  }
  
  // Join with posts to filter by team
  const rows = await db
    .select({
      date: sql<string>`date(${schema.analytics.recorded_at} / 1000, 'unixepoch')`,
      impressions: sql<number>`SUM(${schema.analytics.impressions})`,
      engagements: sql<number>`SUM(${schema.analytics.engagements})`,
      posts: sql<number>`COUNT(DISTINCT ${schema.analytics.post_id})`,
    })
    .from(schema.analytics)
    .innerJoin(schema.posts, eq(schema.analytics.post_id, schema.posts.id))
    .where(and(...conditions, eq(schema.posts.team_id, teamId)))
    .groupBy(sql`date(${schema.analytics.recorded_at} / 1000, 'unixepoch')`)
    .orderBy(sql`date(${schema.analytics.recorded_at} / 1000, 'unixepoch')`);
  
  return rows.map(row => ({
    date: row.date,
    impressions: Number(row.impressions) || 0,
    engagements: Number(row.engagements) || 0,
    posts: Number(row.posts) || 0,
  }));
}

/**
 * Get top performing posts
 */
export async function getTopPerformingPosts(
  teamId: string,
  platform: PlatformId | null,
  limit: number = 10,
  startDate?: number,
  endDate?: number
): Promise<Array<{
  postId: string;
  content: string;
  platform: PlatformId;
  impressions: number;
  engagements: number;
  engagementRate: number;
  publishedAt: number;
}>> {
  const db = await getDb();
  
  const conditions = [eq(schema.posts.team_id, teamId)];
  
  if (platform) {
    conditions.push(eq(schema.analytics.platform, platform));
  }
  
  if (startDate && endDate) {
    conditions.push(gte(schema.analytics.recorded_at, startDate));
    conditions.push(lte(schema.analytics.recorded_at, endDate));
  }
  
  const rows = await db
    .select({
      postId: schema.posts.id,
      content: sql<string>`SUBSTRING(${schema.post_targets.content}, 1, 100)`,
      platform: schema.analytics.platform,
      impressions: sql<number>`SUM(${schema.analytics.impressions})`,
      engagements: sql<number>`SUM(${schema.analytics.engagements})`,
      engagementRate: sql<number>`CASE 
        WHEN SUM(${schema.analytics.impressions}) > 0 
        THEN (SUM(${schema.analytics.engagements}) * 100.0) / SUM(${schema.analytics.impressions})
        ELSE 0 
      END`,
      publishedAt: schema.posts.publish_at,
    })
    .from(schema.analytics)
    .innerJoin(schema.posts, eq(schema.analytics.post_id, schema.posts.id))
    .innerJoin(schema.post_targets, eq(schema.analytics.target_id, schema.post_targets.id))
    .where(and(...conditions))
    .groupBy(schema.posts.id, schema.analytics.platform)
    .orderBy(sql`SUM(${schema.analytics.engagements}) DESC`)
    .limit(limit);
  
  return rows.map(row => ({
    postId: row.postId,
    content: row.content,
    platform: row.platform as PlatformId,
    impressions: Number(row.impressions) || 0,
    engagements: Number(row.engagements) || 0,
    engagementRate: Number(row.engagementRate) || 0,
    publishedAt: Number(row.publishedAt) || 0,
  }));
}

/**
 * Get platform-level summary metrics
 */
export async function getPlatformSummary(
  teamId: string,
  startDate?: number,
  endDate?: number
): Promise<PlatformMetrics[]> {
  const db = await getDb();
  
  const conditions = [eq(schema.posts.team_id, teamId)];
  
  if (startDate && endDate) {
    conditions.push(gte(schema.analytics.recorded_at, startDate));
    conditions.push(lte(schema.analytics.recorded_at, endDate));
  }
  
  const rows = await db
    .select({
      platform: schema.analytics.platform,
      postsPublished: sql<number>`COUNT(DISTINCT ${schema.analytics.post_id})`,
      totalImpressions: sql<number>`SUM(${schema.analytics.impressions})`,
      totalEngagements: sql<number>`SUM(${schema.analytics.engagements})`,
      avgEngagementRate: sql<number>`CASE 
        WHEN SUM(${schema.analytics.impressions}) > 0 
        THEN (SUM(${schema.analytics.engagements}) * 100.0) / SUM(${schema.analytics.impressions})
        ELSE 0 
      END`,
    })
    .from(schema.analytics)
    .innerJoin(schema.posts, eq(schema.analytics.post_id, schema.posts.id))
    .where(and(...conditions))
    .groupBy(schema.analytics.platform);
  
  return rows.map(row => ({
    platform: row.platform as PlatformId,
    followers: 0, // Would need to fetch from channel credentials
    postsPublished: Number(row.postsPublished) || 0,
    totalImpressions: Number(row.totalImpressions) || 0,
    totalEngagements: Number(row.totalEngagements) || 0,
    avgEngagementRate: Number(row.avgEngagementRate) || 0,
  }));
}

/**
 * Export analytics data as CSV
 */
export function exportToCSV(
  data: Array<Record<string, string | number>>
): string {
  if (data.length === 0) return '';
  
  const headers = Object.keys(data[0]);
  const rows = data.map(row => 
    headers.map(h => {
      const val = row[h];
      // Escape values with commas or quotes
      if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    }).join(',')
  );
  
  return [headers.join(','), ...rows].join('\n');
}
