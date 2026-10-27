import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from './db/client';
import { retryResearchStorage } from './research-storage';
import { research_runs, research_settings, research_usage } from './schema';
import { priceResearchUsage, ANTHROPIC_RESEARCH_PRICING_DATE, ANTHROPIC_RESEARCH_PRICING_URL, type ModelUsage } from './research-pricing';
import type { ResearchRunUsage, ResearchStageUsage, ResearchUsageStage, ResearchUsageSummary, ResearchUsageTotals } from './research-usage-types';
import { isResearchTimezone } from './research-schedule';

export type ResearchUsageContext = {
  teamId: string;
  runId: string;
  stage: Exclude<ResearchUsageStage, 'legacy'>;
  operation: string;
};

export async function beginResearchUsage(context: ResearchUsageContext, model: string) {
  const db = await getDb();
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  await retryResearchStorage(async () => db.insert(research_usage).values({
    id, team_id: context.teamId, run_id: context.runId, stage: context.stage,
    operation: context.operation, model, created_at: createdAt,
  }).onConflictDoNothing());
  return id;
}

export async function finishResearchUsage(
  id: string,
  context: ResearchUsageContext,
  response: { model: string; tier: string; responseId?: string; status: string; usage?: ModelUsage },
) {
  const db = await getDb();
  const cost = priceResearchUsage(response.model, response.tier, response.usage);
  const pending = and(eq(research_usage.id, id), eq(research_usage.team_id, context.teamId), eq(research_usage.status, 'pending'));
  const completedAt = Date.now();
  await retryResearchStorage(async () => db.batch([
    db.update(research_runs).set({
      input_tokens: sql`${research_runs.input_tokens} + ${cost.input ?? 0}`,
      output_tokens: sql`${research_runs.output_tokens} + ${cost.output ?? 0}`,
    }).where(and(eq(research_runs.id, context.runId), eq(research_runs.team_id, context.teamId), sql`EXISTS (SELECT 1 FROM research_usage WHERE id = ${id} AND team_id = ${context.teamId} AND status = 'pending')`)),
    db.update(research_usage).set({
      model: response.model, service_tier: response.tier, response_id: response.responseId ?? null,
      status: response.status, input_tokens: cost.input, output_tokens: cost.output,
      cached_input_tokens: cost.cached, cache_write_tokens: cost.writes,
      cost_nano_usd: cost.costNanoUsd, cost_status: cost.costStatus, rate_card: cost.rateCard,
      completed_at: completedAt,
    }).where(pending),
  ]));
}

const stages: ResearchUsageStage[] = ['research', 'draft_generation', 'slack_revision', 'legacy'];
function emptyTotals(): ResearchUsageTotals {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, costUsd: 0, requestCount: 0, estimatedRequests: 0, unknownRequests: 0 };
}
function emptyStages(): ResearchStageUsage[] {
  return stages.map(stage => ({ stage, ...emptyTotals() }));
}
function add(target: ResearchUsageTotals, entry: typeof research_usage.$inferSelect) {
  target.inputTokens += entry.input_tokens ?? 0;
  target.outputTokens += entry.output_tokens ?? 0;
  target.cachedInputTokens += entry.cached_input_tokens ?? 0;
  target.cacheWriteTokens += entry.cache_write_tokens ?? 0;
  target.costUsd += (entry.cost_nano_usd ?? 0) / 1_000_000_000;
  target.requestCount++;
  target.estimatedRequests += Number(entry.cost_status === 'estimated' || entry.cost_status === 'historical');
  target.unknownRequests += Number(entry.cost_status === 'unknown');
}

export async function getResearchUsage(teamId: string, requestedTimezone?: string): Promise<ResearchUsageSummary> {
  const db = await getDb();
  const settings = await db.select().from(research_settings).where(eq(research_settings.team_id, teamId)).get();
  const timezone = z.string().max(100).refine(isResearchTimezone, 'Choose a valid timezone').parse(requestedTimezone || settings?.daily_timezone || 'UTC');
  const dates = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  function day(timestamp: number) {
    const parts = dates.formatToParts(timestamp);
    return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
  }
  const todayKey = day(Date.now());
  const monthKey = todayKey.slice(0, 7);
  const [entries, runs] = await Promise.all([
    db.select().from(research_usage).where(eq(research_usage.team_id, teamId)).orderBy(research_usage.created_at).all(),
    db.select().from(research_runs).where(eq(research_runs.team_id, teamId)).orderBy(desc(research_runs.created_at)).limit(50).all(),
  ]);
  const today = emptyTotals(), month = emptyTotals(), allTime = emptyTotals();
  const grouped = { today: emptyStages(), month: emptyStages(), allTime: emptyStages() };
  const daily = new Map<string, ResearchUsageTotals>();
  const monthly = new Map<string, ResearchUsageTotals>();
  const runUsage = new Map<string, ResearchRunUsage>(runs.map(run => [run.id, {
    runId: run.id, createdAt: run.created_at, mode: run.mode, days: run.days, status: run.status,
    ...emptyTotals(), stages: emptyStages(),
  }]));
  for (const entry of entries) {
    const date = day(entry.created_at), calendarMonth = date.slice(0, 7);
    const stage = stages.indexOf(entry.stage as ResearchUsageStage);
    add(allTime, entry);
    add(grouped.allTime[stage], entry);
    if (date === todayKey) { add(today, entry); add(grouped.today[stage], entry); }
    if (calendarMonth === monthKey) { add(month, entry); add(grouped.month[stage], entry); }
    if (!daily.has(date)) daily.set(date, emptyTotals());
    if (!monthly.has(calendarMonth)) monthly.set(calendarMonth, emptyTotals());
    add(daily.get(date)!, entry);
    add(monthly.get(calendarMonth)!, entry);
    const run = runUsage.get(entry.run_id);
    if (run) { add(run, entry); add(run.stages[stage], entry); }
  }
  return {
    timezone, currency: 'USD', today, month, allTime, stages: grouped,
    daily: [...daily].reverse().slice(0, 90).map(([date, totals]) => ({ date, ...totals })),
    monthly: [...monthly].reverse().map(([month, totals]) => ({ month, ...totals })),
    runs: [...runUsage.values()], pricingUrl: ANTHROPIC_RESEARCH_PRICING_URL, pricingAsOf: ANTHROPIC_RESEARCH_PRICING_DATE,
    trackingStartedAt: entries.find(entry => entry.stage !== 'legacy')?.created_at ?? null,
    historyNote: 'Older runs are historical estimates dated by run creation, with no reliable stage or cache breakdown. New calls are recorded by stage, including model responses later rejected. Unknown or interrupted usage is flagged and excluded from dollar totals. Costs are estimates in USD, excluding tax, Cloudflare hosting, social-provider fees and other AI features. Historical rows count runs, not individual requests.',
  };
}
