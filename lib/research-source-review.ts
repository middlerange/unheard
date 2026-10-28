import { researchEvidenceFailures, researchEvidenceItemCacheId, validateResearchEvidenceCacheValue, type EvidenceCacheContext, type EvidenceCacheInput, type EvidenceCacheValue, type EvidenceFailure } from "./research-evidence-cache";
import { matchResearchQuote, researchEvidenceSchema, researchHash, validateResearchEvidence, validateResearchEvidenceProfiles, validateResearchSectionCoverage, type ResearchEvidence } from "./research-model";
import type { ResearchAudience } from "./research-audience";
import { ResearchCoveragePending, type ResearchCoverageAccess } from "./research-coverage";
import { RESEARCH_POST_MIN_SCORE } from "./research-policy";
import { researchSourceSections } from "./research-sections";
import { retryResearchStorage } from "./research-storage";
import { verifyResearchEvidenceFailure } from "./research-quote-repair";
import { RESEARCH_SOURCE_REVIEW_VERSION, RESEARCH_SOURCE_REVIEW_INSTRUCTIONS, researchSourceReviewAudience, researchSourceReviewPassages, researchSourceReviewSchemaForItems, normalizeResearchSourceReview, type ResearchSourceReviewSource, type ResearchSourceReviewResult, type ResearchSourceReviewProof, type ResearchSourceReviewDiagnostic } from "./research-source-review-model";

export { RESEARCH_SOURCE_REVIEW_VERSION } from "./research-source-review-model";
export type ResearchSourceReviewInput = EvidenceCacheInput & { content: string };
export type ResearchSourceReviewRequest = { model: string; instructions: string; schema: Record<string, unknown>; data: ReturnType<typeof researchSourceReviewAudience> & { items: Array<Record<string, unknown>> } };
export type ResearchSourceReviewPolicy = {
  version: string; instructions: string; model?: string;
  sourceSchema?: (source: ResearchSourceReviewSource, profileIds: string[]) => Record<string, unknown>;
  requestMetadata?: (source: ResearchSourceReviewSource) => Record<string, unknown> | Promise<Record<string, unknown>>;
  policyForSource?: (source: ResearchSourceReviewSource) => ResearchSourceReviewPolicy;
  normalize?: (raw: unknown, sources: ResearchSourceReviewSource[], profileIds: string[]) => ResearchSourceReviewResult | Promise<ResearchSourceReviewResult>;
};
export type SourceReviewMultiProof = ResearchSourceReviewProof & { reviewManifestId: string };
export type SourceReviewEvidenceValue = EvidenceCacheValue & { sourceReviewManifestIds: string[]; multiProofs: SourceReviewMultiProof[]; sourceReviewDiagnostics: Array<ResearchSourceReviewDiagnostic & { reviewManifestId: string }> };
export type ResearchSourceReviewAccess = Pick<ResearchCoverageAccess, "read" | "claim" | "save" | "writeImmutable" | "budget" | "now"> & {
  context: EvidenceCacheContext;
  generate: (request: ResearchSourceReviewRequest) => Promise<unknown>;
};
export class ResearchSourceReviewPending extends ResearchCoveragePending {
  constructor(planIds: string[], manifestIds: string[], public readonly pendingSources: number, public readonly activeSources: number) {
    super(planIds, manifestIds, pendingSources, activeSources);
    this.name = "ResearchSourceReviewPending";
    this.message = `Whole-source review checkpoint pending (${pendingSources} sources, ${activeSources} in flight)`;
  }
}
type FailureParent = { failure: EvidenceFailure; receipt: NonNullable<Parameters<typeof verifyResearchEvidenceFailure>[4]> };
type Receipt = { version: string; planId: string; planHash: string; sourceId: string; bodyHash: string; nonce: string; startedAt: number } & (
  { state: "started" } | { state: "completed"; completedAt: number; raw: unknown; rawHash: string; resultHash: string }
  | { state: "failed" | "indeterminate"; completedAt: number; reason: string }
);
type Idea = Omit<ResearchEvidence, "itemId" | "additionalIdeas" | "sectionChecks">;
const json = (value: unknown) => JSON.stringify(value);
const stable = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const family = (key: string) => key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function parentIdeas(parent?: ResearchEvidence): Idea[] {
  if (!parent) return [];
  const { itemId: _id, additionalIdeas, sectionChecks: _checks, ...primary } = parent;
  return [primary, ...(additionalIdeas || [])];
}
function appendUnique<T>(target: T[], values: T[]) {
  const seen = new Set(target.map(stable));
  for (const value of values) {
    const key = stable(value);
    if (!seen.has(key)) { target.push(value); seen.add(key); }
  }
}

