import { afterEach, describe, expect, it, vi } from "vitest";
import {
  articleResearchDate,
  articleResearchSection,
  articleResearchText,
  collectResearchSource,
  discoverResearchLinks,
  fetchResearchText,
  parseResearchFeed,
  plainResearchText,
  readableResearchText,
  sourceHosts,
  sourceArticleHosts,
  ResearchRateLimitError,
} from "./research-collectors";
import { matchResearchQuote } from "./research-model";
import type { ResearchSourceSeed } from "./research-types";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const source: ResearchSourceSeed = {
  id: "public-research", name: "Public research", url: "https://example.com/research",
  kind: "web", category: "research", enabled: true, notes: "", priority: 1,
};
const evidence = "A public research finding about customer adoption and product discovery. ".repeat(12);

afterEach(() => vi.unstubAllGlobals());

describe("public research evidence and publication dates", () => {
  it("reads a late public chapter before applying the body cap and preserves its source wording", () => {
    const chapter = '<h4>Evidence &amp; decisions</h4><p>The customer said “not yet”; keep that uncertainty.</p><ul><li>Observe the actual use.</li><li>Retain the contradictory result.</li></ul>';
    const html = `<title>An original interview | Publisher</title><main><h1>An original interview</h1><p>${"Earlier source material. ".repeat(2000)}</p>${chapter}<h4>Another chapter</h4><p>Unrelated later answer.</p></main>`;
    expect(articleResearchText(html)).not.toContain("The customer said");
    const result = articleResearchSection(html, "  Evidence   & decisions  ");
    expect(result).toMatchObject({ title: "An original interview — Evidence & decisions", heading: "Evidence & decisions" });
    expect(result.content).toBe(readableResearchText(chapter));
    expect(result.content).not.toContain("Earlier source material");
    expect(result.content).not.toContain("Unrelated later answer");
    expect(articleResearchSection(`<main><h1>Original interview</h1><h2>Long chapter</h2><p>${"Long source paragraph. ".repeat(2000)}</p></main>`, "Long chapter").content).toHaveLength(14_000);
  });

  it.each([2, 3, 4])("ends a chapter at the next same-or-higher h%s while including its child headings", level => {
    const chapter = '<h4>Selected chapter</h4><p>Original answer.</p><h5>Detail</h5><p>Child answer.</p><h6>More detail</h6><p>Last child answer.</p>';
    const html = `<article><h1>Original interview</h1>${chapter}<h${level}>Next chapter</h${level}><p>Other answer.</p></article>`;
    expect(articleResearchSection(html, "Selected chapter").content).toBe(readableResearchText(chapter));
  });

  it("fails for missing, duplicate or unscoped chapter headings without borrowing navigation or related cards", () => {
    const article = '<main><h1>Original interview</h1><h3>Actual chapter</h3><p>Source answer.</p></main>';
    expect(() => articleResearchSection(article, "Missing chapter")).toThrow("not found");
    expect(() => articleResearchSection(article.replace('</main>', '<h4>Actual chapter</h4><p>Second answer.</p></main>'), "Actual chapter")).toThrow("ambiguous");
    expect(() => articleResearchSection(`<nav><h2>Missing chapter</h2></nav>${article}`, "Missing chapter")).toThrow("not found");
    expect(() => articleResearchSection(article.replace('</main>', '<article><h2>Missing chapter</h2>Related story.</article></main>'), "Missing chapter")).toThrow("not found");
    expect(() => articleResearchSection('<main><h2>Actual chapter</h2><p>No identified article.</p></main>', "Actual chapter")).toThrow("no confident article heading");
    expect(() => articleResearchSection('<h1>Unscoped page</h1><h2>Actual chapter</h2><p>No article region or matching page title.</p>', "Actual chapter")).toThrow("no confident article heading");
    expect(() => articleResearchSection(article, "actual chapter")).toThrow("not found");
    expect(() => articleResearchSection(article, "  ")).toThrow("nonempty");
    expect(articleResearchSection(`<nav><h2>Actual chapter</h2></nav>${article}`, "Actual chapter").content).toBe("Actual chapter\n\nSource answer.");
  });

  it("collects an explicit chapter with the whole original page date and explicit section provenance", async () => {
    const html = `<meta property="article:published_time" content="2025-03-18T09:00:00Z"><main><h1>Original interview</h1><p>${"Earlier content. ".repeat(2000)}</p><h3>Public chapter</h3><p>${evidence}</p></main>`;
    const fetcher = vi.fn(async () => new Response(html));
    vi.stubGlobal("fetch", fetcher);
    const [item] = await collectResearchSource({ ...source, pageMode: "article", articleSectionHeading: "Public chapter" });
    expect(item).toMatchObject({ title: "Original interview — Public chapter", contentProvenance: "public_section", publishedAt: Date.parse("2025-03-18T09:00:00Z") });
    expect(item.content).toBe(`Public chapter\n\n${evidence.trim()}`);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps five report conclusions separate in article and public feed bodies", () => {
    const sections = [
      ["Insight 1: Investment priorities", "Respondents plan to increase AI search investment; this measures intended spending, not channel returns."],
      ["Insight 2: Channel effectiveness", "Network introductions ranked first and intimate events second; adoption is a separate dimension."],
      ["Insight 3: AI search", "AI search is a core channel for 39% of respondents; this is not the share of tools that are AI-first."],
      ["Insight 4: Buyer signals", "Combine first-party product activity with third-party changes to decide which account play to run."],
      ["Insight 5: Tool turnover", "Seven of the ten must-try tools were new to the list; this measures turnover, not the number of AI tools."],
    ];
    const body = `<h1>Five GTM report findings</h1>${sections.map(([heading, finding]) => `<section><h2>${heading}</h2><p>${finding}</p></section>`).join("")}<ul><li>Review the population.</li><li>Keep each denominator attached to its finding.</li></ul>`;
    const html = `<title>Five GTM report findings</title><nav>Wrong navigation conclusion</nav><article>${body}<script>Wrong script conclusion</script><style>Wrong style conclusion</style></article>`;
    const rss = `<rss><channel><item><title>Five GTM report findings</title><link>https://example.com/report</link><description>Short public teaser</description><content:encoded><![CDATA[${body}]]></content:encoded></item></channel></rss>`;
    const atom = `<feed><entry><title>Five GTM report findings</title><link href="https://example.com/report"/><content type="html"><![CDATA[${body}]]></content></entry></feed>`;
    const expected = ["Five GTM report findings", ...sections.flat(), "Review the population.", "Keep each denominator attached to its finding."];
    for (const content of [articleResearchText(html), parseResearchFeed(rss, source)[0].content!, parseResearchFeed(atom, source)[0].content!]) {
      expect(content.split(/\n+/)).toEqual(expected);
      expect(plainResearchText(content)).toBe(plainResearchText(body));
      const [heading, finding] = sections[4];
      expect(matchResearchQuote(content, `${heading} ${finding}`)).toBe(`${heading}\n\n${finding}`);
      expect(content).not.toContain("Wrong");
    }
    expect(parseResearchFeed(rss, source)[0]).toMatchObject({ title: "Five GTM report findings", excerpt: "Short public teaser", contentProvenance: "public_feed" });
    expect(plainResearchText(body)).not.toContain("\n");
  });

  it("preserves decoded heading, paragraph and list boundaries within the public body limit", () => {
    const headings = Array.from({ length: 6 }, (_, index) => `<h${index + 1}>Heading ${index + 1}</h${index + 1}>`).join("");
    const html = `${headings}<p>First &amp; accurate paragraph.</p><p>Second<br>line.</p><ol><li>First item.</li><li>Second item.</li></ol>`;
    const escaped = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    expect(readableResearchText(escaped).split(/\n+/)).toEqual([
      "Heading 1", "Heading 2", "Heading 3", "Heading 4", "Heading 5", "Heading 6",
      "First & accurate paragraph.", "Second", "line.", "First item.", "Second item.",
    ]);
    expect(readableResearchText(`<p>${"Evidence ".repeat(2000)}</p>`)).toHaveLength(14_000);
    expect(readableResearchText("&lt;header&gt;&lt;h1&gt;Report heading&lt;/h1&gt;&lt;/header&gt;<p>Original finding.</p>")).toBe("Report heading\n\nOriginal finding.");
    expect(readableResearchText('&lt;script&gt;hidden&lt;/script&gt;<style>hidden</style><nav>hidden</nav><!--<h2>hidden</h2>--><p>Visible evidence.</p>')).toBe("Visible evidence.");
  });

  it("preserves HTTP 429 Retry-After without retrying inside the request", async () => {
    const fetcher = vi.fn(async () => new Response("Slow down", { status: 429, headers: { "retry-after": "120" } }));
    const error = await fetchResearchText("https://example.com/research", sourceHosts(source), fetcher).catch(error => error);
    expect(error).toBeInstanceOf(ResearchRateLimitError);
    expect(error).toMatchObject({ hostname: "example.com", retryAfter: "120", retryAfterMs: 120_000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const now = vi.spyOn(Date, "now").mockReturnValue(NOW);
    try {
      expect(new ResearchRateLimitError("example.com", "Fri, 23 Oct 2026 12:02:00 GMT").retryAfterMs).toBe(120_000);
      expect(new ResearchRateLimitError("example.com", null).retryAfterMs).toBeNull();
      expect(new ResearchRateLimitError("example.com", "invalid").retryAfterMs).toBeNull();
    } finally {
      now.mockRestore();
    }
  });
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

  it("reads Swan's matching article date when an undated WebPage precedes it in the graph", () => {
    const url = "https://www.getswan.com/changelog/the-brain";
    const schema = (rows: unknown[]) => `<script type="application/ld+json">${JSON.stringify({ "@graph": rows })}</script>`;
    const page = { "@type": "WebPage", "@id": `${url}#webpage`, url, dateModified: "2026-10-23" };
    const release = { "@type": "BlogPosting", url, datePublished: "2026-10-14T00:00:00.000Z", dateModified: "2026-10-23" };
    expect(articleResearchDate(schema([page, release]), url, NOW)).toBe(Date.parse("2026-10-14T00:00:00Z"));
    expect(articleResearchDate(schema([page, { ...release, url: "https://www.getswan.com/changelog/related" }]), url, NOW)).toBeNull();
    expect(articleResearchDate(schema([page, { ...release, datePublished: "2026-10-30" }]), url, NOW)).toBeNull();
    expect(articleResearchDate(schema([page, { "@type": "BlogPosting", datePublished: "2026-10-23" }]), url, NOW)).toBeNull();
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

describe("public source discovery", () => {
  it("gives configured article sections equal priority and preserves the publisher index order", () => {
    const html = `<main><a href="/engineering/new-engineering">New engineering</a>${Array.from({ length: 12 }, (_, index) => `<a href="/research/report-${index}">Research report with a longer descriptive title ${index}</a>`).join("")}<a href="/engineering/older-engineering">Older engineering</a></main>`;
    expect(discoverResearchLinks(html, { ...source, articlePathPrefixes: ["/engineering/", "/research/"], maxDiscoveryLinks: 12 })).toEqual([
      "https://example.com/engineering/new-engineering",
      ...Array.from({ length: 12 }, (_, index) => `https://example.com/research/report-${index}`),
      "https://example.com/engineering/older-engineering",
    ]);
  });

  it("allows exact www aliases while rejecting unrelated subdomains and redirect destinations", async () => {
    expect([...sourceHosts(source)].sort()).toEqual(["example.com", "www.example.com"]);
    expect(sourceHosts({ ...source, url: "https://www.example.com/research" })).toEqual(sourceHosts(source));
    const redirect = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://private.example.com/story" } }));
    await expect(fetchResearchText(source.url, sourceHosts(source), redirect)).rejects.toThrow("Source redirect rejected");
    expect(redirect).toHaveBeenCalledTimes(1);
    const publicRedirect = vi.fn(async (url: string | URL | Request) => String(url).includes("www.")
      ? new Response("public content", { headers: { "content-type": "text/html" } })
      : new Response(null, { status: 302, headers: { location: "https://www.example.com/story" } }));
    expect(await fetchResearchText(source.url, sourceHosts(source), publicRedirect)).toBe("public content");
  });

  it("looks past early navigation, keeps all main cards, and honors article paths without a story quota", () => {
    const cards = Array.from({ length: 15 }, (_, index) => `<article><header><a href="/research/report-${index}">Original adoption research report ${index}</a></header></article>`).join("");
    const html = `<main><nav><a href="/research/ignored">Navigation research resource</a></nav><a href="/pricing">Pricing and company plans overview</a><a href="/contact">Contact the research team today</a>${cards}<a href="/other/report">Another unrelated resource</a></main>`;
    expect(discoverResearchLinks(html, { ...source, articlePathPrefixes: ["/research/"], maxDiscoveryLinks: 12 })).toEqual(Array.from({ length: 15 }, (_, index) => `https://example.com/research/report-${index}`));
    expect(discoverResearchLinks(html, source)).toHaveLength(16);
  });

  it("reads image alt titles and prefers article routes over generic resources", () => {
    const html = '<main><a href="/library">Browse the full research library</a><a href="/p/new-research"><img alt="Original customer adoption research" src="/card.png"></a><a href="/research/report.pdf">Download the complete research PDF</a></main>';
    expect(discoverResearchLinks(html, { ...source, maxDiscoveryLinks: 1 })).toEqual(["https://example.com/p/new-research", "https://example.com/library"]);
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
    expect(discoverResearchLinks(html, { ...source, articlePathPrefixes: ["/news/"], maxDiscoveryLinks: 1 })).toEqual(["https://example.com/news/real-study", "https://example.com/news/second-study"]);
    expect(discoverResearchLinks(html, source)).toEqual([]);
    expect(discoverResearchLinks(html, { ...source, articlePathPrefixes: ["/news/"] })).toEqual([
      "https://example.com/news/real-study", "https://example.com/news/second-study",
    ]);
  });

  it("keeps a populated main authoritative instead of adding document-wide related links", () => {
    const html = '<main><a href="/news/main-study">Read more</a></main><section><a href="/news/related-study">Related research finding</a></section>';
    expect(discoverResearchLinks(html, { ...source, articlePathPrefixes: ["/news/"] })).toEqual(["https://example.com/news/main-study"]);
  });

  it("excludes Lyssna author and topic archives from article discovery", () => {
    const html = `<main>${["diane-leyman", "ai-in-user-research", "concept-testing", "product-management"].map(slug => `<a href="/blog/${slug}-articles">Research articles</a>`).join("")}<a href="/blog/2">More research articles</a><a href="/blog/ai-skills-for-research">AI skills for research</a><a href="/blog/mcp-launch">A new research connection</a></main>`;
    const lyssna = { ...source, url: "https://www.lyssna.com/blog/", articlePathPrefixes: ["/blog/"], maxDiscoveryLinks: 2 };
    expect(discoverResearchLinks(html, lyssna)).toEqual([
      "https://www.lyssna.com/blog/ai-skills-for-research", "https://www.lyssna.com/blog/mcp-launch",
    ]);
    expect(discoverResearchLinks(html, { ...lyssna, url: "https://example.com/blog/" })).toEqual([
      "https://example.com/blog/diane-leyman-articles", "https://example.com/blog/ai-in-user-research-articles",
      "https://example.com/blog/concept-testing-articles", "https://example.com/blog/product-management-articles",
      "https://example.com/blog/2", "https://example.com/blog/ai-skills-for-research", "https://example.com/blog/mcp-launch",
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

it("collects every returned feed entry beyond the old sixty-item cap", () => {
  const entries = Array.from({ length: 75 }, (_, i) => `<item><title>Study ${i}</title><link>https://example.com/research/${i}</link><pubDate>Mon, 26 Oct 2026 00:00:00 GMT</pubDate></item>`).join("");
  expect(parseResearchFeed(`<rss version="2.0"><channel>${entries}</channel></rss>`, source)).toHaveLength(75);
});
it("discovers every matching article beyond both legacy source and forty-link caps", () => {
  const html = `<main>${Array.from({ length: 55 }, (_, i) => `<a href="/research/report-${i}">Detailed original research report ${i}</a>`).join("")}</main>`;
  expect(discoverResearchLinks(html, { ...source, articlePathPrefixes: ["/research/"], maxDiscoveryLinks: 1 })).toHaveLength(55);
});


it('trusts only explicit article hosts without widening the feed entry point', async () => {
  const publisher = { ...source, feedUrl: 'https://example.com/feed', trustedArticleHosts: ['blog.google'] };
  expect(sourceHosts(publisher).has('blog.google')).toBe(false);
  expect(sourceArticleHosts(publisher).has('blog.google')).toBe(true);
  const xml = `<rss><channel>${['blog.google', 'news.blog.google', 'foreign.example'].map(host => `<item><title>Original research</title><link>https://${host}/article</link></item>`).join('')}</channel></rss>`;
  expect(parseResearchFeed(xml, publisher).map(item => item.url)).toEqual(['https://blog.google/article']);
  const redirect = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://blog.google/article' } }));
  await expect(fetchResearchText(publisher.feedUrl, sourceHosts(publisher), redirect)).rejects.toThrow('Source redirect rejected');
  let requests = 0;
  const approved = vi.fn(async () => ++requests === 1
    ? new Response(null, { status: 302, headers: { location: 'https://blog.google/article' } }) : new Response('Original publisher body'));
  expect(await fetchResearchText(source.url, sourceArticleHosts(publisher), approved)).toBe('Original publisher body');
  await expect(fetchResearchText(source.url, sourceArticleHosts(publisher), vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://news.blog.google/article' } })))).rejects.toThrow('Source redirect rejected');
});

it.each(['*.google', 'blog.google/path', 'blog.google?query=x', 'blog.google#fragment', 'blog.google:443', 'user@blog.google', '127.0.0.1', 'private.local'])('rejects non-exact trusted article host configuration: %s', host => {
  expect(() => sourceArticleHosts({ ...source, trustedArticleHosts: [host] })).toThrow();
});
