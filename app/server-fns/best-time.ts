// ABOUTME: AI Best Time to Post server functions (Issue #12)
// ABOUTME: Analyze posting history and suggest optimal times per platform

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { eq, and, desc, sql, gte, lte } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/schema';
import { requireAuth } from '@/app/server-fns/auth';
import type { BestTimePrediction } from '@/lib/db/types';
import { getBestTimePredictions, insertBestTimePrediction, insertPostingTimeAnalytics } from '@/lib/db/queries';

// Industry benchmarks for when no data exists
const INDUSTRY_BENCHMARKS: Record<string, Array<{ day: number; hour: number; score: number }>> = {
  twitter: [
    { day: 2, hour: 9, score: 85 },  // Tuesday 9am
    { day: 2, hour: 12, score: 80 }, // Tuesday 12pm
    { day: 3, hour: 9, score: 82 },  // Wednesday 9am
    { day: 3, hour: 15, score: 78 }, // Wednesday 3pm
    { day: 4, hour: 12, score: 80 }, // Thursday 12pm
    { day: 5, hour: 9, score: 75 },  // Friday 9am
  ],
  linkedin: [
    { day: 2, hour: 8, score: 88 },  // Tuesday 8am
    { day: 2, hour: 12, score: 85 }, // Tuesday 12pm
    { day: 3, hour: 8, score: 86 },  // Wednesday 8am
    { day: 3, hour: 17, score: 82 }, // Wednesday 5pm
    { day: 4, hour: 8, score: 84 },  // Thursday 8am
    { day: 5, hour: 9, score: 78 },  // Friday 9am
  ],
  reddit: [
    { day: 1, hour: 9, score: 75 },  // Monday 9am
    { day: 2, hour: 12, score: 80 }, // Tuesday 12pm
    { day: 3, hour: 14, score: 78 }, // Wednesday 2pm
    { day: 5, hour: 10, score: 72 }, // Friday 10am
    { day: 6, hour: 11, score: 70 }, // Saturday 11am
  ],
  discord: [
    { day: 2, hour: 14, score: 80 }, // Tuesday 2pm
    { day: 3, hour: 15, score: 78 }, // Wednesday 3pm
    { day: 4, hour: 14, score: 76 }, // Thursday 2pm
    { day: 5, hour: 16, score: 72 }, // Friday 4pm
  ],
  telegram: [
    { day: 2, hour: 10, score: 82 },  // Tuesday 10am
    { day: 3, hour: 14, score: 80 },  // Wednesday 2pm
    { day: 4, hour: 11, score: 78 },  // Thursday 11am
    { day: 5, hour: 15, score: 75 },  // Friday 3pm
  ],
};

// Input validation
const calculateSchema = z.object({
  platform: z.enum(['twitter', 'linkedin', 'reddit', 'discord', 'telegram']).optional(),
  daysOfHistory: z.number().min(7).max(90).default(30),
});

const suggestTimeSchema = z.object({
  platform: z.enum(['twitter', 'linkedin', 'reddit', 'discord', 'telegram']),
  withinHours: z.number().min(1).max(168).default(48),
});

// Calculate engagement score for a given day/hour
function calculateEngagementScore(posts: Array<{ scheduled_hour: number; day_of_week: number; engagement_rate: number | null }>): Array<{ day: number; hour: number; score: number; confidence: number }> {
  const dayHourMap = new Map<string, { total: number; count: number }>();
  
  // Group posts by day-hour
  posts.forEach(post => {
    const key = `${post.day_of_week}-${post.scheduled_hour}`;
    const current = dayHourMap.get(key) || { total: 0, count: 0 };
    
    if (post.engagement_rate !== null) {
      current.total += post.engagement_rate;
      current.count++;
    }
    
    dayHourMap.set(key, current);
  });
  
  // Calculate scores
  const results: Array<{ day: number; hour: number; score: number; confidence: number }> = [];
  
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const key = `${day}-${hour}`;
      const data = dayHourMap.get(key);
      
      if (data && data.count > 0) {
        const avgEngagement = data.total / data.count;
        // Normalize to 0-100 scale
        const score = Math.min(100, Math.max(0, avgEngagement));
        // Confidence based on number of posts at this time
        const confidence = Math.min(100, data.count * 20); // 5+ posts = 100% confidence
        
        results.push({ day, hour, score, confidence });
      }
    }
  }
  
  return results.sort((a, b) => b.score - a.score);
}

