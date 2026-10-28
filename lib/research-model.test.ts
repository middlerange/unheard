import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  validateResearchEvidenceCoverage, matchResearchQuote, validateResearchScreening, validateResearchEvidence, researchScreeningSchema, screeningJsonSchema, screeningJsonSchemaForItems, researchEvidenceSchema,
  RESEARCH_SCREEN_BATCH_SIZE, openAIResearchOutput, callResearchModel, evidenceJsonSchemaForItems,
  validateResearchEvidenceProfiles, validateResearchSectionCoverage, normalizeResearchSectionChecks,
} from "./research-model";
import { anthropicResearchSchema } from "./research-anthropic";
import { researchSectionInventory } from "./research-sections";

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

describe("profile-specific rubric components",()=>{
  const checks={company:{fits:false,relevance:8,reason:"No direct company adoption decision."},personal:{fits:true,relevance:27,reason:"A concrete product leadership decision for the personal audience."}};
  const assessed={...finding,claimBasis:"reasoned_position",profileChecks:checks,qualityComponents:{sourceSupport:22,usefulDecision:25,scopeHonesty:14}};
  it("selects the fitting personal audience and computes the unchanged rubric without a company veto",()=>{
    const parsed=researchEvidenceSchema.parse({findings:[assessed]}).findings;
    expect(parsed[0]).toMatchObject({chosenProfileId:"personal",profileFit:checks.personal.reason,score:88});
    expect(validateResearchEvidenceProfiles(parsed,["company","personal"])).toEqual(parsed);
    expect(validateResearchEvidence(parsed,items)).toHaveLength(1);
  });
  it("normalizes compact wire checks and rejects repeated profile IDs",()=>{
    const compact={...assessed,profileChecks:Object.entries(checks).map(([profileId,check])=>({profileId,...check}))};
    expect(researchEvidenceSchema.parse({findings:[compact]}).findings[0]).toMatchObject({profileChecks:checks,score:88});
    expect(()=>researchEvidenceSchema.parse({findings:[{...compact,profileChecks:[compact.profileChecks[0],compact.profileChecks[0]]}]})).toThrow("must not repeat");
  });
  it("keeps no-fit material rejected even when non-relevance components or a supplied legacy score are high",()=>{
    const rejected={...assessed,score:99,profileChecks:{company:{...checks.company},personal:{...checks.personal,fits:false}},qualityComponents:{sourceSupport:25,usefulDecision:30,scopeHonesty:15},familyKey:""};
    const parsed=researchEvidenceSchema.parse({findings:[rejected]}).findings;
    expect(parsed[0]).toMatchObject({score:0,chosenProfileId:null});
    expect(validateResearchEvidence(parsed,items)).toEqual([]);
  });
  it("requires complete components, bounded scores and every actual profile",()=>{
    expect(()=>researchEvidenceSchema.parse({findings:[{...finding,profileChecks:checks}]})).toThrow("must be supplied together");
    expect(()=>researchEvidenceSchema.parse({findings:[{...assessed,qualityComponents:{...assessed.qualityComponents,sourceSupport:26}}]})).toThrow();
    const parsed=researchEvidenceSchema.parse({findings:[{...assessed,profileChecks:{personal:checks.personal}}]}).findings;
    expect(()=>validateResearchEvidenceProfiles(parsed,["company","personal"])).toThrow("every supplied");
  });
});

