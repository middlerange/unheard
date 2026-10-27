import { describe, expect, it, vi } from "vitest";
import {
  validateResearchEvidenceCoverage, matchResearchQuote, validateResearchScreening, validateResearchEvidence, researchScreeningSchema, screeningJsonSchema, screeningJsonSchemaForItems, researchEvidenceSchema,
  RESEARCH_SCREEN_BATCH_SIZE, openAIResearchOutput, callResearchModel, evidenceJsonSchemaForItems,
} from "./research-model";
import { anthropicResearchSchema } from "./research-anthropic";

vi.mock("./research-usage", () => ({
  beginResearchUsage: vi.fn(async () => "test-usage"),
  finishResearchUsage: vi.fn(async () => undefined),
}));

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
  const schema = screeningJsonSchemaForItems(["a"]).properties.assessments;
  expect(schema.required).toEqual(["a"]);
  expect(Object.keys(schema.properties)).toEqual(["a"]);
  expect(schema.additionalProperties).toBe(false);
});

it("requires every screening answer as a named field even when the provider removes array length constraints", () => {
  const ids = Array.from({ length: 8 }, (_, i) => `article-${i}`);
  const schema = screeningJsonSchemaForItems(ids);
  expect(anthropicResearchSchema(schema)).toEqual(schema);
  expect(schema.properties.assessments.required).toEqual(ids);
  const answers = Object.fromEntries(ids.map(itemId => [itemId, { selected: false, reason: "Off-profile evidence" }]));
  const complete = researchScreeningSchema.parse({ assessments: answers });
  expect(validateResearchScreening(complete, ids).assessments).toHaveLength(8);
  const { [ids[7]]: _missing, ...omitted } = answers;
  expect(() => validateResearchScreening(researchScreeningSchema.parse({ assessments: omitted }), ids)).toThrow("every input exactly once");
  expect(() => validateResearchScreening(researchScreeningSchema.parse({ assessments: { ...omitted, foreign: answers[ids[7]] } }), ids)).toThrow("every input exactly once");
  expect(() => researchScreeningSchema.parse({ assessments: { a: { selected: true, reason: "Decision", itemId: "forged" } } })).toThrow();
});

it("normalizes keyed evidence while retaining legacy cached arrays and quote validation", () => {
  const { itemId, ...assessment } = finding;
  const normalized = researchEvidenceSchema.parse({ findings: { [itemId]: assessment } });
  expect(normalized).toEqual(researchEvidenceSchema.parse({ findings: [finding] }));
  expect(validateResearchEvidenceCoverage(normalized.findings, [itemId])).toEqual([finding]);
  expect(validateResearchEvidence(normalized.findings, items)).toEqual([finding]);
  const schema = evidenceJsonSchemaForItems([itemId, "other"]);
  expect(schema.properties.findings.required).toEqual([itemId, "other"]);
  expect(schema.properties.findings.additionalProperties).toBe(false);
  expect(Object.keys(schema.properties.findings.properties)).toEqual([itemId, "other"]);
  const converted = anthropicResearchSchema(schema) as typeof schema;
  expect(converted.properties.findings.required).toEqual([itemId, "other"]);
  expect(() => validateResearchEvidenceCoverage(normalized.findings, [itemId, "other"])).toThrow("every input exactly once");
  expect(() => researchEvidenceSchema.parse({ findings: { [itemId]: { ...assessment, itemId: "forged" } } })).toThrow();
  const ungrounded = researchEvidenceSchema.parse({ findings: { [itemId]: { ...assessment, evidence: "" } } });
  expect(validateResearchEvidence(ungrounded.findings, items)).toEqual([]);
});

it("places the supported claim, exact evidence and limitations before the final evidence score", () => {
  const fields = ["summary", "evidence", "contentAngle", "whyItMatters", "limitations", "familyKey", "score"];
  const schema = evidenceJsonSchemaForItems(["study"]).properties.findings.properties.study;
  expect(Object.keys(schema.properties)).toEqual(fields);
  expect(schema.required).toEqual(fields);
  expect(Object.keys(researchEvidenceSchema.parse({ findings: [finding] }).findings[0])).toEqual(["itemId", ...fields]);
  expect(validateResearchEvidence([{ ...finding, evidence: "Unverified efficacy that the source does not contain." }], items)).toEqual([]);
});

it("preserves original quote offsets after Unicode case expansion", () => {
  const quote = "Measured conversion improved after reducing setup fields.";
  expect(matchResearchQuote(`İ News. ${quote} More text.`, quote)).toBe(quote);
  expect(matchResearchQuote(`İ News. ${quote}`, quote)).toBe(quote);
});

