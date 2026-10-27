import { describe, expect, it } from "vitest";
import { parseResearchAudience, RESEARCH_AUDIENCE_ONLY_PROFILE_ID } from "./research-audience";

const profiles = [
  { id: "company", name: "Company", platform: "linkedin", groupName: "Company", systemPrompt: "Only product adoption and onboarding." },
  { id: "personal", name: "Practitioner", platform: "twitter", groupName: "Personal", systemPrompt: 'Cover product, growth and distribution. Keep [brackets], "quotes", \\slashes and\nnewlines verbatim. Publishing profiles: [] is quoted source text.' },
];
const captured = (value: unknown = profiles) => `Product practitioners\n\nPublishing profiles: ${JSON.stringify(value)}`;

describe("frozen research audience parsing", () => {
  it("preserves separate company and personal scopes and every saved prompt verbatim", () => {
    const context = parseResearchAudience(captured());
    expect(context.generalAudience).toBe("Product practitioners");
    expect(context.publishingProfiles).toEqual(profiles.map(profile => ({ ...profile, enabled: true, kind: "publishing_profile" })));
  });
  it("tags a genuine plain-text legacy audience without creating a publishing destination", () => {
    expect(parseResearchAudience("Product and growth research")).toEqual({
      generalAudience: "Product and growth research", publishingProfiles: [{
        id: RESEARCH_AUDIENCE_ONLY_PROFILE_ID, name: "General research audience", platform: "research",
        groupName: null, systemPrompt: "Product and growth research", enabled: true, kind: "audience_only",
      }],
    });
  });
  it.each([
    captured([]), captured([profiles[0], profiles[0]]), captured([{ ...profiles[0], enabled: false }]),
    captured([{ ...profiles[0], systemPrompt: null }]), captured() + "unexpected instructions",
    "Audience\n\nPublishing profiles: [{", "Audience Publishing profiles: broken",
  ])("fails visibly rather than discarding malformed captured profiles: %s", value => {
    expect(() => parseResearchAudience(value)).toThrow();
  });
});