describe("categorical source qualification", () => {
  const components = { sourceSupport: "supported_bounded_claim", usefulDecision: "useful_distinction_or_signal", scopeHonesty: "accurately_bounded" };
  const profileChecks = { personal: { fits: true, relevance: 16, reason: "A specific adjacent practitioner signal." }, company: { fits: false, relevance: 0, reason: "Outside its remit." } };
  const candidate = { ...finding, claimBasis: "measured_observation", profileChecks, qualityComponents: components };
  const parse = (changes: Record<string, unknown> = {}) => researchEvidenceSchema.parse({ findings: [{ ...candidate, ...changes }] }).findings[0];

  it("qualifies an honestly described survey signal at adjacent relevance without requiring outcome proof", () => {
    const parsed = parse();
    expect(parsed).toMatchObject({ score: 80, chosenProfileId: "personal", qualificationRubric: "source_qualification_v1",
      qualityComponents: { sourceSupport: 25, usefulDecision: 24, scopeHonesty: 15 } });
    expect(validateResearchEvidenceProfiles([parsed], ["company", "personal"])).toHaveLength(1);
    expect(validateResearchEvidence([parsed], items)).toHaveLength(1);
  });
  it.each(["reasoned_position", "described_method", "reported_capability"])("uses the same bounded-source gates for %s", claimBasis => {
    expect(parse({ claimBasis, qualityComponents: { ...components, usefulDecision: "concrete_decision" } }).score).toBe(86);
  });
  it("enforces every categorical gate over all component combinations and the relevance boundary", () => {
    for (const sourceSupport of ["supported_bounded_claim", "incomplete_support", "unsupported"])
      for (const usefulDecision of ["concrete_decision", "useful_distinction_or_signal", "generic", "none"])
        for (const scopeHonesty of ["accurately_bounded", "material_gap", "misleading"])
          for (const relevance of [0, 15, 16, 30]) {
            const parsed = parse({ profileChecks: { ...profileChecks, personal: { ...profileChecks.personal, relevance } },
              qualityComponents: { sourceSupport, usefulDecision, scopeHonesty } });
            const qualifies = relevance >= 16 && sourceSupport === "supported_bounded_claim"
              && ["concrete_decision", "useful_distinction_or_signal"].includes(usefulDecision) && scopeHonesty === "accurately_bounded";
            expect(parsed.score >= 70, JSON.stringify({ relevance, sourceSupport, usefulDecision, scopeHonesty })).toBe(qualifies);
            if (!relevance) expect(parsed.score).toBe(0);
          }
  });
  it.each([
    { sourceSupport: "incomplete_support" }, { sourceSupport: "unsupported" },
    { usefulDecision: "generic" }, { scopeHonesty: "material_gap" },
  ])("caps a failed gate even when the other components could push its sum over70: %j", changed => {
    const parsed = parse({ profileChecks: { ...profileChecks, personal: { ...profileChecks.personal, relevance: 30 } },
      qualityComponents: { ...components, usefulDecision: "concrete_decision", ...changed } });
    expect(parsed.score).toBe(69);
    expect(validateResearchEvidence([parsed], items)).toEqual([]);
  });
  it("keeps generic bounded hype and no-useful-core claims rejected despite high profile relevance", () => {
    const hype = parse({ profileChecks: { personal: { ...profileChecks.personal, relevance: 30 } },
      qualityComponents: { ...components, sourceSupport: "unsupported", usefulDecision: "generic" } });
    expect(hype.score).toBe(55);
    expect(parse({ claimBasis: "no_useful_core" }).score).toBe(0);
    expect(parse({ profileChecks: { personal: { ...profileChecks.personal, fits: false, relevance: 30 } } }).score).toBe(0);
    expect(validateResearchEvidence([parse({ evidence: "" })], items)).toEqual([]);
  });
  it("does not let a supported source rescue another source's unsupported claim", () => {
    const unsupported = parse({ profileChecks: { personal: { ...profileChecks.personal, relevance: 30 } },
      qualityComponents: { ...components, sourceSupport: "unsupported", usefulDecision: "concrete_decision" } });
    const supported = { ...parse(), itemId: "other-source" };
    const assessed = researchEvidenceSchema.parse({ findings: [unsupported, supported] }).findings;
    expect(assessed.map(idea => idea.score)).toEqual([69, 80]);
    expect(validateResearchEvidence(assessed, [...items, { id: "other-source", content: quote }]).map(idea => idea.itemId)).toEqual(["other-source"]);
  });
  it("retains the internal rubric marker and exact capped score on normalized-cache reparse", () => {
    const parsed = parse({ qualityComponents: { ...components, sourceSupport: "incomplete_support", usefulDecision: "concrete_decision" },
      profileChecks: { personal: { ...profileChecks.personal, relevance: 30 } } });
    expect(parsed.score).toBe(69);
    expect(researchEvidenceSchema.parse(JSON.parse(JSON.stringify({ findings: [parsed] }))).findings[0]).toEqual(parsed);
    const legacy = parse({ qualityComponents: { sourceSupport: 12, usefulDecision: 30, scopeHonesty: 15 },
      profileChecks: { personal: { ...profileChecks.personal, relevance: 30 } } });
    expect(legacy.score).toBe(87);
    expect(legacy).not.toHaveProperty("qualificationRubric");
    expect(researchEvidenceSchema.parse({ findings: [legacy] }).findings[0]).toEqual(legacy);
  });
  it("normalizes nested categorical primary/additional claims independently and never emits the marker in the wire schema", () => {
    const { itemId: _id, summary, evidence, contentAngle, whyItMatters, limitations, ...rest } = candidate;
    const claim = { summary, evidence, contentAngle, whyItMatters, limitations };
    const result = researchEvidenceSchema.parse({ findings: { study: { ...rest, claim, additionalIdeas: [{ ...rest, claim,
      familyKey: "additional-signal", qualityComponents: { ...components, usefulDecision: "generic" } }] } } }).findings[0];
    expect(result.score).toBe(80);
    expect(result.additionalIdeas![0]).toMatchObject({ score: 66, qualificationRubric: "source_qualification_v1" });
    expect(result).not.toHaveProperty("claim");
    const wire = evidenceJsonSchemaForItems(["study"], ["personal", "company"], { sectionCoverage: true });
    expect(wire.$defs.qualityComponents.properties.sourceSupport.enum).toEqual(["supported_bounded_claim", "incomplete_support", "unsupported"]);
    expect(wire.$defs.qualityComponents.properties.usefulDecision.enum).toEqual(["concrete_decision", "useful_distinction_or_signal", "generic", "none"]);
    expect(wire.$defs.qualityComponents.properties.scopeHonesty.enum).toEqual(["accurately_bounded", "material_gap", "misleading"]);
    expect(wire.$defs.idea.properties).not.toHaveProperty("qualificationRubric");
  });
  it.each([
    { ...components, sourceSupport: "unknown" }, { ...components, usefulDecision: 24 },
    { sourceSupport: "supported_bounded_claim" }, { ...components, extra: "unknown" },
  ])("rejects unknown, mixed or incomplete category objects %j", qualityComponents => {
    expect(() => parse({ qualityComponents })).toThrow();
  });
});

