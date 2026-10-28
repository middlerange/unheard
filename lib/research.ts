import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db/client";
import { retryResearchStorage } from "./research-storage";
import { getFrozenResearchAudience } from "./research-audience";
import { researchFindingDates, researchItemSignalKind } from "./research-dates";
import { getDraftResearchFindings, researchRunFindingsCount, saveResearchFindingSnapshot, type ResearchFindingRow } from "./research-finding-snapshots";
import { hasUsablePewResearchBody, isPewResearchSource } from "./research-pew";
import {
  ideas,
  channels,
  slack_integrations,
  research_cache,
  research_drafts,
  research_findings,
  research_items,
  research_run_sources,
  research_runs,
  research_settings,
  research_sources,
} from "./schema";
import { RESEARCH_SOURCE_SEEDS } from "./research-sources";
import { collectDiscoveredResearchSource, fetchDiscoveredResearchArticle, researchAbstractText, researchDiscoveryBlockedHosts, type DiscoveryArticleTarget } from "./research-discovery";
import {
  isResearchDailyTime,
  isResearchTimezone,
  isSameResearchLocalDay,
  nextResearchDailyAt,
} from "./research-schedule";
import type {
  ResearchFinding,
  ResearchDraftContent,
  ResearchJob,
  ResearchRun,
  ResearchRunDiagnostics,
  ResearchSnapshot,
} from "./research-types";
import {
  articleResearchText,
  canonicalResearchUrl,
  fetchPublicYoutubeTranscript,
  fetchResearchText,
  sourceHosts,
  type CollectedItem,
  ResearchRateLimitError,
} from "./research-collectors";
import {
  callResearchModel,
  evidenceJsonSchemaForItems,
  RESEARCH_MODEL,
  RESEARCH_PROMPT_VERSION,
  RESEARCH_SCREEN_BATCH_SIZE,
  RESEARCH_EVIDENCE_BATCH_SIZE,
  RESEARCH_SCREEN_INSTRUCTIONS,
  RESEARCH_EVIDENCE_INSTRUCTIONS,
  researchScreeningSchema,
  researchEvidenceSchema,
  researchHash,
  screeningJsonSchemaForItems,
  validateResearchEvidence,
  validateResearchEvidenceCoverage,
  validateResearchEvidenceProfiles,
  validateResearchScreening,
} from "./research-model";
export { RESEARCH_MODEL } from "./research-model";
export const DEFAULT_RESEARCH_ICP =
  "Product managers, growth leads, and product marketers at B2B SaaS companies. Prioritize practical evidence on product adoption, onboarding, activation, retention, customer feedback, product discovery, and customer communication. Also cover consequential AI/product releases, credible benchmarks, distribution changes, and firsthand experiments that change how product and growth teams work. Prefer specific evidence and original implications; attribute first-party claims and exclude thin ads, generic SEO advice, and unsupported hype.";
declare global {
  var __contentHubResearchWorkflow__:
    | {
        create(input: {
          id: string;
          params: { runId: string };
        }): Promise<unknown>;
      }
    | undefined;
}
const terminal = (status: string) =>
  status === "completed" || status === "failed";
