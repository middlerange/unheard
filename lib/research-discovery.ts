import {
  articleResearchDate, articleResearchSection, articleResearchText, articleResearchTitle, assertPublicResearchUrl,
  assertResearchArticleSectionWatch, ResearchArticleSectionError,
  canonicalResearchUrl, collectResearchSource, fetchResearchText,
  discoverResearchLinks, parseResearchDate, plainResearchText, sourceArticleHosts, sourceHosts, type CollectedItem,
} from "./research-collectors";
import type { ResearchSourceSeed } from "./research-types";
import { fetchPewResearchArticle, isPewResearchSource } from "./research-pew";
import { canUseFreePublicWatchFetch, fetchFreePublicWatchHtml, PUBLIC_FETCH_RETRIEVAL_NOTE } from "./research-public-fetch";

type SearchHit = { url: string; title: string; snippet?: string };
type SearchResults = { hits: SearchHit[]; warnings: string[]; pages: number; exhaustive: boolean };
export type DiscoveryArticleTarget = { url: string; title?: string };
export type DiscoveryCollection = {
  items: CollectedItem[];
  warning: string | null;
  pendingArticles?: DiscoveryArticleTarget[];
  coverage?: { queries: number; resultPages: number; receivedHits: number; candidatePages: number; exhaustive: boolean };
};

