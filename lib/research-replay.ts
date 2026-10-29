import { ResearchCacheOnlyMiss } from './research-cache-only';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from './db/client';
import { research_cache, research_runs, research_sources } from './schema';
import { getFrozenResearchAudience, parseResearchAudience } from './research-audience';
import { RESEARCH_SELECTION_VIEW_VERSION } from './research-selection-audience';
import { retryResearchStorage } from './research-storage';
import { RESEARCH_SOURCE_SEEDS } from './research-sources';
import { assertPublicResearchUrl, canonicalResearchUrl } from './research-collectors';
import { hasUsablePewResearchBody } from './research-pew';
import { RESEARCH_POST_MIN_SCORE } from './research-policy';
import type { EvidenceCacheValue, EvidenceFailure } from './research-evidence-cache';
import { ResearchCoveragePending, RESEARCH_COVERAGE_VERSION, RESEARCH_WINDOW_SCOPE_INSTRUCTIONS } from './research-coverage';
import { RESEARCH_SOURCE_REVIEW_INSTRUCTIONS, RESEARCH_SOURCE_REVIEW_CONSISTENCY_VERSION, RESEARCH_SOURCE_REVIEW_CONSISTENCY_INSTRUCTIONS, researchSourceReviewSchemaForItems } from './research-source-review-model';
import { RESEARCH_SOURCE_DEPTH_PIPELINE_VERSION as RESEARCH_SOURCE_REVIEW_VERSION, RESEARCH_SOURCE_DEPTH_VERSION, RESEARCH_SOURCE_DEPTH_INSTRUCTIONS, RESEARCH_SOURCE_DEPTH_SONNET_INSTRUCTIONS, researchSourceDepthSchema } from './research-source-depth-model';
import { RESEARCH_SOURCE_DEPTH_QUOTES_GROUPING_VERSION, RESEARCH_SOURCE_DEPTH_QUOTES_VERSION, RESEARCH_SOURCE_DEPTH_QUOTES_INSTRUCTIONS, RESEARCH_SOURCE_DEPTH_QUOTES_SONNET_INSTRUCTIONS } from './research-source-depth-quotes';
import { RESEARCH_SOURCE_DEPTH_QUESTIONS_GROUPING_VERSION, RESEARCH_SOURCE_DEPTH_QUESTIONS_VERSION, RESEARCH_SOURCE_DEPTH_QUESTIONS_TRANSPORT, RESEARCH_SOURCE_DEPTH_QUESTIONS_INSTRUCTIONS, RESEARCH_SOURCE_DEPTH_QUESTIONS_SONNET_INSTRUCTIONS } from './research-source-depth-questions';
import { RESEARCH_SOURCE_PACKET_VERSION, RESEARCH_SOURCE_PACKET_INSTRUCTIONS, researchSourcePacketSchema } from './research-source-packet-model';
import { researchPacketsFromDefinitions, researchSourcePacketPolicy, researchSourcePacketPolicyContract, RESEARCH_SOURCE_PACKET_V2_REVIEW, RESEARCH_SOURCE_PACKET_V3_REVIEW, RESEARCH_SOURCE_PACKET_V4_REVIEW, RESEARCH_SOURCE_PACKET_V5_REVIEW, RESEARCH_SOURCE_PACKET_V6_REVIEW } from './research-source-packets';
import { RESEARCH_SOURCE_ARTIFACT_VERSION, RESEARCH_SOURCE_ARTIFACT_INSTRUCTIONS, RESEARCH_SOURCE_ARTIFACT_MODEL, RESEARCH_SOURCE_ARTIFACT_FORMAT, researchSourceArtifactContract, validResearchArtifactSourceFormats } from './research-source-artifact';
import { RESEARCH_MODEL, RESEARCH_PROMPT_VERSION, RESEARCH_SCREEN_INSTRUCTIONS, RESEARCH_EVIDENCE_INSTRUCTIONS,
  RESEARCH_SCREEN_BATCH_SIZE, RESEARCH_EVIDENCE_BATCH_SIZE, RESEARCH_EVIDENCE_OUTPUT_TOKENS, RESEARCH_SECTION_COVERAGE_INSTRUCTIONS, researchHash, researchScreeningSchema,
  researchEvidenceSchema, screeningJsonSchemaForItems, evidenceJsonSchemaForItems, validateResearchScreening,
  validateResearchEvidenceCoverage, validateResearchEvidenceProfiles, validateResearchEvidence } from './research-model';

