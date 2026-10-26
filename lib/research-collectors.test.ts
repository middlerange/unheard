import { afterEach, describe, expect, it, vi } from "vitest";
import {
  articleResearchDate,
  articleResearchText,
  collectResearchSource,
  discoverResearchLinks,
  fetchResearchText,
  parseResearchFeed,
  plainResearchText,
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
  it("reads the main article instead of embedded Hugging Face repository and DeepMind related cards", () => {
    for (const card of [
      '<article class="overview-card-wrapper"><h3>Repository card</h3><time class="published" datetime="2026-08-20">Paper published</time></article>',
      '<article class="card card-blog"><h2>Related research</h2><time class="published" datetime="2025-07-01">July 2025</time></article>',
    ]) {
      const html = `<title>Original research | Publisher</title><main><header><h1 class="max-md:[&amp;>span]:block">Original research</h1></header><p>${evidence}</p>${card}<p>Final article conclusion.</p></main>`;
      expect(articleResearchText(html)).toContain(evidence.trim());
      expect(articleResearchText(html)).toContain("Original research");
      expect(articleResearchText(html)).toContain("Final article conclusion.");
      expect(articleResearchText(html)).not.toContain('span]:block');
      expect(articleResearchDate(html, "https://example.com/story", NOW)).toBeNull();
    }
  });

  it("uses the article heading that matches the page title rather than an earlier unrelated article", () => {
    const html = `<title>Original research | Publisher</title><main><article><h1>Related story</h1>Published October 23, 2026</article><article><header><h1>Original research</h1><time itemprop="datePublished" datetime="2026-10-22T18:00:00Z">October 22</time></header><p>${evidence}</p></article></main>`;
    expect(articleResearchText(html)).toContain(evidence.trim());
    expect(articleResearchText(html)).not.toContain("Related story");
    expect(articleResearchDate(html, undefined, NOW)).toBe(Date.parse("2026-10-22T18:00:00Z"));
  });

  it("accepts an explicitly published date on a title-scoped newsletter page without semantic wrappers", () => {
    const html = `<title>3 Product Discovery Observations</title><body><h1>Newsletter creator</h1><h1 class="post-title">3 Product Discovery Observations</h1><table><tr><td>PUBLISHED</td><td><strong>Oct 23, 2026</strong></td></tr></table><p>${evidence}</p><footer>Published October 24, 2026</footer></body>`;
    expect(articleResearchDate(html, undefined, NOW)).toBe(Date.parse("2026-10-23T00:00:00Z"));
    expect(articleResearchText(html)).not.toContain("Newsletter creator");
    expect(articleResearchDate('<title>Unrelated page</title><h1>Creator</h1><p>Published October 23, 2026</p>', undefined, NOW)).toBeNull();
  });

  it("reads matching WebPage publication metadata without adopting unrelated or modified dates", () => {
    const schema = (row: Record<string, unknown>) => `<script type="application/ld+json">${JSON.stringify(row)}</script>`;
    expect(articleResearchDate(schema({ "@type": "WebPage", "@id": "https://example.com/report", datePublished: "2026-07-22T10:05:26Z", dateModified: "2026-10-23" }), "https://example.com/report", NOW)).toBe(Date.parse("2026-07-22T10:05:26Z"));
    expect(articleResearchDate(schema({ "@type": "WebPage", datePublished: "2026-10-23" }), "https://example.com/report", NOW)).toBeNull();
    expect(articleResearchDate(schema({ "@type": "BlogPosting", url: "https://example.com/related", datePublished: "2026-10-23" }), "https://example.com/report", NOW)).toBeNull();
    expect(articleResearchDate('<main><h1>Report</h1><p>Date October 23, 2026</p><time datetime="2026-10-23">October 23</time></main>', undefined, NOW)).toBeNull();
  });

  it("preserves Hugging Face SocialMediaPosting publication time instead of a date-only fallback", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({ "@type": "SocialMediaPosting", "@id": "https://huggingface.co/blog/microsoft/thinkingbox-training", datePublished: "2026-10-22T22:24:34.816Z", dateModified: "2026-10-23T10:00:00Z" })}</script><main><h1>Turning Database Grading into RL Rewards</h1><p>Published October 22, 2026</p></main>`;
    expect(articleResearchDate(html, "https://huggingface.co/blog/microsoft/thinkingbox-training", NOW)).toBe(Date.parse("2026-10-22T22:24:34.816Z"));
  });

  it("reads Wynter's own report byline without using quarter labels or site deployment dates", () => {
    const url = "https://wynter.com/post/wynter-index-q3-2026-b2b-marketing";
    const html = `<!-- Last Published: Fri Oct 23 2026 --><title>[Wynter Index] Q3 2026 | B2B Marketing</title><div class="content-container"><h1>Wynter Index Q3 2026</h1><div class="blog-article__sub-heading">A quarterly survey.</div><div class="wfu-post-byline"><div class="wfu-post-byline-author"></div><div class="wfu-post-byline-date">August 12, 2026</div></div></div><section><h2>Related report</h2><div class="wfu-post-byline-date">October 22, 2026</div></section><footer>Published October 23, 2026</footer>`;
    expect(articleResearchDate(html, url, NOW)).toBe(Date.parse("2026-08-12T00:00:00Z"));
    expect(articleResearchDate(html, "https://www.wynter.com/post/report", NOW)).toBe(Date.parse("2026-08-12T00:00:00Z"));
    expect(articleResearchDate(html.replace("[Wynter Index] Q3 2026 | B2B Marketing", "Wynter Index Q3 2026"), url, NOW)).toBe(Date.parse("2026-08-12T00:00:00Z"));
    expect(articleResearchDate(html, "https://example.com/post/report", NOW)).toBeNull();
    expect(articleResearchDate(html, "https://wynter.com/blog-category/research", NOW)).toBeNull();
    expect(articleResearchDate(html, undefined, NOW)).toBeNull();
    expect(articleResearchDate(html.replace('<div class="wfu-post-byline-date">August 12, 2026</div>', ""), url, NOW)).toBeNull();
    expect(articleResearchDate(html.replace("August 12, 2026", "Updated October 22, 2026"), url, NOW)).toBeNull();
    expect(articleResearchDate(html.replace("August 12, 2026", "October 30, 2026"), url, NOW)).toBeNull();
  });

  it("reads MeasuringU's title-section publication widget and ignores navigation and related research dates", () => {
    const url = "https://measuringu.com/digital-twins-systematically-overestimated-business-software-sus-scores";
    const widget = '<div class="elementor-element post-date elementor-widget-text-editor"><div class="elementor-widget-container">October 20, 2026</div></div>';
    const html = `<nav><div class="post-date">October 23, 2026</div></nav><main><section class="elementor-section elementor-top-section"><div><h1>Digital Twins Systematically Overestimated Business Software SUS Scores</h1></div><div>Lucas Plabst • Jeff Sauro • Jim Lewis</div>${widget}</section><section class="blog-content"><p>${evidence}</p></section><section class="elementor-top-section"><h2>Related research</h2><div class="post-date">October 22, 2026</div></section></main><footer>Published October 23, 2026</footer>`;
    expect(articleResearchDate(html, url, NOW)).toBe(Date.parse("2026-10-20T00:00:00Z"));
    expect(articleResearchDate(html, "https://measuringu.com/blogs/", NOW)).toBeNull();
    expect(articleResearchDate(html, "https://measuringu.example.com/story", NOW)).toBeNull();
    expect(articleResearchDate(html.replace(widget, ""), url, NOW)).toBeNull();
    expect(articleResearchDate(html.replace(widget, widget + widget), url, NOW)).toBeNull();
    expect(articleResearchDate(html.replace("October 20, 2026", "Last updated October 22, 2026"), url, NOW)).toBeNull();
  });

  it("reads only PostHog's immediate title byline date beside an author profile", () => {
    const byline = '<div class="flex items-center space-x-2 mb-4 flex-wrap transition-all mx-auto max-w-2xl"><div class="not-prose"><ul><li><a href="/community/profiles/28625">Charles Cook</a></li></ul></div><p class="text-sm text-secondary m-0">Oct 16, 2026</p><ul><li>Culture</li></ul></div>';
    const html = `<title>Original practitioner case - PostHog</title><nav><p>Oct 23, 2026</p></nav><main><h1>Original practitioner case</h1>${byline}<p>${evidence}</p><section><h2>Related report</h2>${byline.replace("Oct 16", "Oct 22")}</section></main><footer>${byline.replace("Oct 16", "Oct 23")}</footer>`;
    const url = "https://posthog.com/blog/original-practitioner-case";
    expect(articleResearchDate(html, url, NOW)).toBe(Date.parse("2026-10-16T00:00:00Z"));
    expect(articleResearchDate(html.replace("Oct 16, 2026", "Aug 05, 2026"), url, NOW)).toBe(Date.parse("2026-08-05T00:00:00Z"));
    expect(articleResearchDate(html, "https://example.com/blog/original-practitioner-case", NOW)).toBeNull();
    expect(articleResearchDate(html, "https://posthog.com/blog/", NOW)).toBeNull();
    expect(articleResearchDate(html.replace(byline, ""), url, NOW)).toBeNull();
    expect(articleResearchDate(html.replace(byline, byline.replace('/community/profiles/28625', '/unrelated-author')), url, NOW)).toBeNull();
    expect(articleResearchDate(html.replace(byline, byline.replace('class="text-sm text-secondary m-0"', 'class="text-sm text-secondary m-0 updated"')), url, NOW)).toBeNull();
    expect(articleResearchDate(html.replace(byline, byline.replace('class="text-sm text-secondary m-0"', 'itemprop="dateModified" class="text-sm text-secondary m-0"')), url, NOW)).toBeNull();
    expect(articleResearchDate(html.replace("Oct 16, 2026", "Updated Oct 22, 2026"), url, NOW)).toBeNull();
    expect(articleResearchDate(html.replace("Oct 16, 2026", "Oct 30, 2026"), url, NOW)).toBeNull();
  });

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

  it("decodes escaped Atom HTML and numeric entities before extracting readable public evidence", () => {
    const atom = `<feed><entry><title>Cloudflare&#x27;s product lesson</title><link href="https://example.com/story"/><published>2026-10-22T10:00:00Z</published><content type="html">&amp;lt;p&amp;gt;Cloudflare&amp;#x27;s public evidence. ${evidence}&amp;lt;/p&amp;gt;</content></entry></feed>`;
    const item = parseResearchFeed(atom, source)[0];
    expect(item.title).toBe("Cloudflare's product lesson");
    expect(item.content).toBe(`Cloudflare's public evidence. ${evidence.trim()}`);
    expect(item.excerpt).toBe(item.content);
    expect(item.contentProvenance).toBe("public_feed");
    expect(plainResearchText("&lt;script&gt;do not use this&lt;/script&gt; Useful &amp; accurate &#x1f680; text")).toBe("Useful & accurate 🚀 text");
    expect(plainResearchText("&amp;amp;lt;p&amp;amp;gt;Bounded decoding")).toContain("&lt;p&gt;");
    expect(plainResearchText("Invalid &#x110000; &#xD800; references")).toBe("Invalid &#x110000; &#xD800; references");
    expect(() => parseResearchFeed('<!DOCTYPE feed [<!ENTITY leak SYSTEM "file:///etc/passwd">]><feed/>', source)).toThrow("Unsupported XML");
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
  it("gives configured article sections equal priority and preserves the publisher index order", () => {
    const html = `<main><a href="/engineering/new-engineering">New engineering</a>${Array.from({ length: 12 }, (_, index) => `<a href="/research/report-${index}">Research report with a longer descriptive title ${index}</a>`).join("")}<a href="/engineering/older-engineering">Older engineering</a></main>`;
    expect(discoverResearchLinks(html, { ...source, articlePathPrefixes: ["/engineering/", "/research/"], maxDiscoveryLinks: 12 })).toEqual([
      "https://example.com/engineering/new-engineering",
      ...Array.from({ length: 11 }, (_, index) => `https://example.com/research/report-${index}`),
    ]);
  });

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

  it("accepts short and empty overlay links only under explicitly approved article paths", () => {
    const html = '<main><a href="/news/real-study">Read more</a><a href="/news/another-study" class="card-overlay"></a><a href="/news/">News</a><a href="/news?filterBy=all">Filter</a><a href="/news/archive">Archive</a><a href="/elsewhere/something"></a><a href="https://outside.example/news/real-study">Read more</a></main>';
    const scoped = { ...source, articlePathPrefixes: ["/news/"] };
    expect(discoverResearchLinks(html, scoped)).toEqual([
      "https://example.com/news/real-study", "https://example.com/news/another-study",
    ]);
    expect(discoverResearchLinks(html, source)).toEqual([]);
  });

  it("falls back beyond an empty main only for scoped sources and keeps navigation excluded", () => {
    const html = '<nav><a href="/news/navigation-study">Latest research navigation story</a></nav><main></main><section><a href="/news/real-study"></a><a href="/news/second-study">Read</a><a href="/news/topics/ai">Research topic</a><a href="/research/team/alignment">Team</a><a href="https://outside.example/news/external-study">External research</a></section><footer><a href="/news/footer-study">Related research footer story</a></footer><script>const template = "<a href=\'/news/script-study\'>Script research story</a>";</script>';
    expect(discoverResearchLinks(html, { ...source, articlePathPrefixes: ["/news/"], maxDiscoveryLinks: 1 })).toEqual(["https://example.com/news/real-study"]);
    expect(discoverResearchLinks(html, source)).toEqual([]);
    expect(discoverResearchLinks(html, { ...source, articlePathPrefixes: ["/news/"] })).toEqual([
      "https://example.com/news/real-study", "https://example.com/news/second-study",
    ]);
  });

  it("keeps a populated main authoritative instead of adding document-wide related links", () => {
    const html = '<main><a href="/news/main-study">Read more</a></main><section><a href="/news/related-study">Related research finding</a></section>';
    expect(discoverResearchLinks(html, { ...source, articlePathPrefixes: ["/news/"] })).toEqual(["https://example.com/news/main-study"]);
  });

  it("keeps Lyssna author and topic archives from consuming the bounded article slots", () => {
    const html = `<main>${["diane-leyman", "ai-in-user-research", "concept-testing", "product-management"].map(slug => `<a href="/blog/${slug}-articles">Research articles</a>`).join("")}<a href="/blog/2">More research articles</a><a href="/blog/ai-skills-for-research">AI skills for research</a><a href="/blog/mcp-launch">A new research connection</a></main>`;
    const lyssna = { ...source, url: "https://www.lyssna.com/blog/", articlePathPrefixes: ["/blog/"], maxDiscoveryLinks: 2 };
    expect(discoverResearchLinks(html, lyssna)).toEqual([
      "https://www.lyssna.com/blog/ai-skills-for-research", "https://www.lyssna.com/blog/mcp-launch",
    ]);
    expect(discoverResearchLinks(html, { ...lyssna, url: "https://example.com/blog/" })).toEqual([
      "https://example.com/blog/diane-leyman-articles", "https://example.com/blog/ai-in-user-research-articles",
    ]);
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