describe("independent profile checks and claim-based evidence", () => {
  it("requires every profile check before claim scoring, including in Anthropic's wire schema", () => {
    const wire = evidenceJsonSchemaForItems(["study"], ["company", "personal"]);
    const schema = wire.$defs.sourceAssessment;
    expect(wire.properties.findings.properties.study).toEqual({ $ref: "#/$defs/sourceAssessment" });
    expect(wire.properties.findings.required).toEqual(["study"]);
    expect(Object.keys(schema.properties)).toEqual(["claimBasis", "profileChecks", "claim", "familyKey", "qualityComponents", "additionalIdeas"]);
    expect(schema.required.slice(0, 2)).toEqual(["claimBasis", "profileChecks"]);
    expect(wire.$defs.profileCheck.properties.profileId.enum).toEqual(["company", "personal"]);
    expect(wire.$defs.profileChecks.items).toEqual({ $ref: "#/$defs/profileCheck" });
    expect(schema.properties).not.toHaveProperty("chosenProfileId");
    expect(schema.properties).not.toHaveProperty("score");
    const converted = anthropicResearchSchema(wire) as typeof wire;
    expect(Object.keys(converted.$defs.sourceAssessment.properties)).toEqual(Object.keys(schema.properties));
    expect(converted.$defs.sourceAssessment.required).toContain("profileChecks");
  });
  it("accepts a personal distribution decision independently and preserves a genuine no-fit rejection", () => {
    const decision = { ...finding, chosenProfileId: "personal", profileFit: "The personal profile covers distribution; inspect the effect on qualified website visits. Company onboarding scope is irrelevant to this choice." };
    const rejected = { ...finding, itemId: "unrelated", score: 20, chosenProfileId: null, profileFit: "Neither profile covers telescope optics." };
    const { itemId: _decisionId, ...decisionBody } = decision, { itemId: _rejectedId, ...rejectedBody } = rejected;
    const parsed = researchEvidenceSchema.parse({ findings: { study: decisionBody, unrelated: rejectedBody } });
    expect(validateResearchEvidenceProfiles(parsed.findings, ["company", "personal"])).toEqual([decision, rejected]);
    expect(validateResearchEvidence([decision], items)).toEqual([decision]);
  });
  it.each([
    { chosenProfileId: "foreign", profileFit: "A foreign profile cannot be chosen." },
    { chosenProfileId: null, profileFit: "No profile fits, so a positive cannot be saved." },
    { chosenProfileId: "personal", profileFit: " " },
    {},
  ])("rejects invalid or missing positive profile assignments: %j", choice => {
    expect(() => validateResearchEvidenceProfiles([{ ...finding, ...choice }], ["company", "personal"])).toThrow("supplied enabled profile");
  });
  it("keeps legacy array/keyed parsing separate from required v15 validation", () => {
    const oldArray = researchEvidenceSchema.parse({ findings: [finding] });
    const { itemId: _id, ...assessment } = finding;
    expect(researchEvidenceSchema.parse({ findings: { study: assessment } })).toEqual(oldArray);
    expect(validateResearchEvidence(oldArray.findings, items)).toEqual([finding]);
    expect(() => validateResearchEvidenceProfiles(oldArray.findings, ["personal"])).toThrow();
    expect(() => validateResearchEvidenceProfiles([{ ...finding, score: 20, chosenProfileId: "foreign", profileFit: "Unknown even for rejection." }], ["personal"])).toThrow();
  });
});