const timestamp = z.number().int().nonnegative();
const sourcePacketDefinitionSchema = z.object({ id: z.string().min(1).max(200), primarySourceId: z.string().min(1).max(200),
  sourceIds: z.array(z.string().min(1).max(200)).min(2),
  relationship: z.object({ type: z.enum(['same_publisher', 'same_product', 'same_repository', 'configured_reference']), reason: z.string().trim().min(20).max(4000) }).strict(),
}).strict().refine(packet => new Set(packet.sourceIds).size === packet.sourceIds.length && packet.sourceIds.includes(packet.primarySourceId), 'Packet requires distinct sources including its primary');
const publicUrl = z.string().max(4000).refine(value => { try { assertPublicResearchUrl(value); return true; } catch { return false; } }, 'A public HTTPS source URL is required');
export const researchReplayItemSchema = z.object({
  id: z.string().min(1).max(200), sourceId: z.string().min(1).max(200), url: publicUrl,
  title: z.string().min(1).max(4000), excerpt: z.string().max(14000),
  publishedAt: timestamp.nullable(), discoveredAt: timestamp.nullable(), content: z.string().max(64000).nullable(),
  contentProvenance: z.string().min(1).max(100).nullable(),
  contentType: z.enum(['article', 'video']), transcriptStatus: z.enum(['not_applicable', 'available', 'unavailable', 'pending']),
  bodyCapturedAt: timestamp.optional(), bodyOrigin: z.enum(['inventory', 'saved_public_hydration']).optional(),
}).strict();
const prepareSchema = z.object({ cacheOnly: z.literal(true).optional(), operation: z.literal('prepare'), runId: z.uuid(), audienceRunId: z.string().min(1).max(100),
  windowStart: timestamp, windowEnd: timestamp, inventorySha256: z.string().regex(/^[a-f0-9]{64}$/),
  inventoryCount: z.number().int().positive().max(100000), sourceIds: z.array(z.string().min(1).max(200)).min(1),
  depthModel: z.enum(['gpt-6-sol', 'claude-sonnet-5-5']).optional(),
  depthGroupingVersion: z.enum([RESEARCH_SOURCE_DEPTH_QUOTES_GROUPING_VERSION, RESEARCH_SOURCE_DEPTH_QUESTIONS_GROUPING_VERSION]).optional(),
  artifactSourceIds: z.array(z.string().min(1).max(200)).min(1).refine(ids => new Set(ids).size === ids.length, 'Artifact source IDs must be unique').optional(),
  artifactSourceFormats: z.record(z.string().min(1).max(200), z.literal('research_intake_form')).refine(map => Object.keys(map).length > 0, 'Artifact format overrides must not be empty').optional(),
  sourcePackets: z.array(sourcePacketDefinitionSchema).min(1).optional(),
  sourcePacketReviewVersion: z.enum([RESEARCH_SOURCE_PACKET_V2_REVIEW, RESEARCH_SOURCE_PACKET_V3_REVIEW, RESEARCH_SOURCE_PACKET_V4_REVIEW, RESEARCH_SOURCE_PACKET_V5_REVIEW, RESEARCH_SOURCE_PACKET_V6_REVIEW]).optional(),
  freshnessWindowStart: timestamp.optional(), observationWindowStart: timestamp.optional(), observationWindowEnd: timestamp.optional(),
}).strict().refine(input => input.windowStart < input.windowEnd, 'Window end must follow start')
  .refine(input => input.freshnessWindowStart === undefined || input.freshnessWindowStart >= input.windowStart && input.freshnessWindowStart < input.windowEnd, 'Freshness boundary must be inside the publication window')
  .refine(input => input.observationWindowStart === undefined && input.observationWindowEnd === undefined
    || input.observationWindowStart !== undefined && input.observationWindowEnd !== undefined && input.observationWindowStart < input.observationWindowEnd, 'Observation windows require both ordered boundaries')
  .refine(input => new Set(input.sourceIds).size === input.sourceIds.length, 'Source IDs must be unique')
  .refine(input => !input.depthGroupingVersion || input.depthModel === 'claude-sonnet-5-5', 'Depth grouping requires the explicit Sonnet research grader')
  .refine(input => input.artifactSourceFormats === undefined || validResearchArtifactSourceFormats(input.artifactSourceFormats, input.artifactSourceIds), 'Artifact formats require overridden IDs in artifactSourceIds')
  .refine(input => !input.sourcePackets || new Set(input.sourcePackets.map(packet => packet.id)).size === input.sourcePackets.length, 'Packet IDs must be unique')
  .refine(input => !input.sourcePacketReviewVersion || !!input.sourcePackets, 'A packet review policy requires source packets');