it("returns the actual contiguous source span for curly and straight quotation marks", () => {
  const sourceQuote = 'The team’s “first‑run” test — recorded in March – was complete… then reviewed.';
  const equivalent = `The team's "first‑run" test — recorded in March – was complete… then reviewed.`;
  expect(matchResearchQuote(`İ Earlier… ${sourceQuote} Later.`, equivalent)).toBe(sourceQuote);
  expect(matchResearchQuote(equivalent, sourceQuote)).toBe(equivalent);
  expect(matchResearchQuote(sourceQuote, `"${equivalent}"`)).toBe(sourceQuote);
  expect(matchResearchQuote(sourceQuote, `The team's "first‑run" test — recorded in March – was successful… then reviewed.`)).toBeNull();
  expect(matchResearchQuote(sourceQuote, equivalent.replace('—', '-'))).toBeNull();
  expect(matchResearchQuote(sourceQuote, equivalent.replace('…', '...'))).toBeNull();
  expect(matchResearchQuote(sourceQuote, `The team's "first-run" test ... then reviewed.`)).toBeNull();
});

it("keeps transcript omissions, added attribution and stitched evidence outside typography matching", () => {
  const source = 'Teams review the proposed requirements. [12:31] They approve the next phase. The vendor reports faster delivery.';
  expect(matchResearchQuote(source, 'Teams review the proposed requirements. They approve the next phase.')).toBeNull();
  expect(matchResearchQuote(source, 'According to AWS, teams review the proposed requirements.')).toBeNull();
  expect(matchResearchQuote(source, 'Teams review the proposed requirements. The vendor reports faster delivery.')).toBeNull();
});

it("allows explicit rejections without inventing a supporting quote, but cannot save an ungrounded positive", () => {
  const output = researchEvidenceSchema.parse({ findings: [{ ...finding, score: 25, evidence: "" }, { ...finding, itemId: "unsupported-positive", evidence: "" }] });
  expect(validateResearchEvidenceCoverage(output.findings, ["study", "unsupported-positive"])).toHaveLength(2);
  expect(validateResearchEvidence(output.findings, [...items, { id: "unsupported-positive", content: quote }])).toEqual([]);
});

describe("OpenAI structured response phases", () => {
  const content = (text: string) => [{ type: "output_text", text }];
  it("selects the final answer without concatenating commentary or legacy text", () => {
    expect(openAIResearchOutput({ output: [
      { type: "message", phase: "commentary", content: content("{}") },
      { type: "message", content: content('{"legacy":true}') },
      { type: "message", phase: "final_answer", content: content('{"findings":[]}') },
    ] })).toBe('{"findings":[]}');
  });
  it("retains legacy unphased messages while excluding commentary and non-message items", () => {
    expect(openAIResearchOutput({ output: [
      { type: "message", phase: "commentary", content: content("intermediate") },
      { type: "reasoning", content: content("not an answer") },
      { type: "message", phase: null, content: content('{"ok":') },
      { content: content("true}") },
    ] })).toBe('{"ok":true}');
    expect(openAIResearchOutput({ output: [{ type: "message", phase: "commentary", content: content("{}") }] })).toBe("");
  });
  it("parses a completed final answer and still rejects commentary-only or incomplete responses", async () => {
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-response-phases";
    const context = { teamId: "phase-test", runId: "phase-run", stage: "research" as const, operation: "screen" };
    const fetcher = vi.spyOn(globalThis, "fetch");
    const output = [
      { type: "message", phase: "commentary", content: content("{}") },
      { type: "message", phase: "final_answer", content: content('{"findings":[]}') },
    ];
    try {
      fetcher.mockResolvedValueOnce(Response.json({ status: "completed", output }));
      expect((await callResearchModel("system", {}, {}, 100, context, "gpt-6-sol")).value).toEqual({ findings: [] });
      fetcher.mockResolvedValueOnce(Response.json({ status: "completed", output: [output[0]] }));
      await expect(callResearchModel("system", {}, {}, 100, context, "gpt-6-sol")).rejects.toThrow("no structured research response");
      fetcher.mockResolvedValueOnce(Response.json({ status: "incomplete", output }));
      await expect(callResearchModel("system", {}, {}, 100, context, "gpt-6-sol")).rejects.toThrow("did not complete");
    } finally {
      fetcher.mockRestore();
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
    }
  });
});
