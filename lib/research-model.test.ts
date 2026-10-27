import { describe, expect, it } from "vitest";
import {
  validateResearchEvidenceCoverage, matchResearchQuote, validateResearchScreening, validateResearchEvidence, researchScreeningSchema, screeningJsonSchema, screeningJsonSchemaForItems, researchEvidenceSchema,
  RESEARCH_SCREEN_BATCH_SIZE,
} from "./research-model";

const quote = "Only 35% of projects have a formal policy permitting GenAI use";
const finding = {
  itemId: "study", score: 82, summary: "Policy adoption lags usage",
  whyItMatters: "Teams need explicit contribution rules", contentAngle: "Set a policy",
  evidence: quote, limitations: "Survey evidence", familyKey: "genai-policy-study",
};
const items = [{ id: "study", content: `The research suggests policy has not kept pace with practice. ${quote}, while others have no policy.` }];

describe("research evidence quote formatting", () => {
  it.each([["“", "”"], ['"', '"'], ["‘", "’"], ["'", "'"]])(
    "verifies an exact excerpt wrapped in %s%s and stores the excerpt itself",
    (open, close) => {
      expect(validateResearchEvidence([{ ...finding, evidence: `${open}${quote}${close}` }], items))
        .toEqual([finding]);
    },
  );

  it("preserves quotation marks when they are actually present in the source", () => {
    const evidence = `“${quote}”`;
    expect(validateResearchEvidence([{ ...finding, evidence }], [{ id: "study", content: evidence }]))
      .toEqual([{ ...finding, evidence }]);
  });

  it.each([
    `“${quote}"`, `“Only 35% of projects...permitting GenAI use”`,
    `“Most projects have a policy permitting GenAI use”`, "“Short excerpt”",
  ])("rejects altered, mismatched or too-short excerpts: %s", (evidence) => {
    expect(validateResearchEvidence([{ ...finding, evidence }], [{ ...items[0], content: `${items[0].content} Short excerpt` }]))
      .toEqual([]);
  });

  it("keeps score, duplicate and item identity checks after removing wrappers", () => {
    const wrapped = { ...finding, evidence: `“${quote}”` };
    expect(validateResearchEvidence([
      { ...wrapped, score: 67 }, { ...wrapped, itemId: "unknown" }, wrapped, wrapped,
    ], items)).toEqual([finding]);
  });
});


describe("research screening capacity", () => {
  it("allows every item in a full screening batch without a twelve-story quota", () => {
    const itemIds = Array.from({ length: RESEARCH_SCREEN_BATCH_SIZE }, (_, index) => `item-${index}`);
    const assessments = itemIds.map(itemId => ({ itemId, selected: true, reason: "Specific supported practitioner decision" }));
    expect(validateResearchScreening(researchScreeningSchema.parse({ itemIds, assessments }), itemIds).itemIds).toEqual(itemIds);
    expect(screeningJsonSchema.properties.assessments.maxItems).toBe(RESEARCH_SCREEN_BATCH_SIZE);
    expect(() => researchScreeningSchema.parse({ itemIds: [...itemIds, "beyond-batch"], assessments })).toThrow();
  });
});

it("rejects silent omissions, unknown IDs, duplicate assessments and inconsistent selection", () => {
  const assessment = { itemId: "a", selected: true, reason: "Specific usable core" };
  for (const output of [
    { itemIds: ["a"], assessments: [assessment] },
    { itemIds: ["a"], assessments: [assessment, { ...assessment, itemId: "unknown" }] },
    { itemIds: ["a"], assessments: [assessment, assessment] },
    { itemIds: [], assessments: [assessment, { ...assessment, itemId: "b", selected: false }] },
    { itemIds: ["a", "a"], assessments: [assessment, { ...assessment, itemId: "b", selected: false }] },
  ]) expect(() => validateResearchScreening(output, ["a", "b"])).toThrow("every input exactly once");
  expect(validateResearchScreening({ itemIds: ["a"], assessments: [assessment, { itemId: "b", selected: false, reason: "No usable evidence" }] }, ["a", "b"]).itemIds).toEqual(["a"]);
});

it("matches HTML boundary spacing but saves the actual source wording", () => {
  const source = "Use this in isolated cases , usually after validating demand.";
  expect(matchResearchQuote(source, "Use this in isolated cases, usually after validating demand.")).toBe(source);
  expect(matchResearchQuote("The study reported a 1 .2 percent change in adoption.", "The study reported a 1.2 percent change in adoption.")).toBeNull();
  expect(matchResearchQuote(source, "Use this in all cases, usually after validating demand.")).toBeNull();
});

it("requires exactly one evidence assessment per input before advancing a batch", () => {
  expect(validateResearchEvidenceCoverage([finding], ["study"])).toEqual([finding]);
  for (const values of [[], [finding, finding], [{ ...finding, itemId: "foreign" }]])
    expect(() => validateResearchEvidenceCoverage(values, ["study"])).toThrow("every input exactly once");
});

it("constrains IDs to the input batch and derives selection without a duplicate list", () => {
  const assessment = { itemId: "a", selected: true, reason: "Concrete useful core" };
  expect(researchScreeningSchema.parse({ assessments: [assessment] }).itemIds).toEqual(["a"]);
  expect(screeningJsonSchemaForItems(["a"]).properties.assessments.items.properties.itemId.enum).toEqual(["a"]);
  expect(screeningJsonSchemaForItems(["a"]).properties.assessments.minItems).toBe(1);
});

it("preserves original quote offsets after Unicode case expansion", () => {
  const quote = "Measured conversion improved after reducing setup fields.";
  expect(matchResearchQuote(`İ News. ${quote} More text.`, quote)).toBe(quote);
  expect(matchResearchQuote(`İ News. ${quote}`, quote)).toBe(quote);
});

it("allows explicit rejections without inventing a supporting quote, but cannot save an ungrounded positive", () => {
  const output = researchEvidenceSchema.parse({ findings: [{ ...finding, score: 25, evidence: "" }, { ...finding, itemId: "unsupported-positive", evidence: "" }] });
  expect(validateResearchEvidenceCoverage(output.findings, ["study", "unsupported-positive"])).toHaveLength(2);
  expect(validateResearchEvidence(output.findings, [...items, { id: "unsupported-positive", content: quote }])).toEqual([]);
});
