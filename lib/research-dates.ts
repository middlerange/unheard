export type ResearchSignalKind = "fresh" | "evergreen_newly_discovered" | "undated_reference";
type RunWindow = { created_at: number; days: number };
type FindingDates = {
  published_at?: number;
  source_published_at?: number | null;
  source_discovered_at?: number | null;
  source_content_changed_at?: number | null;
  signal_kind?: string | null;
};

export function researchItemSignalKind(item: { published_at: number | null }, run: RunWindow): ResearchSignalKind {
  if (item.published_at === null) return "undated_reference";
  return item.published_at >= run.created_at - run.days * 86_400_000 ? "fresh" : "evergreen_newly_discovered";
}

export function researchFindingDates(finding: FindingDates) {
  return {
    publishedAt: finding.signal_kind === "undated_reference" ? null : finding.source_published_at ?? finding.published_at ?? null,
    discoveredAt: finding.source_discovered_at ?? null,
    signalKind: (finding.signal_kind ?? null) as ResearchSignalKind | null,
    ...(finding.source_content_changed_at == null ? {} : { contentChangedAt: finding.source_content_changed_at }),
  };
}

export function researchFindingSourceContext(finding: FindingDates, run: RunWindow, firstSeen: number) {
  const dates = researchFindingDates(finding);
  return {
    publishedAt: dates.publishedAt === null ? null : new Date(dates.publishedAt).toISOString(),
    discoveredAt: new Date(dates.discoveredAt ?? firstSeen).toISOString(),
    signalKind: dates.signalKind ?? researchItemSignalKind({ published_at: dates.publishedAt }, run),
    ...(dates.signalKind === "undated_reference" && dates.contentChangedAt != null
      ? { contentChangedAt: new Date(dates.contentChangedAt).toISOString() } : {}),
  };
}
