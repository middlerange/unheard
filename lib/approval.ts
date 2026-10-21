// ABOUTME: Creates snapshot-bound Telegram approval requests for social publishing.
// ABOUTME: Due posts use the team owner’s preference to publish directly or request approval.

import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { getDb } from './db/client';
import * as schema from './schema';
import { getDueScheduledPosts, getPostWithDetails, getUserById, updatePostState } from './db/queries';
import type { Media, PostApproval, PostWithDetails } from './db/types';
import { htmlToText } from './text';
import {
  clearTelegramApprovalButtons,
  sendApprovalPacket,
  sendNotification,
} from './telegram';
import { publishApprovedPost } from './publisher';

export type ApprovalSnapshot = {
  version: 1;
  post_id: string;
  team_id: string;
  channel_group: string | null;
  publish_at: number | null;
  targets: Array<{
    target_id: string;
    platform: string;
    channel_id: string | null;
    channel_name: string | null;
    channel_account_id: string | null;
    channel_account_type: string | null;
    content: string;
    thread: string[];
    reply_settings: string;
    as_carousel: boolean;
    carousel_name: string | null;
    reddit_title: string | null;
    subreddit: string | null;
    reddit_post_type: 'self' | 'link' | null;
    reddit_url: string | null;
    flair_id: string | null;
    nsfw: boolean;
    spoiler: boolean;
  }>;
  media: Array<Pick<Media, 'id' | 'target_id' | 'filename' | 'path' | 'url' | 'type'>>;
};

type ApprovalDecision = 'approve' | 'reject';

export type ApprovalCallbackResult =
  | { status: 'published' | 'failed'; postId: string }
  | { status: 'rejected' | 'stale' | 'already_processed'; postId: string };

function randomCallbackToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function rowsChanged(result: unknown): number {
  return Number((result as { meta?: { changes?: number } })?.meta?.changes ?? 0);
}

