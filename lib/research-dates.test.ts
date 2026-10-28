import { describe, expect, it } from "vitest";
import { researchFindingDates, researchFindingSourceContext, researchItemSignalKind } from "./research-dates";

describe("truthful research source dates", () => {
  const now = Date.parse("2026-10-28T12:00:00Z"), firstSeen = now - 1000;
  const run = { created_at: now, days: 1 };

  it("keeps legacy snapshot publication dates and writer context unchanged", () => {
    const legacy = { published_at: now - 2000 };
    expect(researchFindingDates(legacy)).toEqual({ publishedAt: legacy.published_at, discoveredAt: null, signalKind: null });
    expect(researchFindingSourceContext(legacy, run, firstSeen)).toEqual({
      publishedAt: new Date(legacy.published_at).toISOString(), discoveredAt: new Date(firstSeen).toISOString(), signalKind: "fresh",
    });
    expect(researchFindingDates({ ...legacy, source_published_at: null, source_discovered_at: null, signal_kind: null })).toEqual(researchFindingDates(legacy));
  });

  it("exposes an undated reference as unknown publication and genuine first observation", () => {
    const reference = { published_at: firstSeen, source_published_at: null, source_discovered_at: firstSeen, signal_kind: "undated_reference" };
    expect(researchFindingDates(reference)).toEqual({ publishedAt: null, discoveredAt: firstSeen, signalKind: "undated_reference" });
    expect(researchFindingSourceContext(reference, run, now)).toEqual({
      publishedAt: null, discoveredAt: new Date(firstSeen).toISOString(), signalKind: "undated_reference",
    });
  });

  it("never labels unknown publication as fresh and retains older original dates", () => {
    expect(researchItemSignalKind({ published_at: null }, run)).toBe("undated_reference");
    expect(researchItemSignalKind({ published_at: now - 1000 }, run)).toBe("fresh");
    expect(researchItemSignalKind({ published_at: now - 180 * 86_400_000 }, run)).toBe("evergreen_newly_discovered");
  });

  it("keeps the body observation separate from unknown publication and the original first sighting", () => {
    const oldFirstSeen = now - 180 * 86_400_000;
    const reference = { published_at: oldFirstSeen, source_published_at: null, source_discovered_at: oldFirstSeen, source_content_changed_at: now, signal_kind: "undated_reference" };
    expect(researchFindingDates(reference)).toEqual({ publishedAt: null, discoveredAt: oldFirstSeen, contentChangedAt: now, signalKind: "undated_reference" });
    expect(researchFindingSourceContext(reference, run, firstSeen)).toEqual({ publishedAt: null, discoveredAt: new Date(oldFirstSeen).toISOString(), contentChangedAt: new Date(now).toISOString(), signalKind: "undated_reference" });
  });
});