function runView(row: typeof research_runs.$inferSelect): ResearchRun {
  return {
    id: row.id,
    mode: row.mode as ResearchRun["mode"],
    status: row.status as ResearchRun["status"],
    days: row.days,
    editorial: row.editorial,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    sourceCount: row.source_count,
    collectedCount: row.collected_count,
    findingsCount: row.findings_count,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheHits: row.cache_hits,
    error: row.error,
    diagnostics: JSON.parse(row.diagnostics) as ResearchRunDiagnostics,
  };
}
export async function initializeResearch(teamId: string) {
  const db = await getDb();
  await db
    .insert(research_settings)
    .values({
      team_id: teamId,
      icp: DEFAULT_RESEARCH_ICP,
      daily_enabled: true,
      updated_at: Date.now(),
    })
    .onConflictDoNothing();
  const existing = await db
    .select({ seedId: research_sources.seed_id })
    .from(research_sources)
    .where(eq(research_sources.team_id, teamId));
  const known = new Set(existing.map((source) => source.seedId));
  const missing = RESEARCH_SOURCE_SEEDS.filter(
    (source) => !known.has(source.id),
  );
  for (let start = 0; start < missing.length; start += 10)
    await db
      .insert(research_sources)
      .values(
        missing.slice(start, start + 10).map((seed) => ({
          id: `${teamId}:${seed.id}`,
          team_id: teamId,
          seed_id: seed.id,
          enabled: seed.enabled,
        })),
      )
      .onConflictDoNothing();
}
export async function getResearchSnapshot(
  teamId: string,
): Promise<ResearchSnapshot> {
  await initializeResearch(teamId);
  const db = await getDb();
  const [
    settings,
    sources,
    runs,
    findings,
    drafts,
    draftProfiles,
    slackWorkspace,
  ] = await Promise.all([
    db
      .select()
      .from(research_settings)
      .where(eq(research_settings.team_id, teamId))
      .get(),
    db
      .select()
      .from(research_sources)
      .where(eq(research_sources.team_id, teamId))
      .all(),
    db
      .select()
      .from(research_runs)
      .where(eq(research_runs.team_id, teamId))
      .orderBy(desc(research_runs.created_at))
      .limit(15)
      .all(),
    db
      .select()
      .from(research_findings)
      .where(and(eq(research_findings.team_id, teamId), ne(research_findings.source_id, "slack-test-review")))
      .orderBy(desc(research_findings.score))
      .all(),
    db
      .select({
        draft: research_drafts,
        title: research_findings.title,
        sourceUrl: research_findings.url,
        whyItMatters: research_findings.why_it_matters,
      })
      .from(research_drafts)
      .innerJoin(
        research_findings,
        and(
          eq(research_findings.id, research_drafts.finding_id),
          eq(research_findings.team_id, research_drafts.team_id),
        ),
      )
      .where(eq(research_drafts.team_id, teamId))
      .orderBy(desc(research_drafts.created_at))
      .all(),
    db
      .select({ id: channels.id, name: channels.name })
      .from(channels)
      .where(eq(channels.team_id, teamId))
      .all(),
    db
      .select({ id: slack_integrations.workspace_id })
      .from(slack_integrations)
      .where(eq(slack_integrations.team_id, teamId))
      .get(),
  ]);
  const originalDraftFindings = await getDraftResearchFindings(teamId, drafts.map(({ draft }) => ({
    runId: draft.run_id, findingId: draft.finding_id,
  })));
  return {
    configured: Boolean(process.env.ANTHROPIC_API_KEY),
    workflowConfigured: Boolean(globalThis.__contentHubResearchWorkflow__),
    model: RESEARCH_MODEL,
    settings: {
      icp: settings!.icp,
      dailyEnabled: settings!.daily_enabled,
      autoDrafts: settings!.auto_drafts,
      dailyTime: settings!.daily_time,
      dailyTimezone: settings!.daily_timezone,
      nextDailyAt: settings!.next_daily_at,
    },
    sources: RESEARCH_SOURCE_SEEDS.map((seed) => {
      const stored = sources.find((row) => row.seed_id === seed.id);
      return {
        ...seed,
        enabled: stored?.enabled ?? seed.enabled,
        lastCollectedAt: stored?.last_collected_at ?? null,
        lastError: stored?.last_error ?? null,
        itemCount: stored?.item_count ?? 0,
      };
    }),
    runs: runs.map(runView),
    drafts: drafts.map(({ draft, title, sourceUrl, whyItMatters }) => ({
      id: draft.id,
      runId: draft.run_id,
      findingId: draft.finding_id,
      title: originalDraftFindings.get(`${draft.run_id}:${draft.finding_id}`)?.title ?? title,
      sourceUrl: originalDraftFindings.get(`${draft.run_id}:${draft.finding_id}`)?.url ?? sourceUrl,
      whyItMatters: originalDraftFindings.get(`${draft.run_id}:${draft.finding_id}`)?.why_it_matters ?? whyItMatters,
      content: {
        targets: (
          JSON.parse(draft.content) as ResearchDraftContent
        ).targets.map((target) => ({
          ...target,
          channelName:
            draftProfiles.find((profile) => profile.id === target.channelId)
              ?.name || target.channelId,
        })),
      },
      revision: draft.revision,
      isTest: draft.is_test,
      status: draft.status as ResearchSnapshot["drafts"][number]["status"],
      postId: draft.post_id,
      slackChannelId: draft.slack_channel_id,
      slackThreadTs: draft.slack_thread_ts,
      slackThreadUrl:
        slackWorkspace && draft.slack_channel_id && draft.slack_thread_ts
          ? `https://app.slack.com/client/${encodeURIComponent(slackWorkspace.id)}/${encodeURIComponent(draft.slack_channel_id)}/thread/${encodeURIComponent(draft.slack_channel_id)}-${encodeURIComponent(draft.slack_thread_ts)}`
          : null,
      createdAt: draft.created_at,
      updatedAt: draft.updated_at,
      error: draft.error,
    })),
    findings: findings.map((row) => ({
      id: row.id,
      runId: row.run_id,
      itemId: row.item_id,
      sourceId: row.source_id,
      sourceName: RESEARCH_SOURCE_SEEDS.find((s) => s.id === row.source_id)?.kind === "search"
        ? new URL(row.url).hostname.replace(/^www\./, "")
        : RESEARCH_SOURCE_SEEDS.find((s) => s.id === row.source_id)?.name || row.source_id,
      title: row.title,
      url: row.url,
      ...researchFindingDates(row),
      score: row.score,
      summary: row.summary,
      whyItMatters: row.why_it_matters,
      contentAngle: row.content_angle,
      evidence: row.evidence,
      limitations: row.limitations,
      status: row.status as ResearchFinding["status"],
      ideaId: row.idea_id,
      createdAt: row.created_at,
      contentType: row.content_type as ResearchFinding["contentType"],
      transcriptStatus:
        row.transcript_status as ResearchFinding["transcriptStatus"],
    })),
  };
}
export async function updateResearchSettings(teamId: string, input: unknown) {
  const data = z
    .object({
      icp: z.string().trim().min(20).max(4000).optional(),
      dailyEnabled: z.boolean().optional(),
      autoDrafts: z.boolean().optional(),
      dailyTime: z.string()
        .refine(isResearchDailyTime, "Use a daily time in HH:mm format")
        .nullable().optional(),
      dailyTimezone: z.string().max(100)
        .refine(isResearchTimezone, "Use a valid IANA timezone").optional(),
    })
    .strict()
    .parse(input);
  await initializeResearch(teamId);
  const db = await getDb();
  const settings = await db.select().from(research_settings)
    .where(eq(research_settings.team_id, teamId)).get();
  const time = data.dailyTime === undefined ? settings!.daily_time : data.dailyTime;
  const timezone = data.dailyTimezone ?? settings!.daily_timezone;
  const enabled = data.dailyEnabled ?? settings!.daily_enabled;
  const scheduleChanged = time !== settings!.daily_time
    || timezone !== settings!.daily_timezone
    || enabled !== settings!.daily_enabled;
  const now = Date.now();
  const ranToday = settings!.last_daily_at !== null
    && isSameResearchLocalDay(settings!.last_daily_at, now, timezone);
  await db
    .update(research_settings)
    .set({
      ...(data.icp !== undefined ? { icp: data.icp } : {}),
      ...(data.dailyEnabled !== undefined
        ? { daily_enabled: data.dailyEnabled }
        : {}),
      ...(data.autoDrafts !== undefined ? { auto_drafts: data.autoDrafts } : {}),
      ...(scheduleChanged ? {
        daily_time: time,
        daily_timezone: timezone,
        next_daily_at: time && enabled
          ? nextResearchDailyAt(time, timezone, now, ranToday)
          : null,
        daily_claim_id: null,
        daily_claim_until: null,
      } : {}),
      updated_at: now,
    })
    .where(eq(research_settings.team_id, teamId));
  return { ok: true };
}
export async function updateResearchSource(teamId: string, input: unknown) {
  const data = z
    .object({ id: z.string(), enabled: z.boolean() })
    .strict()
    .parse(input);
  if (!RESEARCH_SOURCE_SEEDS.some((seed) => seed.id === data.id))
    throw new Error("Source not found");
  await initializeResearch(teamId);
  const db = await getDb();
  await db
    .update(research_sources)
    .set({ enabled: data.enabled })
    .where(
      and(
        eq(research_sources.team_id, teamId),
        eq(research_sources.seed_id, data.id),
      ),
    );
  return { ok: true };
}
export async function dispatchResearchRun(runId: string) {
  const workflow = globalThis.__contentHubResearchWorkflow__;
  if (!workflow)
    throw new Error(
      "Research Workflow is unavailable. Deploy the Cloudflare ResearchWorkflow binding.",
    );
  // Reusing the run ID makes dispatch retries refer to the same durable workflow.
  try {
    await workflow.create({ id: runId, params: { runId } });
  } catch (error) {
    if (
      !/already exists|duplicate|instance.*exists/i.test(
        error instanceof Error ? error.message : "",
      )
    )
      throw error;
  }
}
export async function createResearchRun(
  teamId: string,
  input: unknown,
  editorial = false,
  scheduledRunId?: string,
) {
  const data = z
    .object({
      days: z.union([z.literal(1), z.literal(7), z.literal(30)]).default(30),
      mode: z.enum(["scan", "collect"]).default("scan"),
      sourceIds: z.array(z.string().min(1)).min(1)
        .refine(ids => new Set(ids).size === ids.length, "Source IDs must be unique")
        .refine(ids => ids.every(id => RESEARCH_SOURCE_SEEDS.some(source => source.id === id)), "Source IDs must identify registered research sources")
        .optional(),
    })
    .strict()
    .parse(input);
  if (!globalThis.__contentHubResearchWorkflow__)
    throw new Error(
      "Research Workflow is unavailable. Deploy the Cloudflare ResearchWorkflow binding.",
    );
  if (data.mode === "scan" && !process.env.ANTHROPIC_API_KEY)
    throw new Error("Set ANTHROPIC_API_KEY in Cloudflare secrets to run research");
  await initializeResearch(teamId);
  const db = await getDb();
  const settings = await db.select().from(research_settings)
    .where(eq(research_settings.team_id, teamId)).get();
  const writeDrafts = editorial && settings!.auto_drafts && data.days === 1 && data.mode === "scan";
  if (writeDrafts && !process.env.OPENAI_API_KEY)
    throw new Error("Set OPENAI_API_KEY in Cloudflare secrets to generate research drafts");
  if (data.sourceIds) {
    const enabled = await db.select({ seedId: research_sources.seed_id }).from(research_sources).where(and(
      eq(research_sources.team_id, teamId), eq(research_sources.enabled, true),
    )).all();
    const enabledIds = new Set(enabled.map(source => source.seedId));
    z.array(z.string()).refine(ids => ids.every(id => enabledIds.has(id)), "Requested sources must be enabled for this team").parse(data.sourceIds);
  }
  const active = await db
    .select()
    .from(research_runs)
    .where(
      and(
        eq(research_runs.team_id, teamId),
        ne(research_runs.mode, "replay"),
        inArray(research_runs.status, [
          "queued",
          "collecting",
          "ranking",
          "drafting",
        ]),
      ),
    )
    .get();
  if (active) {
    if (data.sourceIds) {
      const activeIds = new Set(JSON.parse(active.source_ids) as string[]);
      if (activeIds.size !== data.sourceIds.length || data.sourceIds.some(id => !activeIds.has(id)))
        throw new Error("A research run with different sources is active. Wait for it to finish before starting this source subset.");
    }
    if (!scheduledRunId || active.id === scheduledRunId) {
      await getFrozenResearchAudience(active);
      await dispatchResearchRun(active.id);
    }
    return { run: runView(active) };
  }
  const [sources, profiles] = await Promise.all([
    db
      .select()
      .from(research_sources)
      .where(
        and(
          eq(research_sources.team_id, teamId),
          eq(research_sources.enabled, true),
        ),
      )
      .all(),
    db
      .select({
        id: channels.id,
        name: channels.name,
        platform: channels.platform,
        systemPrompt: channels.system_prompt,
        groupName: channels.group_name,
      })
      .from(channels)
      .where(
        and(eq(channels.team_id, teamId), eq(channels.research_enabled, true)),
      )
      .all(),
  ]);
  const ids = data.sourceIds ?? sources
    .map((source) => source.seed_id)
    .filter((id) => RESEARCH_SOURCE_SEEDS.some((seed) => seed.id === id));
  if (!ids.length) throw new Error("Enable at least one research source");
  const id = scheduledRunId ?? crypto.randomUUID();
  const row = await db
    .insert(research_runs)
    .values({
      id,
      team_id: teamId,
      mode: data.mode,
      status: "queued",
      days: data.days,
      editorial: writeDrafts,
      created_at: Date.now(),
      icp: profiles.length
        ? `${settings!.icp}\n\nPublishing profiles: ${JSON.stringify(profiles)}\nUse each profile systemPrompt to decide relevance. Each draft must choose exactly one account identity group and include its enabled supported channels; never mix account groups in one approval. These profile instructions take precedence over the general audience description when they differ.`
        : settings!.icp,
      source_count: ids.length,
      source_ids: JSON.stringify(ids),
    })
    .onConflictDoNothing()
    .returning()
    .get();
  if (!row) {
    const other = await db
      .select()
      .from(research_runs)
      .where(
        and(
          eq(research_runs.team_id, teamId),
          ne(research_runs.mode, "replay"),
          inArray(research_runs.status, [
            "queued",
            "collecting",
            "ranking",
            "drafting",
          ]),
        ),
      )
      .get();
    if (!other) throw new Error("Run could not be created");
    if (!scheduledRunId || other.id === scheduledRunId) {
      await getFrozenResearchAudience(other);
      await dispatchResearchRun(other.id);
    }
    return { run: runView(other) };
  }
  try {
    await getFrozenResearchAudience(row);
    await dispatchResearchRun(id);
  } catch (error) {
    await db
      .update(research_runs)
      .set({
        // A scheduled run remains queued so a cron retry can dispatch this same
        // durable workflow ID without creating another paid research run.
        status: scheduledRunId ? "queued" : "failed",
        completed_at: scheduledRunId ? null : Date.now(),
        error:
          "Research setup or Workflow dispatch failed. Retry after checking storage and the Cloudflare binding.",
      })
      .where(eq(research_runs.id, id));
    throw error;
  }
  return { run: runView(row) };
}
export function researchSourceErrorMessage(error: unknown): string {
  let current = error;
  let message = "Source collection failed";
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    message = current.message;
    current = current.cause;
  }
  return /^Failed query:/i.test(message)
    ? "Source storage failed; no underlying database error was available."
    : message.slice(0, 400);
}
type ResearchCollectionProgress = {
  urls: string[]; nextOffset: number; count: number; warning: string | null;
  articles?: DiscoveryArticleTarget[]; articleOffset?: number; articleFailures?: string[];
  rateLimits?: Record<string, { attempts: number; retryAt: number; exhausted?: boolean }>;
  deferredArticles?: Array<DiscoveryArticleTarget & { retryAt: number; reason: string }>;
};
type ResearchSourceBackoff = { retryAtByHost: Record<string, number>; targets: DiscoveryArticleTarget[] };
const MAX_COLLECTION_RATE_ATTEMPTS = 3;
const MAX_COLLECTION_INLINE_WAIT_MS = 5 * 60_000;
const collectionHost = (url: string) => new URL(url).hostname.replace(/^www\./, "");
async function collectForRun(
  run: typeof research_runs.$inferSelect,
  sourceId: string,
) {
  const db = await getDb();
  const source = RESEARCH_SOURCE_SEEDS.find((seed) => seed.id === sourceId);
  if (!source || !(JSON.parse(run.source_ids) as string[]).includes(sourceId))
    throw new Error("Source is not part of this run");
  const stepId = `${run.id}:${sourceId}`;
  await db
    .insert(research_run_sources)
    .values({ id: stepId, run_id: run.id, source_id: sourceId })
    .onConflictDoNothing();
  const existing = await db
    .select()
    .from(research_run_sources)
    .where(eq(research_run_sources.id, stepId))
    .get();
  if (existing?.status === "completed" || existing?.status === "failed")
    return { collected: existing.item_count };
  const progressId = `collection-progress:${stepId}`;
  const saved = await db.select().from(research_cache).where(and(
    eq(research_cache.id, progressId), eq(research_cache.team_id, run.team_id),
  )).get();
  let progress = saved ? JSON.parse(saved.value) as ResearchCollectionProgress : undefined;
  const backoffId = `collection-backoff:${run.team_id}:${sourceId}`;
  const savedBackoff = await db.select().from(research_cache).where(and(
    eq(research_cache.id, backoffId), eq(research_cache.team_id, run.team_id),
  )).get();
  const backoff: ResearchSourceBackoff = savedBackoff ? JSON.parse(savedBackoff.value) : { retryAtByHost: {}, targets: [] };
  const deferred = new Map(backoff.targets.map(target => [target.url, target]));
  async function saveBackoff() {
    await db.insert(research_cache).values({
      id: backoffId, team_id: run.team_id, value: JSON.stringify({ ...backoff, targets: [...deferred.values()] }), created_at: Date.now(),
    }).onConflictDoUpdate({ target: research_cache.id, set: { value: JSON.stringify({ ...backoff, targets: [...deferred.values()] }) } });
  }
  async function saveCollectionProgress(value: ResearchCollectionProgress) {
    await db.insert(research_cache).values({
      id: progressId, team_id: run.team_id, value: JSON.stringify(value), created_at: Date.now(),
    }).onConflictDoUpdate({ target: research_cache.id, set: { value: JSON.stringify(value) } });
  }
  let count = progress?.count || 0;
  let error: string | null = null;
  let failed = false;
  try {
    const sourceRetryAt = Math.max(...[source.url, source.feedUrl].filter(Boolean).map(url => backoff.retryAtByHost[collectionHost(url!)] || 0));
    if (!progress && source.kind !== "search" && sourceRetryAt > Date.now()) {
      const retryAfterMs = sourceRetryAt - Date.now();
      if (retryAfterMs <= MAX_COLLECTION_INLINE_WAIT_MS) return { collected: count, pending: true, retryAfterMs };
      progress = { urls: [], nextOffset: 0, count, articles: [...deferred.values()], articleOffset: 0,
        warning: `Source index deferred after HTTP 429 until ${new Date(sourceRetryAt).toISOString()}; coverage is incomplete.`,
      };
      await saveCollectionProgress(progress);
    }
    if (!progress) {
    const collection = await collectDiscoveredResearchSource(
      source, run.created_at - run.days * 86_400_000, run.created_at,
      researchDiscoveryBlockedHosts(RESEARCH_SOURCE_SEEDS),
      { deferArticleFetch: true },
    );
    const observedAt = Date.now();
    const observation = JSON.stringify({
      teamId: run.team_id, runId: run.id, sourceId, observedAt,
      windowStart: run.created_at - run.days * 86_400_000, windowEnd: run.created_at,
      items: collection.items.map(item => ({
        url: item.url, title: item.title, publishedAt: item.publishedAt,
        contentType: item.contentType, transcriptStatus: item.transcriptStatus,
        ...(item.contentProvenance ? { contentProvenance: item.contentProvenance } : {}),
        ...(item.content !== undefined ? { bodyCharacters: item.content.length } : {}),
      })),
      pendingArticles: collection.pendingArticles || [],
      deferredArticles: backoff.targets,
      warning: collection.warning,
    });
    await retryResearchStorage(async () => db.insert(research_cache).values({
      id: `collection-observation:${stepId}`, team_id: run.team_id, value: observation, created_at: observedAt,
    }).onConflictDoNothing());
    error = collection.warning;
    const itemUrls = new Set(collection.items.map(item => item.url));
    const pendingTargets = new Map([...(collection.pendingArticles || []), ...backoff.targets].map(target => [target.url, target]));
    const items: CollectedItem[] = [...collection.items, ...[...pendingTargets.values()].filter(target => !itemUrls.has(target.url)).map(target => ({
      url: target.url, title: target.title || new URL(target.url).pathname || new URL(target.url).hostname,
      excerpt: "", publishedAt: null, contentType: "article" as const, transcriptStatus: "not_applicable" as const,
    }))];
    const available = await db
      .select({ url: research_items.canonical_url, collectedAt: research_items.collected_at, publishedAt: research_items.published_at, transcriptStatus: research_items.transcript_status,
        title: research_items.title, excerpt: research_items.excerpt, contentHash: research_items.content_hash, contentProvenance: research_items.content_provenance,
        content: isPewResearchSource(source) ? research_items.content : sql<null>`NULL`,
        hasEvidence: sql<number>`${research_items.content} IS NOT NULL AND length(${research_items.content}) >= 500`,
      })
      .from(research_items)
      .where(
        and(
          eq(research_items.team_id, run.team_id),
          eq(research_items.source_id, sourceId),
        ),
      );
    const known = new Map(available.map(item => [item.url, { ...item,
      hasEvidence: isPewResearchSource(source) ? hasUsablePewResearchBody(item.content, item.title) : item.hasEvidence,
    }]));
    const articles = new Map((collection.pendingArticles || []).filter(target => {
      const item = known.get(target.url);
      return !item?.hasEvidence && (!item || item.collectedAt >= run.created_at - run.days * 86_400_000 ||
        (item.publishedAt || 0) >= run.created_at - run.days * 86_400_000);
    }).map(target => [target.url, target]));
    for (const item of collection.items) {
      const knownItem = known.get(item.url);
      if (item.contentType === "article" && (item.content?.trim().length || 0) < 500 && !knownItem?.hasEvidence &&
        item.publishedAt !== null && item.publishedAt <= run.created_at &&
        ((item.publishedAt || 0) >= run.created_at - run.days * 86_400_000 || !knownItem || knownItem.collectedAt >= run.created_at - run.days * 86_400_000)) {
        articles.set(item.url, { url: item.url, title: item.title });
      }
    }
    for (const target of backoff.targets) {
      if (known.get(target.url)?.hasEvidence) deferred.delete(target.url);
      else articles.set(target.url, target);
    }
    const videos = items.filter(
      (item) =>
        item.contentType === "video" &&
        item.publishedAt &&
        item.publishedAt <= run.created_at &&
        (item.publishedAt >= run.created_at - run.days * 86_400_000 ||
          !known.has(item.url) || known.get(item.url)!.collectedAt >= run.created_at - run.days * 86_400_000) &&
        known.get(item.url)?.transcriptStatus !== "available" &&
        !/#?shorts?\b/i.test(item.title),
    );
    const interviewPriority = (title: string) =>
      /interview|podcast|lessons|strategy|case study|conversation|deep dive/i.test(
        title,
      )
        ? 1
        : 0;
    videos.sort(
      (a, b) => interviewPriority(b.title) - interviewPriority(a.title),
    );
    for (const item of items) {
      if (!itemUrls.has(item.url) && known.has(item.url)) continue;
      const previous = known.get(item.url);
      const contentHash = item.content ? await researchHash(item.content) : null;
      const preserveKnownEvidence = (item.contentProvenance === "public_feed" || item.contentProvenance === "abstract") &&
        (previous?.contentProvenance === "article" || previous?.contentProvenance === "transcript");
      const bodyUnchanged = !item.content || preserveKnownEvidence ||
        previous?.contentHash === contentHash && previous.contentProvenance === (item.contentProvenance || "unknown") &&
        previous.transcriptStatus === item.transcriptStatus;
      if (previous && previous.title === item.title && previous.excerpt === item.excerpt &&
        (previous.publishedAt !== null || item.publishedAt === null) && bodyUnchanged) continue;
      const id = await researchHash(`${run.team_id}:${item.url}`);
      const inserted = await db
        .insert(research_items)
        .values({
          id,
          team_id: run.team_id,
          source_id: source.id,
          canonical_url: item.url,
          title: item.title,
          excerpt: item.excerpt,
          published_at: item.publishedAt,
          collected_at: Date.now(),
          content_type: item.contentType,
          transcript_status: item.transcriptStatus,
          content: item.content || null,
          content_provenance: item.contentProvenance || "unknown",
          content_hash: contentHash,
        })
        .onConflictDoNothing()
        .returning({ id: research_items.id })
        .get();
      if (inserted) count++;
      else {
        const preserveEvidence = sql`${item.contentProvenance === "public_feed" || item.contentProvenance === "abstract" ? 1 : 0} AND ${research_items.content_provenance} IN ('article', 'transcript')`;
        await db
          .update(research_items)
          .set({
            title: item.title,
            excerpt: item.excerpt,
            published_at: sql`COALESCE(${research_items.published_at}, ${item.publishedAt})`,
            ...(item.content ? {
              content: sql`CASE WHEN ${preserveEvidence} THEN ${research_items.content} ELSE ${item.content} END`,
              content_provenance: sql`CASE WHEN ${preserveEvidence} THEN ${research_items.content_provenance} ELSE ${item.contentProvenance || "unknown"} END`,
              content_hash: sql`CASE WHEN ${preserveEvidence} THEN ${research_items.content_hash} ELSE ${contentHash} END`,
              transcript_status: sql`CASE WHEN ${preserveEvidence} THEN ${research_items.transcript_status} ELSE ${item.transcriptStatus} END`,
            } : {}),
          })
          .where(
            and(
              eq(research_items.id, id),
              eq(research_items.team_id, run.team_id),
            ),
          );
      }
    }
    progress = { urls: videos.map(item => item.url), nextOffset: 0, count, warning: error,
      articles: [...articles.values()], articleOffset: 0, articleFailures: [],
    };
    await saveCollectionProgress(progress);
    }
    const articleQueue = progress.articles || [];
    const articleEnd = Math.min(articleQueue.length, (progress.articleOffset || 0) + 12);
    while ((progress.articleOffset || 0) < Math.min(articleEnd, articleQueue.length)) {
      const head = articleQueue[progress.articleOffset || 0];
      const host = collectionHost(head.url);
      const limit = progress.rateLimits?.[host];
      const retryAt = Math.max(limit?.retryAt || 0, backoff.retryAtByHost[host] || 0);
      if (limit?.exhausted || retryAt - Date.now() > MAX_COLLECTION_INLINE_WAIT_MS) {
        backoff.retryAtByHost[host] = retryAt;
        const reason = `HTTP 429: deferred until ${new Date(retryAt).toISOString()}${limit?.exhausted ? " after the technical retry budget was exhausted" : ""}.`;
        const pending = articleQueue.slice(progress.articleOffset || 0);
        const postponed = pending.filter(target => collectionHost(target.url) === host);
        progress.deferredArticles ||= [];
        for (const target of postponed) {
          if (!progress.deferredArticles.some(item => item.url === target.url)) progress.deferredArticles.push({ ...target, retryAt, reason });
          deferred.set(target.url, target);
        }
        articleQueue.splice(progress.articleOffset || 0, pending.length, ...pending.filter(target => collectionHost(target.url) !== host));
        await saveBackoff();
        await saveCollectionProgress(progress);
        continue;
      }
      if (retryAt > Date.now()) {
        await saveCollectionProgress(progress);
        return { collected: count, pending: true, retryAfterMs: retryAt - Date.now() };
      }
      const candidates = articleQueue.slice(progress.articleOffset || 0, Math.min(articleEnd, (progress.articleOffset || 0) + 3));
      const nextHost = candidates.findIndex(target => collectionHost(target.url) !== host);
      const targets = nextHost < 0 ? candidates : candidates.slice(0, nextHost);
      const results = await Promise.all(targets.map(async target => {
        try {
          const item = await fetchDiscoveredResearchArticle(source, target, run.created_at);
          await db.update(research_items).set({
            ...(item.title ? { title: item.title } : {}), excerpt: item.excerpt,
            published_at: sql`COALESCE(${research_items.published_at}, ${item.publishedAt})`,
            ...(item.content ? { content: item.content, content_hash: await researchHash(item.content), content_provenance: item.contentProvenance || "article" } : {}),
          }).where(and(eq(research_items.team_id, run.team_id), eq(research_items.canonical_url, target.url)));
          deferred.delete(target.url);
          return { target, rateLimit: null };
        } catch (caught) {
          if (caught instanceof ResearchRateLimitError) return { target, rateLimit: caught };
          (progress!.articleFailures ||= []).push(`${target.url}: ${researchSourceErrorMessage(caught)}`);
          deferred.delete(target.url);
          return { target, rateLimit: null };
        }
      }));
      const limited = results.filter(result => result.rateLimit !== null);
      const finished = results.filter(result => result.rateLimit === null);
      articleQueue.splice(progress.articleOffset || 0, targets.length, ...finished.map(result => result.target), ...limited.map(result => result.target));
      progress.articleOffset = (progress.articleOffset || 0) + finished.length;
      const limitedHosts = new Set(limited.map(result => collectionHost(result.target.url)));
      for (const limitedHost of limitedHosts) {
        const attempts = (progress.rateLimits?.[limitedHost]?.attempts || 0) + 1;
        const delay = Math.max(1000, ...limited.filter(result => collectionHost(result.target.url) === limitedHost).map(result => result.rateLimit!.retryAfterMs ?? 60_000 * 2 ** (attempts - 1)));
        const retryAt = Date.now() + delay;
        (progress.rateLimits ||= {})[limitedHost] = { attempts, retryAt, exhausted: attempts >= MAX_COLLECTION_RATE_ATTEMPTS };
        backoff.retryAtByHost[limitedHost] = retryAt;
      }
      for (const result of limited) deferred.set(result.target.url, result.target);
      for (const target of articleQueue.slice(progress.articleOffset || 0)) {
        if (limitedHosts.has(collectionHost(target.url))) deferred.set(target.url, target);
      }
      await saveBackoff();
      await saveCollectionProgress(progress);
    }
    await saveBackoff();
    error = [progress.warning, progress.articleFailures?.length ? `${progress.articleFailures.length} original article page(s) could not be fetched; collection coverage is incomplete.` : null,
      progress.deferredArticles?.length ? `${progress.deferredArticles.length} original article page(s) deferred after HTTP 429; saved for a later collection after cooldown. Coverage is incomplete.` : null,
    ].filter(Boolean).join(" ") || null;
    const transcriptEnd = Math.min(progress.urls.length, progress.nextOffset + 6);
    while (progress.nextOffset < transcriptEnd) {
      const urls = progress.urls.slice(progress.nextOffset, Math.min(transcriptEnd, progress.nextOffset + 2));
      await Promise.all(urls.map(async url => {
        const content = await fetchPublicYoutubeTranscript(url);
        if (!content) return;
        await db.update(research_items).set({
          content, content_hash: await researchHash(content), content_provenance: "transcript", transcript_status: "available",
        }).where(and(eq(research_items.team_id, run.team_id), eq(research_items.canonical_url, url)));
      }));
      progress.nextOffset += urls.length;
      await saveCollectionProgress(progress);
    }
    if ((progress.articleOffset || 0) < articleQueue.length || progress.nextOffset < progress.urls.length) {
      await db.update(research_run_sources).set({ item_count: count, error }).where(eq(research_run_sources.id, stepId));
      return { collected: count, pending: true };
    }
  } catch (caught) {
    failed = true;
    error = researchSourceErrorMessage(caught);
    if (caught instanceof ResearchRateLimitError) {
      const retryAt = Date.now() + Math.max(1000, caught.retryAfterMs ?? 60_000);
      backoff.retryAtByHost[caught.hostname.replace(/^www\./, "")] = retryAt;
      await saveBackoff();
      error = `${error}; source collection deferred until ${new Date(retryAt).toISOString()}. Coverage is incomplete.`;
    }
  }
  await db
    .update(research_run_sources)
    .set({ status: failed ? "failed" : "completed", item_count: count, error })
    .where(eq(research_run_sources.id, stepId));
  await db
    .update(research_sources)
    .set({
      last_collected_at: Date.now(),
      last_error: error,
      item_count: sql`(SELECT COUNT(*) FROM research_items WHERE team_id = ${run.team_id} AND source_id = ${sourceId})`,
    })
    .where(
      and(
        eq(research_sources.team_id, run.team_id),
        eq(research_sources.seed_id, sourceId),
      ),
    );
  await db
    .update(research_runs)
    .set({
      collected_count: sql`(SELECT COALESCE(SUM(item_count), 0) FROM research_run_sources WHERE run_id = ${run.id})`,
    })
    .where(eq(research_runs.id, run.id));
  return { collected: count, error };
}
async function cachedModel(
  run: typeof research_runs.$inferSelect,
  stage: string,
  input: unknown,
  system: string,
  schema: Record<string, unknown>,
  outputTokens: number,
) {
  const db = await getDb();
  const audience = await getFrozenResearchAudience(run);
  const enabledProfileIds = audience.publishingProfiles.map(profile => profile.id);
  const id = await researchHash(
    JSON.stringify([
      run.team_id,
      RESEARCH_MODEL,
      RESEARCH_PROMPT_VERSION,
      audience,
      stage,
      input,
    ]),
  );
  async function validateReusable(value: unknown) {
    try {
      const ids = (input as Array<{ id: string }>).map(item => item.id);
      if (stage === "screen") validateResearchScreening(researchScreeningSchema.parse(value), ids);
      if (stage === "evidence") {
        const findings = validateResearchEvidenceCoverage(researchEvidenceSchema.parse(value).findings, ids);
        validateResearchEvidenceProfiles(findings, enabledProfileIds);
      }
    } catch (error) {
      await db.insert(research_cache).values({
        id: `invalid:${id}:${Date.now()}`, team_id: run.team_id,
        value: JSON.stringify({ invalid: true, stage, response: value, reason: error instanceof Error ? error.message : "Invalid assessment coverage" }), created_at: Date.now(),
      }).onConflictDoNothing();
      await db.delete(research_cache).where(and(eq(research_cache.id, id), eq(research_cache.team_id, run.team_id)));
      throw error;
    }
  }
  const cached = await db
    .select()
    .from(research_cache)
    .where(
      and(eq(research_cache.id, id), eq(research_cache.team_id, run.team_id)),
    )
    .get();
  if (cached) {
    const value = JSON.parse(cached.value) as unknown;
    await validateReusable(value);
    await db
      .update(research_runs)
      .set({ cache_hits: sql`${research_runs.cache_hits} + 1` })
      .where(eq(research_runs.id, run.id));
    return value;
  }
  const result = await callResearchModel(
    system,
    { ...audience, items: input },
    stage === "evidence" ? evidenceJsonSchemaForItems((input as Array<{ id: string }>).map(item => item.id), enabledProfileIds) : schema,
    outputTokens,
    { teamId: run.team_id, runId: run.id, stage: "research", operation: run.mode === "replay" ? `replay_${stage}` : stage },
  );
  await validateReusable(result.value);
  const cacheValue = JSON.stringify(result.value);
  const cachedAt = Date.now();
  await retryResearchStorage(async () => db
    .insert(research_cache)
    .values({
      id,
      team_id: run.team_id,
      value: cacheValue,
      created_at: cachedAt,
    })
    .onConflictDoNothing());
  return result.value as unknown;
}
export { cachedModel as cachedResearchModel };
type ResearchRankDiagnostics = ResearchRunDiagnostics & Required<Pick<ResearchRunDiagnostics, "evidenceCount" | "rejectedStories" | "screenedCount">>;
type ResearchRankProgress = {
  candidateIds?: string[];
  discoveryCutoff?: number;
  screenOffset?: number;
  selectedIds: string[];
  nextOffset: number;
  diagnostics: ResearchRankDiagnostics;
  coverageWarning: string | null;
};
const MAX_RANK_EVIDENCE_BATCHES = 3;
const MAX_RANK_ROUTING_BATCHES = 3;