export async function fetchDiscoveredResearchArticle(
  source: ResearchSourceSeed,
  target: DiscoveryArticleTarget,
  windowEnd: number,
  htmlOverride?: string,
): Promise<CollectedItem> {
  assertResearchArticleSectionWatch(source);
  if (source.articleSectionHeading !== undefined && canonicalResearchUrl(target.url) !== canonicalResearchUrl(source.url))
    throw new ResearchArticleSectionError("Public chapter watches only apply to their explicitly configured article");
  if (isPewResearchSource(source) && source.articleSectionHeading === undefined) return fetchPewResearchArticle(source, target.url, windowEnd);
  const candidateSource = { ...source, url: target.url, feedUrl: undefined };
  const hosts = sourceArticleHosts(source.kind === "search" ? candidateSource : source);
  assertPublicResearchUrl(target.url, hosts);
  let html = htmlOverride;
  let retrievalNote: string | undefined;
  if (html === undefined) {
    try { html = await fetchResearchText(target.url, hosts); }
    catch (error) {
      const fallbackSource: ResearchSourceSeed = { ...candidateSource, kind: "web", pageMode: "article" };
      if (source.kind !== "rss" || !source.feedUrl || !source.freeArticleFallback || !canUseFreePublicWatchFetch(fallbackSource, error, hosts)) throw error;
      html = await fetchFreePublicWatchHtml(fallbackSource, hosts);
      retrievalNote = PUBLIC_FETCH_RETRIEVAL_NOTE;
    }
  }
  const url = new URL(target.url);
  const arxivId = url.hostname === "arxiv.org"
    ? url.pathname.match(/^\/(abs|html)\/(\d{4}\.\d{4,5})(?:v\d+)?\/?$/) : null;
  const publicationHtml = arxivId?.[1] === "html"
    ? await fetchResearchText(`https://arxiv.org/abs/${arxivId[2]}`, new Set(["arxiv.org", "www.arxiv.org"])) : html;
  const publishedAt = arxivId ? firstArxivSubmission(publicationHtml, windowEnd) : articleResearchDate(html, target.url, windowEnd);
  const abstractOnly = arxivId?.[1] === "abs";
  const repositoryReadme = url.hostname === "github.com" && /^\/[^/]+\/[^/]+\/?$/.test(url.pathname)
    ? html.match(/<article\b[^>]*class=["'][^"']*\bmarkdown-body\b[^"']*["'][^>]*>[\s\S]*?<\/article>/i)?.[0] : undefined;
  const section = source.articleSectionHeading === undefined ? null : articleResearchSection(html, source.articleSectionHeading);
  const content = (section?.content ?? (abstractOnly ? researchAbstractText(html) : articleResearchText(repositoryReadme || html))).slice(0, 14_000);
  const heading = arxivId
    ? html.match(/<h1\b[^>]*class=["'][^"']*\b(?:title|ltx_title_document)\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    : articleResearchTitle(repositoryReadme || html);
  const pageTitle = plainResearchText(heading || "").replace(/^Title:\s*/i, "");
  return {
    url: target.url,
    title: (section?.title || pageTitle || plainResearchText(target.title || "")).slice(0, 300),
    excerpt: content.slice(0, 1600),
    publishedAt,
    ...(retrievalNote ? { retrievalNote } : {}),
    contentProvenance: section ? "public_section" : abstractOnly ? "abstract" : "article",
    ...(content.length >= 500 ? { content } : {}),
    contentType: "article",
    transcriptStatus: "not_applicable",
  };
}

async function includeResearchBackfills(
  source: ResearchSourceSeed,
  collection: DiscoveryCollection,
  deferArticleFetch: boolean,
  windowEnd: number,
): Promise<DiscoveryCollection> {
  if (!source.backfillUrls?.length) return collection;
  const existing = new Set(collection.items.map(item => canonicalResearchUrl(item.url)));
  const pending = new Map((collection.pendingArticles || []).map(target => [canonicalResearchUrl(target.url), target]));
  const warnings = collection.warning ? [collection.warning] : [];
  for (const raw of source.backfillUrls) {
    try {
      const url = canonicalResearchUrl(assertPublicResearchUrl(raw, source.kind === "search" ? undefined : sourceArticleHosts(source)).href);
      if (!existing.has(url) && !pending.has(url)) pending.set(url, { url });
    } catch {
      warnings.push("A configured original-source backfill URL was rejected as nonpublic or outside the approved publisher.");
    }
  }
  if (deferArticleFetch) return { ...collection, pendingArticles: [...pending.values()], warning: [...new Set(warnings)].join(" ") || null };
  const items = [...collection.items];
  for (const target of pending.values()) {
    try { items.push(await fetchDiscoveredResearchArticle(source, target, windowEnd)); }
    catch { warnings.push(`Original-source backfill could not be read: ${target.url}`); }
  }
  return { ...collection, items, pendingArticles: undefined, warning: [...new Set(warnings)].join(" ") || null };
}

export function researchAbstractText(html: string) {
  return plainResearchText(html.match(/<blockquote\b[^>]*class=["'][^"']*\babstract\b[^"']*["'][^>]*>([\s\S]*?)<\/blockquote>/i)?.[1] || "");
}

export function researchDiscoveryBlockedHosts(sources: ResearchSourceSeed[]) {
  return new Set(sources.filter(source => source.category === "competitor")
    .flatMap(source => [new URL(source.url).hostname.replace(/^www\./, ""), ...(source.discoveryBlockedHosts ?? [])]));
}

function firstArxivSubmission(html: string, now: number) {
  const history = html.match(/<h[2-6]\b[^>]*>\s*Submission history\s*<\/h[2-6]>([\s\S]{0,12000})/i)?.[1];
  const original = history && plainResearchText(history).match(/\[v1\]\s*((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+\d{1,2}\s+[A-Za-z]+\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+UTC)/)?.[1];
  return parseResearchDate(original, now);
}

function excludedPublisher(url: URL, blockedHosts: Set<string>) {
  const host = url.hostname.replace(/^www\./, "");
  return [...blockedHosts].some(blocked => host === blocked || host.endsWith(`.${blocked}`))
    || /(^|\.)(reddit\.com|facebook\.com|instagram\.com|threads\.(com|net)|tiktok\.com|linkedin\.com|twitter\.com|x\.com|youtube\.com|dice\.com|jobgether\.com|remotejobs\.[\w.]+|builtin[\w]*\.(com|org)|greenhouse\.io|lever\.co|ashbyhq\.com)$/.test(host)
    || /\/(careers?|jobs?|job-detail|offer|pricing|contact|login|signup|tags?|categor(?:y|ies)|solutions|industries)(\/|$)/i.test(url.pathname);
}

async function searchPublicResearch(query: string, windowStart: number, news: boolean): Promise<SearchResults> {
  const token = process.env.TREG_TOKEN;
  if (!token) throw new Error("Topic discovery is unavailable: configure the server search connection.");
  const url = new URL(news ? "https://treg.to/call/tinyfish.web.search.news" : "https://treg.to/call/tinyfish.web.search");
  url.searchParams.set("domain_type", news ? "news" : "web");
  url.searchParams.set("query", query);
  url.searchParams.set("language", "en");
  url.searchParams.set("recency_minutes", String(Math.min(43_200, Math.max(1, Math.ceil((Date.now() - windowStart) / 60_000)))));
  const headers: Record<string, string> = {
    "X-Treg-Token": token,
    "X-Treg-Route-Max-Cost": "0",
    "X-Treg-Route-Waterfall": "0",
  };
  if (process.env.TREG_ORG) headers["X-Treg-Org"] = process.env.TREG_ORG;
  const response = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(25_000) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Topic search returned HTTP ${response.status}`);
  }
  const payload = await response.json() as { results?: SearchHit[]; result?: { results?: SearchHit[] } };
  const results = payload.results ?? payload.result?.results;
  if (!Array.isArray(results)) throw new Error("Topic search returned no result list");
  return {
    hits: results.filter(hit => typeof hit?.url === "string" && typeof hit?.title === "string"),
    warnings: ["Search coverage includes every returned valid hit; further provider pagination is unverified and this is not full-web coverage."],
    pages: 1,
    exhaustive: false,
  };
}

async function searchHackerNewsSignals(query: string, windowStart: number, windowEnd: number): Promise<SearchResults> {
  const url = new URL("https://hn.algolia.com/api/v1/search_by_date");
  url.searchParams.set("query", query);
  url.searchParams.set("tags", "story");
  url.searchParams.set("numericFilters", `created_at_i>=${Math.floor(windowStart / 1000)},created_at_i<=${Math.floor(windowEnd / 1000)}`);
  url.searchParams.set("hitsPerPage", "100");
  const hits: SearchHit[] = [];
  const warnings: string[] = [];
  let pageCount = 1, pages = 0, received = 0, totalHits: number | null = null;
  let exhaustive = true;
  for (let page = 0; page < pageCount; page++) {
    url.searchParams.set("page", String(page));
    try {
      const text = await fetchResearchText(url.href, new Set(["hn.algolia.com"]));
      const payload = JSON.parse(text) as {
        hits?: Array<{ url?: unknown; title?: unknown }>;
        nbPages?: number; page?: number; nbHits?: number; exhaustiveNbHits?: boolean;
      };
      if (!Array.isArray(payload.hits)) throw new Error("Hacker News discovery returned no result list");
      if (payload.page !== undefined && payload.page !== page) throw new Error("Hacker News returned an unexpected result page");
      pages++;
      received += payload.hits.length;
      hits.push(...payload.hits.flatMap(hit => typeof hit?.url === "string" && typeof hit?.title === "string" ? [{ url: hit.url, title: hit.title }] : []));
      if (page === 0) {
        const validPages = Number.isSafeInteger(payload.nbPages) && payload.nbPages! >= 0;
        if (validPages && (payload.nbPages !== 0 || payload.hits.length === 0)) pageCount = Math.max(1, payload.nbPages!);
        else {
          exhaustive = false;
          warnings.push("Hacker News pagination metadata is missing or invalid; only the first returned page could be verified.");
        }
        totalHits = Number.isSafeInteger(payload.nbHits) && payload.nbHits! >= 0 ? payload.nbHits! : null;
        const lower = Math.floor(windowStart / 1000), upper = Math.floor(windowEnd / 1000);
        if (validPages && payload.nbPages! > 0 && totalHits !== null && totalHits > pageCount * 100 && lower < upper) {
          const middle = lower + Math.floor((upper - lower) / 2);
          const parts: SearchResults[] = [];
          const partitionWarnings = [...warnings, "Hacker News query was split into nonoverlapping timestamp windows to recover results beyond its pagination ceiling."];
          for (const [from, to] of [[lower, middle], [middle + 1, upper]]) {
            try { parts.push(await searchHackerNewsSignals(query, from * 1000, to * 1000)); }
            catch (error) { partitionWarnings.push(`Hacker News timestamp window ${from}–${to} failed; readable results were retained (${error instanceof Error ? error.message : "unreadable response"}).`); }
          }
          return {
            hits: [...hits, ...parts.flatMap(part => part.hits)],
            warnings: [...partitionWarnings, ...parts.flatMap(part => part.warnings)],
            pages: pages + parts.reduce((total, part) => total + part.pages, 0),
            exhaustive: parts.length === 2 && parts.every(part => part.exhaustive),
          };
        }
      } else if (payload.nbPages !== pageCount) {
        exhaustive = false;
        warnings.push("Hacker News page count changed during collection; coverage uses the initial page count.");
      }
      if (payload.exhaustiveNbHits !== true) exhaustive = false;
      if (payload.hits.length === 0 && page + 1 < pageCount) {
        exhaustive = false;
        warnings.push("Hacker News returned an empty page before its reported end; pagination stopped and earlier results were retained.");
        break;
      }
    } catch (error) {
      if (page === 0) throw error;
      exhaustive = false;
      warnings.push(`Hacker News result page ${page + 1}/${pageCount} failed; earlier results were retained (${error instanceof Error ? error.message : "unreadable response"}).`);
      break;
    }
  }
  if (totalHits === null || received < totalHits) exhaustive = false;
  if (!exhaustive) warnings.push(`Hacker News returned ${received}${totalHits === null ? "" : `/${totalHits}`} hits across ${pages} result pages; provider-limited or incomplete coverage is not exhaustive.`);
  return { hits, warnings, pages, exhaustive };
}

export async function collectDiscoveredResearchSource(
  source: ResearchSourceSeed,
  windowStart: number,
  windowEnd: number,
  blockedHosts: Set<string>,
  options: { deferArticleFetch?: boolean } = {},
): Promise<DiscoveryCollection> {
  assertResearchArticleSectionWatch(source);
  if (source.kind === "web" && source.pageMode === "article") {
    const target = { url: source.url, title: source.name };
    try { return { items: [await fetchDiscoveredResearchArticle(source, target, windowEnd)], warning: null }; }
    catch (error) {
      if (error instanceof ResearchArticleSectionError || isPewResearchSource(source) || !canUseFreePublicWatchFetch(source, error)) throw error;
      const html = await fetchFreePublicWatchHtml(source);
      const item = await fetchDiscoveredResearchArticle(source, target, windowEnd, html);
      return { items: [{ ...item, retrievalNote: PUBLIC_FETCH_RETRIEVAL_NOTE }], warning: PUBLIC_FETCH_RETRIEVAL_NOTE };
    }
  }
  if (source.kind !== "search") {
    let collection: DiscoveryCollection;
    try {
      if (!options.deferArticleFetch || source.feedUrl || source.kind !== "web") collection = { items: await collectResearchSource(source), warning: null };
      else {
        const html = await fetchResearchText(source.url, sourceHosts(source));
        const urls = discoverResearchLinks(html, source);
        if (!urls.length && !source.backfillUrls?.length) throw new Error("No public article links found in the source content region");
        collection = { items: [], pendingArticles: urls.map(url => ({ url })), warning: null };
      }
    } catch (error) {
      if (!source.backfillUrls?.length) throw error;
      collection = { items: [], warning: `Source entry point failed (${error instanceof Error ? error.message : "unreadable response"}); explicitly configured original URLs remain available for collection.` };
    }
    if (source.kind === "rss" && source.feedUrl && source.hydratePublishedWindowOnly)
      collection.items = collection.items.filter(item => item.publishedAt !== null && item.publishedAt >= windowStart && item.publishedAt <= windowEnd);
    return includeResearchBackfills(source, collection, Boolean(options.deferArticleFetch), windowEnd);
  }
  const queries = source.discoveryQueries ?? [];
  if (!queries.length) throw new Error("Topic discovery needs at least one query");
  const searched = await Promise.allSettled(queries.map(query => source.discoveryProvider === "hackernews"
    ? searchHackerNewsSignals(query, windowStart, windowEnd)
    : searchPublicResearch(query, windowStart, source.discoverySearchType === "news")));
  const lists = searched.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  if (!lists.length) {
    if (source.backfillUrls?.length) return includeResearchBackfills(source, { items: [], warning: `${queries.length}/${queries.length} topic searches failed; explicitly configured original URLs remain available for collection.` }, Boolean(options.deferArticleFetch), windowEnd);
    throw (searched[0] as PromiseRejectedResult).reason;
  }
  const urls = new Map<string, SearchHit>();
  for (let position = 0; position < Math.max(...lists.map(list => list.hits.length)); position++) {
    for (const list of lists) {
      const hit = list.hits[position];
      if (!hit) continue;
      try {
        const url = assertPublicResearchUrl(hit.url);
        if (excludedPublisher(url, blockedHosts)) continue;
        const canonical = canonicalResearchUrl(url.href);
        if (!urls.has(canonical)) urls.set(canonical, { ...hit, url: canonical });
      } catch { /* Search results can include invalid or nonpublic links. */ }
    }
  }
  const candidates = [...urls.values()];
  const failedQueries = searched.length - lists.length;
  const warnings = [...new Set(lists.flatMap(list => list.warnings))];
  const coverage = {
    queries: queries.length,
    resultPages: lists.reduce((total, list) => total + list.pages, 0),
    receivedHits: lists.reduce((total, list) => total + list.hits.length, 0),
    candidatePages: candidates.length,
    exhaustive: failedQueries === 0 && lists.every(list => list.exhaustive),
  };
  if (options.deferArticleFetch) {
    if (failedQueries) warnings.push(`${failedQueries}/${queries.length} topic searches failed; remaining discovery results were retained.`);
    return includeResearchBackfills(source, { items: [], pendingArticles: candidates.map(({ url, title }) => ({ url, title })), warning: warnings.join(" ") || null, coverage }, true, windowEnd);
  }
  const items: CollectedItem[] = [];
  let unreadable = 0;
  for (let start = 0; start < candidates.length; start += 4) {
    await Promise.all(candidates.slice(start, start + 4).map(async hit => {
      try {
        items.push(await fetchDiscoveredResearchArticle(source, hit, windowEnd));
      } catch { unreadable++; }
    }));
  }
  if (failedQueries || unreadable) warnings.push(`${failedQueries}/${queries.length} topic searches failed; ${unreadable}/${candidates.length} candidate pages could not be read. Returned ${items.length} original-page records; only verified publication dates qualify.`);
  return includeResearchBackfills(source, {
    items,
    warning: warnings.join(" ") || null,
    coverage: { ...coverage, exhaustive: unreadable === 0 && coverage.exhaustive },
  }, false, windowEnd);
}
