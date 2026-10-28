import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectDiscoveredResearchSource, fetchDiscoveredResearchArticle } from "./research-discovery";
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
beforeEach(() => vi.stubEnv("TREG_TOKEN", ""));
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
  it("discovers linked HN signals without credentials while preserving original article dates", async () => {
    vi.stubEnv("TREG_TOKEN", "");
    const fetcher = vi.fn(async (input: string | URL, options?: RequestInit) => {
      const url = new URL(String(input));
      expect(options?.headers).not.toHaveProperty("X-Treg-Token");
      if (url.hostname === "hn.algolia.com") {
        expect(url.pathname).toBe("/api/v1/search_by_date");
        expect(url.searchParams.get("tags")).toBe("story");
        expect(url.searchParams.get("numericFilters")).toContain(String(Math.floor(start / 1000)));
        return Response.json({ hits: [
          { title: "New launch", url: "https://research.example/new", created_at_i: end / 1000 },
          { title: "Old essay newly submitted", url: "https://research.example/old", created_at_i: end / 1000 },
          { title: "Undated", url: "https://research.example/undated" },
          { title: "Private", url: "https://127.0.0.1/private" },
          { title: "Social", url: "https://www.linkedin.com/posts/example" },
          { title: "Ask HN without an external source", url: null },
        ] });
      }
      return new Response(article(url.pathname === "/new" ? "2026-10-23T10:00:00Z" : url.pathname === "/old" ? "2026-09-01T10:00:00Z" : undefined));
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await collectDiscoveredResearchSource({ ...source, discoveryProvider: "hackernews" }, start, end, new Set());
    expect(result.items).toHaveLength(3);
    expect(result.items.find(item => item.url.endsWith("/new"))?.publishedAt).toBeGreaterThanOrEqual(start);
    expect(result.items.find(item => item.url.endsWith("/old"))?.publishedAt).toBeLessThan(start);
    expect(result.items.find(item => item.url.endsWith("/undated"))?.publishedAt).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("uses every configured query and returned hit without a candidate-page quota", async () => {
    vi.stubEnv("TREG_TOKEN", "test-only-search-token");
    const queries = ["first", "second", "third", "fourth"];
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "treg.to") return Response.json({ results: Array.from({ length: 20 }, (_, index) => ({ title: `Original ${index}`, url: `https://research.example/${url.searchParams.get("query")}-${index}` })) });
      return new Response(article("2026-10-23T10:00:00Z"));
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await collectDiscoveredResearchSource({ ...source, discoveryQueries: queries }, start, end, new Set());
    expect(result.items).toHaveLength(80);
    expect(fetcher).toHaveBeenCalledTimes(84);
    expect(result.coverage).toMatchObject({ queries: 4, resultPages: 4, receivedHits: 80, candidatePages: 80, exhaustive: false });
    expect(result.warning).toContain("not full-web coverage");
  });

  it("follows every HN result page and treats 100 hits as a page size rather than a total quota", async () => {
    const resultPages = 15;
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "hn.algolia.com") {
        expect(url.searchParams.get("hitsPerPage")).toBe("100");
        const page = Number(url.searchParams.get("page"));
        return Response.json({ page, nbPages: resultPages, nbHits: 150, exhaustiveNbHits: true, hits: Array.from({ length: 10 }, (_, index) => ({ title: `Original ${page}-${index}`, url: `https://research.example/${page}-${index}` })) });
      }
      return new Response(article("2026-10-23T10:00:00Z"));
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await collectDiscoveredResearchSource({ ...source, discoveryProvider: "hackernews" }, start, end, new Set());
    expect(result.items).toHaveLength(150);
    expect(result.coverage).toMatchObject({ resultPages: 15, receivedHits: 150, candidatePages: 150, exhaustive: true });
    expect(fetcher).toHaveBeenCalledTimes(165);
    expect(result.warning).toBeNull();
  });

  it("keeps readable HN results when a later search page fails and reports incomplete coverage", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "hn.algolia.com") return url.searchParams.get("page") === "0"
        ? Response.json({ page: 0, nbPages: 2, nbHits: 2, exhaustiveNbHits: true, hits: [{ title: "Original", url: "https://research.example/first" }] })
        : new Response("", { status: 429 });
      return new Response(article("2026-10-23T10:00:00Z"));
    }));
    const result = await collectDiscoveredResearchSource({ ...source, discoveryProvider: "hackernews" }, start, end, new Set());
    expect(result.items).toHaveLength(1);
    expect(result.coverage?.exhaustive).toBe(false);
    expect(result.warning).toContain("result page 2/2 failed");
    expect(result.warning).toContain("earlier results were retained");
  });

  it("partitions HN timestamp windows to recover hits beyond the provider's 1000-result ceiling", async () => {
    const lower = Math.floor(start / 1000), upper = lower + 9;
    const records = Array.from({ length: 1201 }, (_, index) => ({ title: `Original ${index}`, url: `https://research.example/original-${index}`, created_at_i: lower + index % 10 }));
    const windows: number[][] = [];
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe('hn.algolia.com');
      const bounds = url.searchParams.get('numericFilters')!.match(/created_at_i>=(\d+),created_at_i<=(\d+)/)!;
      const from = Number(bounds[1]), to = Number(bounds[2]), page = Number(url.searchParams.get('page'));
      windows.push([from, to]);
      const matches = records.filter(record => record.created_at_i >= from && record.created_at_i <= to);
      return Response.json({ page, nbPages: Math.min(10, Math.ceil(matches.length / 100)), nbHits: matches.length, exhaustiveNbHits: true, hits: matches.slice(page * 100, (page + 1) * 100) });
    });
    vi.stubGlobal('fetch', fetcher);
    const result = await collectDiscoveredResearchSource({ ...source, discoveryProvider: 'hackernews' }, lower * 1000, upper * 1000, new Set(), { deferArticleFetch: true });
    expect(new Set(result.pendingArticles?.map(item => item.url)).size).toBe(1201);
    expect(result.coverage).toMatchObject({ resultPages: 14, receivedHits: 1301, candidatePages: 1201, exhaustive: true });
    expect(windows).toContainEqual([lower, lower + 4]);
    expect(windows).toContainEqual([lower + 5, upper]);
    expect(fetcher).toHaveBeenCalledTimes(14);
    expect(result.warning).toContain('nonoverlapping timestamp windows');
    expect(result.warning).not.toContain('not exhaustive');
  });

  it("retains the parent and readable HN partition when another timestamp window fails", async () => {
    const lower = Math.floor(start / 1000);
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const bounds = url.searchParams.get('numericFilters')!.match(/created_at_i>=(\d+),created_at_i<=(\d+)/)!;
      const from = Number(bounds[1]), to = Number(bounds[2]);
      if (from === lower + 1) return new Response('', { status: 503 });
      return Response.json({ page: 0, nbPages: 1, nbHits: from === to ? 1 : 201, exhaustiveNbHits: true, hits: [{ title: 'Readable original', url: `https://research.example/${from === to ? 'partition' : 'parent'}` }] });
    });
    vi.stubGlobal('fetch', fetcher);
    const result = await collectDiscoveredResearchSource({ ...source, discoveryProvider: 'hackernews' }, lower * 1000, (lower + 1) * 1000, new Set(), { deferArticleFetch: true });
    expect(result.pendingArticles?.map(item => item.url).sort()).toEqual(['https://research.example/parent', 'https://research.example/partition']);
    expect(result.coverage?.exhaustive).toBe(false);
    expect(result.warning).toContain('timestamp window');
    expect(result.warning).toContain('failed; readable results were retained');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not invent HN pagination when metadata is missing, malformed or provider-limited", async () => {
    for (const metadata of [{}, { nbPages: -1 }, { nbPages: "infinite" }, { nbPages: 1, nbHits: 1000, exhaustiveNbHits: false }]) {
      const fetcher = vi.fn(async (input: string | URL) => new URL(String(input)).hostname === "hn.algolia.com"
        ? Response.json({ ...metadata, hits: [{ title: "Original", url: "https://research.example/first" }] })
        : new Response(article("2026-10-23T10:00:00Z")));
      vi.stubGlobal("fetch", fetcher);
      const result = await collectDiscoveredResearchSource({ ...source, discoveryProvider: "hackernews" }, end, end, new Set());
      expect(result.items).toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(result.coverage?.exhaustive).toBe(false);
      expect(result.warning).toContain("not exhaustive");
    }
  });

  it("stops visibly at an empty HN page instead of chasing a malformed large page count", async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "hn.algolia.com") {
        const page = Number(url.searchParams.get("page"));
        return Response.json({ page, nbPages: Number.MAX_SAFE_INTEGER, nbHits: Number.MAX_SAFE_INTEGER, hits: page === 0 ? [{ title: "Original", url: "https://research.example/first" }] : [] });
      }
      return new Response(article("2026-10-23T10:00:00Z"));
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await collectDiscoveredResearchSource({ ...source, discoveryProvider: "hackernews" }, start, end, new Set());
    expect(result.items).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.coverage?.exhaustive).toBe(false);
    expect(result.warning).toContain("empty page before its reported end");
  });

  it("plans every web index article without fetching their bodies in the planning step", async () => {
    const urls = Array.from({ length: 80 }, (_, index) => `https://research.example/reports/original-${index}`);
    const fetcher = vi.fn(async () => new Response(`<main>${urls.map(url => `<a href="${url}">Original research report</a>`).join("")}</main>`));
    vi.stubGlobal("fetch", fetcher);
    const result = await collectDiscoveredResearchSource({ ...source, kind: "web", url: "https://research.example/reports", articlePathPrefixes: ["/reports/"] }, start, end, new Set(), { deferArticleFetch: true });
    expect(result.items).toEqual([]);
    expect(result.pendingArticles?.map(target => target.url)).toEqual(urls);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, '2025-09-01T10:00:00Z'])("watches an explicit source page itself once without inventing freshness: %s", async date => {
    const url = 'https://research.example/resources/practical-framework';
    const fetcher = vi.fn(async (input: string | URL) => {
      expect(String(input)).toBe(url);
      return new Response(`${article(date)}<a href="https://research.example/other">Another original research page</a>`);
    });
    vi.stubGlobal('fetch', fetcher);
    const result = await collectDiscoveredResearchSource({ ...source, kind: 'web', url, pageMode: 'article' }, start, end, new Set(), { deferArticleFetch: true });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ url, contentProvenance: 'article', publishedAt: date ? Date.parse(date) : null });
    expect(result.items[0].content).toContain('Measured original evidence.');
    expect(result.pendingArticles).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('extracts the public repository README rather than surrounding repository chrome', async () => {
    const url = 'https://github.com/example/public-toolkit';
    const fetcher = vi.fn(async (input: string | URL) => {
      expect(String(input)).toBe(url);
      return new Response(`<main><h1>Repository overview</h1><div>${'DIRECTORY_LISTING '.repeat(100)}</div><time class="updated" datetime="2026-10-22"></time><article class="markdown-body entry-content"><h1>Public toolkit</h1><p>${'Substantive README instructions and implementation tradeoffs. '.repeat(30)}</p></article></main>`);
    });
    vi.stubGlobal('fetch', fetcher);
    const result = await collectDiscoveredResearchSource({ ...source, kind: 'web', url, pageMode: 'article' }, start, end, new Set(), { deferArticleFetch: true });
    expect(result.items[0]).toMatchObject({ title: 'Public toolkit', publishedAt: null, contentProvenance: 'article' });
    expect(result.items[0].content).toContain('Substantive README instructions');
    expect(result.items[0].content).not.toContain('DIRECTORY_LISTING');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects an explicit page watch redirect outside the approved publisher', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://unapproved.example/page' } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(collectDiscoveredResearchSource({ ...source, kind: 'web', url: 'https://research.example/resource', pageMode: 'article' }, start, end, new Set(), { deferArticleFetch: true })).rejects.toThrow('approved source domains');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("plans every search result without letting original-page fetches consume the discovery step", async () => {
    vi.stubEnv("TREG_TOKEN", "test-only-search-token");
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe("treg.to");
      return Response.json({ results: Array.from({ length: 20 }, (_, index) => ({ title: `Original ${index}`, url: `https://research.example/${url.searchParams.get("query")}-${index}`, snippet: "Unverified snippet is not a body" })) });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await collectDiscoveredResearchSource({ ...source, discoveryQueries: ["one", "two", "three", "four"] }, start, end, new Set(), { deferArticleFetch: true });
    expect(result.items).toEqual([]);
    expect(result.pendingArticles).toHaveLength(80);
    expect(result.pendingArticles?.every(target => Object.keys(target).sort().join(",") === "title,url")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("returns all feed metadata for deferred hydration without fetching linked pages", async () => {
    const fetcher = vi.fn(async () => new Response(`<rss><channel>${Array.from({ length: 80 }, (_, index) => `<item><title>Original ${index}</title><link>https://research.example/article-${index}</link><pubDate>Thu, 22 Oct 2026 10:00:00 GMT</pubDate><description>Short public summary.</description></item>`).join("")}</channel></rss>`, { headers: { "content-type": "application/rss+xml" } }));
    vi.stubGlobal("fetch", fetcher);
    const result = await collectDiscoveredResearchSource({ ...source, kind: "rss", url: "https://research.example", feedUrl: "https://research.example/feed" }, start, end, new Set(), { deferArticleFetch: true });
    expect(result.items).toHaveLength(80);
    expect(result.items.every(item => item.content === undefined && item.publishedAt === Date.parse("2026-10-22T10:00:00Z"))).toBe(true);
    expect(result.pendingArticles).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fetches a queued arXiv HTML article with its original v1 date rather than a newer revision", async () => {
    const fetcher = vi.fn(async (input: string | URL, options?: RequestInit) => {
      expect(options?.headers).not.toHaveProperty("X-Treg-Token");
      return new Response(new URL(String(input)).pathname.startsWith("/abs/")
        ? '<main><h2>Submission history</h2>[v1] Thu, 22 Oct 2026 13:43:33 UTC<br>[v2] Fri, 23 Oct 2026 10:00:00 UTC</main>'
        : `<main><h1 class="ltx_title_document">Queued original paper</h1><p>${"Inspectable paper method. ".repeat(40)}</p></main>`);
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await fetchDiscoveredResearchArticle(source, { url: "https://arxiv.org/html/2610.31272v2", title: "Search title" }, end);
    expect(result.title).toBe("Queued original paper");
    expect(result.publishedAt).toBe(Date.parse("2026-10-22T13:43:33Z"));
    expect(result.contentProvenance).toBe("article");
    expect(result.content).not.toContain("Submission history");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps approved publisher boundaries for queued feed and web targets", async () => {
    const fetcher = vi.fn(async () => new Response(article("2026-10-23T10:00:00Z")));
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchDiscoveredResearchArticle({ ...source, kind: "rss", url: "https://research.example", feedUrl: "https://research.example/feed" }, { url: "https://unapproved.example/story" }, end)).rejects.toThrow("outside the approved");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("queues historical original URLs even when the current web index no longer lists them", async () => {
    const oldUrl = "https://research.example/reports/original-2025";
    const fetcher = vi.fn(async () => new Response("<main><h1>Current report index</h1></main>"));
    vi.stubGlobal("fetch", fetcher);
    const result = await collectDiscoveredResearchSource({ ...source, kind: "web", url: "https://research.example/reports", articlePathPrefixes: ["/reports/"], backfillUrls: [oldUrl, `${oldUrl}/`, "https://unapproved.example/story"] }, start, end, new Set(), { deferArticleFetch: true });
    expect(result.items).toEqual([]);
    expect(result.pendingArticles).toEqual([{ url: oldUrl }]);
    expect(result.warning).toContain("outside the approved publisher");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("adds missing original URLs to feed and search plans without duplicating returned articles", async () => {
    vi.stubEnv("TREG_TOKEN", "test-only-search-token");
    const original = "https://research.example/original-2025";
    const latest = "https://research.example/latest";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => new URL(String(input)).hostname === "treg.to"
      ? Response.json({ results: [{ title: "Latest article", url: latest }] })
      : new Response(`<rss><channel><item><title>Latest article</title><link>${latest}</link><pubDate>Thu, 22 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`)));
    const feed = await collectDiscoveredResearchSource({ ...source, kind: "rss", url: "https://research.example", feedUrl: "https://research.example/feed", backfillUrls: [original, latest] }, start, end, new Set(), { deferArticleFetch: true });
    expect(feed.items).toHaveLength(1);
    expect(feed.pendingArticles).toEqual([{ url: original }]);
    const search = await collectDiscoveredResearchSource({ ...source, backfillUrls: [original, latest] }, start, end, new Set(), { deferArticleFetch: true });
    expect(search.pendingArticles?.map(target => target.url)).toEqual([latest, original]);
  });

  it("retains the old original publication date when fetching a configured backfill", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => new URL(String(input)).pathname === "/feed"
      ? new Response("<rss><channel></channel></rss>")
      : new Response(article("2025-07-31T10:00:00Z"))));
    const result = await collectDiscoveredResearchSource({ ...source, kind: "rss", url: "https://research.example", feedUrl: "https://research.example/feed", backfillUrls: ["https://research.example/original-2025"] }, start, end, new Set());
    expect(result.items).toHaveLength(1);
    expect(result.items[0].publishedAt).toBe(Date.parse("2025-07-31T10:00:00Z"));
    expect(result.items[0].publishedAt).toBeLessThan(start);
  });

  it("keeps an explicit original backfill when its RSS entry point is blocked", async () => {
    const original = "https://research.example/original-2025";
    const fetcher = vi.fn(async () => new Response("", { status: 403 }));
    vi.stubGlobal("fetch", fetcher);
    const result = await collectDiscoveredResearchSource({ ...source, kind: "rss", url: "https://research.example", feedUrl: "https://research.example/feed", backfillUrls: [original] }, start, end, new Set(), { deferArticleFetch: true });
    expect(result.items).toEqual([]);
    expect(result.pendingArticles).toEqual([{ url: original }]);
    expect(result.warning).toContain("entry point failed (Source returned HTTP 403)");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

});
