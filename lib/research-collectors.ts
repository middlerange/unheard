import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { ResearchSourceSeed } from "./research-types";
export type CollectedItem = {
  url: string;
  title: string;
  excerpt: string;
  publishedAt: number | null;
  content?: string;
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
  return new Set(
    [source.url, source.feedUrl]
      .filter(Boolean)
      .map((url) => new URL(url!).hostname),
  );
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
      url = assertPublicResearchUrl(new URL(target, url).href, allowedHosts);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
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
export function plainResearchText(raw: string) {
  return raw
    .replace(/<(script|style|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}
export function parseResearchDate(
  raw: unknown,
  now = Date.now(),
): number | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const parsed = Date.parse(raw);
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
  return entries.slice(0, 60).flatMap((entry: Record<string, unknown>) => {
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
export function articleResearchDate(html: string): number | null {
  const meta =
    html.match(
      /<meta\b[^>]*(?:property|name)=["'](?:article:published_time|datePublished|date|pubdate)["'][^>]*content=["']([^"']+)["']/i,
    )?.[1] ||
    html.match(
      /<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:article:published_time|datePublished|date|pubdate)["']/i,
    )?.[1] ||
    html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1] ||
    html.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1];
  return parseResearchDate(meta);
}
export function discoverResearchLinks(
  html: string,
  source: ResearchSourceSeed,
): string[] {
  const urls = new Set<string>();
  const region =
    html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ||
    html.replace(/<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  for (const match of region.matchAll(
    /<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi,
  )) {
    const attributes = `${match[1]} ${match[3]}`;
    const accessibleTitle =
      attributes.match(/\b(?:aria-label|title)=["']([^"']+)["']/i)?.[1] || "";
    if (
      Math.max(
        plainResearchText(match[4]).length,
        plainResearchText(accessibleTitle).length,
      ) < 15
    )
      continue;
    try {
      const url = canonicalResearchUrl(
        new URL(match[2].replace(/&amp;/g, "&"), source.url).href,
      );
      assertPublicResearchUrl(url, sourceHosts(source));
      if (
        url !== canonicalResearchUrl(source.url) &&
        !/\/(tag|category|about|contact|privacy|login|subscribe|archive)(\/|$)/i.test(
          new URL(url).pathname,
        )
      )
        urls.add(url);
    } catch {
      /* An external or invalid link is not a source article. */
    }
    if (urls.size >= 8) break;
  }
  return [...urls];
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
  const results = await Promise.allSettled(
    links.map(async (url) => {
      const html = await fetchResearchText(url, sourceHosts(source));
      return {
        url,
        title: plainResearchText(
          html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "",
        ).slice(0, 300),
        excerpt: articleResearchText(html).slice(0, 1600),
        publishedAt: articleResearchDate(html),
        contentType: "article" as const,
        transcriptStatus: "not_applicable" as const,
      };
    }),
  );
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
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  return plainResearchText(article || main || html);
}