// Merge historical data with industry benchmarks
function mergeWithBenchmarks(
  historical: Array<{ day: number; hour: number; score: number; confidence: number }>,
  platform: string
): Array<{ day: number; hour: number; score: number; confidence: number }> {
  const benchmarks = INDUSTRY_BENCHMARKS[platform] || [];
  const result = [...historical];
  
  // Add benchmark data for missing time slots
  benchmarks.forEach(benchmark => {
    const exists = historical.some(h => h.day === benchmark.day && h.hour === benchmark.hour);
    if (!exists) {
      result.push({
        day: benchmark.day,
        hour: benchmark.hour,
        score: benchmark.score * 0.7, // Reduce benchmark scores slightly
        confidence: 30, // Lower confidence for benchmark data
      });
    }
  });
  
  return result.sort((a, b) => b.score - a.score);
}

// Calculate best times for a team/platform
export const calculateBestTimes = createServerFn({ method: 'POST' })
  .inputValidator(calculateSchema)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      throw new Error('User not associated with a team');
    }
    
    const teamId = membership[0].teamId;
    const platforms = data.platform ? [data.platform] : ['twitter', 'linkedin', 'reddit', 'discord', 'telegram'];
    const since = Date.now() - (data.daysOfHistory * 24 * 60 * 60 * 1000);
    
    const results = [];
    
    for (const platform of platforms) {
      // Get posting history with engagement data
      const history = await db
        .select({
          scheduled_hour: schema.posting_time_analytics.scheduled_hour,
          day_of_week: schema.posting_time_analytics.day_of_week,
          engagement_rate: schema.posting_time_analytics.engagement_rate,
        })
        .from(schema.posting_time_analytics)
        .where(and(
          eq(schema.posting_time_analytics.team_id, teamId),
          eq(schema.posting_time_analytics.platform, platform),
          gte(schema.posting_time_analytics.created_at, since)
        ));
      
      // Calculate scores from historical data
      const historicalScores = calculateEngagementScore(history);
      
      // Merge with benchmarks
      const mergedScores = mergeWithBenchmarks(historicalScores, platform);
      
      // Save predictions
      const now = Date.now();
      for (const score of mergedScores.slice(0, 10)) { // Top 10 times
        await insertBestTimePrediction({
          team_id: teamId,
          platform,
          channel_id: null,
          day_of_week: score.day,
          hour_of_day: score.hour,
          score: Math.round(score.score),
          confidence: Math.round(score.confidence),
          calculated_at: now,
        });
      }
      
      results.push({
        platform,
        predictions: mergedScores.slice(0, 5),
        dataPoints: history.length,
      });
    }
    
    return {
      message: 'Best times calculated successfully',
      results,
    };
  });

// Get best time recommendations
export const getBestTimeRecommendations = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ platform: z.enum(['twitter', 'linkedin', 'reddit', 'discord', 'telegram']).optional() }))
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      // Return benchmarks if no team
      return Object.entries(INDUSTRY_BENCHMARKS).map(([platform, times]) => ({
        platform,
        predictions: times.map(t => ({
          day: t.day,
          hour: t.hour,
          score: t.score,
          confidence: 30,
          label: formatDayHour(t.day, t.hour),
        })),
        isBenchmark: true,
      }));
    }
    
    const predictions = await getBestTimePredictions(membership[0].teamId, data.platform);
    
    // Group by platform
    const grouped = predictions.reduce((acc, pred) => {
      if (!acc[pred.platform]) {
        acc[pred.platform] = [];
      }
      acc[pred.platform].push({
        day: pred.day_of_week,
        hour: pred.hour_of_day,
        score: pred.score,
        confidence: pred.confidence,
        label: formatDayHour(pred.day_of_week, pred.hour_of_day),
      });
      return acc;
    }, {} as Record<string, any[]>);
    
    // If no data for a requested platform, use benchmarks
    const platforms = data.platform ? [data.platform] : Object.keys(INDUSTRY_BENCHMARKS);
    const results = platforms.map(platform => {
      if (grouped[platform] && grouped[platform].length > 0) {
        return {
          platform,
          predictions: grouped[platform].slice(0, 5),
          isBenchmark: false,
        };
      }
      
      // Fallback to benchmarks
      return {
        platform,
        predictions: INDUSTRY_BENCHMARKS[platform]?.map(t => ({
          day: t.day,
          hour: t.hour,
          score: t.score,
          confidence: 30,
          label: formatDayHour(t.day, t.hour),
        })) || [],
        isBenchmark: true,
      };
    });
    
    return results;
  });

