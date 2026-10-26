import { describe, expect, it } from "vitest";
import { validateResearchDraftContent } from "./research-drafts";
const source = {
  url: "https://example.com/original",
  content:
    "A practitioner found onboarding friction through customer interviews and support conversations.",
};
const destinations = [
  { id: "linkedin", platform: "linkedin", groupName: "brand-a" },
  { id: "x", platform: "twitter", groupName: "brand-a" },
];
function generated() {
  return {
    ready: true,
    reason: "Useful practitioner lesson",
    targets: destinations.map((destination) => ({
      channelId: destination.id,
      platform: destination.platform,
      content: `Start with customer interviews. Source: ${source.url}`,
      thread: [] as string[],
      supportQuote: "onboarding friction through customer interviews",
      redditTitle: null as string | null,
      subreddit: null as string | null,
    })),
  };
}
describe("research draft grounding and publication boundaries", () => {
  it("accepts quote wrappers only around an exact source excerpt", () => {
    const value = generated();
    value.targets[0].supportQuote = `“${value.targets[0].supportQuote}”`;
    value.targets[1].supportQuote = `"${value.targets[1].supportQuote}"`;
    expect(validateResearchDraftContent(value, destinations, source)?.targets).toHaveLength(2);
    value.targets[0].supportQuote = "“onboarding friction...support conversations”";
    expect(() => validateResearchDraftContent(value, destinations, source)).toThrow("not found in the source");
  });
  it("accepts grounded attributed copy only for the exact supplied destinations", () => {
    expect(
      validateResearchDraftContent(generated(), destinations, source)?.targets,
    ).toHaveLength(2);
    const fake = generated();
    fake.targets[0].channelId = "another-team-account";
    expect(() =>
      validateResearchDraftContent(fake, destinations, source),
    ).toThrow("unknown");
    fake.targets[0].channelId = "x";
    expect(() =>
      validateResearchDraftContent(fake, destinations, source),
    ).toThrow();
  });
  it("chooses one complete identity initially and preserves exact current destinations for edits", () => {
    const company = { id: "company", platform: "linkedin", groupName: "brand-b" };
    const profiles = [...destinations, company];
    expect(validateResearchDraftContent(generated(), profiles, source)?.targets).toHaveLength(2);
    const incomplete = generated();
    incomplete.targets = incomplete.targets.slice(0, 1);
    expect(() => validateResearchDraftContent(incomplete, profiles, source)).toThrow("every eligible profile");
    const mixed = generated();
    mixed.targets.push({ ...mixed.targets[0], channelId: company.id });
    expect(() => validateResearchDraftContent(mixed, profiles, source)).toThrow("cannot be mixed");
    expect(() => validateResearchDraftContent(incomplete, destinations, source, true)).toThrow("every selected destination");
  });
  it("supports multiple profiles on one platform and text on Facebook or Discord", () => {
    const profiles = [
      { id: "fb-a", platform: "facebook", groupName: "brand-a" },
      { id: "fb-b", platform: "facebook", groupName: "brand-a" },
      { id: "discord", platform: "discord", groupName: "brand-a" },
    ];
    const sample = generated().targets[0];
    const value = {
      ready: true,
      reason: "Fits these profiles",
      targets: profiles.map((profile) => ({
        ...sample,
        channelId: profile.id,
        platform: profile.platform,
      })),
    };
    expect(
      validateResearchDraftContent(value, profiles, source)?.targets,
    ).toHaveLength(3);
    value.targets[2].content = "a".repeat(2001);
    expect(() => validateResearchDraftContent(value, profiles, source)).toThrow(
      "limits",
    );
  });
  it("permits Reddit only for an explicitly configured subreddit and a valid title", () => {
    const profiles = [
      {
        id: "reddit",
        platform: "reddit",
        systemPrompt: "Write product lessons for r/ProductManagement",
      },
    ];
    const value = {
      ready: true,
      reason: "Useful practitioner source",
      targets: [
        {
          ...generated().targets[0],
          channelId: "reddit",
          platform: "reddit",
          redditTitle: "Start with onboarding interviews",
          subreddit: "ProductManagement",
        },
      ],
    };
    expect(
      validateResearchDraftContent(value, profiles, source)?.targets[0],
    ).toMatchObject({
      redditTitle: "Start with onboarding interviews",
      subreddit: "ProductManagement",
      redditPostType: "self",
    });
    value.targets[0].subreddit = "unconfigured";
    expect(() => validateResearchDraftContent(value, profiles, source)).toThrow(
      "explicitly allowed",
    );
  });
  it("allows the model to return no post rather than forcing weak material", () => {
    expect(
      validateResearchDraftContent(
        { ready: false, reason: "Thin summary", targets: [] },
        destinations,
        source,
      ),
    ).toBeNull();
  });
  it("accepts a full source URL at the X weighted limit in both the main post and thread", () => {
    const longSource = { ...source, url: `https://example.com/${"original-source-path-".repeat(16)}` };
    const atLimit = `${"a".repeat(256)} ${longSource.url}`;
    const value = generated();
    value.targets = [value.targets[1]];
    value.targets[0].content = atLimit;
    value.targets[0].thread = [atLimit];
    expect(atLimit.length).toBeGreaterThan(280);
    expect(validateResearchDraftContent(value, destinations.filter(profile => profile.id === "x"), longSource)?.targets[0])
      .toMatchObject({ content: atLimit, thread: [atLimit] });

    value.targets[0].content = `${"a".repeat(257)} ${longSource.url}`;
    expect(() => validateResearchDraftContent(value, destinations.filter(profile => profile.id === "x"), longSource)).toThrow("main post has 281");
    value.targets[0].content = atLimit;
    value.targets[0].thread = [`${"a".repeat(257)} ${longSource.url}`];
    expect(() => validateResearchDraftContent(value, destinations.filter(profile => profile.id === "x"), longSource)).toThrow("thread post 1 has 281");
  });
  it("applies X Unicode weights to emoji sequences and CJK while retaining exact attribution", () => {
    const value = generated();
    value.targets = [value.targets[1]];
    const target = value.targets[0];
    target.content = `${"👩🏽‍💻".repeat(128)} ${source.url}`;
    target.thread = [`${"界".repeat(128)} ${source.url}`];
    expect(validateResearchDraftContent(value, destinations.filter(profile => profile.id === "x"), source)?.targets[0])
      .toMatchObject({ content: target.content, thread: target.thread });

    target.content = `${"👩🏽‍💻".repeat(128)}a ${source.url}`;
    expect(() => validateResearchDraftContent(value, destinations.filter(profile => profile.id === "x"), source)).toThrow("main post has 281");
    target.content = `${"界".repeat(128)} ${source.url}`;
    target.thread = [`${"界".repeat(128)}a ${source.url}`];
    expect(() => validateResearchDraftContent(value, destinations.filter(profile => profile.id === "x"), source)).toThrow("thread post 1 has 281");
  });
  it("refuses invented support quotes, omitted credits, unsupported links, and overlong posts", () => {
    const missing = generated();
    missing.targets[0].supportQuote =
      "An invented research finding entirely absent from the source.";
    expect(() =>
      validateResearchDraftContent(missing, destinations, source),
    ).toThrow("support quote");
    const noCredit = generated();
    noCredit.targets[0].content = "An unattributed claim.";
    expect(() =>
      validateResearchDraftContent(noCredit, destinations, source),
    ).toThrow("credit");
    const link = generated();
    link.targets[0].content += " https://malicious.example";
    expect(() =>
      validateResearchDraftContent(link, destinations, source),
    ).toThrow("unsupported");
    const long = generated();
    long.targets[1].content = "a".repeat(281);
    expect(() =>
      validateResearchDraftContent(long, destinations, source),
    ).toThrow("limits");
    const thread = generated();
    thread.targets[0].thread = ["Unsupported LinkedIn thread"];
    expect(() =>
      validateResearchDraftContent(thread, destinations, source),
    ).toThrow("limits");
  });
});