describe("distinct supported ideas from one public source", () => {
  it("shares nonrecursive wire definitions instead of multiplying nullable grammar branches per source",()=>{
    const schema=anthropicResearchSchema(evidenceJsonSchemaForItems(Array.from({length:6},(_,i)=>`source-${i}`),["personal","company"])) as ReturnType<typeof evidenceJsonSchemaForItems>;
    let unions=0,arrays=0;
    function visit(value:unknown){if(!value||typeof value!=="object")return;const x=value as Record<string,unknown>;if(x.anyOf)unions++;if(x.type==="array")arrays++;for(const child of Object.values(x))if(Array.isArray(child))child.forEach(visit);else visit(child);}
    visit(schema);
    expect(unions).toBe(0);expect(arrays).toBe(2);
    expect(schema.$defs.sourceAssessment.properties.additionalIdeas.items).toEqual({$ref:"#/$defs/idea"});
    expect(schema.$defs.idea).not.toHaveProperty("additionalIdeas");
    expect(schema.properties.findings.required).toHaveLength(6);
    expect(schema.$defs.sourceAssessment.properties).not.toHaveProperty("itemId");
  });
  const secondQuote = "Teams should measure channel adoption separately from reported impact.";
  const extra = { ...finding, evidence: secondQuote, familyKey: "channel-impact", chosenProfileId: "personal", profileFit: "The personal profile covers distribution decisions." };
  const { itemId: _id, ...additional } = extra;
  it("keeps each independently quoted idea while assessing source coverage exactly once", () => {
    const base = { ...finding, chosenProfileId: "personal", profileFit: "A concrete policy decision.", additionalIdeas: [additional] };
    const parsed = researchEvidenceSchema.parse({ findings: [base] });
    expect(validateResearchEvidenceCoverage(parsed.findings, ["study"])).toHaveLength(1);
    validateResearchEvidenceProfiles(parsed.findings, ["personal"]);
    const accepted = validateResearchEvidence(parsed.findings, [{ id: "study", content: quote + " " + secondQuote }]);
    expect(accepted.map(x => x.familyKey)).toEqual([finding.familyKey, extra.familyKey]);
    expect(accepted[1]).toMatchObject({ itemId: "study", isAdditional: true, evidence: secondQuote });
  });
  it("rejects unsupported extra quotes and does not let a passing primary rescue them", () => {
    const base = { ...finding, additionalIdeas: [additional] };
    expect(validateResearchEvidence([base], items).map(x => x.familyKey)).toEqual([finding.familyKey]);
  });
  it("does not require a passing primary when a distinct additional idea is grounded", () => {
    const base = { ...finding, score: 45, additionalIdeas: [additional] };
    expect(validateResearchEvidence([base], [{ id: "study", content: secondQuote }])).toEqual([{ ...extra, isAdditional: true }]);
  });
  it("rejects repeated families, nested item substitution and invalid extra profiles", () => {
    expect(() => researchEvidenceSchema.parse({ findings: [{ ...finding, additionalIdeas: [{ ...additional, familyKey: "GenAI policy study" }] }] })).toThrow("Distinct ideas");
    expect(() => researchEvidenceSchema.parse({ findings: [{ ...finding, additionalIdeas: [{ ...additional, itemId: "foreign" }] }] })).toThrow();
    expect(() => validateResearchEvidenceProfiles([{ ...finding, chosenProfileId: "personal", profileFit: "Fits.", additionalIdeas: [{ ...additional, chosenProfileId: "foreign" }] }], ["personal"])).toThrow();
  });
});

