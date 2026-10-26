import { describe, expect, it } from "vitest";
import {
  validateResearchEvidence, researchScreeningSchema, screeningJsonSchema,
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
    expect(researchScreeningSchema.parse({ itemIds }).itemIds).toEqual(itemIds);
    expect(screeningJsonSchema.properties.itemIds.maxItems).toBe(RESEARCH_SCREEN_BATCH_SIZE);
    expect(() => researchScreeningSchema.parse({ itemIds: [...itemIds, "beyond-batch"] })).toThrow();
  });
});
