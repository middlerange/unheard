import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "./db/client";
import * as schema from "./schema";
import { queueResearchDraftForSlack } from "./slack-review";
import {
  SLACK_TEST_PROMPT,
  SLACK_TEST_EVIDENCE as evidence,
} from "./slack-test-content";

export async function createSlackTestReview(teamId: string, origin: string) {
  const db = await getDb();
  const profile = await db
    .select()
    .from(schema.channels)
    .where(
      and(
        eq(schema.channels.team_id, teamId),
        inArray(schema.channels.platform, [
          "linkedin",
          "facebook",
          "discord",
          "twitter",
        ]),
      ),
    )
    .limit(1)
    .get();
  if (!profile)
    throw new Error(
      "Connect a text publishing profile before sending a test review. It is used only for preview; nothing will publish.",
    );
  const id = crypto.randomUUID(),
    now = Date.now();
  const runId = `slack-test-${id}`,
    itemId = `slack-test-item-${id}`;
  const sampleUrl = new URL("/settings/slack", origin);
  sampleUrl.searchParams.set("review_test", id);
  const url = sampleUrl.href;
  const title = "Test review — nothing will publish";
  const content = {
    targets: [
      {
        channelId: profile.id,
        platform: profile.platform,
        content: `Review the revision, then decide.\n\nReply in this Slack thread to request a change. Inspect the updated preview before approving the latest version.\n\n${url}`,
        thread: [],
      },
    ],
  };
  await db.batch([
    db
      .insert(schema.research_runs)
      .values({
        id: runId,
        team_id: teamId,
        mode: "test",
        status: "completed",
        days: 1,
        created_at: now,
        completed_at: now,
        icp: SLACK_TEST_PROMPT,
      }),
    db
      .insert(schema.research_items)
      .values({
        id: itemId,
        team_id: teamId,
        source_id: "slack-test-review",
        canonical_url: url,
        title,
        excerpt: evidence,
        content: evidence,
        published_at: now,
        collected_at: now,
      }),
    db
      .insert(schema.research_findings)
      .values({
        id,
        team_id: teamId,
        run_id: runId,
        item_id: itemId,
        source_id: "slack-test-review",
        title,
        url,
        published_at: now,
        score: 0,
        summary: evidence,
        why_it_matters:
          "Practice thread edits and approval safely. The displayed profile is a preview only; its research settings are unchanged.",
        content_angle: "Explain the internal Slack review workflow.",
        evidence,
        limitations:
          "Internal setup sample, not external research. No social delivery is tested or allowed.",
        status: "dismissed",
        created_at: now,
        family_key: runId,
      }),
    db
      .insert(schema.research_drafts)
      .values({
        id,
        team_id: teamId,
        run_id: runId,
        finding_id: id,
        content: JSON.stringify(content),
        is_test: true,
        created_at: now,
        updated_at: now,
      }),
    db
      .insert(schema.research_draft_revisions)
      .values({
        id: `${id}:1`,
        team_id: teamId,
        draft_id: id,
        revision: 1,
        content: JSON.stringify(content),
        created_at: now,
      }),
  ]);
  return { draftId: id, ...(await queueResearchDraftForSlack(id)) };
}