describe("explicit no-profile rejection families", () => {
  it("preserves a valid positive alongside zero-score no-profile answers without a story family", () => {
    const positive = { ...finding, chosenProfileId: "personal", profileFit: "A supported product decision." };
    const negative = { ...finding, itemId: "unrelated", familyKey: "", score: 0, chosenProfileId: null, profileFit: "No supplied profile covers this unrelated infrastructure report." };
    const { itemId: _positiveId, ...positiveBody } = positive, { itemId: _negativeId, ...negativeBody } = negative;
    const parsed = researchEvidenceSchema.parse({ findings: { study: positiveBody, unrelated: negativeBody } });
    expect(validateResearchEvidenceCoverage(parsed.findings, ["study", "unrelated"])).toEqual([positive, negative]);
    expect(validateResearchEvidenceProfiles(parsed.findings, ["personal"])).toEqual([positive, negative]);
    expect(validateResearchEvidence(parsed.findings, items)).toEqual([positive]);
  });
  it("does not fail a batch when a rejected below-threshold idea has no family",()=>{
    const rejected={...finding,score:42,familyKey:"",chosenProfileId:"personal",profileFit:"A weak adjacent idea."};
    const parsed=researchEvidenceSchema.parse({findings:[finding,rejected]});
    expect(validateResearchEvidence(parsed.findings,items)).toEqual([finding]);
  });
  it.each([
    { score: 70, chosenProfileId: "personal" },
    { score: 70, chosenProfileId: null },
  ])("keeps story families required for every other assessment: %j", choice => {
    expect(() => researchEvidenceSchema.parse({ findings: [{ ...finding, ...choice, familyKey: "" }] })).toThrow("story family");
  });
});

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

it("puts the screening reason before selection while preserving both decisions from legacy caches", () => {
  const keyed = screeningJsonSchemaForItems(["method", "off-profile"]);
  const converted = anthropicResearchSchema(keyed) as typeof keyed;
  for (const id of ["method", "off-profile"]) {
    expect(Object.keys(keyed.properties.assessments.properties[id].properties)).toEqual(["reason", "selected"]);
    expect(keyed.properties.assessments.properties[id].required).toEqual(["reason", "selected"]);
    expect(Object.keys(converted.properties.assessments.properties[id].properties)).toEqual(["reason", "selected"]);
  }
  expect(Object.keys(screeningJsonSchema.properties.assessments.items.properties)).toEqual(["itemId", "reason", "selected"]);
  const legacy = { assessments: [
    { itemId: "method", selected: true, reason: "An explicit review gate supports a product builder's handoff decision; outcomes are unmeasured." },
    { itemId: "off-profile", selected: false, reason: "The infrastructure configuration supplies no concrete product or growth decision." },
  ] };
  const original = JSON.stringify(legacy);
  const normalized = validateResearchScreening(researchScreeningSchema.parse(legacy), ["method", "off-profile"]);
  expect(normalized.itemIds).toEqual(["method"]);
  expect(normalized.assessments).toEqual(legacy.assessments);
  expect(Object.keys(normalized.assessments[0])).toEqual(["itemId", "reason", "selected"]);
  expect(JSON.stringify(legacy)).toBe(original);
  const keyedOutput = { assessments: Object.fromEntries(legacy.assessments.map(({ itemId, ...assessment }) => [itemId, assessment])) };
  expect(validateResearchScreening(researchScreeningSchema.parse(keyedOutput), ["method", "off-profile"])).toEqual(normalized);
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
  expect(schema.properties.findings.properties[itemId]).toEqual({ $ref: "#/$defs/sourceAssessment" });
  expect(schema.$defs.sourceAssessment.required).not.toContain("itemId");
  const converted = anthropicResearchSchema(schema) as typeof schema;
  expect(converted.properties.findings.required).toEqual([itemId, "other"]);
  expect(() => validateResearchEvidenceCoverage(normalized.findings, [itemId, "other"])).toThrow("every input exactly once");
  expect(() => researchEvidenceSchema.parse({ findings: { [itemId]: { ...assessment, itemId: "forged" } } })).toThrow();
  const ungrounded = researchEvidenceSchema.parse({ findings: { [itemId]: { ...assessment, evidence: "" } } });
  expect(validateResearchEvidence(ungrounded.findings, items)).toEqual([]);
});

it("places the supported claim, exact evidence and limitations before the final evidence score", () => {
  const fields = ["summary", "evidence", "contentAngle", "whyItMatters", "limitations", "familyKey", "score"];
  const wire = evidenceJsonSchemaForItems(["study"]), schema = wire.$defs.sourceAssessment;
  expect(Object.keys(wire.$defs.claim.properties)).toEqual(fields.slice(0, 5));
  expect(Object.keys(schema.properties)).toEqual(["claim", "familyKey", "score", "additionalIdeas"]);
  expect(schema.required).toEqual(["claim", "familyKey", "score", "additionalIdeas"]);
  expect(Object.keys(researchEvidenceSchema.parse({ findings: [finding] }).findings[0])).toEqual(["itemId", ...fields]);
  expect(validateResearchEvidence([{ ...finding, evidence: "Unverified efficacy that the source does not contain." }], items)).toEqual([]);
});

