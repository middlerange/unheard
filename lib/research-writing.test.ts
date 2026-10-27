import { describe, expect, it } from "vitest";
import { runResearchDraftWriting, validateResearchDraftContent } from "./research-drafts";
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
});
