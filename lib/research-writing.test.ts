import { describe, expect, it } from "vitest";
import { runResearchDraftWriting, validateResearchDraftContent } from "./research-drafts";
import type { ResearchPriorPost } from "./research-novelty";
import {
  RESEARCH_DRAFT_INSTRUCTIONS, RESEARCH_EDITORIAL_REVIEW_INSTRUCTIONS,
  RESEARCH_WRITING_STYLES, researchEditorialReviewSchema, selectResearchWritingContracts,
} from "./research-writing";

const source = {
  url: "https://example.com/onboarding",
  content: "The team moved account setup after the first preview. Customer interviews showed that users needed to inspect the output before inviting colleagues. No retention change was measured.",
};
const destinations = [{ id: "personal-li", platform: "linkedin", groupName: "personal" }];
const editorial = {
  writingStyle: "b2b-growth-mechanism", styleRationale: "The observed setup choice changes the burden before users can inspect value.",
  sourceFact: "The team moved account setup until after the first preview.",
  evidenceQuote: "The team moved account setup after the first preview.",
  alpha: "Test whether setup is useful before the user has seen a concrete output worth sharing.",
  readerDecision: "Inspect the first-preview path before requiring users to invite colleagues.",
  boundary: "The account provides no measured retention change.",
};
const generated = () => ({
  ready: true, reason: "A concrete product decision supports a bounded mechanism.", editorial,
  targets: [{ channelId: "personal-li", platform: "linkedin", content: `The team's preview came before account setup. That gives users something concrete to inspect before asking colleagues to join. Test whether your invitation gate asks for commitment before users have an output worth sharing. Source: ${source.url}`, thread: [], supportQuote: editorial.evidenceQuote, redditTitle: null, subreddit: null }],
});
const input = { source, destinations, current: null, identityGroups: [{ id: "personal", name: "Personal", channelIds: ["personal-li"] }] };
const ready = { verdict: "ready", reason: "The actual copy explains a bounded decision from concrete evidence.", issues: [] };
const weak = { verdict: "needs_revision", reason: "The draft's ending loses the specific decision supported by the case.", issues: [{ code: "missing_alpha", channelId: "personal-li", detail: "Replace the generic conclusion with a criterion for deciding when setup belongs." }] };
const priorProto: ResearchPriorPost = {
  draftId: "earlier-proto", runId: "earlier-run", createdAt: "2026-10-25T00:00:00Z", status: "draft",
  familyKey: "reddit-ai-prototyping-real-data", title: "Reddit Proto uses realistic signed-in data",
  sourceUrl: "https://original.example/proto", sourcePublishedAt: "2026-10-24T00:00:00Z",
  identityGroupIds: ["group:personal"], channelIds: ["personal-li"],
  sourceFact: "Reddit Proto uses realistic signed-in data and reviews a PRD before engineering handoff.",
  alpha: null, readerDecision: null, findingContentAngle: "Inspect engineering readiness.",
  copyExcerpt: "A realistic prototype is not a shipping plan. Review the PRD and engineering-readiness checkpoints before handing off the signed-in prototype.", legacyWithoutEditorial: true,
};
const protoSource = {
  url: "https://another.example/chat-prd-proto",
  content: "Reddit Proto uses realistic signed-in data. Review the PRD before engineering handoff. Lock navigation to one flow while testing a hypothesis; enable free exploration when collecting exploratory feedback. Each annotation includes the element, code location and intent so editing instructions remain tied to the interface.",
};
function protoDraft(point: string) {
  return { ...generated(), editorial: { ...editorial, writingStyle: "b2b-practitioner-teardown", sourceFact: "The prototype supports separate hypothesis-test and exploratory-feedback modes.", evidenceQuote: "Review the PRD before engineering handoff.", alpha: point, readerDecision: point }, targets: [{ ...generated().targets[0], content: `${point} Source: ${protoSource.url}`, supportQuote: "Review the PRD before engineering handoff." }] };
}