describe("actual single-source section schema", () => {
  const { itemId: _itemId, ...keyedFinding } = finding;
  it("retains byte-identical generic schemas for existing cache contracts", () => {
    const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    expect(hash(evidenceJsonSchemaForItems(["study"], ["personal", "company"], { sectionCoverage: true }))).toBe("be6c8ca44197aec677fcdea9e691b099a5402513a1d4468c22667cd0f51d45e8");
    expect(hash(evidenceJsonSchemaForItems(["study", "other"], ["personal", "company"], { sectionCoverage: true }))).toBe("10e4b55ad275dff881ad06892c283dacfdf9309014e03e57a4173a68f480afa6");
    expect(hash(evidenceJsonSchemaForItems(["study"]))).toBe("3e34ee5ace8e52394c1eedc83faccaa740245e4c1991420acc481fedf5d16295");
    expect(evidenceJsonSchemaForItems(["study", "other"], undefined, { sectionCoverage: true, sectionIds: [] })).toEqual(evidenceJsonSchemaForItems(["study", "other"], undefined, { sectionCoverage: true }));
    expect(evidenceJsonSchemaForItems(["study"], undefined, { sectionIds: ["ignored"] })).toEqual(evidenceJsonSchemaForItems(["study"]));
  });
  it("retains exact empty object checks through the Anthropic wire conversion", () => {
    const wire = evidenceJsonSchemaForItems(["study"], ["personal"], { sectionCoverage: true, sectionIds: [] });
    const converted = anthropicResearchSchema(wire) as typeof wire;
    expect(converted.$defs.sourceAssessment.properties.sectionChecks).toEqual({ type: "object", properties: {}, required: [], additionalProperties: false });
    expect(converted.$defs.sectionCheck?.properties).not.toHaveProperty("sectionId");
    const raw = { findings: { study: { ...keyedFinding, sectionChecks: {} } } }, before = JSON.stringify(raw);
    const normalized = normalizeResearchSectionChecks(raw, items);
    expect(normalized).toEqual({ findings: { study: { ...keyedFinding, sectionChecks: [] } } });
    expect(JSON.stringify(raw)).toBe(before);
    const valid = researchEvidenceSchema.parse(normalized).findings;
    expect(validateResearchSectionCoverage(valid, items)).toBe(valid);
    expect(() => normalizeResearchSectionChecks({ findings: { study: { ...finding, sectionChecks: { invented: { familyKeys: [], notPostworthyReason: "No core." } } } } }, items)).toThrow("every supplied section exactly once");
  });
  const content = `Insight 1: First decision\n${"A team documents the observed workflow before changing the requirement. ".repeat(2)}\n\nFinding 2: Second decision\n${"A reviewer checks the stated assumptions before approving a proposed change. ".repeat(2)}`;
  const sectionIds = researchSectionInventory(content).map(section => section.id);
  const source = [{ id: "study", content }];
  const checks = Object.fromEntries(sectionIds.map(sectionId => [sectionId, { familyKeys: [], notPostworthyReason: "No additional decision for this profile." }]));
  it("pins all actual keys and excludes foreign keys in the provider schema", () => {
    expect(sectionIds).toHaveLength(2);
    const converted = anthropicResearchSchema(evidenceJsonSchemaForItems(["study"], ["personal"], { sectionCoverage: true, sectionIds })) as ReturnType<typeof evidenceJsonSchemaForItems>;
    expect(converted.$defs.sourceAssessment.properties.sectionChecks).toEqual({ type: "object", properties: Object.fromEntries(sectionIds.map(id => [id, { $ref: "#/$defs/sectionCheck" }])), required: sectionIds, additionalProperties: false });
    expect(converted.$defs.sectionCheck?.required).toEqual(["familyKeys", "notPostworthyReason"]);
  });
  it.each([false, true])("normalizes source-keyed and array findings without changing claim/grade fields (array=%s)", array => {
    const assessment = { ...(array ? finding : keyedFinding), sectionChecks: checks }, raw = { findings: array ? [assessment] : { study: assessment } }, before = JSON.stringify(raw);
    const normalized = normalizeResearchSectionChecks(raw, source) as { findings: unknown };
    const expected = { ...(array ? finding : keyedFinding), sectionChecks: sectionIds.map(sectionId => ({ sectionId, ...checks[sectionId] })) };
    expect(normalized.findings).toEqual(array ? [expected] : { study: expected });
    expect(JSON.stringify(raw)).toBe(before);
    expect(validateResearchSectionCoverage(researchEvidenceSchema.parse(normalized).findings, source)).toHaveLength(1);
  });
  it.each(["missing", "unknown", "collision"])("rejects %s keyed sections before parsing", kind => {
    const malformed = structuredClone(checks);
    if (kind === "missing") delete malformed[sectionIds[0]];
    if (kind === "unknown") { malformed.invented = malformed[sectionIds[0]]; delete malformed[sectionIds[0]]; }
    if (kind === "collision") Object.assign(malformed[sectionIds[0]], { sectionId: "foreign" });
    for (const findings of [[{ ...finding, sectionChecks: malformed }], { study: { ...finding, sectionChecks: malformed } }])
      expect(() => normalizeResearchSectionChecks({ findings }, source)).toThrow(kind === "collision" ? "override" : "every supplied section exactly once");
  });
  it("leaves legacy arrays unchanged and retains server-side duplicate/unknown ID rejection", () => {
    const legacyChecks = sectionIds.map(sectionId => ({ sectionId, familyKeys: [], notPostworthyReason: "No relevant core." }));
    const assessment = { ...finding, sectionChecks: legacyChecks };
    const normalized = normalizeResearchSectionChecks({ findings: [assessment] }, source) as { findings: typeof assessment[] };
    expect(normalized.findings[0]).toBe(assessment);
    expect(normalized.findings[0].sectionChecks).toBe(legacyChecks);
    for (const badId of [sectionIds[0], "unknown"]) {
      const parsed = researchEvidenceSchema.parse({ findings: [{ ...finding, sectionChecks: legacyChecks.map(check => ({ ...check })) }] }).findings;
      parsed[0].sectionChecks![1].sectionId = badId;
      expect(() => validateResearchSectionCoverage(parsed, source)).toThrow("every supplied section exactly once");
    }
  });
});