// Suggest next optimal posting time
export const suggestNextTime = createServerFn({ method: 'POST' })
  .inputValidator(suggestTimeSchema)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      // Return next available benchmark time
      const benchmarks = INDUSTRY_BENCHMARKS[data.platform] || [];
      const next = getNextAvailableTime(benchmarks, data.withinHours);
      return { ...next, isBenchmark: true };
    }
    
    // Get predictions for this platform
    const predictions = await getBestTimePredictions(membership[0].teamId, data.platform);
    
    if (predictions.length === 0) {
      // Fallback to benchmarks
      const benchmarks = INDUSTRY_BENCHMARKS[data.platform] || [];
      const next = getNextAvailableTime(benchmarks, data.withinHours);
      return { ...next, isBenchmark: true };
    }
    
    // Find the highest scoring time within the window
    const now = new Date();
    const currentDay = now.getDay();
    const currentHour = now.getHours();
    
    let bestTime: BestTimePrediction | null = null;
    let bestScore = -1;
    
    for (const pred of predictions) {
      // Calculate hours from now to this time
      let hoursDiff = (pred.day_of_week - currentDay) * 24 + (pred.hour_of_day - currentHour);
      if (hoursDiff < 0) hoursDiff += 7 * 24; // Next week
      
      if (hoursDiff <= data.withinHours && pred.score > bestScore) {
        bestScore = pred.score;
        bestTime = pred;
      }
    }
    
    if (!bestTime) {
      // Fallback to first available time
      bestTime = predictions[0];
    }
    if (!bestTime) {
      throw new Error('No prediction available');
    }
    
    return {
      day: bestTime.day_of_week,
      hour: bestTime.hour_of_day,
      score: bestTime.score,
      confidence: bestTime.confidence,
      label: formatDayHour(bestTime.day_of_week, bestTime.hour_of_day),
      isBenchmark: false,
    };
  });

// Record posting for analytics
export const recordPostingTime = createServerFn({ method: 'POST' })
  .inputValidator(z.object({
    postId: z.string(),
    platform: z.enum(['twitter', 'linkedin', 'reddit', 'discord', 'telegram']),
    scheduledHour: z.number().min(0).max(23),
    dayOfWeek: z.number().min(0).max(6),
  }))
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
    
    await insertPostingTimeAnalytics({
      team_id: membership[0].teamId,
      platform: data.platform,
      post_id: data.postId,
      scheduled_hour: data.scheduledHour,
      day_of_week: data.dayOfWeek,
      engagement_rate: null, // Will be updated later when analytics come in
    });
    
    return { message: 'Posting time recorded' };
  });

// Helper function to format day/hour
function formatDayHour(day: number, hour: number): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${days[day]} ${displayHour}:00 ${ampm}`;
}

// Helper to get next available time from list
function getNextAvailableTime(times: Array<{ day: number; hour: number; score: number }>, withinHours: number) {
  const now = new Date();
  const currentDay = now.getDay();
  const currentHour = now.getHours();
  
  // Sort by soonest first
  const sorted = [...times].sort((a, b) => {
    const diffA = ((a.day - currentDay + 7) % 7) * 24 + (a.hour - currentHour);
    const diffB = ((b.day - currentDay + 7) % 7) * 24 + (b.hour - currentHour);
    return diffA - diffB;
  });
  
  const next = sorted[0] || times[0];
  return {
    day: next.day,
    hour: next.hour,
    score: next.score,
    confidence: 30,
    label: formatDayHour(next.day, next.hour),
  };
}

// Get heatmap data for visualization
export const getEngagementHeatmap = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ platform: z.enum(['twitter', 'linkedin', 'reddit', 'discord', 'telegram']) }))
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      // Return benchmark heatmap
      return generateHeatmapFromBenchmarks(data.platform);
    }
    
    // Get predictions
    const predictions = await getBestTimePredictions(membership[0].teamId, data.platform);
    
    if (predictions.length === 0) {
      return generateHeatmapFromBenchmarks(data.platform);
    }
    
    // Create 7x24 heatmap
    const heatmap: number[][] = Array(7).fill(null).map(() => Array(24).fill(0));
    
    predictions.forEach(pred => {
      heatmap[pred.day_of_week][pred.hour_of_day] = pred.score;
    });
    
    // Fill gaps with benchmark data
    const benchmarks = INDUSTRY_BENCHMARKS[data.platform] || [];
    benchmarks.forEach(b => {
      if (heatmap[b.day][b.hour] === 0) {
        heatmap[b.day][b.hour] = b.score * 0.7;
      }
    });
    
    return {
      heatmap,
      days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      hours: Array.from({ length: 24 }, (_, i) => i),
    };
  });

function generateHeatmapFromBenchmarks(platform: string) {
  const benchmarks = INDUSTRY_BENCHMARKS[platform] || [];
  const heatmap: number[][] = Array(7).fill(null).map(() => Array(24).fill(0));
  
  benchmarks.forEach(b => {
    heatmap[b.day][b.hour] = b.score;
  });
  
  return {
    heatmap,
    days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    hours: Array.from({ length: 24 }, (_, i) => i),
    isBenchmark: true,
  };
}
