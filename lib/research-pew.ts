import {
  assertPublicResearchUrl, canonicalResearchUrl, fetchResearchText, plainResearchText,
  type CollectedItem,
} from "./research-collectors";
import type { ResearchSourceSeed } from "./research-types";

const pewHosts = new Set(["www.pewresearch.org", "pewresearch.org"]);
const sourceId = "pew-ai-original-research";
const routes = [
  { prefix: "/short-reads/", collection: "short-read", type: "short-read" },
  { prefix: "/internet/", collection: "posts", type: "post" },
  { prefix: "/data-labs/", collection: "posts", type: "post" },
];

export function isPewResearchSource(source: ResearchSourceSeed) {
  return source.id === sourceId;
}

export function pewResearchBodyText(raw: string, title: string) {
  const withoutMarkup = raw
    .replace(/<!--[\s\S]*?-->|<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(ul|div)\b[^>]*class=["'][^"']*\bwp-block-social-links\b[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(?:p|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<\/?[a-zA-Z](?:"[^"]*"|'[^']*'|[^'">])*>/g, " ")
    // Older saved text can contain already-decoded, malformed widget attributes.
    .replace(/<\/?[a-zA-Z][^>]*>/g, " ");
  let text = withoutMarkup.split(/\n+/).map(plainResearchText).filter(Boolean).join("\n");
  text = text.replace(/^(?:Short Reads|Report)\s*\|\s*[A-Za-z]+\s+\d{1,2},\s+\d{4}\s*/i, "");
  const normalizedTitle = plainResearchText(title);
  if (normalizedTitle && text.toLowerCase().startsWith(normalizedTitle.toLowerCase())) text = text.slice(normalizedTitle.length).trim();
  text = text
    .replace(/^(?:(?:X|Facebook|Threads|LinkedIn|WhatsApp|Mail|Twitter)\s+){2,}/, "")
    .replace(/\b[\p{Lu}][\p{L}'’.-]*(?:\s+[\p{Lu}][\p{L}'’.-]*){1,3}\s+is\s+(?:a|an)\s+[^.!?]{0,220}\b(?:at|with)\s+Pew Research Center\s*\.?/gu, " ")
    .replace(/^\([^)]{0,180}(?:Getty|Images|Photo|Reuters)[^)]*\)\s*/i, "")
    .trim();
  return text;
}

/** Reject publisher chrome as cached evidence; editorial quality is assessed later. */
export function hasUsablePewResearchBody(content: string | null | undefined, title: string) {
  if (!content) return false;
  if (/\bdata-wp-[\w:-]+\s*=/i.test(content)) return false;
  const text = pewResearchBodyText(content, title);
  if (!text || /^(?:(?:X|Facebook|Threads|LinkedIn|WhatsApp|Mail|Twitter)\s*)+$/.test(text)) return false;
  return /[\p{L}\p{N}][^\n]*[.!?](?:\s|$)/u.test(text)
    || text.split("\n").some(line => /\p{L}/u.test(line) && /\d/.test(line));
}

function publicationDate(value: unknown, windowEnd: number) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?$/.test(value)) return null;
  const unzoned = value.replace(/Z$/, "");
  const parsed = Date.parse(`${unzoned}Z`);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= windowEnd
    && new Date(parsed).toISOString().slice(0, 19) === unzoned ? parsed : null;
}

export async function fetchPewResearchArticle(
  source: ResearchSourceSeed, originalUrl: string, windowEnd: number,
): Promise<CollectedItem> {
  if (!isPewResearchSource(source)) throw new Error("Pew JSON is restricted to its registered research source");
  assertPublicResearchUrl(source.url, pewHosts);
  const original = assertPublicResearchUrl(originalUrl, pewHosts);
  const route = routes.find(candidate => original.pathname.startsWith(candidate.prefix));
  const scoped = source.articlePathPrefixes?.some(prefix => original.pathname.startsWith(`${prefix.replace(/\/$/, "")}/`));
  const slug = original.pathname.split("/").filter(Boolean).at(-1);
  if (!route || !scoped || !slug || !/^[a-z0-9-]+$/i.test(slug)) throw new Error("Pew article is outside the configured research paths");

  // These collections are advertised by the publisher's AI category JSON.
  const endpoint = new URL(`https://www.pewresearch.org/wp-json/wp/v2/${route.collection}`);
  endpoint.searchParams.set("categories", "299");
  endpoint.searchParams.set("slug", slug);
  const response: unknown = JSON.parse(await fetchResearchText(endpoint.href, pewHosts));
  if (!Array.isArray(response)) throw new Error("Pew JSON did not return public article records");
  const matches = response.filter(record => {
    if (!record || typeof record !== "object" || typeof record.link !== "string") return false;
    try { return canonicalResearchUrl(assertPublicResearchUrl(record.link, pewHosts).href) === canonicalResearchUrl(originalUrl); }
    catch { return false; }
  });
  if (matches.length !== 1) throw new Error("Pew JSON must return exactly one matching canonical article");
  const record = matches[0];
  if (record.status !== "publish" || record.type !== route.type || !Array.isArray(record.categories) || !record.categories.includes(299)
    || !record.content || record.content.protected !== false || typeof record.content.rendered !== "string") {
    throw new Error("Pew JSON article is not public, unprotected AI research of the expected type");
  }
  const title = typeof record.title?.rendered === "string" ? plainResearchText(record.title.rendered).slice(0, 300) : "";
  const publishedAt = publicationDate(record.date_gmt, windowEnd);
  if (!title || publishedAt === null) throw new Error("Pew JSON article lacks its original title or valid publication date");
  const content = pewResearchBodyText(record.content.rendered, title).slice(0, 14_000);
  if (!hasUsablePewResearchBody(content, title)) throw new Error("Pew JSON article has no substantive body beyond publisher metadata");
  return {
    url: originalUrl, title, publishedAt, excerpt: content.slice(0, 1600), content,
    contentProvenance: "article", contentType: "article", transcriptStatus: "not_applicable",
  };
}
