import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDiscoveredResearchArticle } from "./research-discovery";
import { fetchPewResearchArticle, hasUsablePewResearchBody, pewResearchBodyText } from "./research-pew";
import type { ResearchSourceSeed } from "./research-types";

const source: ResearchSourceSeed = {
  id: "pew-ai-original-research", name: "Pew AI research", kind: "web", category: "research", enabled: true, priority: 1,
  url: "https://www.pewresearch.org/topic/internet-technology/emerging-technology/artificial-intelligence/",
  articlePathPrefixes: ["/short-reads/", "/internet/", "/data-labs/"], notes: "",
};
const original = "https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results";
const end = Date.parse("2026-10-27T09:00:00Z");
function published(overrides: Record<string, unknown> = {}) {
  return {
    id: 270454, status: "publish", type: "short-read", categories: [299, 305], link: `${original}/`,
    date_gmt: "2025-07-22T13:54:17", modified_gmt: "2026-10-26T20:00:00",
    title: { rendered: "A public research account" },
    content: { protected: false, rendered: "<p>The report describes how participants used the interface and explains how the researchers collected their observations.</p>" },
    ...overrides,
  };
}
afterEach(() => vi.unstubAllGlobals());

describe("scoped Pew publisher JSON", () => {
  it("hydrates an existing canonical target using public exact-slug JSON and its original UTC date", async () => {
    const fetcher = vi.fn(async (input: string | URL, options?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://www.pewresearch.org");
      expect(url.pathname).toBe("/wp-json/wp/v2/short-read");
      expect(url.searchParams.get("categories")).toBe("299");
      expect(url.searchParams.get("slug")).toBe("google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results");
      expect(options?.headers).toMatchObject({ "User-Agent": "ContentHubResearch/1.0" });
      return Response.json([published()]);
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await fetchDiscoveredResearchArticle(source, { url: original }, end);
    expect(result.url).toBe(original);
    expect(result.publishedAt).toBe(Date.parse("2025-07-22T13:54:17Z"));
    expect(result.content).toContain("researchers collected their observations");
    expect(result.content!.length).toBeLessThan(500);
    expect(result.contentProvenance).toBe("article");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retains late narrative and visible table evidence from the complete public JSON body", async () => {
    const prefix = "Earlier survey context and sampling limitations. ".repeat(1000).trim();
    const late = "The final comparison distinguishes the observed group from the reference population.";
    const rendered = `<p>${prefix}</p><p>${late}</p><table><tr><td>Final cohort</td><td>73%</td></tr></table>`;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([published({ content: { protected: false, rendered } })])));
    const result = await fetchPewResearchArticle(source, original, end);
    expect(result.content).toBe(`${prefix}\n${late}\nFinal cohort 73%`);
    expect(result.content!.indexOf(late)).toBeGreaterThan(24_000); expect(result.excerpt).toBe(result.content!.slice(0, 1600));
    expect(result.publishedAt).toBe(Date.parse("2025-07-22T13:54:17Z")); expect(result.contentProvenance).toBe("article");
  });
  it("uses the advertised posts collection for scoped report paths without expanding discovery", async () => {
    const url = "https://www.pewresearch.org/data-labs/2026/09/30/a-public-report";
    const fetcher = vi.fn(async (input: string | URL) => {
      expect(new URL(String(input)).pathname).toBe("/wp-json/wp/v2/posts");
      return Response.json([published({ link: `${url}/`, type: "post", date_gmt: "2026-09-30T17:55:17" })]);
    });
    vi.stubGlobal("fetch", fetcher);
    expect((await fetchDiscoveredResearchArticle(source, { url }, end)).url).toBe(url);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no matching record", []],
    ["wrong canonical article", [published({ link: "https://www.pewresearch.org/short-reads/2025/07/22/another-article" })]],
    ["external canonical article", [published({ link: "https://example.com/the-study" })]],
    ["duplicate canonical records", [published(), published({ id: 999 })]],
    ["private record", [published({ status: "private" })]],
    ["wrong post type", [published({ type: "post" })]],
    ["wrong category", [published({ categories: [305] })]],
    ["protected body", [published({ content: { protected: true, rendered: "<p>Do not use protected text.</p>" } })]],
    ["empty body", [published({ content: { protected: false, rendered: "" } })]],
    ["missing original date", [published({ date_gmt: null })]],
    ["invalid original date", [published({ date_gmt: "2025-02-31T13:54:17" })]],
    ["future original date", [published({ date_gmt: "2027-07-22T13:54:17" })]],
  ])("rejects %s instead of storing an empty or unrelated success", async (_label, records) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(records)));
    await expect(fetchPewResearchArticle(source, original, end)).rejects.toThrow("Pew JSON");
  });

  it.each([
    "https://evil.pewresearch.org/short-reads/2025/07/22/the-study",
    "https://example.com/short-reads/2025/07/22/the-study",
    "https://www.pewresearch.org/politics/2025/07/22/the-study",
    "https://www.pewresearch.org/short-reads/2025/07/22/encoded%2fpath",
  ])("rejects out-of-scope targets before network access: %s", async url => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(fetchPewResearchArticle(source, url, end)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not activate for another registered source", async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      expect(String(input)).toBe(original);
      return new Response('<main><h1>Other source account</h1><p>An ordinary HTML reader still works.</p></main>');
    });
    vi.stubGlobal("fetch", fetcher);
    await fetchDiscoveredResearchArticle({ ...source, id: "another-source" }, { url: original }, end);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retains a visible transport failure and does not retry HTML or substitute cached text", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 403 })); vi.stubGlobal("fetch", fetcher);
    await expect(fetchPewResearchArticle(source, original, end)).rejects.toThrow("HTTP 403");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("Pew body evidence rather than sharing metadata", () => {
  const title = "Men Are Experiencing More Job Growth Than Women in AI-Exposed Occupations";
  const metadataOnly = `Short Reads | October 22, 2026 ${title} X Threads WhatsApp Facebook LinkedIn <li data-wp-context="{"title":"${title}","description":"A headline description that is not a full study body.","platform":"whatsapp"}" data-wp-interactive="core/social-links"> WhatsApp Nicole Smith is a senior researcher focusing on social and demographic trends research at Pew Research Center .`;
  it("rejects the observed share-widget/headline/author-bio failure even when metadata exceeds the old size threshold", () => {
    const padded = metadataOnly.replace('data-wp-interactive=', `data-unused="${"not source text ".repeat(40)}" data-wp-interactive=`);
    expect(padded.length).toBeGreaterThan(778);
    expect(hasUsablePewResearchBody(padded, title)).toBe(false);
  });
  it("keeps legitimate narrative and numeric table text without requiring an outcome claim or minimum body length", () => {
    const raw = '<p>The research team describes its sampling decisions and the limits of this comparison. The interval is 3 &lt; x &lt; 5.</p><table><tr><th>Group</th><th>Count</th></tr><tr><td>Participants</td><td>900</td></tr></table>';
    const body = pewResearchBodyText(raw, "Research methods");
    expect(body).toContain("sampling decisions");
    expect(body).toContain("Participants 900");
    expect(body).toContain("3 < x < 5");
    expect(body.length).toBeLessThan(500);
    expect(hasUsablePewResearchBody(body, "Research methods")).toBe(true);
  });
  it("queues cached narrative mixed with serialized chart attributes for clean rehydration", () => {
    const raw = 'The researchers asked election-related questions and reviewed the answers. <div data-wp-init---chart="callbacks.init" data-wp-context="{&quot;labels&quot;:[&quot;Answered&quot;],&quot;values&quot;:[64]}"><table><tr><td>Answered</td><td>64%</td></tr></table></div>';
    expect(hasUsablePewResearchBody(raw, "Election questions")).toBe(false);
    const cleaned = pewResearchBodyText(raw, "Election questions");
    expect(cleaned).toContain("reviewed the answers");
    expect(cleaned).toContain("Answered 64%");
    expect(hasUsablePewResearchBody(cleaned, "Election questions")).toBe(true);
  });
  it("strips serialized attributes before entity decoding without losing the chart's visible values", () => {
    const body = pewResearchBodyText('<div data-wp-context="{&quot;description&quot;:&quot;This isn\u0027t source prose.&quot;}"><p>Observed links were compared across visits.</p><table><tr><td>With summary</td><td>8%</td></tr></table></div>', "Research");
    expect(body).not.toContain("description");
    expect(body).not.toContain("source prose");
    expect(body).toContain("Observed links were compared");
    expect(body).toContain("With summary 8%");
  });
});
