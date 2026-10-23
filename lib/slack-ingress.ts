import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "./db/client";
import * as schema from "./schema";
import {
  authenticateSlackRequest,
  getSlackCredentials,
  verifySlackRequest,
} from "./slack";
import {
  enqueueSlackJob,
  getResearchDraft,
  hasPendingSlackEdits,
} from "./slack-review";
const ack = () => Response.json({ ok: true });
export async function readSlackBody(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > 64_000) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 64_000) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(result);
}
export async function handleSlackEvents(request: Request) {
  const body = await readSlackBody(request);
  if (body === null)
    return Response.json({ error: "Payload too large" }, { status: 413 });
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(body);
  } catch {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (data.type === "url_verification") {
    const globalSecret = process.env.SLACK_SIGNING_SECRET;
    if (globalSecret && (await verifySlackRequest(request, body, globalSecret)))
      return Response.json({ challenge: data.challenge });
    const db = await getDb();
    const candidates = await db
      .select({ teamId: schema.slack_integrations.team_id })
      .from(schema.slack_integrations)
      .limit(100);
    for (const candidate of candidates) {
      const { signingSecret, appManaged } = await getSlackCredentials(
        candidate.teamId,
      );
      if (appManaged) continue;
      if (await verifySlackRequest(request, body, signingSecret))
        return Response.json({ challenge: data.challenge });
    }
    return Response.json({ error: "Invalid Slack signature" }, { status: 401 });
  }
  if (typeof data.team_id !== "string")
    return Response.json({ error: "Workspace required" }, { status: 400 });
  const integration = await authenticateSlackRequest(
    request,
    body,
    data.team_id,
  );
  if (
    !integration &&
    process.env.SLACK_SIGNING_SECRET &&
    (await verifySlackRequest(request, body, process.env.SLACK_SIGNING_SECRET))
  )
    return ack();
  if (!integration)
    return Response.json(
      { error: "Invalid Slack signature or disabled integration" },
      { status: 401 },
    );
  if (data.type !== "event_callback") return ack();
  const event = data.event as Record<string, unknown> | undefined;
  if (
    !event ||
    event.type !== "message" ||
    event.subtype ||
    event.bot_id ||
    event.bot_profile ||
    typeof event.user !== "string" ||
    typeof event.channel !== "string" ||
    typeof event.thread_ts !== "string" ||
    event.channel !== integration.channel_id ||
    typeof event.text !== "string" ||
    !event.text.trim() ||
    event.text.length > 4000
  )
    return ack();
  if (
    !(JSON.parse(integration.approver_user_ids) as string[]).includes(
      event.user,
    )
  )
    return ack();
  if (
    typeof data.event_id !== "string" ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(data.event_id)
  )
    return ack();
  const db = await getDb();
  const draft = (
    await db
      .select()
      .from(schema.research_drafts)
      .where(
        and(
          eq(schema.research_drafts.team_id, integration.team_id),
          eq(schema.research_drafts.slack_channel_id, event.channel),
          eq(schema.research_drafts.slack_thread_ts, event.thread_ts),
          inArray(schema.research_drafts.status, [
            "pending",
            "editing",
            "delivering",
          ]),
        ),
      )
      .limit(1)
  )[0];
  if (!draft || (!integration.enabled && !draft.is_test)) return ack();
  await enqueueSlackJob(
    integration.team_id,
    "edit",
    {
      draftId: draft.id,
      userId: event.user,
      text: event.text,
      channelId: event.channel,
      threadTs: event.thread_ts,
    },
    `event-${data.event_id}`,
  );
  return ack();
}
export async function handleSlackInteractions(request: Request) {
  const body = await readSlackBody(request);
  if (body === null)
    return Response.json({ error: "Payload too large" }, { status: 413 });
  let data: {
    type?: string;
    team?: { id?: string };
    user?: { id?: string };
    channel?: { id?: string };
    message?: { ts?: string; thread_ts?: string };
    actions?: Array<{ action_id?: string; value?: string; action_ts?: string }>;
  };
  try {
    data = JSON.parse(new URLSearchParams(body).get("payload") || "");
  } catch {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (!data.team?.id)
    return Response.json({ error: "Workspace required" }, { status: 400 });
  const integration = await authenticateSlackRequest(
    request,
    body,
    data.team.id,
  );
  if (
    !integration &&
    process.env.SLACK_SIGNING_SECRET &&
    (await verifySlackRequest(request, body, process.env.SLACK_SIGNING_SECRET))
  )
    return ack();
  if (!integration)
    return Response.json(
      { error: "Invalid Slack signature or disabled integration" },
      { status: 401 },
    );
  const action = data.actions?.[0];
  if (
    data.type !== "block_actions" ||
    !action ||
    !["research_approve", "research_reject"].includes(action.action_id || "")
  )
    return ack();
  if (
    !data.user?.id ||
    !(JSON.parse(integration.approver_user_ids) as string[]).includes(
      data.user.id,
    ) ||
    data.channel?.id !== integration.channel_id
  )
    return ack();
  let value: { draftId?: string; revision?: number; snapshotHash?: string };
  try {
    value = JSON.parse(action.value || "");
  } catch {
    return ack();
  }
  if (
    typeof value.draftId !== "string" ||
    !Number.isInteger(value.revision) ||
    !value.snapshotHash ||
    !/^[a-f0-9]{64}$/.test(value.snapshotHash)
  )
    return ack();
  const draft = await getResearchDraft(integration.team_id, value.draftId);
  if (
    !draft ||
    (!integration.enabled && !draft.is_test) ||
    draft.slack_channel_id !== data.channel.id ||
    draft.slack_message_ts !== data.message?.ts
  )
    return ack();
  // Buttons from old previews are acknowledged without creating an approval job.
  if (
    draft.revision !== value.revision ||
    draft.snapshot_hash !== value.snapshotHash ||
    draft.status !== "pending"
  )
    return ack();
  if (
    action.action_id === "research_approve" &&
    (await hasPendingSlackEdits(integration.team_id, draft.id))
  )
    return ack();
  const id = `action-${await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${integration.team_id}:${data.user.id}:${action.action_id}:${action.action_ts}:${action.value}`)).then((buffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join(""))}`;
  await enqueueSlackJob(
    integration.team_id,
    action.action_id === "research_approve" ? "approve" : "reject",
    {
      draftId: draft.id,
      revision: value.revision,
      snapshotHash: value.snapshotHash,
      userId: data.user.id,
      channelId: data.channel.id,
      threadTs: draft.slack_thread_ts!,
      messageTs: data.message.ts,
    },
    id,
  );
  return ack();
}
