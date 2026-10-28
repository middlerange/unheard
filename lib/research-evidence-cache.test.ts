import { describe, expect, it, vi } from "vitest";
import { evidenceJsonSchemaForItems } from "./research-model";
import {
  cacheValidResearchEvidenceItems, researchEvidenceItemCacheId, reuseResearchEvidenceItems,
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
