import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./db/client";
import { research_cache, research_runs } from "./schema";
import { getRunResearchFindings, saveResearchFindingSnapshot } from "./research-finding-snapshots";
import { researchFindingDates } from "./research-dates";
import { RESEARCH_POST_MIN_SCORE } from "./research-policy";
import { getSlackCredentials, getSlackIntegration, slackApi } from "./slack";
import { researchHash } from "./research-model";

type Selection = {
  runId: string; candidateIds: string[]; selectedIds: string[];
  titles?: string[];
  channelId: string; threadTs?: string; state: "sending" | "sent" | "delivery_unknown";
};
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

// A snapshot is frozen before the network call. A lost Slack response is never
// automatically retried, because it could otherwise send a duplicate message.
export async function sendResearchSelection(teamId: string, runId: string) {
  const db = await getDb();
  const existing = await db.select().from(research_cache).where(and(eq(research_cache.id, idFor(runId)), eq(research_cache.team_id, teamId))).get();
  if (existing) {
    const state = JSON.parse(existing.value) as Selection;
    if (state.state !== "sent") throw new Error("Candidate message delivery is unconfirmed; check Slack before retrying.");
    return { count: state.candidateIds.length, sent: true };
  }
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
  const candidates = groups.flat();
  if (!candidates.length) return { count: 0, sent: false };
  for (const candidate of candidates) await saveResearchFindingSnapshot(candidate);
  const header = `*Research candidates (${candidates.length} angles from ${groups.length} sources)*\nSources are grouped by their highest-scoring angle; scores do not predict performance. Reply with numbers to write, for example: 1, 3, 7, or the exact title of one candidate. No writing starts until you select.\n\n`;
  const excerpt = (value: string, limit: number) => value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
  const render = (titleLimit: number, angleLimit: number) => {
    let index = 0;
    return header + groups.map(group => {
      const first = group[0], title = safe(excerpt(first.title, titleLimit));
      const url = /^https?:\/\/[^\s<>|]+$/i.test(first.url) ? first.url : "";
      const heading = `*${url ? `<${url}|${title}>` : title}*`;
      return [heading, ...group.map(f => `${++index}. ${safe(excerpt(f.content_angle, angleLimit))} (score ${f.score})`)].join("\n");
    }).join("\n\n");
  };
  let titleLimit = Infinity;
  let message = render(titleLimit, Infinity);
  if (message.length > 39000) { titleLimit = 180; message = render(titleLimit, 160); }
  if (message.length > 39000) { titleLimit = 80; message = render(titleLimit, 80); }
  if (message.length > 39000) throw new Error(`The ${candidates.length} candidates exceed Slack's single-message limit; no candidates were sent or written.`);
  const selection: Selection = { runId, candidateIds: candidates.map(f => f.id), titles: candidates.map(f => excerpt(f.title, titleLimit)), selectedIds: [], channelId: integration.channel_id, state: "sending" };
  const inserted = await db.insert(research_cache).values({ id: idFor(runId), team_id: teamId, value: JSON.stringify(selection), created_at: Date.now() }).onConflictDoNothing().returning({ id: research_cache.id });
  if (!inserted.length) throw new Error("Candidate message is already being sent; check Slack before retrying.");
  try {
    const { botToken } = await getSlackCredentials(teamId);
    const result = await slackApi<{ ts: string }>(botToken, "chat.postMessage", { channel: integration.channel_id, text: message, unfurl_links: false, unfurl_media: false });
    if (!result.ts) throw new Error("Slack did not return a message timestamp");
    selection.state = "sent"; selection.threadTs = result.ts;
    await db.update(research_cache).set({ value: JSON.stringify(selection) }).where(and(eq(research_cache.id, idFor(runId)), eq(research_cache.team_id, teamId)));
    return { count: candidates.length, sent: true };
  } catch (error) {
    selection.state = "delivery_unknown";
    await db.update(research_cache).set({ value: JSON.stringify(selection) }).where(and(eq(research_cache.id, idFor(runId)), eq(research_cache.team_id, teamId)));
    throw error;
  }
}

export function parseSelectionNumbers(text: string, count: number): number[] | null {
  const trimmed = text.trim();
  if (!/^\d+(?:[\s,]+\d+)*$/.test(trimmed)) return null;
  const numbers = [...new Set(trimmed.split(/[\s,]+/).map(Number))];
  if (!numbers.length || numbers.some(n => !Number.isSafeInteger(n) || n < 1 || n > count)) return null;
  return numbers;
}