function researchScreenMetadata(item: typeof research_items.$inferSelect, run: typeof research_runs.$inferSelect) {
  return {
    id: item.id, title: item.title, excerpt: item.excerpt.slice(0, 900), publicText: item.content || null,
    contentProvenance: item.content_provenance, publishedAt: item.published_at, discoveredAt: item.collected_at,
    signalKind: researchItemSignalKind(item, run),
    sourceId: item.source_id,
  };
}
type ResearchRoutingPlan = {
  version: string; runId: string; teamId: string; offset: number; candidateIds: string[];
  decisions: Array<{ itemId: string; route: "direct_evidence" | "metadata_screen" | "unavailable";
    bodyCharacters: number; contentProvenance: string | null; contentHash: string | null; reason: string }>;
  screenInput: ReturnType<typeof researchScreenMetadata>[];
};
async function researchRoutingPlan(run: typeof research_runs.$inferSelect, ids: string[], rows: Array<typeof research_items.$inferSelect>, offset: number) {
  const db = await getDb(), id = `research-routing:${run.id}:${offset}`;
  const read = () => db.select().from(research_cache).where(and(eq(research_cache.id, id), eq(research_cache.team_id, run.team_id))).get();
  let saved = await read();
  if (!saved) {
    const decisions: ResearchRoutingPlan["decisions"] = [];
    for (const itemId of ids) {
      const item = rows.find(row => row.id === itemId), bodyCharacters = item?.content?.trim().length || 0;
      const usable = bodyCharacters >= 500 && (item?.source_id !== "pew-ai-original-research" || hasUsablePewResearchBody(item.content, item.title));
      decisions.push({ itemId, route: !item ? "unavailable" : usable ? "direct_evidence" : "metadata_screen",
        bodyCharacters, contentProvenance: item?.content_provenance || null, contentHash: item?.content ? await researchHash(item.content) : null,
        reason: !item ? "Frozen eligible item is no longer available; no model decision made."
          : usable ? "Existing usable public body meets the 500-character availability floor; assess its actual evidence and profile fit without a preliminary rejection gate."
          : "Public body is absent, shorter than the existing availability floor, or publisher chrome; screen supplied metadata before any required hydration.",
      });
    }
    const plan: ResearchRoutingPlan = { version: RESEARCH_PROMPT_VERSION, runId: run.id, teamId: run.team_id, offset,
      candidateIds: ids, decisions, screenInput: rows.filter(item => decisions.some(decision => decision.itemId === item.id && decision.route === "metadata_screen")).map(item => researchScreenMetadata(item, run)) };
    const value = JSON.stringify(plan), createdAt = Date.now();
    await retryResearchStorage(async () => db.insert(research_cache).values({ id, team_id: run.team_id, value, created_at: createdAt }).onConflictDoNothing());
    saved = await read();
  }
  if (!saved) throw new Error("Research routing plan was not saved");
  const plan = JSON.parse(saved.value) as ResearchRoutingPlan;
  const screenIds = plan.decisions?.filter(decision => decision.route === "metadata_screen").map(decision => decision.itemId);
  if (plan.version !== RESEARCH_PROMPT_VERSION || plan.runId !== run.id || plan.teamId !== run.team_id || plan.offset !== offset
    || JSON.stringify(plan.candidateIds) !== JSON.stringify(ids) || JSON.stringify(plan.decisions?.map(decision => decision.itemId)) !== JSON.stringify(ids)
    || plan.decisions.some(decision => !["direct_evidence", "metadata_screen", "unavailable"].includes(decision.route))
    || JSON.stringify(plan.screenInput?.map(item => item.id)) !== JSON.stringify(screenIds)) throw new Error("Saved research routing plan does not match its frozen candidate batch");
  return plan;
}

