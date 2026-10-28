import { describe, expect, it } from "vitest";
import { matchResearchQuote, researchEvidenceSchema, validateResearchSectionCoverage, type ResearchEvidence } from "./research-model";
import { mergeResearchWindowFocus, mergeResearchWindowFocusFromFailure, planResearchWindowFocus, planResearchWindowFocusFromFailure, researchEvidenceWindows, type WindowFocusAttempt, type WindowFocusParentFailure } from "./research-window-focus";
import { researchSectionInventory } from "./research-sections";
import { researchQuoteRepairPlan } from "./research-quote-repair";
import { validateResearchEvidenceCacheValue } from "./research-evidence-cache";

const intro = "The captured report describes practitioner observations from a defined sample. These reports establish descriptions rather than causal effectiveness.\n\n";
const paragraph = (index: number) => `Practice sample ${index} records a specific decision and the context needed to interpret it. The team retains the stated assumptions before comparing another experiment, without claiming that this process proves a business outcome.\n\n`;
const content = intro + Array.from({ length: 54 }, (_, index) => paragraph(index)).join("");
const source = { id: "captured-source", sourceId: "publisher", url: "https://example.com/original", publishedAt: null, discoveredAt: 123456789,
  contentProvenance: "article", originalHash: "frozen-body-record", content };
const context = { parentCacheId: "frozen-contract-and-parent-key", enabledProfileIds: ["personal", "company"] };
const windows = researchEvidenceWindows(content);
const quoteFor = (index: number) => source.content.slice(windows[index].start, windows[index].end).match(/[^\n.!?]{35,200}[.!?]/)![0].trim();
function assessed(evidence: string, familyKey: string, rejected = false): ResearchEvidence {
  return researchEvidenceSchema.parse({ findings: [{ itemId: source.id, summary: "A specific captured practitioner distinction.", evidence,
    contentAngle: "Compare the documented distinction before choosing a next experiment.", whyItMatters: "It supports a specific practitioner question.", limitations: "Reported practice does not establish causal effectiveness.", familyKey,
    claimBasis: "measured_observation", profileChecks: { personal: { fits: true, relevance: 22, reason: "A useful practitioner distinction." }, company: { fits: false, relevance: 0, reason: "Outside its remit." } },
    qualityComponents: { sourceSupport: "supported_bounded_claim", usefulDecision: "useful_distinction_or_signal", scopeHonesty: rejected ? "material_gap" : "accurately_bounded" },
    additionalIdeas: [], sectionChecks: [],
  }] }).findings[0];
}
function parent() {
  const primary = assessed(quoteFor(0), "parent-family"), { itemId: _id, additionalIdeas: _extra, sectionChecks: _checks, ...rejected } = assessed(quoteFor(1), "rejected-family", true);
  return { ...primary, additionalIdeas: [rejected] };
}

