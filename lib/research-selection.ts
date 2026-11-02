import { and, eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { research_cache, research_runs } from "./schema";
import { getRunResearchFindings, saveResearchFindingSnapshot } from "./research-finding-snapshots";
import { researchFindingDates } from "./research-dates";
import { RESEARCH_POST_MIN_SCORE } from "./research-policy";
import { getSlackCredentials, getSlackIntegration, slackApi } from "./slack";
import { researchHash } from "./research-model";

type Selection = { runId: string; candidateIds: string[]; selectedIds: string[] };
const idFor = (runId: string) => `research-selection:${runId}`;
const normal = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const safe = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Keep distinct proposals selectable, while placing all angles from the same
// public source together. Stable tie breaks preserve predictable numbering.
export function groupResearchCandidates<T extends { id: string; url: string; score: number; content_angle: string }>(findings: T[]): T[][] {
  const groups = new Map<string, T[]>();
  const seen = new Set<string>();
  for (const finding of [...findings].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))) {
    const key = `${finding.url.trim()}\n${normal(finding.content_angle)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const source = finding.url.trim();
    const group = groups.get(source) || [];
    group.push(finding);
    groups.set(source, group);
  }
  const ordered = [...groups.values()];
  for (const group of ordered) group.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return ordered.sort((a, b) => b[0].score - a[0].score || a[0].url.localeCompare(b[0].url) || a[0].id.localeCompare(b[0].id));
}

export async function selectTopResearchAngles(teamId: string, runId: string) {
  const db = await getDb();
  const existing = await db.select().from(research_cache).where(and(eq(research_cache.id, idFor(runId)), eq(research_cache.team_id, teamId))).get();
  if (existing) return { count: (JSON.parse(existing.value) as Selection).selectedIds.length };
  const run = await db.select().from(research_runs).where(and(eq(research_runs.id, runId), eq(research_runs.team_id, teamId))).get();
  if (!run) throw new Error("Research run not found");
  const integration = await getSlackIntegration(teamId);
  if (!integration?.enabled || !integration.channel_id) throw new Error("Slack approval channel is not enabled");
  const sourceIds = new Set(JSON.parse(run.source_ids) as string[]);
  const groups = groupResearchCandidates((await getRunResearchFindings(teamId, runId)).filter(f => {
    if (!sourceIds.has(f.source_id) || f.score < RESEARCH_POST_MIN_SCORE || f.status === "dismissed" ||
      (researchFindingDates(f).publishedAt !== null && f.published_at > run.created_at)) return false;
    return true;
  }));
  const top = groups.map(group => group[0]);
  for (const finding of top) await saveResearchFindingSnapshot(finding);
  const selection: Selection = { runId, candidateIds: top.map(f => f.id), selectedIds: top.map(f => f.id) };
  await db.insert(research_cache).values({ id: idFor(runId), team_id: teamId, value: JSON.stringify(selection), created_at: Date.now() }).onConflictDoNothing();
  return { count: top.length };
}

export async function notifyResearchChannel(teamId: string, runId: string, text: string) {
  const db = await getDb();
  const integration = await getSlackIntegration(teamId);
  if (!integration?.enabled || !integration.channel_id) return;
  const noticeId = `research-selection-notice:${runId}:${await researchHash(text)}`;
  const claimed = await db.insert(research_cache).values({ id: noticeId, team_id: teamId, value: "attempted", created_at: Date.now() }).onConflictDoNothing().returning({ id: research_cache.id });
  if (!claimed.length) return;
  const { botToken } = await getSlackCredentials(teamId);
  await slackApi(botToken, "chat.postMessage", { channel: integration.channel_id, text: safe(text).slice(0, 3000), unfurl_links: false, unfurl_media: false });
}
