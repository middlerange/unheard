import { describe, expect, it, vi } from "vitest";
import { researchEvidenceSchema, validateResearchSectionCoverage } from "./research-model";
import { researchEvidenceFailures, researchEvidenceItemCacheId, reuseResearchEvidenceItems, validateResearchEvidenceCacheValue, type EvidenceCacheContext, type EvidenceCacheInput } from "./research-evidence-cache";
import { researchSourceSections } from "./research-sections";
import { applyResearchQuoteRepair, quoteRepairSchema, repairResearchCitation, researchQuotePassages, researchQuoteRepairPlan, sameContextQuoteFailure, verifyResearchEvidenceFailure } from "./research-quote-repair";

const item = { id: "source-a", content: "The measurement workflow freezes high-intent prompts before comparing visibility and downstream outcomes.\n\nOperators log the same prompts for four weeks and compare leading visibility against lagging business measures." };
function grade(source: EvidenceCacheInput = item) {
  return { findings: [{ itemId: source.id, summary: "Freeze prompts and compare visibility with downstream business outcomes.",
    evidence: "A paraphrased introduction does not reproduce the actual source's words.", contentAngle: "Use a fixed prompt set rather than changing the denominator between measurements.",
    whyItMatters: "A stable comparison distinguishes visibility from referral clicks.", limitations: "A described method, without independent causal outcome proof.", familyKey: "fixed-prompt-measurement",
    claimBasis: "described_method", profileChecks: { personal: { fits: true, relevance: 25, reason: "A concrete growth measurement decision." } },
    qualityComponents: { sourceSupport: "supported_bounded_claim", usefulDecision: "concrete_decision", scopeHonesty: "accurately_bounded" }, additionalIdeas: [],
  }] };
}
function harness() {
  const receipts = new Map<string, any>();
  const select = vi.fn(async () => ({ "fixed-prompt-measurement": { passageId: 0, supportsCore: true } }));
  const access = {
    read: async (id: string) => receipts.get(id) ?? null,
    claim: vi.fn(async (id: string, receipt: any) => { if (receipts.has(id)) return false; receipts.set(id, structuredClone(receipt)); return true; }),
    save: vi.fn(async (id: string, receipt: any) => { receipts.set(id, structuredClone(receipt)); }),
    select,
    validate: async (value: unknown) => {
      const output = validateResearchEvidenceCacheValue(value, [item], ["personal"]);
      return output;
    },
  };
  return { receipts, select, access };
}

