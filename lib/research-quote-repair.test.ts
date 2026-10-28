import { describe, expect, it, vi } from "vitest";
import { researchEvidenceSchema, validateResearchSectionCoverage } from "./research-model";
import { validateResearchEvidenceCacheValue } from "./research-evidence-cache";
import { researchSourceSections } from "./research-sections";
import { applyResearchQuoteRepair, quoteRepairSchema, repairResearchCitation, researchQuotePassages, researchQuoteRepairPlan, sameContextQuoteFailure } from "./research-quote-repair";

const item = { id: "source-a", content: "The measurement workflow freezes high-intent prompts before comparing visibility and downstream outcomes.\n\nOperators log the same prompts for four weeks and compare leading visibility against lagging business measures." };
function grade(source = item) {
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
  ])("fails unsupported, invalid or extra output and never repeats the repair: %j", async selection => {
    const h = harness(); h.select.mockResolvedValueOnce(selection as never);
    await expect(repairResearchCitation(grade(), item, ["personal"], "context-a", h.access)).rejects.toThrow();
    await expect(repairResearchCitation(grade(), item, ["personal"], "context-a", h.access)).rejects.toThrow("already attempted");
    expect(h.select).toHaveBeenCalledTimes(1);
  });

  it("fences transport-unknown and concurrent attempts before another request", async () => {
    const h = harness(); h.select.mockRejectedValueOnce(new Error("Unknown transport outcome"));
    await expect(repairResearchCitation(grade(), item, ["personal"], "context-a", h.access)).rejects.toThrow("Unknown transport");
    await expect(repairResearchCitation(grade(), item, ["personal"], "context-a", h.access)).rejects.toThrow("already attempted");
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
    await expect(repairResearchCitation(raw, source, ["personal"], "context-a", h.access)).rejects.toThrow("inside their claimed section");
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
