import { describe, expect, it, vi } from "vitest";
import { evidenceJsonSchemaForItems, matchResearchQuote, researchEvidenceSchema, validateResearchSectionCoverage } from "./research-model";
import { researchSourceSections } from "./research-sections";
import {
  cacheValidResearchEvidenceItems, canonicalResearchCitation, researchEvidenceItemCacheId, reuseResearchEvidenceItems,
  validateResearchEvidenceCacheValue, type EvidenceCacheContext, type EvidenceCacheInput,
} from "./research-evidence-cache";

const context: EvidenceCacheContext = {
  teamId: "team-a", model: "test-model", promptVersion: "test-version", system: "Assess each source independently.",
  audience: { generalAudience: "Product practitioners", publishingProfiles: [{ id: "personal", systemPrompt: "Specific product decisions" }] },
  selectionViewVersion: "selection-v1", selectionAudience: { generalAudience: "Product practitioners", publishingProfiles: [{ id: "personal", selectionInstructions: "Specific product decisions" }] },
  schemaForItem: id => evidenceJsonSchemaForItems([id], ["personal"]),
};
const item = (id: string): EvidenceCacheInput => ({
  id, title: `Source ${id}`, sourceId: "publisher", publishedAt: 1000, discoveredAt: 2000,
  signalKind: "dated_reference", contentProvenance: "article",
  content: `The ${id} workflow requires reviewing actual customer behavior before deciding what to build.`,
});
const assessment = (source: EvidenceCacheInput) => ({
  itemId: source.id, summary: "Review actual behavior before choosing a product change.",
  evidence: source.content!, contentAngle: "Inspect the last customer workflow before prioritizing.",
  whyItMatters: "Observed behavior can reveal a different constraint from a requested feature.",
  limitations: "A described workflow, not a measured conversion effect.", familyKey: `workflow-${source.id}`,
  claimBasis: "described_method", profileChecks: { personal: { fits: true, relevance: 25, reason: "A concrete product judgment decision." } },
  qualityComponents: { sourceSupport: 23, usefulDecision: 25, scopeHonesty: 14 }, additionalIdeas: [],
});
function harness() {
  const cache = new Map<string, unknown>();
  const validate = vi.fn(async (value, items) => validateResearchEvidenceCacheValue(value, items, ["personal"]));
  const write = vi.fn(async (id, value) => { cache.set(id, value); });
  const discard = vi.fn(async id => { cache.delete(id); });
  const generate = vi.fn<(items: EvidenceCacheInput[]) => Promise<unknown>>(async items => ({ findings: items.map(assessment) }));
  const access = { context, validate, write, discard, generate, read: async (id: string) => cache.get(id) ?? null };
  return { cache, access, generate, discard };
}