export function buildApprovalSnapshot(post: PostWithDetails): ApprovalSnapshot {
  return {
    version: 1,
    post_id: post.id,
    team_id: post.team_id,
    channel_group: post.channel_group,
    publish_at: post.publish_at,
    targets: post.targets
      .map(target => ({
        target_id: target.id,
        platform: target.platform,
        channel_id: target.channel_id,
        channel_name: target.channel_name ?? null,
        channel_account_id: target.channel_account_id ?? null,
        channel_account_type: target.channel_account_type ?? null,
        content: htmlToText(target.content),
        thread: (target.thread ?? []).map(htmlToText),
        reply_settings: target.reply_settings,
        as_carousel: Boolean(target.as_carousel),
        carousel_name: target.carousel_name,
        reddit_title: target.reddit_title ?? null,
        subreddit: target.subreddit ?? null,
        reddit_post_type: target.reddit_post_type ?? null,
        reddit_url: target.reddit_url ?? null,
        flair_id: target.flair_id ?? null,
        nsfw: Boolean(target.nsfw),
        spoiler: Boolean(target.spoiler),
      }))
      .sort((left, right) => left.target_id.localeCompare(right.target_id)),
    media: post.media
      .map(media => ({
        id: media.id,
        target_id: media.target_id,
        filename: media.filename,
        path: media.path,
        url: media.url,
        type: media.type,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

async function hashSnapshot(snapshot: ApprovalSnapshot): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(snapshot));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function getSystemRequester(teamId: string): Promise<string> {
  const db = await getDb();
  const owners = await db
    .select({ userId: schema.team_memberships.user_id })
    .from(schema.team_memberships)
    .where(and(
      eq(schema.team_memberships.team_id, teamId),
      eq(schema.team_memberships.role, 'owner'),
    ))
    .limit(1);
  if (owners[0]) return owners[0].userId;

  const members = await db
    .select({ userId: schema.team_memberships.user_id })
    .from(schema.team_memberships)
    .where(eq(schema.team_memberships.team_id, teamId))
    .limit(1);
  if (!members[0]) throw new Error(`Team ${teamId} has no member to own the approval request`);
  return members[0].userId;
}

async function getApprovalById(id: string): Promise<PostApproval | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.post_approvals)
    .where(eq(schema.post_approvals.id, id))
    .limit(1);
  return rows[0] as PostApproval | undefined ?? null;
}

async function ensureApprovalRequest(post: PostWithDetails): Promise<PostApproval> {
  if (post.targets.length === 0) throw new Error(`Post ${post.id} has no publishing targets`);
  const missingProfile = post.targets.find(target => !target.channel_id);
  if (missingProfile) {
    throw new Error(`Post ${post.id} has no selected ${missingProfile.platform} profile`);
  }

  const db = await getDb();
  const snapshot = buildApprovalSnapshot(post);
  const snapshotJson = JSON.stringify(snapshot);
  const snapshotHash = await hashSnapshot(snapshot);
  const pending = await db
    .select()
    .from(schema.post_approvals)
    .where(and(
      eq(schema.post_approvals.post_id, post.id),
      eq(schema.post_approvals.status, 'pending'),
      isNotNull(schema.post_approvals.snapshot_hash),
    ))
    .orderBy(desc(schema.post_approvals.requested_at))
    .limit(1);

  const existing = pending[0] as PostApproval | undefined;
  if (existing?.snapshot_hash === snapshotHash && existing.snapshot_json && existing.callback_token) {
    await updatePostState(post.id, post.team_id, 'awaiting_approval', Date.now());
    return existing;
  }

  if (existing) {
    await db
      .update(schema.post_approvals)
      .set({
        status: 'changes_requested',
        notes: 'Superseded by a newer content or profile snapshot.',
        decision_source: 'system',
        reviewed_at: Date.now(),
      })
      .where(and(
        eq(schema.post_approvals.id, existing.id),
        eq(schema.post_approvals.status, 'pending'),
      ));
    if (existing.telegram_message_id) {
      await clearTelegramApprovalButtons(existing.telegram_message_id).catch(error => {
        console.error('[approval] failed to clear superseded buttons:', error);
      });
    }
  }

  const id = crypto.randomUUID();
  const callbackToken = randomCallbackToken();
  const requester = await getSystemRequester(post.team_id);
  const requestedAt = Date.now();
  await db.insert(schema.post_approvals).values({
    id,
    post_id: post.id,
    requested_by: requester,
    reviewed_by: null,
    status: 'pending',
    notes: null,
    snapshot_hash: snapshotHash,
    snapshot_json: snapshotJson,
    callback_token: callbackToken,
    telegram_message_id: null,
    telegram_user_id: null,
    decision_source: null,
    sent_at: null,
    requested_at: requestedAt,
    reviewed_at: null,
  });
  await updatePostState(post.id, post.team_id, 'awaiting_approval', requestedAt);

  const approval = await getApprovalById(id);
  if (!approval) throw new Error(`Failed to create approval for post ${post.id}`);
  return approval;
}

async function deliverApproval(approval: PostApproval): Promise<boolean> {
  if (approval.status !== 'pending' || approval.telegram_message_id) return false;
  if (!approval.snapshot_json || !approval.callback_token) {
    throw new Error(`Approval ${approval.id} does not have a Telegram snapshot`);
  }

  const snapshot = JSON.parse(approval.snapshot_json) as ApprovalSnapshot;
  const messageId = await sendApprovalPacket(approval.id, approval.callback_token, snapshot);
  const db = await getDb();
  await db
    .update(schema.post_approvals)
    .set({ telegram_message_id: messageId, sent_at: Date.now() })
    .where(and(
      eq(schema.post_approvals.id, approval.id),
      eq(schema.post_approvals.status, 'pending'),
      isNull(schema.post_approvals.telegram_message_id),
    ));
  return true;
}

async function deliverPendingApprovals(): Promise<{ delivered: number; failed: number }> {
  const db = await getDb();
  const pending = await db
    .select()
    .from(schema.post_approvals)
    .where(and(
      eq(schema.post_approvals.status, 'pending'),
      isNotNull(schema.post_approvals.snapshot_json),
      isNotNull(schema.post_approvals.callback_token),
      isNull(schema.post_approvals.telegram_message_id),
    ))
    .orderBy(schema.post_approvals.requested_at)
    .limit(25);

  let delivered = 0;
  let failed = 0;
  for (const row of pending) {
    try {
      if (await deliverApproval(row as PostApproval)) delivered += 1;
    } catch (error) {
      failed += 1;
      console.error('[approval] Telegram delivery failed:', error);
    }
  }
  return { delivered, failed };
}

export async function processDuePostApprovals(): Promise<{
  due: number;
  queued: number;
  delivered: number;
  failed: number;
}> {
  const duePosts = await getDueScheduledPosts();
  const db = await getDb();
  let queued = 0;
  let failed = 0;
  for (const post of duePosts) {
    try {
      const user = await getUserById(await getSystemRequester(post.team_id));
      if (user?.auto_publish) {
        const claim = await db.update(schema.posts)
          .set({ state: 'publishing', updated_at: Date.now() })
          .where(and(
            eq(schema.posts.id, post.id),
            eq(schema.posts.team_id, post.team_id),
            eq(schema.posts.state, 'scheduled'),
            eq(schema.posts.updated_at, post.updated_at),
          ));
        if (rowsChanged(claim) === 0) continue;
        try {
          await publishApprovedPost(post, post.team_id);
        } catch (error) {
          await db.update(schema.posts)
            .set({ state: 'failed', updated_at: Date.now() })
            .where(and(
              eq(schema.posts.id, post.id),
              eq(schema.posts.team_id, post.team_id),
              eq(schema.posts.state, 'publishing'),
            ));
          throw error;
        }
      } else {
        await ensureApprovalRequest(post);
        queued += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(`[approval] Failed to process due post ${post.id}:`, error);
    }
  }

  const delivery = await deliverPendingApprovals();
  return {
    due: duePosts.length,
    queued,
    delivered: delivery.delivered,
    failed: failed + delivery.failed,
  };
}

export async function requestPublishApprovalById(id: string, teamId: string): Promise<PostWithDetails> {
  const post = await getPostWithDetails(id, teamId);
  if (!post) throw new Error(`Post ${id} not found`);
  const approval = await ensureApprovalRequest(post);
  await deliverApproval(approval);
  const updated = await getPostWithDetails(id, teamId);
  if (!updated) throw new Error(`Post ${id} disappeared after approval was requested`);
  return updated;
}

export async function invalidatePendingApprovals(postId: string, teamId: string, reason: string): Promise<void> {
  const post = await getPostWithDetails(postId, teamId);
  if (!post) return;

  const db = await getDb();
  const pending = await db
    .select({ id: schema.post_approvals.id, telegramMessageId: schema.post_approvals.telegram_message_id })
    .from(schema.post_approvals)
    .where(and(
      eq(schema.post_approvals.post_id, postId),
      eq(schema.post_approvals.status, 'pending'),
      isNotNull(schema.post_approvals.snapshot_hash),
    ));
  if (pending.length === 0) return;

  await db
    .update(schema.post_approvals)
    .set({
      status: 'changes_requested',
      notes: reason,
      decision_source: 'system',
      reviewed_at: Date.now(),
    })
    .where(and(
      eq(schema.post_approvals.post_id, postId),
      eq(schema.post_approvals.status, 'pending'),
      isNotNull(schema.post_approvals.snapshot_hash),
    ));

  await Promise.all(pending.map(async approval => {
    if (!approval.telegramMessageId) return;
    await clearTelegramApprovalButtons(approval.telegramMessageId).catch(error => {
      console.error('[approval] failed to clear invalidated buttons:', error);
    });
  }));
}

function parseCallbackData(data: string): { decision: ApprovalDecision; approvalId: string; token: string } | null {
  const match = /^pa:([ar]):([0-9a-f-]{36}):([A-Za-z0-9_-]{16})$/.exec(data);
  if (!match) return null;
  return {
    decision: match[1] === 'a' ? 'approve' : 'reject',
    approvalId: match[2],
    token: match[3],
  };
}

export async function processTelegramApprovalCallback(
  data: string,
  telegramUserId: string,
): Promise<ApprovalCallbackResult> {
  const parsed = parseCallbackData(data);
  if (!parsed) throw new Error('Invalid approval action');

  const approval = await getApprovalById(parsed.approvalId);
  if (!approval || !approval.snapshot_json) throw new Error('Approval request not found');
  const snapshot = JSON.parse(approval.snapshot_json) as ApprovalSnapshot;
  if (approval.status !== 'pending') {
    return { status: 'already_processed', postId: approval.post_id };
  }
  if (!approval.callback_token || approval.callback_token !== parsed.token) {
    throw new Error('Approval token is invalid');
  }

  const db = await getDb();
  if (parsed.decision === 'reject') {
    const result = await db
      .update(schema.post_approvals)
      .set({
        status: 'rejected',
        notes: 'Rejected from Telegram.',
        telegram_user_id: telegramUserId,
        decision_source: 'telegram',
        reviewed_at: Date.now(),
      })
      .where(and(
        eq(schema.post_approvals.id, approval.id),
        eq(schema.post_approvals.status, 'pending'),
        eq(schema.post_approvals.callback_token, parsed.token),
      ));
    if (rowsChanged(result) === 0) return { status: 'already_processed', postId: approval.post_id };

    await db
      .update(schema.posts)
      .set({ state: 'draft', publish_at: null, updated_at: Date.now() })
      .where(and(
        eq(schema.posts.id, snapshot.post_id),
        eq(schema.posts.team_id, snapshot.team_id),
      ));
    if (approval.telegram_message_id) await clearTelegramApprovalButtons(approval.telegram_message_id);
    await sendNotification(`❌ <b>Post rejected</b>\n${snapshot.post_id}\nNothing was published.`);
    return { status: 'rejected', postId: approval.post_id };
  }

  const post = await getPostWithDetails(snapshot.post_id, snapshot.team_id);
  if (!post) throw new Error('Post no longer exists');
  const currentHash = await hashSnapshot(buildApprovalSnapshot(post));
  if (!approval.snapshot_hash || currentHash !== approval.snapshot_hash) {
    await db
      .update(schema.post_approvals)
      .set({
        status: 'changes_requested',
        notes: 'The post changed after this approval request was sent.',
        telegram_user_id: telegramUserId,
        decision_source: 'telegram',
        reviewed_at: Date.now(),
      })
      .where(and(
        eq(schema.post_approvals.id, approval.id),
        eq(schema.post_approvals.status, 'pending'),
      ));
    if (approval.telegram_message_id) await clearTelegramApprovalButtons(approval.telegram_message_id);
    await sendNotification('⚠️ <b>Approval expired</b>\nThe post changed after the preview was sent. Nothing was published.');
    return { status: 'stale', postId: approval.post_id };
  }

  const claim = await db
    .update(schema.post_approvals)
    .set({
      status: 'approved',
      notes: 'Approved from Telegram.',
      telegram_user_id: telegramUserId,
      decision_source: 'telegram',
      reviewed_at: Date.now(),
    })
    .where(and(
      eq(schema.post_approvals.id, approval.id),
      eq(schema.post_approvals.status, 'pending'),
      eq(schema.post_approvals.callback_token, parsed.token),
    ));
  if (rowsChanged(claim) === 0) return { status: 'already_processed', postId: approval.post_id };

  await updatePostState(post.id, snapshot.team_id, 'publishing', Date.now());
  if (approval.telegram_message_id) await clearTelegramApprovalButtons(approval.telegram_message_id);
  try {
    await publishApprovedPost(post, snapshot.team_id);
  } catch (error) {
    await updatePostState(post.id, snapshot.team_id, 'failed', Date.now());
    await sendNotification(`❌ <b>Approved post failed to publish</b>\n${post.id}`);
    throw error;
  }

  const published = await getPostWithDetails(post.id, snapshot.team_id);
  return {
    status: published?.state === 'published' ? 'published' : 'failed',
    postId: post.id,
  };
}
