import {
  articleResearchText,
  fetchResearchText,
  sourceHosts,
  type CollectedItem,
} from "./research-collectors";
import type { ResearchSourceSeed } from "./research-types";

// Give screening usable article evidence even when a feed contains only a title.
export async function hydrateFreshResearchEvidence(
  items: CollectedItem[],
  source: ResearchSourceSeed,
  windowStart: number,
  windowEnd: number,
): Promise<CollectedItem[]> {
  const enriched = items.map((item) => ({ ...item }));
  const candidates = enriched.filter((item) =>
    item.contentType === "article" && !item.content &&
    item.publishedAt !== null && item.publishedAt >= windowStart &&
    item.publishedAt <= windowEnd,
  );
  for (let start = 0; start < candidates.length; start += 3) {
    await Promise.all(candidates.slice(start, start + 3).map(async (item) => {
      try {
        const content = articleResearchText(
          await fetchResearchText(item.url, sourceHosts(source)),
        ).slice(0, 14_000);
        if (content.length < 500) return;
        item.content = content;
        item.contentProvenance = "article";
        if (item.excerpt.length < 120) item.excerpt = content.slice(0, 1600);
      } catch {
        // Keep metadata for review; evidence fetching can be retried after screening.
      }
    }));
  }
  return enriched;
}