describe("deterministic public excerpt windows", () => {
  it("covers every captured character exactly once at natural boundaries near3000 characters", () => {
    expect(windows.length).toBeGreaterThan(2);
    expect(windows[0].start).toBe(0);
    expect(windows.at(-1)!.end).toBe(content.length);
    expect(windows.map(window => content.slice(window.start, window.end)).join("")).toBe(content);
    windows.forEach((window, index) => {
      if (index) expect(window.start).toBe(windows[index - 1].end);
      expect(window.end - window.start).toBeGreaterThan(1500);
      expect(window.end - window.start).toBeLessThanOrEqual(4050);
      expect(content.slice(0, window.end).trim()).toMatch(/[.!?]$/);
    });
  });
  it("keeps the5000-character boundary, preserves long indivisible text and has no window-count quota", () => {
    expect(researchEvidenceWindows("a".repeat(5000))).toEqual([]);
    expect(researchEvidenceWindows("a".repeat(7000))).toEqual([{ id: "window-0", start: 0, end: 7000 }]);
    const many = Array.from({ length: 500 }, (_, index) => paragraph(index)).join("");
    expect(researchEvidenceWindows(many).length).toBeGreaterThan(30);
    expect(researchEvidenceWindows(" ".repeat(6000))).toEqual([]);
  });
  it("plans all windows even where the parent already has a passing quote, with bounded verbatim context and honest provenance", async () => {
    const original = parent(), before = JSON.stringify({ source, original });
    const plan = await planResearchWindowFocus(source, original, context);
    expect(plan).toHaveLength(windows.length);
    expect(plan[0].descriptor.window.start).toBe(0);
    for (const projection of plan) {
      expect(projection.item).toMatchObject({ id: source.id, sourceId: source.sourceId, url: source.url, publishedAt: null,
        discoveredAt: source.discoveredAt, originalHash: source.originalHash, contentProvenance: "public_excerpt_window" });
      expect(projection.descriptor.originalContentProvenance).toBe("article");
      expect(projection.descriptor.ranges.filter(range => range.role === "introduction").reduce((n, range) => n + range.end - range.start, 0)).toBeLessThanOrEqual(600);
      expect(projection.descriptor.ranges.map(range => content.slice(range.start, range.end)).join("")).toBe(projection.item.content);
      expect(projection.descriptor.parentContentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(projection.descriptor.projectedContentHash).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(JSON.stringify({ source, original })).toBe(before);
    expect(await planResearchWindowFocus(source, original, context)).toEqual(plan);
    expect((await planResearchWindowFocus({ ...source, discoveredAt: 987654321 }, original, context))[0].cacheKey).not.toBe(plan[0].cacheKey);
    expect((await planResearchWindowFocus(source, original, { ...context, parentCacheId: "another-frozen-contract" }))[0].cacheKey).not.toBe(plan[0].cacheKey);
  });
});

describe("verified terminal-parent-failure window hook", () => {
  async function failedParent(): Promise<WindowFocusParentFailure> {
    const rawGrade = { findings: [{ ...assessed("A paraphrased claim that is absent from the captured public source body.", "unsupported-raw-parent-family"), summary: "Unverified original core retained only in failure lineage." }] };
    const plan = await researchQuoteRepairPlan(rawGrade, source, context.enabledProfileIds, context.parentCacheId);
    const receipt: WindowFocusParentFailure["receipt"] = { state: "failed", contextId: context.parentCacheId, sourceId: source.id,
      bodyHash: plan.bodyHash, gradeHash: plan.gradeHash, rawGrade, failureKind: "unsupported_core", error: "No source passage supports the existing core." };
    return { failure: { itemId: source.id, receiptId: plan.id, reason: "Terminal quote grounding failure (unsupported_core): No source passage supports the existing core." }, receipt };
  }
  it("binds all windows to the verified receipt and exact base context without exposing invalid raw grades to model input", async () => {
    const failure = await failedParent(), before = JSON.stringify(failure), plan = await planResearchWindowFocusFromFailure(source, failure, context);
    expect(plan).toHaveLength(windows.length);
    expect(plan[0].descriptor).toMatchObject({ parentAssessmentHash: null, parentCacheId: context.parentCacheId, parentFailureReceiptId: failure.failure.receiptId });
    expect(plan[0].descriptor.parentFailureReceiptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(plan.map(projection => projection.item))).not.toContain("unsupported-raw-parent-family");
    expect(JSON.stringify(failure)).toBe(before);
    expect(await planResearchWindowFocusFromFailure(source, failure, context)).toEqual(plan);
    expect((await planResearchWindowFocusFromFailure({ ...source, discoveredAt: 987654321 }, failure, context))[0].cacheKey).not.toBe(plan[0].cacheKey);
  });
  it("retains the verified source failure when every scoped grade is rejected, without inventing a parent idea", async () => {
    const failure = await failedParent(), plan = await planResearchWindowFocusFromFailure(source, failure, context);
    const attempts: WindowFocusAttempt[] = plan.map((projection, index) => ({ projection, status: "assessed", assessment: assessed(quoteFor(index), `rejected-window-${index}`, true) }));
    const merged = await mergeResearchWindowFocusFromFailure(source, failure, attempts, context);
    expect(merged.assessment).toBeNull();
    expect(merged.findings).toEqual([]);
    expect(merged.accepted).toEqual([]);
    expect(merged.evidenceFailures).toEqual([failure.failure]);
    expect(merged.parentFailure).toEqual(failure);
    expect(merged.lineage.every(entry => entry.assessment!.score === 69)).toBe(true);
    expect(merged.coverageComplete).toBe(true);
    expect(validateResearchEvidenceCacheValue(merged, [source], context.enabledProfileIds, [failure.failure]).findings).toEqual([]);
  });
  it("emits only actual validated scoped families and moves the original failure into lineage rather than emitting both statuses", async () => {
    const failure = await failedParent(), before = JSON.stringify(failure), plan = await planResearchWindowFocusFromFailure(source, failure, context);
    const attempts: WindowFocusAttempt[] = plan.map((projection, index) => ({ projection, status: "assessed", assessment: assessed(quoteFor(index), index === 1 ? "Scoped Family" : index === 0 ? "scoped-family" : `scoped-${index}`, index > 2) }));
    const merged = await mergeResearchWindowFocusFromFailure(source, failure, attempts.reverse(), context);
    expect(merged.findings).toHaveLength(1);
    expect(merged.evidenceFailures).toEqual([]);
    expect(merged.accepted.map(idea => idea.familyKey)).toEqual(["scoped-family", "scoped-2"]);
    expect(merged.findings[0].evidence).toBe(quoteFor(0));
    expect(merged.lineage[1].selections![0].decision).toBe("duplicate_window_family");
    expect(JSON.stringify(merged.findings)).not.toContain("unsupported-raw-parent-family");
    expect(merged.parentFailure).toEqual(failure);
    expect(JSON.stringify(failure)).toBe(before);
    expect(validateResearchEvidenceCacheValue(merged, [source], context.enabledProfileIds).findings).toHaveLength(1);
  });
  it("keeps failed and pending window state explicit while retaining the source failure", async () => {
    const failure = await failedParent(), plan = await planResearchWindowFocusFromFailure(source, failure, context);
    const merged = await mergeResearchWindowFocusFromFailure(source, failure, [{ projection: plan[0], status: "failed", reason: "Scoped quote validation failed." }], context);
    expect(merged.findings).toEqual([]);
    expect(merged.evidenceFailures).toEqual([failure.failure]);
    expect(merged.failedWindowIds).toEqual([windows[0].id]);
    expect(merged.pendingWindowIds).toEqual(windows.slice(1).map(window => window.id));
    expect(merged.coverageComplete).toBe(false);
  });
  it("rejects forged receipt state, raw grade, reason, body and frozen context before planning", async () => {
    const failure = await failedParent();
    await expect(planResearchWindowFocusFromFailure(source, { ...failure, receipt: { ...failure.receipt, state: "started" } }, context)).rejects.toThrow("terminal receipt");
    await expect(planResearchWindowFocusFromFailure(source, { ...failure, failure: { ...failure.failure, reason: "Invented failure" } }, context)).rejects.toThrow("does not match");
    await expect(planResearchWindowFocusFromFailure(source, { ...failure, receipt: { ...failure.receipt, rawGrade: { findings: [] } } }, context)).rejects.toThrow();
    await expect(planResearchWindowFocusFromFailure({ ...source, content: content + "Changed captured body." }, failure, context)).rejects.toThrow();
    await expect(planResearchWindowFocusFromFailure(source, failure, { ...context, parentCacheId: "different-base-context" })).rejects.toThrow("terminal receipt");
  });
  it("retains per-window identity and quote guards for the failure branch", async () => {
    const failure = await failedParent(), plan = await planResearchWindowFocusFromFailure(source, failure, context);
    const attempt: WindowFocusAttempt = { projection: plan[1], status: "assessed", assessment: assessed(intro.trim(), "context-only-family") };
    await expect(mergeResearchWindowFocusFromFailure(source, failure, [attempt], context)).rejects.toThrow("context-only quotes");
    await expect(mergeResearchWindowFocusFromFailure(source, failure, [attempt, attempt], context)).rejects.toThrow("one terminal attempt");
    const validParentPlan = await planResearchWindowFocus(source, parent(), context);
    await expect(mergeResearchWindowFocusFromFailure(source, failure, [{ projection: validParentPlan[0], status: "assessed", assessment: assessed(quoteFor(0), "valid-window") }], context)).rejects.toThrow("stale or unplanned");
  });
});

describe("window assessment lineage and merge", () => {
  it("preserves frozen parent grades, permits one scoped replacement of a rejected family and validates every original-source quote", async () => {
    const original = parent(), before = JSON.stringify(original), plan = await planResearchWindowFocus(source, original, context);
    const attempts: WindowFocusAttempt[] = plan.map((projection, index) => ({ projection, status: "assessed", assessment: assessed(quoteFor(index), index === 1 ? "rejected-family" : `new-family-${index}`) }));
    const merged = await mergeResearchWindowFocus(source, original, attempts.reverse(), context);
    expect(merged.coverageComplete).toBe(true);
    expect(merged.parentAssessment).toEqual(original);
    expect(merged.parentAssessment.additionalIdeas![0].score).toBe(69);
    expect(merged.assessment.additionalIdeas![0].score).toBe(86);
    expect(merged.assessment.score).toBe(original.score);
    expect(merged.accepted).toHaveLength(windows.length + 1);
    expect(merged.lineage.map(entry => entry.windowId)).toEqual(windows.map(window => window.id));
    expect(validateResearchSectionCoverage([merged.assessment], [source])).toHaveLength(1);
    expect(JSON.stringify(original)).toBe(before);
  });
  it("keeps accepted parent precedence and the first deterministic scoped family without score shopping", async () => {
    const original = parent(), plan = await planResearchWindowFocus(source, original, context);
    const merged = await mergeResearchWindowFocus(source, original, [
      { projection: plan[2], status: "assessed", assessment: assessed(quoteFor(2), "New Family") },
      { projection: plan[1], status: "assessed", assessment: assessed(quoteFor(1), "new-family") },
      { projection: plan[0], status: "assessed", assessment: assessed(quoteFor(0), "Parent Family") },
    ], context);
    expect(merged.assessment.evidence).toBe(original.evidence);
    expect(merged.lineage[0].selections![0].decision).toBe("accepted_parent_precedence");
    expect(merged.accepted.find(idea => idea.familyKey === "new-family")!.evidence).toBe(quoteFor(1));
    expect(merged.lineage[2].selections![0].decision).toBe("duplicate_window_family");
  });
  it("rejects introduction-only quotes from later windows and foreign, stale, duplicate or incomplete assessments", async () => {
    const original = parent(), plan = await planResearchWindowFocus(source, original, context), grade = assessed(quoteFor(1), "focused-family");
    const merge = (assessment: ResearchEvidence) => mergeResearchWindowFocus(source, original, [{ projection: plan[1], status: "assessed", assessment }], context);
    await expect(merge({ ...grade, evidence: intro.trim() })).rejects.toThrow("context-only quotes");
    await expect(merge({ ...grade, itemId: "foreign" })).rejects.toThrow("original source ID");
    await expect(merge({ ...grade, profileChecks: { personal: grade.profileChecks!.personal } })).rejects.toThrow("every supplied enabled profile");
    await expect(merge({ ...grade, sectionChecks: undefined })).rejects.toThrow("every supplied section");
    const attempt: WindowFocusAttempt = { projection: plan[1], status: "assessed", assessment: grade };
    await expect(mergeResearchWindowFocus(source, original, [attempt, attempt], context)).rejects.toThrow("one terminal attempt");
    await expect(mergeResearchWindowFocus(source, original, [{ ...attempt, projection: { ...plan[1], item: { ...plan[1].item, publishedAt: 1 } } }], context)).rejects.toThrow("stale or unplanned");
  });
  it("retains rejected, failed and pending terminal state without creating ideas or retriable success claims", async () => {
    const original = parent(), plan = await planResearchWindowFocus(source, original, context);
    const attempts: WindowFocusAttempt[] = [{ projection: plan[0], status: "assessed", assessment: assessed(quoteFor(0), "rejected-window", true) },
      { projection: plan[1], status: "failed", reason: "Scoped grounding validation failed." }];
    const merged = await mergeResearchWindowFocus(source, original, attempts, context);
    expect(merged.accepted).toHaveLength(1);
    expect(merged.coverageComplete).toBe(false);
    expect(merged.failedWindowIds).toEqual([windows[1].id]);
    expect(merged.pendingWindowIds).toEqual(windows.slice(2).map(window => window.id));
    expect(merged.lineage[0].assessment!.score).toBe(69);
    expect(merged.lineage[1].reason).toBe("Scoped grounding validation failed.");
    expect(await mergeResearchWindowFocus(source, original, attempts, context)).toEqual(merged);
  });
  it("rebuilds complete original numbered-section checks when windows and their context cross heading boundaries", async () => {
    const numbered = { ...source, content: Array.from({ length: 3 }, (_, index) => `Finding ${index + 1}: Captured observation\n\n${Array.from({ length: 22 }, (_, n) => paragraph(index * 22 + n)).join("")}`).join("\n\n") };
    const inventory = researchSectionInventory(numbered.content);
    const original = researchEvidenceSchema.parse({ findings: [{ ...assessed("", "temporary-family"), claimBasis: "no_useful_core", evidence: "", familyKey: "", sectionChecks:
      inventory.map(section => ({ sectionId: section.id, familyKeys: [], notPostworthyReason: "No independently useful idea was returned for this captured section." })) }] }).findings[0];
    const plan = await planResearchWindowFocus(numbered, original, context);
    const attempts: WindowFocusAttempt[] = plan.map((projection, index) => {
      const focal = numbered.content.slice(projection.descriptor.window.start, projection.descriptor.window.end);
      const evidence = focal.match(/Practice sample[^.!?]+[.!?]/)![0], familyKey = `window-finding-${index}`;
      const assessment = assessed(evidence, familyKey);
      assessment.sectionChecks = researchSectionInventory(projection.item.content).map(section => {
        const supported = matchResearchQuote(projection.item.content.slice(section.bodyStart, section.end), evidence);
        return { sectionId: section.id, familyKeys: supported ? [familyKey] : [], notPostworthyReason: supported ? "" : "This captured context supplies no separate returned idea." };
      });
      return { projection, status: "assessed", assessment };
    });
    const merged = await mergeResearchWindowFocus(numbered, original, attempts, context);
    expect(merged.assessment.sectionChecks).toHaveLength(3);
    expect(validateResearchSectionCoverage([merged.assessment], [numbered])).toHaveLength(1);
    expect(merged.coverageComplete).toBe(true);
  });
});
