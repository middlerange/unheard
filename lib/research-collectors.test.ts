import { afterEach, describe, expect, it, vi } from "vitest";
import {
  articleResearchDate,
  collectResearchSource,
  discoverResearchLinks,
  fetchResearchText,
  parseResearchFeed,
  sourceHosts,
} from "./research-collectors";
import type { ResearchSourceSeed } from "./research-types";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const source: ResearchSourceSeed = {
  id: "public-research", name: "Public research", url: "https://example.com/research",
  kind: "web", category: "research", enabled: true, notes: "", priority: 1,
};
const evidence = "A public research finding about customer adoption and product discovery. ".repeat(12);

afterEach(() => vi.unstubAllGlobals());

describe("public research evidence and publication dates", () => {
  it("retains substantial public RSS content and labels it without fetching premium continuations", () => {
    const body = `${evidence} Subscribe to read the rest of this premium post.`;
    const rss = `<rss><channel><item><title>A useful public introduction</title><link>https://example.com/p/story</link><pubDate>Thu, 22 Oct 2026 10:00:00 GMT</pubDate><description>Public teaser</description><content:encoded><![CDATA[<p>${body}</p>]]></content:encoded></item></channel></rss>`;
    const items = parseResearchFeed(rss, source);
    expect(items[0]).toMatchObject({
      content: body.replace(/\s+/g, " "), contentProvenance: "public_feed", excerpt: "Public teaser",
      publishedAt: Date.parse("2026-10-22T10:00:00Z"),
    });
    expect(parseResearchFeed(rss.replace(/<content:encoded>[\s\S]*?<\/content:encoded>/, ""), source)[0].content).toBeUndefined();
  });

  it("preserves Atom content but never promotes a video description into a transcript", () => {
    const atom = `<feed><entry><title>Original interview</title><link rel="alternate" href="https://example.com/story"/><published>2026-10-22T10:00:00Z</published><content type="html"><![CDATA[<p>${evidence}</p>]]></content></entry></feed>`;
    expect(parseResearchFeed(atom, source)[0]).toMatchObject({ content: evidence.trim(), contentProvenance: "public_feed" });
    expect(parseResearchFeed(atom, { ...source, kind: "youtube" })[0]).toMatchObject({ contentType: "video", transcriptStatus: "unavailable" });
    expect(parseResearchFeed(atom, { ...source, kind: "youtube" })[0].content).toBeUndefined();
  });

  it("uses published metadata and ignores modified-only, navigation, and footer dates", () => {
    expect(articleResearchDate('<meta content="2026-10-22T10:00:00Z" property="article:published_time"><meta property="article:modified_time" content="2026-10-23T10:00:00Z">', undefined, NOW)).toBe(Date.parse("2026-10-22T10:00:00Z"));
    expect(articleResearchDate('<nav><time datetime="2026-10-23">Today</time></nav><main><article><p>Undated report</p><time itemprop="dateModified" datetime="2026-10-23">Updated today</time></article></main><footer>Published October 23, 2026</footer>', undefined, NOW)).toBeNull();
    expect(articleResearchDate('<article><time datetime="2026-10-23">Example deadline</time><p>Last updated October 23, 2026</p></article>', undefined, NOW)).toBeNull();
  });

  it("reads Article JSON-LD graphs and chooses this page rather than related articles", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({ "@graph": [
      { "@type": "WebSite", datePublished: "2026-10-23" },
      { "@type": "BlogPosting", url: "https://example.com/other", datePublished: "2026-10-23" },
      { "@type": ["Article", "NewsArticle"], mainEntityOfPage: { "@id": "https://example.com/story" }, datePublished: "2026-10-22T09:00:00Z", dateModified: "2026-10-23" },
    ] })}</script>`;
    expect(articleResearchDate(html, "https://example.com/story", NOW)).toBe(Date.parse("2026-10-22T09:00:00Z"));
    expect(articleResearchDate(html, "https://example.com/unknown", NOW)).toBeNull();
    expect(articleResearchDate('<script type="application/ld+json">{"@type":"BlogPosting","dateModified":"2026-10-23"}</script>', undefined, NOW)).toBeNull();
  });

  it("parses explicitly published visible dates and semantic times inside content", () => {
    expect(articleResearchDate('<main><h1>Brand vs Demand Benchmarks</h1><p>Published January 5th, 2026</p></main>', undefined, NOW)).toBe(Date.parse("2026-01-05T00:00:00Z"));
    expect(articleResearchDate('<article><p>Published on: <time datetime="2026-10-22T18:00:00Z">October 22</time></p></article>', undefined, NOW)).toBe(Date.parse("2026-10-22T18:00:00Z"));
    expect(articleResearchDate('<article><header><h1>Original research</h1><time class="published" datetime="2026-10-22T18:00:00Z">October 22</time></header></article>', undefined, NOW)).toBe(Date.parse("2026-10-22T18:00:00Z"));
    expect(articleResearchDate('<main><time class="entry-date updated" datetime="2026-10-23">Updated</time><time itemprop="datePublished" datetime="2026-10-20">October 20</time></main>', undefined, NOW)).toBe(Date.parse("2026-10-20T00:00:00Z"));
    expect(articleResearchDate('<article>Published October 30, 2026</article>', undefined, NOW)).toBeNull();
  });
});

describe("bounded public source discovery", () => {
  it("allows exact www aliases while rejecting unrelated subdomains and redirect destinations", async () => {
    expect([...sourceHosts(source)].sort()).toEqual(["example.com", "www.example.com"]);
    expect(sourceHosts({ ...source, url: "https://www.example.com/research" })).toEqual(sourceHosts(source));
    const redirect = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://private.example.com/story" } }));
    await expect(fetchResearchText(source.url, sourceHosts(source), redirect)).rejects.toThrow("outside the approved");
    expect(redirect).toHaveBeenCalledTimes(1);
    const publicRedirect = vi.fn(async (url: string | URL | Request) => String(url).includes("www.")
      ? new Response("public content", { headers: { "content-type": "text/html" } })
      : new Response(null, { status: 302, headers: { location: "https://www.example.com/story" } }));
    expect(await fetchResearchText(source.url, sourceHosts(source), publicRedirect)).toBe("public content");
  });

  it("looks past early navigation, keeps all main cards, and honors article paths and discovery limits", () => {
    const cards = Array.from({ length: 15 }, (_, index) => `<article><header><a href="/research/report-${index}">Original adoption research report ${index}</a></header></article>`).join("");
    const html = `<main><nav><a href="/research/ignored">Navigation research resource</a></nav><a href="/pricing">Pricing and company plans overview</a><a href="/contact">Contact the research team today</a>${cards}<a href="/other/report">Another unrelated resource</a></main>`;
    expect(discoverResearchLinks(html, { ...source, articlePathPrefixes: ["/research/"], maxDiscoveryLinks: 12 })).toEqual(Array.from({ length: 12 }, (_, index) => `https://example.com/research/report-${index}`));
    expect(discoverResearchLinks(html, source)).toHaveLength(16);
  });

  it("reads image alt titles and prefers article routes over generic resources", () => {
    const html = '<main><a href="/library">Browse the full research library</a><a href="/p/new-research"><img alt="Original customer adoption research" src="/card.png"></a><a href="/research/report.pdf">Download the complete research PDF</a></main>';
    expect(discoverResearchLinks(html, { ...source, maxDiscoveryLinks: 1 })).toEqual(["https://example.com/p/new-research"]);
  });

  it("fetches at most four articles together and retains the public article evidence", async () => {
    let active = 0;
    let peak = 0;
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === source.url) return new Response(`<main>${Array.from({ length: 10 }, (_, index) => `<a href="/research/report-${index}">Original customer research report ${index}</a>`).join("")}</main>`, { headers: { "content-type": "text/html" } });
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      return new Response(`<title>Research site</title><article><h1>A customer adoption study</h1><p>Published October 22, 2026</p><p>${evidence}</p></article>`, { headers: { "content-type": "text/html" } });
    });
    vi.stubGlobal("fetch", fetcher);
    const items = await collectResearchSource(source);
    expect(peak).toBe(4);
    expect(items).toHaveLength(10);
    expect(items[0]).toMatchObject({
      title: "A customer adoption study", contentProvenance: "article",
      publishedAt: Date.parse("2026-10-22T00:00:00Z"),
    });
    expect(items[0].content).toContain(evidence.trim());
    expect(fetcher).toHaveBeenCalledTimes(11);
  });
});