describe("explicit omission citation canonicalization", () => {
  const thesis = "996 is not a competitive advantage.";
  const content = `I’m not buying it. A longer argument explains sustainable ambition and experienced talent. ${thesis}`;
  const source = { ...item("elena"), content };
  const original = `I'm not buying it. ... ${thesis}`;

  it.each(["...", "…"])("replaces a verified %s omission with its longest contiguous source fragment", omission => {
    const quote = `I'm not buying it. ${omission} ${thesis}`;
    expect(matchResearchQuote(content, quote)).toBeNull();
    const result = validateResearchEvidenceCacheValue({ findings: [{ ...assessment(source), evidence: quote }] }, [source], ["personal"]);
    expect(result.findings[0].evidence).toBe(thesis);
    expect(result.citationRepairs).toEqual([{ itemId: source.id, familyKey: `workflow-${source.id}`, original: quote, selected: thesis, method: "ordered_omission_to_contiguous_span" }]);
    expect(matchResearchQuote(content, result.findings[0].evidence)).toBe(thesis);
  });

  it.each([
    `I'm inventing it. ... ${thesis}`,
    `${thesis} ... I'm not buying it.`,
    "I'm not buying it. ... 996 is a competitive advantage.",
    "I'm not buying it. ... 997 is not a competitive advantage.",
    `An absent fragment ... ${thesis}`,
    `I'm not buying it. ${thesis}`,
    "I'm not buying it. ... talent",
    `notable ... ${thesis}`,
  ])("rejects fabricated, reversed, changed or unmarked fragments: %s", evidence => {
    expect(() => validateResearchEvidenceCacheValue({ findings: [{ ...assessment(source), evidence }] }, [source], ["personal"])).toThrow("unsupported passing quote");
  });

  it("requires short fragments to match whole words and preserves Unicode source offsets", () => {
    expect(canonicalResearchCitation(`Nothing is promised. ${thesis}`, `not ... ${thesis}`)).toBeNull();
    expect(canonicalResearchCitation(`İ 🧭 ${content}`, original)).toBe(thesis);
    const wrapped = `“I'm not buying it. … ${thesis}”`;
    expect(canonicalResearchCitation(content, wrapped)).toBe(thesis);
  });

  it("leaves a legitimate literal ellipsis exact quote unchanged", () => {
    const literal = "Wait... then inspect the actual source before making a decision.";
    const row = { ...source, content: literal };
    const result = validateResearchEvidenceCacheValue({ findings: [{ ...assessment(row), evidence: literal }] }, [row], ["personal"]);
    expect(result.findings[0].evidence).toBe(literal);
    expect(result).not.toHaveProperty("citationRepairs");
  });

  it.each([false, true])("leaves numeric/category scoring and all editorial fields unchanged (categories:%s)", categories => {
    const raw = { findings: [{ ...assessment(source), evidence: original, ...(categories ? { qualityComponents: {
      sourceSupport: "supported_bounded_claim", usefulDecision: "concrete_decision", scopeHonesty: "accurately_bounded",
    } } : {}) }] };
    const before = researchEvidenceSchema.parse(raw).findings[0];
    const after = validateResearchEvidenceCacheValue(raw, [source], ["personal"]).findings[0];
    expect({ ...after, evidence: original }).toEqual(before);
    expect(raw.findings[0].evidence).toBe(original);
  });

  it("normalizes a nested provider claim without changing its categorical assessment", () => {
    const { itemId: _id, summary, evidence: _evidence, contentAngle, whyItMatters, limitations, ...rest } = assessment(source);
    const raw = { findings: { [source.id]: { ...rest,
      claim: { summary, evidence: original, contentAngle, whyItMatters, limitations },
      qualityComponents: { sourceSupport: "supported_bounded_claim", usefulDecision: "concrete_decision", scopeHonesty: "accurately_bounded" },
    } } };
    const before = researchEvidenceSchema.parse(raw).findings[0];
    const after = validateResearchEvidenceCacheValue(raw, [source], ["personal"]).findings[0];
    expect(after.evidence).toBe(thesis);
    expect({ ...after, evidence: original }).toEqual(before);
    expect(raw.findings[source.id].claim.evidence).toBe(original);
  });

  it("does not borrow an omitted fragment from another source", () => {
    const first = { ...item("a"), content: "I'm not buying it. Only this source's own words can support its citation." };
    const second = { ...item("b"), content: thesis };
    expect(() => validateResearchEvidenceCacheValue({ findings: [{ ...assessment(first), evidence: original }, assessment(second)] }, [first, second], ["personal"])).toThrow("unsupported passing quote");
  });

  it("canonicalizes before section validation so cross-section fragments cannot launder a quote", () => {
    const row = researchSourceSections({ ...item("report"), content: `Insight 1: First result\n\nI'm not buying it. ${"Context for the first result. ".repeat(4)}\n\nInsight 2: Second result\n\n${thesis} ${"Context for the second result. ".repeat(4)}` });
    const finding = { ...assessment(row), evidence: original, sectionChecks: row.sourceSections.map((section, index) => ({
      sectionId: section.id, familyKeys: index === 0 ? ["workflow-report"] : [], notPostworthyReason: index === 0 ? "" : "No separate decision supplied.",
    })) };
    const result = validateResearchEvidenceCacheValue({ findings: [finding] }, [row], ["personal"]);
    expect(result.findings[0].evidence).toBe(thesis);
    expect(() => validateResearchSectionCoverage(result.findings, [row])).toThrow("inside their claimed section body");
  });

  it("retains validated repair metadata in the private item cache without editorial field changes", async () => {
    const h = harness();
    const result = validateResearchEvidenceCacheValue({ findings: [{ ...assessment(source), evidence: original }] }, [source], ["personal"]);
    await cacheValidResearchEvidenceItems(result, [source], h.access);
    const saved = h.cache.get(await researchEvidenceItemCacheId(context, source)) as typeof result;
    expect(saved.citationRepairs).toEqual(result.citationRepairs);
    const again = validateResearchEvidenceCacheValue(saved, [source], ["personal"]);
    expect(again).toEqual(saved);
    expect(again.findings[0].contentAngle).toBe(assessment(source).contentAngle);
  });
});

