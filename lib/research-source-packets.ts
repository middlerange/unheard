import { researchHash } from './research-model';
import { researchSourceReviewAudience } from './research-source-review-model';
import { ResearchCoveragePending } from './research-coverage';
import { RESEARCH_POST_MIN_SCORE } from './research-policy';
import { retryResearchStorage } from './research-storage';
import type { ResearchAudience } from './research-audience';
import type { ResearchSourceReviewAccess, ResearchSourceReviewRequest } from './research-source-review';
import type { ResearchSourceSeed } from './research-types';
import { canonicalResearchUrl } from './research-collectors';
import {
  RESEARCH_SOURCE_PACKET_VERSION, RESEARCH_SOURCE_PACKET_INSTRUCTIONS,
  researchSourcePacketMetadata, researchSourcePacketSchema, normalizeResearchSourcePacket,
  RESEARCH_SOURCE_PACKET_V2_VERSION, RESEARCH_SOURCE_PACKET_V2_INSTRUCTIONS, RESEARCH_SOURCE_PACKET_V3_INSTRUCTIONS, RESEARCH_SOURCE_PACKET_V4_INSTRUCTIONS,
  researchSourcePacketMetadataV2, researchSourcePacketSchemaV2, normalizeResearchSourcePacketV2, normalizeResearchSourcePacketV4,
  type ResearchSourcePacket,
} from './research-source-packet-model';

export type ResearchSourcePacketDefinition = {
  id: string; primarySourceId: string; sourceIds: string[];
  relationship: { type: ResearchSourcePacket['relationship']['type']; reason: string };
};
export type ResearchPacketItem = {
  id: string; sourceId: string; url: string; publishedAt: number | null; discoveredAt: number | null;
  content: string | null; contentChangedAt?: number | null;
};
const json = (value: unknown) => JSON.stringify(value);
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

export function researchPacketsFromDefinitions(definitions: ResearchSourcePacketDefinition[], items: ResearchPacketItem[]) {
  const byId = new Map(items.map(item => [item.id, item]));
  if (byId.size !== items.length || new Set(definitions.map(packet => packet.id)).size !== definitions.length) throw Error('Packet inputs require unique IDs');
  return definitions.map((definition): ResearchSourcePacket => {
    if (!definition.id || definition.sourceIds.length < 2 || new Set(definition.sourceIds).size !== definition.sourceIds.length
      || !definition.sourceIds.includes(definition.primarySourceId) || definition.relationship.reason.trim().length < 20) throw Error('Packet requires a primary source and distinct related sources');
    const sources = definition.sourceIds.map(id => {
      const source = byId.get(id);
      if (!source || !source.content || source.content.trim().length < 500) throw Error('Packet source lacks captured public text');
      return { id: source.id, url: source.url, publishedAt: source.publishedAt, firstSeen: source.discoveredAt, content: source.content };
    });
    return { id: definition.id, primarySourceId: definition.primarySourceId,
      relationship: { ...definition.relationship, sourceIds: [...definition.sourceIds] }, sources };
  });
}

export function configuredResearchPacketDefinitions(seeds: ResearchSourceSeed[], items: ResearchPacketItem[], candidateIds: string[], activeSourceIds: string[], cutoff: number) {
  const candidates = new Set(candidateIds), active = new Set(activeSourceIds), definitions: ResearchSourcePacketDefinition[] = [], skipped: Array<{ id: string; reason: string }> = [];
  for (const seed of seeds.filter(seed => seed.referencePacket?.enabled && active.has(seed.id))) {
    const config = seed.referencePacket!, primary = items.find(item => canonicalResearchUrl(item.url) === canonicalResearchUrl(seed.url) && candidates.has(item.id));
    if (!primary) continue;
    const members = [...new Set([seed.id, ...config.sourceIds])].map(id => {
      const reference = seeds.find(source => source.id === id);
      if (!reference || !active.has(id)) return null;
      return items.find(item => canonicalResearchUrl(item.url) === canonicalResearchUrl(reference.url)
        && item.content && item.content.trim().length >= 500 && item.discoveredAt !== null && item.discoveredAt <= cutoff
        && (item.publishedAt === null || item.publishedAt <= cutoff) && (!item.contentChangedAt || item.contentChangedAt <= cutoff)) ?? null;
    });
    if (members.some(item => !item)) { skipped.push({ id: config.id, reason: 'A configured public reference is disabled, unavailable, or newer than the frozen cutoff.' }); continue; }
    definitions.push({ id: config.id, primarySourceId: primary.id, sourceIds: [...new Set(members.map(item => item!.id))], relationship: { ...config.relationship } });
  }
  return { definitions, skipped };
}