async function rankRun(run: typeof research_runs.$inferSelect) {
  const db = await getDb();
  const progressId = `rank-progress:${run.id}`;
  const saved = await db.select().from(research_cache).where(and(
    eq(research_cache.id, progressId), eq(research_cache.team_id, run.team_id),
  )).get();
  let progress = saved ? JSON.parse(saved.value) as ResearchRankProgress : undefined;
  async function persistProgress(progress: ResearchRankProgress) {
    const value = JSON.stringify(progress);
    const diagnostics = JSON.stringify(progress.diagnostics);
    const createdAt = Date.now();
    await retryResearchStorage(async () => db.batch([
      db.insert(research_cache).values({
        id: progressId, team_id: run.team_id, value, created_at: createdAt,
      }).onConflictDoUpdate({ target: research_cache.id, set: { value } }),
      db.update(research_runs).set({
        diagnostics,
        findings_count: researchRunFindingsCount(run.team_id, run.id),
      }).where(eq(research_runs.id, run.id)),
    ]));
  }
  await db.update(research_runs).set({ status: "ranking" }).where(eq(research_runs.id, run.id));
  if (!progress) {
    const sources = JSON.parse(run.source_ids) as string[];
    const discoveryCutoff = Date.now();
    const windowStart = run.created_at - run.days * 86_400_000;
    const articleWatches = RESEARCH_SOURCE_SEEDS.filter(source => source.kind === "web" && source.pageMode === "article" && sources.includes(source.id)).map(source => canonicalResearchUrl(source.url));
    const watchedUrls = sql`${research_items.canonical_url} IN (SELECT value FROM json_each(${JSON.stringify(articleWatches)}))`;
    const sourceRoster = or(sql`${research_items.source_id} IN (SELECT value FROM json_each(${JSON.stringify(sources)}))`, watchedUrls);
    const datedSignal = and(
      lte(research_items.published_at, run.created_at),
      or(gte(research_items.published_at, windowStart), and(gte(research_items.collected_at, windowStart), lte(research_items.collected_at, discoveryCutoff))),
    );
    const undatedWatchSignal = articleWatches.length ? and(
      isNull(research_items.published_at), watchedUrls,
      eq(research_items.content_type, "article"),
      gte(research_items.collected_at, windowStart), lte(research_items.collected_at, discoveryCutoff),
    ) : sql`0`;
    const eligibleSignal = and(
      or(datedSignal, undatedWatchSignal),
      or(eq(research_items.content_type, "article"), eq(research_items.transcript_status, "available")),
    );
    const candidates = await db
      .select({ id: research_items.id })
      .from(research_items)
      .where(
        and(
          eq(research_items.team_id, run.team_id),
          sourceRoster,
          eligibleSignal,
        ),
      )
      .orderBy(desc(sql`COALESCE(${research_items.published_at}, ${research_items.collected_at})`), research_items.id)
      .all();
    const coverage = await db.select({
      eligible: sql<number>`COALESCE(SUM(CASE WHEN ${eligibleSignal} THEN 1 ELSE 0 END), 0)`,
      fresh: sql<number>`COALESCE(SUM(CASE WHEN ${eligibleSignal} AND ${research_items.published_at} >= ${windowStart} THEN 1 ELSE 0 END), 0)`,
      evergreen: sql<number>`COALESCE(SUM(CASE WHEN ${eligibleSignal} AND ${research_items.published_at} < ${windowStart} THEN 1 ELSE 0 END), 0)`,
      undated: sql<number>`COALESCE(SUM(CASE WHEN ${research_items.published_at} IS NULL THEN 1 ELSE 0 END), 0)`,
      unavailableVideos: sql<number>`COALESCE(SUM(CASE WHEN ${datedSignal} AND ${research_items.content_type} = 'video' AND ${research_items.transcript_status} <> 'available' THEN 1 ELSE 0 END), 0)`,
    }).from(research_items).where(and(eq(research_items.team_id, run.team_id), sourceRoster)).get();
    const rejectedStories: Array<{ title: string; score: number | null; reason: string }> = [];
    const diagnostics: ResearchRankDiagnostics = {
      eligibleCount: Number(coverage?.eligible || 0), undatedCount: Number(coverage?.undated || 0),
      freshCount: Number(coverage?.fresh || 0), evergreenCount: Number(coverage?.evergreen || 0),
      unavailableVideoCount: Number(coverage?.unavailableVideos || 0), screenedCount: 0,
      routedCount: 0, directEvidenceCount: 0, incompleteScreenedCount: 0, routingUnavailableCount: 0,
      shortlistedCount: 0, evidenceCount: 0, rejectedStories,
      outcome: candidates.length ? 'Routing readable public bodies to evidence assessment and incomplete material to screening.' : 'No dated, readable items in this window. Check source coverage and unavailable transcripts.',
    };
    await db.update(research_runs).set({ diagnostics: JSON.stringify(diagnostics) }).where(eq(research_runs.id, run.id));
    progress = { candidateIds: candidates.map(item => item.id), discoveryCutoff, screenOffset: 0, selectedIds: [], nextOffset: 0, diagnostics, coverageWarning: null };
    await persistProgress(progress);
  }
  // Freeze membership before any evidence hydration changes stored item metadata.
  // Older checkpoints already contain their completed screening selection.
  const candidateIds = progress.candidateIds || [];
  for (let batches = 0; batches < MAX_RANK_ROUTING_BATCHES && (progress.screenOffset || 0) < candidateIds.length; batches++) {
      const ids = candidateIds.slice(progress.screenOffset || 0, (progress.screenOffset || 0) + RESEARCH_SCREEN_BATCH_SIZE);
      const rows = await db.select().from(research_items).where(and(
        eq(research_items.team_id, run.team_id), inArray(research_items.id, ids),
      )).all();
      const candidates = ids.flatMap(id => rows.filter(item => item.id === id));
      const routing = await researchRoutingPlan(run, ids, candidates, progress.screenOffset || 0);
      const metadata = routing.screenInput;
      const selected = new Set(routing.decisions.filter(decision => decision.route === "direct_evidence").map(decision => decision.itemId));
      if (metadata.length) {
        const screened = validateResearchScreening(
          researchScreeningSchema.parse(await cachedModel(
            run,
            "screen",
            metadata,
            RESEARCH_SCREEN_INSTRUCTIONS,
            screeningJsonSchemaForItems(metadata.map(item => item.id)),
            5000,
          )), metadata.map(item => item.id),
        );
        for (const itemId of screened.itemIds) selected.add(itemId);
        progress.diagnostics.rejectedStories.push(...screened.assessments.filter(item => !item.selected).map(assessment => ({
          title: metadata.find(item => item.id === assessment.itemId)!.title,
          score: null, reason: `Screening: ${assessment.reason}`,
        })));
      }
      progress.selectedIds.push(...ids.filter(id => selected.has(id)));
      const unavailable = routing.decisions.filter(decision => decision.route === "unavailable");
      for (const decision of unavailable) progress.diagnostics.rejectedStories.push({ title: decision.itemId, score: null, reason: decision.reason });
      progress.diagnostics.routedCount = (progress.diagnostics.routedCount ?? progress.screenOffset ?? 0) + ids.length;
      progress.diagnostics.directEvidenceCount = (progress.diagnostics.directEvidenceCount || 0) + routing.decisions.filter(decision => decision.route === "direct_evidence").length;
      progress.diagnostics.incompleteScreenedCount = (progress.diagnostics.incompleteScreenedCount || 0) + metadata.length;
      progress.diagnostics.routingUnavailableCount = (progress.diagnostics.routingUnavailableCount || 0) + unavailable.length;
      progress.screenOffset = (progress.screenOffset || 0) + ids.length;
      progress.diagnostics.screenedCount += metadata.length;
      progress.diagnostics.shortlistedCount = progress.selectedIds.length;
      progress.diagnostics.outcome = `Routed ${progress.diagnostics.routedCount} of ${candidateIds.length} eligible items: ${progress.diagnostics.directEvidenceCount} directly to evidence; ${progress.diagnostics.screenedCount} total model-screened, including ${progress.diagnostics.incompleteScreenedCount} incomplete-body decisions under this routing policy.`;
      await persistProgress(progress);
  }
  if ((progress.screenOffset || 0) < candidateIds.length) return { ok: true, pending: true };
  const diagnostics = progress.diagnostics;
  for (let batches = 0; batches < MAX_RANK_EVIDENCE_BATCHES && progress.nextOffset < progress.selectedIds.length; batches++) {
    const ids = progress.selectedIds.slice(progress.nextOffset, progress.nextOffset + RESEARCH_EVIDENCE_BATCH_SIZE);
    const rows = await db.select().from(research_items).where(and(
      eq(research_items.team_id, run.team_id), inArray(research_items.id, ids),
    )).all();
    const shortlisted = ids.flatMap(id => rows.filter(item => item.id === id));
    for (const itemId of ids.filter(id => !shortlisted.some(item => item.id === id))) diagnostics.rejectedStories.push({
      title: itemId, score: null, reason: "Public evidence unavailable: the frozen selected item no longer exists.",
    });
    const full = await Promise.allSettled(shortlisted.map(async item => {
      if (item.content) return item;
      const source = RESEARCH_SOURCE_SEEDS.find(seed => seed.id === item.source_id)!;
      const html = await fetchResearchText(item.canonical_url, sourceHosts(source.kind === "search"
        ? { ...source, url: item.canonical_url, feedUrl: undefined } : source));
      const content = (item.content_provenance === "abstract"
        ? researchAbstractText(html) : articleResearchText(html)).slice(0, 14_000);
      if (content.length < 500) throw new Error("Insufficient article evidence");
      const contentHash = await researchHash(content);
      const contentProvenance = item.content_provenance === "abstract" ? "abstract" : "article";
      await db.update(research_items).set({ content, content_hash: contentHash, content_provenance: contentProvenance })
        .where(and(eq(research_items.id, item.id), eq(research_items.team_id, run.team_id)));
      return { ...item, content, content_hash: contentHash, content_provenance: contentProvenance };
    }));
    full.forEach((result, index) => {
      if (result.status === "rejected") diagnostics.rejectedStories.push({
        title: shortlisted[index].title, score: null,
        reason: `Public evidence unavailable: ${result.reason instanceof Error ? result.reason.message.slice(0, 250) : "article could not be read"}`,
      });
    });
    const batch = full.flatMap(item => item.status === "fulfilled" && item.value.content ? [item.value] : []);
    if (batch.length) {
      const input = batch.map(item => ({
        id: item.id, title: item.title, sourceId: item.source_id, publishedAt: item.published_at,
        discoveredAt: item.collected_at,
        signalKind: researchItemSignalKind(item, run),
        content: item.content, contentProvenance: item.content_provenance,
      }));
      const output = researchEvidenceSchema.parse(await cachedModel(
        run, "evidence", input, RESEARCH_EVIDENCE_INSTRUCTIONS,
        evidenceJsonSchemaForItems(batch.map(item => item.id)), 8192,
      ));
      validateResearchEvidenceCoverage(output.findings, batch.map(item => item.id));
      const accepted = validateResearchEvidence(output.findings, batch.map(item => ({ id: item.id, content: item.content! })));
      for (const item of batch) {
        if (accepted.some(finding => finding.itemId === item.id)) continue;
        const assessment = output.findings.find(finding => finding.itemId === item.id);
        let reason = "No supported editorial assessment was returned for this story.";
        if (assessment) reason = assessment.score < 70
          ? assessment.limitations
          : "The supporting quote could not be verified against the source.";
        diagnostics.rejectedStories.push({
          title: item.title, score: assessment?.score ?? null,
          reason,
        });
      }
      for (const finding of accepted) {
        const item = batch.find((item) => item.id === finding.itemId)!;
        const familyKey = finding.familyKey
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        if (!familyKey) continue;
        const bundleId = `research-family-sources:${run.id}:${familyKey}`;
        const existingBundle = await db.select().from(research_cache).where(and(
          eq(research_cache.id, bundleId), eq(research_cache.team_id, run.team_id),
        )).get();
        const members = new Map<string, { itemId: string; evidence: string }>(
          (existingBundle ? JSON.parse(existingBundle.value).items : []).map((member: { itemId: string; evidence: string }) => [member.itemId, member]),
        );
        members.set(item.id, { itemId: item.id, evidence: finding.evidence });
        const bundle = JSON.stringify({ items: [...members.values()] });
        await db.insert(research_cache).values({
          id: bundleId, team_id: run.team_id, value: bundle, created_at: Date.now(),
        }).onConflictDoUpdate({ target: research_cache.id, set: { value: bundle } });
        const familyOwner = await db.select({ id: research_findings.id, itemId: research_findings.item_id })
          .from(research_findings).where(and(
            eq(research_findings.team_id, run.team_id),
            eq(research_findings.family_key, familyKey),
          )).get();
        if (familyOwner && familyOwner.itemId !== item.id) {
          diagnostics.rejectedStories.push({
            title: item.title, score: finding.score,
            reason: "This story family already has a saved finding from another source; retained that finding and its review state.",
          });
          continue;
        }
        const legacyId = await researchHash(`${run.team_id}:${item.id}`);
        const legacyFinding = await db.select().from(research_findings).where(and(
          eq(research_findings.id, legacyId), eq(research_findings.team_id, run.team_id),
        )).get();
        const findingId = familyOwner?.id || (finding.isAdditional || legacyFinding && legacyFinding.family_key !== familyKey
          ? await researchHash(`${run.team_id}:${item.id}:angle:${familyKey}`) : legacyId);
        const existingFinding = findingId === legacyId ? legacyFinding : await db.select().from(research_findings).where(and(
          eq(research_findings.id, findingId), eq(research_findings.team_id, run.team_id),
        )).get();
        if (existingFinding) await saveResearchFindingSnapshot(existingFinding);
        const qualified: ResearchFindingRow = {
          id: findingId, team_id: run.team_id, run_id: run.id, item_id: item.id,
          source_id: item.source_id, title: item.title, url: item.canonical_url,
          published_at: item.published_at ?? item.collected_at,
          source_published_at: item.published_at, source_discovered_at: item.collected_at,
          signal_kind: researchItemSignalKind(item, run),
          status: existingFinding?.status || "new", idea_id: existingFinding?.idea_id || null,
          created_at: existingFinding?.created_at ?? Date.now(), content_type: item.content_type, transcript_status: item.transcript_status,
          score: finding.score, summary: finding.summary, why_it_matters: finding.whyItMatters,
          content_angle: finding.contentAngle, evidence: finding.evidence, limitations: finding.limitations,
          family_key: familyKey,
        };
        await saveResearchFindingSnapshot(qualified);
        await db
          .insert(research_findings)
          .values(qualified)
          .onConflictDoUpdate({
            target: research_findings.id,
            set: {
              run_id: run.id,
              score: finding.score,
              summary: finding.summary,
              why_it_matters: finding.whyItMatters,
              content_angle: finding.contentAngle,
              evidence: finding.evidence,
              limitations: finding.limitations,
              family_key: familyKey,
              source_id: qualified.source_id,
              title: qualified.title,
              url: qualified.url,
              published_at: qualified.published_at,
              source_published_at: qualified.source_published_at,
              source_discovered_at: qualified.source_discovered_at,
              signal_kind: qualified.signal_kind,
              content_type: qualified.content_type,
              transcript_status: qualified.transcript_status,
            },
          });
      }
    }
    diagnostics.evidenceCount += batch.length;
    progress.nextOffset += ids.length;
    if (progress.nextOffset < progress.selectedIds.length) {
      diagnostics.outcome = `Reviewed public evidence for ${diagnostics.evidenceCount} of ${progress.selectedIds.length} shortlisted stories; review will continue in the next batch.`;
    } else if (diagnostics.evidenceCount) {
      diagnostics.outcome = `Reviewed public evidence for ${diagnostics.evidenceCount} shortlisted stories.`;
    } else {
      diagnostics.outcome = `Shortlisted ${progress.selectedIds.length} stories, but their public evidence could not be read.`;
    }
    await persistProgress(progress);
  }
  if (progress.nextOffset < progress.selectedIds.length) return { ok: true, pending: true };
  if (!progress.selectedIds.length && diagnostics.screenedCount) {
    diagnostics.outcome = `Screened ${diagnostics.screenedCount} eligible items; none had a strong profile-relevant angle.`;
    await persistProgress(progress);
  }
  const failed = await db
    .select()
    .from(research_run_sources)
    .where(
      and(
        eq(research_run_sources.run_id, run.id),
        eq(research_run_sources.status, "failed"),
      ),
    )
    .all();
  await db
    .update(research_runs)
    .set({
      status:
        failed.length === run.source_count
          ? "failed"
          : run.editorial
            ? "drafting"
            : "completed",
      completed_at: Date.now(),
      findings_count: researchRunFindingsCount(run.team_id, run.id),
      error:
        [
          failed.length
            ? `${failed.length} source(s) failed; see source errors.`
            : null,
          progress.coverageWarning,
        ]
          .filter(Boolean)
          .join(" ") || null,
    })
    .where(eq(research_runs.id, run.id));
  return { ok: true, pending: false };
}
export async function processResearchJob(job: ResearchJob) {
  const db = await getDb();
  if (job.operation === "daily") {
    const now = Date.now();
    const unclaimed = or(
      isNull(research_settings.daily_claim_until),
      lte(research_settings.daily_claim_until, now),
    );
    const due = await db
      .select()
      .from(research_settings)
      .where(
        and(
          eq(research_settings.daily_enabled, true),
          or(
            and(
              isNotNull(research_settings.daily_time),
              lte(research_settings.next_daily_at, now),
            ),
            and(
              isNull(research_settings.daily_time),
              or(
                isNull(research_settings.last_daily_at),
                lte(research_settings.last_daily_at, now - 86_400_000),
              ),
            ),
          ),
          unclaimed,
        ),
      )
      .limit(25)
      .all();
    let dispatched = 0;
    for (const settings of due) {
      const claimId = crypto.randomUUID();
      const claim = await db.update(research_settings).set({
        daily_claim_id: claimId,
        daily_claim_until: now + 600_000,
      }).where(and(
        eq(research_settings.team_id, settings.team_id),
        eq(research_settings.daily_enabled, true),
        settings.daily_time === null
          ? isNull(research_settings.daily_time)
          : eq(research_settings.daily_time, settings.daily_time),
        eq(research_settings.daily_timezone, settings.daily_timezone),
        settings.next_daily_at === null
          ? isNull(research_settings.next_daily_at)
          : eq(research_settings.next_daily_at, settings.next_daily_at),
        settings.last_daily_at === null
          ? isNull(research_settings.last_daily_at)
          : eq(research_settings.last_daily_at, settings.last_daily_at),
        unclaimed,
      )).returning({ teamId: research_settings.team_id }).get();
      if (!claim) continue;
      try {
        const occurrence = settings.daily_time
          ? `fixed:${settings.daily_timezone}:${settings.daily_time}:${settings.next_daily_at}`
          : `rolling:${settings.last_daily_at ?? 0}`;
        let scheduledRunId = settings.daily_pending_run_id;
        if (!scheduledRunId) {
          const queued = await db.select().from(research_runs).where(and(
            eq(research_runs.team_id, settings.team_id),
            ne(research_runs.mode, "replay"),
            eq(research_runs.status, "queued"),
          )).get();
          scheduledRunId = queued?.id.startsWith("daily-")
            ? queued.id
            : `daily-${await researchHash(`${settings.team_id}:${occurrence}`)}`;
          // Persist the association before dispatch, including across settings
          // edits, so an interrupted recovery cannot create a second workflow.
          const linked = await db.update(research_settings)
            .set({ daily_pending_run_id: scheduledRunId })
            .where(and(
              eq(research_settings.team_id, settings.team_id),
              eq(research_settings.daily_claim_id, claimId),
            )).returning({ teamId: research_settings.team_id }).get();
          if (!linked) continue;
        }
        const previous = await db.select().from(research_runs)
          .where(eq(research_runs.id, scheduledRunId)).get();
        // Recover a dispatch that succeeded before a Worker interruption. An
        // unrelated active manual/editorial run leaves this occurrence due.
        const result = previous && terminal(previous.status)
          ? { run: runView(previous) }
          : await createResearchRun(
            settings.team_id, { days: 1, mode: "scan" }, true, scheduledRunId,
          );
        if (result.run.id !== scheduledRunId) continue;
        const dispatchedAt = Date.now();
        const saved = await db
          .update(research_settings)
          .set({
            last_daily_at: dispatchedAt,
            next_daily_at: settings.daily_time
              ? nextResearchDailyAt(settings.daily_time, settings.daily_timezone, dispatchedAt, true)
              : null,
            daily_claim_id: null,
            daily_claim_until: null,
            daily_pending_run_id: null,
          })
          .where(and(
            eq(research_settings.team_id, settings.team_id),
            eq(research_settings.daily_claim_id, claimId),
          ))
          .returning({ teamId: research_settings.team_id }).get();
        if (saved) dispatched++;
      } catch (error) {
        console.error("[research] Daily dispatch failed; the next tick will retry", {
          teamId: settings.team_id,
          error: researchSourceErrorMessage(error),
        });
      } finally {
        await db.update(research_settings)
          .set({ daily_claim_id: null, daily_claim_until: null })
          .where(and(
            eq(research_settings.team_id, settings.team_id),
            eq(research_settings.daily_claim_id, claimId),
          ));
      }
    }
    return { dispatched };
  }
  if (!job.runId) throw new Error("runId is required");
  const run = await db
    .select()
    .from(research_runs)
    .where(eq(research_runs.id, job.runId))
    .get();
  if (!run) throw new Error("Run not found");
  if (run.mode === "replay" && job.operation !== "fail") {
    const { processResearchReplay } = await import("./research-replay");
    return processResearchReplay(run, job.operation);
  }
  if (job.operation === "drafts") {
    const { processResearchDraftJob } = await import("./research-drafts");
    return processResearchDraftJob(run.id);
  }
  if (terminal(run.status)) return { sourceIds: [], done: true };
  if (job.operation === "fail") {
    await db
      .update(research_runs)
      .set({
        status: "failed",
        completed_at: Date.now(),
        error: (job.error || "Research job failed").slice(0, 500),
      })
      .where(eq(research_runs.id, run.id));
    return { ok: true };
  }
  if (job.operation === "plan") {
    await db
      .update(research_runs)
      .set({ status: "collecting", error: null })
      .where(eq(research_runs.id, run.id));
    return { sourceIds: JSON.parse(run.source_ids) as string[] };
  }
  if (job.operation === "collect") {
    if (!job.sourceId) throw new Error("sourceId is required");
    return collectForRun(run, job.sourceId);
  }
  if (job.operation === "rank") {
    const collected = await db
      .select()
      .from(research_run_sources)
      .where(eq(research_run_sources.run_id, run.id))
      .all();
    if (
      collected.length !== run.source_count ||
      collected.some((source) => source.status === "pending")
    )
      throw new Error("Source collection has not finished");
    if (run.mode === "collect") {
      const failed = await db
        .select()
        .from(research_run_sources)
        .where(
          and(
            eq(research_run_sources.run_id, run.id),
            eq(research_run_sources.status, "failed"),
          ),
        )
        .all();
      await db
        .update(research_runs)
        .set({
          status: failed.length === run.source_count ? "failed" : "completed",
          completed_at: Date.now(),
          error: failed.length
            ? `${failed.length} source(s) failed; see source errors.`
            : null,
        })
        .where(eq(research_runs.id, run.id));
      return { ok: true };
    }
    return rankRun(run);
  }
  throw new Error("Unknown research operation");
}
export async function actOnResearchFinding(teamId: string, input: unknown) {
  const data = z
    .object({ id: z.string(), action: z.enum(["save_idea", "dismiss"]) })
    .strict()
    .parse(input);
  const db = await getDb();
  const finding = await db
    .select()
    .from(research_findings)
    .where(
      and(
        eq(research_findings.id, data.id),
        eq(research_findings.team_id, teamId),
      ),
    )
    .get();
  if (!finding) throw new Error("Finding not found");
  if (data.action === "dismiss") {
    await db
      .update(research_findings)
      .set({ status: "dismissed" })
      .where(
        and(
          eq(research_findings.id, data.id),
          eq(research_findings.team_id, teamId),
        ),
      );
    return { ok: true };
  }
  const ideaId = finding.idea_id || `research-${finding.id}`;
  const now = Date.now();
  const dates = researchFindingDates(finding);
  const dateText = dates.publishedAt === null
    ? `Publication date unknown${dates.discoveredAt === null ? "" : `\nFirst seen: ${new Date(dates.discoveredAt).toISOString()}`}`
    : `Published: ${new Date(dates.publishedAt).toISOString().slice(0, 10)}`;
  const text = `${finding.title}\n\n${finding.content_angle}\n\n${finding.summary}\n\nWhy it matters: ${finding.why_it_matters}\n\nEvidence: “${finding.evidence}”\n\nSource: ${finding.url}\n${dateText}${finding.limitations ? `\nLimitations: ${finding.limitations}` : ""}`;
  await db.batch([
    db
      .insert(ideas)
      .values({
        id: ideaId,
        team_id: teamId,
        text,
        status: "open",
        created_at: now,
        updated_at: now,
      })
      .onConflictDoNothing(),
    db
      .update(research_findings)
      .set({ status: "saved", idea_id: ideaId })
      .where(
        and(
          eq(research_findings.id, data.id),
          eq(research_findings.team_id, teamId),
        ),
      ),
  ]);
  return { ideaId };
}