describe("bounded citation-only passage selection", () => {
  it("offers deterministic literal source spans and a strict ID-only response contract", () => {
    const passages = researchQuotePassages(item.content);
    expect(passages).toHaveLength(2);
    for (const passage of passages) {
      expect(passage.text).toBe(item.content.slice(passage.start, passage.end));
      expect(passage.text.length).toBeGreaterThanOrEqual(20);
      expect(passage.text.length).toBeLessThanOrEqual(600);
    }
    const schema = quoteRepairSchema(["one", "two"]);
    expect(schema.required).toEqual(["one", "two"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.one.properties).toEqual({ passageId: { type: "integer" }, supportsCore: { type: "boolean" } });
    expect(researchQuotePassages("A long sentence without a boundary ".repeat(100))).toEqual([]);
  });

  it("copies the chosen passage without changing semantic fields, categories, profiles or scores", async () => {
    const h = harness(), raw = grade();
    const before = researchEvidenceSchema.parse(raw).findings[0];
    const result = await repairResearchCitation(raw, item, ["personal"], "context-a", h.access);
    expect(result.findings[0].evidence).toBe(researchQuotePassages(item.content)[0].text);
    expect({ ...result.findings[0], evidence: before.evidence }).toEqual(before);
    expect(raw).toEqual(grade());
    expect(result.citationRepairs?.[0].method).toBe("model_passage_selection");
    expect(h.select).toHaveBeenCalledTimes(1);
    const request = h.select.mock.calls[0] as unknown as [any, any, number];
    expect(request[0].claims[0]).not.toHaveProperty("score");
    expect(request[0].claims[0]).not.toHaveProperty("qualityComponents");
    expect(request[2]).toBeLessThanOrEqual(1024);
    expect([...h.receipts.values()][0].state).toBe("completed");
  });

  it("reuses a verified successful receipt without another paid selection", async () => {
    const h = harness();
    const first = await repairResearchCitation(grade(), item, ["personal"], "context-a", h.access);
    const second = await repairResearchCitation(grade(), item, ["personal"], "context-a", h.access);
    expect(second).toEqual(first);
    expect(h.select).toHaveBeenCalledTimes(1);
  });

  it.each([
    { "fixed-prompt-measurement": { passageId: 0, supportsCore: false } },
    { "fixed-prompt-measurement": { passageId: 500, supportsCore: true } },
    { "fixed-prompt-measurement": { passageId: -1, supportsCore: true } },
    { "fixed-prompt-measurement": { passageId: 0.5, supportsCore: true } },
    { "fixed-prompt-measurement": { passageId: 0, supportsCore: true, score: 100 } },
    { foreign: { passageId: 0, supportsCore: true } },
  ])("records unsupported or invalid grounding without assessment or a repeated repair: %j", async selection => {
    const h = harness(); h.select.mockResolvedValueOnce(selection as never);
    const failed = await repairResearchCitation(grade(), item, ["personal"], "context-a", h.access);
    expect(failed.findings).toEqual([]);
    expect(failed.evidenceFailures).toHaveLength(1);
    expect(await repairResearchCitation(grade(), item, ["personal"], "context-a", h.access)).toEqual(failed);
    expect([...h.receipts.values()][0].rawGrade).toEqual(grade());
    expect(h.select).toHaveBeenCalledTimes(1);
  });

  it("fences transport-unknown and concurrent attempts before another request", async () => {
    const h = harness(); h.select.mockRejectedValueOnce(new Error("Unknown transport outcome"));
    const failed = await repairResearchCitation(grade(), item, ["personal"], "context-a", h.access);
    expect(failed.findings).toEqual([]);
    expect(failed.evidenceFailures?.[0].reason).toContain("request_failure");
    expect(await repairResearchCitation(grade(), item, ["personal"], "context-a", h.access)).toEqual(failed);
    expect(h.select).toHaveBeenCalledTimes(1);
    const concurrent = harness();
    await Promise.allSettled([0, 1].map(() => repairResearchCitation(grade(), item, ["personal"], "context-a", concurrent.access)));
    expect(concurrent.select).toHaveBeenCalledTimes(1);
  });

  it("rejects a changed source and does not trust receipt hashes, grades or selected text", async () => {
    const plan = await researchQuoteRepairPlan(grade(), item, ["personal"], "context-a");
    await expect(applyResearchQuoteRepair(plan, { ...item, content: `${item.content} Changed.` }, { "fixed-prompt-measurement": { passageId: 0, supportsCore: true } })).rejects.toThrow("source body changed");
    for (const change of ["bodyHash", "score", "evidence", "metadata"]) {
      const h = harness(); await repairResearchCitation(grade(), item, ["personal"], "context-a", h.access);
      const receipt = h.receipts.get(plan.id);
      if (change === "bodyHash") receipt.bodyHash = "forged";
      if (change === "score") receipt.result.findings[0].score++;
      if (change === "evidence") receipt.result.findings[0].evidence = researchQuotePassages(item.content)[1].text;
      if (change === "metadata") receipt.result.citationRepairs[0].bodyHash = "forged";
      await expect(repairResearchCitation(grade(), item, ["personal"], "context-a", h.access)).rejects.toThrow();
      expect(h.select).toHaveBeenCalledTimes(1);
    }
  });

  it("does not pay to repair schema/profile failures or already exact citations", async () => {
    const h = harness();
    const invalid = grade(); invalid.findings[0].profileChecks = {} as never;
    await expect(repairResearchCitation(invalid, item, ["personal"], "context-a", h.access)).rejects.toThrow();
    const exact = grade(); exact.findings[0].evidence = researchQuotePassages(item.content)[0].text;
    await repairResearchCitation(exact, item, ["personal"], "context-a", h.access);
    expect(h.select).not.toHaveBeenCalled();
    expect(h.receipts.size).toBe(0);
  });

  it("still enforces the claimed section after copying a literal own-source passage", async () => {
    const h = harness();
    const source = researchSourceSections({ ...item, content: `Insight 1: First result\n\n${item.content.split("\n\n")[0]}\n\nInsight 2: Second result\n\n${item.content.split("\n\n")[1]}` });
    const raw = grade(source);
    Object.assign(raw.findings[0], { sectionChecks: source.sourceSections.map((section, index) => ({ sectionId: section.id, familyKeys: index === 0 ? ["fixed-prompt-measurement"] : [], notPostworthyReason: index === 0 ? "" : "No separate decision." })) });
    const plan = await researchQuoteRepairPlan(raw, source, ["personal"], "context-a");
    const second = plan.passages.find(passage => passage.text.includes("Operators log"))!;
    h.select.mockResolvedValueOnce({ "fixed-prompt-measurement": { passageId: second.passageId, supportsCore: true } });
    h.access.validate = async value => {
      const out = validateResearchEvidenceCacheValue(value, [source], ["personal"]);
      validateResearchSectionCoverage(out.findings, [source]); return out;
    };
    const failed = await repairResearchCitation(raw, source, ["personal"], "context-a", h.access);
    expect(failed.findings).toEqual([]);
    expect(failed.evidenceFailures?.[0].reason).toContain("validation_failure");
    expect(failed.evidenceFailures?.[0].reason).toContain("inside their claimed section");
    expect(h.select).toHaveBeenCalledTimes(1);
  });
});

describe("same-contract raw quote failure salvage", () => {
  const hash = "current-exact-batch-hash";
  const record = () => ({ id: `invalid:${hash}:timestamp:uuid`, value: { invalid: true, stage: "evidence", reason: `Research evidence has an unsupported passing quote for source ${item.id}`, response: grade() } });
  it("reuses exactly one expected assessment only under the current batch hash", () => {
    expect(sameContextQuoteFailure([record()], hash, item, ["personal"])).toEqual(grade());
    expect(sameContextQuoteFailure([record()], "other-hash", item, ["personal"])).toBeNull();
    expect(sameContextQuoteFailure([record()], hash, { ...item, id: "other-source" }, ["personal"])).toBeNull();
    const extra = record(); extra.value.response.findings.push({ ...grade().findings[0], itemId: "other-source" });
    expect(sameContextQuoteFailure([extra], hash, item, ["personal"])).toBeNull();
    const malformed = record(); malformed.value.response.findings[0].profileChecks = {} as never;
    expect(sameContextQuoteFailure([malformed], hash, item, ["personal"])).toBeNull();
    const wrongReason = record(); wrongReason.value.reason = "Missing source coverage";
    expect(sameContextQuoteFailure([wrongReason], hash, item, ["personal"])).toBeNull();
  });
});

describe("verified source-scoped terminal grounding failures", () => {
  async function failureFixture() {
    const h = harness(); h.select.mockResolvedValueOnce({ "fixed-prompt-measurement": { passageId: 0, supportsCore: false } });
    const value = await repairResearchCitation(grade(), item, ["personal"], "context-a", h.access);
    const failure = value.evidenceFailures![0], receipt = h.receipts.get(failure.receiptId);
    return { h, value, failure, receipt };
  }

  it("requires a rehashed receipt and exactly one assessment or verified failure per input", async () => {
    const { value, failure, receipt } = await failureFixture();
    expect(() => validateResearchEvidenceCacheValue(value, [item], ["personal"])).toThrow("not verified");
    const verified = await verifyResearchEvidenceFailure(failure, item, ["personal"], "context-a", receipt);
    expect(validateResearchEvidenceCacheValue(value, [item], ["personal"], [verified])).toEqual(value);
    const valid = grade(); valid.findings[0].evidence = researchQuotePassages(item.content)[0].text;
    expect(() => validateResearchEvidenceCacheValue({ ...value, findings: valid.findings }, [item], ["personal"], [verified])).toThrow();
    expect(() => validateResearchEvidenceCacheValue({ findings: [], evidenceFailures: [failure, failure] }, [item], ["personal"], [verified])).toThrow();
    expect(() => validateResearchEvidenceCacheValue(value, [item, { ...item, id: "missing" }], ["personal"], [verified])).toThrow("every input");
    expect(() => validateResearchEvidenceCacheValue(value, [item, item], ["personal"], [verified])).toThrow("unique source");
    for (const changed of [{ ...receipt, state: "started" }, { ...receipt, bodyHash: "forged" }, { ...receipt, gradeHash: "forged" }, { ...receipt, rawGrade: { findings: [] } }])
      await expect(verifyResearchEvidenceFailure(failure, item, ["personal"], "context-a", changed)).rejects.toThrow();
    await expect(verifyResearchEvidenceFailure(failure, { ...item, content: item.content + " changed" }, ["personal"], "context-a", receipt)).rejects.toThrow();
    await expect(verifyResearchEvidenceFailure(failure, item, ["personal"], "different-context", receipt)).rejects.toThrow();
    await expect(verifyResearchEvidenceFailure({ ...failure, reason: "invented" }, item, ["personal"], "context-a", receipt)).rejects.toThrow();
  });

  it("preserves an old failed receipt's same-hash raw grade without another request", async () => {
    const { h, value, failure, receipt } = await failureFixture();
    delete receipt.rawGrade;
    h.receipts.set(failure.receiptId, receipt);
    expect(await repairResearchCitation(grade(), item, ["personal"], "context-a", h.access)).toEqual(value);
    expect(h.receipts.get(failure.receiptId).rawGrade).toEqual(grade());
    expect(h.select).toHaveBeenCalledTimes(1);
  });

  it("continues valid neighbors and caches terminal failure coverage without a synthetic grade or repeat", async () => {
    const h = harness(), cache = new Map<string, unknown>();
    const context: EvidenceCacheContext = { teamId: "team", model: "model", promptVersion: "v26", system: "same", audience: {}, selectionViewVersion: "v1", selectionAudience: {}, schemaForItem: id => ({ id }) };
    const other = { ...item, id: "source-b" }, added = { ...item, id: "source-c" };
    h.select.mockResolvedValueOnce({ "fixed-prompt-measurement": { passageId: 0, supportsCore: false } });
    const generated: string[][] = [];
    const access = {
      context, read: async (id: string) => cache.get(id) ?? null,
      write: async (id: string, value: unknown) => { cache.set(id, value); },
      discard: async (id: string) => { cache.delete(id); },
      validate: async (value: unknown, items: EvidenceCacheInput[]) => {
        const verified = [];
        for (const failure of researchEvidenceFailures(value)) {
          const source = items.find(source => source.id === failure.itemId)!;
          verified.push(await verifyResearchEvidenceFailure(failure, source, ["personal"], await researchEvidenceItemCacheId(context, source), h.receipts.get(failure.receiptId)));
        }
        return validateResearchEvidenceCacheValue(value, items, ["personal"], verified);
      },
      generate: async (items: EvidenceCacheInput[]) => {
        generated.push(items.map(source => source.id));
        const outputs = [];
        for (const source of items) {
          if (source.id === item.id) outputs.push(await repairResearchCitation(grade(source), source, ["personal"], await researchEvidenceItemCacheId(context, source), h.access));
          else {
            const raw = grade(source); raw.findings[0].evidence = researchQuotePassages(source.content || "")[0].text;
            outputs.push(validateResearchEvidenceCacheValue(raw, [source], ["personal"]));
          }
        }
        return { findings: outputs.flatMap(output => output.findings), evidenceFailures: outputs.flatMap(output => output.evidenceFailures || []) };
      },
    };
    const first = await reuseResearchEvidenceItems([item, other], access);
    expect(first.value.findings.map(finding => finding.itemId)).toEqual([other.id]);
    expect(first.value.evidenceFailures?.map(failure => failure.itemId)).toEqual([item.id]);
    expect(first.value.findings[0].score).toBe(95);
    expect(cache.size).toBe(2);
    const next = await reuseResearchEvidenceItems([added, other, item], access);
    expect(generated).toEqual([[item.id, other.id], [added.id]]);
    expect(next.value.findings.map(finding => finding.itemId)).toEqual([added.id, other.id]);
    expect(next.value.evidenceFailures).toEqual(first.value.evidenceFailures);
    expect(next.cacheHits).toBe(2);
    expect(h.select).toHaveBeenCalledTimes(1);
  });
});
