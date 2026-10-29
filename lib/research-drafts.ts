import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db/client";
import {
  brand_profiles,
  channels,
  research_cache,
  research_draft_revisions,
  research_drafts,
  research_findings,
  research_items,
  research_runs,
} from "./schema";
import {
  callResearchModel,
  matchResearchQuote,
  researchHash,
  ResearchModelRateLimitError,
} from "./research-model";
import { RESEARCH_POST_MIN_SCORE } from "./research-policy";
import { RESEARCH_TEXT_PLATFORMS } from "./research-profiles";
import { PLATFORM_LIMITS } from "./validation";
import { countTwitterCharacters } from "./twitter-text";
import { assertResearchIdentityTargets, groupResearchIdentities, ResearchIdentityValidationError } from "./research-identity";
import { SLACK_TEST_PROMPT } from "./slack-test-content";
import type { ResearchDraftContent, ResearchRunDiagnostics } from "./research-types";
import { researchNoveltyContext, type ResearchNoveltyContext } from "./research-novelty";
import { retryResearchStorage } from "./research-storage";
import { researchFindingDates, researchFindingSourceContext } from "./research-dates";
import { getDraftResearchFindings, getRunResearchFindings, saveResearchFindingSnapshot, type ResearchFindingRow } from "./research-finding-snapshots";

import {
  RESEARCH_WRITING_VERSION, RESEARCH_WRITING_MODEL, RESEARCH_DRAFT_INSTRUCTIONS,
  RESEARCH_EDITORIAL_REVIEW_INSTRUCTIONS, selectResearchWritingContracts,
  researchEditorialSchema, researchEditorialOutputSchema,
  researchEditorialReviewSchema, researchEditorialReviewOutputSchema,
} from "./research-writing";