describe("compact nested claim wire normalization", () => {
  const fields = ["summary", "evidence", "contentAngle", "whyItMatters", "limitations"] as const;
  const checks = [{ profileId: "personal", fits: true, relevance: 27, reason: "A useful product leadership decision." },
    { profileId: "company", fits: false, relevance: 0, reason: "Outside the company adoption remit." }];
  const scored = { ...finding, claimBasis: "reasoned_position", profileChecks: checks, qualityComponents: { sourceSupport: 22, usefulDecision: 25, scopeHonesty: 14 } };
  function compact(idea: typeof scored) {
    const { summary, evidence, contentAngle, whyItMatters, limitations, ...rest } = idea;
    return { ...rest, claim: { summary, evidence, contentAngle, whyItMatters, limitations } };
  }
  function payload(array: boolean) {
    const primary = compact(scored), { itemId: _id, ...keyed } = primary;
    const { itemId: _extraId, ...extra } = compact({ ...scored, familyKey: "second-decision" });
    return { findings: array ? [{ ...primary, additionalIdeas: [extra], sectionChecks: [] }]
      : { study: { ...keyed, additionalIdeas: [extra], sectionChecks: [] } } };
  }
  it.each([true, false])("normalizes primary/additional nested claims without changing flat stored fields (array=%s)", array => {
    const input = payload(array), original = JSON.stringify(input);
    const normalized = researchEvidenceSchema.parse(input).findings;
    const { itemId: _id, ...flatExtra } = scored;
    expect(normalized).toEqual(researchEvidenceSchema.parse({ findings: [{ ...scored,
      additionalIdeas: [{ ...flatExtra, familyKey: "second-decision" }], sectionChecks: [],
    }] }).findings);
    expect(normalized[0]).toMatchObject({ ...finding, score: 88, chosenProfileId: "personal", sectionChecks: [] });
    expect(normalized[0]).not.toHaveProperty("claim");
    expect(normalized[0].additionalIdeas![0]).toMatchObject({ summary: finding.summary, evidence: quote, score: 88, chosenProfileId: "personal", familyKey: "second-decision" });
    expect(normalized[0].additionalIdeas![0]).not.toHaveProperty("claim");
    expect(validateResearchEvidenceProfiles(normalized, ["personal", "company"])).toBe(normalized);
    expect(validateResearchEvidence(normalized, items)).toHaveLength(2);
    expect(JSON.stringify(input)).toBe(original);
  });
  it.each(fields)("rejects missing nested %s and collisions even when the flat value agrees", field => {
    for (const additional of [false, true]) {
      const primary = compact(scored), { itemId: _id, ...extraBase } = primary;
      const extra = { ...extraBase, familyKey: "second-decision" };
      const target: Record<string, unknown> = additional ? extra : primary;
      const originalClaim = { ...primary.claim }, claim = { ...originalClaim };
      delete (claim as Record<string, unknown>)[field];
      target.claim = claim;
      expect(researchEvidenceSchema.safeParse({ findings: [{ ...primary, ...(additional ? { additionalIdeas: [extra] } : {}) }] }).success).toBe(false);
      target.claim = originalClaim;
      target[field] = scored[field];
      expect(researchEvidenceSchema.safeParse({ findings: [{ ...primary, ...(additional ? { additionalIdeas: [extra] } : {}) }] }).success).toBe(false);
    }
  });
  it.each([null, [], "invalid", { summary: "Only one field" }, { ...compact(scored).claim, hidden: "unknown" },
    { ...compact(scored).claim, evidence: "x".repeat(601) }])("rejects malformed or unknown nested claim fields %j", claim => {
    const primary = compact(scored), { itemId: _id, ...extraBase } = primary;
    const extra = { ...extraBase, familyKey: "second-decision" };
    expect(researchEvidenceSchema.safeParse({ findings: { study: { ...extraBase, claim } } }).success).toBe(false);
    expect(researchEvidenceSchema.safeParse({ findings: { study: { ...extraBase, additionalIdeas: [{ ...extra, claim }] } } }).success).toBe(false);
  });
  it("shares a five-field claim definition and keeps source parents at seven fields with exact source keys and no unions", () => {
    const ids = Array.from({ length: 6 }, (_, index) => `source-${index}`);
    const wire = evidenceJsonSchemaForItems(ids, ["personal", "company"], { sectionCoverage: true });
    expect(wire.$defs.claim.required).toEqual(fields);
    expect(wire.$defs.claim.additionalProperties).toBe(false);
    expect(Object.keys(wire.$defs.sourceAssessment.properties)).toEqual(["claimBasis", "profileChecks", "claim", "familyKey", "qualityComponents", "additionalIdeas", "sectionChecks"]);
    expect(wire.$defs.sourceAssessment.required).toHaveLength(7);
    expect(wire.$defs.sourceAssessment.properties.claim).toEqual({ $ref: "#/$defs/claim" });
    expect(wire.$defs.idea.properties.claim).toEqual({ $ref: "#/$defs/claim" });
    expect(Object.keys(wire.$defs.idea.properties)).toHaveLength(5);
    expect(wire.properties.findings.required).toEqual(ids);
    expect(JSON.stringify(anthropicResearchSchema(wire))).not.toMatch(/anyOf|oneOf|"null"/);
  });
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

describe("explicit Anthropic review transport", () => {
  it("selects tool submission only for the exact bound marker, passing the actual model to its parser", async () => {
    const previousKey=process.env.ANTHROPIC_API_KEY;process.env.ANTHROPIC_API_KEY="test-review-transport";
    const context={teamId:"transport-team",runId:"transport-run",stage:"research" as const,operation:"replay_review_evidence"};
    const value={findings:{source:{wholeSource:{bounded:true},groups:{}}}},fetcher=vi.spyOn(globalThis,"fetch");
    try{
      for(const model of ["claude-haiku-5-5","claude-sonnet-5-5"]){
        fetcher.mockResolvedValueOnce(Response.json({model,stop_reason:"tool_use",content:[...(model==="claude-sonnet-5-5"?[{type:"thinking",thinking:"Private transport reasoning"},{type:"text",text:"Submit bounded data"}]:[]),{type:"tool_use",name:"submit_research",input:value}]}));
        expect((await callResearchModel("Submit the assessment once.",{items:[{id:"source",reviewTransport:"anthropic-tool-v1"}]},{type:"object"},16000,context,model)).value).toEqual(value);
        const body=JSON.parse(String(fetcher.mock.calls.at(-1)![1]?.body));expect(body).not.toHaveProperty("output_config");expect(body.tools).toHaveLength(1);expect(body.tools[0]).not.toHaveProperty("strict");
        expect(body.tool_choice.type).toBe(model==="claude-sonnet-5-5"?"auto":"tool");
        for(const marker of [undefined,"anthropic-tool-v2"]){
          fetcher.mockResolvedValueOnce(Response.json({model,stop_reason:"end_turn",content:[{type:"text",text:JSON.stringify(value)}]}));
          expect((await callResearchModel("Review.",{items:[{id:"source",...(marker?{reviewTransport:marker}:{})}]},{type:"object"},16000,context,model)).value).toEqual(value);
          const normal=JSON.parse(String(fetcher.mock.calls.at(-1)![1]?.body));expect(normal).toHaveProperty("output_config.format.type","json_schema");expect(normal).not.toHaveProperty("tools");
        }
      }
      expect(fetcher).toHaveBeenCalledTimes(6);
    }finally{fetcher.mockRestore();if(previousKey===undefined)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=previousKey;}
  });
});