export async function findSelectionForThread(teamId: string, channelId: string, threadTs: string) {
  const db = await getDb();
  const row = await db.select().from(research_cache).where(and(eq(research_cache.team_id, teamId),
    sql`substr(${research_cache.id}, 1, 19) = 'research-selection:'`,
    sql`json_extract(${research_cache.value}, '$.channelId') = ${channelId}`,
    sql`json_extract(${research_cache.value}, '$.threadTs') = ${threadTs}`,
    sql`json_extract(${research_cache.value}, '$.state') = 'sent'`)).get();
  return row ? JSON.parse(row.value) as Selection : null;
}

export async function notifySelectionThread(teamId: string, runId: string, text: string) {
  const db = await getDb();
  const row = await db.select().from(research_cache).where(and(eq(research_cache.id, idFor(runId)), eq(research_cache.team_id, teamId))).get();
  if (!row) return;
  const selection = JSON.parse(row.value) as Selection;
  if (selection.state !== "sent" || !selection.threadTs) return;
  const integration = await getSlackIntegration(teamId);
  if (!integration?.enabled || integration.channel_id !== selection.channelId) return;
  const noticeId = `research-selection-notice:${runId}:${await researchHash(text)}`;
  const claimed = await db.insert(research_cache).values({ id: noticeId, team_id: teamId, value: "attempted", created_at: Date.now() }).onConflictDoNothing().returning({ id: research_cache.id });
  if (!claimed.length) return;
  const { botToken } = await getSlackCredentials(teamId);
  await slackApi(botToken, "chat.postMessage", { channel: selection.channelId, thread_ts: selection.threadTs, text: safe(text).slice(0, 3000), unfurl_links: false, unfurl_media: false });
}

export async function processSelectionReply(teamId: string, input: { runId: string; userId: string; channelId: string; threadTs: string; text: string }, eventId: string) {
  const db = await getDb();
  const integration = await getSlackIntegration(teamId);
  if (!integration?.enabled || integration.channel_id !== input.channelId || !(JSON.parse(integration.approver_user_ids) as string[]).includes(input.userId)) throw new Error("Slack approver is no longer authorized");
  let selectedIds: string[] = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    const row = await db.select().from(research_cache).where(and(eq(research_cache.id, idFor(input.runId)), eq(research_cache.team_id, teamId))).get();
    if (!row) throw new Error("Candidate selection not found");
    const selection = JSON.parse(row.value) as Selection;
    if (selection.state !== "sent" || selection.channelId !== input.channelId || selection.threadTs !== input.threadTs) throw new Error("Candidate selection thread does not match");
    let numbers = parseSelectionNumbers(input.text, selection.candidateIds.length);
    if (!numbers && selection.titles) {
      const matches = selection.titles.flatMap((title, i) => normal(title) === normal(input.text) ? [i + 1] : []);
      if (matches.length === 1) numbers = matches;
    }
    if (!numbers) {
      const { botToken } = await getSlackCredentials(teamId);
      await slackApi(botToken, "chat.postMessage", { channel: input.channelId, thread_ts: input.threadTs, text: `Please reply with valid candidate numbers, for example 1, 3, 7 (from 1 to ${selection.candidateIds.length}). No writing was started.`, unfurl_links: false });
      return;
    }
    selectedIds = numbers.map(n => selection.candidateIds[n - 1]);
    selection.selectedIds = [...new Set([...selection.selectedIds, ...selectedIds])];
    const updated = await db.update(research_cache).set({ value: JSON.stringify(selection) }).where(and(eq(research_cache.id, row.id), eq(research_cache.team_id, teamId), eq(research_cache.value, row.value))).returning({ id: research_cache.id });
    if (updated.length) {
      const { dispatchSelectedResearchWriting } = await import("./research");
      try {
        await dispatchSelectedResearchWriting(input.runId, eventId);
        await notifySelectionThread(teamId, input.runId, `Selection saved: ${numbers.join(", ")}. Writing is queued; drafts will be sent for review.`).catch(() => {});
      } catch (error) {
        await notifySelectionThread(teamId, input.runId, "Your selection was saved, but the writing job could not be confirmed. Please check its status before selecting the same candidates again.").catch(() => {});
        throw error;
      }
      return;
    }
  }
  throw new Error("Selection changed concurrently; check the selection before retrying");
}
