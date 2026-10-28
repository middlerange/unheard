import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { ResearchSourceSeed } from "./research-types";
export type CollectedItem = {
  url: string;
  title: string;
  excerpt: string;
  publishedAt: number | null;
  content?: string;
  contentProvenance?: "public_feed" | "article" | "transcript" | "abstract";
  retrievalNote?: string;
  contentType: "article" | "video";
  transcriptStatus: "not_applicable" | "unavailable" | "available";
};
const MAX_BYTES = 1_500_000;
export function canonicalResearchUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|fbclid$|gclid$|ref$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/$/, "");
  return url.href;
}
export function assertPublicResearchUrl(
  raw: string,
  allowedHosts?: Set<string>,
) {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !host.includes(".") ||
    /[\[\]:]/.test(host) ||
    /^(\d{1,3}\.){3}\d{1,3}$/.test(host) ||
    /(^|\.)(localhost|local|internal|test|invalid|arpa)$/.test(host)
  )
    throw new Error("Only public HTTPS source URLs are allowed");
  if (allowedHosts && !allowedHosts.has(host))
    throw new Error("URL is outside the approved source domains");
  return url;
}
export function sourceHosts(source: ResearchSourceSeed) {
  const hosts = new Set(
    [source.url, source.feedUrl]
      .filter(Boolean)
      .map((url) => new URL(url!).hostname),
  );
  const host = new URL(source.url).hostname;
  hosts.add(host.startsWith("www.") ? host.slice(4) : `www.${host}`);
  return hosts;
}
export class ResearchRateLimitError extends Error {
  readonly retryAfterMs: number | null;
  constructor(readonly hostname: string, readonly retryAfter: string | null) {
    super("Source returned HTTP 429");
    this.name = "ResearchRateLimitError";
    const seconds = retryAfter?.trim() && /^\d+(?:\.\d+)?$/.test(retryAfter.trim()) ? Number(retryAfter) : NaN;
    const date = retryAfter ? Date.parse(retryAfter) : NaN;
    this.retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
  }
}
export async function fetchResearchText(
  raw: string,
  allowedHosts: Set<string>,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  let url = assertPublicResearchUrl(raw, allowedHosts);
  const signal = AbortSignal.timeout(12_000);
  for (let i = 0; i < 4; i++) {
    const response = await fetcher(url.href, {
      redirect: "manual",
      signal,
      headers: {
        "User-Agent": "ContentHubResearch/1.0",
        Accept:
          "text/html,application/rss+xml,application/atom+xml,application/xml,text/xml",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const target = response.headers.get("location");
      await response.body?.cancel();
      if (!target) throw new Error("Redirect without a destination");
      let destination: URL;
      try { destination = new URL(target, url); }
      catch { throw new Error("Redirect destination is invalid"); }
      try { url = assertPublicResearchUrl(destination.href, allowedHosts); }
      catch { throw new Error(`Source redirect rejected (host: ${destination.hostname}); only public HTTPS URLs on approved source domains are allowed`); }
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) throw new ResearchRateLimitError(url.hostname, response.headers.get("retry-after"));
      throw new Error(`Source returned HTTP ${response.status}`);
    }
    if (Number(response.headers.get("content-length") || 0) > MAX_BYTES) {
      await response.body?.cancel();
      throw new Error("Source response is too large");
    }
    const type = response.headers.get("content-type") || "";
    if (type && !/(text\/|xml|json)/i.test(type)) {
      await response.body?.cancel();
      throw new Error("Source is not readable text");
    }
    const reader = response.body?.getReader();
    if (!reader) return "";
    let bytes = 0;
    const decoder = new TextDecoder();
    let output = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_BYTES) throw new Error("Source response is too large");
        output += decoder.decode(chunk.value, { stream: true });
      }
      return output + decoder.decode();
    } finally {
      await reader.cancel();
    }
  }
  throw new Error("Too many redirects");
}
function decodedResearchMarkup(raw: string) {
  const entities: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  };
  let decoded = raw;
  for (let pass = 0; pass < 2; pass++) {
    const next = decoded.replace(/&(#(?:x[0-9a-f]{1,6}|\d{1,7})|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name: string) => {
      if (!name.startsWith("#")) return entities[name.toLowerCase()];
      const hex = /^#x/i.test(name);
      const codepoint = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      return codepoint > 0 && codepoint <= 0x10ffff && !(codepoint >= 0xd800 && codepoint <= 0xdfff)
        ? String.fromCodePoint(codepoint)
        : entity;
    });
    if (next === decoded) break;
    decoded = next;
  }
  return decoded
    .replace(/<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->|<![^>]*>/g, " ");
}
const researchMarkupTag = /<\/?[a-zA-Z](?:"[^"]*"|'[^']*'|[^'">])*>/g;
export function plainResearchText(raw: string) {
  return decodedResearchMarkup(raw)
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(researchMarkupTag, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function readableResearchText(raw: string) {
  return decodedResearchMarkup(raw)
    .replace(/<\/?(?:h[1-6]|p|div|section|article|main|blockquote|ul|ol|dl|table|tr)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi, "\n\n")
    .replace(/<\/?(?:li|dt|dd)\b(?:"[^"]*"|'[^']*'|[^'">])*>|<br\b[^>]*>/gi, "\n")
    .replace(researchMarkupTag, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 14_000);
}
export function parseResearchDate(
  raw: unknown,
  now = Date.now(),
): number | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const value = raw.trim();
  const dateOnly = /^[A-Za-z]+\s+\d{1,2},?\s+\d{4}$/.test(value);
  const unzonedIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value);
  let normalized = value;
  if (dateOnly) normalized = `${value} UTC`;
  else if (unzonedIso) normalized = `${value}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= now + 86_400_000
    ? parsed
    : null;
}
function nodeText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (value && typeof value === "object")
    return nodeText((value as Record<string, unknown>)["#text"]);
  return "";
}
const list = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
export function parseResearchFeed(
  xml: string,
  source: ResearchSourceSeed,
): CollectedItem[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("Unsupported XML document declarations");
  if (XMLValidator.validate(xml) !== true)
    throw new Error("Source returned malformed XML");
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    processEntities: false,
    parseTagValue: false,
  }).parse(xml);
  if (!parsed.rss && !parsed.feed && !parsed["rdf:RDF"])
    throw new Error("Source did not return RSS or Atom");
  const entries = list(
    parsed.rss?.channel?.item || parsed.feed?.entry || parsed["rdf:RDF"]?.item,
  );
  return entries.flatMap((entry: Record<string, unknown>) => {
    const link = list(entry.link).find(
      (candidate: unknown) =>
        typeof candidate === "string" ||
        (candidate &&
          typeof candidate === "object" &&
          (!(candidate as Record<string, unknown>)["@_rel"] ||
            (candidate as Record<string, unknown>)["@_rel"] === "alternate")),
    );
    const raw =
      typeof link === "string"
        ? link
        : nodeText((link as Record<string, unknown>)?.["@_href"]);
    try {
      const url = canonicalResearchUrl(new URL(raw, source.url).href);
      assertPublicResearchUrl(url, sourceHosts(source));
      const title = plainResearchText(nodeText(entry.title)).slice(0, 300);
      if (!title || !raw) return [];
      const publicBody = source.kind === "youtube" ? "" : readableResearchText(
        nodeText(entry["content:encoded"] || entry.content),
      );
      return [
        {
          url,
          title,
          excerpt: plainResearchText(
            nodeText(
              entry.description ||
                entry.summary ||
                entry["content:encoded"] ||
                entry.content ||
                (entry["media:group"] as Record<string, unknown>)?.[
                  "media:description"
                ],
            ),
          ).slice(0, 1600),
          publishedAt: parseResearchDate(
            nodeText(entry.pubDate || entry.published || entry["dc:date"]),
          ),
          ...(publicBody.length >= 500 ? {
            content: publicBody,
            contentProvenance: "public_feed" as const,
          } : {}),
          contentType:
            source.kind === "youtube"
              ? ("video" as const)
              : ("article" as const),
          transcriptStatus:
            source.kind === "youtube"
              ? ("unavailable" as const)
              : ("not_applicable" as const),
        },
      ];
    } catch {
      return [];
    }
  });
}
function htmlAttributes(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(
    /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
  )].map(match => [match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]]));
}

function htmlElements(html: string, name: string) {
  const elements: Array<{ start: number; end: number; content: string }> = [];
  const stack: Array<{ start: number; contentStart: number }> = [];
  const tags = new RegExp(`<(/?)${name}\\b(?:"[^"]*"|'[^']*'|[^'">])*>`, "gi");
  for (const tag of html.matchAll(tags)) {
    if (!tag[1]) stack.push({ start: tag.index, contentStart: tag.index + tag[0].length });
    else {
      const opening = stack.pop();
      if (opening) elements.push({ start: opening.start, end: tag.index + tag[0].length, content: html.slice(opening.contentStart, tag.index) });
    }
  }
  return elements.sort((a, b) => a.start - b.start);
}

function articleRegion(html: string): string {
  const clean = html.replace(/<!--[\s\S]*?-->|<(script|style|nav|footer|aside)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/\1>/gi, " ");
  const mains = htmlElements(clean, "main");
  const articles = htmlElements(clean, "article");
  const headings = htmlElements(clean, "h1");
  const title = plainResearchText(clean.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").toLowerCase();
  const matchingHeading = headings.find(heading => {
    const text = plainResearchText(heading.content).toLowerCase();
    return text.length >= 12 && (title === text || title.startsWith(`${text} |`) || title.startsWith(`${text} —`) || title.startsWith(`${text} -`));
  });
  const contains = (element: { start: number; end: number }, heading: { start: number; end: number }) => element.start <= heading.start && element.end >= heading.end;
  const heading = matchingHeading
    || headings.find(candidate => mains.some(main => contains(main, candidate)))
    || headings.find(candidate => articles.some(article => contains(article, candidate)));
  if (heading) {
    const article = articles.filter(candidate => contains(candidate, heading)).sort((a, b) => a.content.length - b.content.length)[0];
    const main = mains.find(candidate => contains(candidate, heading));
    if (article) return article.content;
    if (main) return main.content;
    // Some newsletter pages have no semantic wrapper; require the page's own title.
    if (matchingHeading) return clean.slice(matchingHeading.start);
  }
  return mains[0]?.content || articles.sort((a, b) => b.content.length - a.content.length)[0]?.content || "";
}

function publisherBylineDate(html: string, articleUrl: string | undefined, now: number): number | null {
  if (!articleUrl) return null;
  let url: URL;
  try { url = new URL(articleUrl); } catch { return null; }
  const host = url.hostname.replace(/^www\./, "");
  const wynter = host === "wynter.com" && /^\/post\/[^/]+\/?$/.test(url.pathname);
  const measuringU = host === "measuringu.com" && /^\/(?!blogs?\/?$)[^/]+\/?$/.test(url.pathname);
  const posthog = host === "posthog.com" && /^\/blog\/[^/]+\/?$/.test(url.pathname);
  if (!wynter && !measuringU && !posthog) return null;
  const clean = html.replace(/<!--[\s\S]*?-->|<(script|style|nav|footer|aside)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/\1>/gi, " ");
  const region = wynter ? clean : articleRegion(clean);
  const heading = htmlElements(region, "h1")[0];
  if (!heading) return null;
  const hasClass = (element: { start: number; end: number }, name: string, content: string) => {
    const opening = content.slice(element.start, content.indexOf(">", element.start) + 1);
    return (htmlAttributes(opening).class || "").split(/\s+/).includes(name);
  };
  if (posthog) {
    const following = region.slice(heading.end);
    const byline = htmlElements(following, "div")[0];
    if (!byline || following.slice(0, byline.start).trim()
      || !["flex", "items-center", "space-x-2", "mb-4", "flex-wrap"].every(name => hasClass(byline, name, following))
      || !/href=["']\/community\/profiles\/\d+["']/.test(byline.content)) return null;
    const dates = htmlElements(byline.content, "p").filter(element => {
      const opening = byline.content.slice(element.start, byline.content.indexOf(">", element.start) + 1);
      const attributes = htmlAttributes(opening);
      return !/modified|updated/i.test(`${attributes.itemprop || ""} ${attributes.class || ""}`)
        && ["text-sm", "text-secondary", "m-0"].every(name => hasClass(element, name, byline.content));
    });
    if (dates.length !== 1) return null;
    const visibleDate = plainResearchText(dates[0].content);
    return /^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}$/.test(visibleDate)
      ? parseResearchDate(visibleDate, now) : null;
  }
  // These publishers expose publication dates only in their own title/byline widgets.
  const containers = htmlElements(region, wynter ? "div" : "section")
    .filter(element => element.start <= heading.start && element.end >= heading.end
      && hasClass(element, wynter ? "content-container" : "elementor-top-section", region))
    .sort((a, b) => a.content.length - b.content.length);
  const byline = containers[0]?.content;
  if (!byline) return null;
  const dates = htmlElements(byline, "div").filter(element =>
    hasClass(element, wynter ? "wfu-post-byline-date" : "post-date", byline),
  );
  if (dates.length !== 1) return null;
  const visibleDate = plainResearchText(dates[0].content);
  if (!/^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}$/.test(visibleDate)) return null;
  return parseResearchDate(visibleDate, now);
}

export function articleResearchDate(
  html: string,
  articleUrl?: string,
  now = Date.now(),
): number | null {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = htmlAttributes(tag[0]);
    if (!/^(article:published_time|datePublished|pubdate)$/i.test(attributes.property || attributes.name || "")) continue;
    const date = parseResearchDate(attributes.content, now);
    if (date !== null) return date;
  }
  const articles: Array<Record<string, unknown>> = [];
  function readStructured(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(readStructured);
    } else if (value && typeof value === "object") {
      const row = value as Record<string, unknown>;
      const types = Array.isArray(row["@type"]) ? row["@type"] : [row["@type"]];
      if (types.some(type => typeof type === "string" && /(?:^|[/#])(Article|BlogPosting|NewsArticle|Report|TechArticle|SocialMediaPosting|WebPage)$/i.test(type))) articles.push(row);
      if (row["@graph"]) readStructured(row["@graph"]);
      if (row.mainEntity) readStructured(row.mainEntity);
    }
  }
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/^application\/ld\+json$/i.test(htmlAttributes(script[1]).type || "")) continue;
    try { readStructured(JSON.parse(script[2])); } catch { /* Ignore malformed structured data. */ }
  }
  function structuredIdentity(article: Record<string, unknown>) {
    const page = article.mainEntityOfPage;
    let identity = article.url || article["@id"];
    if (!identity && typeof page === "string") identity = page;
    else if (!identity && page && typeof page === "object") identity = (page as Record<string, unknown>)["@id"];
    return identity;
  }
  const matching = articleUrl ? articles.filter(article => {
    const identity = structuredIdentity(article);
    try { return typeof identity === "string" && canonicalResearchUrl(identity) === canonicalResearchUrl(articleUrl); } catch { return false; }
  }) : [];
  const unscopedArticles = articles.filter(article => {
    const types = list(article["@type"]);
    return !types.some(type => typeof type === "string" && /(?:^|[/#])WebPage$/i.test(type))
      && (!articleUrl || !structuredIdentity(article));
  });
  const article = matching.find(candidate => parseResearchDate(candidate.datePublished, now) !== null)
    || (matching.length === 0 && unscopedArticles.length === 1 ? unscopedArticles[0] : undefined);
  const structuredDate = parseResearchDate(article?.datePublished, now);
  if (structuredDate !== null) return structuredDate;
  let region = articleRegion(html);
  // Embedded repository/paper/related-story cards have their own publication dates.
  const children = htmlElements(region, "article");
  for (const child of children.filter(candidate => !children.some(parent => parent.start < candidate.start && parent.end >= candidate.end)).sort((a, b) => b.start - a.start)) {
    region = region.slice(0, child.start) + " " + region.slice(child.end);
  }
  for (const match of region.matchAll(/<time\b([^>]*)>([\s\S]*?)<\/time>/gi)) {
    const attributes = htmlAttributes(match[1]);
    if (/modified|updated/i.test(`${attributes.itemprop || ""} ${attributes.class || ""}`)) continue;
    const preceding = plainResearchText(region.slice(Math.max(0, match.index - 80), match.index));
    const explicit = /^datePublished$/i.test(attributes.itemprop || "")
      || /\bpubdate(?:\s|=|$)/i.test(match[1])
      || /\b(published|entry-date|post-date|published-date|posted-on)\b/i.test(attributes.class || "")
      || /\bPublished(?:\s+on)?\s*:?\s*$/i.test(preceding);
    if (!explicit) continue;
    const date = parseResearchDate(attributes.datetime, now);
    if (date !== null) return date;
  }
  const publisherDate = publisherBylineDate(html, articleUrl, now);
  if (publisherDate !== null) return publisherDate;
  const published = plainResearchText(region.replace(/<\/?header\b[^>]*>/gi, "")).match(
    /\bPublished(?:\s+on)?\s*:?\s+((?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+\d{4}|\d{4}-\d{2}-\d{2})\b/i,
  )?.[1];
  return parseResearchDate(published?.replace(/(\d)(st|nd|rd|th)\b/gi, "$1"), now);
}
export function discoverResearchLinks(
  html: string,
  source: ResearchSourceSeed,
): string[] {
  const urls = new Map<string, number>();
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  const region = main !== undefined
    ? main.replace(/<(nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    : html.replace(/<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  function readLinks(content: string): void {
    for (const match of content.matchAll(
      /<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi,
    )) {
      const attributes = `${match[1]} ${match[3]}`;
      const accessibleTitle =
        attributes.match(/\b(?:aria-label|title)=["']([^"']+)["']/i)?.[1]
        || match[4].match(/<img\b[^>]*alt=["']([^"']+)["']/i)?.[1] || "";
      const labelLength = Math.max(
        plainResearchText(match[4]).length,
        plainResearchText(accessibleTitle).length,
      );
      try {
        const url = canonicalResearchUrl(
          new URL(match[2].replace(/&amp;/g, "&"), source.url).href,
        );
        assertPublicResearchUrl(url, sourceHosts(source));
        const path = new URL(url).pathname;
        if (url === canonicalResearchUrl(source.url)
          || /\/(tags?|categor(?:y|ies)|about|contact|privacy|terms|login|sign-?in|subscribe|archive|search|authors?|teams?|people|topics?|careers|jobs|pricing|demo)(\/|$)/i.test(path)
          || /\.(pdf|zip|png|jpe?g|gif|mp[34])$/i.test(path)) continue;
        if (new URL(url).hostname.replace(/^www\./, "") === "lyssna.com"
          && /^\/blog\/(?:[^/]+-articles|\d+)\/?$/.test(path)) continue;
        const prefixes = source.articlePathPrefixes;
        const scopedArticle = prefixes?.some(prefix => path.startsWith(`${prefix.replace(/\/$/, "")}/`));
        if (prefixes?.length && !scopedArticle) continue;
        // Publisher article paths also cover overlay links with no text inside.
        if (!scopedArticle && labelLength < 15) continue;
        const score = scopedArticle ? 100 : (/\/p\/[^/]+/.test(path) ? 100 : 0)
          + (/\/(blog|articles?|research|insights|posts|widget|news)\/[^/]+/i.test(path) ? 60 : 0)
          + (/\/\d{4}\/\d{1,2}\//.test(path) ? 70 : 0)
          + (labelLength >= 40 ? 5 : 0);
        urls.set(url, Math.max(urls.get(url) || 0, score));
      } catch {
        /* An external or invalid link is not a source article. */
      }
    }
  }
  readLinks(region);
  if (!urls.size && main !== undefined && source.articlePathPrefixes?.length) {
    readLinks(html.replace(/<(script|style|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " "));
  }
  return [...urls].sort((a, b) => b[1] - a[1]).map(([url]) => url);
}
export async function collectResearchSource(
  source: ResearchSourceSeed,
): Promise<CollectedItem[]> {
  if (source.feedUrl)
    return parseResearchFeed(
      await fetchResearchText(source.feedUrl, sourceHosts(source)),
      source,
    );
  if (source.kind === "community" || source.kind === "youtube")
    throw new Error("A public feed is required for this source");
  const index = await fetchResearchText(source.url, sourceHosts(source));
  const links = discoverResearchLinks(index, source);
  if (!links.length)
    throw new Error(
      "No public article links found in the source content region",
    );
  const results: PromiseSettledResult<CollectedItem>[] = [];
  for (let start = 0; start < links.length; start += 4) {
    results.push(...await Promise.allSettled(links.slice(start, start + 4).map(async (url) => {
      const html = await fetchResearchText(url, sourceHosts(source));
      const content = articleResearchText(html).slice(0, 14_000);
      return {
        url,
        title: articleResearchTitle(html),
        excerpt: content.slice(0, 1600),
        publishedAt: articleResearchDate(html, url),
        ...(content.length >= 500 ? { content, contentProvenance: "article" as const } : {}),
        contentType: "article" as const,
        transcriptStatus: "not_applicable" as const,
      };
    })));
  }
  const items = results.flatMap((result) =>
    result.status === "fulfilled" && result.value.title ? [result.value] : [],
  );
  if (!items.length)
    throw new Error("Discovered source articles could not be read");
  return items;
}

function embeddedJsonArray(html: string, key: string): unknown[] {
  const marker = `"${key}":`;
  const found = html.indexOf(marker);
  if (found < 0) return [];
  const start = html.indexOf("[", found + marker.length);
  if (start < 0 || start - found > 80) return [];
  let depth = 0,
    quoted = false,
    escaped = false;
  for (
    let index = start;
    index < Math.min(html.length, start + 80_000);
    index++
  ) {
    const char = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "[") depth++;
    else if (char === "]" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, index + 1)) as unknown[];
      } catch {
        return [];
      }
    }
  }
  return [];
}
export function parsePublicCaptionTracks(
  html: string,
): Array<{ baseUrl: string; languageCode: string }> {
  return embeddedJsonArray(html, "captionTracks").flatMap((track) => {
    if (!track || typeof track !== "object") return [];
    const row = track as Record<string, unknown>;
    return typeof row.baseUrl === "string" &&
      typeof row.languageCode === "string"
      ? [{ baseUrl: row.baseUrl, languageCode: row.languageCode }]
      : [];
  });
}
export function parsePublicCaptionText(json: string) {
  const data = JSON.parse(json) as {
    events?: Array<{ segs?: Array<{ utf8?: string }> }>;
  };
  return (data.events || [])
    .flatMap((event) => (event.segs || []).map((segment) => segment.utf8 || ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24_000);
}
export async function fetchPublicYoutubeTranscript(
  videoUrl: string,
): Promise<string | null> {
  try {
    const watch = assertPublicResearchUrl(
      videoUrl,
      new Set(["www.youtube.com", "youtube.com"]),
    );
    if (
      watch.pathname !== "/watch" ||
      !/^[a-zA-Z0-9_-]{11}$/.test(watch.searchParams.get("v") || "")
    )
      return null;
    const html = await fetchResearchText(
      watch.href,
      new Set(["www.youtube.com", "youtube.com"]),
    );
    const tracks = parsePublicCaptionTracks(html);
    const track =
      tracks.find((candidate) => /^en(?:-|$)/i.test(candidate.languageCode)) ||
      tracks[0];
    if (!track) return null;
    const captionUrl = assertPublicResearchUrl(
      track.baseUrl,
      new Set(["www.youtube.com", "youtube.com", "video.google.com"]),
    );
    if (!["/api/timedtext", "/timedtext"].includes(captionUrl.pathname))
      return null;
    captionUrl.searchParams.set("fmt", "json3");
    const transcript = parsePublicCaptionText(
      await fetchResearchText(captionUrl.href, new Set([captionUrl.hostname])),
    );
    return transcript.length >= 500 ? transcript : null;
  } catch {
    return null;
  }
}

export function articleResearchText(html: string) {
  const region = articleRegion(html);
  return readableResearchText(region ? region.replace(/<\/?header\b[^>]*>/gi, "") : html);
}

export function articleResearchTitle(html: string) {
  return plainResearchText(
    htmlElements(articleRegion(html), "h1")[0]?.content
      || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "",
  ).slice(0, 300);
}