type PacketResult = Awaited<ReturnType<typeof normalizeResearchSourcePacket>>;
export const RESEARCH_SOURCE_PACKET_V2_REVIEW = 'coherent-synthesis-v2';
export const RESEARCH_SOURCE_PACKET_V3_REVIEW = 'reader-decision-synthesis-v3';
export const RESEARCH_SOURCE_PACKET_V4_REVIEW = 'whole-reader-story-v4';
export const RESEARCH_SOURCE_PACKET_V4_NORMALIZER = 'structured-inference-v2+empty-content-angle-note-v1';
export const RESEARCH_SOURCE_PACKET_V2_NORMALIZER = 'structured-inference-v2';
export type ResearchSourcePacketPolicy = {
  version: string; instructions: string; normalizerVersion?: string;
  qualificationPolicyVersion?: typeof RESEARCH_SOURCE_PACKET_V2_VERSION;
  metadata: typeof researchSourcePacketMetadata; schema: typeof researchSourcePacketSchema;
  normalize: typeof normalizeResearchSourcePacket;
};
const defaultPolicy: ResearchSourcePacketPolicy = {
  version: RESEARCH_SOURCE_PACKET_VERSION, instructions: RESEARCH_SOURCE_PACKET_INSTRUCTIONS,
  metadata: researchSourcePacketMetadata, schema: researchSourcePacketSchema, normalize: normalizeResearchSourcePacket,
};
export function researchSourcePacketPolicy(reviewVersion?: string): ResearchSourcePacketPolicy {
  if (reviewVersion === undefined) return defaultPolicy;
  if (reviewVersion !== RESEARCH_SOURCE_PACKET_V2_REVIEW && reviewVersion !== RESEARCH_SOURCE_PACKET_V3_REVIEW && reviewVersion !== RESEARCH_SOURCE_PACKET_V4_REVIEW) throw new Error('Unknown source packet review policy');
  return { version: RESEARCH_SOURCE_PACKET_V2_VERSION, instructions: reviewVersion === RESEARCH_SOURCE_PACKET_V4_REVIEW ? RESEARCH_SOURCE_PACKET_V4_INSTRUCTIONS : reviewVersion === RESEARCH_SOURCE_PACKET_V3_REVIEW ? RESEARCH_SOURCE_PACKET_V3_INSTRUCTIONS : RESEARCH_SOURCE_PACKET_V2_INSTRUCTIONS,
    normalizerVersion: reviewVersion === RESEARCH_SOURCE_PACKET_V4_REVIEW ? RESEARCH_SOURCE_PACKET_V4_NORMALIZER : RESEARCH_SOURCE_PACKET_V2_NORMALIZER, qualificationPolicyVersion: RESEARCH_SOURCE_PACKET_V2_VERSION,
    metadata: researchSourcePacketMetadataV2, schema: researchSourcePacketSchemaV2, normalize: reviewVersion === RESEARCH_SOURCE_PACKET_V4_REVIEW ? normalizeResearchSourcePacketV4 : normalizeResearchSourcePacketV2 };
}
export function researchSourcePacketPolicyContract(reviewVersion: string, outputTokens: number) {
  const policy = researchSourcePacketPolicy(reviewVersion);
  const schema = policy.schema({ id: 'packet', primarySourceId: 'primary',
    relationship: { type: 'same_publisher', reason: 'Two original public documentation references from one publisher.', sourceIds: ['primary', 'reference'] },
    sources: ['primary', 'reference'].map(id => ({ id, url: `https://publisher.example/${id}`, publishedAt: null, firstSeen: null, content: 'A public documentation reference describes a bounded workflow.' })),
  }, ['profile']);
  return { reviewVersion, policyVersion: policy.version, normalizerVersion: policy.normalizerVersion,
    sourceBindingVersion: RESEARCH_SOURCE_PACKET_VERSION, instructions: policy.instructions, schema,
    model: 'claude-sonnet-5-5', outputTokens, scoreThreshold: RESEARCH_POST_MIN_SCORE, rubric: 'source_qualification_v1' };
}
type Receipt = { version: string; planId: string; planHash: string; packetId: string; packetHash: string; nonce: string; startedAt: number } & (
  { state: 'started' } | { state: 'completed'; completedAt: number; raw: unknown; rawHash: string; resultHash: string }
  | { state: 'failed' | 'indeterminate'; completedAt: number; reason: string }
);
export type ResearchPacketAccess = Omit<ResearchSourceReviewAccess, 'generate'> & {
  model: string; outputTokens: number; generate: (request: ResearchSourceReviewRequest, outputTokens: number) => Promise<unknown>;
};
export class ResearchSourcePacketPending extends ResearchCoveragePending {
  constructor(planIds: string[], manifestIds: string[], pending: number, active: number) { super(planIds, manifestIds, pending, active); this.name = 'ResearchSourcePacketPending'; }
}
export async function reviewResearchSourcePackets(packets: ResearchSourcePacket[], access: ResearchPacketAccess, policy = defaultPolicy) {
  const audience = access.context.audience as ResearchAudience, profileIds = audience.publishingProfiles.map(profile => profile.id);
  if (!profileIds.length || new Set(profileIds).size !== profileIds.length) throw Error('Packet research requires the full frozen publishing profiles');
  const now = access.now ?? Date.now, budget = access.budget ?? { remaining: 2 };
  if (!Number.isInteger(budget.remaining) || budget.remaining < 0 || budget.remaining > 2) throw Error('Packet checkpoint budget must be between zero and two');
  async function immutable(id: string, value: unknown) {
    await retryResearchStorage(() => access.writeImmutable(id, value));
    if (stable(await access.read(id)) !== stable(value)) throw Error('Packet immutable record differs from its frozen plan');
  }
  const view = researchSourceReviewAudience(audience);
  const work = await Promise.all(packets.map(async packet => {
    const metadata = await policy.metadata(packet);
    const request: ResearchSourceReviewRequest = { model: access.model, instructions: policy.instructions,
      schema: policy.schema(packet, profileIds), data: { ...view, items: [{ ...metadata, reviewTransport: 'anthropic-tool-v1' }] } };
    const plan = { version: policy.version, teamId: access.context.teamId, packet,
      packetHash: metadata.packetHash, audience, request, outputTokens: access.outputTokens,
      ...(policy.normalizerVersion ? { normalizerVersion: policy.normalizerVersion } : {}) };
    const planHash = await researchHash(json(plan)), planId = `research-source-packet-plan:v1:${planHash}`, attemptId = `research-source-packet-attempt:v1:${planHash}`;
    await immutable(planId, plan);
    return { packet, metadata, request, plan, planHash, planId, attemptId };
  }));
  type Work = (typeof work)[number];
  async function receipt(job: Work) {
    const value = await access.read(job.attemptId) as Receipt | null;
    if (!value) return null;
    if (value.version !== policy.version || value.planId !== job.planId || value.planHash !== job.planHash
      || value.packetId !== job.packet.id || value.packetHash !== job.metadata.packetHash || !value.nonce
      || !Number.isFinite(value.startedAt) || value.startedAt < 0 || value.startedAt > now()
      || !['started', 'completed', 'failed', 'indeterminate'].includes(value.state)) throw Error('Packet attempt differs from its frozen context');
    if (value.state !== 'started' && (!Number.isFinite(value.completedAt) || value.completedAt < value.startedAt)) throw Error('Packet completion time is invalid');
    if (value.state === 'completed' && (!Object.hasOwn(value, 'raw') || !value.rawHash || !value.resultHash)) throw Error('Packet attempt lacks response bindings');
    if ((value.state === 'failed' || value.state === 'indeterminate') && !value.reason) throw Error('Packet failure has no reason');
    if (value.state === 'indeterminate' && value.completedAt - value.startedAt < 120_000) throw Error('Packet indeterminate claim has not expired');
    return value;
  }
  async function finish(job: Work, expected: Receipt, terminal: Receipt) {
    await retryResearchStorage(() => access.save(job.attemptId, expected, terminal));
    const saved = await receipt(job);
    if (!saved || saved.state === 'started') throw Error('Packet terminal attempt was not saved');
  }
  for (const job of work) {
    const previous = await receipt(job);
    if (previous?.state === 'started' && now() - previous.startedAt >= 120_000)
      await finish(job, previous, { ...previous, state: 'indeterminate', completedAt: now(), reason: 'Packet inference exceeded120 seconds; its provider outcome is indeterminate and is not retried.' });
  }
  const jobs: Promise<void>[] = [];
  for (const job of work) {
    if (!budget.remaining || await receipt(job)) continue;
    budget.remaining--;
    const started: Receipt = { version: policy.version, planId: job.planId, planHash: job.planHash,
      packetId: job.packet.id, packetHash: job.metadata.packetHash, nonce: crypto.randomUUID(), startedAt: now(), state: 'started' };
    if (!await retryResearchStorage(() => access.claim(job.attemptId, started))) { budget.remaining++; continue; }
    jobs.push((async () => {
      let terminal: Receipt;
      try {
        const raw = await access.generate(job.request, access.outputTokens) ?? null;
        const result = await policy.normalize(raw, [job.packet], profileIds);
        terminal = { ...started, state: 'completed', completedAt: now(), raw, rawHash: await researchHash(json(raw)), resultHash: await researchHash(stable(result)) };
      } catch (error) { terminal = { ...started, state: 'failed', completedAt: now(), reason: (error instanceof Error ? error.message : 'Packet qualification failed').slice(0, 600) }; }
      await finish(job, started, terminal);
    })());
  }
  await Promise.all(jobs);
  const manifestIds: string[] = [], pending: Work[] = [], result: PacketResult = { findings: [], packetProofs: [], diagnostics: [], bindings: [],
    ...(policy.qualificationPolicyVersion ? { qualificationPolicyVersion: policy.qualificationPolicyVersion } : {}) };
  for (const job of work) {
    const terminal = await receipt(job);
    if (!terminal || terminal.state === 'started') { pending.push(job); continue; }
    let normalized: PacketResult | null = null;
    if (terminal.state === 'completed') {
      if (terminal.rawHash !== await researchHash(json(terminal.raw))) throw Error('Packet raw response changed');
      normalized = await policy.normalize(terminal.raw, [job.packet], profileIds);
      if (terminal.resultHash !== await researchHash(stable(normalized))) throw Error('Packet normalized response changed');
    }
    const manifest = { version: policy.version, teamId: access.context.teamId, packetId: job.packet.id,
      packetHash: job.metadata.packetHash, planId: job.planId, planHash: job.planHash, attemptId: job.attemptId,
      attemptHash: await researchHash(json(terminal)), terminalState: terminal.state, result: normalized,
      ...(terminal.state === 'failed' || terminal.state === 'indeterminate' ? { terminalReason: terminal.reason } : {}) };
    const manifestId = `research-source-packet-manifest:v1:${await researchHash(json(manifest))}`;
    await immutable(manifestId, manifest); manifestIds.push(manifestId);
    if (normalized) {
      result.findings.push(...normalized.findings);
      result.packetProofs.push(...normalized.packetProofs);
      result.diagnostics.push(...normalized.diagnostics);
      result.bindings.push(...normalized.bindings);
    } else if (terminal.state === 'failed' || terminal.state === 'indeterminate') result.diagnostics.push({ packetId: job.packet.id, ideaIndex: null, reason: terminal.reason, rawIdea: null });
  }
  if (pending.length) throw new ResearchSourcePacketPending(work.map(job => job.planId), manifestIds, pending.length,
    (await Promise.all(pending.map(job => receipt(job)))).filter(Boolean).length);
  return { ...result, acceptedIdeas: result.findings.filter(finding => finding.score >= RESEARCH_POST_MIN_SCORE), manifestIds };
}