describe("independent source evidence reuse", () => {
  it("reuses two sources in a reordered three-source batch and regenerates only a changed body", async () => {
    const h = harness(), a = item("a"), b = item("b"), c = item("c");
    await reuseResearchEvidenceItems([a, b], h.access);
    const result = await reuseResearchEvidenceItems([c, b, a], h.access);
    expect(h.generate.mock.calls.map(([items]) => items.map(item => item.id))).toEqual([["a", "b"], ["c"]]);
    expect(result.cacheHits).toBe(2);
    expect(result.value.findings.map(finding => finding.itemId)).toEqual(["c", "b", "a"]);
    const updated = { ...b, content: "A changed workflow requires an explicit approval before an agent publishes a campaign." };
    const changed = await reuseResearchEvidenceItems([a, updated, c], h.access);
    expect(h.generate.mock.calls[2][0]).toEqual([updated]);
    expect(changed.value.findings[1].evidence).toBe(updated.content);
  });

  it("keeps two independently valid rows from an incomplete six-source response but fails the batch", async () => {
    const h = harness(), items = ["a", "b", "c", "d", "e", "f"].map(item);
    h.generate.mockImplementationOnce(async sources => ({ findings: sources.slice(0, 2).map(assessment) }));
    await expect(reuseResearchEvidenceItems(items, h.access)).rejects.toThrow("every input exactly once");
    expect(h.cache.size).toBe(2);
    const retry = await reuseResearchEvidenceItems([...items].reverse(), h.access);
    expect(h.generate.mock.calls[1][0].map(item => item.id)).toEqual(["f", "e", "d", "c"]);
    expect(retry.value.findings.map(finding => finding.itemId)).toEqual(["f", "e", "d", "c", "b", "a"]);
    expect(retry.cacheHits).toBe(2);
  });

  it("does not cache an unsupported passing primary or silently turn it into a rejection", async () => {
    const h = harness(), a = item("a"), b = item("b");
    h.generate.mockImplementationOnce(async () => ({ findings: [assessment(a), { ...assessment(b), evidence: "An invented outcome not present in the source body." }] }));
    await expect(reuseResearchEvidenceItems([a, b], h.access)).rejects.toThrow("unsupported passing quote");
    expect(h.cache.size).toBe(1);
    await reuseResearchEvidenceItems([a, b], h.access);
    expect(h.generate.mock.calls[1][0]).toEqual([b]);
  });

  it("treats an unsupported additional idea as an invalid source assessment", async () => {
    const h = harness(), a = item("a"), { itemId: _id, additionalIdeas: _additional, ...additional } = assessment(a);
    h.generate.mockImplementationOnce(async () => ({ findings: [{ ...assessment(a), additionalIdeas: [{ ...additional, familyKey: "different-mechanism", evidence: "A fabricated result that cannot be found in this article." }] }] }));
    await expect(reuseResearchEvidenceItems([a], h.access)).rejects.toThrow("unsupported passing quote");
    expect(h.cache.size).toBe(0);
  });

  it("does not salvage duplicate or unknown primary IDs as valid input coverage", async () => {
    const h = harness(), a = item("a"), b = item("b");
    h.generate.mockImplementationOnce(async () => ({ findings: [assessment(a), assessment(a), assessment(b), assessment(item("foreign"))] }));
    await expect(reuseResearchEvidenceItems([a, b], h.access)).rejects.toThrow("every input exactly once");
    expect(h.cache.size).toBe(1);
    await reuseResearchEvidenceItems([b, a], h.access);
    expect(h.generate.mock.calls[1][0]).toEqual([a]);
  });

  it("revalidates cached source identity and every profile before reusing an assessment", async () => {
    const h = harness(), a = item("a"), b = item("b");
    await reuseResearchEvidenceItems([a, b], h.access);
    h.cache.set(await researchEvidenceItemCacheId(context, a), { findings: [assessment(item("foreign"))] });
    h.cache.set(await researchEvidenceItemCacheId(context, b), { findings: [{ ...assessment(b), profileChecks: { foreign: { fits: true, relevance: 25, reason: "Wrong audience" } } }] });
    const result = await reuseResearchEvidenceItems([b, a], h.access);
    expect(h.discard).toHaveBeenCalledTimes(2);
    expect(h.generate.mock.calls[1][0]).toEqual([b, a]);
    expect(result.cacheHits).toBe(0);
  });

  it("revalidates cached quotes and reuses grounded negative decisions", async () => {
    const h = harness(), a = item("a"), b = item("b");
    await reuseResearchEvidenceItems([a], h.access);
    h.cache.set(await researchEvidenceItemCacheId(context, a), { findings: [{ ...assessment(a), evidence: "An unsupported quote inserted into the stored cache value." }] });
    h.generate.mockImplementationOnce(async sources => ({ findings: sources.map(source => source.id === "b" ? {
      ...assessment(source), claimBasis: "no_useful_core", evidence: "", familyKey: "", additionalIdeas: [],
      profileChecks: { personal: { fits: false, relevance: 0, reason: "No concrete reader decision." } },
    } : assessment(source)) }));
    await reuseResearchEvidenceItems([a, b], h.access);
    const hit = await reuseResearchEvidenceItems([b, a], h.access);
    expect(h.discard).toHaveBeenCalledTimes(1);
    expect(h.generate).toHaveBeenCalledTimes(2);
    expect(hit.cacheHits).toBe(2);
    expect(hit.value.findings[0]).toMatchObject({ itemId: "b", score: 0, chosenProfileId: null });
  });

  it("can prime individually valid array and keyed full-batch results without accepting incomplete coverage", async () => {
    const h = harness(), a = item("a"), b = item("b"), { itemId: _id, ...value } = assessment(a);
    await cacheValidResearchEvidenceItems({ findings: { a: value } }, [a, b], h.access);
    expect(h.cache.size).toBe(1);
    expect(() => validateResearchEvidenceCacheValue({ findings: [assessment(a)] }, [a, b], ["personal"])).toThrow("every input exactly once");
    await reuseResearchEvidenceItems([a, b], h.access);
    expect(h.generate.mock.calls[0][0]).toEqual([b]);
  });

  it("refuses forged IDs inside keyed assessments and repeated input IDs", async () => {
    const h = harness(), a = item("a");
    await cacheValidResearchEvidenceItems({ findings: { a: assessment(a) } }, [a], h.access);
    expect(h.cache.size).toBe(0);
    await expect(reuseResearchEvidenceItems([a, a], h.access)).rejects.toThrow("unique source IDs");
    expect(h.generate).not.toHaveBeenCalled();
  });
});

