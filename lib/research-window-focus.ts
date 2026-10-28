import { matchResearchQuote, researchEvidenceSchema, researchHash, validateResearchEvidence, validateResearchEvidenceProfiles, validateResearchSectionCoverage, type ResearchEvidence } from "./research-model";
import { RESEARCH_POST_MIN_SCORE } from "./research-policy";
import { researchSectionInventory } from "./research-sections";
import type { EvidenceFailure } from "./research-evidence-cache";
import { verifyResearchEvidenceFailure } from "./research-quote-repair";

export const RESEARCH_WINDOW_FOCUS_VERSION = "research-window-focus-v1";
export type WindowFocusSource = { id: string; content: string; [key: string]: unknown };
export type WindowFocusContext = { parentCacheId: string; enabledProfileIds: string[] };
export type ResearchEvidenceWindow = { id: string; start: number; end: number };
export type WindowFocusDescriptor = {
  version: typeof RESEARCH_WINDOW_FOCUS_VERSION;
  sourceId: string;
  parentCacheId: string;
  parentSourceHash: string;
  parentContentHash: string;
  parentAssessmentHash: string | null;
  parentFailureReceiptId?: string;
  parentFailureReceiptHash?: string;
  projectedContentHash: string;
  originalContentProvenance: unknown;
  window: ResearchEvidenceWindow;
  ranges: Array<{ start: number; end: number; role: "introduction" | "focus" }>;
};
export type WindowFocusProjection = { cacheKey: string; descriptor: WindowFocusDescriptor; item: WindowFocusSource };
// Callers must cache rejected and failed terminal attempts as well as passing ones.
export type WindowFocusAttempt = { projection: WindowFocusProjection } & (
  { status: "assessed"; assessment: ResearchEvidence } | { status: "failed"; reason: string }
);
export type WindowFocusParentFailure = { failure: EvidenceFailure; receipt: NonNullable<Parameters<typeof verifyResearchEvidenceFailure>[4]> };
type Idea = Omit<ResearchEvidence, "itemId" | "additionalIdeas" | "sectionChecks">;
const family = (key: string) => key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function ideas(assessment: ResearchEvidence): Idea[] {
  const { itemId: _id, additionalIdeas, sectionChecks: _checks, ...primary } = assessment;
  return [primary, ...(additionalIdeas || [])];
}
function boundaries(content: string) {
  const paragraphs = [...content.matchAll(/\r?\n[\t ]*\r?\n\s*/g)].map(match => match.index + match[0].length);
  const sentences = [...content.matchAll(/[.!?]["'”’\])]*(?:\s+|$)/g)].map(match => match.index + match[0].length);
  return { paragraphs, sentences: [...new Set([...paragraphs, ...sentences, content.length])].sort((a, b) => a - b) };
}
export function researchEvidenceWindows(content: string): ResearchEvidenceWindow[] {
  if (content.length <= 5000 || !content.trim()) return [];
  const breaks = boundaries(content), windows: ResearchEvidenceWindow[] = [];
  let start = 0;
  while (start < content.length) {
    const target = start + 3000;
    const near = (values: number[], distance: number) => values.filter(end => end >= target - distance && end <= target + distance && end > start)
      .sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b)[0];
    const end = content.length - start <= 4050 ? content.length
      : near(breaks.paragraphs, 750) || near(breaks.sentences, 1500) || breaks.sentences.find(end => end >= target) || content.length;
    windows.push({ id: `window-${start}`, start, end });
    start = end;
  }
  return windows;
}
function checkedParent(source: WindowFocusSource, parent: ResearchEvidence, context: WindowFocusContext) {
  if (!context.parentCacheId.trim()) throw new Error("Window focus requires the exact frozen parent cache ID");
  const assessment = researchEvidenceSchema.parse({ findings: [parent] }).findings[0];
  if (assessment.itemId !== source.id) throw new Error("Window focus source and parent assessment must match");
  if (JSON.stringify(ideas(parent).map(idea => idea.score)) !== JSON.stringify(ideas(assessment).map(idea => idea.score))) throw new Error("Window focus must preserve an already-normalized parent grade");
  validateResearchEvidenceProfiles([assessment], context.enabledProfileIds);
  if (validateResearchEvidence([assessment], [source]).length !== ideas(assessment).filter(idea => idea.score >= RESEARCH_POST_MIN_SCORE).length) throw new Error("Window focus requires a quote-validated parent assessment");
  if (researchSectionInventory(source.content).length || assessment.sectionChecks !== undefined) validateResearchSectionCoverage([assessment], [source]);
  return assessment;
}
export async function planResearchWindowFocus(source: WindowFocusSource, parent: ResearchEvidence, context: WindowFocusContext): Promise<WindowFocusProjection[]> {
  const assessment = checkedParent(source, parent, context);
  return planWindows(source, context, { parentAssessmentHash: await researchHash(JSON.stringify(assessment)) });
}
// The runtime caller must reverify its terminal receipt against the exact base
// per-source cache ID before entering this isolated hook; verification is repeated locally.
async function checkedFailure(source: WindowFocusSource, parent: WindowFocusParentFailure, context: WindowFocusContext) {
  if (!context.parentCacheId.trim()) throw new Error("Window focus requires the exact frozen parent cache ID");
  const failure = await verifyResearchEvidenceFailure(parent.failure, source, context.enabledProfileIds, context.parentCacheId, parent.receipt);
  return { failure, receipt: structuredClone(parent.receipt) };
}
export async function planResearchWindowFocusFromFailure(source: WindowFocusSource, parent: WindowFocusParentFailure, context: WindowFocusContext): Promise<WindowFocusProjection[]> {
  const verified = await checkedFailure(source, parent, context);
  return planWindows(source, context, { parentAssessmentHash: null, parentFailureReceiptId: verified.failure.receiptId,
    parentFailureReceiptHash: await researchHash(JSON.stringify(verified)) });
}
async function planWindows(source: WindowFocusSource, context: WindowFocusContext,
  parentBinding: Pick<WindowFocusDescriptor, "parentAssessmentHash" | "parentFailureReceiptId" | "parentFailureReceiptHash">): Promise<WindowFocusProjection[]> {
  const windows = researchEvidenceWindows(source.content);
  if (!windows.length) return [];
  const [parentSourceHash, parentContentHash] = await Promise.all([
    researchHash(JSON.stringify(source)), researchHash(source.content),
  ]);
  const introBreaks = boundaries(source.content).sentences.filter(end => end <= 600);
  const whitespace = [...source.content.slice(0, 600).matchAll(/\s+/g)].at(-1);
  const introEnd = introBreaks.at(-1) ?? (whitespace ? whitespace.index + whitespace[0].length : 0);
  return Promise.all(windows.map(async window => {
    const ranges: WindowFocusDescriptor["ranges"] = [
      ...(window.start > 0 && introEnd ? [{ start: 0, end: introEnd, role: "introduction" as const }] : []),
      { start: window.start, end: window.end, role: "focus" },
    ];
    const content = ranges.map(range => source.content.slice(range.start, range.end)).join("");
    const descriptor: WindowFocusDescriptor = { version: RESEARCH_WINDOW_FOCUS_VERSION, sourceId: source.id, parentCacheId: context.parentCacheId,
      parentSourceHash, parentContentHash, ...parentBinding, projectedContentHash: await researchHash(content),
      originalContentProvenance: source.contentProvenance ?? null, window: { ...window }, ranges };
    const item = { ...source, content, contentProvenance: "public_excerpt_window", sourceSections: researchSectionInventory(content), windowFocus: descriptor };
    return { cacheKey: `evidence-window:v1:${await researchHash(JSON.stringify([context, descriptor, item]))}`, descriptor, item };
  }));
}

export async function mergeResearchWindowFocus(source: WindowFocusSource, parent: ResearchEvidence, attempts: WindowFocusAttempt[], context: WindowFocusContext) {
  const original = checkedParent(source, parent, context), plan = await planResearchWindowFocus(source, original, context);
  const merged = mergeWindows(source, original, plan, attempts, context);
  if (!merged.assessment) throw new Error("Valid parent assessment must remain present after window merge");
  return { ...merged, assessment: merged.assessment, parentAssessment: original };
}
export async function mergeResearchWindowFocusFromFailure(source: WindowFocusSource, parent: WindowFocusParentFailure, attempts: WindowFocusAttempt[], context: WindowFocusContext) {
  const verified = await checkedFailure(source, parent, context), plan = await planResearchWindowFocusFromFailure(source, verified, context);
  const merged = mergeWindows(source, null, plan, attempts, context);
  return { ...merged, findings: merged.assessment ? [merged.assessment] : [], evidenceFailures: merged.assessment ? [] : [verified.failure], parentFailure: verified };
}
function mergeWindows(source: WindowFocusSource, original: ResearchEvidence | null, plan: WindowFocusProjection[], attempts: WindowFocusAttempt[], context: WindowFocusContext) {
  const planned = new Map(plan.map(projection => [projection.cacheKey, projection])), supplied = new Map<string, WindowFocusAttempt>();
  for (const attempt of attempts) {
    const expected = planned.get(attempt.projection.cacheKey);
    if (!expected || JSON.stringify(expected) !== JSON.stringify(attempt.projection)) throw new Error("Window focus attempt has stale or unplanned frozen input");
    if (supplied.has(expected.cacheKey)) throw new Error("Window focus permits one terminal attempt per focal window");
    if (attempt.status === "failed" && !attempt.reason.trim()) throw new Error("Failed window focus must retain its failure reason");
    supplied.set(expected.cacheKey, attempt);
  }
  const parentIdeas = original ? ideas(original) : [], selected = new Map(parentIdeas.filter(idea => family(idea.familyKey)).map(idea => [family(idea.familyKey), { idea, origin: "parent" as "parent" | "window" }]));
  const parentFamilies = new Set(selected.keys());
  const lineage: Array<{ cacheKey: string; windowId: string; status: "assessed" | "failed" | "pending"; assessment?: ResearchEvidence; reason?: string;
    selections?: Array<{ familyKey: string; decision: "selected" | "accepted_parent_precedence" | "duplicate_window_family" }> }> = [];
  for (const projection of plan) {
    const attempt = supplied.get(projection.cacheKey), windowId = projection.descriptor.window.id;
    if (!attempt) { lineage.push({ cacheKey: projection.cacheKey, windowId, status: "pending" }); continue; }
    if (attempt.status === "failed") { lineage.push({ cacheKey: projection.cacheKey, windowId, status: "failed", reason: attempt.reason }); continue; }
    const assessment = researchEvidenceSchema.parse({ findings: [attempt.assessment] }).findings[0];
    if (assessment.itemId !== source.id) throw new Error("Window assessment must retain its original source ID");
    validateResearchEvidenceProfiles([assessment], context.enabledProfileIds);
    const window = projection.descriptor.window, body = source.content.slice(window.start, window.end);
    for (const idea of ideas(assessment)) if ((idea.score >= RESEARCH_POST_MIN_SCORE || idea.evidence.trim()) && !matchResearchQuote(body, idea.evidence))
      throw new Error("Window idea evidence must occur inside the original focal window; context-only quotes receive no credit");
    validateResearchSectionCoverage([assessment], [{ ...projection.item, sourceSections: researchSectionInventory(projection.item.content) }]);
    const selections: NonNullable<(typeof lineage)[number]["selections"]> = [];
    for (const idea of ideas(assessment).filter(idea => idea.score >= RESEARCH_POST_MIN_SCORE)) {
      const key = family(idea.familyKey), existing = selected.get(key);
      if (existing && existing.idea.score >= RESEARCH_POST_MIN_SCORE) {
        selections.push({ familyKey: idea.familyKey, decision: existing.origin === "parent" ? "accepted_parent_precedence" : "duplicate_window_family" });
        continue;
      }
      selected.set(key, { idea, origin: "window" });
      selections.push({ familyKey: idea.familyKey, decision: "selected" });
    }
    lineage.push({ cacheKey: projection.cacheKey, windowId, status: "assessed", assessment, selections });
  }
  const mergedIdeas = parentIdeas.map(idea => selected.get(family(idea.familyKey))?.idea || idea);
  for (const [key, value] of selected) if (!parentFamilies.has(key)) mergedIdeas.push(value.idea);
  const sectionChecks = researchSectionInventory(source.content).map(section => {
    const familyKeys = mergedIdeas.filter(idea => family(idea.familyKey) && matchResearchQuote(source.content.slice(section.bodyStart, section.end), idea.evidence)).map(idea => idea.familyKey);
    return { sectionId: section.id, familyKeys, notPostworthyReason: familyKeys.length ? "" : original?.sectionChecks?.find(check => check.sectionId === section.id)?.notPostworthyReason || "No selected idea has supporting evidence inside this captured section." };
  });
  const assessment = mergedIdeas.length ? researchEvidenceSchema.parse({ findings: [{ itemId: source.id, ...mergedIdeas[0], additionalIdeas: mergedIdeas.slice(1), sectionChecks }] }).findings[0] : null;
  const findings = assessment ? [assessment] : [];
  if (assessment) {
    validateResearchEvidenceProfiles(findings, context.enabledProfileIds);
    validateResearchSectionCoverage(findings, [source]);
  }
  const accepted = validateResearchEvidence(findings, [source]);
  if (accepted.length !== mergedIdeas.filter(idea => idea.score >= RESEARCH_POST_MIN_SCORE).length) throw new Error("Merged window ideas must retain valid original-source quotes");
  return { assessment, accepted, lineage,
    pendingWindowIds: lineage.filter(entry => entry.status === "pending").map(entry => entry.windowId),
    failedWindowIds: lineage.filter(entry => entry.status === "failed").map(entry => entry.windowId), coverageComplete: lineage.every(entry => entry.status === "assessed") };
}