describe("evidence-led B2B writing contracts", () => {
  it("retains seven distinct reasoning jobs and prevents invented single-source synthesis", () => {
    expect(RESEARCH_WRITING_STYLES).toHaveLength(7);
    expect(selectResearchWritingContracts(1).map(value => value.writingStyle)).not.toContain("b2b-research-insight");
    expect(selectResearchWritingContracts(2).map(value => value.writingStyle)).toEqual([...RESEARCH_WRITING_STYLES]);
    expect(RESEARCH_DRAFT_INSTRUCTIONS).toContain("not exist only in metadata");
    expect(RESEARCH_EDITORIAL_REVIEW_INSTRUCTIONS).toContain("ledger as claims to verify, not proof");
  });
  it("requires evidence-grounded metadata for new production drafts while accepting legacy stored content", () => {
    const legacy = { ...generated(), editorial: undefined };
    expect(validateResearchDraftContent(legacy, destinations, source)?.targets).toHaveLength(1);
    expect(() => validateResearchDraftContent(legacy, destinations, source, false, true)).toThrow("supported alpha");
    const invented = { ...generated(), editorial: { ...editorial, evidenceQuote: "A fabricated result that appears nowhere in this article." } };
    expect(() => validateResearchDraftContent(invented, destinations, source, false, true)).toThrow("Editorial evidence quote");
  });
  it("keeps the style and alpha private while attaching an independent review to accepted content", async () => {
    const calls: string[] = [];
    const result = await runResearchDraftWriting(input, async (instructions, request, _schema, _maxTokens, operation) => {
      calls.push(operation);
      if (operation === "draft") {
        expect(instructions).toBe(RESEARCH_DRAFT_INSTRUCTIONS);
        expect(request).toMatchObject({ allowedWritingStyles: selectResearchWritingContracts(1) });
        return generated();
      }
      expect(instructions).toBe(RESEARCH_EDITORIAL_REVIEW_INSTRUCTIONS);
      return ready;
    });
    expect(calls).toEqual(["draft", "editorial_review"]);
    expect(result.content?.editorial).toEqual(editorial);
    expect(result.content?.editorialReview?.verdict).toBe("ready");
    expect(result.content?.targets[0].content).not.toContain("b2b-growth-mechanism");
  });
  it("permits synthesis only with distinct inspected bodies and credits every supporting source", async () => {
    const secondary = { url: "https://example.com/interviews", content: "Interviewees wanted a concrete preview to discuss before inviting a colleague into their account." };
    const combinedSource = { ...source, supportingSources: [secondary] };
    const value = { ...generated(), editorial: { ...editorial, writingStyle: "b2b-research-insight" }, targets: [{ ...generated().targets[0], content: `${generated().targets[0].content} ${secondary.url}` }] };
    const result = await runResearchDraftWriting({ ...input, source: combinedSource }, async (_instructions, request, _schema, _maxTokens, operation) => {
      if (operation === "draft") {
        expect(request).toMatchObject({ allowedWritingStyles: selectResearchWritingContracts(2) });
        return value;
      }
      return ready;
    });
    expect(result.content?.editorial?.writingStyle).toBe("b2b-research-insight");
    expect(() => validateResearchDraftContent({ ...value, targets: generated().targets }, destinations, combinedSource, false, true)).toThrow("credit");
    await expect(runResearchDraftWriting(input, async () => value)).rejects.toThrow("unsupported external link");
    const mirrored = { ...source, supportingSources: [{ ...secondary, content: source.content }] };
    await expect(runResearchDraftWriting({ ...input, source: mirrored }, async () => value)).rejects.toThrow("requires additional inspected sources");
  });
  it("rewrites a weak draft once with the same evidence and requires the second review to pass", async () => {
    const calls: string[] = [];
    const result = await runResearchDraftWriting(input, async (_instructions, request, _schema, _maxTokens, operation) => {
      calls.push(operation);
      if (operation === "editorial_review") return weak;
      if (operation === "editorial_review_after_rewrite") return ready;
      if (operation === "editorial_quality_rewrite") expect(request).toMatchObject({ source, editorialReview: weak });
      return generated();
    });
    expect(calls).toEqual(["draft", "editorial_review", "editorial_quality_rewrite", "editorial_review_after_rewrite"]);
    expect(result.content?.editorialReview?.verdict).toBe("ready");
  });
  it("declines a persistently generic draft without repeated quality rewrites", async () => {
    const calls: string[] = [];
    const result = await runResearchDraftWriting(input, async (_instructions, _request, _schema, _maxTokens, operation) => {
      calls.push(operation);
      return operation.startsWith("editorial_review") ? weak : generated();
    });
    expect(calls).toHaveLength(4);
    expect(result.content).toBeNull();
    expect(result.skipReason).toContain("missing_alpha");
  });
  it("repairs an invalid quality rewrite once and reviews the corrected copy before acceptance", async () => {
    const calls: string[] = [];
    const result = await runResearchDraftWriting(input, async (_instructions, request, _schema, _maxTokens, operation) => {
      calls.push(operation);
      if (operation === "editorial_review") return weak;
      if (operation === "editorial_review_after_rewrite") return ready;
      if (operation === "editorial_quality_rewrite") return { ...generated(), targets: [{ ...generated().targets[0], content: "a".repeat(3001) }] };
      if (operation === "editorial_quality_rewrite_repair") expect(request).toMatchObject({ source, validationError: expect.stringContaining("publication limits") });
      return generated();
    });
    expect(calls).toEqual(["draft", "editorial_review", "editorial_quality_rewrite", "editorial_quality_rewrite_repair", "editorial_review_after_rewrite"]);
    expect(result.content?.editorialReview?.verdict).toBe("ready");
  });
  it("does not repair an evidence gap by inventing source facts", async () => {
    const calls: string[] = [];
    const result = await runResearchDraftWriting(input, async (_instructions, _request, _schema, _maxTokens, operation) => {
      calls.push(operation);
      return operation === "draft" ? generated() : { ...weak, verdict: "insufficient_evidence", issues: [{ code: "unsupported_claim", channelId: "personal-li", detail: "The proposed retention result is not present in the supplied evidence." }] };
    });
    expect(calls).toEqual(["draft", "editorial_review"]);
    expect(result.content).toBeNull();
    expect(result.skipReason).toContain("retention");
  });
  it("does not let a quality rewrite switch identity or remove an eligible profile", async () => {
    await expect(runResearchDraftWriting(input, async (_instructions, _request, _schema, _maxTokens, operation) => {
      if (operation === "editorial_review") return weak;
      if (operation.startsWith("editorial_quality_rewrite")) return { ...generated(), targets: [{ ...generated().targets[0], channelId: "company-li" }] };
      return generated();
    })).rejects.toThrow("unknown");
  });
  it("refuses an editorial pass that still lists unresolved problems", () => {
    expect(researchEditorialReviewSchema.safeParse({ ...weak, verdict: "ready" }).success).toBe(false);
    expect(researchEditorialReviewSchema.safeParse({ ...ready, verdict: "needs_revision" }).success).toBe(false);
  });
  it("gives the existing writer and editor cross-family legacy history so a repackaged handoff decision can decline", async () => {
    const calls: string[] = [];
    const result = await runResearchDraftWriting({ ...input, source: protoSource, priorPosts: [priorProto] }, async (instructions, request, _schema, _tokens, operation) => {
      calls.push(operation);
      expect(request).toMatchObject({ priorPosts: [{ draftId: "earlier-proto", legacyWithoutEditorial: true, copyExcerpt: expect.stringContaining("Review the PRD") }] });
      if (operation === "draft") {
        expect(instructions).toContain("reader/problem, action or test, source-supported evidence or mechanism, scope");
        return protoDraft("Review the specification before engineering ships the realistic prototype.");
      }
      expect(instructions).toContain("Reject repeated_decision");
      return { verdict: "insufficient_evidence", reason: "The proposed specification-before-shipping point repeats earlier-proto's reviewed-PRD handoff decision.", issues: [{ code: "repeated_decision", channelId: "personal-li", detail: "earlier-proto already asks for a reviewed PRD and engineering-readiness checkpoint; a new source and hook add no different decision." }] };
    });
    expect(calls).toEqual(["draft", "editorial_review"]);
    expect(result.content).toBeNull();
    expect(result.skipReason).toContain("repeated_decision");
  });
  it.each([
    "Lock one navigation flow when testing a hypothesis, then open exploration for feedback; choose the review mode before interpreting the prototype session.",
    "Keep the selected element, code location and editing intent together in an annotation; choose this editing interface when a visual comment could otherwise lose its implementation target.",
  ])("lets the existing editor accept a distinct source-supported decision about the same event: %s", async point => {
    const calls: string[] = [];
    const result = await runResearchDraftWriting({ ...input, source: protoSource, priorPosts: [priorProto] }, async (instructions, request, _schema, _tokens, operation) => {
      calls.push(operation);
      expect(request).toMatchObject({ priorPosts: [{ draftId: "earlier-proto" }] });
      if (operation === "draft") return protoDraft(point);
      expect(instructions).toContain("allow a materially different source-supported decision");
      return ready;
    });
    expect(calls).toEqual(["draft", "editorial_review"]);
    expect(result.content?.targets[0].content).toContain(point);
  });
  it("removes other-account comparisons from editorial review and a quality rewrite", async () => {
    const companyHistory = { ...priorProto, draftId: "company-proto", identityGroupIds: ["group:company"], channelIds: ["company-li"] };
    const calls: string[] = [];
    const result = await runResearchDraftWriting({ ...input, source: protoSource, priorPosts: [companyHistory] }, async (instructions, request, _schema, _tokens, operation) => {
      calls.push(operation);
      if (operation === "draft") {
        expect(request).toMatchObject({ priorPosts: [{ draftId: "company-proto" }] });
        expect(instructions).toContain("Prior posts tagged only to another identity cannot veto this account");
      } else expect(request).toMatchObject({ priorPosts: [] });
      if (operation === "editorial_review") return weak;
      if (operation === "editorial_review_after_rewrite") return ready;
      return protoDraft("Use a reviewed PRD before the engineering handoff rather than treating visual fidelity as readiness.");
    });
    expect(calls).toEqual(["draft", "editorial_review", "editorial_quality_rewrite", "editorial_review_after_rewrite"]);
    expect(result.content).not.toBeNull();
  });
});