export const researchReplayRequestSchema = z.discriminatedUnion('operation', [prepareSchema,
  z.object({ operation: z.literal('upload'), runId: z.uuid(), chunkIndex: z.number().int().nonnegative(), items: z.array(researchReplayItemSchema).min(1).max(20) }).strict(),
  z.object({ operation: z.literal('start'), runId: z.uuid() }).strict(),
]);
export async function readResearchReplayRequest(request: Request) {
  const maxBytes = 1_800_000;
  if (Number(request.headers.get('content-length') || 0) > maxBytes) throw new Error('Replay request is too large');
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('Replay request body is required');
  const decoder = new TextDecoder();
  let bytes = 0, text = '';
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new Error('Replay request is too large'); }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally { reader.releaseLock(); }
}
export type ResearchReplayItem = z.infer<typeof researchReplayItemSchema>;
type Run = typeof research_runs.$inferSelect;
type Config = Omit<z.infer<typeof prepareSchema>, 'operation'> & { model: string; version: string; contractHash: string; coverageVersion: string; sourceReviewVersion: string; icp: string; articleWatchUrls?: string[] };
type Entry = { id: string; chunkIndex: number; index: number; route: 'direct_evidence' | 'metadata_screen' | 'excluded'; reason: string | null };
type Plan = { config: Config; uploadedSha256: string; entries: Entry[]; eligibleIds: string[] };
type Progress = { screenOffset: number; selectedIds: string[]; evidenceOffset: number; screenedCount: number; evidenceCount: number; qualifiedCount: number; groundingFailureCount?: number; packetsComplete?: boolean };
const prefix = (runId: string) => `research-replay:${runId}:`;
async function read(teamId: string, id: string) {
  const db = await getDb();
  return db.select().from(research_cache).where(and(eq(research_cache.team_id, teamId), eq(research_cache.id, id))).get();
}
async function immutable(teamId: string, id: string, value: unknown) {
  const db = await getDb(), serialized = JSON.stringify(value), at = Date.now();
  if (new TextEncoder().encode(serialized).length > 1_800_000) throw new Error('Replay storage chunk is too large');
  await retryResearchStorage(async () => db.insert(research_cache).values({ id, team_id: teamId, value: serialized, created_at: at }).onConflictDoNothing());
  const saved = await read(teamId, id);
  if (!saved || saved.value !== serialized) throw new Error('Replay immutable snapshot differs from the saved input');
}
function sourceReviewVersion(grouping?: Config['depthGroupingVersion'], artifacts?: Config['artifactSourceIds']) {
  if (artifacts) return RESEARCH_SOURCE_REVIEW_VERSION.replace(/depth-v1$/, 'depth-artifact-routed-v1');
  return grouping ? RESEARCH_SOURCE_REVIEW_VERSION.replace(/depth-v1$/, grouping === RESEARCH_SOURCE_DEPTH_QUESTIONS_GROUPING_VERSION ? 'depth-quotes-and-questions-v2' : 'depth-quotes-v2') : RESEARCH_SOURCE_REVIEW_VERSION;
}
async function contractHash(depthModel?: Config['depthModel'], extensions?: Pick<Config, 'depthGroupingVersion' | 'sourcePackets' | 'artifactSourceIds' | 'sourcePacketReviewVersion' | 'cacheOnly' | 'artifactSourceFormats'>) {
  const contract = { model: RESEARCH_MODEL, version: RESEARCH_PROMPT_VERSION,
    coverageVersion: RESEARCH_COVERAGE_VERSION, coverageScope: RESEARCH_WINDOW_SCOPE_INSTRUCTIONS,
    sourceReviewVersion: RESEARCH_SOURCE_REVIEW_VERSION, sourceReviewInstructions: RESEARCH_SOURCE_REVIEW_INSTRUCTIONS,
    sourceReviewConsistencyVersion: RESEARCH_SOURCE_REVIEW_CONSISTENCY_VERSION, sourceReviewConsistencyInstructions: RESEARCH_SOURCE_REVIEW_CONSISTENCY_INSTRUCTIONS,
    sourceDepthVersion: RESEARCH_SOURCE_DEPTH_VERSION, sourceDepthInstructions: RESEARCH_SOURCE_DEPTH_INSTRUCTIONS,
    sourceDepthSonnetInstructions: RESEARCH_SOURCE_DEPTH_SONNET_INSTRUCTIONS, sourceDepthModelOverrideCapabilityVersion: 'replay-depth-model-overrides-v2',
    sourceDepthModelOverrideCapability: ['gpt-6-sol', 'claude-sonnet-5-5'], sourceDepthModel: depthModel ?? RESEARCH_MODEL,
    sourceDepthSchema: researchSourceDepthSchema({ id: 'item', content: '' }, ['profile']),
    sourceReviewSchema: researchSourceReviewSchemaForItems(['item'], ['profile']),
    screen: RESEARCH_SCREEN_INSTRUCTIONS, evidence: RESEARCH_EVIDENCE_INSTRUCTIONS,
    sectionInstructions: RESEARCH_SECTION_COVERAGE_INSTRUCTIONS, evidenceOutputTokens: RESEARCH_EVIDENCE_OUTPUT_TOKENS,
    screenSchema: screeningJsonSchemaForItems(['item']), evidenceSchema: evidenceJsonSchemaForItems(['item'], ['profile'], { sectionCoverage: true }),
    score: RESEARCH_POST_MIN_SCORE, selectionViewVersion: RESEARCH_SELECTION_VIEW_VERSION, route: 'readable-500-pew-guard-v1' };
  return researchHash(JSON.stringify(extensions?.depthGroupingVersion || extensions?.sourcePackets || extensions?.artifactSourceIds || extensions?.cacheOnly ? { ...contract,
    extensions: { ...(extensions.cacheOnly ? { cacheOnly: true, cacheOnlyVersion: 'zero-provider-before-claim-v1' } : {}), ...(extensions.depthGroupingVersion ? { depthGroupingVersion: extensions.depthGroupingVersion, quotePolicy: RESEARCH_SOURCE_DEPTH_QUOTES_VERSION,
      quoteInstructions: RESEARCH_SOURCE_DEPTH_QUOTES_INSTRUCTIONS, quoteSonnetInstructions: RESEARCH_SOURCE_DEPTH_QUOTES_SONNET_INSTRUCTIONS, outputBudgetVersion: 'group-count-1024-plus2048-v1',
      transportBudgetVersion: 'quote-output-over16384-declared240000-lease270000-v1',
      ...(extensions.depthGroupingVersion === RESEARCH_SOURCE_DEPTH_QUESTIONS_GROUPING_VERSION ? { questionPolicy: RESEARCH_SOURCE_DEPTH_QUESTIONS_VERSION, questionInstructions: RESEARCH_SOURCE_DEPTH_QUESTIONS_INSTRUCTIONS, questionSonnetInstructions: RESEARCH_SOURCE_DEPTH_QUESTIONS_SONNET_INSTRUCTIONS, routing: 'attributed-quotes-first-questions-second-default-depth-v1', questionTransport: RESEARCH_SOURCE_DEPTH_QUESTIONS_TRANSPORT } : {}) } : {}),
      ...(extensions.sourcePackets ? { packetVersion: RESEARCH_SOURCE_PACKET_VERSION, packetInstructions: RESEARCH_SOURCE_PACKET_INSTRUCTIONS,
        packetModel: 'claude-sonnet-5-5', packetOutputTokens: RESEARCH_EVIDENCE_OUTPUT_TOKENS,
        packetSchema: researchSourcePacketSchema({ id: 'packet', primarySourceId: 'primary',
          relationship: { type: 'same_publisher', reason: 'Two original public documentation references from one publisher.', sourceIds: ['primary', 'reference'] },
          sources: ['primary', 'reference'].map(id => ({ id, url: `https://publisher.example/${id}`, publishedAt: null, firstSeen: null, content: 'A public documentation reference describes a bounded workflow.' })),
        }, ['profile']), sourcePackets: extensions.sourcePackets,
        ...(extensions.sourcePacketReviewVersion ? { sourcePacketReviewVersion: extensions.sourcePacketReviewVersion,
          sourcePacketPolicy: researchSourcePacketPolicyContract(extensions.sourcePacketReviewVersion, RESEARCH_EVIDENCE_OUTPUT_TOKENS) } : {}) } : {}),
      ...(extensions.artifactSourceIds ? { artifactSourceIds: extensions.artifactSourceIds,
        artifactPolicy: RESEARCH_SOURCE_ARTIFACT_VERSION, artifactFormat: RESEARCH_SOURCE_ARTIFACT_FORMAT,
        artifactInstructions: RESEARCH_SOURCE_ARTIFACT_INSTRUCTIONS, artifactModel: RESEARCH_SOURCE_ARTIFACT_MODEL,
        artifactSchema: researchSourceDepthSchema({ id: 'item', content: '' }, ['profile']), artifactOutputTokens: RESEARCH_EVIDENCE_OUTPUT_TOKENS,
        artifactRouting: 'explicit-artifact-before-attributed-quote-before-depth-v1',
        ...(extensions.artifactSourceFormats ? { artifactSourceFormats: extensions.artifactSourceFormats,
          artifactFormContract: researchSourceArtifactContract(RESEARCH_EVIDENCE_OUTPUT_TOKENS, 'research_intake_form') } : {}) } : {}) } } : contract));
}
export function researchReplayEligibility(item: ResearchReplayItem, config: Pick<Config, 'sourceIds' | 'windowStart' | 'windowEnd'> & Partial<Pick<Config, 'articleWatchUrls' | 'observationWindowStart' | 'observationWindowEnd'>>) {
  if (!config.sourceIds.includes(item.sourceId)) return 'source_not_in_frozen_roster';
  if (item.publishedAt === null) {
    if (!config.articleWatchUrls?.includes(canonicalResearchUrl(item.url)) || config.observationWindowStart === undefined || config.observationWindowEnd === undefined
      || item.discoveredAt === null || item.discoveredAt < config.observationWindowStart || item.discoveredAt >= config.observationWindowEnd) return 'undated';
    return item.contentType === 'article' ? null : 'unavailable_transcript';
  }
  if (item.publishedAt < config.windowStart || item.publishedAt >= config.windowEnd) return 'outside_frozen_window';
  if (item.contentType !== 'article' && item.transcriptStatus !== 'available') return 'unavailable_transcript';
  return null;
}
export function researchReplayRoute(item: ResearchReplayItem) {
  return (item.content?.trim().length || 0) >= 500
    && (item.sourceId !== 'pew-ai-original-research' || hasUsablePewResearchBody(item.content, item.title)) ? 'direct_evidence' as const : 'metadata_screen' as const;
}
async function loadRun(teamId: string, runId: string) {
  const db = await getDb();
  const run = await db.select().from(research_runs).where(and(eq(research_runs.id, runId), eq(research_runs.team_id, teamId))).get();
  if (!run || run.mode !== 'replay' || run.editorial) throw new Error('Recall replay not found');
  return run;
}
async function loadConfig(run: Run): Promise<Config> {
  const row = await read(run.team_id, prefix(run.id) + 'config');
  if (!row) throw new Error('Replay configuration not found');
  const config: Config = JSON.parse(row.value);
  if (config.cacheOnly !== undefined && config.cacheOnly !== true || config.runId !== run.id || config.icp !== run.icp || config.version !== RESEARCH_PROMPT_VERSION
    || config.depthModel !== undefined && config.depthModel !== 'gpt-6-sol' && config.depthModel !== 'claude-sonnet-5-5'
    || config.depthGroupingVersion !== undefined && config.depthGroupingVersion !== RESEARCH_SOURCE_DEPTH_QUOTES_GROUPING_VERSION && config.depthGroupingVersion !== RESEARCH_SOURCE_DEPTH_QUESTIONS_GROUPING_VERSION
    || config.sourcePacketReviewVersion !== undefined && (![RESEARCH_SOURCE_PACKET_V2_REVIEW, RESEARCH_SOURCE_PACKET_V3_REVIEW, RESEARCH_SOURCE_PACKET_V4_REVIEW, RESEARCH_SOURCE_PACKET_V5_REVIEW, RESEARCH_SOURCE_PACKET_V6_REVIEW].includes(config.sourcePacketReviewVersion) || !config.sourcePackets?.length)
    || config.artifactSourceIds !== undefined && (!Array.isArray(config.artifactSourceIds) || !config.artifactSourceIds.length || new Set(config.artifactSourceIds).size !== config.artifactSourceIds.length)
    || config.artifactSourceFormats !== undefined && !validResearchArtifactSourceFormats(config.artifactSourceFormats, config.artifactSourceIds)
    || config.model !== RESEARCH_MODEL || config.coverageVersion !== RESEARCH_COVERAGE_VERSION || config.sourceReviewVersion !== sourceReviewVersion(config.depthGroupingVersion, config.artifactSourceIds)
    || config.contractHash !== await contractHash(config.depthModel, config)) throw new Error('Replay scoring contract changed; prepare a new replay');
  await getFrozenResearchAudience(run);
  return config;
}
async function replayCacheRows(run: Run, suffix: string, excludeUploads = false) {
  const db = await getDb(), wanted = prefix(run.id) + suffix, uploadPrefix = prefix(run.id) + 'upload:';
  const rows: Array<typeof research_cache.$inferSelect> = [];
  // D1 restricts LIKE pattern complexity and aggregate result size; read bounded value pages.
  for (let offset = 0; ; offset += 3) {
    const page = await db.select().from(research_cache).where(and(
      eq(research_cache.team_id, run.team_id), sql`substr(${research_cache.id},1,${wanted.length})=${wanted}`,
      excludeUploads ? sql`substr(${research_cache.id},1,${uploadPrefix.length})<>${uploadPrefix}` : undefined,
    )).orderBy(research_cache.id).limit(3).offset(offset).all();
    rows.push(...page);
    if (page.length < 3) return rows;
  }
}
async function chunks(run: Run) {
  const rows = await replayCacheRows(run, 'upload:');
  return rows.map(row => JSON.parse(row.value) as { chunkIndex: number; items: ResearchReplayItem[] }).sort((a, b) => a.chunkIndex - b.chunkIndex);
}
export async function researchReplayAction(teamId: string, input: unknown) {
  const data = researchReplayRequestSchema.parse(input), db = await getDb();
  if (data.operation === 'prepare') {
    const original = await db.select().from(research_runs).where(and(eq(research_runs.id, data.audienceRunId), eq(research_runs.team_id, teamId))).get();
    if (!original) throw new Error('Saved audience run not found');
    parseResearchAudience(original.icp);
    const registered = await db.select().from(research_sources).where(eq(research_sources.team_id, teamId)).all();
    if (data.sourceIds.some(id => !registered.some(row => row.seed_id === id) || !RESEARCH_SOURCE_SEEDS.some(seed => seed.id === id)))
      throw new Error('Replay sources must be registered for this team');
    const existing = await db.select().from(research_runs).where(eq(research_runs.id, data.runId)).get();
    if (existing && (existing.team_id !== teamId || existing.mode !== 'replay')) throw new Error('Replay ID is already in use');
    const { operation: _, ...requested } = data;
    const config: Config = { ...requested, model: RESEARCH_MODEL, version: RESEARCH_PROMPT_VERSION, contractHash: await contractHash(requested.depthModel, requested), coverageVersion: RESEARCH_COVERAGE_VERSION, sourceReviewVersion: sourceReviewVersion(requested.depthGroupingVersion, requested.artifactSourceIds), icp: original.icp,
      articleWatchUrls: RESEARCH_SOURCE_SEEDS.filter(seed => data.sourceIds.includes(seed.id) && seed.pageMode === 'article').map(seed => canonicalResearchUrl(seed.url)) };
    const createdAt = Date.now(), configId = prefix(data.runId) + 'config';
    await retryResearchStorage(async () => db.batch([
      db.insert(research_runs).values({ id: data.runId, team_id: teamId, mode: 'replay', status: 'queued', days: Math.ceil((data.windowEnd - data.windowStart) / 86400000), editorial: false,
        created_at: createdAt, icp: original.icp, source_count: 0, source_ids: JSON.stringify(data.sourceIds), diagnostics: JSON.stringify({ outcome: 'Recall replay upload pending; no live source collection, drafts or Slack delivery.' }) }).onConflictDoNothing(),
      db.insert(research_cache).values({ id: configId, team_id: teamId, value: JSON.stringify(config), created_at: createdAt }).onConflictDoNothing(),
    ]));
    const run = await loadRun(teamId, data.runId), saved = await loadConfig(run);
    if (JSON.stringify(config) !== JSON.stringify(saved)) throw new Error('Replay preparation differs from the saved request');
    return { runId: run.id, status: run.status, model: saved.model, ...(saved.depthModel ? { depthModel: saved.depthModel } : {}),
      ...(saved.cacheOnly ? { cacheOnly: true } : {}), ...(saved.depthGroupingVersion ? { depthGroupingVersion: saved.depthGroupingVersion } : {}), ...(saved.sourcePackets ? { sourcePacketVersion: researchSourcePacketPolicy(saved.sourcePacketReviewVersion).version, sourcePacketCount: saved.sourcePackets.length,
        ...(saved.sourcePacketReviewVersion ? { sourcePacketReviewVersion: saved.sourcePacketReviewVersion } : {}) } : {}),
      ...(saved.artifactSourceIds ? { artifactReviewVersion: RESEARCH_SOURCE_ARTIFACT_VERSION, artifactSourceCount: saved.artifactSourceIds.length } : {}),
      ...(saved.artifactSourceFormats ? { artifactSourceFormats: saved.artifactSourceFormats } : {}),
      version: saved.version, coverageVersion: saved.coverageVersion, sourceReviewVersion: saved.sourceReviewVersion, uploadChunkSize: 20 };
  }
  const run = await loadRun(teamId, data.runId), config = await loadConfig(run);
  if (data.operation === 'upload') {
    if (await read(teamId, prefix(run.id) + 'plan')) throw new Error('Replay upload is frozen after start');
    if (run.status !== 'queued') throw new Error('Replay is no longer accepting uploads');
    const totalChunks = Math.ceil(config.inventoryCount / 20);
    if (data.chunkIndex >= totalChunks || data.items.length !== Math.min(20, config.inventoryCount - data.chunkIndex * 20)) throw new Error('Replay chunk does not match its bounded inventory position');
    for (const item of data.items) if (!config.sourceIds.includes(item.sourceId)) throw new Error('Uploaded source is outside the frozen roster');
    await immutable(teamId, prefix(run.id) + 'upload:' + data.chunkIndex, { chunkIndex: data.chunkIndex, items: data.items });
    return { runId: run.id, chunkIndex: data.chunkIndex, uploaded: data.items.length };
  }
  const uploaded = await chunks(run), items = uploaded.flatMap(chunk => chunk.items);
  if (items.length !== config.inventoryCount || new Set(items.map(item => item.id)).size !== items.length
    || uploaded.some((chunk, index) => chunk.chunkIndex !== index)) throw new Error('Replay inventory is incomplete or contains duplicate IDs/chunks');
  const entries: Entry[] = uploaded.flatMap(chunk => chunk.items.map((item, index) => {
    const reason = researchReplayEligibility(item, config);
    return { id: item.id, chunkIndex: chunk.chunkIndex, index, route: reason ? 'excluded' : researchReplayRoute(item), reason };
  }));
  const eligibleIds = items.filter(item => !researchReplayEligibility(item, config))
    .sort((a, b) => b.publishedAt! - a.publishedAt! || a.id.localeCompare(b.id)).map(item => item.id);
  if (config.artifactSourceIds?.some(id => !eligibleIds.includes(id) || researchReplayRoute(items.find(item => item.id === id)!) !== 'direct_evidence'))
    throw new Error('Artifact review requires eligible captured readable item IDs from the frozen inventory');
  if (config.sourcePackets) {
    researchPacketsFromDefinitions(config.sourcePackets, items);
    for (const packet of config.sourcePackets) {
      if (!eligibleIds.includes(packet.primarySourceId)) throw Error('Packet primary must be eligible in the frozen publication/observation window');
      if (packet.sourceIds.some(id => { const item = items.find(item => item.id === id)!; return item.publishedAt !== null && item.publishedAt >= config.windowEnd; })) throw Error('Packet reference is published after the frozen publication window');
    }
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Set ANTHROPIC_API_KEY in Cloudflare secrets to run research');
  const plan: Plan = { config, uploadedSha256: await researchHash(JSON.stringify(items)), entries, eligibleIds };
  await immutable(teamId, prefix(run.id) + 'plan', plan);
  await getFrozenResearchAudience(run);
  const { dispatchResearchRun } = await import('./research');
  await dispatchResearchRun(run.id);
  return { runId: run.id, status: run.status, inventoryCount: items.length, eligibleCount: eligibleIds.length, uploadedSha256: plan.uploadedSha256 };
}
export async function researchReplayStatus(teamId: string, runId: string) {
  z.uuid().parse(runId);
  const run = await loadRun(teamId, runId);
  const rows = await replayCacheRows(run, '', true);
  return { run, records: rows.map(row => ({ id: row.id, value: JSON.parse(row.value) })) };
}

export function researchReplaySignalKind(item: ResearchReplayItem, config: Pick<Config, 'windowStart' | 'freshnessWindowStart'>) {
  return item.publishedAt === null ? 'undated_reference' : item.publishedAt < (config.freshnessWindowStart ?? config.windowStart) ? 'evergreen_newly_discovered' : 'fresh';
}
function screenInput(item: ResearchReplayItem, config: Config) {
  return { id: item.id, title: item.title, excerpt: item.excerpt.slice(0, 900), publicText: item.content,
    contentProvenance: item.contentProvenance, publishedAt: item.publishedAt, discoveredAt: item.discoveredAt, signalKind: researchReplaySignalKind(item, config), sourceId: item.sourceId };
}
function evidenceInput(item: ResearchReplayItem, config: Config) {
  return { id: item.id, title: item.title, sourceId: item.sourceId, publishedAt: item.publishedAt,
    discoveredAt: item.discoveredAt, signalKind: researchReplaySignalKind(item, config), content: item.content, contentProvenance: item.contentProvenance };
}
export async function processResearchReplay(run: Run, operation: string) {
  if (operation === 'drafts') return { ok: true, auditOnly: true };
  if (['completed', 'failed'].includes(run.status)) return { sourceIds: [], done: true };
  const config = await loadConfig(run);
  const planRow = await read(run.team_id, prefix(run.id) + 'plan');
  if (!planRow) throw new Error('Replay inventory has not been finalized');
  if (operation === 'plan') return { sourceIds: [], auditOnly: true };
  if (operation !== 'rank') throw new Error('Recall replay does not collect or publish');
  const plan: Plan = JSON.parse(planRow.value), uploaded = await chunks(run), items = uploaded.flatMap(chunk => chunk.items);
  if (JSON.stringify(plan.config) !== JSON.stringify(config)) throw new Error('Frozen replay plan configuration changed');
  if (await researchHash(JSON.stringify(items)) !== plan.uploadedSha256) throw new Error('Frozen replay corpus changed');
  const itemMap = new Map(items.map(item => [item.id, item])), routeMap = new Map(plan.entries.map(entry => [entry.id, entry]));
  const progressId = prefix(run.id) + 'progress', saved = await read(run.team_id, progressId);
  const incompleteIds = plan.eligibleIds.filter(id => routeMap.get(id)!.route === 'metadata_screen');
  const progress: Progress = saved ? JSON.parse(saved.value) : { screenOffset: 0, selectedIds: plan.eligibleIds.filter(id => routeMap.get(id)!.route === 'direct_evidence'), evidenceOffset: 0, screenedCount: 0, evidenceCount: 0, qualifiedCount: 0 };
  const db = await getDb(), { cachedResearchModel } = await import('./research');
  const persist = async (completed = false) => {
    const value = JSON.stringify(progress), at = Date.now();
    const diagnostics = JSON.stringify({ eligibleCount: plan.eligibleIds.length, routedCount: plan.eligibleIds.length - incompleteIds.length + progress.screenOffset,
      directEvidenceCount: plan.entries.filter(entry => entry.route === 'direct_evidence').length,
      screenedCount: progress.screenedCount, evidenceCount: progress.evidenceCount,
      outcome: `Recall replay: ${progress.evidenceCount} sources processed, ${progress.qualifiedCount} quote-validated findings, ${progress.groundingFailureCount || 0} terminal grounding failures. Historical publication window; no live collection, draft or Slack actions.` });
    await retryResearchStorage(async () => db.batch([
      db.insert(research_cache).values({ id: progressId, team_id: run.team_id, value, created_at: at }).onConflictDoUpdate({ target: research_cache.id, set: { value } }),
      db.update(research_runs).set({ status: completed ? 'completed' : 'ranking', completed_at: completed ? at : null,
        collected_count: plan.eligibleIds.length, findings_count: progress.qualifiedCount, diagnostics }).where(and(eq(research_runs.id, run.id), eq(research_runs.team_id, run.team_id))),
    ]));
  };
  const cachedOnlyMiss = async (error: unknown) => {
    if (!config.cacheOnly || !(error instanceof ResearchCacheOnlyMiss || error instanceof ResearchCoveragePending)) return null;
    const message = `cached-only-miss: ${error.message}`;
    await immutable(run.team_id, prefix(run.id) + 'cached-only-miss', { kind: 'cached-only-miss', cacheOnly: true, message,
      ...(error instanceof ResearchCoveragePending ? { planIds: error.planIds, manifestIds: error.manifestIds } : { stage: error.stage }) });
    await db.update(research_runs).set({ status: 'failed', completed_at: Date.now(), error: message,
      diagnostics: JSON.stringify({ outcome: message, providerCallsAuthorized: 0 }) }).where(and(eq(research_runs.id, run.id), eq(research_runs.team_id, run.team_id)));
    return { ok: true, auditOnly: true, cachedOnlyMiss: true, done: true };
  };
  // Freeze routing progress separately; paid requests only consume incomplete batches or evidence batches.
  if (!saved) { await persist(); return { pending: true }; }
  if (progress.screenOffset < incompleteIds.length) {
    const ids = incompleteIds.slice(progress.screenOffset, progress.screenOffset + RESEARCH_SCREEN_BATCH_SIZE);
    const input = ids.map(id => screenInput(itemMap.get(id)!, plan.config));
    await immutable(run.team_id, prefix(run.id) + 'request:screen:' + progress.screenOffset, { stage: 'screen', input });
    let output: ReturnType<typeof validateResearchScreening>;
    try { output = validateResearchScreening(researchScreeningSchema.parse(await cachedResearchModel(run, 'screen', input, RESEARCH_SCREEN_INSTRUCTIONS,
      screeningJsonSchemaForItems(ids), 5000)), ids); }
    catch (error) { const terminal = await cachedOnlyMiss(error); if (terminal) return terminal; throw error; }
    await immutable(run.team_id, prefix(run.id) + 'screen:' + progress.screenOffset, { ids, output });
    const selected = new Set([...progress.selectedIds, ...output.itemIds]);
    progress.selectedIds = plan.eligibleIds.filter(id => selected.has(id));
    progress.screenedCount += ids.length;
    progress.screenOffset += ids.length;
    await persist();
    return { pending: true };
  }
  if (progress.evidenceOffset < progress.selectedIds.length) {
    const ids = progress.selectedIds.slice(progress.evidenceOffset, progress.evidenceOffset + RESEARCH_EVIDENCE_BATCH_SIZE);
    const batch = ids.map(id => itemMap.get(id)!).filter(item => researchReplayRoute(item) === 'direct_evidence');
    let assessments: z.infer<typeof researchEvidenceSchema>['findings'] = [];
    let evidenceFailures: EvidenceFailure[] = [];
    let coverageManifestIds: string[] = [];
    let sourceReviewManifestIds: string[] = [];
    let multiProofs: EvidenceCacheValue['multiProofs'] = [];
    let sourceReviewDiagnostics: EvidenceCacheValue['sourceReviewDiagnostics'] = [];
    if (batch.length) {
      await immutable(run.team_id, prefix(run.id) + 'request:evidence:' + progress.evidenceOffset, { stage: 'evidence', input: batch.map(item => evidenceInput(item, plan.config)) });
      let output: EvidenceCacheValue;
      try {
        output = await cachedResearchModel(run, 'evidence', batch.map(item => evidenceInput(item, plan.config)), RESEARCH_EVIDENCE_INSTRUCTIONS,
          evidenceJsonSchemaForItems(batch.map(item => item.id)), RESEARCH_EVIDENCE_OUTPUT_TOKENS) as EvidenceCacheValue;
      } catch (error) {
        const terminal = await cachedOnlyMiss(error); if (terminal) return terminal;
        if (error instanceof ResearchCoveragePending) return { pending: true, retryAfterMs: error.retryAfterMs };
        throw error;
      }
      evidenceFailures = output.evidenceFailures || [];
      coverageManifestIds = output.coverageManifestIds || [];
      sourceReviewManifestIds = output.sourceReviewManifestIds || [];
      multiProofs = output.multiProofs || [];
      sourceReviewDiagnostics = output.sourceReviewDiagnostics || [];
      assessments = validateResearchEvidenceCoverage(output.findings, batch.filter(item => !evidenceFailures.some(failure => failure.itemId === item.id)).map(item => item.id));
      const audience = await getFrozenResearchAudience(run);
      validateResearchEvidenceProfiles(assessments, audience.publishingProfiles.map(profile => profile.id));
    }
    const accepted = validateResearchEvidence(assessments, batch.map(item => ({ id: item.id, content: item.content! })));
    await immutable(run.team_id, prefix(run.id) + 'evidence:' + progress.evidenceOffset, { ids, input: batch.map(item => evidenceInput(item, plan.config)), assessments,
      ...(evidenceFailures.length ? { evidenceFailures } : {}),
      ...(coverageManifestIds.length ? { coverageManifestIds } : {}),
      ...(sourceReviewManifestIds.length ? { sourceReviewManifestIds, multiProofs, sourceReviewDiagnostics } : {}),
      acceptedIds: [...new Set(accepted.map(item => item.itemId))], acceptedIdeas: accepted,
      unavailableIds: ids.filter(id => !batch.some(item => item.id === id)), unavailableReason: 'No captured usable public body in the frozen replay corpus; live hydration was not performed.' });
    progress.evidenceOffset += ids.length;
    progress.evidenceCount += assessments.length + evidenceFailures.length;
    if (evidenceFailures.length) progress.groundingFailureCount = (progress.groundingFailureCount || 0) + evidenceFailures.length;
    progress.qualifiedCount += accepted.length;
    await persist();
    return { pending: true };
  }
  if (plan.config.sourcePackets && !progress.packetsComplete) {
    const packets = researchPacketsFromDefinitions(plan.config.sourcePackets, items);
    const { cachedResearchSourcePackets } = await import('./research');
    let output: Awaited<ReturnType<typeof cachedResearchSourcePackets>>;
    try { output = await cachedResearchSourcePackets(run, packets); }
    catch (error) { const terminal = await cachedOnlyMiss(error); if (terminal) return terminal; if (error instanceof ResearchCoveragePending) return { pending: true, retryAfterMs: error.retryAfterMs }; throw error; }
    await immutable(run.team_id, prefix(run.id) + 'source-packets', { input: items.filter(item => plan.config.sourcePackets!.some(packet => packet.sourceIds.includes(item.id))),
      sourcePackets: plan.config.sourcePackets, assessments: output.findings, acceptedIdeas: output.acceptedIdeas,
      packetProofs: output.packetProofs, packetDiagnostics: output.diagnostics, packetManifestIds: output.manifestIds });
    progress.qualifiedCount += output.acceptedIdeas.length;
    progress.packetsComplete = true;
    await persist();
    return { pending: true };
  }
  await persist(true);
  return { ok: true, auditOnly: true };
}
