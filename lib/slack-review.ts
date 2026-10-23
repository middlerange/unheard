import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./db/client";
import * as schema from "./schema";
import { getPostWithDetails } from "./db/queries";
import { buildApprovalSnapshot } from "./approval";
import { publishApprovedPost } from "./publisher";
import {
  isPublicationComplete,
  readPublicationProgress,
} from "./publication-progress";
import { researchHash } from "./research-model";
import { getSlackCredentials, getSlackIntegration, slackApi } from "./slack";
import type { ResearchDraftContent } from "./research-types";

declare global {
  var __contentHubSlackWorkflow__:
    | {
        create(input: {
          id: string;
          params: { jobId: string };
        }): Promise<unknown>;
      }
    | undefined;
}
const changed = (result: unknown) =>
  Number((result as { meta?: { changes?: number } })?.meta?.changes ?? 0) > 0;
type Draft = typeof schema.research_drafts.$inferSelect;
export type SlackJobPayload = {
  draftId: string;
  revision?: number;
  snapshotHash?: string;
  userId?: string;
  text?: string;
  channelId?: string;
  threadTs?: string;
  messageTs?: string;
};
export async function getResearchDraft(teamId: string, id: string) {
  const db = await getDb();
  return (
    (
      await db
        .select()
        .from(schema.research_drafts)
        .where(
          and(
            eq(schema.research_drafts.id, id),
            eq(schema.research_drafts.team_id, teamId),
          ),
        )
        .limit(1)
    )[0] ?? null
  );
}
export async function enqueueSlackJob(
  teamId: string,
  kind: "review" | "edit" | "approve" | "reject",
  payload: SlackJobPayload,
  id: string = crypto.randomUUID(),
) {
  const db = await getDb(),
    now = Date.now();
  await db
    .insert(schema.slack_jobs)
    .values({
      id,
      team_id: teamId,
      kind,
      payload: JSON.stringify(payload),
      status: "queued",
      created_at: now,
      updated_at: now,
    })
    .onConflictDoNothing();
  return { jobId: id };
}
export async function queueResearchDraftForSlack(draftId: string) {
  const db = await getDb();
  const draft = (
    await db
      .select()
      .from(schema.research_drafts)
      .where(eq(schema.research_drafts.id, draftId))
      .limit(1)
  )[0];
  if (!draft) throw new Error("Research draft not found");
  return enqueueSlackJob(
    draft.team_id,
    "review",
    { draftId },
    `review-${draftId}-${draft.revision}`,
  );
}
export async function retrySlackReview(teamId: string, draftId: string) {
  const draft = await getResearchDraft(teamId, draftId);
  if (!draft) throw new Error("Research draft not found");
  if (!["draft", "failed", "pending"].includes(draft.status))
    throw new Error("Only unpublished drafts can be resent for review");
  if (draft.post_id) {
    const post = await getPostWithDetails(draft.post_id, teamId);
    if (post) assertPublicationReady(post);
    if (
      post &&
      (["publishing", "published"].includes(post.state) ||
        !post.targets.some((t) => !isPublicationComplete(t)))
    )
      throw new Error(
        "This post is publishing or has no unpublished destinations. Check its outcome in Content Hub before retrying",
      );
  }
  return enqueueSlackJob(teamId, "review", { draftId });
}
export async function hasPendingSlackEdits(teamId: string, draftId: string) {
  const db = await getDb();
  const pending = await db
    .select({ id: schema.slack_jobs.id })
    .from(schema.slack_jobs)
    .where(
      and(
        eq(schema.slack_jobs.team_id, teamId),
        eq(schema.slack_jobs.kind, "edit"),
        inArray(schema.slack_jobs.status, ["queued", "processing"]),
        sql`json_extract(${schema.slack_jobs.payload}, '$.draftId') = ${draftId}`,
      ),
    )
    .limit(1);
  return Boolean(pending[0]);
}
export async function retrySlackJobs() {
  const db = await getDb(),
    workflow = globalThis.__contentHubSlackWorkflow__;
  if (!workflow) throw new Error("Slack Workflow is unavailable");
  const abandoned = await db
    .select()
    .from(schema.slack_jobs)
    .where(
      and(
        eq(schema.slack_jobs.status, "processing"),
        sql`${schema.slack_jobs.updated_at} < ${Date.now() - 15 * 60_000}`,
      ),
    )
    .limit(20);
  for (const job of abandoned) {
    const reason =
      "The Slack operation was interrupted. Check its publishing outcome in Content Hub before retrying.";
    await db
      .update(schema.slack_jobs)
      .set({ status: "failed", error: reason, updated_at: Date.now() })
      .where(
        and(
          eq(schema.slack_jobs.id, job.id),
          eq(schema.slack_jobs.status, "processing"),
        ),
      );
    const payload = JSON.parse(job.payload) as SlackJobPayload;
    await db
      .update(schema.research_drafts)
      .set({ error: reason, updated_at: Date.now() })
      .where(
        and(
          eq(schema.research_drafts.id, payload.draftId),
          eq(schema.research_drafts.team_id, job.team_id),
          inArray(schema.research_drafts.status, [
            "draft",
            "pending",
            "delivering",
            "editing",
            "publishing",
          ]),
        ),
      );
    await db
      .update(schema.research_drafts)
      .set({ status: "failed" })
      .where(
        and(
          eq(schema.research_drafts.id, payload.draftId),
          eq(schema.research_drafts.team_id, job.team_id),
          inArray(schema.research_drafts.status, [
            "draft",
            "pending",
            "delivering",
            "editing",
          ]),
        ),
      );
  }
  const jobs = await db
    .select()
    .from(schema.slack_jobs)
    .where(eq(schema.slack_jobs.status, "queued"))
    .orderBy(asc(schema.slack_jobs.created_at))
    .limit(20);
  let dispatched = 0;
  for (const job of jobs) {
    try {
      await workflow.create({
        id: `slack-${(await researchHash(`${job.id}:${job.updated_at}`)).slice(0, 40)}`,
        params: { jobId: job.id },
      });
      dispatched++;
    } catch (error) {
      if (
        !/already exists|duplicate|instance.*exists/i.test(
          error instanceof Error ? error.message : "",
        )
      )
        throw error;
    }
  }
  return { dispatched };
}
async function sendThread(teamId: string, draft: Draft, text: string) {
  if (!draft.slack_channel_id || !draft.slack_thread_ts) return;
  const { botToken } = await getSlackCredentials(teamId);
  await slackApi(botToken, "chat.postMessage", {
    channel: draft.slack_channel_id,
    thread_ts: draft.slack_thread_ts,
    text,
    unfurl_links: false,
    unfurl_media: false,
  });
}
export async function hashPostSnapshot(
  post: NonNullable<Awaited<ReturnType<typeof getPostWithDetails>>>,
) {
  return researchHash(
    JSON.stringify({
      snapshot: buildApprovalSnapshot(post),
      publication: post.targets
        .map((target) => ({
          targetId: target.id,
          platformPostId: target.platform_post_id,
          progress: target.publication_progress ?? null,
        }))
        .sort((a, b) => a.targetId.localeCompare(b.targetId)),
    }),
  );
}
export function buildSlackReviewPacket(
  draft: Pick<Draft, "id" | "revision"> & { is_test?: boolean },
  snapshot: ReturnType<typeof buildApprovalSnapshot>,
  finding: {
    title: string;
    url: string;
    why_it_matters: string;
    limitations: string;
    evidence: string;
  },
  snapshotHash: string,
  publication: Array<{
    id: string;
    platform_post_id: string | null;
    publication_progress?: string | null;
    thread?: string[] | null;
  }> = [],
) {
  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: draft.is_test
          ? "Test review — nothing will publish"
          : `Research post · revision ${draft.revision}`,
      },
    },
    {
      type: "section",
      text: {
        type: "plain_text",
        text: `Source: ${finding.title}\n${finding.url}`,
      },
    },
    {
      type: "section",
      text: {
        type: "plain_text",
        text: `Why it fits: ${finding.why_it_matters}`,
      },
    },
    {
      type: "section",
      text: {
        type: "plain_text",
        text: `Supporting evidence: ${finding.evidence}`,
      },
    },
    {
      type: "section",
      text: {
        type: "plain_text",
        text: `Evidence limits: ${finding.limitations || "No additional limitations recorded"}`,
      },
    },
  ];
  const alreadyPublished = new Map(
    publication
      .filter((target) => isPublicationComplete(target))
      .map((target) => [target.id, target.platform_post_id]),
  );
  if (
    publication.some(
      (target) => target.platform_post_id || target.publication_progress,
    )
  )
    blocks.push({
      type: "section",
      text: {
        type: "plain_text",
        text: "Some destinations or thread parts already published. Approval will retry ONLY the remaining destinations or replies; successful posts will not be published again. Copy can no longer be edited for this post.",
      },
    });
  for (const target of snapshot.targets) {
    const publishedTarget = publication.find(
      (item) => item.id === target.target_id,
    );
    const progress = publishedTarget
      ? readPublicationProgress(publishedTarget.publication_progress)
      : null;
    if (publication.length)
      blocks.push({
        type: "context",
        elements: [
          {
            type: "plain_text",
            text: alreadyPublished.has(target.target_id)
              ? `Already published · platform post ${alreadyPublished.get(target.target_id)}`
              : progress?.publishedCount
                ? `Thread progress: ${progress.publishedCount}/${progress.totalCount} parts published. Will resume only remaining replies after approval.`
                : draft.is_test
                  ? "Preview only — nothing will publish"
                  : "Will publish after approval",
          },
        ],
      });
    blocks.push({
      type: "section",
      text: {
        type: "plain_text",
        text: `${target.platform} → ${target.channel_name || target.channel_id} (${target.channel_account_type || "account"}; ID ${target.channel_account_id || target.channel_id})`,
      },
    });
    const parts = [target.content, ...target.thread];
    parts.forEach((part, index) => {
      const label =
        parts.length > 1 ? `Part ${index + 1}/${parts.length}\n` : "";
      // Slack section text is capped at3000. Plain text preserves the exact publishing copy.
      for (let offset = 0; offset < part.length; offset += 2800)
        blocks.push({
          type: "section",
          text: {
            type: "plain_text",
            text: label + part.slice(offset, offset + 2800),
          },
        });
    });
  }
  for (const target of snapshot.targets) {
    if (target.platform === "reddit")
      blocks.push({
        type: "section",
        text: {
          type: "plain_text",
          text: `Reddit destination: r/${target.subreddit}\nTitle: ${target.reddit_title}\nType: ${target.reddit_post_type}`,
        },
      });
  }
  if (snapshot.media.length)
    blocks.push({
      type: "section",
      text: {
        type: "plain_text",
        text: `Attached media:\n${snapshot.media.map((m) => `${m.filename}: ${m.url || m.path}`).join("\n")}`,
      },
    });
  blocks.push({
    type: "context",
    elements: [
      {
        type: "plain_text",
        text: draft.is_test
          ? "Reply in this thread to request edits, then choose Approve test on the latest preview. Nothing will publish to the displayed profile."
          : "Reply in this thread to request edits. Only the current revision’s Approve & publish button publishes. Plain replies never approve.",
      },
    ],
  });
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        action_id: "research_approve",
        text: {
          type: "plain_text",
          text: draft.is_test ? "Approve test" : "Approve & publish",
        },
        style: "primary",
        confirm: {
          title: {
            type: "plain_text",
            text: draft.is_test
              ? "Approve this test revision?"
              : "Publish this exact revision?",
          },
          text: {
            type: "plain_text",
            text: draft.is_test
              ? "This records your test approval. Nothing will publish to any social profile."
              : "This immediately publishes the copy above to every listed destination.",
          },
          confirm: {
            type: "plain_text",
            text: draft.is_test ? "Approve test" : "Publish",
          },
          deny: { type: "plain_text", text: "Cancel" },
        },
        value: JSON.stringify({
          draftId: draft.id,
          revision: draft.revision,
          snapshotHash,
        }),
      },
      {
        type: "button",
        action_id: "research_reject",
        text: { type: "plain_text", text: "Reject" },
        style: "danger",
        value: JSON.stringify({
          draftId: draft.id,
          revision: draft.revision,
          snapshotHash,
        }),
      },
    ],
  });
  if (blocks.length > 50)
    throw new Error(
      "Draft is too long for a complete Slack preview. Shorten it before requesting approval",
    );
  return {
    text: draft.is_test
      ? `Test review — nothing will publish · revision ${draft.revision}`
      : `Research post revision ${draft.revision}: ${finding.title}`,
    blocks,
  };
}
function assertPublicationReady(
  post: NonNullable<Awaited<ReturnType<typeof getPostWithDetails>>>,
) {
  for (const target of post.targets) {
    const progress = readPublicationProgress(target.publication_progress);
    if (progress && progress.rootId !== target.platform_post_id)
      throw new Error(
        "The thread checkpoint does not match its root post. Check the platform outcome before retrying.",
      );
    if (progress && progress.phase !== "ready")
      throw new Error(
        "A thread part may already have published. Check its outcome on the platform before retrying; Content Hub will not repeat an uncertain write.",
      );
  }
}
async function assertEnabledDestinations(
  draft: Draft,
  post: NonNullable<Awaited<ReturnType<typeof getPostWithDetails>>>,
) {
  if (draft.is_test) return;
  const db = await getDb();
  const enabled = await db
    .select()
    .from(schema.channels)
    .where(
      and(
        eq(schema.channels.team_id, draft.team_id),
        eq(schema.channels.research_enabled, true),
      ),
    );
  if (
    post.targets.some(
      (target) =>
        !isPublicationComplete(target) &&
        !enabled.some(
          (channel) =>
            channel.id === target.channel_id &&
            channel.platform === target.platform &&
            Boolean(channel.system_prompt?.trim()),
        ),
    )
  )
    throw new Error(
      "A publishing profile is disabled or missing its research prompt. Re-enable it before reviewing this draft.",
    );
}
async function ensurePost(draft: Draft) {
  const db = await getDb();
  if (draft.post_id) return draft.post_id;
  const content = JSON.parse(draft.content) as ResearchDraftContent;
  if (!content.targets.length)
    throw new Error("Draft has no publishing destinations");
  const channels = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.team_id, draft.team_id));
  for (const target of content.targets) {
    if (
      !channels.some(
        (c) => c.id === target.channelId && c.platform === target.platform,
      )
    )
      throw new Error("Draft destination is no longer connected");
  }
  const selectedGroups = new Set(
    content.targets.map(
      (target) =>
        channels.find((channel) => channel.id === target.channelId)
          ?.group_name || "default",
    ),
  );
  const postId = `research-${draft.id}`,
    now = Date.now();
  await db.batch([
    db
      .insert(schema.posts)
      .values({
        id: postId,
        team_id: draft.team_id,
        state: "awaiting_approval",
        is_test: draft.is_test,
        channel_group:
          selectedGroups.size === 1 ? [...selectedGroups][0] : "research",
        publish_at: null,
        created_at: now,
        updated_at: now,
      })
      .onConflictDoNothing(),
    ...content.targets.map((t, index) =>
      db
        .insert(schema.post_targets)
        .values({
          id: `${postId}-${index}`,
          post_id: postId,
          channel_id: t.channelId,
          platform: t.platform,
          content: t.content,
          thread: JSON.stringify(t.thread),
          reddit_title: t.redditTitle ?? null,
          subreddit: t.subreddit ?? null,
          reddit_post_type: t.redditPostType ?? null,
        })
        .onConflictDoNothing(),
    ),
    db
      .update(schema.research_drafts)
      .set({ post_id: postId, updated_at: now })
      .where(
        and(
          eq(schema.research_drafts.id, draft.id),
          eq(schema.research_drafts.team_id, draft.team_id),
        ),
      ),
  ]);
  return postId;
}
async function reviewMessageId(value: string) {
  const h = await researchHash(value);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
async function deliverReview(draft: Draft) {
  const db = await getDb(),
    integration = await getSlackIntegration(draft.team_id);
  if (!integration || (!integration.enabled && !draft.is_test))
    throw new Error(
      "Slack approvals are disabled. Connect and enable Slack, then retry this draft",
    );
  if (!["draft", "failed", "pending"].includes(draft.status)) return;
  const lock = await db
    .update(schema.research_drafts)
    .set({ status: "delivering", updated_at: Date.now() })
    .where(
      and(
        eq(schema.research_drafts.id, draft.id),
        eq(schema.research_drafts.status, draft.status),
        eq(schema.research_drafts.revision, draft.revision),
      ),
    )
    .run();
  if (!changed(lock)) return;
  const postId = await ensurePost(draft),
    post = await getPostWithDetails(postId, draft.team_id);
  if (!post) throw new Error("Draft post not found");
  assertPublicationReady(post);
  await assertEnabledDestinations(draft, post);
  if (
    !post.targets.some((t) => !isPublicationComplete(t)) ||
    ["publishing", "published"].includes(post.state)
  )
    throw new Error(
      "Post already started publishing; refusing to request another approval",
    );
  const finding = (
    await db
      .select()
      .from(schema.research_findings)
      .where(
        and(
          eq(schema.research_findings.id, draft.finding_id),
          eq(schema.research_findings.team_id, draft.team_id),
        ),
      )
      .limit(1)
  )[0];
  if (!finding) throw new Error("Source finding not found");
  if (post.state === "failed")
    await db
      .update(schema.posts)
      .set({ state: "awaiting_approval", updated_at: Date.now() })
      .where(
        and(
          eq(schema.posts.id, post.id),
          eq(schema.posts.team_id, draft.team_id),
          eq(schema.posts.state, "failed"),
        ),
      );
  const snapshotHash = await hashPostSnapshot(post),
    packet = buildSlackReviewPacket(
      draft,
      buildApprovalSnapshot(post),
      finding,
      snapshotHash,
      post.targets,
    );
  const { botToken } = await getSlackCredentials(draft.team_id);
  const sameChannel = draft.slack_channel_id === integration.channel_id;
  const sent = await slackApi<{ ts: string }>(botToken, "chat.postMessage", {
    channel: integration.channel_id,
    ...packet,
    client_msg_id: await reviewMessageId(
      `${draft.id}:${draft.revision}:${snapshotHash}`,
    ),
    ...(sameChannel && draft.slack_thread_ts
      ? { thread_ts: draft.slack_thread_ts }
      : {}),
    unfurl_links: false,
    unfurl_media: false,
  });
  await db
    .update(schema.research_drafts)
    .set({
      status: "pending",
      slack_channel_id: integration.channel_id,
      slack_thread_ts:
        sameChannel && draft.slack_thread_ts ? draft.slack_thread_ts : sent.ts,
      slack_message_ts: sent.ts,
      snapshot_hash: snapshotHash,
      error: null,
      updated_at: Date.now(),
    })
    .where(
      and(
        eq(schema.research_drafts.id, draft.id),
        eq(schema.research_drafts.status, "delivering"),
      ),
    );
}
async function editDraft(draft: Draft, payload: SlackJobPayload) {
  const db = await getDb();
  if (draft.status !== "pending" || !payload.text) return;
  const claim = await db
    .update(schema.research_drafts)
    .set({ status: "editing", updated_at: Date.now() })
    .where(
      and(
        eq(schema.research_drafts.id, draft.id),
        eq(schema.research_drafts.status, "pending"),
        eq(schema.research_drafts.revision, draft.revision),
      ),
    )
    .run();
  if (!changed(claim)) return;
  if (!draft.post_id) throw new Error("Draft post not found");
  const before = await getPostWithDetails(draft.post_id, draft.team_id);
  if (
    !before ||
    before.state !== "awaiting_approval" ||
    (await hashPostSnapshot(before)) !== draft.snapshot_hash
  )
    throw new Error(
      "The post changed in Content Hub. Resend its current preview before editing in Slack",
    );
  if (
    before.targets.some(
      (target) => target.platform_post_id || target.publication_progress,
    )
  )
    throw new Error(
      "Some destinations already published. This post cannot be edited; resend its preview to retry only the remaining destinations.",
    );
  await assertEnabledDestinations(draft, before);
  const { rewriteResearchDraftContent } = await import("./research-drafts");
  const result = await rewriteResearchDraftContent(
    draft.id,
    draft.team_id,
    payload.text,
  );
  const current = await getPostWithDetails(draft.post_id, draft.team_id);
  if (!current || (await hashPostSnapshot(current)) !== draft.snapshot_hash)
    throw new Error(
      "The post changed while this revision was being prepared. Resend its current preview",
    );
  const revision = draft.revision + 1,
    now = Date.now();
  const targets = result.content.targets;
  if (
    targets.length !== before.targets.length ||
    targets.some(
      (t) =>
        !before.targets.some(
          (p) => p.channel_id === t.channelId && p.platform === t.platform,
        ),
    )
  )
    throw new Error("Revision changed publishing destinations");
  await db.batch([
    db
      .update(schema.posts)
      .set({ updated_at: now })
      .where(
        and(
          eq(schema.posts.id, draft.post_id),
          eq(schema.posts.team_id, draft.team_id),
          eq(schema.posts.state, "awaiting_approval"),
        ),
      ),
    ...targets.map((t) =>
      db
        .update(schema.post_targets)
        .set({
          content: t.content,
          thread: JSON.stringify(t.thread),
          reddit_title: t.redditTitle ?? null,
          subreddit: t.subreddit ?? null,
          reddit_post_type: t.redditPostType ?? null,
        })
        .where(
          and(
            eq(schema.post_targets.post_id, draft.post_id!),
            eq(schema.post_targets.channel_id, t.channelId),
            eq(schema.post_targets.platform, t.platform),
          ),
        ),
    ),
    db
      .update(schema.research_drafts)
      .set({
        content: JSON.stringify(result.content),
        revision,
        status: "draft",
        snapshot_hash: null,
        input_tokens: sql`${schema.research_drafts.input_tokens} + ${result.inputTokens}`,
        output_tokens: sql`${schema.research_drafts.output_tokens} + ${result.outputTokens}`,
        updated_at: now,
      })
      .where(
        and(
          eq(schema.research_drafts.id, draft.id),
          eq(schema.research_drafts.status, "editing"),
        ),
      ),
    db.insert(schema.research_draft_revisions).values({
      id: crypto.randomUUID(),
      team_id: draft.team_id,
      draft_id: draft.id,
      revision,
      content: JSON.stringify(result.content),
      instruction: payload.text,
      slack_user_id: payload.userId,
      created_at: now,
    }),
  ]);
  const updated = await getResearchDraft(draft.team_id, draft.id);
  if (updated) await deliverReview(updated);
}
async function decideDraft(
  draft: Draft,
  payload: SlackJobPayload,
  decision: "approve" | "reject",
) {
  const db = await getDb();
  if (
    decision === "approve" &&
    (await hasPendingSlackEdits(draft.team_id, draft.id))
  ) {
    await sendThread(
      draft.team_id,
      draft,
      "An edit is queued or being prepared. Nothing was published. Wait for the revised preview, then approve that version.",
    );
    return;
  }
  if (
    draft.status !== "pending" ||
    draft.revision !== payload.revision ||
    draft.snapshot_hash !== payload.snapshotHash
  ) {
    await sendThread(
      draft.team_id,
      draft,
      "This approval is out of date or already processed. Use the buttons on the newest preview.",
    );
    return;
  }
  if (decision === "reject") {
    const result = await db
      .update(schema.research_drafts)
      .set({ status: "rejected", updated_at: Date.now() })
      .where(
        and(
          eq(schema.research_drafts.id, draft.id),
          eq(schema.research_drafts.status, "pending"),
          eq(schema.research_drafts.revision, payload.revision!),
        ),
      )
      .run();
    if (changed(result))
      await sendThread(
        draft.team_id,
        draft,
        "Rejected. Nothing was published.",
      );
    return;
  }
  const post = draft.post_id
    ? await getPostWithDetails(draft.post_id, draft.team_id)
    : null;
  if (
    !post ||
    post.state !== "awaiting_approval" ||
    (await hashPostSnapshot(post)) !== draft.snapshot_hash
  ) {
    await sendThread(
      draft.team_id,
      draft,
      "The copy, destination, or media changed after this preview. Nothing was published. Resend the current preview from Content Hub.",
    );
    throw new Error("Approval expired because the publishing snapshot changed");
  }
  assertPublicationReady(post);
  await assertEnabledDestinations(draft, post);
  const now = Date.now();
  if (draft.is_test) {
    const result = await db
      .update(schema.research_drafts)
      .set({ status: "approved_test", updated_at: now })
      .where(
        and(
          eq(schema.research_drafts.id, draft.id),
          eq(schema.research_drafts.status, "pending"),
          eq(schema.research_drafts.revision, payload.revision!),
          eq(schema.research_drafts.snapshot_hash, payload.snapshotHash!),
        ),
      )
      .run();
    if (changed(result))
      await sendThread(
        draft.team_id,
        draft,
        "Test approved. Your latest revision and approval were recorded. Nothing was published to any social profile.",
      );
    return;
  }
  const claim = await db
    .update(schema.research_drafts)
    .set({ status: "publishing", updated_at: now })
    .where(
      and(
        eq(schema.research_drafts.id, draft.id),
        eq(schema.research_drafts.status, "pending"),
        eq(schema.research_drafts.revision, payload.revision!),
        eq(schema.research_drafts.snapshot_hash, payload.snapshotHash!),
      ),
    )
    .run();
  if (!changed(claim)) return;
  const lock = await db
    .update(schema.posts)
    .set({ state: "publishing", updated_at: now })
    .where(
      and(
        eq(schema.posts.id, post.id),
        eq(schema.posts.team_id, draft.team_id),
        eq(schema.posts.state, "awaiting_approval"),
        eq(schema.posts.updated_at, post.updated_at),
      ),
    )
    .run();
  if (!changed(lock))
    throw new Error("Post changed during approval; nothing was published");
  const final = await getPostWithDetails(post.id, draft.team_id);
  if (!final || (await hashPostSnapshot(final)) !== draft.snapshot_hash)
    throw new Error("Post changed during approval; nothing was published");
  await publishApprovedPost(final, draft.team_id);
  const published = await getPostWithDetails(post.id, draft.team_id);
  const status = published?.state === "published" ? "published" : "failed";
  await db
    .update(schema.research_drafts)
    .set({
      status,
      error:
        status === "failed"
          ? "Publishing failed. Review target errors in Content Hub before retrying."
          : null,
      updated_at: Date.now(),
    })
    .where(eq(schema.research_drafts.id, draft.id));
  await sendThread(
    draft.team_id,
    draft,
    status === "published"
      ? "Published this exact revision to the listed destinations."
      : "Publishing failed. Check the post in Content Hub; successful destinations will not be published again.",
  );
}
export async function processSlackJob(jobId: string) {
  const db = await getDb();
  const job = (
    await db
      .select()
      .from(schema.slack_jobs)
      .where(eq(schema.slack_jobs.id, jobId))
      .limit(1)
  )[0];
  if (!job || job.status !== "queued")
    return { status: job?.status ?? "missing" };
  const payload = JSON.parse(job.payload) as SlackJobPayload;
  const earlier = await db
    .select({ id: schema.slack_jobs.id })
    .from(schema.slack_jobs)
    .where(
      and(
        eq(schema.slack_jobs.team_id, job.team_id),
        inArray(schema.slack_jobs.status, ["queued", "processing"]),
        sql`json_extract(${schema.slack_jobs.payload}, '$.draftId') = ${payload.draftId}`,
        sql`(${schema.slack_jobs.created_at} < ${job.created_at} OR (${schema.slack_jobs.created_at} = ${job.created_at} AND ${schema.slack_jobs.id} < ${job.id}))`,
      ),
    )
    .limit(1);
  if (earlier[0]) {
    await db
      .update(schema.slack_jobs)
      .set({ updated_at: Date.now() })
      .where(
        and(
          eq(schema.slack_jobs.id, job.id),
          eq(schema.slack_jobs.status, "queued"),
        ),
      );
    return { status: "deferred" };
  }
  const claim = await db
    .update(schema.slack_jobs)
    .set({ status: "processing", updated_at: Date.now() })
    .where(
      and(
        eq(schema.slack_jobs.id, jobId),
        eq(schema.slack_jobs.status, "queued"),
      ),
    )
    .run();
  if (!changed(claim)) return { status: "already_processed" };
  const draft = await getResearchDraft(job.team_id, payload.draftId);
  try {
    if (!draft) throw new Error("Research draft not found");
    if (job.kind === "review") await deliverReview(draft);
    else {
      const integration = await getSlackIntegration(job.team_id);
      if (
        !integration ||
        (!integration.enabled && !draft.is_test) ||
        !payload.userId ||
        !(JSON.parse(integration.approver_user_ids) as string[]).includes(
          payload.userId,
        ) ||
        integration.channel_id !== payload.channelId ||
        draft.slack_channel_id !== payload.channelId ||
        draft.slack_thread_ts !== payload.threadTs ||
        ((job.kind === "approve" || job.kind === "reject") &&
          draft.slack_message_ts !== payload.messageTs)
      )
        throw new Error(
          "Slack approver or review thread is no longer authorized",
        );
      if (job.kind === "edit") await editDraft(draft, payload);
      else if (job.kind === "approve" || job.kind === "reject")
        await decideDraft(draft, payload, job.kind);
      else throw new Error("Invalid Slack job");
    }
    await db
      .update(schema.slack_jobs)
      .set({ status: "completed", updated_at: Date.now() })
      .where(eq(schema.slack_jobs.id, jobId));
    return { status: "completed" };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Slack review failed";
    await db
      .update(schema.slack_jobs)
      .set({
        status: "failed",
        error: message.slice(0, 1000),
        updated_at: Date.now(),
      })
      .where(eq(schema.slack_jobs.id, jobId));
    if (draft) {
      const post = draft.post_id
        ? await getPostWithDetails(draft.post_id, draft.team_id)
        : null;
      const failureStatus =
        post?.state === "published"
          ? "published"
          : post?.state === "publishing"
            ? "publishing"
            : "failed";
      await db
        .update(schema.research_drafts)
        .set({
          status: failureStatus,
          error: message.slice(0, 1000),
          updated_at: Date.now(),
        })
        .where(
          and(
            eq(schema.research_drafts.id, draft.id),
            inArray(schema.research_drafts.status, [
              "draft",
              "pending",
              "delivering",
              "editing",
              "publishing",
            ]),
          ),
        );
      await sendThread(
        job.team_id,
        draft,
        `Review needs attention: ${message}. Nothing new will be published automatically.`,
      ).catch(() => {});
    }
    return { status: "failed", error: message };
  }
}
