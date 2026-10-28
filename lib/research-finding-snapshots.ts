import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./db/client";
import { research_cache, research_findings } from "./schema";
import { retryResearchStorage } from "./research-storage";

type SourceDateFields = "source_published_at" | "source_discovered_at" | "signal_kind";
export type ResearchFindingRow = Omit<typeof research_findings.$inferSelect, SourceDateFields>
  & Partial<Pick<typeof research_findings.$inferSelect, SourceDateFields>>;

export function researchFindingSnapshotId(runId: string, findingId: string) {
  return `research-finding-snapshot:${runId}:${findingId}`;
}

export function researchRunFindingsCount(teamId: string, runId: string) {
  const prefix = `research-finding-snapshot:${runId}:`;
  return sql<number>`(SELECT COUNT(*) FROM (
    SELECT id FROM research_findings WHERE team_id = ${teamId} AND run_id = ${runId}
    UNION
    SELECT substr(id, ${prefix.length + 1}) FROM research_cache
    WHERE team_id = ${teamId} AND substr(id, 1, ${prefix.length}) = ${prefix}
  ))`;
}

export async function saveResearchFindingSnapshot(finding: ResearchFindingRow) {
  const db = await getDb();
  const value = JSON.stringify(finding), createdAt = Date.now();
  await retryResearchStorage(async () => db.insert(research_cache).values({
    id: researchFindingSnapshotId(finding.run_id, finding.id),
    team_id: finding.team_id, value, created_at: createdAt,
  }).onConflictDoNothing());
}

export async function getRunResearchFindings(teamId: string, runId: string, findingIds?: string[]) {
  const db = await getDb();
  const prefix = `research-finding-snapshot:${runId}:`;
  const snapshots: Array<typeof research_cache.$inferSelect> = [];
  const live = new Map<string, ResearchFindingRow>();
  let legacy: ResearchFindingRow[];
  if (findingIds) {
    for (let start = 0; start < findingIds.length; start += 80) {
      const ids = findingIds.slice(start, start + 80);
      const [cached, rows] = await Promise.all([
        db.select().from(research_cache).where(and(eq(research_cache.team_id, teamId),
          inArray(research_cache.id, ids.map(id => researchFindingSnapshotId(runId, id))))).all(),
        db.select().from(research_findings).where(and(eq(research_findings.team_id, teamId),
          inArray(research_findings.id, ids))).all(),
      ]);
      snapshots.push(...cached);
      for (const row of rows) live.set(row.id, row);
    }
    legacy = [...live.values()].filter(row => row.run_id === runId);
  } else {
    const [cached, rows] = await Promise.all([
      db.select().from(research_cache).where(and(eq(research_cache.team_id, teamId),
        sql`substr(${research_cache.id}, 1, ${prefix.length}) = ${prefix}`)).all(),
      db.select().from(research_findings).where(and(eq(research_findings.team_id, teamId),
        eq(research_findings.run_id, runId))).all(),
    ]);
    snapshots.push(...cached);
    legacy = rows;
    for (const row of rows) live.set(row.id, row);
  }
  const findings = new Map<string, ResearchFindingRow>(legacy.map(row => [row.id, row]));
  for (const snapshot of snapshots) {
    const finding = JSON.parse(snapshot.value) as ResearchFindingRow;
    if (finding.team_id !== teamId || finding.run_id !== runId
      || researchFindingSnapshotId(runId, finding.id) !== snapshot.id) {
      throw new Error("Run finding snapshot identity does not match its cache key");
    }
    findings.set(finding.id, finding);
  }
  const ids = [...findings.keys()].filter(id => !live.has(id));
  for (let start = 0; start < ids.length; start += 80) {
    const rows = await db.select().from(research_findings).where(and(
      eq(research_findings.team_id, teamId), inArray(research_findings.id, ids.slice(start, start + 80)),
    )).all();
    for (const row of rows) live.set(row.id, row);
  }
  return [...findings.values()].flatMap(finding => {
    const current = live.get(finding.id);
    return current ? [{ ...finding, status: current.status, idea_id: current.idea_id }] : [];
  }).sort((a, b) => b.score - a.score || b.published_at - a.published_at || a.id.localeCompare(b.id));
}

export async function getDraftResearchFindings(teamId: string, drafts: Array<{ runId: string; findingId: string }>) {
  const findings = new Map<string, ResearchFindingRow>();
  for (const runId of new Set(drafts.map(draft => draft.runId))) {
    const ids = [...new Set(drafts.filter(draft => draft.runId === runId).map(draft => draft.findingId))];
    for (const finding of await getRunResearchFindings(teamId, runId, ids)) {
      findings.set(`${runId}:${finding.id}`, finding);
    }
  }
  return findings;
}
