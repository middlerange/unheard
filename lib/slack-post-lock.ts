import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "./db/client";
import { research_drafts } from "./schema";

export async function assertNotSlackManagedPost(
  postId: string,
  teamId: string,
) {
  const db = await getDb();
  const draft = (
    await db
      .select({ id: research_drafts.id })
      .from(research_drafts)
      .where(
        and(
          eq(research_drafts.post_id, postId),
          eq(research_drafts.team_id, teamId),
          inArray(research_drafts.status, [
            "draft",
            "pending",
            "delivering",
            "editing",
            "publishing",
            "failed",
          ]),
        ),
      )
      .limit(1)
  )[0];
  if (draft)
    throw new Error(
      "This research post is managed in its Slack approval thread. Request edits or approve the newest preview there.",
    );
}
