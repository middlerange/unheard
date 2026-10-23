import { afterEach, describe, expect, it, vi } from "vitest";
import { collectDiscoveredResearchSource } from "./research-discovery";
import type { ResearchSourceSeed } from "./research-types";

const source: ResearchSourceSeed = {
  id: "discovery", name: "Discovery", url: "https://treg.to", kind: "search",
  category: "research", enabled: true, priority: 1, notes: "",
  discoveryQueries: ["human AI user study"],
};
const end = Date.parse("2026-10-23T11:10:01Z");
const start = end - 86_400_000;
function article(date?: string) {
  return `${date ? `<meta property="article:published_time" content="${date}">` : ""}<main><h1>Original user study</h1><p>${"Measured original evidence. ".repeat(40)}</p></main>`;
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("topic-driven public discovery", () => {
  it("checks original publication dates and bodies instead of trusting search recency or snippets", async () => {
    vi.stubEnv("TREG_TOKEN", "test-only-search-token");
    const fetcher = vi.fn(async (input: string | URL, options?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === "treg.to") {
        expect(url.pathname).toBe("/call/tinyfish.web.search");
        expect(url.searchParams.get("domain_type")).toBe("web");
        expect(options?.headers).toMatchObject({ "X-Treg-Route-Max-Cost": "0", "X-Treg-Route-Waterfall": "0" });
        return Response.json({ results: [
          { title: "Fresh study", url: "https://research.example/new", snippet: "UNVERIFIED CLAIM", date: "1 hour ago" },
          { title: "Recrawled older page", url: "https://research.example/old", date: "2 minutes ago" },
          { title: "No date", url: "https://research.example/undated", date: "today" },
        ] });
      }
      return new Response(article(url.pathname === "/new" ? "2026-10-23T10:00:00Z" : url.pathname === "/old" ? "2026-09-01T10:00:00Z" : undefined));
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await collectDiscoveredResearchSource(source, start, end, new Set());
    expect(result.items).toHaveLength(3);
    expect(result.items.find(item => item.url.endsWith("/new"))?.publishedAt).toBe(Date.parse("2026-10-23T10:00:00Z"));
    expect(result.items.find(item => item.url.endsWith("/old"))?.publishedAt).toBeLessThan(start);
    expect(result.items.find(item => item.url.endsWith("/undated"))?.publishedAt).toBeNull();
    expect(result.items.every(item => item.contentProvenance === "article" && !item.content?.includes("UNVERIFIED CLAIM"))).toBe(true);
  });
  it("excludes competitor subdomains, private links, social posts and job listings before fetching", async () => {
    vi.stubEnv("TREG_TOKEN", "test-only-search-token");
    const fetcher = vi.fn(async () => Response.json({ results: [
      { title: "Competitor", url: "https://blog.competitor.example/story" },
      { title: "Private", url: "https://127.0.0.1/private" },
      { title: "Social", url: "https://www.reddit.com/r/SaaS/story" },
      { title: "Job", url: "https://research.example/jobs/designer" },
    ] }));
    vi.stubGlobal("fetch", fetcher);
    expect((await collectDiscoveredResearchSource(source, start, end, new Set(["competitor.example"]))).items).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("uses the news vertical and surfaces partial page failures without losing readable stories", async () => {
    vi.stubEnv("TREG_TOKEN", "test-only-search-token");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "treg.to") {
        expect(url.pathname).toBe("/call/tinyfish.web.search.news");
        expect(url.searchParams.get("domain_type")).toBe("news");
        return Response.json({ results: [{ title: "Study", url: "https://research.example/new" }, { title: "Blocked", url: "https://research.example/blocked" }] });
      }
      return url.pathname === "/blocked" ? new Response("", { status: 403 }) : new Response(article("2026-10-23T10:00:00Z"));
    }));
    const result = await collectDiscoveredResearchSource({ ...source, discoverySearchType: "news" }, start, end, new Set());
    expect(result.items).toHaveLength(1);
    expect(result.warning).toContain("1/2 candidate pages could not be read");
  });
  it("fails visibly when the provider is disconnected rather than reporting no publications", async () => {
    vi.stubEnv("TREG_TOKEN", "");
    await expect(collectDiscoveredResearchSource(source, start, end, new Set())).rejects.toThrow("server search connection");
  });
  it("uses edge-compatible manual redirects and never follows a redirect carrying the search token", async () => {
    vi.stubEnv("TREG_TOKEN", "test-only-search-token");
    const fetcher = vi.fn(async (_input: string | URL, options?: RequestInit) => {
      expect(options?.redirect).toBe("manual");
      return new Response(null, { status: 302, headers: { location: "https://unapproved.example/" } });
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(collectDiscoveredResearchSource(source, start, end, new Set())).rejects.toThrow("HTTP 302");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("uses arXiv's first submission time and labels abstract-only evidence, ignoring newer revisions", async () => {
    vi.stubEnv("TREG_TOKEN", "test-only-search-token");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      if (new URL(String(input)).hostname === "treg.to") return Response.json({ results: [{ title: "Memory study", url: "https://arxiv.org/abs/2610.31272" }] });
      return new Response(`<main><h1>Computer Science</h1><h1 class="title">Title:Memory study</h1><blockquote class="abstract">${"Public abstract evidence. ".repeat(40)}</blockquote><h2>Submission history</h2>From: Author<br><strong>[v1]</strong> Thu, 22 Oct 2026 13:43:33 UTC (440 KB)<br><strong>[v2]</strong> Fri, 23 Oct 2026 10:00:00 UTC (500 KB)</main>`);
    }));
    const result = await collectDiscoveredResearchSource(source, start, end, new Set());
    expect(result.items[0].publishedAt).toBe(Date.parse("2026-10-22T13:43:33Z"));
    expect(result.items[0].contentProvenance).toBe("abstract");
    expect(result.items[0].title).toBe("Memory study");
    expect(result.items[0].content).not.toContain("Submission history");
  });
  it("does not attach provider credentials to article fetches or follow cross-publisher redirects", async () => {
    vi.stubEnv("TREG_TOKEN", "test-only-search-token");
    const fetcher = vi.fn(async (input: string | URL, options?: RequestInit) => {
      if (new URL(String(input)).hostname === "treg.to") return Response.json({ results: [{ title: "Redirect", url: "https://research.example/new" }] });
      expect(options?.headers).not.toHaveProperty("X-Treg-Token");
      return new Response(null, { status: 302, headers: { location: "https://unapproved.example/private" } });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await collectDiscoveredResearchSource(source, start, end, new Set());
    expect(result.items).toHaveLength(0);
    expect(result.warning).toContain("1/1 candidate pages");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