export async function reviewResearchSources(items: ResearchSourceReviewInput[], baseValue: EvidenceCacheValue, access: ResearchSourceReviewAccess,
  policy: ResearchSourceReviewPolicy = { version: RESEARCH_SOURCE_REVIEW_VERSION, instructions: RESEARCH_SOURCE_REVIEW_INSTRUCTIONS },
): Promise<{ value: SourceReviewEvidenceValue; manifestIds: string[] }> {
  const audience = access.context.audience as ResearchAudience, profileIds = audience?.publishingProfiles?.map(profile => profile.id);
  if (!profileIds?.length || new Set(profileIds).size !== profileIds.length || profileIds.some(id => typeof id !== "string" || !id)) throw new Error("Source review requires the full frozen publishing-profile roster");
  const view = researchSourceReviewAudience(audience), now = access.now || Date.now, budget = access.budget || { remaining: 2 };
  view.sourceReviewVersion = policy.version;
  if (!Number.isInteger(budget.remaining) || budget.remaining < 0 || budget.remaining > 2) throw new Error("Source review checkpoint budget must be between zero and two");
  const sources = items.map(item => {
    if (typeof item.content !== "string") throw new Error("Source review requires captured public text");
    return researchSourceSections(item);
  });
  const verified: FailureParent[] = [];
  for (const failure of researchEvidenceFailures(baseValue)) {
    const source = sources.find(item => item.id === failure.itemId);
    if (!source) throw new Error("Source review failure refers to an unknown source");
    const receipt = await access.read(failure.receiptId) as FailureParent["receipt"] | null;
    const checked = await verifyResearchEvidenceFailure(failure, source, profileIds, await researchEvidenceItemCacheId(access.context, source), receipt);
    verified.push({ failure: checked, receipt: receipt! });
  }
  const base = validateResearchEvidenceCacheValue(baseValue, sources, profileIds, verified.map(parent => parent.failure));
  async function immutable(id: string, value: unknown) {
    await retryResearchStorage(() => access.writeImmutable(id, value));
    if (stable(await access.read(id)) !== stable(value)) throw new Error("Source review immutable record differs from its frozen plan");
  }
  const work = await Promise.all(sources.filter(source => source.content.trim().length >= 500).map(async source => {
    const parent = base.findings.find(finding => finding.itemId === source.id), failure = verified.find(value => value.failure.itemId === source.id);
    if (!parent && !failure) throw new Error("Source review requires a valid covered parent or verified source failure");
    const passages = researchSourceReviewPassages(source.content), catalogSource: ResearchSourceReviewSource = { ...source, passages };
    const { content: _content, excerpt: _excerpt, publicText: _publicText, sourceSections: _sections, ...metadata } = source;
    const effectivePolicy = policy.policyForSource?.(catalogSource) ?? policy;
    const sourceView = effectivePolicy.version === policy.version ? view : { ...view, sourceReviewVersion: effectivePolicy.version };
    const extraMetadata = effectivePolicy.requestMetadata ? await effectivePolicy.requestMetadata(catalogSource) : {};
    if (!extraMetadata || typeof extraMetadata !== "object" || Array.isArray(extraMetadata)) throw new Error("Source review policy metadata must be an object");
    const protectedKeys = new Set([...Object.keys(source), "id", "content", "excerpt", "publicText", "passages", "sourceSections"]);
    if (Object.keys(extraMetadata).some(key => protectedKeys.has(key))) throw new Error("Source review policy metadata cannot shadow captured source fields");
    const request: ResearchSourceReviewRequest = { model: effectivePolicy.model ?? access.context.model, instructions: effectivePolicy.instructions,
      schema: effectivePolicy.sourceSchema ? effectivePolicy.sourceSchema(catalogSource, profileIds) : researchSourceReviewSchemaForItems([source.id], profileIds),
      data: { ...sourceView, items: [{ ...metadata, passages, ...extraMetadata }] } };
    const parentValue: EvidenceCacheValue = { findings: parent ? [parent] : [], ...(failure ? { evidenceFailures: [failure.failure] } : {}),
      ...(base.citationRepairs?.some(repair => repair.itemId === source.id) ? { citationRepairs: base.citationRepairs.filter(repair => repair.itemId === source.id) } : {}) };
    const bodyHash = await researchHash(source.content), baseCoveredHash = await researchHash(stable(parentValue));
    const plan = { version: effectivePolicy.version, teamId: access.context.teamId, sourceId: source.id,
      baseCacheId: await researchEvidenceItemCacheId(access.context, source), fullSourceHash: await researchHash(json(source)), bodyHash,
      fullFrozenAudience: audience, researchView: sourceView, baseCoveredHash, parentValue, parentFailure: failure || null, catalogSource, request };
    const planHash = await researchHash(json(plan)), planId = `research-source-review-plan:v1:${planHash}`, receiptId = `research-source-review-attempt:v1:${planHash}`;
    await immutable(planId, plan);
    return { source, parent, failure, catalogSource, request, policy: effectivePolicy, plan, planHash, planId, receiptId, bodyHash, parentValue };
  }));
  type Work = (typeof work)[number];
  async function readReceipt(item: Work): Promise<Receipt | null> {
    const receipt = await access.read(item.receiptId) as Receipt | null;
    if (!receipt) return null;
    if (receipt.version !== item.policy.version || receipt.planId !== item.planId || receipt.planHash !== item.planHash || receipt.sourceId !== item.source.id || receipt.bodyHash !== item.bodyHash
      || typeof receipt.nonce !== "string" || !receipt.nonce || !Number.isFinite(receipt.startedAt) || receipt.startedAt < 0 || receipt.startedAt > now()
      || !["started", "completed", "failed", "indeterminate"].includes(receipt.state)) throw new Error("Source review receipt does not match its frozen source context");
    if (receipt.state !== "started" && (!Number.isFinite(receipt.completedAt) || receipt.completedAt < receipt.startedAt)) throw new Error("Source review terminal receipt has an invalid time");
    if (receipt.state === "completed" && (!Object.hasOwn(receipt, "raw") || !receipt.rawHash || !receipt.resultHash)) throw new Error("Source review completed receipt has no raw result binding");
    if ((receipt.state === "failed" || receipt.state === "indeterminate") && !receipt.reason) throw new Error("Source review terminal failure has no reason");
    if (receipt.state === "indeterminate" && receipt.completedAt - receipt.startedAt < 120_000) throw new Error("Source review indeterminate receipt has no expired claim");
    return receipt;
  }
  async function normalize(item: Work, raw: unknown): Promise<ResearchSourceReviewResult> {
    if (!item.policy.normalize) return normalizeResearchSourceReview(raw, [item.catalogSource], profileIds);
    const result = await item.policy.normalize(raw, [item.catalogSource], profileIds);
    if (!result || !Array.isArray(result.findings) || !Array.isArray(result.proofs) || !Array.isArray(result.diagnostics)) throw new Error("Source review policy returned an invalid result");
    const catalogHash = await researchHash(json(item.catalogSource.passages));
    for (const proof of result.proofs) {
      if (proof.itemId !== item.source.id || proof.bodyHash !== item.bodyHash || proof.catalogHash !== catalogHash
        || !Array.isArray(proof.evidencePassageIds) || new Set(proof.evidencePassageIds).size !== proof.evidencePassageIds.length || !Array.isArray(proof.passages)) throw new Error("Source review policy proof does not match its own captured source");
      const selected = proof.evidencePassageIds.map(id => item.catalogSource.passages[id]);
      if (selected.some(passage => !passage?.selectable || passage.text !== item.source.content.slice(passage.start, passage.end))
        || stable(proof.passages) !== stable(selected.map(({ passageId, start, end, text }) => ({ passageId, start, end, text })))) throw new Error("Source review policy proof has a nonliteral catalog passage");
    }
    for (const finding of result.findings) {
      if (finding.itemId !== item.source.id) throw new Error("Source review policy returned another source's finding");
      const checked = researchEvidenceSchema.parse({ findings: [finding] }).findings[0];
      validateResearchEvidenceProfiles([checked], profileIds);
      if (checked.score !== finding.score || checked.qualificationRubric !== finding.qualificationRubric) throw new Error("Source review policy changed the categorical score");
      if (finding.score < RESEARCH_POST_MIN_SCORE) continue;
      const proof = result.proofs.find(proof => proof.familyKey === finding.familyKey && stable(proof.passages.map(passage => passage.text)) === stable(finding.supportingEvidence));
      if (!proof?.passages.length || finding.evidence !== proof.passages[0].text
        || validateResearchEvidence([checked], [item.source]).length !== 1) throw new Error("Passing source review policy frame has no own-source citation anchor");
    }
    return result;
  }
  async function completed(item: Work, receipt: Receipt) {
    if (receipt.state !== "completed") return null;
    if (receipt.rawHash !== await researchHash(json(receipt.raw))) throw new Error("Source review raw response hash changed");
    const result = await normalize(item, receipt.raw);
    if (receipt.resultHash !== await researchHash(stable(result))) throw new Error("Source review normalized result changed");
    return result;
  }
  async function save(item: Work, expected: Receipt, value: Receipt) {
    await retryResearchStorage(() => access.save(item.receiptId, expected, value));
    const receipt = await readReceipt(item);
    if (!receipt || receipt.state === "started") throw new Error("Source review terminal receipt was not saved");
  }
  for (const item of work) {
    const receipt = await readReceipt(item);
    if (receipt?.state === "started" && now() - receipt.startedAt >= 120_000) await save(item, receipt, { ...receipt, state: "indeterminate", completedAt: now(), reason: "Declared source review exceeded120 seconds; provider outcome is indeterminate and will not be retried." });
  }
  const waiting: Array<{ item: Work; active: boolean }> = [];
  for (const item of work) { const receipt = await readReceipt(item); if (!receipt || receipt.state === "started") waiting.push({ item, active: Boolean(receipt) }); }
  const running: Promise<void>[] = [];
  for (const { item } of waiting.sort((a, b) => Number(b.active) - Number(a.active)).slice(0, 2)) {
    if (!budget.remaining || await readReceipt(item)) continue;
    budget.remaining--;
    const started: Receipt = { version: item.policy.version, planId: item.planId, planHash: item.planHash, sourceId: item.source.id, bodyHash: item.bodyHash, nonce: crypto.randomUUID(), startedAt: now(), state: "started" };
    const inserted = await retryResearchStorage(() => access.claim(item.receiptId, started));
    if (!inserted && stable(await access.read(item.receiptId)) !== stable(started)) { budget.remaining++; continue; }
    running.push((async () => {
      let terminal: Receipt;
      try {
        const raw = await access.generate(item.request) ?? null, result = await normalize(item, raw);
        terminal = { ...started, state: "completed", completedAt: now(), raw, rawHash: await researchHash(json(raw)), resultHash: await researchHash(stable(result)) };
      } catch (error) { terminal = { ...started, state: "failed", completedAt: now(), reason: (error instanceof Error ? error.message : "Source review request failed").slice(0, 600) }; }
      await save(item, started, terminal);
    })());
  }
  const settled = await Promise.allSettled(running), rejected = settled.find(result => result.status === "rejected");
  if (rejected?.status === "rejected") throw rejected.reason;
  const findings = new Map(base.findings.map(finding => [finding.itemId, finding])), failures = new Map((base.evidenceFailures || []).map(failure => [failure.itemId, failure]));
  const manifestIds = [...new Set(baseValue.sourceReviewManifestIds || [])], multiProofs: SourceReviewMultiProof[] = [], diagnostics: SourceReviewEvidenceValue["sourceReviewDiagnostics"] = [];
  appendUnique(multiProofs, baseValue.multiProofs || []);
  appendUnique(diagnostics, baseValue.sourceReviewDiagnostics || []);
  let pendingSources = 0, activeSources = 0;
  for (const item of work) {
    const receipt = await readReceipt(item);
    if (!receipt || receipt.state === "started") { pendingSources++; if (receipt) activeSources++; continue; }
    const result = await completed(item, receipt), original = parentIdeas(item.parent);
    const selected = new Map(original.filter(idea => family(idea.familyKey)).map(idea => [family(idea.familyKey), { idea, proof: null as ResearchSourceReviewProof | null }]));
    const oldFamilies = new Set(selected.keys()), selections: Array<{ familyKey: string; decision: string }> = [];
    for (const frame of result?.findings || []) {
      if (frame.score < RESEARCH_POST_MIN_SCORE) continue;
      const key = family(frame.familyKey), old = selected.get(key);
      if (old && old.idea.score >= RESEARCH_POST_MIN_SCORE) { selections.push({ familyKey: frame.familyKey, decision: old.proof ? "duplicate_review_family" : "accepted_parent_precedence" }); continue; }
      const proof = result!.proofs.find(proof => proof.itemId === frame.itemId && proof.familyKey === frame.familyKey && stable(proof.passages.map(passage => passage.text)) === stable(frame.supportingEvidence));
      if (!proof || proof.bodyHash !== item.bodyHash) throw new Error("Passing source review frame has no own-source multi-passage proof");
      const { itemId: _id, additionalIdeas: _extra, sectionChecks: _checks, supportingEvidence: _support, ...idea } = frame;
      selected.set(key, { idea, proof }); selections.push({ familyKey: frame.familyKey, decision: old ? "replaced_rejected_family" : "added_distinct_family" });
    }
    const mergedIdeas = original.map(idea => selected.get(family(idea.familyKey))?.idea || idea);
    for (const [key, choice] of selected) if (!oldFamilies.has(key)) mergedIdeas.push(choice.idea);
    const sectionChecks = item.source.sourceSections.map(section => {
      const familyKeys = mergedIdeas.filter(idea => family(idea.familyKey) && matchResearchQuote(item.source.content.slice(section.bodyStart, section.end), idea.evidence)).map(idea => idea.familyKey);
      return { sectionId: section.id, familyKeys, notPostworthyReason: familyKeys.length ? "" : item.parent?.sectionChecks?.find(check => check.sectionId === section.id)?.notPostworthyReason || "No selected legacy citation anchor occurs inside this captured section; additional proof remains separately attributed." };
    });
    const assessment = mergedIdeas.length ? researchEvidenceSchema.parse({ findings: [{ itemId: item.source.id, ...mergedIdeas[0], additionalIdeas: mergedIdeas.slice(1), sectionChecks }] }).findings[0] : null;
    if (assessment) {
      validateResearchEvidenceProfiles([assessment], profileIds); validateResearchSectionCoverage([assessment], [item.source]);
      if (validateResearchEvidence([assessment], [item.source]).length !== mergedIdeas.filter(idea => idea.score >= RESEARCH_POST_MIN_SCORE).length) throw new Error("Merged source review lost an own-source citation anchor");
      findings.set(item.source.id, assessment); failures.delete(item.source.id);
    }
    const selectedProofs = [...selected.values()].flatMap(choice => choice.proof ? [choice.proof] : []);
    const manifest = { version: item.policy.version, teamId: access.context.teamId, sourceId: item.source.id, planId: item.planId,
      bodyHash: item.bodyHash, baseCoveredHash: item.plan.baseCoveredHash, parent: item.parentValue, parentFailure: item.failure || null,
      receiptId: item.receiptId, receiptHash: await researchHash(json(receipt)), rawReview: receipt.state === "completed" ? receipt.raw : null,
      review: result, terminalState: receipt.state, terminalReason: "reason" in receipt ? receipt.reason : null, selections,
      result: { findings: assessment ? [assessment] : [], evidenceFailures: assessment || !item.failure ? [] : [item.failure.failure], multiProofs: selectedProofs } };
    const manifestId = `research-source-review-manifest:v1:${await researchHash(json(manifest))}`;
    await immutable(manifestId, manifest); appendUnique(manifestIds, [manifestId]);
    appendUnique(multiProofs, selectedProofs.map(proof => ({ ...proof, reviewManifestId: manifestId })));
    appendUnique(diagnostics, (result?.diagnostics || []).map(diagnostic => ({ ...diagnostic, reviewManifestId: manifestId })));
  }
  if (pendingSources) throw new ResearchSourceReviewPending(work.map(item => item.planId), manifestIds, pendingSources, activeSources);
  const merged = validateResearchEvidenceCacheValue({ findings: sources.flatMap(source => findings.has(source.id) ? [findings.get(source.id)!] : []), ...(failures.size ? { evidenceFailures: [...failures.values()] } : {}), ...(base.citationRepairs?.length ? { citationRepairs: base.citationRepairs } : {}) }, sources, profileIds, [...failures.values()]);
  const { findings: _oldFindings, evidenceFailures: _oldFailures, citationRepairs: _oldRepairs, ...metadata } = baseValue;
  return { value: { ...metadata, ...merged, sourceReviewManifestIds: manifestIds, multiProofs, sourceReviewDiagnostics: diagnostics }, manifestIds };
}