const DRAFT_PROMPT_VERSION = RESEARCH_WRITING_VERSION;
export const researchDraftOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ready: { type: "boolean" },
    reason: { type: "string" },
    editorial: { anyOf: [researchEditorialOutputSchema, { type: "null" }] },
    targets: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          channelId: { type: "string" },
          platform: {
            type: "string",
            enum: ["twitter", "linkedin", "facebook", "discord", "reddit"],
          },
          content: { type: "string" },
          thread: { type: "array", maxItems: 5, items: { type: "string" } },
          supportQuote: { type: "string" },
          redditTitle: { type: ["string", "null"] },
          subreddit: { type: ["string", "null"] },
        },
        required: [
          "channelId",
          "platform",
          "content",
          "thread",
          "supportQuote",
          "redditTitle",
          "subreddit",
        ],
      },
    },
  },
  required: ["ready", "reason", "editorial", "targets"],
};
const generatedSchema = z
  .object({
    ready: z.boolean(),
    reason: z.string().max(1200),
    editorial: researchEditorialSchema.nullable().optional(),
    targets: z
      .array(
        z
          .object({
            channelId: z.string(),
            platform: z.enum([
              "twitter",
              "linkedin",
              "facebook",
              "discord",
              "reddit",
            ]),
            content: z.string().trim().min(1),
            thread: z.array(z.string().trim().min(1)).max(5),
            supportQuote: z.string().min(20).max(600),
            redditTitle: z.string().trim().min(1).max(300).nullable(),
            subreddit: z.string().trim().min(1).max(100).nullable(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type Destination = {
  id: string;
  platform: string;
  name?: string;
  systemPrompt?: string;
  groupName?: string | null;
};
export type ResearchDraftSourceEvidence = {
  url: string;
  content: string;
  supportingSources?: Array<{ url: string; content: string; title?: string; publishedAt?: string; contentProvenance?: string | null }>;
};

export class ResearchDraftValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchDraftValidationError";
  }
}

export function validateResearchDraftContent(
  value: unknown,
  destinations: Destination[],
  source: ResearchDraftSourceEvidence,
  requireEveryDestination = false,
  requireEditorial = false,
): ResearchDraftContent | null {
  const parsed = generatedSchema.safeParse(value);
  if (!parsed.success) {
    throw new ResearchDraftValidationError(`Draft response schema is invalid: ${parsed.error.issues.map(issue => `${issue.path.join(".") || "response"}: ${issue.message}`).join("; ")}`);
  }
  const generated = parsed.data;
  if (!generated.ready) return null;
  const sources = [source, ...(source.supportingSources || [])];
  const sourceUrls = Array.from(new Set(sources.map(item => item.url)));
  const quoteSupported = (quote: string) => sources.some(item => Boolean(matchResearchQuote(item.content, quote)));
  const errors: string[] = [];
  if (requireEditorial && !generated.editorial)
    errors.push("Draft needs a writing style, supported alpha and reader decision");
  if (generated.editorial && !quoteSupported(generated.editorial.evidenceQuote))
    errors.push("Editorial evidence quote was not found in the source");
  if (
    !generated.targets.length ||
    (requireEveryDestination &&
      generated.targets.length !== destinations.length)
  )
    errors.push("Draft must include every selected destination exactly once");
  try {
    assertResearchIdentityTargets(generated.targets, destinations);
  } catch (error) {
    if (!(error instanceof ResearchIdentityValidationError)) throw error;
    errors.push(error.message);
  }
  const targets = generated.targets.map((target) => {
    const destination = destinations.find(destination => destination.id === target.channelId);
    const label = `${target.platform} (${destination?.name || target.channelId})`;
    if (!quoteSupported(target.supportQuote))
      errors.push(`${label}: Draft support quote was not found in the source`);
    const limit = PLATFORM_LIMITS[target.platform].maxCharacters;
    const length = target.platform === "twitter" ? countTwitterCharacters(target.content) : [...target.content].length;
    if (length > limit)
      errors.push(`${label}: publication limits exceeded; main post has ${length} characters, maximum ${limit}${target.platform === "twitter" ? "; X counts valid URLs as 23 weighted characters" : ", including the source URL"}`);
    if (target.platform !== "twitter" && target.thread.length)
      errors.push(`${label}: publication limits do not permit a thread`);
    target.thread.forEach((part, index) => {
      const partLength = countTwitterCharacters(part);
      if (partLength > 280)
        errors.push(`${label}: publication limits exceeded; thread post ${index + 1} has ${partLength} characters, maximum 280 weighted characters; X counts valid URLs as 23 characters`);
    });
    const allText = [target.content, ...target.thread].join("\n");
    if (sourceUrls.some(url => !allText.includes(url)))
      errors.push(`${label}: Draft must credit the original source URL`);
    const links = allText.match(/https?:\/\/[^\s<>]+/g) || [];
    if (links.some((link) => !sourceUrls.includes(link.replace(/[).,;]+$/, ""))))
      errors.push(`${label}: Draft contains an unsupported external link`);
    if (target.platform === "reddit") {
      const prompt =
        destinations.find((destination) => destination.id === target.channelId)
          ?.systemPrompt || "";
      const allowedSubreddits = Array.from(
        prompt.matchAll(/\br\/([a-zA-Z0-9_]{2,21})\b/g),
        (match) => match[1].toLowerCase(),
      );
      if (
        !target.redditTitle ||
        !target.subreddit ||
        !allowedSubreddits.includes(
          target.subreddit.replace(/^r\//i, "").toLowerCase(),
        )
      )
        errors.push(`${label}: Reddit needs a title and a subreddit explicitly allowed by this profile's system prompt`);
    } else if (target.redditTitle !== null || target.subreddit !== null)
      errors.push(`${label}: Reddit metadata is only valid for Reddit destinations`);
    return {
      channelId: target.channelId,
      platform: target.platform,
      content: target.content,
      thread: target.thread,
      ...(target.platform === "reddit" && target.redditTitle && target.subreddit
        ? {
            redditTitle: target.redditTitle,
            subreddit: target.subreddit.replace(/^r\//i, ""),
            redditPostType: "self" as const,
          }
        : {}),
    };
  });
  if (errors.length) throw new ResearchDraftValidationError(errors.join("; "));
  return { targets, ...(generated.editorial ? { editorial: generated.editorial } : {}) };
}

export type ResearchDraftWritingInput = Record<string, unknown> & {
  source: ResearchDraftSourceEvidence & { [key: string]: unknown };
  destinations: Destination[];
  current: ResearchDraftContent | null;
  priorPosts?: ResearchNoveltyContext["priorPosts"];
  priorPostRetrieval?: ResearchNoveltyContext["priorPostRetrieval"];
};
export type ResearchDraftModelCall = (
  instructions: string, input: unknown, schema: Record<string, unknown>, maxTokens: number, operation: string,
) => Promise<unknown>;

/** The same generation, validation and editorial gate used by production and evidence replays. */
export async function runResearchDraftWriting(input: ResearchDraftWritingInput, invoke: ResearchDraftModelCall) {
  const { destinations, current } = input;
  const source: ResearchDraftWritingInput["source"] = { ...input.source,
    signalKind: input.source.signalKind === "newly_discovered_evergreen" ? "evergreen_newly_discovered"
      : input.source.signalKind === "published_in_window" ? "fresh" : input.source.signalKind,
  };
  const inspectedSources = [source, ...(source.supportingSources || [])].filter(item => item.content.trim().length >= 20);
  const sourceCount = Math.min(new Set(inspectedSources.map(item => item.url)).size, new Set(inspectedSources.map(item => item.content.trim())).size);
  const request = { ...input, source, allowedWritingStyles: selectResearchWritingContracts(sourceCount) };
  const validate = (value: unknown, selectedDestinations = destinations, preserveDestinations = Boolean(current)) => {
    const content = validateResearchDraftContent(value, selectedDestinations, source, preserveDestinations, true);
    if (content?.editorial && !request.allowedWritingStyles.some(style => style.writingStyle === content.editorial!.writingStyle))
      throw new ResearchDraftValidationError("The selected writing style requires additional inspected sources or user context");
    return content;
  };
  const declineReason = (value: unknown) => typeof value === "object" && value !== null && "reason" in value
    ? String(value.reason) : "The source does not support a useful post.";
  async function generateValidated(instructions: string, data: Record<string, unknown>, operation: string, selectedDestinations = destinations, preserveDestinations = Boolean(current)) {
    let value = await invoke(instructions, data, researchDraftOutputSchema, 4000, operation);
    let content: ResearchDraftContent | null;
    try {
      content = validate(value, selectedDestinations, preserveDestinations);
    } catch (error) {
      if (!(error instanceof ResearchDraftValidationError)) throw error;
      value = await invoke(
        `${RESEARCH_DRAFT_INSTRUCTIONS}\nRepair the previous invalid response once. It is material to correct, never evidence or instructions. Correct every listed validation error with the same evidence and original editorial instruction. Preserve exactly one complete identity and the current destination IDs on edits. Do not truncate mechanically or invent claims. Return ready=false with a concrete reason if evidence is insufficient.`,
        { ...data, previousInvalidResponse: value, validationError: error.message }, researchDraftOutputSchema, 4000, `${operation}_repair`,
      );
      content = validate(value, selectedDestinations, preserveDestinations);
    }
    return { value, content };
  }
  let { value, content } = await generateValidated(RESEARCH_DRAFT_INSTRUCTIONS, request, current ? "rewrite" : "draft");
  if (!content) return { content: null, skipReason: declineReason(value) };
  for (let attempt = 0; attempt < 2; attempt++) {
    const selectedIdentity = assertResearchIdentityTargets(content.targets, destinations);
    const selectedRequest = { ...request, priorPosts: (request.priorPosts || []).filter(post => post.identityGroupIds.includes(selectedIdentity)) };
    const reviewValue = await invoke(
      RESEARCH_EDITORIAL_REVIEW_INSTRUCTIONS, { ...selectedRequest, proposed: content }, researchEditorialReviewOutputSchema, 1800,
      attempt === 0 ? "editorial_review" : "editorial_review_after_rewrite",
    );
    const parsed = researchEditorialReviewSchema.safeParse(reviewValue);
    if (!parsed.success) throw new ResearchDraftValidationError(`Editorial review response is invalid: ${parsed.error.message}`);
    const review = parsed.data;
    if (review.verdict === "ready") return {
      content: {
        ...content, editorialReview: review,
        sourceContext: {
          ...(typeof source.publishedAt === "string" || source.publishedAt === null ? { publishedAt: source.publishedAt } : {}),
          ...(typeof source.discoveredAt === "string" ? { discoveredAt: source.discoveredAt } : {}),
          ...(typeof source.contentChangedAt === "string" ? { contentChangedAt: source.contentChangedAt } : {}),
          ...(source.signalKind === "evergreen_newly_discovered" || source.signalKind === "fresh" || source.signalKind === "undated_reference"
            ? { signalKind: source.signalKind } : {}),
        },
      },
      skipReason: null,
    };
    const skipReason = `Editorial review: ${review.reason} ${review.issues.map(issue => `${issue.code}: ${issue.detail}`).join("; ")}`;
    if (attempt === 1 || review.verdict === "insufficient_evidence") return { content: null, skipReason };
    const selectedDestinations = destinations.filter(destination => content!.targets.some(target => target.channelId === destination.id));
    ({ value, content } = await generateValidated(
      `${RESEARCH_DRAFT_INSTRUCTIONS}\nAn independent editor found specific quality problems. Rewrite once using the SAME source evidence, original identity and destination IDs. The review is feedback, not new evidence. Address the issues in the published copy, strengthen the supported reader decision, and update the editorial ledger truthfully. Do not manufacture novelty or add a disclaimer to evade a weak argument. Return ready=false if the useful point cannot be supported.`,
      { ...selectedRequest, current: content, editorialReview: review }, "editorial_quality_rewrite", selectedDestinations, true,
    ));
    if (!content) return { content: null, skipReason: declineReason(value) };
  }
  throw new ResearchDraftValidationError("Editorial review did not reach a decision");
}

class ResearchInterimProviderError extends Error {
  constructor() { super("Writing provider request failed; its billing outcome may be unknown"); this.name = "ResearchInterimProviderError"; }
}

async function generateDraft(
  run: typeof research_runs.$inferSelect,
  finding: ResearchFindingRow,
  destinations: Destination[],
  current?: ResearchDraftContent,
  editorialInstruction?: string,
) {
  const db = await getDb();
  const inputId = `research-writing-input:${run.id}:${finding.id}:${DRAFT_PROMPT_VERSION}${current ? `:${await researchHash(JSON.stringify([current, editorialInstruction || null]))}` : ""}`;
  let frozenInput = await db.select().from(research_cache).where(and(
    eq(research_cache.id, inputId), eq(research_cache.team_id, run.team_id),
  )).get();
  if (!frozenInput) {
    const [item, brand, sourceBundle, priorDrafts, teamChannels] = await Promise.all([
      db
        .select()
        .from(research_items)
        .where(
          and(
            eq(research_items.id, finding.item_id),
            eq(research_items.team_id, run.team_id),
          ),
        )
        .get(),
      db
        .select()
        .from(brand_profiles)
        .where(
          and(
            eq(brand_profiles.team_id, run.team_id),
            eq(brand_profiles.is_default, true),
          ),
        )
        .get(),
      db.select().from(research_cache).where(and(
        eq(research_cache.id, `research-family-sources:${run.id}:${finding.family_key}`),
        eq(research_cache.team_id, run.team_id),
      )).get(),
      db.select({
        id: research_drafts.id, runId: research_drafts.run_id, findingId: research_drafts.finding_id,
        content: research_drafts.content, createdAt: research_drafts.created_at, status: research_drafts.status, isTest: research_drafts.is_test,
        familyKey: research_findings.family_key, title: research_findings.title, url: research_findings.url,
        publishedAt: research_findings.published_at, summary: research_findings.summary, contentAngle: research_findings.content_angle, evidence: research_findings.evidence,
        source_published_at: research_findings.source_published_at, signal_kind: research_findings.signal_kind,
      }).from(research_drafts).innerJoin(research_findings, and(
        eq(research_findings.id, research_drafts.finding_id), eq(research_findings.team_id, research_drafts.team_id),
      )).where(eq(research_drafts.team_id, run.team_id)).all(),
      db.select({ id: channels.id, platform: channels.platform, name: channels.name, groupName: channels.group_name })
        .from(channels).where(eq(channels.team_id, run.team_id)).all(),
    ]);
    if (
      !item?.content ||
      (item.content_type === "video" && item.transcript_status !== "available")
    )
      throw new ResearchDraftValidationError("Full source evidence is unavailable for this draft");
    const sourceContent = item.content;
    const originals = await getDraftResearchFindings(run.team_id, priorDrafts);
    const originalPriorDrafts = priorDrafts.map(draft => {
      const original = originals.get(`${draft.runId}:${draft.findingId}`);
      const truthfulDraft = { ...draft, publishedAt: researchFindingDates({ ...draft, published_at: draft.publishedAt }).publishedAt };
      return original ? { ...draft, familyKey: original.family_key, title: original.title, url: original.url,
        publishedAt: researchFindingDates(original).publishedAt, summary: original.summary, contentAngle: original.content_angle,
        evidence: original.evidence } : truthfulDraft;
    });
    const noveltyContext = researchNoveltyContext(originalPriorDrafts, teamChannels, {
      runId: run.id, findingId: finding.id, familyKey: finding.family_key, title: finding.title, url: finding.url,
      summary: finding.summary, contentAngle: finding.content_angle, evidence: finding.evidence, content: sourceContent,
    }, destinations);
    const bundled = sourceBundle ? JSON.parse(sourceBundle.value) as { items: Array<{ itemId: string; evidence: string }> } : null;
    const relatedIds = bundled?.items.filter(member => member.itemId !== item.id).map(member => member.itemId) || [];
    const relatedItems = relatedIds.length ? await db.select().from(research_items).where(and(
      eq(research_items.team_id, run.team_id), inArray(research_items.id, relatedIds),
    )).all() : [];
    const supportingItem = relatedItems.find(candidate => candidate.canonical_url !== finding.url
      && candidate.content && candidate.content.trim() !== sourceContent.trim()
      && candidate.published_at !== null && candidate.published_at <= run.created_at
      && (candidate.content_type !== "video" || candidate.transcript_status === "available")
      && matchResearchQuote(candidate.content, bundled!.items.find(member => member.itemId === candidate.id)!.evidence));
    const supportingSources = supportingItem?.content ? [{
      url: supportingItem.canonical_url, title: supportingItem.title,
      publishedAt: new Date(supportingItem.published_at!).toISOString(),
      content: supportingItem.content, contentProvenance: supportingItem.content_provenance,
    }] : [];
    const proposedInput = {
      ...noveltyContext,
      icp: run.icp,
      brand: brand
        ? {
            name: brand.name,
            voice: brand.voice,
            audience: brand.audience,
            writingGuidelines: brand.writing_prompt,
          }
        : null,
      source: {
        title: finding.title,
        url: finding.url,
        ...researchFindingSourceContext(finding, run, item.collected_at),
        content: sourceContent,
        contentProvenance: item.content_provenance,
        ...(supportingSources.length ? { supportingSources } : {}),
      },
      finding: {
        summary: finding.summary,
        whyItMatters: finding.why_it_matters,
        contentAngle: finding.content_angle,
        evidence: finding.evidence,
        limitations: finding.limitations,
      },
      destinations,
      identityGroups: groupResearchIdentities(destinations).map(group => ({
        id: group.id, name: group.name, channelIds: group.profiles.map(profile => profile.id),
      })),
      current: current || null,
      editorialInstruction: editorialInstruction || null,
    };
    const value = JSON.stringify(proposedInput);
    const createdAt = Date.now();
    await retryResearchStorage(async () => db.insert(research_cache).values({
      id: inputId, team_id: run.team_id, value, created_at: createdAt,
    }).onConflictDoNothing());
    frozenInput = await db.select().from(research_cache).where(and(
      eq(research_cache.id, inputId), eq(research_cache.team_id, run.team_id),
    )).get();
  }
  if (!frozenInput) throw new Error("Writing input snapshot could not be read");
  const input = JSON.parse(frozenInput.value) as ResearchDraftWritingInput;
  let inputTokens = 0, outputTokens = 0;
  const result = await runResearchDraftWriting(input, async (instructions, modelInput, schema, maxTokens, operation) => {
    const cacheId = await researchHash(JSON.stringify([run.team_id, RESEARCH_WRITING_MODEL, DRAFT_PROMPT_VERSION, operation, modelInput]));
    const cached = await db.select().from(research_cache).where(and(eq(research_cache.id, cacheId), eq(research_cache.team_id, run.team_id))).get();
    if (cached) {
      await db.update(research_runs).set({ cache_hits: sql`${research_runs.cache_hits} + 1` }).where(eq(research_runs.id, run.id));
      return JSON.parse(cached.value);
    }
    let response: Awaited<ReturnType<typeof callResearchModel>>;
    try {
      response = await callResearchModel(instructions, modelInput, schema, maxTokens,
        { teamId: run.team_id, runId: run.id, stage: current ? "slack_revision" : "draft_generation", operation }, RESEARCH_WRITING_MODEL);
    } catch (error) {
      if (error instanceof ResearchModelRateLimitError || run.days !== 0.5 || run.status !== "ranking") throw error;
      throw new ResearchInterimProviderError();
    }
    inputTokens += response.inputTokens;
    outputTokens += response.outputTokens;
    const value = JSON.stringify(response.value);
    const createdAt = Date.now();
    await retryResearchStorage(async () => db.insert(research_cache).values({ id: cacheId, team_id: run.team_id, value, created_at: createdAt })
      .onConflictDoUpdate({ target: research_cache.id, set: { value, created_at: createdAt } }));
    return response.value;
  });
  return { ...result, inputTokens, outputTokens };
}

export async function rewriteResearchDraftContent(
  draftId: string,
  teamId: string,
  instruction: string,
) {
  const editorialInstruction = z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .parse(instruction);
  const db = await getDb();
  const draft = await db
    .select()
    .from(research_drafts)
    .where(
      and(eq(research_drafts.id, draftId), eq(research_drafts.team_id, teamId)),
    )
    .get();
  if (!draft) throw new Error("Draft not found");
  const [run, finding] = await Promise.all([
    db
      .select()
      .from(research_runs)
      .where(
        and(
          eq(research_runs.id, draft.run_id),
          eq(research_runs.team_id, teamId),
        ),
      )
      .get(),
    getRunResearchFindings(teamId, draft.run_id, [draft.finding_id]).then(rows => rows[0]),
  ]);
  if (!run || !finding) throw new Error("Draft evidence not found");
  const current = JSON.parse(draft.content) as ResearchDraftContent;
  const configuredProfiles = await db
    .select()
    .from(channels)
    .where(
      and(
        eq(channels.team_id, teamId),
        inArray(
          channels.id,
          current.targets.map((target) => target.channelId),
        ),
      ),
    )
    .all();
  const destinations = current.targets.map((target) => {
    const profile = configuredProfiles.find(
      (channel) =>
        channel.id === target.channelId && channel.platform === target.platform,
    );
    if (
      !profile ||
      (!draft.is_test &&
        (!profile.research_enabled || profile.system_prompt.trim().length < 20))
    )
      throw new Error(
        "A selected publishing profile is no longer enabled for research",
      );
    return {
      id: profile.id,
      platform: profile.platform,
      name: profile.name,
      systemPrompt: draft.is_test ? SLACK_TEST_PROMPT : profile.system_prompt,
      groupName: profile.group_name,
    };
  });
  const result = await generateDraft(
    run,
    finding,
    destinations,
    current,
    editorialInstruction,
  );
  if (!result.content)
    throw new Error(
      "The requested edit cannot be supported by this source. Try a change to tone, length, or structure.",
    );
  return { ...result, content: result.content };
}

type ResearchDraftProgress = {
  candidateIds: string[];
  selectedIds: string[];
  nextOffset: number;
  validationSkips: number;
  interimFailures?: number;
  deliveryFailures?: number;
  rejectedStories: NonNullable<ResearchRunDiagnostics["rejectedStories"]>;
  deliveryIds: string[];
  deliveryOffset: number;
};
// One story can require generation, repair and two independent editorial reviews.
const RESEARCH_DRAFT_BATCH_SIZE = 1;
const RESEARCH_REVIEW_BATCH_SIZE = 6;

export async function processResearchDraftJob(runId: string, interim = false) {
  const db = await getDb();
  const run = await db
    .select()
    .from(research_runs)
    .where(eq(research_runs.id, runId))
    .get();
  if (!run) throw new Error("Run not found");
  if (
    !run.editorial ||
    run.mode !== "scan" ||
    (run.days !== 1 && run.days !== 0.5) ||
    !(interim ? run.days === 0.5 && run.status === "ranking" : ["drafting", "completed"].includes(run.status))
  )
    return { drafted: 0, skipped: true };
  async function acknowledgePendingDrafts() {
    const rankId = `rank-progress:${run!.id}`;
    const rank = await db.select().from(research_cache).where(and(eq(research_cache.id, rankId), eq(research_cache.team_id, run!.team_id))).get();
    if (!rank) return;
    const value = JSON.parse(rank.value);
    if (!value.pendingDrafts) return;
    value.pendingDrafts = false;
    const updated = await db.update(research_cache).set({ value: JSON.stringify(value) }).where(and(
      eq(research_cache.id, rankId), eq(research_cache.team_id, run!.team_id), eq(research_cache.value, rank.value),
    )).returning({ id: research_cache.id });
    if (updated.length !== 1) throw new Error("Rank progress changed while acknowledging interim drafts");
  }
  const connected = await db
    .select({
      id: channels.id,
      platform: channels.platform,
      name: channels.name,
      systemPrompt: channels.system_prompt,
      groupName: channels.group_name,
    })
    .from(channels)
    .where(
      and(
        eq(channels.team_id, run.team_id),
        eq(channels.research_enabled, true),
      ),
    )
    .all();
  const supported = new Set<string>(RESEARCH_TEXT_PLATFORMS);
  const destinations = connected.filter(
    (channel) =>
      supported.has(channel.platform) &&
      channel.systemPrompt.trim().length >= 20 &&
      (channel.platform !== "reddit" ||
        /\br\/[a-zA-Z0-9_]{2,21}\b/.test(channel.systemPrompt)),
  );
  const excluded = connected.filter(
    (channel) => !destinations.includes(channel),
  );
  const configurationWarning = excluded.length
    ? `Skipped profiles requiring media, a system prompt, a publishing implementation, or an explicit Reddit r/subreddit: ${excluded.map((profile) => profile.name).join(", ")}.`
    : null;
  if (!destinations.length) {
    if (interim) { await acknowledgePendingDrafts(); return { drafted: 0, skipped: true }; }
    await db
      .update(research_runs)
      .set({
        status: "completed",
        completed_at: Date.now(),
        diagnostics: JSON.stringify({ ...JSON.parse(run.diagnostics), draftedCount: 0, outcome: "Findings saved, but no enabled publishing profile has usable writing instructions." }),
        error: [
          run.error,
          configurationWarning ||
            "No publishing profiles are enabled for research. Findings are saved; select profiles and add their system prompts to create approval drafts.",
        ]
          .filter(Boolean)
          .join(" "),
      })
      .where(eq(research_runs.id, runId));
    return { drafted: 0, skipped: true };
  }
  const progressId = `draft-progress:${run.id}`;
  const saved = await db.select().from(research_cache).where(and(
    eq(research_cache.id, progressId), eq(research_cache.team_id, run.team_id),
  )).get();
  let progress = saved ? JSON.parse(saved.value) as ResearchDraftProgress : undefined;
  const sourceIds = new Set(JSON.parse(run.source_ids) as string[]);
  const candidates = progress && run.days !== 0.5 ? [] : (await getRunResearchFindings(run.team_id, run.id)).filter(finding =>
    sourceIds.has(finding.source_id) && finding.score >= RESEARCH_POST_MIN_SCORE
    && (researchFindingDates(finding).publishedAt === null || finding.published_at <= run.created_at) && finding.status !== "dismissed");
  const knownCandidates = new Set(progress?.candidateIds || []);
  for (const finding of candidates) if (!knownCandidates.has(finding.id)) await saveResearchFindingSnapshot(finding);
  const previous = await db
    .select({
      runId: research_drafts.run_id,
      findingId: research_drafts.finding_id,
      family: research_findings.family_key,
    })
    .from(research_drafts)
    .innerJoin(
      research_findings,
      and(
        eq(research_findings.id, research_drafts.finding_id),
        eq(research_findings.team_id, research_drafts.team_id),
      ),
    )
    .where(eq(research_drafts.team_id, run.team_id))
    .all();
  const originals = await getDraftResearchFindings(run.team_id, previous);
  const families = new Set(previous.map(entry => originals.get(`${entry.runId}:${entry.findingId}`)?.family_key || entry.family));
  let drafted = previous.filter((entry) => entry.runId === run.id).length;
  const diagnostics = JSON.parse(run.diagnostics) as ResearchRunDiagnostics;
  progress ||= {
    candidateIds: candidates.map(finding => finding.id),
    selectedIds: candidates.filter(finding => !families.has(finding.family_key)).map(finding => finding.id),
    nextOffset: 0, validationSkips: 0,
    rejectedStories: [...(diagnostics.rejectedStories || [])],
    deliveryIds: [], deliveryOffset: 0,
  };
  // A 12-hour run may qualify more findings after an interim draft batch.
  // Append only new frozen snapshot IDs, preserving all prior offsets/decisions.
  if (run.days === 0.5) {
    const known = new Set(progress.candidateIds);
    for (const finding of candidates) if (!known.has(finding.id)) {
      progress.candidateIds.push(finding.id);
      if (!families.has(finding.family_key)) progress.selectedIds.push(finding.id);
      known.add(finding.id);
    }
  }
  const rejectedStories = progress.rejectedStories;
  async function checkpointDrafts() {
    const value = JSON.stringify(progress);
    const savedDiagnostics = JSON.stringify({ ...diagnostics, draftCandidatesCount: progress!.candidateIds.length, draftedCount: drafted, rejectedStories });
    const createdAt = Date.now();
    await retryResearchStorage(async () => db.batch([
      db.insert(research_cache).values({
        id: progressId, team_id: run!.team_id, value, created_at: createdAt,
      }).onConflictDoUpdate({ target: research_cache.id, set: { value } }),
      db.update(research_runs).set({ diagnostics: savedDiagnostics }).where(eq(research_runs.id, runId)),
    ]));
  }
  await checkpointDrafts();
  const batchIds = progress.selectedIds.slice(progress.nextOffset, progress.nextOffset + RESEARCH_DRAFT_BATCH_SIZE);
  const rows = batchIds.length ? await getRunResearchFindings(run.team_id, run.id, batchIds) : [];
  for (const findingId of batchIds) {
    const finding = rows.find(row => row.id === findingId);
    if (!finding || families.has(finding.family_key) || finding.status === "dismissed") {
      progress.nextOffset++;
      await checkpointDrafts();
      continue;
    }
    let result: Awaited<ReturnType<typeof generateDraft>>;
    try {
      result = await generateDraft(run, finding, destinations);
    } catch (error) {
      if (error instanceof ResearchModelRateLimitError) {
        await checkpointDrafts();
        return { drafted, pending: true, retryAfterMs: error.retryAfterMs };
      }
      if (!(error instanceof ResearchDraftValidationError) && !(interim && error instanceof ResearchInterimProviderError)) throw error;
      // An uncertain writing outcome must not be automatically repeated. Preserve
      // the finding for manual review while allowing the remaining scan to proceed.
      progress.validationSkips++;
      if (error instanceof ResearchInterimProviderError) progress.interimFailures = (progress.interimFailures || 0) + 1;
      rejectedStories.push({
        title: finding.title,
        score: finding.score,
        reason: `${error instanceof ResearchDraftValidationError ? "Draft validation failed" : "Interim writing failed; no automatic retry"}: ${error instanceof Error ? error.message : "Unknown writing failure"}`.slice(0, 500),
      });
      progress.nextOffset++;
      await checkpointDrafts();
      continue;
    }
    if (!result.content) {
      rejectedStories.push({
        title: finding.title, score: finding.score,
        reason: `No grounded draft: ${result.skipReason || "The source did not support a worthwhile post for these profiles."}`.slice(0, 500),
      });
      progress.nextOffset++;
      await checkpointDrafts();
      continue;
    }
    const id = await researchHash(
      `research-draft:${run.team_id}:${finding.id}`,
    );
    const now = Date.now();
    const content = JSON.stringify(result.content);
    await retryResearchStorage(async () => db.batch([
      db
        .insert(research_drafts)
        .values({
          id,
          team_id: run.team_id,
          run_id: run.id,
          finding_id: finding.id,
          content,
          revision: 1,
          status: "draft",
          input_tokens: result.inputTokens,
          output_tokens: result.outputTokens,
          created_at: now,
          updated_at: now,
        })
        .onConflictDoNothing(),
      db
        .insert(research_draft_revisions)
        .values({
          id: `${id}:1`,
          team_id: run.team_id,
          draft_id: id,
          revision: 1,
          content,
          created_at: now,
        })
        .onConflictDoNothing(),
    ]));
    families.add(finding.family_key);
    drafted++;
    progress.nextOffset++;
    await checkpointDrafts();
  }
  // Stored drafts survive a Slack outage and can be sent again without regenerating copy.
  const pending = await db
    .select()
    .from(research_drafts)
    .where(
      and(
        eq(research_drafts.team_id, run.team_id),
        eq(research_drafts.run_id, run.id),
        inArray(research_drafts.status, ["draft", "failed"]),
      ),
    )
    .all();
  const deliveryIds = new Set(progress.deliveryIds);
  progress.deliveryIds.push(...pending.filter(draft => !deliveryIds.has(draft.id)).map(draft => draft.id));
  await checkpointDrafts();
  const deliveryBatch = progress.deliveryIds.slice(progress.deliveryOffset, progress.deliveryOffset + RESEARCH_REVIEW_BATCH_SIZE);
  for (const draftId of deliveryBatch) {
    try {
      const { queueResearchDraftForSlack } = await import("./slack-review");
      // The Slack job key includes draft ID and revision, so checkpoint recovery
      // cannot create a second review for an already queued revision.
      if (pending.some(draft => draft.id === draftId)) await queueResearchDraftForSlack(draftId);
    } catch {
      progress.deliveryFailures = (progress.deliveryFailures || 0) + 1;
      await db
        .update(research_drafts)
        .set({
          error: "Slack review queueing could not be confirmed; check its delivery state before retrying.",
          updated_at: Date.now(),
        })
        .where(
          and(
            eq(research_drafts.id, draftId),
            eq(research_drafts.team_id, run.team_id),
          ),
        );
    }
    progress.deliveryOffset++;
    await checkpointDrafts();
  }
  if (progress.nextOffset < progress.selectedIds.length || progress.deliveryOffset < progress.deliveryIds.length) {
    if (!interim) await retryResearchStorage(async () => db.update(research_runs).set({ status: "drafting", completed_at: null }).where(eq(research_runs.id, runId)));
    return { drafted, pending: true };
  }
  if (interim) { await acknowledgePendingDrafts(); return { drafted, pending: false }; }
  const validationSkips = progress.validationSkips;
  let outcome = "Strong findings were reviewed, but no original draft fit the enabled profiles with sufficient evidence.";
  if (drafted > 0) {
    outcome = `Created ${drafted} draft${drafted === 1 ? "" : "s"}; review delivery is tracked with each draft.`;
  } else if (progress.candidateIds.length === 0) {
    outcome = `${diagnostics.outcome || "Research finished."} No eligible findings scored at least ${RESEARCH_POST_MIN_SCORE} for drafting.`;
  } else if (progress.selectedIds.length === 0) {
    outcome = "Strong findings were already drafted; duplicate stories were skipped.";
  } else if (validationSkips) {
    outcome = `${validationSkips} stor${validationSkips === 1 ? "y could" : "ies could"} not produce valid grounded drafts. See the per-story validation reasons.`;
  }
  const completedAt = Date.now();
  const finalDiagnostics = JSON.stringify({ ...diagnostics, draftCandidatesCount: progress.candidateIds.length, draftedCount: drafted, rejectedStories, outcome });
  const finalError = [run.error, configurationWarning, progress.interimFailures ? `${progress.interimFailures} interim writing request(s) failed; no automatic retry was attempted. Review the affected findings manually.` : null, progress.deliveryFailures ? `${progress.deliveryFailures} Slack review(s) could not be confirmed queued; check the drafts before retrying.` : null, !drafted && validationSkips ? `${validationSkips} stories failed draft validation; no drafts were generated. See the per-story reasons.` : null].filter(Boolean).join(" ") || null;
  await retryResearchStorage(async () => db
    .update(research_runs)
    .set({
      status: "completed",
      completed_at: completedAt,
      diagnostics: finalDiagnostics,
      error: finalError,
    })
    .where(eq(research_runs.id, runId)));
  return { drafted };
}
