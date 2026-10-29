import { afterEach, describe, expect, it, vi } from "vitest";
import { hydrateFreshResearchEvidence } from "./research-evidence";
import type { CollectedItem } from "./research-collectors";
import type { ResearchSourceSeed } from "./research-types";

const source: ResearchSourceSeed = {
  id: "primary", name: "Primary", url: "https://example.com/", kind: "rss",
  feedUrl: "https://example.com/feed", category: "research", enabled: true,
  priority: 1, notes: "",
};
const begin = Date.parse("2026-10-22T12:00:00Z");
const end = begin + 86_400_000;
function item(overrides: Partial<CollectedItem> = {}): CollectedItem {
  return {
    url: "https://example.com/study", title: "Original study", excerpt: "",
    publishedAt: begin + 1000, contentType: "article", transcriptStatus: "not_applicable",
    ...overrides,
  };
}
afterEach(() => vi.unstubAllGlobals());
describe("fresh evidence before screening", () => {
  it("hydrates fresh title-only feeds before selection without mutating collected metadata", async () => {
    const original = item();
    const fetcher = vi.fn(async () => new Response(`<main><h1>Original study</h1><p>${"Specific original findings. ".repeat(50)}</p></main>`));
    vi.stubGlobal("fetch", fetcher);
    const [result] = await hydrateFreshResearchEvidence([original], source, begin, end);
    expect(result.content).toContain("Specific original findings");
    expect(result.contentProvenance).toBe("article");
    expect(result.excerpt).toContain("Specific original findings");
    expect(result.publishedAt).toBe(original.publishedAt);
    expect(original.content).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("preserves the complete fetched article and its late evidence during feed hydration", async () => {
    const prefix = "Earlier captured public context. ".repeat(1400).trim();
    const late = "The final paragraph supplies the specific decision, outcome boundary and uncertainty.";
    const content = `Original study\n\n${prefix}\n\n${late}`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`<main><h1>Original study</h1><p>${prefix}</p><p>${late}</p></main>`)));
    const original = item(), [result] = await hydrateFreshResearchEvidence([original], source, begin, end);
    expect(result.content).toBe(content); expect(result.content!.indexOf(late)).toBeGreaterThan(24_000);
    expect(result.excerpt).toBe(content.slice(0, 1600)); expect(result.publishedAt).toBe(original.publishedAt);
    expect(result.contentProvenance).toBe("article"); expect(original.content).toBeUndefined();
  });
  it("does not fetch undated, old, future, video or already readable items", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const entries = [item({ publishedAt: null }), item({ publishedAt: begin - 1 }),
      item({ publishedAt: end + 1 }), item({ contentType: "video" }), item({ content: "A public feed body" })];
    expect(await hydrateFreshResearchEvidence(entries, source, begin, end)).toEqual(entries);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps inaccessible and off-domain candidates for manual review without borrowing another page's text", async () => {
    const fetcher = vi.fn(async () => new Response("blocked", { status: 403 }));
    vi.stubGlobal("fetch", fetcher);
    const entries = [item(), item({ url: "https://unapproved.example/article" })];
    expect(await hydrateFreshResearchEvidence(entries, source, begin, end)).toEqual(entries);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("hydrates every eligible feed entry beyond the former twenty-four-item quota", async () => {
    const fetcher = vi.fn(async () => new Response(`<main>${"Body evidence. ".repeat(50)}</main>`));
    vi.stubGlobal("fetch", fetcher);
    const entries = Array.from({ length: 30 }, (_, index) => item({ url: `https://example.com/study-${index}` }));
    const results = await hydrateFreshResearchEvidence(entries, source, begin, end);
    expect(fetcher).toHaveBeenCalledTimes(30);
    expect(results).toHaveLength(30);
    expect(results.filter(row => row.content)).toHaveLength(30);
  });
});
