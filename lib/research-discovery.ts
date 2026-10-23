import {
  articleResearchDate, articleResearchText, articleResearchTitle, assertPublicResearchUrl,
  canonicalResearchUrl, collectResearchSource, fetchResearchText,
  parseResearchDate, plainResearchText, sourceHosts, type CollectedItem,
} from "./research-collectors";
import type { ResearchSourceSeed } from "./research-types";

type SearchHit = { url: string; title: string; snippet?: string };
export type DiscoveryCollection = { items: CollectedItem[]; warning: string | null };

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

async function searchPublicResearch(query: string, windowStart: number, news: boolean): Promise<SearchHit[]> {
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
  const response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(25_000) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Topic search returned HTTP ${response.status}`);
  }
  const payload = await response.json() as { results?: SearchHit[]; result?: { results?: SearchHit[] } };
  const results = payload.results ?? payload.result?.results;
  if (!Array.isArray(results)) throw new Error("Topic search returned no result list");
  return results.filter(hit => typeof hit.url === "string" && typeof hit.title === "string").slice(0, 10);
}

export async function collectDiscoveredResearchSource(
  source: ResearchSourceSeed,
  windowStart: number,
  windowEnd: number,
  blockedHosts: Set<string>,
): Promise<DiscoveryCollection> {
  if (source.kind !== "search") return { items: await collectResearchSource(source), warning: null };
  const queries = source.discoveryQueries?.slice(0, 3) ?? [];
  if (!queries.length) throw new Error("Topic discovery needs at least one query");
  const searched = await Promise.allSettled(queries.map(query => searchPublicResearch(query, windowStart, source.discoverySearchType === "news")));
  const lists = searched.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  if (!lists.length) throw (searched[0] as PromiseRejectedResult).reason;
  const urls = new Map<string, SearchHit>();
  // Round-robin search positions so one query cannot consume the whole page budget.
  for (let position = 0; position < 10; position++) {
    for (const list of lists) {
      const hit = list[position];
      if (!hit) continue;
      try {
        const url = assertPublicResearchUrl(hit.url);
        if (excludedPublisher(url, blockedHosts)) continue;
        const canonical = canonicalResearchUrl(url.href);
        if (!urls.has(canonical)) urls.set(canonical, { ...hit, url: canonical });
      } catch { /* Search results can include invalid or nonpublic links. */ }
    }
  }
  const pageBudget = queries.length >= 3 ? 14 : 12;
  let plannedPages = 0;
  const candidates = [...urls.values()].filter(hit => {
    const url = new URL(hit.url);
    const pages = url.hostname === "arxiv.org" && url.pathname.startsWith("/html/") ? 2 : 1;
    if (plannedPages + pages > pageBudget) return false;
    plannedPages += pages;
    return true;
  });
  const items: CollectedItem[] = [];
  let unreadable = 0;
  for (let start = 0; start < candidates.length; start += 4) {
    await Promise.all(candidates.slice(start, start + 4).map(async hit => {
      try {
        const candidateSource = { ...source, url: hit.url, feedUrl: undefined };
        const html = await fetchResearchText(hit.url, sourceHosts(candidateSource));
        const url = new URL(hit.url);
        const arxivId = url.hostname === "arxiv.org"
          ? url.pathname.match(/^\/(abs|html)\/(\d{4}\.\d{4,5})(?:v\d+)?\/?$/) : null;
        const publicationHtml = arxivId?.[1] === "html"
          ? await fetchResearchText(`https://arxiv.org/abs/${arxivId[2]}`, new Set(["arxiv.org", "www.arxiv.org"])) : html;
        // Search timestamps and snippets are hints, never publication or evidence.
        const publishedAt = arxivId ? firstArxivSubmission(publicationHtml, windowEnd) : articleResearchDate(html, hit.url, windowEnd);
        const abstractOnly = arxivId?.[1] === "abs";
        const content = (abstractOnly
          ? researchAbstractText(html)
          : articleResearchText(html)).slice(0, 14_000);
        const heading = arxivId
          ? html.match(/<h1\b[^>]*class=["'][^"']*\b(?:title|ltx_title_document)\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1]
          : articleResearchTitle(html);
        const pageTitle = plainResearchText(heading || "").replace(/^Title:\s*/i, "");
        const title = (pageTitle || plainResearchText(hit.title)).slice(0, 300);
        items.push({
          url: hit.url, title, excerpt: content.slice(0, 1600), publishedAt,
          contentProvenance: abstractOnly ? "abstract" : "article",
          ...(content.length >= 500 ? { content } : {}),
          contentType: "article", transcriptStatus: "not_applicable",
        });
      } catch { unreadable++; }
    }));
  }
  const failedQueries = searched.length - lists.length;
  const warning = failedQueries || unreadable
    ? `${failedQueries}/${queries.length} topic searches failed; ${unreadable}/${candidates.length} candidate pages could not be read. Returned ${items.length} original-page records; only verified publication dates qualify.`
    : null;
  return { items, warning };
}
