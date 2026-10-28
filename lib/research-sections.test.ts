import { describe, expect, it } from "vitest";
import { researchSectionInventory, researchSourceSections } from "./research-sections";
import { evidenceJsonSchemaForItems, researchEvidenceSchema, validateResearchSectionCoverage } from "./research-model";
import { anthropicResearchSchema } from "./research-anthropic";

const first = "The team records each customer decision before changing the workflow. This preserves the evidence and makes the next experiment inspectable.";
const second = "The release exposes a documented control for approving changes. Its description supports a capability claim without proving business outcomes.";
const third = "This section only contains a long unrelated event announcement with enough prose to inspect, but no decision for the supplied publishing audience.";
const content = `An introduction with Unicode 🧭.\n\n## Insight 1: Record the decision. Retain its context.\n\n${first}\n\n**Finding #2 — Approval control**\n\n${second}\n\n3. Lesson: Event announcement\n\n${third}`;
const item = researchSourceSections({ id: "report", content });
const idea = { summary: "Record the decision", evidence: first, contentAngle: "Preserve context", whyItMatters: "Make decisions inspectable", limitations: "Described method only", familyKey: "decision-context", score: 82 };
function assessment() {
  return researchEvidenceSchema.parse({ findings: { report: {
    ...idea, additionalIdeas: [{ ...idea, evidence: second, familyKey: "approval-control", score: 60 }],
    sectionChecks: [
      { sectionId: item.sourceSections[0].id, familyKeys: [idea.familyKey], notPostworthyReason: "" },
      { sectionId: item.sourceSections[1].id, familyKeys: ["approval-control"], notPostworthyReason: "" },
      { sectionId: item.sourceSections[2].id, familyKeys: [], notPostworthyReason: "The event announcement supplies no relevant reader decision." },
    ],
  } } }).findings;
}

describe("deterministic source section inventory", () => {
  it("preserves full titles and exact original spans across heading styles and Unicode", () => {
    expect(item.sourceSections).toHaveLength(3);
    expect(item.sourceSections.map(section => section.title)).toEqual([
      "Insight 1: Record the decision. Retain its context.", "Finding #2 — Approval control", "3. Lesson: Event announcement",
    ]);
    expect(item.sourceSections.map(section => content.slice(section.bodyStart, section.end))).toEqual([first, second, third]);
    expect(content.slice(item.sourceSections[0].start)).toMatch(/^## Insight 1:/);
    expect(researchSectionInventory(content)).toEqual(item.sourceSections);
  });
  it("requires at least two substantive bodies and skips a table of contents", () => {
    expect(researchSectionInventory(`Insight 1: First\nInsight 2: Second\n`)).toEqual([]);
    expect(researchSectionInventory(`Insight 1: First\n${first}\nFinding 2: Empty`)).toEqual([]);
    expect(researchSectionInventory(`Plain text mentioning Insight 1: in a sentence. ${first}`)).toEqual([]);
    const indexed = `Insight 1: First\nInsight 2: Second\n\n${content}`;
    expect(researchSectionInventory(indexed)).toHaveLength(3);
  });
  it("has no section count cap and decorates without mutating the captured input", () => {
    const input = Object.freeze({ id: "many", content: Array.from({ length: 40 }, (_, i) => `Result ${i + 1}: Observation\n${first}`).join("\n\n") });
    expect(researchSourceSections(input).sourceSections).toHaveLength(40);
    expect(input).not.toHaveProperty("sourceSections");
    expect(researchSourceSections({ content: null }).sourceSections).toEqual([]);
  });
});

describe("explicit section assessment coverage", () => {
  it("allows separate primary/additional decisions including below-threshold ideas and specific rejections", () => {
    const findings = assessment();
    expect(validateResearchSectionCoverage(findings, [item])).toBe(findings);
    expect(findings[0].additionalIdeas![0].score).toBe(60);
  });
  it.each(["missing", "duplicate", "unknown"])("rejects %s section IDs", kind => {
    const findings = assessment(), checks = findings[0].sectionChecks!;
    if (kind === "missing") checks.pop();
    if (kind === "duplicate") checks[1].sectionId = checks[0].sectionId;
    if (kind === "unknown") checks[1].sectionId = "foreign-section";
    expect(() => validateResearchSectionCoverage(findings, [item])).toThrow("every supplied section");
  });
  it.each([{ families: ["unknown-family"] }, { families: ["decision-context", "Decision Context"] }])("rejects unknown or repeated family references %j", ({ families }) => {
    const findings = assessment();
    findings[0].sectionChecks![0].familyKeys = families;
    expect(() => validateResearchSectionCoverage(findings, [item])).toThrow("distinct returned idea families");
  });
  it("rejects borrowing another section's quote, including a heading-only quote", () => {
    const findings = assessment();
    findings[0].sectionChecks![1].familyKeys = ["decision-context"];
    expect(() => validateResearchSectionCoverage(findings, [item])).toThrow("inside their claimed section body");
    findings[0].evidence = item.sourceSections[0].title;
    findings[0].sectionChecks![1].familyKeys = ["approval-control"];
    expect(() => validateResearchSectionCoverage(findings, [item])).toThrow("inside their claimed section body");
  });
  it("requires either a mapped idea or a reason and detects stale supplied spans", () => {
    const findings = assessment();
    findings[0].sectionChecks![0].notPostworthyReason = "Also rejected";
    expect(() => validateResearchSectionCoverage(findings, [item])).toThrow("either supported ideas");
    findings[0].sectionChecks![0].familyKeys = [];
    findings[0].sectionChecks![0].notPostworthyReason = " ";
    expect(() => validateResearchSectionCoverage(findings, [item])).toThrow("either supported ideas");
    expect(() => validateResearchSectionCoverage(assessment(), [{ ...item, sourceSections: item.sourceSections.map(section => ({ ...section, end: section.end + 1 })) }])).toThrow("match the captured source");
  });
  it("requires an explicit empty checklist when there are no sections, while legacy parsing stays compatible", () => {
    const legacy = researchEvidenceSchema.parse({ findings: [{ ...idea, itemId: "plain" }] }).findings;
    expect(() => validateResearchSectionCoverage(legacy, [{ id: "plain", content: first }])).toThrow("every supplied section");
    legacy[0].sectionChecks = [];
    expect(validateResearchSectionCoverage(legacy, [{ id: "plain", content: first }])).toBe(legacy);
    expect(() => validateResearchSectionCoverage(legacy, [])).toThrow("every input");
  });
  it("makes checklist grammar opt-in, shared, source-only and free of nullable unions", () => {
    const legacy = evidenceJsonSchemaForItems(["a", "b"], ["personal"]);
    expect(legacy.$defs.sourceAssessment.required).not.toContain("sectionChecks");
    const schema = evidenceJsonSchemaForItems(["a", "b"], ["personal"], { sectionCoverage: true });
    expect(schema.properties.findings.required).toEqual(["a", "b"]);
    expect(schema.$defs.sourceAssessment.required).toContain("sectionChecks");
    expect(schema.$defs.idea.properties).not.toHaveProperty("sectionChecks");
    expect(schema.$defs.sectionCheck!.required).toEqual(["sectionId", "familyKeys", "notPostworthyReason"]);
    expect(JSON.stringify(anthropicResearchSchema(schema))).not.toMatch(/anyOf|oneOf|"null"/);
  });
});