describe("evidence item cache identity", () => {
  it.each([
    ["team", { teamId: "other-team" }], ["model", { model: "other-model" }],
    ["prompt version", { promptVersion: "other-version" }], ["system", { system: "Changed assessment instructions" }],
    ["frozen audience", { audience: { generalAudience: "Different audience" } }],
    ["selection version", { selectionViewVersion: "selection-v2" }],
    ["selection view", { selectionAudience: { generalAudience: "Different model-facing view" } }],
    ["per-source schema", { schemaForItem: (id: string) => ({ id, contract: "new" }) }],
  ])("separates %s changes", async (_name, change) => {
    const h = harness(), a = item("a");
    await reuseResearchEvidenceItems([a], h.access);
    const changed = { ...h.access, context: { ...context, ...change } } as typeof h.access;
    await reuseResearchEvidenceItems([a], changed);
    expect(h.generate).toHaveBeenCalledTimes(2);
  });

  it.each(["id", "title", "sourceId", "publishedAt", "discoveredAt", "signalKind", "contentProvenance", "content"])("separates changed source %s", async key => {
    const a = item("a"), changed = { ...a, [key]: typeof a[key] === "number" ? 3000 : `${a[key]} changed` };
    expect(await researchEvidenceItemCacheId(context, changed)).not.toBe(await researchEvidenceItemCacheId(context, a));
  });
});
