import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db/client";
import { slack_integrations } from "./schema";
import { decrypt, encrypt } from "./crypto";
import type { SlackSettings } from "./slack-types";

export const slackSettingsInput = z
  .object({
    botToken: z
      .string()
      .regex(/^xoxb-[A-Za-z0-9-]+$/)
      .max(300)
      .optional(),
    signingSecret: z
      .string()
      .regex(/^[a-f0-9]{32}$/i)
      .optional(),
    channelId: z.string().regex(/^[CG][A-Z0-9]{8,}$/),
    approverUserIds: z
      .array(z.string().regex(/^[UW][A-Z0-9]{8,}$/))
      .min(1)
      .max(20),
    enabled: z.boolean(),
  })
  .strict();
export type SlackCredentials = {
  botToken: string;
  signingSecret: string;
  appManaged?: boolean;
};
export function slackOAuthAvailable() {
  return Boolean(
    process.env.SLACK_CLIENT_ID?.trim() &&
    process.env.SLACK_CLIENT_SECRET?.trim() &&
    /^[a-f0-9]{32}$/i.test(process.env.SLACK_SIGNING_SECRET || ""),
  );
}
export async function getSlackIntegration(teamId: string) {
  const db = await getDb();
  return (
    (
      await db
        .select()
        .from(slack_integrations)
        .where(eq(slack_integrations.team_id, teamId))
        .limit(1)
    )[0] ?? null
  );
}
export async function getSlackCredentials(
  teamId: string,
): Promise<SlackCredentials> {
  const integration = await getSlackIntegration(teamId);
  if (!integration?.credentials)
    throw new Error("Connect Slack before sending approvals");
  return JSON.parse(await decrypt(integration.credentials));
}
export async function getSlackSettings(teamId: string): Promise<SlackSettings> {
  const row = await getSlackIntegration(teamId);
  return {
    configured: Boolean(row?.credentials),
    oauthAvailable: slackOAuthAvailable(),
    workspaceId: row?.workspace_id ?? null,
    channelId: row?.channel_id || null,
    approverUserIds: row ? JSON.parse(row.approver_user_ids) : [],
    enabled: row?.enabled ?? false,
    hasBotToken: Boolean(row?.credentials),
    hasSigningSecret: Boolean(row?.credentials),
  };
}
export async function slackApi<T extends Record<string, unknown>>(
  token: string,
  method: string,
  data: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok)
    throw new Error(`Slack ${method} failed (HTTP ${response.status})`);
  const result = (await response.json()) as T & {
    ok?: boolean;
    error?: string;
  };
  if (!result.ok)
    throw new Error(`Slack ${method}: ${result.error || "request failed"}`);
  return result;
}
async function validateConnection(
  credentials: SlackCredentials,
  channelId: string,
  approvers: string[],
) {
  const auth = await slackApi<{ team_id: string; user_id: string }>(
    credentials.botToken,
    "auth.test",
  );
  const info = await slackApi<{
    channel: {
      id: string;
      name: string;
      is_member?: boolean;
      is_archived?: boolean;
      is_private?: boolean;
      is_im?: boolean;
      is_mpim?: boolean;
    };
  }>(credentials.botToken, "conversations.info", { channel: channelId });
  if (info.channel.is_archived || info.channel.is_im || info.channel.is_mpim)
    throw new Error("Choose an active Slack approval channel");
  if (!info.channel.is_member && !info.channel.is_private) {
    const joined = await slackApi<{
      channel: { id: string; is_member?: boolean };
    }>(credentials.botToken, "conversations.join", { channel: channelId });
    if (joined.channel.id !== channelId || !joined.channel.is_member)
      throw new Error("Slack could not join the selected public channel");
  } else if (!info.channel.is_member)
    throw new Error(
      "Invite the Slack bot to the selected private channel first",
    );
  for (const id of approvers) {
    const result = await slackApi<{
      user: {
        id: string;
        team_id?: string;
        deleted?: boolean;
        is_bot?: boolean;
      };
    }>(credentials.botToken, "users.info", { user: id });
    if (
      result.user.deleted ||
      result.user.is_bot ||
      result.user.team_id !== auth.team_id
    )
      throw new Error(
        `Slack approver ${id} must be an active human in this workspace`,
      );
  }
  return {
    ok: true as const,
    workspaceId: auth.team_id,
    botUserId: auth.user_id,
    channelId,
    channelName: info.channel.name,
  };
}
export async function updateSlackSettings(teamId: string, input: unknown) {
  const data = slackSettingsInput.parse(input);
  const existing = await getSlackIntegration(teamId);
  const previous = existing?.credentials
    ? await getSlackCredentials(teamId)
    : null;
  const credentials = {
    botToken: data.botToken || previous?.botToken || "",
    signingSecret: data.signingSecret || previous?.signingSecret || "",
    appManaged:
      !data.botToken && !data.signingSecret && previous?.appManaged === true,
  };
  if (!credentials.botToken || !credentials.signingSecret)
    throw new Error("Bot token and signing secret are required");
  const verified = await validateConnection(
    credentials,
    data.channelId,
    data.approverUserIds,
  );
  const db = await getDb();
  const collision = await db
    .select({ teamId: slack_integrations.team_id })
    .from(slack_integrations)
    .where(eq(slack_integrations.workspace_id, verified.workspaceId))
    .limit(1);
  if (collision[0] && collision[0].teamId !== teamId)
    throw new Error("Slack workspace is connected to another Content Hub team");
  const now = Date.now();
  const values = {
    team_id: teamId,
    workspace_id: verified.workspaceId,
    channel_id: data.channelId,
    approver_user_ids: JSON.stringify([...new Set(data.approverUserIds)]),
    credentials: await encrypt(JSON.stringify(credentials)),
    enabled: data.enabled,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  await db
    .insert(slack_integrations)
    .values(values)
    .onConflictDoUpdate({ target: slack_integrations.team_id, set: values });
  return getSlackSettings(teamId);
}
export async function testSlackConnection(teamId: string) {
  const row = await getSlackIntegration(teamId);
  if (!row) throw new Error("Connect Slack first");
  const credentials = await getSlackCredentials(teamId);
  const result = await validateConnection(
    credentials,
    row.channel_id,
    JSON.parse(row.approver_user_ids),
  );
  await slackApi(credentials.botToken, "chat.postMessage", {
    channel: row.channel_id,
    text: "Content Hub Slack approval connection verified. Daily research drafts will appear here. Reply in a draft thread to request edits; only Approve & publish publishes a post.",
    unfurl_links: false,
    unfurl_media: false,
  });
  return result;
}
export async function disconnectSlack(teamId: string) {
  const db = await getDb();
  await db
    .delete(slack_integrations)
    .where(eq(slack_integrations.team_id, teamId));
  return getSlackSettings(teamId);
}
export async function verifySlackRequest(
  request: Request,
  body: string,
  secret: string,
  now = Date.now(),
) {
  const timestamp = request.headers.get("x-slack-request-timestamp") || "";
  const signature = request.headers.get("x-slack-signature") || "";
  if (
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300 ||
    !/^v0=[a-f0-9]{64}$/.test(signature)
  )
    return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const bytes = new Uint8Array(
    signature
      .slice(3)
      .match(/.{2}/g)!
      .map((byte) => parseInt(byte, 16)),
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    bytes,
    new TextEncoder().encode(`v0:${timestamp}:${body}`),
  );
}
export async function authenticateSlackRequest(
  request: Request,
  body: string,
  workspaceId: string,
) {
  const db = await getDb();
  const row = (
    await db
      .select()
      .from(slack_integrations)
      .where(eq(slack_integrations.workspace_id, workspaceId))
      .limit(1)
  )[0];
  if (!row) return null;
  const credentials = await getSlackCredentials(row.team_id);
  const secret = credentials.appManaged
    ? process.env.SLACK_SIGNING_SECRET || ""
    : credentials.signingSecret;
  return secret && (await verifySlackRequest(request, body, secret))
    ? row
    : null;
}
